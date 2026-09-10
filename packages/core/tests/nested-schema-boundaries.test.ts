import { expect, it } from "vitest";
import { LoroDoc, LoroList, LoroMap } from "loro-crdt";
import {
    Mirror,
    schema,
    isLazyList,
    LazyListWriteError,
} from "../src/index.js";

it("keeps scalar Ignore out of initial and event state", () => {
    const doc = new LoroDoc();
    const map = doc.getMap("session");
    map.set("name", "old");
    map.set("cache", 1);
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            session: schema.LoroMap({
                name: schema.String(),
                cache: schema.Ignore(),
            }),
        }),
    });
    const initial = mirror.getState().session.cache;
    map.set("cache", 42);
    map.set("name", "new");
    doc.commit();
    expect(mirror.getState().session.name).toBe("new");
    expect(initial).toBeUndefined();
    expect(mirror.getState().session.cache).toBeUndefined();
});

it("rejects replacing a lazy view under an eager item before writing", () => {
    const doc = new LoroDoc();
    const row = doc.getList("rows").insertContainer(0, new LoroMap());
    row.set("id", "row");
    row.setContainer("items", new LoroList()).push("old");
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            rows: schema.LoroList(
                schema.LoroMap({
                    id: schema.String(),
                    items: schema.LoroList(schema.String(), undefined, {
                        lazy: { index: [] },
                    }),
                }),
            ),
        }),
    });
    const before = mirror.getState().rows[0].items;
    let error: unknown;
    try {
        mirror.setState((d) => {
            Object.assign(d.rows[0], { items: ["new"] });
        });
    } catch (e) {
        error = e;
    }
    expect(error).toBeDefined();
    expect(mirror.getState().rows[0].items).toBe(before);
    expect((row.get("items") as LoroList).toJSON()).toEqual(["old"]);
});

it("exposes lazy views in tree data", () => {
    const doc = new LoroDoc();
    const node = doc.getTree("tree").createNode();
    node.data.setContainer("items", new LoroList()).push("old");
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    items: schema.LoroList(schema.String(), undefined, {
                        lazy: { index: [] },
                    }),
                }),
            ),
        }),
    });
    expect(isLazyList(mirror.getState().tree[0].data.items)).toBe(true);
});

it("preserves local Ignore across mixed peer updates and deletes, including tree data", () => {
    const doc = new LoroDoc();
    const node = doc.getTree("tree").createNode();
    node.data.set("name", "old");
    node.data.set("cache", "doc");
    doc.commit();
    const m = new Mirror({
        doc,
        checkStateConsistency: true,
        schema: schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    name: schema.String(),
                    cache: schema.Ignore(),
                }),
            ),
        }),
    });
    m.setState((d) => {
        d.tree[0].data.cache = "memory";
    });
    const peer = new LoroDoc();
    peer.import(doc.export({ mode: "snapshot" }));
    const map = peer.getContainerById(node.data.id) as LoroMap;
    map.set("name", "peer");
    map.set("cache", 42);
    peer.commit();
    doc.import(peer.export({ mode: "update" }));
    expect(m.getState().tree[0].data).toMatchObject({
        name: "peer",
        cache: "memory",
    });
    map.delete("cache");
    peer.commit();
    doc.import(peer.export({ mode: "update" }));
    expect(m.getState().tree[0].data.cache).toBe("memory");
    m.setState((d) => {
        d.tree[0].data.name = "local";
    });
    expect(node.data.get("name")).toBe("local");
});

it("keeps lazy instances across eager reordering and rejects tree replacement", async () => {
    const doc = new LoroDoc();
    const rows = doc.getMovableList("rows");
    for (const id of ["a", "b"]) {
        const row = rows.insertContainer(rows.length, new LoroMap());
        row.set("id", id);
        row.set("name", id);
        row.setContainer("items", new LoroList()).push(id);
    }
    const node = doc.getTree("tree").createNode();
    node.data.setContainer("items", new LoroList()).push("tree");
    doc.commit();
    const item = schema.LoroMap({
        id: schema.String(),
        name: schema.String(),
        items: schema.LoroList(schema.String(), undefined, {
            lazy: { index: [] },
        }),
    });
    const m = new Mirror({
        doc,
        schema: schema({
            rows: schema.LoroMovableList(item, (x) => x.id),
            tree: schema.LoroTree(
                schema.LoroMap({
                    items: schema.LoroList(schema.String(), undefined, {
                        lazy: { index: [] },
                    }),
                }),
            ),
        }),
    });
    const first = m.getState().rows[0].items;
    m.setState((d) => {
        d.rows.reverse();
    });
    expect(m.getState().rows[1].items).toBe(first);
    m.setState((d) => {
        d.rows[1].name = "changed";
    });
    expect(m.getState().rows[1].items).toBe(first);
    const treeItems = m.getState().tree[0].data.items;
    await treeItems.hydrate(0, 1);
    expect(treeItems.get(0)).toBe("tree");
    const before = doc.toJSON();
    expect(() => {
        m.setState((d) => {
            Object.assign(d.tree[0].data, { items: ["bad"] });
        });
    }).toThrow(LazyListWriteError);
    expect(doc.toJSON()).toEqual(before);
});

it("filters nested Ignore through all three initialization paths", () => {
    for (const mode of ["tree", "deep", "legacy"]) {
        const doc = new LoroDoc();
        doc.getMap("session").set("cache", 42);
        doc.getMap("session").set("name", "ok");
        doc.commit();
        if (mode !== "tree")
            Object.defineProperty(doc, "toContainerTree", { value: undefined });
        if (mode === "legacy")
            Object.defineProperty(doc, "getDeepValueWithID", {
                value: undefined,
            });
        const m = new Mirror({
            doc,
            schema: schema({
                session: schema.LoroMap({
                    name: schema.String(),
                    cache: schema.Ignore(),
                }),
            }),
        });
        expect(m.getState().session).toEqual({ name: "ok" });
    }
});

it("keeps tree lazy data after remote node insertion and streams", async () => {
    const doc = new LoroDoc();
    doc.getTree("tree");
    const m = new Mirror({
        doc,
        schema: schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    items: schema.LoroList(schema.String(), undefined, {
                        lazy: { index: [] },
                    }),
                    cache: schema.Ignore(),
                }),
            ),
        }),
    });
    const peer = new LoroDoc();
    peer.import(doc.export({ mode: "snapshot" }));
    const node = peer.getTree("tree").createNode();
    const items = node.data.setContainer("items", new LoroList());
    items.push("first");
    node.data.set("cache", 42);
    peer.commit();
    doc.import(peer.export({ mode: "update" }));
    const view = m.getState().tree[0].data.items;
    expect(isLazyList(view)).toBe(true);
    expect(m.getState().tree[0].data.cache).toBeUndefined();
    await view.hydrate(0, 1);
    expect(view.get(0)).toBe("first");
    items.push("second");
    peer.commit();
    doc.import(peer.export({ mode: "update" }));
    expect(view.length).toBe(2);
});

it("guards lazy fields under map records before any sibling is written", () => {
    const doc = new LoroDoc();
    const row = doc.getMap("rows").setContainer("a", new LoroMap());
    row.set("name", "old");
    row.setContainer("items", new LoroList()).push("old");
    doc.commit();
    const m = new Mirror({
        doc,
        schema: schema({
            rows: schema.LoroMapRecord(
                schema.LoroMap({
                    name: schema.String(),
                    items: schema.LoroList(schema.String(), undefined, {
                        lazy: { index: [] },
                    }),
                }),
            ),
        }),
    });
    const before = doc.toJSON();
    expect(() => {
        m.setState((d) => {
            d.rows.a.name = "new";
            Object.assign(d.rows.a, { items: ["bad"] });
        });
    }).toThrow(LazyListWriteError);
    expect(doc.toJSON()).toEqual(before);
    expect(isLazyList(m.getState().rows.a.items)).toBe(true);
});

for (const movable of [false, true]) {
    for (const index of [0, 1, 3]) {
        it(`accepts ${movable ? "movable" : "ordinary"} insertion at ${index} and exposes lazy children`, async () => {
            const doc = new LoroDoc();
            const rows = movable
                ? doc.getMovableList("rows")
                : doc.getList("rows");
            for (const id of ["a", "b", "c"]) {
                const row = rows.insertContainer(rows.length, new LoroMap());
                row.set("id", id);
                row.setContainer("items", new LoroList()).push(id);
            }
            doc.commit();
            const item = schema.LoroMap({
                id: schema.String(),
                items: schema.LoroList(schema.String(), undefined, {
                    lazy: { index: [] },
                }),
            });
            const m = new Mirror({
                doc,
                schema: schema({
                    rows: movable
                        ? schema.LoroMovableList(item, (x) => x.id)
                        : schema.LoroList(item, (x) => x.id),
                }),
            });
            const previous = m.getState().rows.map((row) => row.items);
            m.setState((d) => {
                d.rows.splice(index, 0, {
                    id: "new",
                    items: ["body"],
                } as unknown as (typeof d.rows)[number]);
            });
            const state = m.getState().rows;
            const expected = ["a", "b", "c"];
            expected.splice(index, 0, "new");
            expect(state.map((row) => row.id)).toEqual(expected);
            expect(isLazyList(state[index].items)).toBe(true);
            await state[index].items.hydrate(0, 1);
            expect(state[index].items.get(0)).toBe("body");
            state
                .filter((row) => row.id !== "new")
                .forEach((row, i) => {
                    expect(row.items).toBe(previous[i]);
                });
            expect(rows.length).toBe(4);
            expect(() => {
                m.setState((d) => {
                    Object.assign(d.rows[index], { items: [] });
                });
            }).toThrow(LazyListWriteError);
            m.dispose();
        });
    }
}
