/**
 * Types for the schema definition system
 */

import { ContainerType } from "loro-crdt";

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
	/** Additional validation function */
	validate?: (value: unknown) => boolean | string;
	/** Whether to inject $cid into the mirrored state */
	withCid?: boolean;
	[key: string]: unknown;
}

/**
 * Base interface for all schema types
 */
export interface BaseSchemaType {
	type: string;
	options: SchemaOptions;
	getContainerType(): ContainerType | null;
}

/**
 * String schema type
 */
export interface StringSchemaType<T extends string = string> extends BaseSchemaType {
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
export interface LoroMapSchema<T extends Record<string, SchemaType>>
	extends BaseSchemaType {
	type: "loro-map";
	definition: SchemaDefinition<T>;
}

/**
 * Enhanced LoroMapSchema with catchall support
 */
export interface LoroMapSchemaWithCatchall<
	T extends Record<string, SchemaType>,
	C extends SchemaType
> extends BaseSchemaType {
	type: "loro-map";
	definition: SchemaDefinition<T>;
	catchallType: C;
	catchall<NewC extends SchemaType>(catchallSchema: NewC): LoroMapSchemaWithCatchall<T, NewC>;
}

/**
 * Loro List schema type
 */
export interface LoroListSchema<T extends SchemaType> extends BaseSchemaType {
	type: "loro-list";
	itemSchema: T;
	// oxlint-disable-next-line no-explicit-any
	idSelector?: (item: any) => string;
}

/**
 * Loro Movable List schema type
 */
export interface LoroMovableListSchema<T extends SchemaType>
	extends BaseSchemaType {
	type: "loro-movable-list";
	itemSchema: T;
	// oxlint-disable-next-line no-explicit-any
	idSelector?: (item: any) => string;
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
export interface LoroTreeSchema<T extends Record<string, SchemaType>>
	extends BaseSchemaType {
	type: "loro-tree";
	nodeSchema: LoroMapSchema<T>;
}

/**
 * Root schema type
 */
export interface RootSchemaType<T extends Record<string, ContainerSchemaType>>
	extends BaseSchemaType {
	type: "schema";
	definition: RootSchemaDefinition<T>;
}

/**
 * Union of all schema types
 */
export type SchemaType =
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
	| RootSchemaType<Record<string, ContainerSchemaType>>;

export type ContainerSchemaType =
	| LoroMapSchema<Record<string, SchemaType>>
	| LoroMapSchemaWithCatchall<Record<string, SchemaType>, SchemaType>
	| LoroListSchema<SchemaType>
	| LoroMovableListSchema<SchemaType>
	| LoroTextSchemaType
	| LoroTreeSchema<Record<string, SchemaType>>;

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
type IsSchemaRequired<S extends SchemaType> =
	S extends { options: { required: true } } ? true
	: S extends { options: { required: false } } ? false
	: S extends { options: { required?: undefined } } ? true
	: S extends { options: {} } ? true
	: true;

/**
 * Infer the JavaScript type from a schema type
 */
export type InferType<S extends SchemaType> =
	IsSchemaRequired<S> extends false
	? (
		S extends StringSchemaType<infer T>
		? T | undefined
		: S extends NumberSchemaType
		? number | undefined
		: S extends BooleanSchemaType
		? boolean | undefined
		: S extends IgnoreSchemaType
		? any
		: S extends LoroTextSchemaType
		? string | undefined
		: S extends (LoroMapSchemaWithCatchall<infer M, infer C> & { options: { withCid: true } })
		? (keyof M extends never
			? ({ [key: string]: InferType<C> } & { $cid: string }) | undefined
			: (({ [K in keyof M]: InferType<M[K]> } & { [K in Exclude<string, keyof M>]: InferType<C> }) & { $cid: string }) | undefined)
		: S extends (LoroMapSchema<infer M> & { options: { withCid: true } })
		? ({ [K in keyof M]: InferType<M[K]> } & { $cid: string }) | undefined
		: S extends LoroMapSchemaWithCatchall<infer M, infer C>
		? (keyof M extends never
			? { [key: string]: InferType<C> } | undefined
			: ({ [K in keyof M]: InferType<M[K]> } & {
				[K in Exclude<string, keyof M>]: InferType<C>;
			}) | undefined)
		: S extends LoroMapSchema<infer M>
		? { [K in keyof M]: InferType<M[K]> } | undefined
		: S extends LoroListSchema<infer I>
		? Array<InferType<I>> | undefined
		: S extends LoroMovableListSchema<infer I>
		? Array<InferType<I>> | undefined
		: S extends (LoroTreeSchema<infer M> & { nodeSchema: { options: { withCid: true } } })
		? Array<InferTreeNodeTypeWithCid<M>> | undefined
		: S extends LoroTreeSchema<infer M>
		? Array<InferTreeNodeType<M>> | undefined
		: S extends RootSchemaType<infer R>
		? { [K in keyof R]: InferType<R[K]> } | undefined
		: never
	)
	: (
		S extends StringSchemaType<infer T>
		? T
		: S extends NumberSchemaType
		? number
		: S extends BooleanSchemaType
		? boolean
		: S extends IgnoreSchemaType
		? any
		: S extends LoroTextSchemaType
		? string
		: S extends (LoroMapSchemaWithCatchall<infer M, infer C> & { options: { withCid: true } })
		? keyof M extends never
		? ({ [key: string]: InferType<C> } & { $cid: string })
		: (({ [K in keyof M]: InferType<M[K]> } & { [K in Exclude<string, keyof M>]: InferType<C> }) & { $cid: string })
		: S extends (LoroMapSchema<infer M> & { options: { withCid: true } })
		? ({ [K in keyof M]: InferType<M[K]> } & { $cid: string })
		: S extends LoroMapSchemaWithCatchall<infer M, infer C>
		? keyof M extends never
		? { [key: string]: InferType<C> }
		: { [K in keyof M]: InferType<M[K]> } & {
			[K in Exclude<string, keyof M>]: InferType<C>;
		}
		: S extends LoroMapSchema<infer M>
		? { [K in keyof M]: InferType<M[K]> }
		: S extends LoroListSchema<infer I>
		? Array<InferType<I>>
		: S extends LoroMovableListSchema<infer I>
		? Array<InferType<I>>
		: S extends (LoroTreeSchema<infer M> & { nodeSchema: { options: { withCid: true } } })
		? Array<InferTreeNodeTypeWithCid<M>>
		: S extends LoroTreeSchema<infer M>
		? Array<InferTreeNodeType<M>>
		: S extends RootSchemaType<infer R>
		? { [K in keyof R]: InferType<R[K]> }
		: never
	);

/**
 * Infer the JavaScript type from a schema definition
 */
export type InferSchemaType<T extends Record<string, SchemaType>> = {
	[K in keyof T]: InferType<T[K]>;
};

/**
 * Helper: Infer the node type for a tree schema
 */
export type InferTreeNodeType<M extends Record<string, SchemaType>> = {
	id: string;
	data: { [K in keyof M]: InferType<M[K]> };
	children: Array<InferTreeNodeType<M>>;
};

/**
 * Helper: Infer the node type for a tree schema whose node.data map has withCid enabled
 */
export type InferTreeNodeTypeWithCid<M extends Record<string, SchemaType>> = {
	id: string;
	data: ({ [K in keyof M]: InferType<M[K]> } & { $cid: string });
	children: Array<InferTreeNodeTypeWithCid<M>>;
};
