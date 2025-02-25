/**
 * Schema definition system for Loro Mirror
 *
 * This module provides utilities to define schemas that map between JavaScript types and Loro CRDT types.
 */

import type { ContainerType as LoroContainerType } from "loro-crdt";
import { ContainerType } from "./container-types";
import {
    LoroListSchema,
    LoroMapSchema,
    RootSchemaType,
    SchemaDefinition,
    SchemaOptions,
    SchemaType,
} from "./types";

export * from "./types";
export * from "./validators";
export * from "./container-types";

/**
 * Create a schema definition
 */
export function schema<T extends Record<string, SchemaType<any>>>(
    definition: SchemaDefinition<T>,
    options?: SchemaOptions,
): RootSchemaType<T> {
    return {
        type: "schema" as const,
        definition,
        options: options || {},
        getContainerType() {
            return ContainerType.Map;
        },
    };
}

/**
 * Define a string field
 */
schema.String = function (options?: SchemaOptions) {
    return {
        type: "string" as const,
        options: options || {},
        getContainerType() {
            return null; // Primitive type, no container
        },
    };
};

/**
 * Define a number field
 */
schema.Number = function (options?: SchemaOptions) {
    return {
        type: "number" as const,
        options: options || {},
        getContainerType() {
            return null; // Primitive type, no container
        },
    };
};

/**
 * Define a boolean field
 */
schema.Boolean = function (options?: SchemaOptions) {
    return {
        type: "boolean" as const,
        options: options || {},
        getContainerType() {
            return null; // Primitive type, no container
        },
    };
};

/**
 * Define a field to be ignored (not synced with Loro)
 */
schema.Ignore = function (options?: SchemaOptions) {
    return {
        type: "ignore" as const,
        options: options || {},
        getContainerType() {
            return null;
        },
    };
};

/**
 * Define a Loro map
 */
schema.LoroMap = function <T extends Record<string, SchemaType<any>>>(
    definition: SchemaDefinition<T>,
    options?: SchemaOptions,
): LoroMapSchema<T> {
    return {
        type: "loro-map" as const,
        definition,
        options: options || {},
        getContainerType() {
            return ContainerType.Map;
        },
    };
};

/**
 * Define a Loro list
 */
schema.LoroList = function <T extends SchemaType<any>>(
    itemSchema: T,
    idSelector?: (item: any) => string,
    options?: SchemaOptions,
): LoroListSchema<T> {
    return {
        type: "loro-list" as const,
        itemSchema,
        idSelector,
        options: options || {},
        getContainerType() {
            return ContainerType.List;
        },
    };
};

/**
 * Define a Loro text field
 */
schema.LoroText = function (options?: SchemaOptions) {
    return {
        type: "loro-text" as const,
        options: options || {},
        getContainerType() {
            return ContainerType.RichText;
        },
    };
};
