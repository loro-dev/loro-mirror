/**
 * Utility functions for Loro Mirror core
 */

import { ContainerID, ContainerType } from "loro-crdt";

/**
 * Check if a value is an object
 */
export function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && 
           !(value instanceof Date) && !(value instanceof RegExp) && !(value instanceof Function);
}

/**
 * Performs a deep equality check between two values
 */
export function deepEqual(a: unknown, b: unknown): boolean {
    // Check if both values are the same reference or primitive equality
    if (a === b) return true;

    // If either value is null or not an object or function, they can't be deeply equal unless they were strictly equal (checked above)
    if (
        a === null || b === null ||
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
        const keysA = Object.keys(a as object);
        const keysB = Object.keys(b as object);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (
                !deepEqual(
                    (a as Record<string, unknown>)[key],
                    (b as Record<string, unknown>)[key],
                )
            ) return false;
        }

        return true;
    }

    return false;
}

/**
 * Get a value from a nested object using a path array
 */
export function getPathValue(obj: Record<string, any>, path: string[]): any {
    let current = obj;

    for (let i = 0; i < path.length; i++) {
        if (current === undefined || current === null) return undefined;

        const key = path[i];
        current = current[key];
    }

    return current;
}

/**
 * Set a value in a nested object using a path array
 * Note: This modifies the object directly (intended for use with Immer)
 */
export function setPathValue(
    obj: Record<string, any>,
    path: string[],
    value: any,
): void {
    if (path.length === 0) return;

    let current = obj;
    const lastIndex = path.length - 1;

    for (let i = 0; i < lastIndex; i++) {
        const key = path[i];

        // Create nested objects if they don't exist
        if (
            current[key] === undefined || current[key] === null ||
            typeof current[key] !== "object"
        ) {
            current[key] = {};
        }

        current = current[key];
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
    value: any;
};

export function valueIsContainer(value: any): value is ContainerValue {
    return value && typeof value === "object" && "cid" in value && "value" in value;
}

export function valueIsContainerOfType(
    value: any,
    containerType: string,
): value is ContainerValue {
    return valueIsContainer(value) && value.cid.endsWith(containerType);
}

/** should extract only id from idx:5, id:cid:28@10033875429761443547:Map should be cid:28@10033875429761443547:Map */
export function containerIdWithoutIndex(containerId: string): string {
    const index = containerId.indexOf(":");
    if (index === -1) {
        return containerId;
    }
    return containerId.substring(0, index);
}

export function containerIdToContainerType(containerId: ContainerID): ContainerType | undefined {

    if (containerId.endsWith(":Map")) {
        return "Map";
    } else if (containerId.endsWith(":List")) {
        return "List";
    } else if (containerId.endsWith(":Text")) {
        return "Text";
    } else if (containerId.endsWith(":MovableList")) {
        return "MovableList";
    } else {
        return undefined;
    }
}
