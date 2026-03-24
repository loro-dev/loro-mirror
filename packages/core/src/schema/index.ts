/**
 * Schema definition system for Loro Mirror
 *
 * This module provides utilities to define schemas that map between JavaScript types and Loro CRDT types.
 */
import {
    AnySchemaOptions,
    AnySchemaType,
    BooleanSchemaType,
    ContainerSchemaType,
    IgnoreSchemaType,
    LoroListSchema,
    LoroMapSchema,
    LoroMapSchemaWithCatchall,
    LoroMovableListSchema,
    LoroTextSchemaType,
    LoroTreeSchema,
    NumberSchemaType,
    RootSchemaDefinition,
    RootSchemaType,
    SchemaDefinition,
    SchemaOptions,
    SchemaType,
    StringSchemaType,
    InferType,
    TransformDefinition,
} from "./types.js";

/**
 * String schema builder with transform method.
 * Transform decode/encode never receive null/undefined - they pass through as-is.
 */
type StringSchemaBuilder<T extends string, O extends SchemaOptions> =
    StringSchemaType<T> & { options: O } & {
        transform: <D>(
            def: TransformDefinition<T, D>,
        ) => StringSchemaType<T> & {
            options: O;
            transform: TransformDefinition<T, D>;
        };
    };

type StringSchemaFactory = {
    <T extends string = string, O extends SchemaOptions = {}>(): StringSchemaBuilder<T, O>;
    <T extends string = string, O extends SchemaOptions & { required: false } = { required: false }>(
        options: O,
    ): StringSchemaBuilder<T, O>;
    <T extends string = string, O extends SchemaOptions = {}>(
        options: O,
    ): StringSchemaBuilder<T, O>;
};

/**
 * Number schema builder with transform method.
 * Transform decode/encode never receive null/undefined - they pass through as-is.
 */
type NumberSchemaBuilder<O extends SchemaOptions> = NumberSchemaType & {
    options: O;
} & {
    transform: <D>(
        def: TransformDefinition<number, D>,
    ) => NumberSchemaType & {
        options: O;
        transform: TransformDefinition<number, D>;
    };
};

/**
 * Boolean schema builder with transform method.
 * Transform decode/encode never receive null/undefined - they pass through as-is.
 */
type BooleanSchemaBuilder<O extends SchemaOptions> = BooleanSchemaType & {
    options: O;
} & {
    transform: <D>(
        def: TransformDefinition<boolean, D>,
    ) => BooleanSchemaType & {
        options: O;
        transform: TransformDefinition<boolean, D>;
    };
};

export * from "./types.js";
export * from "./validators.js";

/**
 * Create a schema definition
 */
export function schema<
    T extends Record<string, ContainerSchemaType>,
    O extends SchemaOptions = {},
>(
    definition: RootSchemaDefinition<T>,
    options?: O,
): RootSchemaType<T> & { options: O } {
    return {
        type: "schema" as const,
        definition,
        options: options || ({} as O),
        getContainerType() {
            return "Map";
        },
    } as RootSchemaType<T> & { options: O };
}

/**
 * Define a string field
 */
schema.String = (function <
    T extends string = string,
    O extends SchemaOptions = {},
>(options?: O): StringSchemaBuilder<T, O> {
    const baseSchema = {
        type: "string" as const,
        options: (options || {}) as O,
        getContainerType: () => {
            return null;
        },
    };

    return {
        ...baseSchema,
        transform: <D>(def: TransformDefinition<T, D>) => ({
            ...baseSchema,
            transform: def,
        }),
    } as StringSchemaBuilder<T, O>;
}) as StringSchemaFactory;

/**
 * Define an any field (runtime-inferred by Mirror)
 */
schema.Any = function <O extends AnySchemaOptions = AnySchemaOptions>(
    options?: O,
) {
    return {
        type: "any" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return null;
        },
    } as AnySchemaType & { options: O };
};

/**
 * Define a number field
 */
schema.Number = function <O extends SchemaOptions = {}>(
    options?: O,
): NumberSchemaBuilder<O> {
    const baseSchema = {
        type: "number" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return null; // Primitive type, no container
        },
    };

    return {
        ...baseSchema,
        transform: <D>(def: TransformDefinition<number, D>) => ({
            ...baseSchema,
            transform: def,
        }),
    } as NumberSchemaBuilder<O>;
};

/**
 * Define a boolean field
 */
schema.Boolean = function <O extends SchemaOptions = {}>(
    options?: O,
): BooleanSchemaBuilder<O> {
    const baseSchema = {
        type: "boolean" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return null; // Primitive type, no container
        },
    };

    return {
        ...baseSchema,
        transform: <D>(def: TransformDefinition<boolean, D>) => ({
            ...baseSchema,
            transform: def,
        }),
    } as BooleanSchemaBuilder<O>;
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
schema.LoroMap = function <
    T extends Record<string, SchemaType> = {},
    O extends SchemaOptions = {},
>(
    definition: SchemaDefinition<T>,
    options?: O,
): LoroMapSchema<T> & { options: O } & {
    catchall: <C extends SchemaType>(
        catchallSchema: C,
    ) => LoroMapSchemaWithCatchall<T, C>;
} {
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
        catchall: <C extends SchemaType>(
            catchallSchema: C,
        ): LoroMapSchemaWithCatchall<T, C> => {
            return {
                ...baseSchema,
                catchallType: catchallSchema,
                catchall: <NewC extends SchemaType>(
                    newCatchallSchema: NewC,
                ) => {
                    return {
                        ...baseSchema,
                        catchallType: newCatchallSchema,
                        catchall: schemaWithCatchall.catchall,
                    } as LoroMapSchemaWithCatchall<T, NewC>;
                },
            } as LoroMapSchemaWithCatchall<T, C>;
        },
    };

    return schemaWithCatchall as LoroMapSchema<T> & { options: O } & {
        catchall: <C extends SchemaType>(
            catchallSchema: C,
        ) => LoroMapSchemaWithCatchall<T, C>;
    };
};

/**
 * Create a dynamic record schema (like zod's z.record)
 */
schema.LoroMapRecord = function <
    T extends SchemaType,
    O extends SchemaOptions = {},
>(
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
        catchall: <NewC extends SchemaType>(
            newCatchallSchema: NewC,
        ): LoroMapSchemaWithCatchall<{}, NewC> => {
            return schema.LoroMapRecord(newCatchallSchema, options);
        },
    } as LoroMapSchemaWithCatchall<{}, T> & { options: O };
};

/**
 * Define a Loro list
 */
schema.LoroList = function <T extends SchemaType, O extends SchemaOptions = {}>(
    itemSchema: T,
    idSelector?: (item: InferType<T>) => string,
    options?: O,
): LoroListSchema<T> & { options: O } {
    return {
        type: "loro-list" as const,
        itemSchema,
        idSelector: idSelector as unknown as (item: unknown) => string,
        options: options || ({} as O),
        getContainerType: () => {
            return "List";
        },
    } as LoroListSchema<T> & { options: O };
};

schema.LoroMovableList = function <
    T extends SchemaType,
    O extends SchemaOptions = {},
>(
    itemSchema: T,
    idSelector: (item: InferType<T>) => string,
    options?: O,
): LoroMovableListSchema<T> & { options: O } {
    return {
        type: "loro-movable-list" as const,
        itemSchema,
        idSelector: idSelector as unknown as (item: unknown) => string,
        options: options || ({} as O),
        getContainerType: () => {
            return "MovableList";
        },
    } as LoroMovableListSchema<T> & { options: O };
};

/**
 * Define a Loro text field
 */
schema.LoroText = function <O extends SchemaOptions = {}>(
    options?: O,
): LoroTextSchemaType & { options: O } {
    return {
        type: "loro-text" as const,
        options: options || ({} as O),
        getContainerType: () => {
            return "Text";
        },
    } as LoroTextSchemaType & { options: O };
};

/**
 * Define a Loro tree
 *
 * Each tree node has a `data` map described by `nodeSchema`.
 */
// oxlint-disable-next-line no-explicit-any
schema.LoroTree = function <T extends Record<string, SchemaType>>(
    nodeSchema: LoroMapSchema<T>,
    options?: SchemaOptions,
): LoroTreeSchema<T> {
    return {
        type: "loro-tree" as const,
        nodeSchema,
        options: options || {},
        getContainerType() {
            return "Tree";
        },
    };
};
