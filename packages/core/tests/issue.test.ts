import { it, expect } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema } from "../src/";

it("Applying remote event then calling setState immediately may cause an event apply order issue", async () => {
    const docA = new LoroDoc();
    const docB = new LoroDoc();
    docA.getText("t").update("Hello");
    docB.import(docA.export({ mode: "snapshot" }));
    const m = new Mirror({
        doc: docA,
        schema: schema({
            t: schema.LoroText(),
        }),
    });

    docB.getText("t").push(" ABC!");
    docA.import(docB.export({ mode: "update" }));
    m.setState({ t: "" });
    await Promise.resolve();
    expect(m.getState()).toStrictEqual(docA.toJSON());
});

it("Reproduces 'Item ID cannot be null' when adding a new todo item using $cid-based idSelector on a MovableList", async () => {
    // This mirrors the react todo example setup:
    // - Schema uses a MovableList of Map items
    // - idSelector relies on `$cid` (container id) which is only assigned after Loro creates the list item
    // When setState runs, diffMovableList calls idSelector on the NEW state before apply, so `$cid` is undefined
    // and the diff currently throws "Item ID cannot be null".

    const doc = new LoroDoc();
    const todoSchema = schema({
        todos: schema.LoroMovableList(
            schema.LoroMap({
                text: schema.String(),
                status: schema.String<"todo" | "inProgress" | "done">(),
            }),
            // Use $cid for identity like the example does
            (t) => (t as { $cid?: string }).$cid as string,
        ),
    });

    const m = new Mirror({
        doc,
        schema: todoSchema,
        initialState: { todos: [] },
    });

    // Calling setState should succeed and stamp $cid during apply,
    // but currently diffMovableList reads idSelector before $cid is assigned
    // and throws "Item ID cannot be null".
    m.setState({
        // Add a new item without $cid; $cid will only be stamped during apply
        todos: [{ text: "Buy milk", status: "todo" }],
    });
});

it("doc with map record containers misses $cid in initial getState (repro)", () => {
    const doc = new LoroDoc();
    const root = doc.getMap("root");
    const todo = new LoroMap();
    todo.set("text", "Buy eggs");
    root.setContainer("todo-1", todo);
    const list = doc.getList("list");
    list.pushContainer(new LoroMap());
    doc.commit();

    const todoSchema = schema({
        root: schema.LoroMapRecord(
            schema.LoroMap({
                text: schema.String(),
            }),
        ),
        list: schema.LoroList(schema.LoroMap({})),
    });

    const m = new Mirror({
        doc,
        schema: todoSchema,
    });

    const state = m.getState() as any;
    expect(state.root).toBeDefined();
    expect(state.root["todo-1"]).toBeDefined();
    // Bug: $cid is currently missing even though the container exists in the doc
    expect(typeof state.root["todo-1"].$cid).toBe("string");
    expect(typeof state.list[0].$cid).toBe("string");
});
