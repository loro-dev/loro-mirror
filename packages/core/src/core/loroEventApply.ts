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

// Plain JSON-like value held in Mirror state (no `any`)
type JSONPrimitive = string | number | boolean | null | undefined;
type JSONValue = JSONPrimitive | JSONObject | JSONValue[];
interface JSONObject {
    [k: string]: JSONValue;
}

function isJSONObject(v: unknown): v is JSONObject {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isJSONArray(v: unknown): v is JSONValue[] {
    return Array.isArray(v);
}

/**
 * Apply a Loro event batch to a JSON-like state object.
 * Returns a new state object (using immer) with deltas applied.
 */
export function applyEventBatchToState<T extends object>(
    currentState: T,
    event: LoroEventBatch,
): T {
    const next = produce<T>((draft) => {
        const ignoreSet = new Set<ContainerID>();
        for (const e of event.events) {
            applySingleEventToDraft(draft as JSONObject, e, ignoreSet);
        }
    })(currentState);
    return next;
}

/**
 * Apply a single event to the immer draft state
 */
function applySingleEventToDraft(draftRoot: JSONObject, e: LoroEvent, ignoreSet: Set<ContainerID>) {
    if (ignoreSet.has(e.target)) {
        return;
    }

    // Resolve the container node in state at the event path
    const { parent, key, node } = getParentKeyNodeByPath(draftRoot, e.path);

    // If target node is missing, initialize a neutral baseline for applying deltas
    let target: JSONValue | undefined = node;
    if (target === undefined) {
        if (e.diff.type === "map") {
            if (parent && key !== undefined) setAt(parent, key, {});
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "list") {
            if (parent && key !== undefined)
                setAt(parent, key, [] as JSONValue[]);
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "text") {
            if (parent && key !== undefined) setAt(parent, key, "");
            target =
                parent && key !== undefined ? getAt(parent, key)! : draftRoot;
        } else if (e.diff.type === "tree") {
            if (parent && key !== undefined) setAt(parent, key, [] as JSONValue[]);
            target = parent && key !== undefined ? getAt(parent, key)! : draftRoot;
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
                applyMapDiff(target, e.diff.updated);
            }
            break;
        case "list":
            if (!isJSONArray(target)) {
                // Initialize if not array
                if (parent && key !== undefined)
                    setAt(parent, key, [] as JSONValue[]);
                target = parent && key !== undefined ? getAt(parent, key)! : [];
            }
            if (isJSONArray(target)) {
                applyListDelta(target, e.diff.diff, ignoreSet);
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
                    setAt(parent, key, [] as JSONValue[]);
                target = parent && key !== undefined ? getAt(parent, key)! : [];
            }
            if (isJSONArray(target)) {
                applyTreeDiff(target, e.diff.diff);
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
 * Find parent object/array and the final key for a given path
 */
function getParentKeyNodeByPath(
    root: JSONObject,
    path: (string | number | TreeID)[],
): {
    parent: JSONObject | JSONValue[] | undefined;
    key: string | number | undefined;
    node: JSONValue | undefined;
} {
    if (!path || path.length === 0) {
        return { parent: undefined, key: undefined, node: root };
    }

    let parent: JSONObject | JSONValue[] | undefined = undefined;
    let current: JSONValue = root;
    let key: string | number | undefined = undefined;

    for (let i = 0; i < path.length; i++) {
        const seg = path[i];
        parent =
            isJSONArray(current) || isJSONObject(current)
                ? (current as JSONObject | JSONValue[])
                : undefined;
        key = typeof seg === "number" ? seg : (seg as string);

        if (typeof seg === "number") {
            if (Array.isArray(parent)) {
                current = parent[seg] as JSONValue;
            } else {
                current = undefined as unknown as JSONValue;
            }
        } else if (typeof seg === "string") {
            // Map `meta` -> `data` only when navigating inside a tree node object
            // (i.e., parent is a node with children/id fields). Avoid changing root keys like 'meta'.
            let segKey = seg;
            if (
                seg === "meta" &&
                parent &&
                !Array.isArray(parent) &&
                typeof (parent as any).children !== "undefined" &&
                typeof (parent as any).id !== "undefined"
            ) {
                segKey = "data";
            }
            if (parent && Array.isArray(parent)) {
                // When navigating a tree, seg may be a TreeID string; find by id in array
                const arr = parent as JSONValue[];
                const idx = (arr as any[]).findIndex((n) => n && (n as any).id === segKey);
                key = idx >= 0 ? idx : (key as any);
                current = idx >= 0 ? (arr[idx] as JSONValue) : (undefined as unknown as JSONValue);
            } else if (parent && !Array.isArray(parent)) {
                current = (parent as JSONObject)[segKey] as JSONValue;
            } else {
                current = undefined as unknown as JSONValue;
            }
        } else {
            throw new Error(`Unsupported path segment: ${seg}`);
        }
    }

    return { parent, key, node: current };
}

/**
 * Apply Map updates to a plain object
 */
function applyMapDiff(targetObj: JSONObject, updated: Record<string, unknown>) {
    if (!isJSONObject(targetObj)) return;
    for (const [k, v] of Object.entries(updated)) {
        // In Loro map diffs, `undefined` signals deletion. `null` is a valid value
        // and must be preserved.
        if (v === undefined) {
            delete targetObj[k];
            continue;
        }

        if (isContainer(v)) {
            // Initialize a neutral baseline; subsequent container events will populate.
            const kind = (v as Container).kind();
            if (kind === "Text") {
                targetObj[k] = "";
            } else if (kind === "List" || kind === "MovableList") {
                targetObj[k] = [] as JSONValue[];
            } else if (kind === "Map") {
                targetObj[k] = {} as JSONObject;
            } else if (kind === "Counter") {
                targetObj[k] = 0;
            } else if (kind === "Tree") {
                targetObj[k] = [] as JSONValue[];
            } else {
                // Fallback: leave as empty object
                targetObj[k] = {} as JSONObject;
            }
            continue;
        }

        targetObj[k] = v as JSONValue;
    }
}

/**
 * Apply a list delta to a JS array
 */
function applyListDelta(
    targetArr: JSONValue[],
    deltas: Array<{ insert?: unknown[]; delete?: number; retain?: number }>,
    ignoreSet: Set<ContainerID>,
) {
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
                    ignoreSet.add(it.id);
                    const c = it as Container;
                    const kind = c.kind();
                    if (kind === "Counter") return c.getShallowValue();
                    return (c as Exclude<Container, LoroCounter>).toJSON();
                }
                return it as JSONValue;
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
    roots: JSONValue[],
    deltas: Array<
        | { action: "create"; target: TreeID; parent?: TreeID; index: number }
        | { action: "delete"; target: TreeID; oldParent?: TreeID; oldIndex: number }
        | {
              action: "move";
              target: TreeID;
              parent?: TreeID;
              index: number;
              oldParent?: TreeID;
              oldIndex: number;
          }
    >,
) {
    type Node = { id: string; data: JSONObject; children: Node[] };

    const getChildrenArray = (parent?: TreeID): Node[] => {
        if (!parent) return (roots as unknown as Node[]);
        const found = findNodeAndParent(roots as unknown as Node[], parent);
        return found ? found.node.children : (roots as unknown as Node[]);
    };

    for (const d of deltas) {
        if (d.action === "create") {
            const arr = getChildrenArray(d.parent);
            const node: Node = { id: d.target as string, data: {}, children: [] };
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
                const pos = arr.findIndex((n) => (n as any).id === d.target);
                if (pos >= 0) arr.splice(pos, 1);
            }
        } else if (d.action === "move") {
            // remove from old
            const fromArr = getChildrenArray(d.oldParent);
            const oldIdx = clampIndex(d.oldIndex, fromArr.length);
            let moved: JSONValue | undefined;
            if (oldIdx >= 0 && oldIdx < fromArr.length) {
                moved = fromArr.splice(oldIdx, 1)[0];
            } else {
                const pos = fromArr.findIndex((n) => (n as any).id === d.target);
                if (pos >= 0) moved = fromArr.splice(pos, 1)[0];
            }
            if (!moved) continue;
            const toArr = getChildrenArray(d.parent);
            let idx = d.index;
            if (d.oldParent === d.parent && oldIdx < d.index) {
                // After removing, target index shifts left by 1
                idx = d.index - 1;
            }
            const toIdx = clampIndex(idx, toArr.length + 1);
            toArr.splice(toIdx, 0, moved as unknown as Node);
        }
    }
}

function clampIndex(idx: number, len: number) {
    if (idx < 0) return 0;
    if (idx > len) return len;
    return idx;
}

function findNodeAndParent(
    roots: { id: string; children?: any[] }[],
    id: string,
): { parent: { children: any[] } | undefined; node: { id: string; children: any[] } } | undefined {
    const stack: Array<{ parent: any; list: any[] }> = [
        { parent: undefined, list: roots },
    ];
    while (stack.length) {
        const { parent, list } = stack.pop()!;
        for (let i = 0; i < list.length; i++) {
            const n = list[i];
            if (n && (n as any).id === id) {
                return { parent, node: n } as any;
            }
            if (n && Array.isArray((n as any).children)) {
                stack.push({ parent: n, list: (n as any).children });
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
    parent: JSONObject | JSONValue[],
    key: string | number,
    value: JSONValue,
) {
    if (Array.isArray(parent) && typeof key === "number") {
        parent[key] = value;
    } else if (!Array.isArray(parent) && typeof key === "string") {
        (parent as JSONObject)[key] = value;
    }
}

function getAt(
    parent: JSONObject | JSONValue[],
    key: string | number,
): JSONValue | undefined {
    if (Array.isArray(parent) && typeof key === "number") {
        return parent[key] as JSONValue;
    } else if (!Array.isArray(parent) && typeof key === "string") {
        return (parent as JSONObject)[key] as JSONValue;
    }

    return undefined;
}
