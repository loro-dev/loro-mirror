import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror, schema, validateSchema } from "../src/index.js";

describe("README Quick Start examples", () => {
    it("creates a store, updates immutably and via draft, and injects cid", async () => {
        const todoSchema = schema({
            todos: schema.LoroList(
                schema.LoroMap({
                    text: schema.String(),
                    completed: schema.Boolean({ defaultValue: false }),
                }),
            ),
        });

        const doc = new LoroDoc();
        const store = new Mirror({
            doc,
            schema: todoSchema,
            initialState: { todos: [] },
        });

        // immutable update
        store.setState((s) => ({
            ...s,
            todos: s.todos.concat({
                text: "Learn Loro Mirror",
                completed: false,
            }),
        }));

        let state = store.getState();
        expect(state.todos.length).toBe(1);
        expect(state.todos[0].text).toBe("Learn Loro Mirror");
        // $cid should be injected for LoroMap
        expect(typeof state.todos[0].$cid).toBe("string");

        // draft-style update
        store.setState((draft) => {
            draft.todos.push({ text: "Second", completed: false });
        });

        state = store.getState();
        expect(state.todos.length).toBe(2);
        expect(state.todos[1].text).toBe("Second");

        // subscribe should receive updates
        let calls = 0;
        const unsubscribe = store.subscribe(() => {
            calls++;
        });
        store.setState((draft) => {
            draft.todos[0].completed = true;
        });
        expect(calls).toBeGreaterThan(0);
        unsubscribe();
    });

    it("validateSchema example returns valid:true for a correct value", () => {
        const appSchema = schema({
            user: schema.LoroMap({
                name: schema.String(),
                age: schema.Number({ required: false }),
            }),
            tags: schema.LoroList(schema.String()),
        });

        const result = validateSchema(appSchema, {
            user: { name: "Alice", age: 18, $cid: "mock" },
            tags: ["a", "b"],
        });
        expect(result.valid).toBe(true);
    });

    it("validateSchema reports errors for wrong types", () => {
        const appSchema = schema({
            user: schema.LoroMap({ name: schema.String() }),
            tags: schema.LoroList(schema.String()),
        });

        const result = validateSchema(appSchema, {
            user: { name: 123 }, // wrong type
            tags: ["ok", 5], // wrong type in list
        } as any);

        expect(result.valid).toBe(false);
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result.errors && result.errors.length).toBeGreaterThan(0);
    });

    it("Ignore fields do not sync and validation passes", async () => {
        const s = schema({
            user: schema.LoroMap({
                name: schema.String(),
                // local-only cache
                cache: schema.Ignore<{ hits: number }>(),
            }),
        });

        const doc = new LoroDoc();
        const store = new Mirror({
            doc,
            schema: s,
            initialState: { user: { name: "A", cache: { hits: 0 } } },
        });

        // Update a synced field to materialize the container in Loro
        store.setState((draft) => {
            draft.user.name = "A1";
        });

        // Update ignore field; it should not appear in doc JSON
        store.setState((draft: any) => {
            draft.user.cache = { hits: (draft.user.cache?.hits ?? 0) + 1 };
        });

        const json: any = doc.getDeepValueWithID();
        expect(json.user.value.name).toBe("A1");
        expect(json.user.value.cache).toBeUndefined();

        // Direct validation should also ignore the field
        const validation = validateSchema(s, {
            user: { name: "A1", cache: { hits: 5 } },
        } as any);
        expect(validation.valid).toBe(true);
    });
});
