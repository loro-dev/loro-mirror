import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

describe("undefined values in Map should be treated as non-existent fields", () => {
    it("should ignore undefined fields when setting state", async () => {
        const testSchema = schema({
            root: schema.LoroMap({
                name: schema.String(),
                age: schema.Number(),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: testSchema,
            checkStateConsistency: true,
        });

        // Try to set a field to undefined - this should be treated as if the field doesn't exist
        expect(() => {
            mirror.setState({
                root: {
                    name: "test",
                    age: undefined,  // This undefined should be ignored
                },
            } as any);
        }).not.toThrow();

        const state = mirror.getState() as any;
        
        // The name field should be set
        expect(state.root.name).toBe("test");
        // The age field should not exist in the state (key should not be present)
        expect("age" in state.root).toBe(false);
        expect(state.root.age).toBeUndefined();
    });

    it("should ignore undefined fields in nested maps", async () => {
        const testSchema = schema({
            root: schema.LoroMap({
                user: schema.LoroMap({
                    name: schema.String(),
                    email: schema.String(),
                }),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: testSchema,
            checkStateConsistency: true,
        });

        expect(() => {
            mirror.setState({
                root: {
                    user: {
                        name: "John",
                        email: undefined,  // Should be ignored
                    },
                },
            } as any);
        }).not.toThrow();

        const state = mirror.getState() as any;
        expect(state.root.user.name).toBe("John");
        // The email field should not exist in the state
        expect("email" in state.root.user).toBe(false);
        expect(state.root.user.email).toBeUndefined();
    });

    it("should handle undefined in schema.Any fields", async () => {
        const testSchema = schema({
            root: schema.LoroMap({
                data: schema.Any(),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: testSchema,
            checkStateConsistency: true,
        });

        expect(() => {
            mirror.setState({
                root: {
                    data: {
                        field1: "value",
                        field2: undefined,  // Should be ignored
                    },
                },
            } as any);
        }).not.toThrow();

        const state = mirror.getState() as any;
        expect(state.root.data.field1).toBe("value");
        // The field2 should not exist in the state
        expect("field2" in state.root.data).toBe(false);
        expect(state.root.data.field2).toBeUndefined();
    });

    it("should delete existing field when set to undefined", async () => {
        const testSchema = schema({
            root: schema.LoroMap({
                name: schema.String(),
                age: schema.Number(),
            }),
        });

        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: testSchema,
            checkStateConsistency: true,
        });

        // First set both fields
        mirror.setState({
            root: {
                name: "test",
                age: 25,
            },
        } as any);

        let state = mirror.getState() as any;
        expect(state.root.name).toBe("test");
        expect(state.root.age).toBe(25);
        expect("age" in state.root).toBe(true);

        // Now set age to undefined - it should be deleted
        mirror.setState({
            root: {
                name: "test",
                age: undefined,
            },
        } as any);

        state = mirror.getState() as any;
        expect(state.root.name).toBe("test");
        // The age field should be deleted
        expect("age" in state.root).toBe(false);
        expect(state.root.age).toBeUndefined();
    });
});
