/**
 * EphemeralPatchManager — manages ephemeral (temporary) state patches.
 *
 * Handles storing patches in EphemeralStore, composing ephemeral overlay
 * on top of base state, tracking local writes, resolving container paths,
 * and finalizing (committing) patches to LoroDoc.
 */
import {
    ContainerID,
    EphemeralStore,
    LoroDoc,
    LoroMap,
} from "loro-crdt";

/** The value type accepted by EphemeralStore.set() */
type EphemeralValue = Parameters<EphemeralStore["set"]>[1];
import type { Change } from "./mirror.js";
import { CID_KEY } from "../constants.js";
import { DebounceTimer } from "./debounce-timer.js";

/**
 * A Change that has been validated as eligible for ephemeral storage.
 * Guarantees: `container` is a valid ContainerID (not ""), `key` is a string.
 */
export interface EphemeralEligibleChange {
    kind: "set" | "insert";
    container: ContainerID;
    key: string;
    value: unknown;
}

/**
 * Context needed from Mirror for path resolution.
 */
export interface PathResolverContext {
    doc: LoroDoc;
}

type EphemeralPatch = Record<string, unknown>;

interface StoreEventShape {
    by: "local" | "import" | "timeout";
    added: string[];
    updated: string[];
    removed: string[];
}

export interface EphemeralPatchDelta {
    containerId: ContainerID;
    previous: EphemeralPatch | undefined;
    next: EphemeralPatch | undefined;
}

export interface EphemeralStoreChangeEvent {
    by: "local" | "import" | "timeout";
    added: ContainerID[];
    updated: ContainerID[];
    removed: ContainerID[];
    deltas: EphemeralPatchDelta[];
}

/**
 * Manages ephemeral patches: storage, composition, path resolution, and finalization.
 */
export class EphemeralPatchManager {
    private store: EphemeralStore;
    /** Latest patch snapshot by container id */
    private patches: Map<ContainerID, EphemeralPatch> = new Map();
    /** Tracks what the local peer last wrote, keyed by ContainerID -> fieldKey -> value */
    private localValues: Map<ContainerID, Record<string, unknown>> = new Map();
    private debounce = new DebounceTimer();

    constructor(store: EphemeralStore) {
        this.store = store;
        this.syncAllPatchesFromStore();
    }

    /** Subscribe to EphemeralStore changes. Returns unsubscribe function. */
    subscribe(listener: (event: EphemeralStoreChangeEvent) => void): () => void {
        return this.store.subscribe((event) => {
            const typedEvent = event as StoreEventShape;
            listener({
                by: typedEvent.by,
                added: typedEvent.added.map((id) => id as ContainerID),
                updated: typedEvent.updated.map((id) => id as ContainerID),
                removed: typedEvent.removed.map((id) => id as ContainerID),
                deltas: this.syncFromStoreEvent(typedEvent),
            });
        });
    }

    get hasLocalPatches(): boolean {
        return this.localValues.size > 0;
    }

    /**
     * Check if a change is eligible for ephemeral storage.
     * Must be a primitive value change on an existing Map key.
     * Acts as a type guard — narrowing to {@link EphemeralEligibleChange}.
     */
    isEligible(change: Change, doc: LoroDoc): change is EphemeralEligibleChange {
        if (change.kind !== "set" && change.kind !== "insert") return false;
        if (!change.container) return false;
        if (!("key" in change) || typeof change.key !== "string") return false;

        const value = change.value;
        if (value !== null && typeof value === "object") return false;

        try {
            const container = doc.getContainerById(change.container);
            if (!container || container.kind() !== "Map") return false;
            const map = container as LoroMap;
            return map.keys().includes(change.key);
        } catch {
            return false;
        }
    }

    /**
     * Write a set of ephemeral-eligible changes to the EphemeralStore.
     */
    writeChanges(changes: EphemeralEligibleChange[]): EphemeralPatchDelta[] {
        const grouped = new Map<ContainerID, EphemeralPatch>();
        for (const change of changes) {
            const fieldUpdates = grouped.get(change.container) ?? {};
            fieldUpdates[change.key] = change.value;
            grouped.set(change.container, fieldUpdates);
        }

        const deltas: EphemeralPatchDelta[] = [];

        for (const [containerId, fieldUpdates] of grouped) {
            const previous = this.clonePatch(this.patches.get(containerId));
            const nextPatch: EphemeralPatch = {
                ...previous,
            };
            let hasChanges = false;

            for (const [key, value] of Object.entries(fieldUpdates)) {
                if (nextPatch[key] !== value) {
                    hasChanges = true;
                }
                nextPatch[key] = value;
            }

            if (!hasChanges) {
                continue;
            }

            this.patches.set(containerId, nextPatch);
            this.store.set(containerId, nextPatch as EphemeralValue);
            this.updateLocalValues(containerId, fieldUpdates);

            deltas.push({
                containerId,
                previous,
                next: this.clonePatch(nextPatch),
            });
        }

        return deltas;
    }

    /**
     * Fast path for directly patching a single primitive field.
     */
    writeValue(
        containerId: ContainerID,
        key: string,
        value: unknown,
    ): EphemeralPatchDelta[] {
        return this.writeChanges([
            { kind: "set", container: containerId, key, value },
        ]);
    }

    /**
     * Compose state by overlaying all ephemeral patches on top of base state.
     * Returns the base unchanged if no patches exist.
     */
    compose<T>(base: T, ctx: PathResolverContext): T {
        this.syncAllPatchesFromStore();
        if (this.patches.size === 0) return base;

        const deltas: EphemeralPatchDelta[] = [];
        for (const [containerId, patch] of this.patches) {
            deltas.push({
                containerId,
                previous: undefined,
                next: this.clonePatch(patch),
            });
        }
        return this.applyDelta(base, base, deltas, ctx);
    }

    /**
     * Incrementally apply patch deltas to a previously composed state.
     */
    applyDelta<T>(
        currentState: T,
        baseState: T,
        deltas: readonly EphemeralPatchDelta[],
        ctx: PathResolverContext,
    ): T {
        type Obj = Record<string | number | symbol, unknown>;

        if (deltas.length === 0) return currentState;

        let composed = currentState as Obj;
        const base = baseState as Obj;
        let hasChanges = false;

        for (const { containerId, previous, next } of deltas) {
            const path = this.resolvePath(containerId, ctx);
            if (!path || path.length === 0) continue;

            const target = this.navigateToObject(composed, path);
            const baseTarget = this.navigateToObject(base, path);
            if (!target || !baseTarget) continue;

            const keys = new Set<string>();
            if (previous) {
                for (const key of Object.keys(previous)) {
                    keys.add(key);
                }
            }
            if (next) {
                for (const key of Object.keys(next)) {
                    keys.add(key);
                }
            }

            const updates: Array<[string, unknown]> = [];
            for (const key of keys) {
                if (!(key in baseTarget)) continue;
                const desiredValue =
                    next && Object.prototype.hasOwnProperty.call(next, key)
                        ? next[key]
                        : baseTarget[key];
                if (target[key] !== desiredValue) {
                    updates.push([key, desiredValue]);
                }
            }
            if (updates.length === 0) continue;

            if (!hasChanges) {
                composed = this.cloneNode(composed);
                hasChanges = true;
            }

            const node = this.clonePath(composed, path);
            if (!node) continue;

            for (const [key, value] of updates) {
                node[key] = value;
            }
        }

        return composed as T;
    }

    /**
     * Finalize: commit locally-written ephemeral values to LoroDoc.
     * Only commits values that still match what we last wrote (not overwritten by remote).
     * Returns true if any changes were committed.
     */
    finalize(doc: LoroDoc): boolean {
        if (this.localValues.size === 0) return false;

        this.clearTimer();

        let hasChanges = false;

        for (const [containerId, localFields] of this.localValues) {
            const currentPatch = this.store.get(containerId) as
                | Record<string, unknown>
                | undefined;

            const container = doc.getContainerById(containerId);
            if (!container || container.kind() !== "Map") continue;
            const map = container as LoroMap;

            for (const [key, localValue] of Object.entries(localFields)) {
                const ephemeralValue = currentPatch?.[key];
                if (ephemeralValue === localValue) {
                    map.set(key, localValue);
                    hasChanges = true;
                }
            }

            // Clean up this container's patch from EphemeralStore
            if (currentPatch) {
                const remainingKeys = Object.keys(currentPatch).filter(
                    (k) =>
                        !(k in localFields) ||
                        currentPatch[k] !== localFields[k],
                );
                if (remainingKeys.length === 0) {
                    this.patches.delete(containerId);
                    this.store.delete(containerId);
                } else {
                    const remaining: Record<string, unknown> = {};
                    for (const k of remainingKeys) {
                        remaining[k] = currentPatch[k];
                    }
                    this.patches.set(containerId, { ...remaining });
                    this.store.set(containerId, remaining as EphemeralValue);
                }
            }
        }

        if (hasChanges) {
            doc.commit();
        }

        this.localValues.clear();

        return hasChanges;
    }

    /**
     * Schedule a debounced finalize via the deadline-based DebounceTimer.
     */
    scheduleFinalizeAfter(timeout: number | undefined, callback: () => void): void {
        this.debounce.schedule(callback, timeout);
    }

    clearTimer(): void {
        this.debounce.clear();
    }

    /**
     * Clean up all state.
     */
    dispose(): void {
        this.clearTimer();
        this.patches.clear();
        this.localValues.clear();
    }

    /**
     * Resolve a ContainerID to a path of keys/indices from the state root.
     * Delegates to LoroDoc's built-in `getPathToContainer`.
     */
    resolvePath(
        containerId: ContainerID,
        ctx: PathResolverContext,
    ): (string | number)[] | undefined {
        try {
            return ctx.doc.getPathToContainer(containerId) ?? undefined;
        } catch {
            return undefined;
        }
    }

    private syncAllPatchesFromStore(): void {
        const allStates = this.store.getAllStates();
        this.patches.clear();
        for (const [containerId, value] of Object.entries(allStates)) {
            const patch = this.toPatch(value);
            if (patch) {
                this.patches.set(containerId as ContainerID, patch);
            }
        }
    }

    private syncFromStoreEvent(event: StoreEventShape): EphemeralPatchDelta[] {
        const touched = new Set<ContainerID>();
        const deltas: EphemeralPatchDelta[] = [];

        for (const id of event.added) {
            touched.add(id as ContainerID);
        }
        for (const id of event.updated) {
            touched.add(id as ContainerID);
        }
        for (const id of event.removed) {
            touched.add(id as ContainerID);
        }

        for (const containerId of touched) {
            const previous = this.clonePatch(this.patches.get(containerId));
            const next = this.toPatch(this.store.get(containerId));

            if (next) {
                this.patches.set(containerId, next);
            } else {
                this.patches.delete(containerId);
            }

            deltas.push({
                containerId,
                previous,
                next: this.clonePatch(next),
            });
        }

        return deltas;
    }

    private toPatch(value: unknown): EphemeralPatch | undefined {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return undefined;
        }
        return { ...(value as EphemeralPatch) };
    }

    private clonePatch(patch: EphemeralPatch | undefined): EphemeralPatch | undefined {
        if (!patch) return undefined;
        return { ...patch };
    }

    private updateLocalValues(
        containerId: ContainerID,
        fieldUpdates: EphemeralPatch,
    ): void {
        let localEntry = this.localValues.get(containerId);
        if (!localEntry) {
            localEntry = {};
            this.localValues.set(containerId, localEntry);
        }
        for (const [key, value] of Object.entries(fieldUpdates)) {
            localEntry[key] = value;
        }
    }

    private navigateToObject(
        root: Record<string | number | symbol, unknown>,
        path: (string | number)[],
    ): Record<string | number | symbol, unknown> | undefined {
        let target: unknown = root;
        for (const segment of path) {
            if (!target || typeof target !== "object") {
                return undefined;
            }
            target = (target as Record<string | number | symbol, unknown>)[segment];
        }
        if (!target || typeof target !== "object") {
            return undefined;
        }
        return target as Record<string | number | symbol, unknown>;
    }

    private clonePath(
        root: Record<string | number | symbol, unknown>,
        path: (string | number)[],
    ): Record<string | number | symbol, unknown> | undefined {
        let node = root;
        for (const segment of path) {
            const child = node[segment];
            if (!child || typeof child !== "object") {
                return undefined;
            }
            const clone = this.cloneNode(
                child as Record<string | number | symbol, unknown>,
            );
            node[segment] = clone;
            node = clone;
        }
        return node;
    }

    private cloneNode(
        node: Record<string | number | symbol, unknown>,
    ): Record<string | number | symbol, unknown> {
        if (Array.isArray(node)) {
            return [...node] as unknown as Record<string | number | symbol, unknown>;
        }
        const clone = { ...node };
        const cid = node[CID_KEY];
        if (cid !== undefined) {
            Object.defineProperty(clone, CID_KEY, { value: cid });
        }
        return clone;
    }
}
