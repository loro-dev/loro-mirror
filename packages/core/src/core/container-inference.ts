import { ContainerType } from "loro-crdt";
import type { InferContainerOptions } from "../schema/types.js";

export type SchemaContainerTypeName =
    | "loro-map"
    | "loro-list"
    | "loro-text"
    | "loro-movable-list";

type InferableContainerType = Exclude<ContainerType, "Tree" | "Counter">;
type ContainerValueKind = "map" | "array" | "string" | "other";

export function isPlainObjectValue(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !(value instanceof RegExp) &&
        typeof value !== "function"
    );
}

export function inferContainerTypeFromValue(
    value: unknown,
    defaults?: InferContainerOptions,
): InferableContainerType | undefined {
    switch (getContainerValueKind(value)) {
        case "map":
            return "Map";
        case "array":
            return defaults?.defaultMovableList ? "MovableList" : "List";
        case "string":
            return defaults?.defaultLoroText ? "Text" : undefined;
        default:
            return undefined;
    }
}

export function inferSchemaContainerTypeFromValue(
    value: unknown,
    defaults?: InferContainerOptions,
): SchemaContainerTypeName | undefined {
    const containerType = inferContainerTypeFromValue(value, defaults);
    switch (containerType) {
        case "Map":
            return "loro-map";
        case "List":
            return "loro-list";
        case "MovableList":
            return "loro-movable-list";
        case "Text":
            return "loro-text";
        default:
            return undefined;
    }
}

export function matchesContainerType(
    containerType: ContainerType,
    value: unknown,
): boolean {
    const kind = getContainerValueKind(value);
    switch (containerType) {
        case "Map":
            return kind === "map";
        case "List":
        case "MovableList":
        case "Tree":
            return kind === "array";
        case "Text":
            return kind === "string";
        default:
            return false;
    }
}

function getContainerValueKind(value: unknown): ContainerValueKind {
    if (isPlainObjectValue(value)) {
        return "map";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof value === "string") {
        return "string";
    }
    return "other";
}
