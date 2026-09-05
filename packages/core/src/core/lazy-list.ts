/**
 * Lazy list support: `LazyList` implementation for `schema.LoroList(..., { lazy })`.
 *
 * A lazy list is never walked at Mirror init; state holds a stable
 * {@link LazyListImpl} instance at the lazy key. Item data is read on demand
 * (`hydrate`) and keyed by item *container id* so positional views stay
 * correct across structural edits.
 */
import { Container, ContainerID, isContainer } from "loro-crdt";
import { LAZY_LIST_BRAND } from "../constants.js";
import type {
    LazyList,
    LazyListOptions,
    LoroListSchema,
    SchemaType,
} from "../schema/types.js";

/** List-diff delta item as emitted by Loro (`LoroEventBatch` list diffs). */
export type LazyListDelta = Array<{
    insert?: unknown[];
    delete?: number;
    retain?: number;
}>;

/**
 * Callbacks a `LazyListImpl` needs from its owning Mirror. Kept as an
 * interface (rather than a `Mirror` reference) so this module never imports
 * `mirror.ts` at runtime.
 */
export interface LazyListHost {
    /** Current shallow ids of the list (`list.getShallowValue()`). */
    readItemIds(listId: ContainerID): unknown[];
    /**
     * Decoded values of the schema's `lazy.index` fields for one item
     * container (cheapest available read, e.g. `map.getShallowValue()`).
     */
    readItemIndex(
        listId: ContainerID,
        itemCid: ContainerID,
    ): Record<string, unknown>;
    /**
     * Fully read one item into mirror state: nested containers are registered
     * in the container registry, `$cid` is stamped, schema decodes applied —
     * exactly what the non-lazy state for that item would look like.
     */
    readItemState(listId: ContainerID, itemCid: ContainerID): unknown;
    /**
     * Decode one index field from a raw value taken out of a Loro map diff
     * (containers are resolved to their JSON value first).
     */
    decodeIndexValue(
        listId: ContainerID,
        field: string,
        rawValue: unknown,
    ): unknown;
    /** Resolve a live container handle by id. */
    getContainerById(id: ContainerID): Container | undefined;
}

type LazyListSchemaWithOptions = LoroListSchema<SchemaType> & {
    options: { lazy: LazyListOptions };
};
type HydratedEntry<T> = { value: T; lru: number };

type RangeSubscription = { from: number; to: number; listener: () => void };

interface LazyListInternal<T> {
    /**
     * Position-aligned item identities: container id strings for container
     * items, raw primitives for primitive items (mirrors
     * `list.getShallowValue()` exactly).
     */
    ids: ContainerID[];
    posById: Map<ContainerID, number>;
    /** Index-field values (decoded) per item container id; covers all items. */
    indexCache: Map<ContainerID, Record<string, unknown>>;
    /** idSelector-derived id per item container id (best effort). */
    selectorIdByCid: Map<ContainerID, string>;
    cidBySelectorId: Map<string, ContainerID>;
    hydrated: Map<ContainerID, HydratedEntry<T>>;
    ranges: Set<RangeSubscription>;
    writePins: Set<ContainerID>;
    version: number;
    clock: number;
}

const DEFAULT_MAX_HYDRATED = 200;
const DEFAULT_TAIL_KEEP = 20;

function isCidString(value: unknown): value is ContainerID {
    return typeof value === "string" && value.startsWith("cid:");
}

/**
 * Thrown by `Mirror.setState` when an update touches a lazy list path.
 * Writes to lazy lists go through `mirror.list(path)` instead.
 */
export class LazyListWriteError extends Error {
    constructor(path: string) {
        super(
            `Cannot update lazy list at "${path}" via setState: lazy lists are read views. ` +
                `Use mirror.list("${path}") (push/insert/deleteById/updateById/updateAt) for writes.`,
        );
        this.name = "LazyListWriteError";
    }
}

/**
 * Runtime check for `LazyList` state values (brand-based; works across
 * duplicated bundles).
 */
export function isLazyList(value: unknown): value is LazyList<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<PropertyKey, unknown>)[LAZY_LIST_BRAND] === true
    );
}

/**
 * Concrete {@link LazyList} implementation. All mutable internals live in a
 * single non-enumerable property so the instance is invisible to Mirror's
 * whole-state walkers (`stripUndefined`, `deepEqual`, `hardenCidDescriptors`)
 * and passes through Immer `produce` untouched (class instances are not
 * draftable).
 */
export class LazyListImpl<T = unknown, I = Partial<T>>
    implements LazyList<T, I>
{
    declare private _s: LazyListInternal<T>;
    declare private host: LazyListHost;
    /** Container id of the backing LoroList. */
    declare readonly listId: ContainerID;
    declare private listSchema: LazyListSchemaWithOptions;

    constructor(
        host: LazyListHost,
        listId: ContainerID,
        listSchema: LazyListSchemaWithOptions,
        ids: ContainerID[],
        indexCache: Map<ContainerID, Record<string, unknown>>,
    ) {
        const internal: LazyListInternal<T> = {
            ids,
            posById: new Map(),
            indexCache,
            selectorIdByCid: new Map(),
            cidBySelectorId: new Map(),
            hydrated: new Map(),
            ranges: new Set(),
            writePins: new Set(),
            version: 0,
            clock: 0,
        };
        // Non-enumerable on purpose: keeps the instance opaque to state-tree
        // walkers that iterate own enumerable keys (see module docstring).
        Object.defineProperty(this, "_s", {
            value: internal,
            writable: true,
        });
        Object.defineProperty(this, "host", { value: host, writable: true });
        Object.defineProperty(this, "listId", { value: listId });
        Object.defineProperty(this, "listSchema", {
            value: listSchema,
            writable: true,
        });
        Object.defineProperty(this, LAZY_LIST_BRAND, { value: true });
        this.rebuildPositions();
        for (const cid of internal.indexCache.keys()) {
            this.refreshSelectorId(cid);
        }
    }

    get length(): number {
        return this._s.ids.length;
    }

    get version(): number {
        return this._s.version;
    }

    /** Options bag (`lazy.index`, `lazy.maxHydrated`, `lazy.tailKeep`). */
    get lazyOptions(): LazyListOptions {
        return this.listSchema.options.lazy;
    }

    /** Item schema of the backing list. */
    get itemSchema(): SchemaType {
        return this.listSchema.itemSchema;
    }

    ids(): readonly ContainerID[] {
        return this._s.ids;
    }

    indexOf(id: string): number {
        const byCid = this._s.posById.get(id as ContainerID);
        if (byCid !== undefined) return byCid;
        const cid = this._s.cidBySelectorId.get(id);
        if (cid === undefined) return -1;
        return this._s.posById.get(cid) ?? -1;
    }

    index(i: number): I | undefined {
        const cid = this._s.ids[i];
        if (!isCidString(cid)) return undefined;
        return this._s.indexCache.get(cid) as I | undefined;
    }

    get(i: number): T | undefined {
        const entry = this._s.ids[i];
        if (!isCidString(entry)) {
            // Primitive items are always fully known (they cannot nest
            // containers), so they read as hydrated.
            return entry as T;
        }
        return this._s.hydrated.get(entry)?.value;
    }

    slice(from: number, to: number): (T | undefined)[] {
        const start = Math.max(0, from);
        const end = Math.min(this._s.ids.length, to);
        const out: (T | undefined)[] = [];
        for (let i = start; i < end; i++) {
            out.push(this.get(i));
        }
        return out;
    }

    isHydrated(i: number): boolean {
        const entry = this._s.ids[i];
        if (!isCidString(entry)) return entry !== undefined;
        return this._s.hydrated.has(entry);
    }

    /**
     * Batch-read the item range into memory. Per item this resolves the
     * container handle and runs Mirror's normal per-container state builder
     * (loro-crdt 1.13.3 has no per-container deep-read-with-ids API; if one
     * appears the host will use it). Resolves once the range is loaded.
     */
    hydrate(from: number, to: number): Promise<void> {
        const start = Math.max(0, from);
        const end = Math.min(this._s.ids.length, to);
        let changed = false;
        for (let i = start; i < end; i++) {
            changed = this._hydrateIndex(i) || changed;
        }
        if (changed) {
            this.evictIfNeeded();
            this.bumpIfRangeAffected(start, end);
        }
        return Promise.resolve();
    }

    /**
     * Synchronously hydrate one position (internal; used by `hydrate` and by
     * `mirror.list` updates). Returns whether a slot was newly loaded.
     */
    _hydrateIndex(i: number): boolean {
        const cid = this._s.ids[i];
        if (!isCidString(cid)) return false;
        const existing = this._s.hydrated.get(cid);
        if (existing) {
            existing.lru = ++this._s.clock;
            return false;
        }
        const value = this.host.readItemState(this.listId, cid) as T;
        this._s.hydrated.set(cid, { value, lru: ++this._s.clock });
        // Hydration may reveal selector-id fields absent from the index.
        this.refreshSelectorId(cid);
        this.evictIfNeeded();
        return true;
    }

    /** Keep an update target alive until its synchronous write finishes. */
    _withHydratedItem<R>(i: number, update: (value: T | undefined) => R): R {
        const cid = this._s.ids[i];
        const alreadyPinned = this._s.writePins.has(cid);
        this._s.writePins.add(cid);
        try {
            this._hydrateIndex(i);
            return update(this._s.hydrated.get(cid)?.value);
        } finally {
            if (!alreadyPinned) this._s.writePins.delete(cid);
            this.evictIfNeeded();
        }
    }

    /**
     * Drop hydration for the range. Explicit release drops entries even when
     * the LRU would keep them, but items inside an active `subscribeRange`
     * window are exempt.
     */
    release(from: number, to: number): void {
        const start = Math.max(0, from);
        const end = Math.min(this._s.ids.length, to);
        let changed = false;
        for (let i = start; i < end; i++) {
            const cid = this._s.ids[i];
            if (!isCidString(cid)) continue;
            if (this.isInActiveRange(i)) continue;
            if (this._s.hydrated.delete(cid)) changed = true;
        }
        if (changed) {
            this.bumpIfRangeAffected(start, end);
        }
    }

    subscribeRange(from: number, to: number, listener: () => void): () => void {
        const sub: RangeSubscription = { from, to, listener };
        this._s.ranges.add(sub);
        return () => {
            this._s.ranges.delete(sub);
        };
    }

    /* ------------------------------------------------------------------ */
    /* Internal drivers, called by Mirror only.                            */
    /* ------------------------------------------------------------------ */

    /**
     * Apply a structural list delta (insert/delete/move — moves arrive as
     * delete+insert pairs) to the cached ids. Hydrated data is keyed by
     * container id, so it survives positional shifts untouched; entries for
     * deleted items are dropped.
     */
    _applyListDelta(deltas: LazyListDelta): void {
        const s = this._s;
        let index = 0;
        let minChanged = Infinity;
        for (const d of deltas) {
            if (d.retain !== undefined) {
                index += d.retain;
            } else if (d.delete !== undefined) {
                const count = d.delete;
                if (count > 0) {
                    const removed = s.ids.splice(index, count);
                    minChanged = Math.min(minChanged, index);
                    for (const cid of removed) {
                        if (!isCidString(cid)) continue;
                        s.hydrated.delete(cid);
                        s.indexCache.delete(cid);
                        this.dropSelectorId(cid);
                    }
                }
            } else if (d.insert !== undefined) {
                const inserted = d.insert.map((v) =>
                    isContainer(v) ? v.id : (v as ContainerID),
                );
                s.ids.splice(index, 0, ...inserted);
                minChanged = Math.min(minChanged, index);
                for (const cid of inserted) {
                    if (!isCidString(cid)) continue;
                    s.indexCache.set(
                        cid,
                        this.host.readItemIndex(this.listId, cid),
                    );
                    this.refreshSelectorId(cid);
                }
                index += inserted.length;
            }
        }
        if (minChanged === Infinity) return;
        this.rebuildPositions();
        s.version++;
        // A structural change at `minChanged` shifts every later index, so
        // any range reaching past it observes moved indices.
        for (const sub of s.ranges) {
            if (sub.to > minChanged) sub.listener();
        }
    }

    /**
     * Replace a hydrated item's state after an event batch was applied to it
     * (structural sharing preserved by the caller's produce). Refreshes the
     * index cache from the new value, bumps `version` when an index field
     * changed, and notifies ranges covering the item's current position.
     */
    _setHydratedFromEvent(itemCid: ContainerID, value: unknown): void {
        const s = this._s;
        const entry = s.hydrated.get(itemCid);
        if (!entry) return;
        entry.value = value as T;
        entry.lru = ++s.clock;
        const indexChanged = this.refreshIndexFromState(itemCid, value);
        if (indexChanged) s.version++;
        this.refreshSelectorId(itemCid);
        this.notifyItemChanged(itemCid);
    }

    /**
     * Store a freshly written item (push/insert/update through
     * `mirror.list`) as hydrated, evicting LRU entries if needed.
     */
    _setHydratedFromWrite(itemCid: ContainerID, value: unknown): void {
        const s = this._s;
        s.hydrated.set(itemCid, { value: value as T, lru: ++s.clock });
        const indexChanged = this.refreshIndexFromState(itemCid, value);
        if (indexChanged) s.version++;
        this.refreshSelectorId(itemCid);
        this.evictIfNeeded();
        const pos = s.posById.get(itemCid);
        if (pos !== undefined) this.bumpIfRangeAffected(pos, pos + 1);
    }

    /**
     * Update index fields of a non-hydrated item from a map diff on the item
     * map itself. Only fields named in `lazy.index` are read; the item is
     * NOT hydrated. Bumps `version` and notifies covering ranges.
     */
    _updateIndexFromMapDiff(
        itemCid: ContainerID,
        updated: Record<string, unknown>,
    ): boolean {
        const fields = this.lazyOptions.index;
        const entry = this._s.indexCache.get(itemCid);
        if (!entry) return false;
        let changed = false;
        for (const field of fields) {
            if (!Object.prototype.hasOwnProperty.call(updated, field)) {
                continue;
            }
            const raw = updated[field];
            const next =
                raw === undefined
                    ? undefined
                    : this.host.decodeIndexValue(this.listId, field, raw);
            if (next === undefined) {
                if (field in entry) {
                    delete entry[field];
                    changed = true;
                }
            } else if (entry[field] !== next) {
                entry[field] = next;
                changed = true;
            }
        }
        if (changed) {
            this._s.version++;
            this.refreshSelectorId(itemCid);
            this.notifyItemChanged(itemCid);
        }
        return changed;
    }

    /** Re-read one index field (e.g. a LoroText) of a non-hydrated item. */
    _updateIndexFieldFromContainer(
        itemCid: ContainerID,
        field: string,
        rawValue: unknown,
    ): void {
        const entry = this._s.indexCache.get(itemCid);
        if (!entry) return;
        const next = this.host.decodeIndexValue(this.listId, field, rawValue);
        if (entry[field] === next) return;
        if (next === undefined) delete entry[field];
        else entry[field] = next;
        this._s.version++;
        this.refreshSelectorId(itemCid);
        this.notifyItemChanged(itemCid);
    }

    /**
     * Re-sync ids from the doc (used when the snapshot is rebuilt without
     * events, e.g. the ephemeral fallback path). Hydrated entries are kept by
     * container id; stale entries are pruned.
     */
    _refreshFromDoc(): void {
        const s = this._s;
        const raw = this.host.readItemIds(this.listId);
        const nextIds = raw.map((v) =>
            isContainer(v) ? v.id : (v as ContainerID),
        );
        const same =
            nextIds.length === s.ids.length &&
            nextIds.every((id, i) => id === s.ids[i]);
        if (same) return;
        const live = new Set(nextIds);
        for (const cid of Array.from(s.hydrated.keys())) {
            if (!live.has(cid)) {
                s.hydrated.delete(cid);
                this.dropSelectorId(cid);
            }
        }
        for (const cid of Array.from(s.indexCache.keys())) {
            if (!live.has(cid)) s.indexCache.delete(cid);
        }
        s.ids = nextIds;
        for (const cid of nextIds) {
            if (!isCidString(cid)) continue;
            if (!s.indexCache.has(cid)) {
                s.indexCache.set(
                    cid,
                    this.host.readItemIndex(this.listId, cid),
                );
            }
            this.refreshSelectorId(cid);
        }
        this.rebuildPositions();
        s.version++;
        // Everything may have moved; notify all ranges.
        for (const sub of s.ranges) sub.listener();
    }

    _isHydratedCid(cid: ContainerID): boolean {
        return this._s.hydrated.has(cid);
    }

    _getHydratedCid(cid: ContainerID): T | undefined {
        return this._s.hydrated.get(cid)?.value;
    }

    _hasIndexField(field: string): boolean {
        return this.lazyOptions.index.includes(field);
    }

    /* ------------------------------------------------------------------ */
    private rebuildPositions(): void {
        const s = this._s;
        s.posById.clear();
        for (let i = 0; i < s.ids.length; i++) {
            const id = s.ids[i];
            if (isCidString(id)) s.posById.set(id, i);
        }
    }

    private refreshSelectorId(cid: ContainerID): void {
        const selector = this.listSchema.idSelector;
        if (!selector) return;
        const data =
            this._s.hydrated.get(cid)?.value ?? this._s.indexCache.get(cid);
        if (data === undefined || data === null) return;
        let id: string | undefined;
        try {
            id = selector(data) || undefined;
        } catch {
            id = undefined;
        }
        this.dropSelectorId(cid);
        if (id !== undefined) {
            this._s.selectorIdByCid.set(cid, id);
            this._s.cidBySelectorId.set(id, cid);
        }
    }

    private dropSelectorId(cid: ContainerID): void {
        const prev = this._s.selectorIdByCid.get(cid);
        if (prev !== undefined) {
            this._s.cidBySelectorId.delete(prev);
            this._s.selectorIdByCid.delete(cid);
        }
    }

    /**
     * Re-read `lazy.index` fields from a hydrated item's state object.
     * Returns whether any index field changed.
     */
    private refreshIndexFromState(cid: ContainerID, value: unknown): boolean {
        if (typeof value !== "object" || value === null) return false;
        let entry = this._s.indexCache.get(cid);
        if (!entry) {
            entry = {};
            this._s.indexCache.set(cid, entry);
        }
        const record = value as Record<string, unknown>;
        let changed = false;
        for (const field of this.lazyOptions.index) {
            const next = record[field];
            const prev = entry[field];
            if (next === undefined) {
                if (field in entry) {
                    delete entry[field];
                    changed = true;
                }
            } else if (prev !== next) {
                entry[field] = next;
                changed = true;
            }
        }
        return changed;
    }

    private notifyItemChanged(cid: ContainerID): void {
        const pos = this._s.posById.get(cid);
        if (pos === undefined) return;
        for (const sub of this._s.ranges) {
            if (pos >= sub.from && pos < sub.to) sub.listener();
        }
    }

    private isInActiveRange(i: number): boolean {
        for (const sub of this._s.ranges) {
            if (i >= sub.from && i < sub.to) return true;
        }
        return false;
    }

    private isProtectedIndex(i: number): boolean {
        const tailKeep = this.lazyOptions.tailKeep ?? DEFAULT_TAIL_KEEP;
        if (i >= this._s.ids.length - tailKeep) return true;
        return this.isInActiveRange(i);
    }

    private evictIfNeeded(): void {
        const s = this._s;
        const max = this.lazyOptions.maxHydrated ?? DEFAULT_MAX_HYDRATED;
        if (s.hydrated.size <= max) return;
        const candidates = Array.from(s.hydrated.entries())
            .filter(([cid]) => {
                const pos = s.posById.get(cid);
                return (
                    pos !== undefined &&
                    !s.writePins.has(cid) &&
                    !this.isProtectedIndex(pos)
                );
            })
            .sort((a, b) => a[1].lru - b[1].lru);
        for (const [cid] of candidates) {
            if (s.hydrated.size <= max) break;
            s.hydrated.delete(cid);
        }
    }

    /**
     * Bump `version` and notify listeners when a hydrate/release affected a
     * subscribed range (per the LazyList versioning contract).
     */
    private bumpIfRangeAffected(from: number, to: number): void {
        let hit = false;
        for (const sub of this._s.ranges) {
            if (sub.from < to && sub.to > from) {
                hit = true;
                sub.listener();
            }
        }
        if (hit) this._s.version++;
    }
}
