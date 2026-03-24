import { describe, it, expect, vi } from "vitest";
import { schema } from "../src/schema/index.js";
import { Mirror } from "../src/core/mirror.js";
import { LoroDoc } from "loro-crdt";
import {
    validateSchema,
    getDefaultValue,
    createValueFromSchema,
} from "../src/schema/validators.js";

describe("validateSchema with transforms", () => {
    const dateTransform = {
        decode: (s: string) => new Date(s),
        encode: (d: Date) => d.toISOString(),
    };

    it("validates transformed string by encoding first", () => {
        const s = schema({
            record: schema.LoroMap({
                date: schema.String().transform(dateTransform),
            }),
        });
        const result = validateSchema(s, {
            record: { date: new Date("2024-01-01") },
        });
        expect(result.valid).toBe(true);
    });

    it("rejects when encode returns wrong type for string", () => {
        const badTransform = {
            decode: (s: string) => parseInt(s),
            encode: (n: number) => n as any,
            validateEncodedType: true, // Enable encode type checking
        };
        const s = schema({
            record: schema.LoroMap({
                value: schema.String().transform(badTransform),
            }),
        });
        const result = validateSchema(s, { record: { value: 42 } });
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.includes("string"))).toBe(true);
    });

    it("validates transformed number by encoding first", () => {
        const transform = {
            decode: (n: number) => `${n}%`,
            encode: (s: string) => parseFloat(s),
        };
        const s = schema({
            record: schema.LoroMap({
                percent: schema.Number().transform(transform),
            }),
        });
        const result = validateSchema(s, { record: { percent: "50%" } });
        expect(result.valid).toBe(true);
    });

    it("validates transformed boolean by encoding first", () => {
        const transform = {
            decode: (b: boolean) => (b ? "yes" : "no"),
            encode: (s: string) => s === "yes",
        };
        const s = schema({
            record: schema.LoroMap({
                flag: schema.Boolean().transform(transform),
            }),
        });
        const result = validateSchema(s, { record: { flag: "yes" } });
        expect(result.valid).toBe(true);
    });

    it("returns a validation error when validateEncodedType encode throws", () => {
        const s = schema({
            record: schema.LoroMap({
                date: schema.String().transform({
                    decode: (value: string) => new Date(value),
                    encode: (value: Date) => value.toISOString(),
                    validateEncodedType: true,
                }),
            }),
        });

        const result = validateSchema(s, {
            record: { date: "not-a-date-object" },
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(
            result.errors!.some((error) =>
                error.includes("Transform encode validation error"),
            ),
        ).toBe(true);
    });
});

describe("custom validate functions", () => {
    const dateTransformWithValidate = {
        decode: (s: string) => new Date(s),
        encode: (d: Date) => d.toISOString(),
        validate: (d: Date) => {
            if (d.getFullYear() >= 2020) return true;
            return "Year must be >= 2020";
        },
    };

    it("transform.validate receives domain value and passes", () => {
        const s = schema({
            record: schema.LoroMap({
                date: schema.String().transform(dateTransformWithValidate),
            }),
        });
        const result = validateSchema(s, {
            record: { date: new Date("2024-06-15") },
        });
        expect(result.valid).toBe(true);
    });

    it("transform.validate rejects with string error", () => {
        const s = schema({
            record: schema.LoroMap({
                date: schema.String().transform(dateTransformWithValidate),
            }),
        });
        const result = validateSchema(s, {
            record: { date: new Date("2019-01-01") },
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.includes("Year must be >= 2020"))).toBe(true);
    });

    it("transform.validate rejects with false", () => {
        const rejectTransform = {
            decode: (s: string) => new Date(s),
            encode: (d: Date) => d.toISOString(),
            validate: () => false,
        };
        const s = schema({
            record: schema.LoroMap({
                date: schema.String().transform(rejectTransform),
            }),
        });
        const result = validateSchema(s, {
            record: { date: new Date("2024-01-01") },
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.includes("Transform validation failed"))).toBe(true);
    });

    it("schema.options.validate receives domain value on transformed field", () => {
        const s = schema({
            record: schema.LoroMap({
                date: schema
                    .String({
                        validate: (v: unknown) =>
                            v instanceof Date ? true : "Expected a Date",
                    })
                    .transform({
                        decode: (s: string) => new Date(s),
                        encode: (d: Date) => d.toISOString(),
                    }),
            }),
        });
        const result = validateSchema(s, {
            record: { date: new Date("2024-06-15") },
        });
        expect(result.valid).toBe(true);
    });

    it("schema.options.validate rejects domain value", () => {
        const s = schema({
            record: schema.LoroMap({
                date: schema
                    .String({
                        validate: (v: unknown) =>
                            v instanceof Date ? true : "Expected a Date",
                    })
                    .transform({
                        decode: (s: string) => new Date(s),
                        encode: (d: Date) => d.toISOString(),
                    }),
            }),
        });
        // Pass a string instead of a Date — schema.options.validate should reject it
        const result = validateSchema(s, {
            record: { date: "not-a-date" as any },
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.includes("Expected a Date"))).toBe(true);
    });
});

describe("getDefaultValue with transforms", () => {
    it("does not decode synthetic defaults for required transformed primitives", () => {
        const decode = vi.fn((value: string) => {
            throw new Error(`unexpected decode: ${value}`);
        });
        const fieldSchema = schema.String({ required: true }).transform({
            decode,
            encode: (date: Date) => date.toISOString(),
        });

        expect(getDefaultValue(fieldSchema)).toBeUndefined();
        expect(decode).not.toHaveBeenCalled();
    });

    it("still uses explicit defaultValue for transformed primitives", () => {
        const fallback = new Date("2025-01-01T00:00:00.000Z");
        const fieldSchema = schema
            .String({
                required: true,
                defaultValue: fallback,
            })
            .transform({
                decode: (value: string) => new Date(value),
                encode: (value: Date) => value.toISOString(),
            });

        expect(getDefaultValue(fieldSchema)).toBe(fallback);
    });
});

describe("createValueFromSchema with transforms", () => {
    it("decodes transformed primitive values before returning them", () => {
        const fieldSchema = schema.String().transform({
            decode: (value: string) => new Date(value),
            encode: (value: Date) => value.toISOString(),
        });

        const result = createValueFromSchema(
            fieldSchema,
            "2025-03-24T12:34:56.000Z",
        );

        expect(result).toBeInstanceOf(Date);
        expect(result!.toISOString()).toBe("2025-03-24T12:34:56.000Z");
    });

    it("passes through nullish values for transformed primitives", () => {
        const fieldSchema = schema.String({ required: false }).transform({
            decode: (value: string) => new Date(value),
            encode: (value: Date) => value.toISOString(),
        });

        expect(createValueFromSchema(fieldSchema, undefined)).toBeUndefined();
        expect(createValueFromSchema(fieldSchema, null)).toBeNull();
    });
});

describe("getDefaultValue without transforms", () => {
    it("keeps built-in defaults for required primitives", () => {
        expect(getDefaultValue(schema.String({ required: true }))).toBe("");
        expect(getDefaultValue(schema.Number({ required: true }))).toBe(0);
        expect(getDefaultValue(schema.Boolean({ required: true }))).toBe(
            false,
        );
    });
});

describe("startup semantics for transformed required primitives", () => {
    it("omits the field on an empty doc when no defaultValue is provided", () => {
        const doc = new LoroDoc();
        const testSchema = schema({
            record: schema.LoroMap({
                date: schema.String({ required: true }).transform({
                    decode: (value: string) => new Date(value),
                    encode: (value: Date) => value.toISOString(),
                }),
            }),
        });

        const mirror = new Mirror({ doc, schema: testSchema });

        expect("date" in mirror.getState().record).toBe(false);
    });
});
