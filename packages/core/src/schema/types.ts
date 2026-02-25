/**
 * Types for the schema definition system
 */

import { ContainerType } from "loro-crdt";
export type InferContainerOptions = {
    /**
     * When true, string values are inferred as `LoroText` containers instead of primitive strings.
     */
    defaultLoroText?: boolean;
    /**
     * When true, array values are inferred as `LoroMovableList` containers instead of `LoroList`.
     *
     * Note: if a MovableList is created/inferred without an `idSelector` schema, diffs fall back
     * to index-based updates and do not emit `move` operations.
     */
    defaultMovableList?: boolean;
};

/**
 * Options for schema definitions
 */
export interface SchemaOptions {
    /** Whether the field is required */
    required?: boolean;
    /** Default value for the field */
    defaultValue?: unknown;
    /** Description of the field */
    description?: string;
    /**
     * Additional validation function.
     * Receives the domain value to validate - this will be the transformed value if a transform is defined, otherwise the raw value (string | number | boolean).
     * Return true if valid, or a string error message if invalid.
     */
    validate?: (value: unknown) => boolean | string;
    [key: string]: unknown;
}

type HasExplicitDefaultValue<S extends SchemaType> = S extends {
    options: { defaultValue: unknown };
}
    ? true
    : false;

export type AnySchemaOptions = SchemaOptions & {
    /**
     * Per-Any inference overrides.
     *
     * Notes:
     * - `defaultLoroText` defaults to `false` for Any when omitted (primitive string),
     *   overriding the global `inferOptions.defaultLoroText`.
     * - `defaultMovableList` inherits from the global inference options unless specified.
     */
    defaultLoroText?: boolean;
    defaultMovableList?: boolean;
};

/**
 * Base interface for all schema types
 */
export interface BaseSchemaType {
    type: string;
    options: SchemaOptions;
    getContainerType(): ContainerType | null;
}

/**
 * Any schema type
 *
 * This schema defers container inference decisions to the runtime (Mirror).
 */
export interface AnySchemaType extends BaseSchemaType {
    type: "any";
    options: AnySchemaOptions;
}

/**
 * String schema type
 */
export interface StringSchemaType<
    T extends string = string,
> extends BaseSchemaType {
    type: "string";
    _t: T;
}

/**
 * Number schema type
 */
export interface NumberSchemaType extends BaseSchemaType {
    type: "number";
}

/**
 * Boolean schema type
 */
export interface BooleanSchemaType extends BaseSchemaType {
    type: "boolean";
}

/**
 * Ignored field schema type
 */
export interface IgnoreSchemaType extends BaseSchemaType {
    type: "ignore";
}

/**
 * Loro Map schema type
 */
export interface LoroMapSchema<
    T extends Record<string, SchemaType>,
> extends BaseSchemaType {
    type: "loro-map";
    definition: SchemaDefinition<T>;
}

/**
 * Enhanced LoroMapSchema with catchall support
 */
export interface LoroMapSchemaWithCatchall<
    T extends Record<string, SchemaType>,
    C extends SchemaType,
> extends BaseSchemaType {
    type: "loro-map";
    definition: SchemaDefinition<T>;
    catchallType: C;
    catchall<NewC extends SchemaType>(
        catchallSchema: NewC,
    ): LoroMapSchemaWithCatchall<T, NewC>;
}

/**
 * Loro List schema type
 */
export interface LoroListSchema<T extends SchemaType> extends BaseSchemaType {
    type: "loro-list";
    itemSchema: T;
    idSelector?: (item: unknown) => string;
}

/**
 * Loro Movable List schema type
 */
export interface LoroMovableListSchema<
    T extends SchemaType,
> extends BaseSchemaType {
    type: "loro-movable-list";
    itemSchema: T;
    idSelector?: (item: unknown) => string;
}

/**
 * Loro Text schema type
 */
export interface LoroTextSchemaType extends BaseSchemaType {
    type: "loro-text";
}

/**
 * Loro Tree schema type
 *
 * Represents a tree where each node has a `data` map described by `nodeSchema`.
 */
export interface LoroTreeSchema<
    T extends Record<string, SchemaType>,
> extends BaseSchemaType {
    type: "loro-tree";
    nodeSchema: LoroMapSchema<T>;
}

/**
 * Loro Union (discriminated union) schema type.
 *
 * Each variant is a LoroMap. The discriminant key is auto-injected
 * into each variant's inferred type with the variant name as its
 * string literal value.
 */
export interface LoroUnionSchema<
    D extends string,
    V extends Record<string, LoroMapSchema<Record<string, SchemaType>>>,
> extends BaseSchemaType {
    type: "loro-union";
    discriminant: D;
    variants: V;
}

/**
 * Root schema type
 */
export interface RootSchemaType<
    T extends Record<string, ContainerSchemaType>,
> extends BaseSchemaType {
    type: "schema";
    definition: RootSchemaDefinition<T>;
}

/**
 * Union of all schema types
 */
export type SchemaType =
    | AnySchemaType
    | StringSchemaType
    | NumberSchemaType
    | BooleanSchemaType
    | IgnoreSchemaType
    | LoroMapSchema<Record<string, SchemaType>>
    | LoroMapSchemaWithCatchall<Record<string, SchemaType>, SchemaType>
    | LoroListSchema<SchemaType>
    | LoroMovableListSchema<SchemaType>
    | LoroTextSchemaType
    | LoroTreeSchema<Record<string, SchemaType>>
    | LoroUnionSchema<
          string,
          Record<string, LoroMapSchema<Record<string, SchemaType>>>
      >
    | RootSchemaType<Record<string, ContainerSchemaType>>;

export type ContainerSchemaType =
    | LoroMapSchema<Record<string, SchemaType>>
    | LoroMapSchemaWithCatchall<Record<string, SchemaType>, SchemaType>
    | LoroListSchema<SchemaType>
    | LoroMovableListSchema<SchemaType>
    | LoroTextSchemaType
    | LoroTreeSchema<Record<string, SchemaType>>
    | LoroUnionSchema<
          string,
          Record<string, LoroMapSchema<Record<string, SchemaType>>>
      >;

/**
 * Schema definition type
 */
export type RootSchemaDefinition<
    T extends Record<string, ContainerSchemaType>,
> = {
    [K in keyof T]: T[K];
};

/**
 * Schema definition type
 */
export type SchemaDefinition<T extends Record<string, SchemaType>> = {
    [K in keyof T]: T[K];
};

/**
 * Check if a schema type is required
 *
 * true is default
 */
type IsSchemaRequired<S extends SchemaType> = S extends {
    options: { required: true };
}
    ? true
    : S extends { options: { required: false } }
      ? false
      : S extends { options: { required?: undefined } }
        ? true
        : S extends { options: {} }
          ? true
          : true;

/**
 * Distributive simplifier: flattens intersections and distributes over unions.
 */
type Simplify<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

/**
 * Helper: Infer a single union variant's type, injecting the discriminant field.
 */
type InferUnionVariant<
    D extends string,
    K extends string,
    M extends Record<string, SchemaType>,
> = {
    [F in D | keyof M]: F extends D
        ? K
        : F extends keyof M
        ? InferType<M[F]>
        : never;
} & { $cid: string };

/**
 * Helper: Distribute over all variants to produce a discriminated union type.
 */
type InferUnionType<
    D extends string,
    V extends Record<string, LoroMapSchema<Record<string, SchemaType>>>,
> = Simplify<
    {
        [K in keyof V]: V[K] extends LoroMapSchema<infer M>
            ? InferUnionVariant<D, K & string, M>
            : never;
    }[keyof V]
>;

/**
 * Helper: Input variant type ($cid optional, fields use InferInputType).
 */
type InferInputUnionVariant<
    D extends string,
    K extends string,
    M extends Record<string, SchemaType>,
> = {
    [F in D | keyof M]: F extends D
        ? K
        : F extends keyof M
        ? InferInputType<M[F]>
        : never;
} & { $cid?: string };

/**
 * Helper: Distribute over all variants for input (setState) types.
 */
type InferInputUnionType<
    D extends string,
    V extends Record<string, LoroMapSchema<Record<string, SchemaType>>>,
> = Simplify<
    {
        [K in keyof V]: V[K] extends LoroMapSchema<infer M>
            ? InferInputUnionVariant<D, K & string, M>
            : never;
    }[keyof V]
>;

/**
 * Infer the JavaScript type from a schema type.
 */
export type InferType<S extends SchemaType> = S extends {
    transform: TransformDefinition<infer _C, infer D>;
}
    ? WithTransformStartupOptionality<D, S & SchemaType>
    : S extends StringSchemaType
      ? InferStringType<S>
      : S extends NumberSchemaType
        ? InferNumberType<S>
        : S extends BooleanSchemaType
          ? InferBooleanType<S>
          : IsSchemaRequired<S> extends false
            ? S extends AnySchemaType
                ? unknown
                : S extends IgnoreSchemaType
                  ? unknown
                  : S extends LoroTextSchemaType
                    ? string | undefined
                    : S extends LoroUnionSchema<infer D, infer V>
                      ? InferUnionType<D, V> | undefined
                      : S extends LoroMapSchemaWithCatchall<infer M, infer C>
                        ? keyof M extends never
                            ?
                                  | ({ [key: string]: InferType<C> } & {
                                        $cid: string;
                                    })
                                  | undefined
                            :
                                  | (({ [K in keyof M]: InferType<M[K]> } & {
                                        [K in Exclude<
                                            string,
                                            keyof M
                                        >]: InferType<C>;
                                    }) & { $cid: string })
                                  | undefined
                        : S extends LoroMapSchema<infer M>
                          ?
                                | ({ [K in keyof M]: InferType<M[K]> } & {
                                      $cid: string;
                                  })
                                | undefined
                          : S extends LoroListSchema<infer I>
                            ? Array<InferType<I>> | undefined
                            : S extends LoroMovableListSchema<infer I>
                              ? Array<InferType<I>> | undefined
                              : S extends LoroTreeSchema<infer M>
                                ? Array<InferTreeNodeTypeWithCid<M>> | undefined
                                : S extends RootSchemaType<infer R>
                                  ?
                                        | { [K in keyof R]: InferType<R[K]> }
                                        | undefined
                                  : never
            : S extends IgnoreSchemaType
              ? unknown
              : S extends LoroTextSchemaType
                ? string
                : S extends AnySchemaType
                  ? unknown
                  : S extends LoroUnionSchema<infer D, infer V>
                    ? InferUnionType<D, V>
                    : S extends LoroMapSchemaWithCatchall<infer M, infer C>
                      ? keyof M extends never
                          ? { [key: string]: InferType<C> } & { $cid: string }
                          : ({ [K in keyof M]: InferType<M[K]> } & {
                                [K in Exclude<string, keyof M>]: InferType<C>;
                            }) & { $cid: string }
                      : S extends LoroMapSchema<infer M>
                        ? { [K in keyof M]: InferType<M[K]> } & { $cid: string }
                        : S extends LoroListSchema<infer I>
                          ? Array<InferType<I>>
                          : S extends LoroMovableListSchema<infer I>
                            ? Array<InferType<I>>
                            : S extends LoroTreeSchema<infer M>
                              ? Array<InferTreeNodeTypeWithCid<M>>
                              : S extends RootSchemaType<infer R>
                                ? { [K in keyof R]: InferType<R[K]> }
                                : never;

/**
 * Infer the JavaScript type from a schema definition
 */
export type InferSchemaType<T extends Record<string, SchemaType>> = {
    [K in keyof T]: InferType<T[K]>;
};

/**
 * Infer the input (write) type for setState updates.
 * Identical to InferType<S> except that for any LoroMap shape, the `$cid` field is optional.
 */
export type InferInputType<S extends SchemaType> = S extends {
    transform: TransformDefinition<infer _C, infer D>;
}
    ? WithTransformStartupOptionality<D, S & SchemaType>
    : S extends StringSchemaType
      ? InferStringType<S>
      : S extends NumberSchemaType
        ? InferNumberType<S>
        : S extends BooleanSchemaType
          ? InferBooleanType<S>
          : IsSchemaRequired<S> extends false
            ? S extends AnySchemaType
                ? unknown
                : S extends IgnoreSchemaType
                  ? unknown
                  : S extends LoroTextSchemaType
                    ? string | undefined
                    : S extends LoroUnionSchema<infer D, infer V>
                      ? InferInputUnionType<D, V> | undefined
                      : S extends LoroMapSchemaWithCatchall<infer M, infer C>
                        ? keyof M extends never
                            ?
                                  | ({ [key: string]: InferInputType<C> } & {
                                        $cid?: string;
                                    })
                                  | undefined
                            :
                                  | (({
                                        [K in keyof M]: InferInputType<M[K]>;
                                    } & {
                                        [K in Exclude<
                                            string,
                                            keyof M
                                        >]: InferInputType<C>;
                                    }) & { $cid?: string })
                                  | undefined
                        : S extends LoroMapSchema<infer M>
                          ?
                                | ({ [K in keyof M]: InferInputType<M[K]> } & {
                                      $cid?: string;
                                  })
                                | undefined
                          : S extends LoroListSchema<infer I>
                            ? Array<InferInputType<I>> | undefined
                            : S extends LoroMovableListSchema<infer I>
                              ? Array<InferInputType<I>> | undefined
                              : S extends LoroTreeSchema<infer M>
                                ? Array<InferInputTreeNodeType<M>> | undefined
                                : S extends RootSchemaType<infer R>
                                  ?
                                        | {
                                              [K in keyof R]: InferInputType<
                                                  R[K]
                                              >;
                                          }
                                        | undefined
                                  : never
            : S extends IgnoreSchemaType
              ? unknown
              : S extends LoroTextSchemaType
                ? string
                : S extends AnySchemaType
                  ? unknown
                  : S extends LoroUnionSchema<infer D, infer V>
                    ? InferInputUnionType<D, V>
                    : S extends LoroMapSchemaWithCatchall<infer M, infer C>
                      ? keyof M extends never
                          ? { [key: string]: InferInputType<C> } & {
                                $cid?: string;
                            }
                          : ({ [K in keyof M]: InferInputType<M[K]> } & {
                                [K in Exclude<
                                    string,
                                    keyof M
                                >]: InferInputType<C>;
                            }) & { $cid?: string }
                      : S extends LoroMapSchema<infer M>
                        ? { [K in keyof M]: InferInputType<M[K]> } & {
                              $cid?: string;
                          }
                        : S extends LoroListSchema<infer I>
                          ? Array<InferInputType<I>>
                          : S extends LoroMovableListSchema<infer I>
                            ? Array<InferInputType<I>>
                            : S extends LoroTreeSchema<infer M>
                              ? Array<InferInputTreeNodeType<M>>
                              : S extends RootSchemaType<infer R>
                                ? { [K in keyof R]: InferInputType<R[K]> }
                                : never;

/**
 * Helper: Infer the node type for a tree schema
 */
export type InferTreeNodeType<M extends Record<string, SchemaType>> = {
    id: string;
    data: { [K in keyof M]: InferType<M[K]> };
    children: Array<InferTreeNodeType<M>>;
};

/**
 * Helper: Infer the node type for a tree schema whose node.data map includes $cid
 */
export type InferTreeNodeTypeWithCid<M extends Record<string, SchemaType>> = {
    id: string;
    data: { [K in keyof M]: InferType<M[K]> } & { $cid: string };
    children: Array<InferTreeNodeTypeWithCid<M>>;
};

/**
 * Helper: Input node type for a tree schema (node.data has optional $cid)
 */
export type InferInputTreeNodeType<M extends Record<string, SchemaType>> = {
    id: string;
    data: { [K in keyof M]: InferInputType<M[K]> } & { $cid?: string };
    children: Array<InferInputTreeNodeType<M>>;
};

/**
 * Equality comparison strategy for transformed values.
 *
 * Reference equality is ALWAYS checked first.
 * This setting controls what happens when references differ.
 *
 * - "reference-equality" (default): If refs differ, treat as not equal (no encoding).
 *   Correct for Immer-draftable types, immutable types, and copy-on-change patterns.
 *   Fast because no encoding is needed.
 *
 * - "encoded-value-equality": If refs differ, encode both and compare.
 *   Use when you may have different objects with the same encoded value
 *   and want to avoid redundant updates.
 *
 * - "deep-equality": If refs differ, perform a deep equality check on the domain values.
 *   This is rarely needed as Immer-draftable objects typically maintain reference equality when unchanged,
 *   but can be useful for non-Immer-managed objects that are slow to encode and have no simple equality check.
 *
 * - Custom function: Your own comparison logic. Receives the domain values.
 */
export type EqualityStrategy<DomainType> =
    | "reference-equality"
    | "encoded-value-equality"
    | "deep-equality"
    | ((a: DomainType, b: DomainType) => boolean);

/**
 * Transform definition for bidirectional conversion between CRDT primitives and domain types.
 * It is strongly recommend that DomainType is immutable or
 * [supported by Immer](https://immerjs.github.io/immer/complex-objects/) otherwise changes to transformed
 * values may not be detected and converted to CRDT operations. Never mutate DomainType instances
 * outside of Loro Mirror's setState function. CRDTType and DomainType can be null or undefined, but decode/encode functions
 * will never receive null/undefined - they pass through as-is. Validation is performed on the domain type after transformation
 * (or more precisely, validation on domain types happens before encoding).
 */
export interface TransformDefinition<CRDTType, DomainType> {
    /**
     * Convert CRDT primitive to domain type.
     * Never called with null/undefined - they pass through as-is.
     */
    decode: (value: CRDTType & {}) => DomainType & {};

    /**
     * Convert domain type to CRDT primitive.
     * Never called with null/undefined - they pass through as-is.
     */
    encode: (value: DomainType & {}) => CRDTType & {};

    /**
     * Validate the domain value.
     * Called during schema validation after null/undefined checks pass.
     * Return true if valid, or a string error message if invalid.
     * The validate function passed to schema.String | Number | Boolean will also be called.
     */
    validate?: (value: DomainType & {}) => boolean | string;

    /**
     * How to compare domain values for equality.
     *
     * Reference equality (===) is always checked first.
     * This setting controls behavior when references differ.
     *
     * @default "reference-equality"
     */
    isEqual?: EqualityStrategy<DomainType>;

    /**
     * Whether to validate that encode() returns the correct CRDT type during schema validation.
     * When true, encode() is called on every validation to check the return type.
     * When false, encode type checking is skipped for better performance.
     *
     * @default false
     */
    validateEncodedType?: boolean;
}

/**
 * Add | undefined to T if schema is optional (required: false).
 * Used by InferType to add optionality to both transformed and non-transformed fields.
 */
type WithOptionality<T, S extends SchemaType> =
    IsSchemaRequired<S> extends false ? T | undefined : T;

type WithTransformStartupOptionality<T, S extends SchemaType> =
    IsSchemaRequired<S> extends false
        ? T | undefined
        : HasExplicitDefaultValue<S> extends true
          ? T
          : T | undefined;

type InferStringType<S extends SchemaType> = S extends {
    transform: TransformDefinition<infer _C, infer D>;
}
    ? WithOptionality<D, S>
    : S extends StringSchemaType<infer T>
      ? WithOptionality<T, S>
      : WithOptionality<string, S>;

type InferNumberType<S extends SchemaType> = S extends {
    transform: TransformDefinition<infer _C, infer D>;
}
    ? WithOptionality<D, S>
    : WithOptionality<number, S>;

type InferBooleanType<S extends SchemaType> = S extends {
    transform: TransformDefinition<infer _C, infer D>;
}
    ? WithOptionality<D, S>
    : WithOptionality<boolean, S>;
