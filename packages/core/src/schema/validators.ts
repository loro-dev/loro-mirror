/**
 * Validators for schema definitions
 */
import {
    BaseSchemaType,
    InferType,
    LoroListSchema,
    LoroMapSchema,
    RootSchemaType,
    SchemaType,
} from "./types";
import { isObject } from "../core/utils";

/**
 * Type for a wrapped primitive value
 */
export interface WrappedValue<T> {
    value: T;
}

/**
 * Type guard to check if a value is a wrapped primitive
 */
export function isWrappedValue<T>(val: unknown): val is WrappedValue<T> {
    return isObject(val) && "value" in val && Object.keys(val).length === 1;
}

/**
 * Safely get the primitive value, whether it's wrapped or not
 */
export function getPrimitiveValue<T>(val: T | WrappedValue<T> | unknown): T {
    if (isWrappedValue<T>(val)) {
        return val.value;
    }
    return val as T;
}

/**
 * Create a wrapped value from a primitive
 */
export function createWrappedValue<T>(value: T): WrappedValue<T> {
    return { value };
}

/**
 * Type guard for LoroMapSchema
 */
function isLoroMapSchema<T extends Record<string, SchemaType<unknown>>>(
    schema: SchemaType<unknown>,
): schema is LoroMapSchema<T> {
    return (schema as BaseSchemaType<unknown>).type === "loro-map";
}

/**
 * Type guard for LoroListSchema
 */
function isLoroListSchema<T extends SchemaType<unknown>>(
    schema: SchemaType<unknown>,
): schema is LoroListSchema<T> {
    return (schema as BaseSchemaType<unknown>).type === "loro-list";
}

/**
 * Type guard for RootSchemaType
 */
function isRootSchemaType<T extends Record<string, SchemaType<unknown>>>(
    schema: SchemaType<unknown>,
): schema is RootSchemaType<T> {
    return (schema as BaseSchemaType<unknown>).type === "schema";
}

/**
 * Validate a value against a schema
 */
export function validateSchema<S extends SchemaType<unknown>>(
    schema: S,
    value: unknown,
): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    // Check if value is required
    if (schema.options.required && (value === undefined || value === null)) {
        errors.push("Value is required");
        return { valid: false, errors };
    }

    // If value is undefined or null and not required, it's valid
    if (value === undefined || value === null) {
        return { valid: true };
    }

    // Unwrap value if it's a wrapped primitive
    const unwrappedValue = isWrappedValue<unknown>(value) ? value.value : value;

    // Validate based on schema type
    switch ((schema as BaseSchemaType<unknown>).type) {
        case "string":
            if (typeof unwrappedValue !== "string") {
                errors.push("Value must be a string");
            }
            break;

        case "number":
            if (typeof unwrappedValue !== "number") {
                errors.push("Value must be a number");
            }
            break;

        case "boolean":
            if (typeof unwrappedValue !== "boolean") {
                errors.push("Value must be a boolean");
            }
            break;

        case "ignore":
            // Ignored fields are always valid
            break;

        case "loro-text":
            if (typeof unwrappedValue !== "string") {
                errors.push("Content must be a string");
            }
            break;

        case "loro-map":
            if (!isObject(unwrappedValue)) {
                errors.push("Value must be an object");
            } else if (isLoroMapSchema(schema)) {
                // Validate each property in the map
                for (const key in schema.definition) {
                    if (
                        Object.prototype.hasOwnProperty.call(
                            schema.definition,
                            key,
                        )
                    ) {
                        const propSchema = schema.definition[key];
                        const propValue =
                            (unwrappedValue as Record<string, unknown>)[key];

                        const result = validateSchema(propSchema, propValue);
                        if (!result.valid && result.errors) {
                            // Prepend property name to each error
                            const prefixedErrors = result.errors.map((err) =>
                                `${key}: ${err}`
                            );
                            errors.push(...prefixedErrors);
                        }
                    }
                }
            }
            break;

        case "loro-list":
            if (!Array.isArray(unwrappedValue)) {
                errors.push("Value must be an array");
            } else if (isLoroListSchema(schema)) {
                // Validate each item in the list
                unwrappedValue.forEach((item, index) => {
                    const result = validateSchema(schema.itemSchema, item);
                    if (!result.valid && result.errors) {
                        // Prepend array index to each error
                        const prefixedErrors = result.errors.map((err) =>
                            `Item ${index}: ${err}`
                        );
                        errors.push(...prefixedErrors);
                    }
                });
            }
            break;

        case "schema":
            if (!isObject(unwrappedValue)) {
                errors.push("Value must be an object");
            } else if (isRootSchemaType(schema)) {
                // Validate each property in the schema
                for (const key in schema.definition) {
                    if (
                        Object.prototype.hasOwnProperty.call(
                            schema.definition,
                            key,
                        )
                    ) {
                        const propSchema = schema.definition[key];
                        const propValue =
                            (unwrappedValue as Record<string, unknown>)[key];

                        const result = validateSchema(propSchema, propValue);
                        if (!result.valid && result.errors) {
                            // Prepend property name to each error
                            const prefixedErrors = result.errors.map((err) =>
                                `${key}: ${err}`
                            );
                            errors.push(...prefixedErrors);
                        }
                    }
                }
            }
            break;

        default:
            errors.push(
                `Unknown schema type: ${
                    (schema as BaseSchemaType<unknown>).type
                }`,
            );
    }

    // Run custom validation if provided
    if (
        schema.options.validate && typeof schema.options.validate === "function"
    ) {
        try {
            const customValidation = schema.options.validate(unwrappedValue);
            if (customValidation !== true) {
                const errorMessage = typeof customValidation === "string"
                    ? customValidation
                    : "Value failed custom validation";
                errors.push(errorMessage);
            }
        } catch (error) {
            errors.push(`Validation error: ${String(error)}`);
        }
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Get default value for a schema
 * Based on the schema type, it might return a plain value or a wrapped value
 */
export function getDefaultValue<S extends SchemaType<unknown>>(
    schema: S,
    wrapPrimitives = false,
): InferType<S> | undefined {
    // If a default value is provided in options, use it
    if ("defaultValue" in schema.options) {
        const defaultValue = schema.options.defaultValue;

        // For primitive schema types, wrap the value if requested
        if (wrapPrimitives) {
            const schemaType = (schema as BaseSchemaType<unknown>).type;
            if (
                schemaType === "string" || schemaType === "number" ||
                schemaType === "boolean"
            ) {
                return { value: defaultValue } as InferType<S>;
            }
        }

        return defaultValue as InferType<S>;
    }

    // Otherwise, create a default based on the schema type
    const schemaType = (schema as BaseSchemaType<unknown>).type;

    switch (schemaType) {
        case "string": {
            const value = schema.options.required ? "" : undefined;
            if (value === undefined) return undefined;
            return wrapPrimitives
                ? { value } as InferType<S>
                : value as InferType<S>;
        }

        case "number": {
            const value = schema.options.required ? 0 : undefined;
            if (value === undefined) return undefined;
            return wrapPrimitives
                ? { value } as InferType<S>
                : value as InferType<S>;
        }

        case "boolean": {
            const value = schema.options.required ? false : undefined;
            if (value === undefined) return undefined;
            return wrapPrimitives
                ? { value } as InferType<S>
                : value as InferType<S>;
        }

        case "loro-text": {
            const value = schema.options.required ? "" : undefined;
            if (value === undefined) return undefined;
            return wrapPrimitives
                ? { value } as InferType<S>
                : value as InferType<S>;
        }

        case "loro-map": {
            if (isLoroMapSchema(schema)) {
                const result: Record<string, unknown> = {};
                for (const key in schema.definition) {
                    if (
                        Object.prototype.hasOwnProperty.call(
                            schema.definition,
                            key,
                        )
                    ) {
                        const value = getDefaultValue(
                            schema.definition[key],
                            wrapPrimitives,
                        );
                        if (value !== undefined) {
                            result[key] = value;
                        }
                    }
                }
                return result as InferType<S>;
            }
            return {} as InferType<S>;
        }

        case "loro-list":
            return [] as InferType<S>;

        case "schema": {
            if (isRootSchemaType(schema)) {
                const result: Record<string, unknown> = {};
                for (const key in schema.definition) {
                    if (
                        Object.prototype.hasOwnProperty.call(
                            schema.definition,
                            key,
                        )
                    ) {
                        const value = getDefaultValue(
                            schema.definition[key],
                            wrapPrimitives,
                        );
                        if (value !== undefined) {
                            result[key] = value;
                        }
                    }
                }
                return result as InferType<S>;
            }
            return {} as InferType<S>;
        }

        default:
            return undefined;
    }
}

/**
 * Determines if the schema uses wrapped primitive values
 */
export function schemaUsesWrappedValues(schema: SchemaType<unknown>): boolean {
    // This could be extended with more complex logic based on schema configuration
    return true; // Default to true for backward compatibility
}

/**
 * Creates a properly typed value based on the schema
 * This ensures consistency between schema types and runtime values
 */
export function createValueFromSchema<S extends SchemaType<unknown>>(
    schema: S,
    value: unknown,
): InferType<S> {
    // Determine if this schema should use wrapped values
    const useWrapped = schemaUsesWrappedValues(schema);

    // For primitive types, handle wrapping consistently
    const schemaType = (schema as BaseSchemaType<unknown>).type;

    if (
        schemaType === "string" || schemaType === "number" ||
        schemaType === "boolean"
    ) {
        if (useWrapped) {
            // If the value is already wrapped, return it
            if (isWrappedValue(value)) {
                return value as InferType<S>;
            }
            // Otherwise, wrap it
            return { value } as InferType<S>;
        } else {
            // If we need an unwrapped value but have a wrapped one
            if (isWrappedValue(value)) {
                return value.value as InferType<S>;
            }
            // Otherwise return as is
            return value as InferType<S>;
        }
    }

    // For complex types, pass through as is
    return value as InferType<S>;
}
