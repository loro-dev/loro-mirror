import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { InferInputType, schema } from "loro-mirror";
import { loroMirrorAtom } from "../src";
import { atom, useAtomValue, useSetAtom } from "jotai";

describe("Jotai README example", () => {
    it("creates an atom with list items that include $cid and updates state", async () => {
        type TodoStatus = "todo" | "inProgress" | "done";

        const todoSchema = schema.LoroMap(
            {
                text: schema.String(),
                status: schema.String<TodoStatus>(),
            },
            { withCid: true },
        );
        // Define your schema
        const todoDocSchema = schema({
            todos: schema.LoroList(
                todoSchema,
                (t) => t.$cid, // stable id from Loro container id
            ),
        });

        // Auto generated type from schema
        type Todo = InferInputType<typeof todoSchema>;

        const doc = new LoroDoc();
        const todoDocAtom = loroMirrorAtom({
            doc,
            schema: todoDocSchema,
            initialState: { todos: [] as Todo[] },
            // onError: (err) => console.error('update failed', err),
        });

        // Selector atom
        const todosAtom = atom(
            (get) => get(todoDocAtom).todos,
            (_get, set, todos: Todo[]) => {
                set(todoDocAtom, { todos });
            },
        );

        // Action atom
        const addTodoAtom = atom(null, (get, set, todo: Todo) => {
            set(todosAtom, [...get(todosAtom), todo]);
        });

        const { result: todosResult } = renderHook(() =>
            useAtomValue(todosAtom),
        );
        const { result: addTodoResult } = renderHook(() =>
            useSetAtom(addTodoAtom),
        );
        // push an item
        await act(async () => {
            addTodoResult.current({
                text: "New Todo",
                status: "todo" as TodoStatus,
            });
        });

        const state = todosResult.current;
        expect(state.length).toBe(1);
        expect(state[0].text).toBe("New Todo");
        expect(state[0].status).toBe("todo");
        // $cid should be injected
        expect(typeof state[0].$cid).toBe("string");
    });
});
