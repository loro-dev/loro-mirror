import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror } from "../src/core/mirror";
import { schema, validateSchema } from "../src/schema";
import * as schemaModule from "../src/schema";

describe("schema validator caching", () => {
    let doc: LoroDoc;
    const metaDefaults = {
        name: "Default Name",
        count: 0,
    };
    const schemaDefinition = schema({
        meta: schema.LoroMap({
            name: schema.String({ defaultValue: metaDefaults.name }),
            count: schema.Number({ defaultValue: metaDefaults.count }),
        }),
    });
    const metaSchema = schemaDefinition.definition.meta;

    beforeEach(() => {
        doc = new LoroDoc();
        const metaMap = doc.getMap("meta");
        metaMap.set("name", metaDefaults.name);
        metaMap.set("count", metaDefaults.count);
        doc.commit();
    });

    it("reuses validations for unchanged state objects across setState calls", () => {
        const validateSpy = vi.spyOn(schemaModule, "validateSchema");
        const originalValidate = metaSchema.options.validate;
        const metaValidateSpy = vi.fn(() => true);
        (
            metaSchema.options as typeof metaSchema.options & {
                validate?: (value: unknown) => boolean | string;
            }
        ).validate = metaValidateSpy;

        try {
            const mirror = new Mirror({
                doc,
                schema: schemaDefinition,
            });

            validateSpy.mockClear();
            metaValidateSpy.mockClear();

            mirror.setState((state) => ({
                ...state,
                meta: { ...state.meta, name: "Reviewed" },
            }));

            expect(metaValidateSpy.mock.calls.length).toBeGreaterThan(0);

            validateSpy.mockClear();
            metaValidateSpy.mockClear();

            mirror.setState((state) => state);

            expect(validateSpy.mock.calls.length).toBe(1);
            expect(metaValidateSpy).not.toHaveBeenCalled();

            validateSpy.mockClear();
            metaValidateSpy.mockClear();

            mirror.setState((state) => ({
                ...state,
                meta: { ...state.meta, count: state.meta.count + 1 },
            }));

            expect(metaValidateSpy.mock.calls.length).toBe(1);
            expect(validateSpy.mock.calls.length).toBe(1);
        } finally {
            validateSpy.mockRestore();
            metaSchema.options.validate = originalValidate;
        }
    });
});

describe("validateSchema detects violations", () => {
    it("rejects non-string for string schema", () => {
        const stringSchema = schema.String({ required: true });
        expect(validateSchema(stringSchema, "ok").valid).toBe(true);
        const invalid = validateSchema(stringSchema, 42);
        expect(invalid.valid).toBe(false);
        expect(invalid.errors).toBeDefined();
    });

    it("rejects non-number for number schema", () => {
        const numberSchema = schema.Number({ required: true });
        expect(validateSchema(numberSchema, 1).valid).toBe(true);
        const invalid = validateSchema(numberSchema, "1");
        expect(invalid.valid).toBe(false);
    });

    it("rejects non-boolean for boolean schema", () => {
        const booleanSchema = schema.Boolean({ required: true });
        expect(validateSchema(booleanSchema, true).valid).toBe(true);
        const invalid = validateSchema(booleanSchema, "true");
        expect(invalid.valid).toBe(false);
    });

    it("rejects invalid loro-map field types", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String({ required: true }),
        });
        const valid = { name: "abc" };
        expect(validateSchema(mapSchema, valid).valid).toBe(true);
        const invalid = validateSchema(mapSchema, { name: 123 });
        expect(invalid.valid).toBe(false);
    });

    it("rejects invalid loro-list items", () => {
        const listSchema = schema.LoroList(schema.Number());
        expect(validateSchema(listSchema, [1, 2]).valid).toBe(true);
        const invalid = validateSchema(listSchema, [1, "2"]);
        expect(invalid.valid).toBe(false);
    });

    it("rejects invalid loro-movable-list items", () => {
        const listSchema = schema.LoroMovableList(
            schema.String(),
            (item) => item,
        );
        expect(validateSchema(listSchema, ["a"]).valid).toBe(true);
        const invalid = validateSchema(listSchema, ["a", 2]);
        expect(invalid.valid).toBe(false);
    });

    it("rejects invalid loro-text content", () => {
        const textSchema = schema.LoroText({ required: true });
        expect(validateSchema(textSchema, "").valid).toBe(true);
        const invalid = validateSchema(textSchema, 123);
        expect(invalid.valid).toBe(false);
    });

    it("rejects invalid loro-tree structure", () => {
        const treeSchema = schema.LoroTree(
            schema.LoroMap({ title: schema.String({ required: true }) }),
        );

        const validTree = [
            {
                id: "node-1",
                data: { title: "Root" },
                children: [],
            },
        ];
        expect(validateSchema(treeSchema, validTree).valid).toBe(true);

        const invalidTree = [
            {
                id: "node-1",
                data: { title: 123 },
                children: [],
            },
        ];
        const result = validateSchema(treeSchema, invalidTree);
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
    });
});
