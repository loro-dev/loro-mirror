import { produce } from "immer";
import {
    Container,
    isContainer,
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
        for (const e of event.events) {
            applySingleEventToDraft(draft as JSONObject, e);
        }
    })(currentState);
    return next;
}

/**
 * Apply a single event to the immer draft state
 */
function applySingleEventToDraft(draftRoot: JSONObject, e: LoroEvent) {
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
            console.error("Tree diffs are not supported yet.");
            return;
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
                applyListDelta(target, e.diff.diff);
            }
            break;
        case "text": {
            const base = typeof target === "string" ? target : "";
            const next = applyTextDelta(base, e.diff.diff);
            if (parent && key !== undefined) setAt(parent, key, next);
            break;
        }
        case "tree":
            console.error("Tree diffs are not supported yet.");
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
            if (parent && !Array.isArray(parent)) {
                current = (parent as JSONObject)[seg] as JSONValue;
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
                console.error("Tree diffs are not supported yet.");
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
                    const c = it as Container;
                    const kind = c.kind();
                    // Initialize neutral baseline; specific container diff events in the
                    // same batch will populate the content, preventing double-apply.
                    if (kind === "Text") return "" as JSONValue;
                    if (kind === "List" || kind === "MovableList")
                        return [] as JSONValue[];
                    if (kind === "Map") return {} as JSONObject;
                    if (kind === "Counter") return 0 as JSONValue;
                    if (kind === "Tree") return [] as JSONValue[];
                    return {} as JSONObject;
                }
                return it as JSONValue;
            });
            targetArr.splice(index, 0, ...items);
            index += items.length;
        }
    }
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
