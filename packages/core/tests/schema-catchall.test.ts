/**
 * Test for schema catchall functionality
 */
import { describe, it, expect } from "vitest";
import { schema } from "../src/schema";

describe("Schema Catchall Functionality", () => {
    it("should create a schema with catchall support", () => {
        const mixedSchema = schema
            .LoroMap({
                name: schema.String({ required: true }),
                age: schema.Number(),
            })
            .catchall(schema.String());

        expect(mixedSchema.type).toBe("loro-map");
        expect(mixedSchema.definition).toEqual({
            name: expect.objectContaining({ type: "string" }),
            age: expect.objectContaining({ type: "number" }),
        });
        expect(mixedSchema.catchallType).toEqual(
            expect.objectContaining({ type: "string" }),
        );
    });

    it("should create a pure dynamic record schema", () => {
        const dynamicSchema = schema.LoroMapRecord(schema.String());

        expect(dynamicSchema.type).toBe("loro-map");
        expect(dynamicSchema.definition).toEqual({});
        expect(dynamicSchema.catchallType).toEqual(
            expect.objectContaining({ type: "string" }),
        );
    });

    it("should support chaining catchall calls", () => {
        const baseSchema = schema.LoroMap({
            fixedField: schema.String(),
        });

        const withStringCatchall = baseSchema.catchall(schema.String());
        const withNumberCatchall = withStringCatchall.catchall(schema.Number());

        expect(withStringCatchall.catchallType).toEqual(
            expect.objectContaining({ type: "string" }),
        );
        expect(withNumberCatchall.catchallType).toEqual(
            expect.objectContaining({ type: "number" }),
        );
    });

    it("should support nested schemas with catchall", () => {
        const nestedSchema = schema
            .LoroMap({
                user: schema
                    .LoroMap({
                        name: schema.String(),
                    })
                    .catchall(schema.String()),
            })
            .catchall(
                schema.LoroMap({
                    value: schema.Number(),
                }),
            );

        expect(nestedSchema.type).toBe("loro-map");
        expect(nestedSchema.definition.user).toEqual(
            expect.objectContaining({
                type: "loro-map",
                catchallType: expect.objectContaining({ type: "string" }),
            }),
        );
        expect(nestedSchema.catchallType).toEqual(
            expect.objectContaining({
                type: "loro-map",
                definition: expect.objectContaining({
                    value: expect.objectContaining({ type: "number" }),
                }),
            }),
        );
    });

    it("should work with Record schema chaining", () => {
        const recordSchema = schema.LoroMapRecord(schema.String());
        const newRecordSchema = recordSchema.catchall(schema.Number());

        expect(recordSchema.catchallType).toEqual(
            expect.objectContaining({ type: "string" }),
        );
        expect(newRecordSchema.catchallType).toEqual(
            expect.objectContaining({ type: "number" }),
        );
    });
});
