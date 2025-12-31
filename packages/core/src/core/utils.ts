/**
 * Utility functions for Loro Mirror core
 */

import { Container, ContainerID, ContainerType, LoroDoc } from "loro-crdt";
import { SchemaType } from "../schema/index.js";
import { Change, InferContainerOptions } from "./mirror.js";
import { CID_KEY } from "../constants.js";

export function defineCidProperty(target: unknown, cid: ContainerID) {
    if (
        !isObject(target) ||
        Object.prototype.hasOwnProperty.call(target, CID_KEY)
    )
        return;
    Object.defineProperty(target, CID_KEY, { value: cid });
}

/**
 * Check if a value is an object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !(value instanceof RegExp) &&
        typeof value !== "function"
    );
}

/**
 * Recursively removes undefined values from an object.
 * This treats undefined values as non-existent fields.
 * Preserves non-enumerable properties like $cid.
 * Returns the original object if no undefined values are found.
 */
export function stripUndefined<T>(value: T): T {
    if (value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        let hasChanges = false;
        const result = value.map((item) => {
            const stripped = stripUndefined(item);
            if (stripped !== item) hasChanges = true;
            return stripped;
        });
        return hasChanges ? (result as T) : value;
    }
    if (isObject(value)) {
        // Check if any enumerable property is undefined or needs stripping
        let hasUndefined = false;
        let hasNestedChanges = false;
        const strippedValues: Record<string, unknown> = {};

        for (const key of Object.keys(value)) {
            const val = value[key];
            if (val === undefined) {
                hasUndefined = true;
            } else {
                const stripped = stripUndefined(val);
                strippedValues[key] = stripped;
                if (stripped !== val) {
                    hasNestedChanges = true;
                }
            }
        }

        // If no changes needed, return original object
        if (!hasUndefined && !hasNestedChanges) {
            return value;
        }

        const result: Record<string, unknown> = {};
        // Copy non-enumerable properties (like $cid) first
        const allProps = Object.getOwnPropertyNames(value);
        for (const key of allProps) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && !descriptor.enumerable) {
                Object.defineProperty(result, key, descriptor);
            }
        }
        // Copy the stripped values
        for (const key of Object.keys(strippedValues)) {
            result[key] = strippedValues[key];
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
    return containerId.split(":")[2] as ContainerType;
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

    const effectiveInferOptions = applySchemaToInferOptions(schema, inferOptions);
    const containerType = schema
        ? (schemaToContainerType(schema) ??
          tryInferContainerType(change.value, effectiveInferOptions))
        : tryInferContainerType(change.value, effectiveInferOptions);

    if (containerType == null) {
        return change;
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
    if (isObject(value)) {
        return "Map";
    } else if (Array.isArray(value)) {
        if (defaults?.defaultMovableList) {
            return "MovableList";
        }
        return "List";
    } else if (typeof value === "string") {
        if (defaults?.defaultLoroText) {
            return "Text";
        } else {
            return;
        }
    }
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
    switch (containerType) {
        case "MovableList":
        case "List":
            return typeof value === "object" && Array.isArray(value);
        case "Map":
            return isObject(value);
        case "Text":
            return typeof value === "string" && value !== null;
        case "Tree":
            return typeof value === "object" && Array.isArray(value);
        default:
            return false;
    }
}

/* Infer container type from value */
export function inferContainerTypeFromValue(
    value: unknown,
    defaults?: InferContainerOptions,
): "loro-map" | "loro-list" | "loro-text" | "loro-movable-list" | undefined {
    if (isObject(value)) {
        return "loro-map";
    } else if (Array.isArray(value)) {
        if (defaults?.defaultMovableList) {
            return "loro-movable-list";
        }
        return "loro-list";
    } else if (typeof value === "string") {
        if (defaults?.defaultLoroText) {
            return "loro-text";
        }
    } else {
        return;
    }
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
