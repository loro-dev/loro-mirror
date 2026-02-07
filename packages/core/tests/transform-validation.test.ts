import { describe, it, expect } from "vitest";
import { schema } from "../src/schema/index.js";
import { validateSchema, getDefaultValue } from "../src/schema/validators.js";

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
    it("applies decode to empty string default", () => {
        const transform = {
            decode: (s: string) => s.length,
            encode: (n: number) => "x".repeat(n),
        };
        const fieldSchema = schema
            .String({ required: true })
            .transform(transform);
        expect(getDefaultValue(fieldSchema)).toBe(0);
    });

    it("applies decode to zero default for number", () => {
        const transform = {
            decode: (n: number) => (n === 0 ? "zero" : "nonzero"),
            encode: (s: string) => (s === "zero" ? 0 : 1),
        };
        const fieldSchema = schema
            .Number({ required: true })
            .transform(transform);
        expect(getDefaultValue(fieldSchema)).toBe("zero");
    });

    it("applies decode to false default for boolean", () => {
        const transform = {
            decode: (b: boolean) => (b ? "ON" : "OFF"),
            encode: (s: string) => s === "ON",
        };
        const fieldSchema = schema
            .Boolean({ required: true })
            .transform(transform);
        expect(getDefaultValue(fieldSchema)).toBe("OFF");
    });
});
