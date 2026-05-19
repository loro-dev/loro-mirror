import { describe, it, expect, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
    schema,
    validateSchema,
    getDefaultValue,
    type TransformDefinition,
} from "../src/index.js";
import { Mirror } from "../src/core/mirror.js";
import {
    isLoroUnionSchema,
    isContainerSchema,
} from "../src/schema/validators.js";
import type { LoroUnionSchema } from "../src/index.js";

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

        it("rejects discriminant key in variant definition at schema creation", () => {
            expect(() => {
                schema.Union("type", {
                    bad: schema.LoroMap({
                        type: schema.String(),
                        value: schema.Number(),
                    }),
                });
            }).toThrow(/must not contain the discriminant key/);
        });

        it("rejects discriminant key in variant definition at validation time", () => {
            // Construct manually to bypass builder check
            const badUnion = {
                type: "loro-union" as const,
                discriminant: "kind",
                variants: {
                    bad: schema.LoroMap({ kind: schema.String() }),
                },
                options: {},
                getContainerType: () => "Map" as const,
            };

            const result = validateSchema(badUnion, { kind: "bad" });
            expect(result.valid).toBe(false);
            expect(result.errors?.[0]).toContain(
                "must not contain the discriminant key",
            );
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
            initialState: {
                content: { kind: "article", body: "Hello" },
            },
        });

        const state = mirror.getState();
        expect(state.content.kind).toBe("article");
        if (state.content.kind === "article") {
            expect(state.content.body).toBe("Hello");
        }
    });

    it("root-level union update within same variant preserves nested containers", () => {
        const rootUnionSchema = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({
                    body: schema.String(),
                    tags: schema.LoroList(schema.String()),
                }),
                gallery: schema.LoroMap({
                    count: schema.Number(),
                }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: rootUnionSchema,
            initialState: {
                content: { kind: "article", body: "", tags: [] },
            },
        });

        mirror.setState((draft) => {
            if (draft.content.kind === "article") {
                draft.content.body = "Hello";
                draft.content.tags.push("a", "b");
            }
        });

        const state = mirror.getState();
        expect(state.content.kind).toBe("article");
        if (state.content.kind === "article") {
            expect(state.content.body).toBe("Hello");
            expect(state.content.tags).toEqual(["a", "b"]);
        }
    });

    it("root-level union variant switch produces correct state", () => {
        const rootUnionSchema = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({ body: schema.String() }),
                gallery: schema.LoroMap({
                    count: schema.Number(),
                }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: rootUnionSchema,
            initialState: {
                content: { kind: "article", body: "Hello" },
            },
            checkStateConsistency: true,
        });

        // Switch variant at root level: article -> gallery
        mirror.setState((draft) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (draft as any).content = { kind: "gallery", count: 5 };
        });

        const state = mirror.getState();
        expect(state.content.kind).toBe("gallery");
        if (state.content.kind === "gallery") {
            expect(state.content.count).toBe(5);
        }
    });
});

describe("Union edge cases", () => {
    it("union with nested containers inside variants", () => {
        const s = schema({
            items: schema.LoroList(
                schema.Union("type", {
                    rich: schema.LoroMap({ content: schema.LoroText() }),
                    plain: schema.LoroMap({ text: schema.String() }),
                }),
                (item) => item.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { items: [] },
        });

        mirror.setState((draft) => {
            draft.items.push({ type: "rich", content: "Hello world" });
        });

        const state = mirror.getState();
        expect(state.items[0].type).toBe("rich");
        if (state.items[0].type === "rich") {
            expect(state.items[0].content).toBe("Hello world");
        }
    });

    it("union with single variant", () => {
        const s = schema({
            data: schema.Union("type", {
                only: schema.LoroMap({ value: schema.Number() }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { data: { type: "only", value: 42 } },
        });

        expect(mirror.getState().data.type).toBe("only");
        if (mirror.getState().data.type === "only") {
            expect(mirror.getState().data.value).toBe(42);
        }
    });

    it("adding new items to a list of unions", () => {
        const s = schema({
            blocks: schema.LoroList(
                schema.Union("type", {
                    text: schema.LoroMap({ body: schema.String() }),
                    divider: schema.LoroMap({}),
                }),
                (b) => b.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push({ type: "text", body: "First" });
        });

        mirror.setState((draft) => {
            draft.blocks.push({ type: "divider" });
            draft.blocks.push({ type: "text", body: "Second" });
        });

        const state = mirror.getState();
        expect(state.blocks).toHaveLength(3);
        expect(state.blocks[0].type).toBe("text");
        expect(state.blocks[1].type).toBe("divider");
        expect(state.blocks[2].type).toBe("text");
    });

    it("removing union items from a list", () => {
        const s = schema({
            blocks: schema.LoroList(
                schema.Union("type", {
                    a: schema.LoroMap({ x: schema.Number() }),
                    b: schema.LoroMap({ y: schema.String() }),
                }),
                (b) => b.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push(
                { type: "a", x: 1 },
                { type: "b", y: "hello" },
                { type: "a", x: 2 },
            );
        });

        mirror.setState((draft) => {
            draft.blocks.splice(1, 1);
        });

        const state = mirror.getState();
        expect(state.blocks).toHaveLength(2);
        expect(state.blocks[0].type).toBe("a");
        expect(state.blocks[1].type).toBe("a");
    });

    it("exports union types from public API", () => {
        const u = schema.Union("type", {
            a: schema.LoroMap({ x: schema.Number() }),
        });
        const _guard: boolean = isLoroUnionSchema(u);
        expect(_guard).toBe(true);
        // Verify the type is accessible (compile-time check)
        const _typeCheck: LoroUnionSchema<
            string,
            Record<string, never>
        > = u as never;
        void _typeCheck;
    });

    it("variant switch with simultaneous insert before does not corrupt list", () => {
        // Regression: variant-switch delete used oldInfo.index which becomes
        // stale after phase-1/2 deletions and insertions shift the list.
        const s = schema({
            blocks: schema.LoroList(
                schema.Union("type", {
                    paragraph: schema.LoroMap({ text: schema.String() }),
                    heading: schema.LoroMap({
                        level: schema.Number(),
                        text: schema.String(),
                    }),
                }),
                (b) => b.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { blocks: [] },
            checkStateConsistency: true,
        });

        // Start with two paragraph items
        mirror.setState((draft) => {
            draft.blocks.push(
                { type: "paragraph", text: "A" },
                { type: "paragraph", text: "B" },
            );
        });

        const cidB = mirror.getState().blocks[1].$cid;

        // In one update: insert a new item at the front AND switch B's variant.
        // The insert shifts indices, exposing the stale-index bug.
        mirror.setState((draft) => {
            draft.blocks.splice(0, 0, {
                type: "paragraph",
                text: "New",
            });
            // B is now at index 2 (was 1) after the splice
            draft.blocks[2] = {
                type: "heading",
                level: 2,
                text: "B-heading",
                $cid: cidB,
            };
        });

        const state = mirror.getState();
        expect(state.blocks).toHaveLength(3);
        expect(state.blocks[0].type).toBe("paragraph");
        expect(state.blocks[1].type).toBe("paragraph");
        // Verify it's A that survived, not the old B
        if (state.blocks[1].type === "paragraph") {
            expect(state.blocks[1].text).toBe("A");
        }
        expect(state.blocks[2].type).toBe("heading");
        if (state.blocks[2].type === "heading") {
            expect(state.blocks[2].level).toBe(2);
            expect(state.blocks[2].text).toBe("B-heading");
        }
    });

    it("initialState populates union fields", () => {
        // Regression: mergeInitialIntoBaseWithSchema coerced union fields to {}
        // instead of merging the provided initialState data.
        const s = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({ body: schema.String() }),
                gallery: schema.LoroMap({
                    count: schema.Number(),
                }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: {
                content: { kind: "article", body: "Hello from init" },
            },
        });

        const state = mirror.getState();
        expect(state.content.kind).toBe("article");
        if (state.content.kind === "article") {
            expect(state.content.body).toBe("Hello from init");
        }
    });

    it("$cid descriptor is configurable so it can be overwritten", () => {
        const s = schema({
            blocks: schema.LoroList(
                schema.Union("type", {
                    paragraph: schema.LoroMap({ text: schema.String() }),
                }),
                (b) => b.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { blocks: [] },
        });

        mirror.setState((draft) => {
            draft.blocks.push({ type: "paragraph", text: "Hello" });
        });

        const item = mirror.getState().blocks[0];
        const descriptor = Object.getOwnPropertyDescriptor(item, "$cid");
        expect(descriptor).toBeDefined();
        expect(descriptor!.configurable).toBe(true);
        expect(descriptor!.enumerable).toBe(false);
    });

    it("initialState discriminant is persisted to Loro doc", () => {
        const s = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({ body: schema.String() }),
                gallery: schema.LoroMap({
                    count: schema.Number(),
                }),
            }),
        });

        const doc = new LoroDoc();

        // Mirror writes the discriminant to Loro even without a setState call
        const mirror1 = new Mirror({
            doc,
            schema: s,
            initialState: {
                content: { kind: "gallery", count: 0 },
            },
        });
        mirror1.dispose();

        // Verify discriminant is in the doc
        expect(doc.getMap("content").get("kind")).toBe("gallery");
    });

    it("existing doc discriminant is preserved when new Mirror has different initialState", () => {
        const s = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({ body: schema.String() }),
                gallery: schema.LoroMap({
                    count: schema.Number(),
                }),
            }),
        });

        const doc = new LoroDoc();

        // First mirror writes gallery data into doc
        const mirror1 = new Mirror({
            doc,
            schema: s,
            initialState: {
                content: { kind: "gallery", count: 0 },
            },
        });
        mirror1.setState((draft) => {
            if (draft.content.kind === "gallery") {
                draft.content.count = 10;
            }
        });
        expect(mirror1.getState().content.kind).toBe("gallery");
        mirror1.dispose();

        // Second mirror with different initialState should see the
        // existing doc data, not the new initialState's discriminant
        const mirror2 = new Mirror({
            doc,
            schema: s,
            initialState: {
                content: { kind: "article", body: "Override attempt" },
            },
        });

        expect(mirror2.getState().content.kind).toBe("gallery");
        mirror2.dispose();
    });

    it("$cid is stamped on union containers from doc snapshot", () => {
        const s = schema({
            content: schema.Union("kind", {
                article: schema.LoroMap({ body: schema.String() }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: {
                content: { kind: "article", body: "Test" },
            },
        });

        const state = mirror.getState();
        expect(state.content.$cid).toBeDefined();
        expect(typeof state.content.$cid).toBe("string");
        mirror.dispose();
    });
});

describe("Union with transforms inside variant fields", () => {
    const epochTransform: TransformDefinition<number, Date> = {
        decode: (n: number) => new Date(n),
        encode: (d: Date) => d.getTime(),
    };

    it("transform decode/encode works for fields in union variants", () => {
        const s = schema({
            events: schema.LoroList(
                schema.Union("type", {
                    meeting: schema.LoroMap({
                        title: schema.String(),
                        startAt: schema.Number().transform(epochTransform),
                    }),
                    reminder: schema.LoroMap({
                        note: schema.String(),
                    }),
                }),
                (item) => item.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { events: [] },
            checkStateConsistency: true,
        });

        const epoch = new Date("2025-06-15T10:00:00Z").getTime();

        mirror.setState((draft) => {
            draft.events.push({
                type: "meeting",
                title: "Standup",
                startAt: new Date(epoch),
            });
            draft.events.push({ type: "reminder", note: "Buy milk" });
        });

        const state = mirror.getState();
        expect(state.events).toHaveLength(2);
        expect(state.events[0].type).toBe("meeting");
        if (state.events[0].type === "meeting") {
            // The value should be decoded back to a Date
            expect(state.events[0].startAt).toBeInstanceOf(Date);
            expect((state.events[0].startAt as Date).getTime()).toBe(epoch);
        }
        expect(state.events[1].type).toBe("reminder");
    });

    it("transform works after same-variant update", () => {
        const s = schema({
            item: schema.Union("kind", {
                timestamped: schema.LoroMap({
                    value: schema.String(),
                    updatedAt: schema.Number().transform(epochTransform),
                }),
                plain: schema.LoroMap({ value: schema.String() }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: {
                item: {
                    kind: "timestamped",
                    value: "hello",
                    updatedAt: new Date("2025-01-01"),
                },
            },
        });

        const cidBefore = mirror.getState().item.$cid;

        mirror.setState((draft) => {
            if (draft.item.kind === "timestamped") {
                draft.item.value = "updated";
                draft.item.updatedAt = new Date("2025-06-01");
            }
        });

        const state = mirror.getState();
        expect(state.item.kind).toBe("timestamped");
        expect(state.item.$cid).toBe(cidBefore); // same container
        if (state.item.kind === "timestamped") {
            expect(state.item.value).toBe("updated");
            expect(state.item.updatedAt).toBeInstanceOf(Date);
            expect((state.item.updatedAt as Date).getFullYear()).toBe(2025);
        }
    });
});

describe("MovableList of unions", () => {
    it("supports push, update, and variant switch", () => {
        const s = schema({
            items: schema.LoroMovableList(
                schema.Union("type", {
                    text: schema.LoroMap({ body: schema.String() }),
                    number: schema.LoroMap({ value: schema.Number() }),
                }),
                (item) => item.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { items: [] },
        });

        // Push items
        mirror.setState((draft) => {
            draft.items.push(
                { type: "text", body: "Hello" },
                { type: "number", value: 42 },
            );
        });

        let state = mirror.getState();
        expect(state.items).toHaveLength(2);
        expect(state.items[0].type).toBe("text");
        expect(state.items[1].type).toBe("number");

        // Same-variant update (use Immer mutation to avoid enumerable $cid issues)
        mirror.setState((draft) => {
            if (draft.items[0].type === "text") {
                draft.items[0].body = "Updated";
            }
        });

        state = mirror.getState();
        expect(state.items[0].type).toBe("text");
        if (state.items[0].type === "text") {
            expect(state.items[0].body).toBe("Updated");
        }

        // Variant switch
        mirror.setState((draft) => {
            draft.items[1] = {
                type: "text",
                body: "Was a number",
                $cid: draft.items[1].$cid,
            };
        });

        state = mirror.getState();
        expect(state.items[1].type).toBe("text");
        if (state.items[1].type === "text") {
            expect(state.items[1].body).toBe("Was a number");
        }
    });

    it("supports removal from movable list of unions", () => {
        const s = schema({
            items: schema.LoroMovableList(
                schema.Union("type", {
                    a: schema.LoroMap({ x: schema.Number() }),
                    b: schema.LoroMap({ y: schema.String() }),
                }),
                (item) => item.$cid,
            ),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: s,
            initialState: { items: [] },
        });

        mirror.setState((draft) => {
            draft.items.push(
                { type: "a", x: 1 },
                { type: "b", y: "hi" },
                { type: "a", x: 2 },
            );
        });

        mirror.setState((draft) => {
            draft.items.splice(1, 1);
        });

        const state = mirror.getState();
        expect(state.items).toHaveLength(2);
        expect(state.items[0].type).toBe("a");
        expect(state.items[1].type).toBe("a");
    });
});
