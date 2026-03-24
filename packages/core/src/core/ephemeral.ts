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

/**
 * Manages ephemeral patches: storage, composition, path resolution, and finalization.
 */
export class EphemeralPatchManager {
    private store: EphemeralStore;
    /** Tracks what the local peer last wrote, keyed by ContainerID -> fieldKey -> value */
    private localValues: Map<ContainerID, Record<string, unknown>> = new Map();
    private debounce = new DebounceTimer();

    constructor(store: EphemeralStore) {
        this.store = store;
    }

    /** Subscribe to EphemeralStore changes. Returns unsubscribe function. */
    subscribe(listener: () => void): () => void {
        return this.store.subscribe(listener);
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
    writeChanges(changes: EphemeralEligibleChange[]): void {
        for (const change of changes) {
            const containerId = change.container;
            const key = change.key;
            const value = change.value;

            // Update EphemeralStore
            let currentPatch = this.store.get(containerId) as
                | Record<string, unknown>
                | undefined;
            if (!currentPatch) {
                currentPatch = {};
            }
            currentPatch[key] = value;
            this.store.set(containerId, currentPatch as EphemeralValue);

            // Track local writes
            let localEntry = this.localValues.get(containerId);
            if (!localEntry) {
                localEntry = {};
                this.localValues.set(containerId, localEntry);
            }
            localEntry[key] = value;
        }
    }

    /**
     * Compose state by overlaying all ephemeral patches on top of base state.
     * Returns the base unchanged if no patches exist.
     */
    compose<T>(base: T, ctx: PathResolverContext): T {
        type Obj = Record<string | number | symbol, unknown>;

        const allStates = this.store.getAllStates();
        if (!allStates || Object.keys(allStates).length === 0) return base;

        let composed = base as Obj;
        let hasChanges = false;

        for (const [containerIdStr, fields] of Object.entries(allStates)) {
            if (!fields || typeof fields !== "object") continue;
            const containerId = containerIdStr as ContainerID;
            const path = this.resolvePath(containerId, ctx);
            if (!path || path.length === 0) continue;

            // Navigate to the target object in state
            let target: Obj | undefined = composed;
            for (let i = 0; i < path.length; i++) {
                const v = target[path[i]];
                if (v && typeof v === "object") {
                    target = v as Obj;
                } else {
                    target = undefined;
                    break;
                }
            }
            if (!target) continue;

            const fieldEntries = fields as Record<string, unknown>;
            let needsClone = false;
            for (const [key, value] of Object.entries(fieldEntries)) {
                if (key in target && target[key] !== value) {
                    needsClone = true;
                    break;
                }
            }
            if (!needsClone) continue;

            if (!hasChanges) {
                composed = { ...composed };
                hasChanges = true;
            }

            // Immutably clone each segment along the path, preserving non-enumerable $cid
            let node: Obj = composed;
            for (let i = 0; i < path.length; i++) {
                const seg = path[i];
                const child = node[seg];
                let clone: Obj;
                if (Array.isArray(child)) {
                    clone = [...child] as unknown as Obj;
                } else {
                    const obj = child as Obj;
                    clone = { ...obj };
                    // Preserve non-enumerable $cid property (set via defineCidProperty)
                    const cid = obj[CID_KEY];
                    if (cid !== undefined) {
                        Object.defineProperty(clone, CID_KEY, { value: cid });
                    }
                }
                node[seg] = clone;
                node = clone;
            }

            for (const [key, value] of Object.entries(fieldEntries)) {
                if (key in node) {
                    node[key] = value;
                }
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
                    this.store.delete(containerId);
                } else {
                    const remaining: Record<string, unknown> = {};
                    for (const k of remainingKeys) {
                        remaining[k] = currentPatch[k];
                    }
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
}
