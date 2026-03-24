/**
 * EphemeralPatchManager — manages ephemeral (temporary) state patches.
 *
 * Handles storing patches in EphemeralStore, composing ephemeral overlay
 * on top of base state, tracking local writes, resolving container paths,
 * and finalizing (committing) patches to LoroDoc.
 */
import {
    Container,
    ContainerID,
    EphemeralStore,
    isContainer,
    LoroDoc,
    LoroList,
    LoroMap,
    LoroMovableList,
} from "loro-crdt";

/** The value type accepted by EphemeralStore.set() */
type EphemeralValue = Parameters<EphemeralStore["set"]>[1];
import type { Change } from "./mirror.js";
import { CID_KEY } from "../constants.js";

/**
 * Context needed from Mirror for path resolution.
 */
export interface PathResolverContext {
    doc: LoroDoc;
    rootPathById: Map<ContainerID, string[]>;
}

/**
 * Manages ephemeral patches: storage, composition, path resolution, and finalization.
 */
export class EphemeralPatchManager {
    private store: EphemeralStore;
    /** Tracks what the local peer last wrote, keyed by ContainerID -> fieldKey -> value */
    private localValues: Map<ContainerID, Record<string, unknown>> = new Map();
    private finalizeTimer?: ReturnType<typeof setTimeout>;
    private defaultTimeout: number = 50_000;

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
     */
    isEligible(change: Change, doc: LoroDoc): boolean {
        if (change.kind !== "set" && change.kind !== "insert") return false;
        if (!change.container || (change.container as string) === "") return false;
        if (!("key" in change) || typeof change.key !== "string") return false;

        const value = change.value;
        if (value !== null && typeof value === "object") return false;

        try {
            const container = doc.getContainerById(change.container as ContainerID);
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
    writeChanges(changes: Change[]): void {
        for (const change of changes) {
            if (!("key" in change) || typeof change.key !== "string") continue;
            const containerId = change.container as ContainerID;
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
        const allStates = this.store.getAllStates();
        if (!allStates || Object.keys(allStates).length === 0) return base;

        let composed = base;
        let hasChanges = false;

        for (const [containerIdStr, fields] of Object.entries(allStates)) {
            if (!fields || typeof fields !== "object") continue;
            const containerId = containerIdStr as ContainerID;
            const path = this.resolvePath(containerId, ctx);
            if (!path || path.length === 0) continue;

            // Navigate to the target object in state
            let target: Record<string, unknown> | undefined =
                composed as unknown as Record<string, unknown>;
            for (let i = 0; i < path.length; i++) {
                const seg = path[i];
                const v = typeof seg === "number"
                    ? (target as unknown as unknown[])[seg]
                    : target[seg];
                if (v && typeof v === "object") {
                    target = v as Record<string, unknown>;
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
                composed = Object.assign(
                    {},
                    composed as unknown as Record<string, unknown>,
                ) as unknown as T;
                hasChanges = true;
            }

            // Immutably clone each segment along the path, preserving non-enumerable $cid
            let node: unknown = composed;
            for (let i = 0; i < path.length; i++) {
                const seg = path[i];
                const parent = node as Record<string | number, unknown>;
                const child = parent[seg];
                let clone: unknown;
                if (Array.isArray(child)) {
                    clone = [...child];
                } else {
                    const obj = child as Record<string, unknown>;
                    clone = { ...obj };
                    // Preserve non-enumerable $cid property (set via defineCidProperty)
                    const cid = (obj as Record<string | symbol, unknown>)[CID_KEY];
                    if (cid !== undefined) {
                        Object.defineProperty(clone, CID_KEY, { value: cid });
                    }
                }
                parent[seg] = clone;
                node = clone;
            }
            target = node as Record<string, unknown>;

            for (const [key, value] of Object.entries(fieldEntries)) {
                if (key in target) {
                    target[key] = value;
                }
            }
        }

        return composed;
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
     * Schedule a debounced finalize. Resets any existing timer.
     */
    scheduleFinalizeAfter(timeout: number | undefined, callback: () => void): void {
        const ms = timeout ?? this.defaultTimeout;
        this.clearTimer();
        this.finalizeTimer = setTimeout(callback, ms);
    }

    clearTimer(): void {
        if (this.finalizeTimer != null) {
            clearTimeout(this.finalizeTimer);
            this.finalizeTimer = undefined;
        }
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
     * Always computed fresh — no caching, since list indices can change after moves.
     */
    resolvePath(
        containerId: ContainerID,
        ctx: PathResolverContext,
    ): (string | number)[] | undefined {
        const rootPath = ctx.rootPathById.get(containerId);
        if (rootPath) {
            return rootPath;
        }

        try {
            const container = ctx.doc.getContainerById(containerId);
            if (!container) return undefined;

            const segments: (string | number)[] = [];
            let current: Container | undefined = container;
            while (current) {
                const parent: Container | undefined = current.parent();
                if (!parent) {
                    const rootKey = ctx.rootPathById.get(current.id);
                    if (rootKey) {
                        segments.unshift(...rootKey);
                        break;
                    }
                    return undefined;
                }

                if (parent.kind() === "Map") {
                    const map = parent as LoroMap;
                    for (const k of map.keys()) {
                        const v = map.get(k);
                        if (isContainer(v) && v.id === current.id) {
                            segments.unshift(k);
                            break;
                        }
                    }
                } else if (
                    parent.kind() === "List" ||
                    parent.kind() === "MovableList"
                ) {
                    const list = parent as LoroList | LoroMovableList;
                    const len = list.length;
                    let found = false;
                    for (let i = 0; i < len; i++) {
                        const v = list.get(i);
                        if (isContainer(v) && v.id === current.id) {
                            segments.unshift(i);
                            found = true;
                            break;
                        }
                    }
                    if (!found) return undefined;
                } else {
                    return undefined;
                }
                current = parent;
            }

            if (segments.length > 0) {
                return segments;
            }
        } catch {
            // Container not found
        }

        return undefined;
    }
}
