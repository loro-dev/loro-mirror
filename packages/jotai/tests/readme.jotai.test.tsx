import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { schema } from "loro-mirror";
import { loroMirrorAtom } from "../src";
import { useAtom } from "jotai";

describe("Jotai README example", () => {
    it("creates an atom with list of withCid items and updates state", async () => {
        type TodoStatus = "todo" | "inProgress" | "done";

        const todoSchema = schema({
            todos: schema.LoroList(
                schema.LoroMap(
                    {
                        text: schema.String(),
                        status: schema.String<TodoStatus>(),
                    },
                    { withCid: true },
                ),
                (t) => t.$cid,
            ),
        });

        const doc = new LoroDoc();
        const atom = loroMirrorAtom({
            doc,
            schema: todoSchema,
            initialState: { todos: [] },
        });

        const { result } = renderHook(() => useAtom(atom));

        // push an item
        act(() => {
            result.current[1]((prev) => ({
                todos: [
                    ...prev.todos,
                    { text: "New Todo", status: "todo" as TodoStatus },
                ],
            }));
        });

        const state = result.current[0];
        expect(state.todos.length).toBe(1);
        expect(state.todos[0].text).toBe("New Todo");
        expect(state.todos[0].status).toBe("todo");
        // $cid should be injected
        expect(typeof (state.todos[0] as any).$cid).toBe("string");
    });
});
