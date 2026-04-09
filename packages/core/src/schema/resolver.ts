import {
    ContainerSchemaType,
    LoroMapSchema,
    LoroMapSchemaWithCatchall,
    LoroUnionSchema,
    RootSchemaType,
    SchemaType,
} from "./types.js";

type RootSchemaRecord = RootSchemaType<Record<string, ContainerSchemaType>>;
type MapSchemaRecord = LoroMapSchema<Record<string, SchemaType>>;
type MapSchemaWithCatchallRecord = LoroMapSchemaWithCatchall<
    Record<string, SchemaType>,
    SchemaType
>;
type MapLikeSchema =
    | RootSchemaRecord
    | MapSchemaRecord
    | MapSchemaWithCatchallRecord;

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
        case "loro-union":
            // Without a concrete value we cannot resolve the active variant,
            // so we cannot look up a child key on the union itself.
            return undefined;
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
 * If `schema` is a LoroUnionSchema, resolve to the active variant's
 * LoroMapSchema by reading the discriminant from `value`.
 * Returns `schema` unchanged for all other schema types.
 */
export function resolveUnionVariant(
    schema: SchemaType | undefined,
    value: unknown,
): SchemaType | undefined {
    if (
        !schema ||
        schema.type !== "loro-union" ||
        !value ||
        typeof value !== "object"
    ) {
        return schema;
    }
    const union = schema as LoroUnionSchema<
        string,
        Record<string, LoroMapSchema<Record<string, SchemaType>>>
    >;
    const tag = (value as Record<string, unknown>)[union.discriminant];
    if (typeof tag === "string" && union.variants[tag]) {
        return union.variants[tag];
    }
    return schema;
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
        case "loro-union":
            return childSchema;
        default:
            return undefined;
    }
}
