/**
 * Schema definition system for Loro Mirror
 *
 * This module provides utilities to define schemas that map between JavaScript types and Loro CRDT types.
 */
import {
    BooleanSchemaType,
    ContainerSchemaType,
    IgnoreSchemaType,
    LoroListSchema,
    LoroMapSchema,
    LoroMapSchemaWithCatchall,
    LoroMovableListSchema,
    LoroTextSchemaType,
    NumberSchemaType,
    RootSchemaDefinition,
    RootSchemaType,
    SchemaDefinition,
    SchemaOptions,
    SchemaType,
    StringSchemaType,
} from "./types";

export * from "./types";
export * from "./validators";

/**
 * Create a schema definition
 */
export function schema<T extends Record<string, ContainerSchemaType>, O extends SchemaOptions = {}>(
    definition: RootSchemaDefinition<T>,
    options?: O,
): RootSchemaType<T> & { options: O } {
    return {
        type: "schema" as const,
        definition,
        options: options || ({} as O),
        getContainerType: () => {
            return "Map";
        },
    } as RootSchemaType<T> & { options: O };
}

/**
 * Define a string field
 */
schema.String = function <T extends string = string, O extends SchemaOptions = {}>(options?: O) {
    return {
        type: "string" as const,
        options: (options || {}) as O,
        getContainerType: () => {
            return null;
        },
    } as StringSchemaType<T> & { options: O };
};

/**
 * Define a number field
 */
schema.Number = function <O extends SchemaOptions = {}>(options?: O) {
    return {
        type: "number" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return null; // Primitive type, no container
        },
    } as NumberSchemaType & { options: O };
};

/**
 * Define a boolean field
 */
schema.Boolean = function <O extends SchemaOptions = {}>(options?: O) {
    return {
        type: "boolean" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return null; // Primitive type, no container
        },
    } as BooleanSchemaType & { options: O };
};

/**
 * Define a field to be ignored (not synced with Loro)
 */
schema.Ignore = function <O extends SchemaOptions = {}>(options?: O) {
    return {
        type: "ignore" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return null;
        },
    } as IgnoreSchemaType & { options: O };
};

/**
 * Define a Loro map
 */
schema.LoroMap = function <T extends Record<string, SchemaType>, O extends SchemaOptions = {}>(
    definition: SchemaDefinition<T>,
    options?: O,
): LoroMapSchema<T> & { options: O } & { catchall: <C extends SchemaType>(catchallSchema: C) => LoroMapSchemaWithCatchall<T, C> } {
    const baseSchema = {
        type: "loro-map" as const,
        definition,
        options: options || ({} as O),
        getContainerType: () => {
            return "Map";
        },
    } as LoroMapSchema<T> & { options: O };

    // Add catchall method like zod
    const schemaWithCatchall = {
        ...baseSchema,
        catchall: <C extends SchemaType>(catchallSchema: C): LoroMapSchemaWithCatchall<T, C> => {
            return {
                ...baseSchema,
                catchallType: catchallSchema,
                catchall: <NewC extends SchemaType>(newCatchallSchema: NewC) => {
                    return {
                        ...baseSchema,
                        catchallType: newCatchallSchema,
                        catchall: schemaWithCatchall.catchall
                    } as LoroMapSchemaWithCatchall<T, NewC>;
                }
            } as LoroMapSchemaWithCatchall<T, C>;
        }
    };

    return schemaWithCatchall as LoroMapSchema<T> & { options: O } & { catchall: <C extends SchemaType>(catchallSchema: C) => LoroMapSchemaWithCatchall<T, C> };
};

/**
 * Create a dynamic record schema (like zod's z.record)
 */
schema.LoroMapRecord = function <T extends SchemaType, O extends SchemaOptions = {}>(
    valueSchema: T,
    options?: O,
): LoroMapSchemaWithCatchall<{}, T> & { options: O } {
    return {
        type: "loro-map" as const,
        definition: {},
        catchallType: valueSchema,
        options: options || ({} as O),
        getContainerType: () => {
            return "Map";
        },
        catchall: <NewC extends SchemaType>(newCatchallSchema: NewC): LoroMapSchemaWithCatchall<{}, NewC> => {
            return schema.LoroMapRecord(newCatchallSchema, options);
        }
    } as LoroMapSchemaWithCatchall<{}, T> & { options: O };
};

/**
 * Define a Loro list
 */
schema.LoroList = function <T extends SchemaType, O extends SchemaOptions = {}>(
    itemSchema: T,
    idSelector?: (item: any) => string,
    options?: O,
): LoroListSchema<T> & { options: O } {
    return {
        type: "loro-list" as const,
        itemSchema,
        idSelector,
        options: options || ({} as O),
        getContainerType: () => {
            return "List";
        },
    } as LoroListSchema<T> & { options: O };
};

schema.LoroMovableList = function <T extends SchemaType, O extends SchemaOptions = {}>(
    itemSchema: T,
    idSelector: (item: any) => string,
    options?: O,
): LoroMovableListSchema<T> & { options: O } {
    return {
        type: "loro-movable-list" as const,
        itemSchema,
        idSelector,
        options: options || ({} as O),
        getContainerType: () => {
            return "MovableList";
        },
    } as LoroMovableListSchema<T> & { options: O };
};

/**
 * Define a Loro text field
 */
schema.LoroText = function <O extends SchemaOptions = {}>(options?: O): LoroTextSchemaType & { options: O } {
    return {
        type: "loro-text" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return "Text";
        },
    } as LoroTextSchemaType & { options: O };
};
