import { describe, it, expect } from "vitest";
import { schema, validateSchema, getDefaultValue } from "../src/index.js";
import {
    isLoroUnionSchema,
    isContainerSchema,
} from "../src/schema/validators.js";

describe("schema.Union", () => {
    const blockSchema = schema.Union("type", {
        paragraph: schema.LoroMap({ text: schema.String() }),
        image: schema.LoroMap({ src: schema.String(), alt: schema.String() }),
    });

    describe("type guards", () => {
        it("isLoroUnionSchema returns true for union schemas", () => {
            expect(isLoroUnionSchema(blockSchema)).toBe(true);
        });

        it("isLoroUnionSchema returns false for non-union schemas", () => {
            expect(isLoroUnionSchema(schema.LoroMap({}))).toBe(false);
            expect(isLoroUnionSchema(schema.String())).toBe(false);
            expect(isLoroUnionSchema(undefined)).toBe(false);
        });

        it("isContainerSchema returns true for union schemas", () => {
            expect(isContainerSchema(blockSchema)).toBe(true);
        });
    });

    describe("validation", () => {
        it("validates a correct paragraph variant", () => {
            const result = validateSchema(blockSchema, {
                type: "paragraph",
                text: "Hello",
            });
            expect(result.valid).toBe(true);
        });

        it("validates a correct image variant", () => {
            const result = validateSchema(blockSchema, {
                type: "image",
                src: "photo.png",
                alt: "A photo",
            });
            expect(result.valid).toBe(true);
        });

        it("rejects non-object values", () => {
            const result = validateSchema(blockSchema, "not an object");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Value must be an object");
        });

        it("rejects missing discriminant", () => {
            const result = validateSchema(blockSchema, { text: "Hello" });
            expect(result.valid).toBe(false);
            expect(result.errors?.[0]).toContain("must be a string");
        });

        it("rejects unknown variant", () => {
            const result = validateSchema(blockSchema, {
                type: "video",
                url: "test.mp4",
            });
            expect(result.valid).toBe(false);
            expect(result.errors?.[0]).toContain("Unknown variant");
            expect(result.errors?.[0]).toContain("paragraph");
            expect(result.errors?.[0]).toContain("image");
        });

        it("rejects variant with invalid fields", () => {
            const result = validateSchema(blockSchema, {
                type: "paragraph",
                text: 123,
            });
            expect(result.valid).toBe(false);
            expect(result.errors?.[0]).toContain("text");
        });
    });

    describe("default values", () => {
        it("returns undefined (no implicit default for unions)", () => {
            expect(getDefaultValue(blockSchema)).toBeUndefined();
        });

        it("respects explicit defaultValue", () => {
            const withDefault = schema.Union(
                "type",
                {
                    paragraph: schema.LoroMap({ text: schema.String() }),
                },
                { defaultValue: { type: "paragraph", text: "" } },
            );
            expect(getDefaultValue(withDefault)).toEqual({
                type: "paragraph",
                text: "",
            });
        });
    });
});
