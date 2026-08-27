import {
    ContainerSchemaType,
    LoroMapSchema,
    LoroMapSchemaWithCatchall,
    RootSchemaType,
    SchemaType,
} from "./types.js";

type RootSchemaRecord = RootSchemaType<Record<string, ContainerSchemaType>>;
type MapSchemaRecord = LoroMapSchema<Record<string, SchemaType>>;
type MapSchemaWithCatchallRecord = LoroMapSchemaWithCatchall<
    Record<string, SchemaType>,
    SchemaType
>;
type MapLikeSchema = RootSchemaRecord | MapSchemaRecord | MapSchemaWithCatchallRecord;

export function getMapFieldSchema(
    schema: MapLikeSchema | undefined,
    key: string,
): SchemaType | undefined {
    if (!schema) return undefined;

    if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
        return schema.definition[key];
    }

    if (schema.type === "loro-map" && "catchallType" in schema) {
        return schema.catchallType;
    }

    return undefined;
}

export function getChildSchema(
    schema: SchemaType | undefined,
    childKey?: string | number,
): SchemaType | undefined {
    if (!schema) return undefined;

    switch (schema.type) {
        case "schema":
        case "loro-map":
            return childKey === undefined
                ? undefined
                : getMapFieldSchema(schema, String(childKey));
        case "loro-list":
        case "loro-movable-list":
            return schema.itemSchema;
        case "loro-tree":
            return schema.nodeSchema;
        default:
            return undefined;
    }
}

/**
 * Returns true when a map-like schema (root schema or LoroMap schema) has a
 * fixed shape that does NOT declare `key`.
 *
 * Such keys are "unknown" to this schema — typically written by a newer
 * schema version — and must be left completely untouched: not mirrored into
 * state, not validated, not diffed, and never deleted or overwritten in the
 * doc (forward compatibility).
 *
 * Schemas without a fixed shape (no schema at all, non-map schemas, or maps
 * with a catchall) treat every key as known and return false.
 */
export function isUnknownMapKey(
    schema: SchemaType | undefined,
    key: string,
): boolean {
    if (!schema) return false;
    if (schema.type !== "schema" && schema.type !== "loro-map") return false;
    if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
        return false;
    }
    if (schema.type === "loro-map" && "catchallType" in schema) return false;
    return true;
}

export function getChildContainerSchema(
    schema: SchemaType | undefined,
    childKey?: string | number,
): ContainerSchemaType | undefined {
    const childSchema = getChildSchema(schema, childKey);
    if (!childSchema) return undefined;

    switch (childSchema.type) {
        case "loro-map":
        case "loro-list":
        case "loro-movable-list":
        case "loro-text":
        case "loro-tree":
            return childSchema;
        default:
            return undefined;
    }
}
