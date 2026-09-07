import { expect, it } from "vitest";
import {
    LoroDoc,
    LoroList,
    LoroMap,
    LoroText,
    LoroMovableList,
    UndoManager,
} from "loro-crdt";
import { Mirror, schema, isLazyList } from "../src/index.js";

const options = { lazy: { index: ["id"], maxHydrated: 1, tailKeep: 0 } };
const definition = schema({
    items: schema.LoroList(
        schema.LoroMap({
            id: schema.String(),
            lines: schema.LoroList(
                schema.LoroMap({
                    id: schema.String(),
                    body: schema.LoroText(),
                }),
                (x) => x.id,
                options,
            ),
        }),
        (x) => x.id,
        options,
    ),
});

type ItemInput = { id: string; lines: { id: string; body: string }[] };
it("writer insertion must expose nested LazyList immediately, as reopening does", async () => {
    const doc = new LoroDoc();
    const mirror = new Mirror({ doc, schema: definition });
    const reopened = new Mirror({ doc, schema: definition });
    try {
        mirror
            .list<ItemInput>("items")
            .push({ id: "message", lines: [{ id: "part", body: "hello" }] });
        const items = mirror.getState().items;
        await reopened.getState().items.hydrate(0, 1);
        expect(isLazyList(reopened.getState().items.get(0)!.lines)).toBe(true);
        expect(isLazyList(items.get(0)!.lines)).toBe(true);
        await items.get(0)!.lines.hydrate(0, 1);
        expect(items.get(0)!.lines.get(0)?.body).toBe("hello");
    } finally {
        mirror.dispose();
        reopened.dispose();
    }
});

it.each(["local", "remote"] as const)(
    "deleted nested lists do not retain hydrated or evicted bodies (%s)",
    async (source) => {
        const doc = new LoroDoc();
        const raw = doc.getList("items");
        for (let i = 0; i < 30; i++) {
            const item = raw.pushContainer(new LoroMap());
            item.set("id", String(i));
            const part = item
                .setContainer("lines", new LoroList())
                .pushContainer(new LoroMap());
            part.set("id", "part");
            part.setContainer("body", new LoroText()).insert(
                0,
                `${i}:` + "x".repeat(1000),
            );
        }
        doc.commit();
        const mirror = new Mirror({ doc, schema: definition });
        const items = mirror.getState().items;
        // Inspect strong owners, not GC timing or process RSS.
        type Cached = { _s: { hydrated: Map<string, unknown> } };
        const owners = (mirror as unknown as { lazyLists: Map<string, Cached> })
            .lazyLists;
        try {
            for (let i = 0; i < 30; i++) {
                await items.hydrate(i, i + 1);
                await items.get(i)!.lines.hydrate(0, 1);
                items.release(i, i + 1);
            }
            const edit = source === "remote" ? new LoroDoc() : doc;
            if (edit !== doc) edit.import(doc.export({ mode: "snapshot" }));
            // A descendant update shares the deletion commit. It must not
            // recreate a cache for a subtree absent from the final document.
            const first = edit.getList("items").get(0) as LoroMap;
            const firstPart = (first.get("lines") as LoroList).get(
                0,
            ) as LoroMap;
            (firstPart.get("body") as LoroText).insert(0, "removed ");
            edit.getList("items").delete(0, 30);
            edit.commit();
            if (edit !== doc) doc.import(edit.export({ mode: "update" }));
            expect(items.length).toBe(0);
            expect(
                [...owners.values()].reduce(
                    (n, list) => n + list._s.hydrated.size,
                    0,
                ),
            ).toBe(0);
        } finally {
            mirror.dispose();
        }
    },
);

it("control: nested moves plus streamed edits keep count, index, identity and range notifications", async () => {
    const doc = new LoroDoc();
    const raw = doc.getList("items");
    for (let i = 0; i < 2; i++) {
        const item = raw.pushContainer(new LoroMap());
        item.set("id", String(i));
        const parts = item.setContainer("parts", new LoroMovableList());
        for (const id of ["a", "b", "c"]) {
            const part = parts.pushContainer(new LoroMap());
            part.set("id", id);
            part.setContainer("body", new LoroText()).insert(0, id);
        }
    }
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(
                schema.LoroMap({
                    id: schema.String(),
                    parts: schema.LoroMovableList(
                        schema.LoroMap({
                            id: schema.String(),
                            body: schema.LoroText(),
                        }),
                        (x) => x.id,
                    ),
                }),
                (x) => x.id,
                { lazy: { index: ["id"], maxHydrated: 2, tailKeep: 0 } },
            ),
        }),
    });
    const items = mirror.getState().items;
    await items.hydrate(0, 2);
    const untouched = items.get(1);
    let first = 0;
    let second = 0;
    const off0 = items.subscribeRange(0, 1, () => first++);
    const off1 = items.subscribeRange(1, 2, () => second++);
    try {
        const remote = new LoroDoc();
        remote.import(doc.export({ mode: "snapshot" }));
        const item = remote.getList("items").get(0) as LoroMap;
        const parts = item.get("parts") as LoroMovableList;
        const moved = parts.get(0) as LoroMap;
        parts.move(0, 2);
        (moved.get("body") as LoroText).insert(1, " streamed");
        item.set("id", "renamed");
        remote.commit();
        doc.import(remote.export({ mode: "update" }));
        expect(items.length).toBe(2);
        expect([...items.ids()]).toEqual(raw.getShallowValue());
        expect(items.indexOf("0")).toBe(-1);
        expect(items.indexOf("renamed")).toBe(0);
        expect(items.get(0)?.parts.map((x) => x.body)).toEqual([
            "b",
            "c",
            "a streamed",
        ]);
        expect(items.get(1)).toBe(untouched);
        expect(first).toBeGreaterThan(0);
        expect(second).toBe(0);
    } finally {
        off0();
        off1();
        mirror.dispose();
    }
});

it.each(["local", "remote"] as const)(
    "releases lazy descendants of replaced and deleted map fields (%s)",
    async (source) => {
        const doc = new LoroDoc();
        const raw = doc.getMap("folders");
        const owner = raw.setContainer("entry", new LoroMap());
        const lines = owner.setContainer("lines", new LoroList());
        lines.push("body");
        doc.commit();
        const listDefinition = schema.LoroList(schema.String(), undefined, {
            lazy: { index: [] },
        });
        const mirror = new Mirror({
            doc,
            schema: schema({
                folders: schema.LoroMapRecord(
                    schema.LoroMap({ lines: listDefinition }),
                ),
            }),
        });
        const previous = mirror.getState().folders.entry.lines;
        await previous.hydrate(0, 1);
        const edit = source === "remote" ? new LoroDoc() : doc;
        if (edit !== doc) edit.import(doc.export({ mode: "snapshot" }));
        const replacement = edit
            .getMap("folders")
            .setContainer("entry", new LoroMap());
        replacement.setContainer("lines", new LoroList()).push("new body");
        edit.commit();
        if (edit !== doc) doc.import(edit.export({ mode: "update" }));
        expect(previous.length).toBe(0);
        await previous.hydrate(0, 10);
        expect(previous.slice(0, 10)).toEqual([]);
        const fresh = mirror.getState().folders.entry.lines;
        await fresh.hydrate(0, 1);
        expect(fresh.get(0)).toBe("new body");
        edit.getMap("folders").delete("entry");
        edit.commit();
        if (edit !== doc) doc.import(edit.export({ mode: "update" }));
        expect(fresh.length).toBe(0);
        expect(
            (mirror as unknown as { lazyLists: Map<string, unknown> }).lazyLists
                .size,
        ).toBe(0);
        mirror.dispose();
    },
);

it("keeps nested lazy views alive through movable-list moves", async () => {
    const doc = new LoroDoc();
    const raw = doc.getMovableList("rows");
    const item = raw.pushContainer(new LoroMap());
    item.set("id", "a");
    item.setContainer("lines", new LoroList()).push("body");
    const second = raw.pushContainer(new LoroMap());
    second.set("id", "b");
    second.setContainer("lines", new LoroList());
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            rows: schema.LoroMovableList(
                schema.LoroMap({
                    id: schema.String(),
                    lines: schema.LoroList(schema.String(), undefined, {
                        lazy: { index: [] },
                    }),
                }),
                (x) => x.id,
            ),
        }),
    });
    const lines = mirror.getState().rows[0].lines;
    await lines.hydrate(0, 1);
    raw.move(0, 1);
    doc.commit();
    expect(mirror.getState().rows[1].lines).toBe(lines);
    expect(lines.get(0)).toBe("body");
    mirror.dispose();
});

it("can read a deleted lazy subtree after undo restores it", async () => {
    const doc = new LoroDoc();
    const item = doc.getList("items").pushContainer(new LoroMap());
    item.set("id", "message");
    const part = item
        .setContainer("lines", new LoroList())
        .pushContainer(new LoroMap());
    part.set("id", "part");
    part.setContainer("body", new LoroText()).insert(0, "body");
    doc.commit();
    const mirror = new Mirror({ doc, schema: definition });
    await mirror.getState().items.hydrate(0, 1);
    const old = mirror.getState().items.get(0)!.lines;
    await old.hydrate(0, 1);
    const undo = new UndoManager(doc, {});
    doc.getList("items").delete(0, 1);
    doc.commit();
    expect(old.length).toBe(0);
    expect(undo.undo()).toBe(true);
    await mirror.getState().items.hydrate(0, 1);
    const restored = mirror.getState().items.get(0)!.lines;
    await restored.hydrate(0, 1);
    expect(restored.get(0)?.body).toBe("body");
    expect(restored).not.toBe(old);
    mirror.dispose();
});
