/**
 * Utility functions for Loro Mirror core
 */

import { Container, ContainerID, ContainerType, LoroDoc } from "loro-crdt";
import {
    EqualityStrategy,
    SchemaType,
    TransformDefinition,
} from "../schema/index.js";
import { getChildSchema } from "../schema/resolver.js";
import { Change, InferContainerOptions } from "./mirror.js";
import { CID_KEY } from "../constants.js";
import {
    inferContainerTypeFromValue as inferLoroContainerTypeFromValue,
    inferSchemaContainerTypeFromValue,
    isPlainObjectValue,
    matchesContainerType,
} from "./container-inference.js";

/**
 * Schema type with transform property.
 */
export type SchemaWithTransform = SchemaType & {
    transform: TransformDefinition<unknown, unknown>;
};

/**
 * Check if a schema has a transform.
 * Distinguishes between the .transform() builder method (function) and an actual
 * TransformDefinition object (with decode/encode functions).
 */
export function hasTransform(
    schema: SchemaType | undefined,
): schema is SchemaWithTransform {
    if (schema === undefined) return false;
    // typeof check distinguishes a TransformDefinition object from the .transform() builder method (function)
    const t = (schema as { transform?: unknown }).transform;
    return t != null && typeof t === "object";
}

/**
 * Get the transform from a schema, or undefined if none exists.
 */
export function getTransform(
    schema: SchemaType | undefined,
): TransformDefinition<unknown, unknown> | undefined {
    if (hasTransform(schema)) {
        return schema.transform;
    }
    return undefined;
}

/**
 * Get the effective equality strategy for a transform.
 * Default: "reference-equality"
 */
export function getEqualityStrategy(
    schema: SchemaType | undefined,
    strategyIfNotTransformable: EqualityStrategy<unknown>,
): EqualityStrategy<unknown> {
    const transform = getTransform(schema);
    if (!transform) return strategyIfNotTransformable;
    return transform.isEqual ?? "reference-equality";
}

/**
 * Apply decode transform to a CRDT value.
 * Null/undefined pass through as-is - transform is only called for real values.
 */
export function applyDecode(
    schema: SchemaType | undefined,
    crdtValue: unknown,
): unknown {
    if (crdtValue === null || crdtValue === undefined) {
        return crdtValue;
    }
    const transform = getTransform(schema);
    return transform ? transform.decode(crdtValue) : crdtValue;
}

/**
 * Recursively decode JSON values using schema transforms.
 * Mutates in-place. Used for snapshot initialization where toJSON() skips decode.
 */
export function decodeNestedJsonValues(
    json: unknown,
    schema: SchemaType | undefined,
): unknown {
    if (json === null || json === undefined || !schema) return json;

    switch (schema.type) {
        case "loro-map": {
            if (!isObject(json)) return json;
            for (const key of Object.keys(json)) {
                const fieldSchema = getChildSchema(schema, key);
                json[key] = decodeNestedJsonValues(json[key], fieldSchema);
            }
            return json;
        }
        case "loro-list":
        case "loro-movable-list": {
            if (!Array.isArray(json)) return json;
            const itemSchema = getChildSchema(schema);
            for (let i = 0; i < json.length; i++) {
                json[i] = decodeNestedJsonValues(json[i], itemSchema);
            }
            return json;
        }
        case "loro-tree": {
            if (!Array.isArray(json)) return json;
            const nodeSchema = getChildSchema(schema);
            const walk = (nodes: unknown[]) => {
                for (const node of nodes) {
                    if (node != null && typeof node == "object") {
                        if ("data" in node && node.data !== undefined) {
                            node.data = decodeNestedJsonValues(
                                node.data,
                                nodeSchema,
                            );
                        }
                        if (
                            "children" in node &&
                            Array.isArray(node.children)
                        ) {
                            walk(node.children);
                        }
                    }
                }
            };
            walk(json);
            return json;
        }
        case "loro-text":
        case "ignore":
            return json;
        default:
            return applyDecode(schema, json);
    }
}

/**
 * Apply encode transform to a domain value.
 * Null/undefined pass through as-is - transform is only called for real values.
 */
export function applyEncode(
    schema: SchemaType | undefined,
    domainValue: unknown,
): unknown {
    if (domainValue === null || domainValue === undefined) {
        return domainValue;
    }
    const transform = getTransform(schema);
    return transform ? transform.encode(domainValue) : domainValue;
}

/**
 * Check if two domain values are equal according to the schema's equality strategy.
 *
 * Reference equality is always checked first (performance optimization).
 * If refs match, returns true (no change).
 * If refs differ, behavior depends on isEqual setting.
 */
export function valuesEqual(
    schema: SchemaType | undefined,
    oldValue: unknown,
    newValue: unknown,
    strategyIfNotTransformable: EqualityStrategy<unknown>,
): boolean {
    if (oldValue === newValue) {
        return true;
    }

    const strategy = getEqualityStrategy(schema, strategyIfNotTransformable);

    if (strategy === "reference-equality") {
        return false;
    } else if (strategy === "encoded-value-equality") {
        const encodedOld = applyEncode(schema, oldValue);
        const encodedNew = applyEncode(schema, newValue);
        return encodedOld === encodedNew;
    } else if (strategy === "deep-equality") {
        return deepEqual(oldValue, newValue);
    } else {
        return strategy(oldValue, newValue);
    }
}

export function defineCidProperty(target: unknown, cid: ContainerID) {
    if (
        !isObject(target) ||
        Object.prototype.hasOwnProperty.call(target, CID_KEY)
    )
        return;
    Object.defineProperty(target, CID_KEY, { value: cid });
}

/**
 * Restore the read-only `$cid` contract on a freshly produced state.
 *
 * `defineCidProperty` stamps `$cid` as `{ writable: false, enumerable: false,
 * configurable: false }`. Immer's `useStrictShallowCopy` preserves the descriptor, but it
 * deliberately rewrites every non-writable data property to `{ writable: true,
 * configurable: true }` so the draft stays mutable — which would leave `$cid` writable on
 * every object Immer copied, letting callers reassign a published `$cid`.
 *
 * Two things keep this proportional to what Immer actually copied rather than to the size
 * of the state:
 *
 * - `prev` is the state `produce` was called with, and Immer shares everything it did not
 *   copy, so a subtree reference-equal to `prev` cannot have been touched.
 * - An already-locked `$cid` means this object was not copied this round, so its children
 *   are the same references they were when it was last hardened and are locked too. This
 *   is what makes a reorder cheap: moved items are shared references that land at a new
 *   index, so `prev` no longer lines up with them, but they are still locked.
 */
export function hardenCidDescriptors(
    next: unknown,
    prev: unknown,
    visited?: Set<unknown>,
): void {
    if (next === prev) return;

    if (Array.isArray(next)) {
        // `schema.Ignore()` may hold arbitrary user objects, including cyclic ones.
        // Hardening depends only on `next`, so visiting an object once is enough and a
        // persistent set both terminates cycles and skips re-walking shared subgraphs.
        if ((visited ??= new Set()).has(next)) return;
        visited.add(next);
        const prevArr = Array.isArray(prev) ? prev : undefined;
        for (let i = 0; i < next.length; i++) {
            hardenCidDescriptors(next[i], prevArr?.[i], visited);
        }
        return;
    }

    if (!isObject(next)) return;

    const descriptor = Object.getOwnPropertyDescriptor(next, CID_KEY);
    if (descriptor) {
        // Already locked: this object was not copied this round, so its subtree is
        // untouched and was hardened when the object itself was. Returning before
        // touching `visited` keeps a reorder off the set entirely -- moved items are
        // exactly this case, and they are the bulk of the walk.
        if (!descriptor.configurable) return;
        if ("value" in descriptor) {
            Object.defineProperty(next, CID_KEY, {
                value: descriptor.value,
                writable: false,
                enumerable: false,
                configurable: false,
            });
        }
    }

    // Every object that recurses is registered first, so cycles still terminate. Objects
    // that carry a `$cid` are additionally covered by the locked check above: a second
    // visit finds the descriptor locked and returns.
    if ((visited ??= new Set()).has(next)) return;
    visited.add(next);

    const prevObj = isObject(prev) ? prev : undefined;
    for (const key of Object.keys(next)) {
        hardenCidDescriptors(next[key], prevObj?.[key], visited);
    }
}

/**
 * Check if a value is an object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
    return isPlainObjectValue(value);
}

// Keys that could cause prototype pollution if assigned directly
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively removes undefined values from an object.
 * This treats undefined values as non-existent fields.
 * Preserves non-enumerable properties like $cid.
 * Returns the original object if no undefined values are found.
 * Protects against prototype pollution by skipping unsafe keys.
 */
export function stripUndefined<T>(value: T): T {
    return stripUndefinedInner(value, 0, undefined);
}

/**
 * Depth at which we start recording the recursion path to detect cycles.
 *
 * This runs over the whole state on every `setState`, and tracking every node costs more
 * than the stripping itself. Mirror state is a tree whose depth follows the schema, so a
 * real state never gets near this; only a cycle recurses without bound. Once the path is
 * being recorded, any cycle revisits one of its own nodes within a single lap, so starting
 * late still terminates.
 */
const CYCLE_GUARD_DEPTH = 64;

/**
 * Placeholder for a key that must not reach the rebuilt object: an unsafe key, or one whose
 * value is `undefined` and is therefore treated as a non-existent field.
 */
const DROPPED = Symbol("dropped");

function stripUndefinedInner<T>(
    value: T,
    depth: number,
    path: Set<unknown> | undefined,
): T {
    if (value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        // A cycle can only be introduced through `schema.Ignore()` values, which are never
        // written to Loro. Leave such a subgraph exactly as it is rather than recursing
        // into it forever.
        if (depth >= CYCLE_GUARD_DEPTH) {
            if ((path ??= new Set()).has(value)) return value;
            path.add(value);
        }
        let hasChanges = false;
        const result = value.map((item) => {
            const stripped = stripUndefinedInner(item, depth + 1, path);
            if (stripped !== item) hasChanges = true;
            return stripped;
        });
        path?.delete(value);
        return hasChanges ? (result as T) : value;
    }
    if (isObject(value)) {
        if (depth >= CYCLE_GUARD_DEPTH) {
            if ((path ??= new Set()).has(value)) return value;
            path.add(value);
        }
        // Check if any enumerable property is undefined or needs stripping.
        //
        // Most objects need neither, so the rebuilt-value bookkeeping stays as cheap as it
        // can be: a positional array rather than a `Map`, since this walks the whole state
        // on every `setState`. The values are recorded as they are read instead of being
        // re-read below, because a `schema.Ignore()` field may hold an arbitrary user
        // object, and reading an accessor twice would both run its getter twice and store
        // the second, un-stripped read.
        const keys = Object.keys(value);
        const strippedValues: unknown[] = Array.from({ length: keys.length });
        let changed = false;

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            // Skip unsafe keys to prevent prototype pollution. This alone does not force a
            // rebuild: an object whose only oddity is an unsafe key is returned untouched,
            // as it was before.
            if (UNSAFE_KEYS.has(key)) {
                strippedValues[i] = DROPPED;
                continue;
            }
            const val = value[key];
            if (val === undefined) {
                strippedValues[i] = DROPPED;
                changed = true;
                continue;
            }
            const stripped = stripUndefinedInner(val, depth + 1, path);
            strippedValues[i] = stripped;
            if (stripped !== val) {
                changed = true;
            }
        }
        path?.delete(value);

        // If no changes needed, return original object
        if (!changed) {
            return value;
        }

        // Use Object.create(null) to avoid prototype pollution
        const result = Object.create(null) as Record<string, unknown>;
        // Copy non-enumerable properties (like $cid) first
        const allProps = Object.getOwnPropertyNames(value);
        for (const key of allProps) {
            // Skip unsafe keys
            if (UNSAFE_KEYS.has(key)) {
                continue;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && !descriptor.enumerable) {
                Object.defineProperty(result, key, descriptor);
            }
        }
        // Copy the stripped values using Object.defineProperty to be safe. Walking `keys`
        // keeps the original `Object.keys` order.
        for (let i = 0; i < keys.length; i++) {
            const val = strippedValues[i];
            if (val === DROPPED) {
                continue;
            }
            Object.defineProperty(result, keys[i], {
                value: val,
                writable: true,
                enumerable: true,
                configurable: true,
            });
        }
        return result as T;
    }
    return value;
}

/**
 * Performs a deep equality check between two values
 */
export function deepEqual(a: unknown, b: unknown): boolean {
    // Check if both values are the same reference or primitive equality
    if (a === b) return true;

    // If either value is null or not an object or function, they can't be deeply equal unless they were strictly equal (checked above)
    if (
        a === null ||
        b === null ||
        (typeof a !== "object" && typeof a !== "function") ||
        (typeof b !== "object" && typeof b !== "function")
    ) {
        return false;
    }

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;

        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }

        return true;
    }
    // Handle Date objects
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    // Handle RegExp objects
    if (a instanceof RegExp && b instanceof RegExp) {
        return a.toString() === b.toString();
    }

    // Handle other objects
    if (!Array.isArray(a) && !Array.isArray(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (
                !deepEqual(
                    (a as Record<string, unknown>)[key],
                    (b as Record<string, unknown>)[key],
                )
            )
                return false;
        }

        return true;
    }

    return false;
}

/**
 * Recursively compare the `$cid` markers of two state trees.
 *
 * `deepEqual` only walks enumerable keys, so it cannot see `$cid` (which is stamped as a
 * non-enumerable descriptor). Used by `Mirror.checkStateConsistency` so that a tampered
 * or stale `$cid` is reported as a divergence instead of silently sitting in the state.
 * Only the markers are compared here; value equality is `deepEqual`'s job.
 */
export function cidsEqual(
    a: unknown,
    b: unknown,
    seen?: Map<unknown, Set<unknown>>,
): boolean {
    // Identical references share every `$cid` below them. This also short-circuits
    // `schema.Ignore()` values, which `buildRootStateSnapshot` carries over by reference
    // and which may be arbitrary user objects, including cyclic ones.
    if (a === b) return true;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        const marks = markSeen(a, b, (seen ??= new Map()));
        if (marks === "seen") return true;
        for (let i = 0; i < a.length; i++) {
            if (!cidsEqual(a[i], b[i], seen)) return false;
        }
        return true;
    }

    if (!isObject(a) || !isObject(b)) return true;

    if (a[CID_KEY] !== b[CID_KEY]) return false;

    // Two distinct but mutually cyclic graphs would otherwise recurse forever; treat a
    // pair already under comparison as equal, the usual deep-comparison convention.
    if (markSeen(a, b, (seen ??= new Map())) === "seen") return true;

    for (const key of Object.keys(a)) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
        if (!cidsEqual(a[key], b[key], seen)) return false;
    }

    return true;
}

function markSeen(
    a: unknown,
    b: unknown,
    seen: Map<unknown, Set<unknown>>,
): "seen" | "new" {
    let partners = seen.get(a);
    if (!partners) {
        partners = new Set();
        seen.set(a, partners);
    }
    if (partners.has(b)) return "seen";
    partners.add(b);
    return "new";
}

/**
 * Get a value from a nested object using a path array
 */
export function getPathValue(
    obj: Record<string, unknown>,
    path: string[],
): unknown {
    let current: unknown = obj;

    for (let i = 0; i < path.length; i++) {
        if (current === undefined || current === null) return undefined;

        const key = path[i];
        if (typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
    }

    return current;
}

/**
 * Set a value in a nested object using a path array
 * Note: This modifies the object directly (intended for use with Immer)
 */
export function setPathValue(
    obj: Record<string, unknown>,
    path: string[],
    value: unknown,
): void {
    if (path.length === 0) return;

    let current: Record<string, unknown> = obj;
    const lastIndex = path.length - 1;

    for (let i = 0; i < lastIndex; i++) {
        const key = path[i];

        // Create nested objects if they don't exist
        if (
            current[key] === undefined ||
            current[key] === null ||
            typeof current[key] !== "object"
        ) {
            current[key] = {};
        }

        current = current[key] as Record<string, unknown>;
    }

    // Set the value at the final path
    const lastKey = path[lastIndex];
    if (value === undefined) {
        delete current[lastKey];
    } else {
        current[lastKey] = value;
    }
}

type ContainerValue = {
    cid: string;
    value: unknown;
};

export function valueIsContainer(value: unknown): value is ContainerValue {
    return (
        value != null &&
        typeof value === "object" &&
        "cid" in value &&
        "value" in value
    );
}

export function valueIsContainerOfType(
    value: unknown,
    containerType: string,
): value is ContainerValue {
    return valueIsContainer(value) && value.cid.endsWith(containerType);
}

export function containerIdToContainerType(
    containerId: ContainerID,
): ContainerType | undefined {
    const parts = containerId.split(":");
    return parts[parts.length - 1] as ContainerType;
}

export function getRootContainerByType(
    doc: LoroDoc,
    key: string,
    type: ContainerType,
): Container {
    if (type === "Text") {
        return doc.getText(key);
    } else if (type === "List") {
        return doc.getList(key);
    } else if (type === "MovableList") {
        return doc.getMovableList(key);
    } else if (type === "Map") {
        return doc.getMap(key);
    } else if (type === "Tree") {
        return doc.getTree(key);
    } else {
        throw new Error();
    }
}

/* Insert a child change to a map */
export function insertChildToMap(
    containerId: ContainerID | "",
    key: string,
    value: unknown,
    inferOptions?: InferContainerOptions,
): Change {
    const ct = tryInferContainerType(value, inferOptions);
    if (ct) {
        return {
            container: containerId,
            key,
            value,
            kind: "insert-container",
            childContainerType: ct,
        };
    }

    return {
        container: containerId,
        key,
        value,
        kind: "insert",
    };
}

/* Try to update a change to insert a container */
export function tryUpdateToContainer(
    change: Change,
    toUpdate: boolean,
    schema: SchemaType | undefined,
    inferOptions?: InferContainerOptions,
): Change {
    if (!toUpdate) {
        return change;
    }

    if (change.kind !== "insert" && change.kind !== "set") {
        return change;
    }

    const effectiveInferOptions = applySchemaToInferOptions(
        schema,
        inferOptions,
    );
    const containerType = schema
        ? (schemaToContainerType(schema) ??
          tryInferContainerType(change.value, effectiveInferOptions))
        : tryInferContainerType(change.value, effectiveInferOptions);

    // If containerType is nullish, or schema has a transform (in which case we shouldn't infer container type),
    // apply encode transform if it exists and return change
    if (containerType == null || (schema && hasTransform(schema))) {
        const encodedValue = applyEncode(schema, change.value);
        return encodedValue !== change.value
            ? {
                  ...change,
                  value: encodedValue,
              }
            : change;
    }

    if (change.kind === "insert") {
        return {
            container: change.container,
            key: change.key,
            value: change.value,
            kind: "insert-container",
            childContainerType: containerType,
        };
    }

    if (change.kind === "set") {
        return {
            container: change.container,
            key: change.key,
            value: change.value,
            kind: "set-container",
            childContainerType: containerType,
        };
    }

    return change;
}

/* Get container type from schema */
export function schemaToContainerType(
    schema: SchemaType,
): ContainerType | undefined {
    const containerType = schema.getContainerType();
    return containerType === null ? undefined : containerType;
}

/* Try to infer container type from value */
export function tryInferContainerType(
    value: unknown,
    defaults?: InferContainerOptions,
): ContainerType | undefined {
    return inferLoroContainerTypeFromValue(value, defaults);
}

export function applySchemaToInferOptions(
    schema: SchemaType | undefined,
    base: InferContainerOptions | undefined,
): InferContainerOptions | undefined {
    if (!schema || schema.type !== "any") return base;
    const next: InferContainerOptions = { ...base };
    next.defaultLoroText = schema.options.defaultLoroText ?? false;
    if (schema.options.defaultMovableList !== undefined) {
        next.defaultMovableList = schema.options.defaultMovableList;
    }
    return next;
}

/* Check if value is of a given container type */
export function isValueOfContainerType(
    containerType: ContainerType,
    value: unknown,
): boolean {
    return matchesContainerType(containerType, value);
}

/* Infer container type from value */
export function inferContainerTypeFromValue(
    value: unknown,
    defaults?: InferContainerOptions,
): "loro-map" | "loro-list" | "loro-text" | "loro-movable-list" | undefined {
    return inferSchemaContainerTypeFromValue(value, defaults);
}

export type ObjectLike = Record<string, unknown>;
export type ArrayLike = Array<unknown>;

/* Check if value is an object */
export function isObjectLike(value: unknown): value is ObjectLike {
    return typeof value === "object";
}

/* Check if value is an array */
export function isArrayLike(value: unknown): value is ArrayLike {
    return Array.isArray(value);
}

/* Check if value is a string */
export function isStringLike(value: unknown): value is string {
    return typeof value === "string";
}

/* Type guard to ensure state and schema are of the correct type */
export function isStateAndSchemaOfType<
    S extends ObjectLike | ArrayLike | string,
    T extends SchemaType,
>(
    values: {
        oldState: unknown;
        newState: unknown;
        schema: SchemaType | undefined;
    },
    stateGuard: (value: unknown) => value is S,
    schemaGuard: (schema: SchemaType) => schema is T,
): values is { oldState: S; newState: S; schema: T | undefined } {
    return (
        stateGuard(values.oldState) &&
        stateGuard(values.newState) &&
        (!values.schema || schemaGuard(values.schema))
    );
}

export function isTreeID(id: unknown): boolean {
    if (!(typeof id === "string")) return false;
    const r = /[0-9]+@[0-9]+/;
    return !!id.match(r);
}

/**
 * Stringify a value safely, handling non-JSON-serializable types.
 * Handles BigInt, Date, RegExp, functions, and custom objects.
 */
export function safeStringify(value: unknown, indent = 2): string {
    const seen = new WeakSet<object>();

    function replacer(val: unknown): unknown {
        // Handle primitives
        if (val === null || val === undefined) return val;
        if (
            typeof val === "string" ||
            typeof val === "number" ||
            typeof val === "boolean"
        ) {
            return val;
        }

        // Handle BigInt
        if (typeof val === "bigint") {
            return `[BigInt: ${val.toString()}]`;
        }

        // Handle functions
        if (typeof val === "function") {
            return `[Function: ${val.name || "anonymous"}]`;
        }

        // Handle symbols
        if (typeof val === "symbol") {
            return `[Symbol: ${val.description || ""}]`;
        }

        // Handle objects
        if (typeof val === "object") {
            // Check for circular references
            if (seen.has(val)) {
                return "[Circular]";
            }
            seen.add(val);

            // Handle Date
            if (val instanceof Date) {
                return `[Date: ${val.toISOString()}]`;
            }

            // Handle RegExp
            if (val instanceof RegExp) {
                return `[RegExp: ${val.toString()}]`;
            }

            // Handle Error
            if (val instanceof Error) {
                return `[Error: ${val.message}]`;
            }

            // Handle Arrays
            if (Array.isArray(val)) {
                return val.map(replacer);
            }

            // Handle plain objects
            const result: Record<string, unknown> = {};
            for (const key of Object.keys(val)) {
                result[key] = replacer((val as Record<string, unknown>)[key]);
            }
            return result;
        }

        return Object.prototype.toString.call(val);
    }

    return JSON.stringify(replacer(value), null, indent);
}
