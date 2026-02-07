import { produce } from "immer";
import {
    Container,
    ContainerID,
    isContainer,
    LoroCounter,
    LoroEvent,
    LoroEventBatch,
    TreeID,
} from "loro-crdt";
import { defineCidProperty, isTreeID, applyDecode } from "./utils.js";
import { SchemaType } from "../schema/index.js";

// Value held in Mirror state (no `any`)
type MirrorStatePrimitive = string | number | boolean | null | undefined | {};
type MirrorState = MirrorStatePrimitive | MirrorStateObject | MirrorState[];
interface MirrorStateObject {
    [k: string]: MirrorState;
}

// State representation for a tree node in mirror state
interface StateTreeNode {
    id: string;
    data: MirrorStateObject;
    children: StateTreeNode[];
}

function isJSONObject(v: unknown): v is MirrorStateObject {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isJSONArray(v: unknown): v is MirrorState[] {
    return Array.isArray(v);
}

/**
 * Apply a Loro event batch to a JSON-like state object.
 * Returns a new state object (using immer) with deltas applied.
 */
export function applyEventBatchToState<T extends object>(
    currentState: T,
    event: LoroEventBatch,
    options?:
        | ((id: ContainerID) => Container | undefined)
        | {
              getContainerById?: (id: ContainerID) => Container | undefined;
              containerToMirrorState?: (c: Container) => MirrorState;
              nodeDataWithCid?: (treeId: ContainerID) => boolean;
              getNodeDataCid?: (
                  treeId: ContainerID,
                  nodeId: TreeID,
              ) => string | undefined;
              /**
               * Get the schema for a field within a container.
               * For maps, pass the field key. For lists, omit the key to get the item schema.
               */
              getSchemaForKey?: (
                  containerId: ContainerID,
                  mapKey?: string,
              ) => SchemaType | undefined;
          },
): T {
    const opts =
        typeof options === "function"
            ? { getContainerById: options }
            : options || {};
    const next = produce<T>((draft) => {
        const ignoreSet = new Set<ContainerID>();
        for (const e of event.events) {
            applySingleEventToDraft(
                draft as MirrorStateObject,
                e,
                ignoreSet,
                opts.getContainerById,
                opts.containerToMirrorState,
                opts.nodeDataWithCid,
                opts.getNodeDataCid,
                opts.getSchemaForKey,
            );
        }
    })(currentState);
    return next;
}

/**
 * Apply a single event to the immer draft state
 */
function applySingleEventToDraft(
    draftRoot: MirrorStateObject,
    e: LoroEvent,
    ignoreSet: Set<ContainerID>,
    getContainerById?: (id: ContainerID) => Container | undefined,
    containerToMirrorState?: (c: Container) => MirrorState,
    nodeDataWithCid?: (treeId: ContainerID) => boolean,
    getNodeDataCid?: (
        treeId: ContainerID,
        nodeId: TreeID,
    ) => string | undefined,
    getSchemaForKey?: (
        containerId: ContainerID,
        mapKey?: string,
    ) => SchemaType | undefined,
) {
    if (isIgnoredByAncestor(e.target, ignoreSet, getContainerById)) {
        return;
    }

    // Resolve the container node in state at the event path
    const { parent, key, node } = getParentKeyNodeByPath(draftRoot, e.path);

    // If target node is missing, initialize a neutral baseline for applying deltas
    let target: MirrorState | undefined = node;
    if (target === undefined) {
        if (e.diff.type === "map") {
            if (parent && key !== undefined) setAt(parent, key, {});
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "list") {
            if (parent && key !== undefined)
                setAt(parent, key, [] as MirrorState[]);
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "text") {
            if (parent && key !== undefined) setAt(parent, key, "");
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "tree") {
            if (parent && key !== undefined)
                setAt(parent, key, [] as MirrorState[]);
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "counter") {
            if (parent && key !== undefined) setAt(parent, key, 0);
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else {
            console.error("Unknown diff type:", e.diff);
            return;
        }
    }

    // Apply diff based on container type
    switch (e.diff.type) {
        case "map":
            if (!isJSONObject(target)) {
                if (parent && key !== undefined) setAt(parent, key, {});
                target =
                    parent && key !== undefined
                        ? getAt(parent, key)!
                        : draftRoot;
            }
            if (isJSONObject(target)) {
                applyMapDiff(
                    target,
                    e.diff.updated,
                    e.target,
                    ignoreSet,
                    containerToMirrorState,
                    getSchemaForKey,
                );
            }
            break;
        case "list":
            if (!isJSONArray(target)) {
                // Initialize if not array
                if (parent && key !== undefined)
                    setAt(parent, key, [] as MirrorState[]);
                target = parent && key !== undefined ? getAt(parent, key)! : [];
            }
            if (isJSONArray(target)) {
                applyListDelta(
                    target,
                    e.diff.diff,
                    e.target,
                    ignoreSet,
                    containerToMirrorState,
                    getSchemaForKey,
                );
            }
            break;
        case "text": {
            const base = typeof target === "string" ? target : "";
            const next = applyTextDelta(base, e.diff.diff);
            if (parent && key !== undefined) setAt(parent, key, next);
            break;
        }
        case "tree":
            if (!isJSONArray(target)) {
                if (parent && key !== undefined)
                    setAt(parent, key, [] as MirrorState[]);
                target = parent && key !== undefined ? getAt(parent, key)! : [];
            }
            if (isJSONArray(target)) {
                applyTreeDiff(
                    target,
                    e.diff.diff,
                    e.target,
                    nodeDataWithCid,
                    getNodeDataCid,
                );
                // Invalidate cache for this roots array after structural change
                ROOTS_TREE_INDEX_CACHE.delete(target as MirrorState[]);
            }
            break;
        case "counter":
            // Update number value incrementally if present
            if (parent && key !== undefined) {
                const baseNum = typeof target === "number" ? target : 0;
                const next = baseNum + (e.diff.increment ?? 0);
                setAt(parent, key, next);
            }
            break;
    }
}

/**
 * Resolve an event path into the mirror JSON state and return the parent, key and node.
 *
 * Tree node ID handling (important/tricky):
 * - Loro events reference tree nodes by a stable TreeID (e.g. "0@123...") rather than by
 *   positional indices. Our mirror state, however, stores trees as nested arrays of nodes
 *   with the shape: { id: string, data: object, children: Node[] }.
 * - When we see a path segment that looks like a TreeID and the current parent is the tree
 *   roots array, we resolve that ID anywhere within the tree (not just the direct children).
 *   Then we treat the resolved node's application data as the target for subsequent segments:
 *   - If the TreeID is the final segment in the path, we consider it a reference to the
 *     node's data map, and we return parent=node and key="data" so that diffs read/write
 *     node.data directly.
 *   - If there are more segments after the TreeID, we first jump into node.data and continue
 *     resolving the remaining segments there (e.g. ["tree", "0@123...", "text"] resolves to
 *     node.data["text"]).
 *
 * Why this is needed: The event path uses TreeIDs (stable) while the mirror JSON uses indices
 * through the nested children arrays. For example:
 * - A LoroMap on a LoroTreeNode whose LoroTree is on the root may have an event path like
 *   ["tree", "0@123..."] but the corresponding JSON path looks like something along the lines of
 *   ["tree", 0, "children", 0, "data"] depending on where that node sits in the hierarchy.
 * - A LoroText inside a LoroMap on a LoroTreeNode would have an event path like
 *   ["tree", "0@123...", "text"], while the JSON path could be
 *   ["tree", 0, "children", 0, "data", "text"].
 *
 * This function bridges those two representations by:
 * - Resolving TreeIDs to node objects via a cached index of the current roots array.
 * - Implicitly inserting the "data" hop when a TreeID segment is encountered, so that
 *   subsequent segments operate on the node's data map rather than the node wrapper.
 *
 * 中文说明（简要）：事件路径里树节点用 TreeID（如 "0@123..."）来定位，但镜像的 JSON
 * 状态里树是按 children 层级数组存放（节点为 { id, data, children }），因此实际 JSON 路径会像
 * ["tree", 0, "children", 0, "data", "text"] 这样。这里在遇到 TreeID 段时，会在整棵树中
 * 定位到对应节点，并把后续的访问都指向该节点的 data（若 TreeID 是最后一段，则等价于访问 node.data）。
 */
function getParentKeyNodeByPath(
    root: MirrorStateObject,
    path: (string | number)[],
): {
    parent: MirrorStateObject | MirrorState[] | undefined;
    key: string | number | undefined;
    node: MirrorState | undefined;
} {
    if (!path || path.length === 0) {
        return { parent: undefined, key: undefined, node: root };
    }

    let parent: MirrorStateObject | MirrorState[] | undefined = undefined;
    let current: MirrorState = root;
    let key: string | number | undefined = undefined;

    for (let i = 0; i < path.length; i++) {
        const seg = path[i];
        // Parent should reflect the container we will index into at this step
        parent =
            isJSONArray(current) || isJSONObject(current)
                ? (current as MirrorStateObject | MirrorState[])
                : undefined;
        key = seg;

        if (typeof seg === "number") {
            if (Array.isArray(parent)) {
                current = parent[seg];
            } else {
                current = undefined;
            }
        } else if (typeof seg === "string") {
            let segKey = seg;
            if (parent && Array.isArray(parent) && isTreeID(seg)) {
                // Resolve by id anywhere in the tree (recursive), not just direct children
                const roots = parent;
                const loc = getTreeNodeLocation(roots, seg);
                if (loc) {
                    // If this TreeID is the final segment, treat it as the node's data map
                    if (i === path.length - 1) {
                        parent = loc.node;
                        key = "data";
                        current = getOrInitNodeData(loc.node);
                    } else {
                        // Otherwise, navigate into the node's data map for subsequent keys
                        const dataObj = getOrInitNodeData(loc.node);
                        current = dataObj;
                    }
                } else {
                    // Not found
                    current = undefined;
                }
            } else if (parent && !Array.isArray(parent)) {
                current = parent[segKey];
            } else {
                current = undefined;
            }
        } else {
            throw new Error(`Unsupported path segment: ${String(seg)}`);
        }
    }

    return { parent, key, node: current };
}

// Build or reuse a per-roots index to resolve a node by id quickly
// PERF: this can be slow
function getTreeNodeLocation(
    roots: MirrorState[],
    id: string,
): { list: MirrorState[]; index: number; node: MirrorStateObject } | undefined {
    let index = ROOTS_TREE_INDEX_CACHE.get(roots);
    if (!index) {
        index = buildTreeIndex(roots);
        ROOTS_TREE_INDEX_CACHE.set(roots, index);
    }
    let loc = index.get(id);
    if (!loc) {
        // If not found (e.g., structure changed earlier in this batch), rebuild once
        index = buildTreeIndex(roots);
        ROOTS_TREE_INDEX_CACHE.set(roots, index);
        loc = index.get(id);
    }
    return loc;
}

function buildTreeIndex(
    roots: MirrorState[],
): Map<
    string,
    { list: MirrorState[]; index: number; node: MirrorStateObject }
> {
    const map = new Map<
        string,
        { list: MirrorState[]; index: number; node: MirrorStateObject }
    >();

    // Depth-first traversal without using any
    const stack: Array<{ list: MirrorState[]; index: number }> = [];
    for (let i = 0; i < roots.length; i++) {
        stack.push({ list: roots, index: i });
    }

    while (stack.length) {
        const item = stack.pop()!;
        if ("list" in item) {
            const raw = item.list[item.index];
            if (!isJSONObject(raw)) continue;
            const node = raw;
            const idVal = node["id"];
            if (typeof idVal === "string") {
                map.set(idVal, { list: item.list, index: item.index, node });
            }
            const childrenVal = node["children"];
            if (Array.isArray(childrenVal)) {
                // push children entries
                for (let j = 0; j < childrenVal.length; j++) {
                    stack.push({ list: childrenVal, index: j });
                }
            }
        }
    }

    return map;
}

function getOrInitNodeData(node: MirrorStateObject): MirrorStateObject {
    const dataVal = node["data"];
    if (isJSONObject(dataVal)) return dataVal;
    const fresh: MirrorStateObject = {};
    node["data"] = fresh;
    return fresh;
}

// Normalize LoroTree JSON (with `meta`) to Mirror tree node shape `{ id, data, children }`.
function normalizeTreeJson(input: unknown[]): StateTreeNode[] {
    if (!Array.isArray(input)) return [];
    return input.map(mapRawTreeNode);
}

function mapRawTreeNode(n: unknown): StateTreeNode {
    const rawId = (n as { id?: unknown })?.id;
    const id = typeof rawId === "string" ? rawId : "";
    const meta = (n as { meta?: unknown })?.meta;
    const data = isJSONObject(meta) ? meta : {};
    const rawChildren = (n as { children?: unknown })?.children;
    const children = Array.isArray(rawChildren)
        ? rawChildren.map(mapRawTreeNode)
        : [];
    return { id, data, children };
}

/**
 * Apply Map updates to a plain object
 */
function applyMapDiff(
    targetObj: MirrorStateObject,
    updated: Record<string, unknown>,
    containerId: ContainerID,
    ignoreSet: Set<ContainerID>,
    containerToMirrorState?: (c: Container) => MirrorState,
    getSchemaForKey?: (
        containerId: ContainerID,
        mapKey?: string,
    ) => SchemaType | undefined,
) {
    if (!isJSONObject(targetObj)) return;
    for (const [k, v] of Object.entries(updated)) {
        // In Loro map diffs, `undefined` signals deletion. `null` is a valid value
        // and must be preserved.
        if (v === undefined) {
            delete targetObj[k];
            continue;
        }

        if (isContainer(v)) {
            const c = v;
            // Mark this child container so its own events are ignored later in this batch
            ignoreSet.add(c.id);
            targetObj[k] = containerToMirrorState
                ? containerToMirrorState(c)
                : containerToMirrorStateWithoutSchema(c);
            continue;
        }

        // Apply decode transform if schema exists for this field
        const fieldSchema = getSchemaForKey?.(containerId, k);
        targetObj[k] = applyDecode(fieldSchema, v) as MirrorState;
    }
}

/**
 * Apply a list delta to a JS array
 */
function applyListDelta(
    targetArr: MirrorState[],
    deltas: Array<{ insert?: unknown[]; delete?: number; retain?: number }>,
    containerId: ContainerID,
    ignoreSet: Set<ContainerID>,
    containerToMirrorState?: (c: Container) => MirrorState,
    getSchemaForKey?: (
        containerId: ContainerID,
        mapKey?: string,
    ) => SchemaType | undefined,
) {
    const itemSchema = getSchemaForKey?.(containerId);

    let index = 0;
    for (const d of deltas) {
        if (d.retain !== undefined) {
            index += d.retain;
        } else if (d.delete !== undefined) {
            const count = d.delete;
            if (count > 0) {
                targetArr.splice(index, count);
            }
        } else if (d.insert !== undefined) {
            const items = d.insert.map((it) => {
                if (isContainer(it)) {
                    const c = it;
                    // Mark this child container so its own events are ignored later in this batch
                    ignoreSet.add(c.id);
                    return containerToMirrorState
                        ? containerToMirrorState(c)
                        : containerToMirrorStateWithoutSchema(c);
                }
                // Apply decode transform if schema exists for list items
                return applyDecode(itemSchema, it) as MirrorState;
            });
            targetArr.splice(index, 0, ...items);
            index += items.length;
        }
    }
}

/**
 * Apply a tree diff to a JS array of nodes of shape { id, data, children }
 */
function applyTreeDiff(
    roots: MirrorState[],
    deltas: Array<
        | { action: "create"; target: TreeID; parent?: TreeID; index: number }
        | {
              action: "delete";
              target: TreeID;
              oldParent?: TreeID;
              oldIndex: number;
          }
        | {
              action: "move";
              target: TreeID;
              parent?: TreeID;
              index: number;
              oldParent?: TreeID;
              oldIndex: number;
          }
    >,
    treeId?: ContainerID,
    nodeDataWithCid?: (treeId: ContainerID) => boolean,
    getNodeDataCid?: (
        treeId: ContainerID,
        nodeId: TreeID,
    ) => string | undefined,
) {
    type Node = StateTreeNode;

    const getChildrenArray = (parent?: TreeID): Node[] => {
        if (!parent) return roots as unknown as Node[];
        const found = findNodeAndParent(roots as unknown as Node[], parent);
        return found ? found.node.children : (roots as unknown as Node[]);
    };

    for (const d of deltas) {
        if (d.action === "create") {
            const arr = getChildrenArray(d.parent);
            const node: Node = {
                id: d.target as string,
                data: {},
                children: [],
            };
            if (treeId && nodeDataWithCid?.(treeId)) {
                const cid = getNodeDataCid?.(treeId, d.target);
                if (cid) defineCidProperty(node.data, cid as ContainerID);
            }
            const idx = clampIndex(d.index, arr.length + 1);
            arr.splice(idx, 0, node);
        } else if (d.action === "delete") {
            const arr = getChildrenArray(d.oldParent);
            if (!arr) continue;
            const idx = clampIndex(d.oldIndex, arr.length);
            if (idx >= 0 && idx < arr.length) {
                arr.splice(idx, 1);
            } else {
                // fallback: search by id
                const pos = arr.findIndex((n) => n.id === d.target);
                if (pos >= 0) arr.splice(pos, 1);
            }
        } else if (d.action === "move") {
            // remove from old
            const fromArr = getChildrenArray(d.oldParent);
            const oldIdx = clampIndex(d.oldIndex, fromArr.length);
            let moved: Node | undefined;
            if (oldIdx >= 0 && oldIdx < fromArr.length) {
                moved = fromArr.splice(oldIdx, 1)[0];
            } else {
                const pos = fromArr.findIndex((n) => n.id === d.target);
                if (pos >= 0) moved = fromArr.splice(pos, 1)[0];
            }
            if (!moved) continue;
            const toArr = getChildrenArray(d.parent);
            // Use the target index as the final index in the destination
            const toIdx = clampIndex(d.index, toArr.length + 1);
            toArr.splice(toIdx, 0, moved);
        }
    }
}

function clampIndex(idx: number, len: number) {
    if (idx < 0) return 0;
    if (idx > len) return len;
    return idx;
}

function findNodeAndParent(
    roots: StateTreeNode[],
    id: string,
):
    | {
          parent: StateTreeNode | undefined;
          node: StateTreeNode;
      }
    | undefined {
    const stack: Array<{
        parent: StateTreeNode | undefined;
        list: StateTreeNode[];
    }> = [{ parent: undefined, list: roots }];
    while (stack.length) {
        const { parent, list } = stack.pop()!;
        for (let i = 0; i < list.length; i++) {
            const n = list[i];
            if (n && n.id === id) {
                return { parent, node: n };
            }
            if (n && Array.isArray(n.children)) {
                stack.push({ parent: n, list: n.children });
            }
        }
    }
    return undefined;
}

/**
 * Apply a text delta to a string value
 */
function applyTextDelta(
    base: string,
    deltas: Array<{ insert?: string; delete?: number; retain?: number }>,
): string {
    if (deltas.length === 0) {
        return base;
    }

    const original = base;
    let result = "";
    let sourceIndex = 0;

    for (const d of deltas) {
        if (d.retain !== undefined) {
            // Append the retained portion from the original string
            result += original.slice(sourceIndex, sourceIndex + d.retain);
            sourceIndex += d.retain;
        } else if (d.delete !== undefined) {
            // Skip the deleted portion by advancing sourceIndex without appending
            sourceIndex += d.delete;
        } else if (d.insert !== undefined) {
            // Insert new text without advancing sourceIndex
            result += d.insert ?? "";
        }
    }

    // Append any remaining text from the original string
    if (sourceIndex < original.length) {
        result += original.slice(sourceIndex);
    }

    return result;
}

// Helpers for JSON state manipulation
function setAt(
    parent: MirrorStateObject | MirrorState[],
    key: string | number,
    value: MirrorState,
) {
    if (Array.isArray(parent) && typeof key === "number") {
        parent[key] = value;
    } else if (!Array.isArray(parent) && typeof key === "string") {
        parent[key] = value;
    }
}

function getAt(
    parent: MirrorStateObject | MirrorState[],
    key: string | number,
): MirrorState | undefined {
    if (Array.isArray(parent) && typeof key === "number") {
        return parent[key];
    } else if (!Array.isArray(parent) && typeof key === "string") {
        return parent[key];
    }

    return undefined;
}

// Module-level cache: for each roots array, map TreeID -> node location
const ROOTS_TREE_INDEX_CACHE: WeakMap<
    MirrorState[],
    Map<string, { list: MirrorState[]; index: number; node: MirrorStateObject }>
> = new WeakMap();

// Convert a loro container into mirror JSON value consistently
function containerToMirrorStateWithoutSchema(c: Container): MirrorState {
    const kind = c.kind();
    if (kind === "Counter") {
        return (c as LoroCounter).getShallowValue() as unknown as MirrorState;
    }
    if (kind === "Tree") {
        const raw = (
            c as Exclude<Container, LoroCounter>
        ).toJSON() as unknown[];
        return normalizeTreeJson(raw) as unknown as MirrorState;
    }
    return (
        c as Exclude<Container, LoroCounter>
    ).toJSON() as unknown as MirrorState;
}

// Check if a target or any of its ancestors is in ignore set
function isIgnoredByAncestor(
    id: ContainerID,
    ignoreSet: Set<ContainerID>,
    getContainerById?: (id: ContainerID) => Container | undefined,
): boolean {
    if (ignoreSet.has(id)) return true;
    if (!getContainerById) return false;
    const start = getContainerById(id);
    let cur = start;
    // Walk up through parents; if any ancestor id is ignored, skip
    while (cur) {
        const p = cur.parent();
        if (!p) break;
        if (ignoreSet.has(p.id)) return true;
        cur = p;
    }
    return false;
}
