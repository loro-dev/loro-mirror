import { describe, it, expect, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { schema, validateSchema, getDefaultValue } from "../src/index.js";
import { Mirror } from "../src/core/mirror.js";
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

describe("Mirror with Union schema", () => {
    const blockSchema = schema.Union("type", {
        paragraph: schema.LoroMap({ text: schema.String() }),
        image: schema.LoroMap({ src: schema.String(), alt: schema.String() }),
        heading: schema.LoroMap({
            level: schema.Number(),
            text: schema.String(),
        }),
    });

    const docSchema = schema({
        blocks: schema.LoroList(blockSchema, (b) => b.$cid),
    });

    let doc: LoroDoc;

    beforeEach(() => {
        doc = new LoroDoc();
    });

    it("sets initial state with union items", () => {
        const mirror = new Mirror({
            doc,
            schema: docSchema,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push({ type: "paragraph", text: "Hello" });
        });

        const state = mirror.getState();
        expect(state.blocks).toHaveLength(1);
        expect(state.blocks[0].type).toBe("paragraph");
        if (state.blocks[0].type === "paragraph") {
            expect(state.blocks[0].text).toBe("Hello");
        }
    });

    it("updates fields within the same variant", () => {
        const mirror = new Mirror({
            doc,
            schema: docSchema,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push({ type: "paragraph", text: "Hello" });
        });

        const cidBefore = mirror.getState().blocks[0].$cid;

        mirror.setState((draft) => {
            draft.blocks[0] = {
                type: "paragraph",
                text: "Updated",
                $cid: draft.blocks[0].$cid,
            };
        });

        const state = mirror.getState();
        expect(state.blocks[0].type).toBe("paragraph");
        if (state.blocks[0].type === "paragraph") {
            expect(state.blocks[0].text).toBe("Updated");
        }
        // $cid preserved — same container, just updated fields
        expect(state.blocks[0].$cid).toBe(cidBefore);
    });

    it("switches variant by replacing container", () => {
        const mirror = new Mirror({
            doc,
            schema: docSchema,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push({ type: "paragraph", text: "Hello" });
        });

        const cidBefore = mirror.getState().blocks[0].$cid;

        mirror.setState((draft) => {
            draft.blocks[0] = { type: "heading", level: 1, text: "Title" };
        });

        const state = mirror.getState();
        expect(state.blocks[0].type).toBe("heading");
        if (state.blocks[0].type === "heading") {
            expect(state.blocks[0].level).toBe(1);
            expect(state.blocks[0].text).toBe("Title");
        }
        // $cid changes — different container
        expect(state.blocks[0].$cid).not.toBe(cidBefore);
    });

    it("supports multiple union items in a list", () => {
        const mirror = new Mirror({
            doc,
            schema: docSchema,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push(
                { type: "heading", level: 1, text: "Title" },
                { type: "paragraph", text: "Body" },
                { type: "image", src: "photo.png", alt: "A photo" },
            );
        });

        const state = mirror.getState();
        expect(state.blocks).toHaveLength(3);
        expect(state.blocks[0].type).toBe("heading");
        expect(state.blocks[1].type).toBe("paragraph");
        expect(state.blocks[2].type).toBe("image");
    });

    it("union field at root level", () => {
        const rootUnionSchema = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({ body: schema.String() }),
                gallery: schema.LoroMap({
                    images: schema.LoroList(schema.String()),
                }),
            }),
        });

        const mirror = new Mirror({
            doc,
            schema: rootUnionSchema,
        });

        mirror.setState((draft) => {
            (draft as Record<string, unknown>).content = { kind: "article", body: "Hello" };
        });

        const state = mirror.getState();
        expect(state.content.kind).toBe("article");
    });
});
