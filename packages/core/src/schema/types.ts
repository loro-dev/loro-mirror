/**
 * Types for the schema definition system
 */

import type { ContainerType as LoroContainerType } from "loro-crdt";
import { ContainerType } from "./container-types";

/**
 * Options for schema definitions
 */
export interface SchemaOptions {
    /** Whether the field is required */
    required?: boolean;
    /** Default value for the field */
    defaultValue?: any;
    /** Description of the field */
    description?: string;
    /** Additional validation function */
    validate?: (value: any) => boolean | string;
    [key: string]: any;
}

/**
 * Base interface for all schema types
 */
export interface BaseSchemaType<T> {
    type: string;
    options: SchemaOptions;
    getContainerType(): ContainerType | null;
}

/**
 * String schema type
 */
export interface StringSchemaType extends BaseSchemaType<string> {
    type: "string";
}

/**
 * Number schema type
 */
export interface NumberSchemaType extends BaseSchemaType<number> {
    type: "number";
}

/**
 * Boolean schema type
 */
export interface BooleanSchemaType extends BaseSchemaType<boolean> {
    type: "boolean";
}

/**
 * Ignored field schema type
 */
export interface IgnoreSchemaType extends BaseSchemaType<any> {
    type: "ignore";
}

/**
 * Loro Map schema type
 */
export interface LoroMapSchema<T extends Record<string, SchemaType<any>>>
    extends BaseSchemaType<Record<string, any>> {
    type: "loro-map";
    definition: SchemaDefinition<T>;
}

/**
 * Loro List schema type
 */
export interface LoroListSchema<T extends SchemaType<any>>
    extends BaseSchemaType<Array<any>> {
    type: "loro-list";
    itemSchema: T;
    idSelector?: (item: any) => string;
}

/**
 * Loro Text schema type
 */
export interface LoroTextSchemaType extends BaseSchemaType<string> {
    type: "loro-text";
}

/**
 * Root schema type
 */
export interface RootSchemaType<T extends Record<string, SchemaType<any>>>
    extends BaseSchemaType<Record<string, any>> {
    type: "schema";
    definition: SchemaDefinition<T>;
}

/**
 * Union of all schema types
 */
export type SchemaType<T> =
    | StringSchemaType
    | NumberSchemaType
    | BooleanSchemaType
    | IgnoreSchemaType
    | LoroMapSchema<Record<string, SchemaType<any>>>
    | LoroListSchema<SchemaType<any>>
    | LoroTextSchemaType
    | RootSchemaType<Record<string, SchemaType<any>>>;

/**
 * Schema definition type
 */
export type SchemaDefinition<T extends Record<string, SchemaType<any>>> = {
    [K in keyof T]: T[K];
};

/**
 * Infer the JavaScript type from a schema type
 */
export type InferType<S extends SchemaType<any>> = S extends StringSchemaType
    ? string
    : S extends NumberSchemaType ? number
    : S extends BooleanSchemaType ? boolean
    : S extends IgnoreSchemaType ? any
    : S extends LoroTextSchemaType ? string
    : S extends LoroMapSchema<infer M> ? { [K in keyof M]: InferType<M[K]> }
    : S extends LoroListSchema<infer I> ? Array<InferType<I>>
    : S extends RootSchemaType<infer R> ? { [K in keyof R]: InferType<R[K]> }
    : never;

/**
 * Infer the JavaScript type from a schema definition
 */
export type InferSchemaType<T extends Record<string, SchemaType<any>>> = {
    [K in keyof T]: InferType<T[K]>;
};
