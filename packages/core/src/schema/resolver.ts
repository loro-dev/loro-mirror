import {
    ContainerSchemaType,
    LoroMapSchema,
    LoroMapSchemaWithCatchall,
    RootSchemaType,
    SchemaType,
} from "./types.js";

type RootMapSchema = RootSchemaType<Record<string, ContainerSchemaType>>;
type RecordMapSchema = LoroMapSchema<Record<string, SchemaType>>;
type RecordMapSchemaWithCatchall = LoroMapSchemaWithCatchall<
    Record<string, SchemaType>,
    SchemaType
>;

type MapLikeSchema = RootMapSchema | RecordMapSchema | RecordMapSchemaWithCatchall;

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
