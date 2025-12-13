import { describe, it, expect } from "vitest";
import { schema } from "loro-mirror";
import {
    createLoroContext,
    useLoroStore,
    useLoroValue,
    useLoroCallback,
} from "../src/index.js";

describe("React README examples", () => {
    it("createLoroContext returns provider and hooks for given schema", () => {
        const todoSchema = schema({
            todos: schema.LoroList(
                schema.LoroMap({
                    text: schema.String({ required: true }),
                    completed: schema.Boolean({ defaultValue: false }),
                }),
                (t) => t.$cid,
            ),
        });

        const ctx = createLoroContext(todoSchema);
        expect(typeof ctx.LoroProvider).toBe("function");
        expect(typeof ctx.useLoroContext).toBe("function");
        expect(typeof ctx.useLoroState).toBe("function");
        expect(typeof ctx.useLoroSelector).toBe("function");
        expect(typeof ctx.useLoroAction).toBe("function");

        // Basic API surface from README exists
        expect(typeof useLoroStore).toBe("function");
        expect(typeof useLoroValue).toBe("function");
        expect(typeof useLoroCallback).toBe("function");
    });
});
