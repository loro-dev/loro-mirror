import { describe, it, expect } from "vitest";
import {
    EphemeralStore,
    LoroDoc,
    LoroList,
    LoroMap,
    LoroText,
} from "loro-crdt";
import { Mirror, UpdateSource } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";
import { isLazyList, LazyListWriteError } from "../src/core/lazy-list.js";
import type { LazyList } from "../src/schema/index.js";

type Item = {
    id: string;
    title: string;
    done: boolean;
    note?: string;
};

const itemSchema = () =>
    schema.LoroMap({
        id: schema.String(),
        title: schema.LoroText(),
        done: schema.Boolean(),
    });

const lazyOptions = { index: ["id", "done"], maxHydrated: 4, tailKeep: 1 };

const LAZY_SCHEMA = () =>
    schema({
        history: schema.LoroList(itemSchema(), (it) => it.id, {
            lazy: lazyOptions,
        }),
        meta: schema.LoroMap({ label: schema.String() }),
    });

function seedDoc(doc: LoroDoc, count: number, prefix = "item"): LoroList {
    const list = doc.getList("history");
    for (let i = 0; i < count; i++) {
        const m = list.insertContainer(i, new LoroMap());
        m.set("id", `${prefix}-${i}`);
        m.setContainer("title", new LoroText()).insert(0, `title ${i}`);
        m.set("done", i % 2 === 0);
    }
    doc.getMap("meta").set("label", "seeded");
    doc.commit();
    return list;
}

function openLazy(doc: LoroDoc) {
    return new Mirror({ doc, schema: LAZY_SCHEMA() });
}

function lazyListOf(mirror: { getState(): { history: unknown } }) {
    const ll = mirror.getState().history;
    expect(isLazyList(ll)).toBe(true);
    return ll as unknown as LazyList<Item>;
}

describe("lazy list - init", () => {
    it("exposes a LazyList at the state key without hydrating items", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 10);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        expect(ll.length).toBe(10);
        expect(ll.version).toBe(0);
        expect(Array.isArray(ll)).toBe(false);
        for (let i = 0; i < 10; i++) {
            expect(ll.isHydrated(i)).toBe(false);
            expect(ll.get(i)).toBeUndefined();
        }
        expect(ll.slice(0, 3)).toEqual([undefined, undefined, undefined]);
        mirror.dispose();
    });

    it("reads ids from the shallow value and index fields at init", () => {
        const doc = new LoroDoc();
        const list = seedDoc(doc, 5);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        const shallow = list.getShallowValue();
        expect([...ll.ids()]).toEqual(shallow);
        for (let i = 0; i < 5; i++) {
            expect(ll.index(i)).toEqual({ id: `item-${i}`, done: i % 2 === 0 });
        }
        mirror.dispose();
    });

    it("indexOf resolves by container id and by idSelector id", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 5);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        const cid = ll.ids()[2];
        expect(ll.indexOf(cid)).toBe(2);
        expect(ll.indexOf("item-4")).toBe(4);
        expect(ll.indexOf("nope")).toBe(-1);
        mirror.dispose();
    });

    it("produces a LazyList (not []) for an empty lazy list with initialState", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: LAZY_SCHEMA(),
            initialState: { meta: { label: "x" } } as never,
        });
        const ll = lazyListOf(mirror);
        expect(ll.length).toBe(0);
        expect(ll.ids()).toEqual([]);
        mirror.dispose();
    });

    it("supports nested lazy lists inside maps", () => {
        const nested = schema({
            doc: schema.LoroMap({
                pages: schema.LoroList(itemSchema(), (it) => it.id, {
                    lazy: { index: ["id"] },
                }),
            }),
        });
        const doc = new LoroDoc();
        const pages = doc.getMap("doc").setContainer("pages", new LoroList());
        const m = pages.insertContainer(0, new LoroMap());
        m.set("id", "p-0");
        m.setContainer("title", new LoroText()).insert(0, "page zero");
        m.set("done", false);
        doc.commit();

        const mirror = new Mirror({ doc, schema: nested });
        const ll = mirror.getState().doc.pages;
        expect(isLazyList(ll)).toBe(true);
        expect(ll.length).toBe(1);
        expect(ll.index(0)).toEqual({ id: "p-0" });
        expect(ll.get(0)).toBeUndefined();
        mirror.dispose();
    });

    it("works on the legacy (no getDeepValueWithID) snapshot path", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 4);
        // Force buildRootStateSnapshotLegacy by hiding getDeepValueWithID.
        Object.defineProperty(doc, "getDeepValueWithID", {
            value: undefined,
            configurable: true,
        });
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);
        expect(ll.length).toBe(4);
        expect(ll.index(1)).toEqual({ id: "item-1", done: false });
        expect(ll.get(1)).toBeUndefined();
        mirror.dispose();
    });
});

describe("lazy list - hydrate/release and LRU", () => {
    it("hydrates ranges and reads full items with $cid and decodes", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 10);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        await ll.hydrate(2, 5);
        expect(ll.isHydrated(1)).toBe(false);
        for (let i = 2; i < 5; i++) expect(ll.isHydrated(i)).toBe(true);
        const item = ll.get(3)!;
        expect(item.id).toBe("item-3");
        expect(item.title).toBe("title 3");
        expect(item.done).toBe(false);
        // $cid stamped (non-enumerable)
        expect(Object.getOwnPropertyDescriptor(item, "$cid")?.value).toBe(
            ll.ids()[3],
        );
        expect(Object.keys(item)).not.toContain("$cid");
        expect(ll.slice(2, 4).map((x) => x?.id)).toEqual(["item-2", "item-3"]);
        mirror.dispose();
    });

    it("release drops hydration and get() falls back to undefined", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 6);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        await ll.hydrate(0, 3);
        expect(ll.isHydrated(0)).toBe(true);
        ll.release(0, 2);
        expect(ll.isHydrated(0)).toBe(false);
        expect(ll.isHydrated(1)).toBe(false);
        expect(ll.isHydrated(2)).toBe(true);
        expect(ll.get(0)).toBeUndefined();
        mirror.dispose();
    });

    it("evicts least-recently-used items beyond maxHydrated, keeping the tail", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 10); // maxHydrated 4, tailKeep 1
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        await ll.hydrate(0, 6); // 6 items, cap is 4
        let hydrated = 0;
        for (let i = 0; i < 10; i++) if (ll.isHydrated(i)) hydrated++;
        expect(hydrated).toBe(4);
        // LRU evicts the oldest reads (0, 1)
        expect(ll.isHydrated(0)).toBe(false);
        expect(ll.isHydrated(1)).toBe(false);
        expect(ll.isHydrated(5)).toBe(true);

        // Tail protection: hydrating the last item keeps it even under pressure
        await ll.hydrate(9, 10); // tailKeep = 1 → index 9 protected
        await ll.hydrate(6, 8); // force eviction pressure
        expect(ll.isHydrated(9)).toBe(true);
        mirror.dispose();
    });

    it("subscribeRange exemptions protect items from eviction and release", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 10);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        const unsub = ll.subscribeRange(0, 2, () => {});
        await ll.hydrate(0, 6);
        // items 0 and 1 are inside an active range: never evicted
        expect(ll.isHydrated(0)).toBe(true);
        expect(ll.isHydrated(1)).toBe(true);

        // release is explicit, but still respects active ranges
        ll.release(0, 6);
        expect(ll.isHydrated(0)).toBe(true);
        expect(ll.isHydrated(1)).toBe(true);
        expect(ll.isHydrated(2)).toBe(false);

        unsub();
        ll.release(0, 2);
        expect(ll.isHydrated(0)).toBe(false);
        mirror.dispose();
    });

    it("bumps version on hydrate/release only when a subscribed range is affected", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 10);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        const v0 = ll.version;
        await ll.hydrate(5, 7);
        expect(ll.version).toBe(v0); // no subscribed range

        let fired = 0;
        const unsub = ll.subscribeRange(0, 3, () => fired++);
        await ll.hydrate(5, 8); // does not overlap [0,3)
        expect(fired).toBe(0);
        expect(ll.version).toBe(v0);

        await ll.hydrate(1, 2); // overlaps
        expect(fired).toBe(1);
        expect(ll.version).toBe(v0 + 1);

        ll.release(0, 1); // overlaps, but item 0 is range-protected → no drop
        expect(fired).toBe(1);
        ll.release(2, 3);
        expect(fired).toBe(1); // item 2 was never hydrated → nothing dropped
        unsub();
        mirror.dispose();
    });
});

describe("lazy list - setState guard", () => {
    it("throws LazyListWriteError when setState replaces the lazy slot", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 3);
        const mirror = openLazy(doc);

        expect(() => {
            mirror.setState((s) => {
                (s as { history: unknown }).history = [];
            });
        }).toThrow(LazyListWriteError);
        expect(() => {
            mirror.setState((s) => {
                (s as { history: unknown }).history = [];
            });
        }).toThrow(/mirror\.list\("history"\)/);
        // Object-merge form
        expect(() => {
            mirror.setState({ history: [] } as never);
        }).toThrow(LazyListWriteError);
        mirror.dispose();
    });

    it("throws for nested lazy lists under maps", () => {
        const nested = schema({
            doc: schema.LoroMap({
                pages: schema.LoroList(itemSchema(), (it) => it.id, {
                    lazy: { index: ["id"] },
                }),
            }),
        });
        const doc = new LoroDoc();
        doc.getMap("doc").setContainer("pages", new LoroList());
        doc.commit();
        const mirror = new Mirror({ doc, schema: nested });
        expect(() => {
            mirror.setState((s) => {
                (s as { doc: unknown }).doc = { pages: [] as never };
            });
        }).toThrow(LazyListWriteError);
        mirror.dispose();
    });

    it("keeps the LazyList instance stable across unrelated setState updates", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 3);
        const mirror = openLazy(doc);
        const before = mirror.getState().history;

        mirror.setState((s) => {
            s.meta.label = "changed";
        });
        expect(mirror.getState().meta.label).toBe("changed");
        expect(mirror.getState().history).toBe(before);
        expect(doc.getMap("meta").get("label")).toBe("changed");
        mirror.dispose();
    });
});

describe("lazy list - write API", () => {
    it("push appends an item, hydrates its slot, and commits to the doc", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 2);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        mirror.list<Item>("history").push({
            id: "new-1",
            title: "hello",
            done: false,
        });
        expect(ll.length).toBe(3);
        expect(ll.index(2)).toEqual({ id: "new-1", done: false });
        // freshly written item is hydrated
        expect(ll.isHydrated(2)).toBe(true);
        expect(ll.get(2)).toMatchObject({
            id: "new-1",
            title: "hello",
            done: false,
        });
        // committed to the doc with the same container shapes setState produces
        const list = doc.getList("history");
        expect(list.length).toBe(3);
        const raw = list.get(2) as LoroMap;
        expect(raw.get("title")).toBeInstanceOf(LoroText);
        expect((raw.get("title") as LoroText).toString()).toBe("hello");
        mirror.dispose();
    });

    it("insert inserts at an index and shifts hydrated slots by id", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 4);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);
        await ll.hydrate(1, 2); // item-1
        const beforeCid = ll.ids()[1];
        const beforeValue = ll.get(1);

        mirror.list<Item>("history").insert(0, {
            id: "ins",
            title: "t",
            done: true,
        });
        expect(ll.length).toBe(5);
        expect(ll.index(0)).toEqual({ id: "ins", done: true });
        // the previously hydrated item kept its data at its new position
        expect(ll.ids()[2]).toBe(beforeCid);
        expect(ll.isHydrated(2)).toBe(true);
        expect(ll.get(2)).toBe(beforeValue);
        mirror.dispose();
    });

    it("deleteById removes the item from the LazyList and the doc", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 3);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);
        await ll.hydrate(0, 2);
        const deletedCid = ll.ids()[1];

        mirror.list<Item>("history").deleteById("item-1");
        expect(ll.length).toBe(2);
        expect(ll.indexOf("item-1")).toBe(-1);
        expect([...ll.ids()]).not.toContain(deletedCid);
        expect(doc.getList("history").length).toBe(2);
        expect(() => {
            mirror.list<Item>("history").deleteById("item-1");
        }).toThrow(/no item with id/);
        mirror.dispose();
    });

    it("updateById / updateAt diff the item and apply minimal changes", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 3);
        const mirror = openLazy(doc);
        const ll = lazyListOf(mirror);

        // update a non-hydrated item: hydrates on demand
        mirror.list<Item>("history").updateById("item-2", (d) => {
            d.done = true;
            d.title = "rewritten";
        });
        const pos = ll.indexOf("item-2");
        expect(ll.isHydrated(pos)).toBe(true);
        expect(ll.get(pos)).toMatchObject({ done: true, title: "rewritten" });
        const itemMap = doc.getList("history").get(2) as LoroMap;
        expect(itemMap.get("done")).toBe(true);
        expect((itemMap.get("title") as LoroText).toString()).toBe("rewritten");
        // index cache follows the update
        expect(ll.index(pos)).toEqual({ id: "item-2", done: true });

        // no-op updater does not write
        const v = ll.version;
        mirror.list<Item>("history").updateAt(0, () => {});
        expect(ll.version).toBe(v);
        mirror.dispose();
    });

    it("notifies global subscribers on writes", () => {
        const doc = new LoroDoc();
        seedDoc(doc, 1);
        const mirror = openLazy(doc);
        let calls = 0;
        const unsub = mirror.subscribe((_state, meta) => {
            calls++;
            expect(meta.source).toBe(UpdateSource.MIRROR);
        });
        mirror.list<Item>("history").push({ id: "x", title: "t", done: false });
        expect(calls).toBe(1);
        expect(mirror.getState().history).toBe(mirror.getState().history);
        unsub();
        mirror.dispose();
    });
});

const syncBtoA = (docA: LoroDoc, docB: LoroDoc) => {
    docA.import(docB.export({ mode: "update" }));
};

describe("lazy list - remote events", () => {
    function twoPeers(count: number) {
        const docA = new LoroDoc();
        seedDoc(docA, count);
        const docB = new LoroDoc();
        docB.import(docA.export({ mode: "update" }));
        const mirrorA = openLazy(docA);
        const ll = lazyListOf(mirrorA);
        return { docA, docB, mirrorA, ll };
    }

    it("handles remote insert/delete/move-ish edits with id-stable hydration", async () => {
        const { docA, docB, mirrorA, ll } = twoPeers(5);
        await ll.hydrate(2, 3); // item-2
        const itemCid = ll.ids()[2];
        const itemValue = ll.get(2);
        const v0 = ll.version;

        const listB = docB.getList("history");
        // remote insert at 0
        const m = listB.insertContainer(0, new LoroMap());
        m.set("id", "remote-new");
        m.setContainer("title", new LoroText()).insert(0, "r");
        m.set("done", false);
        // remote delete of the last item
        listB.delete(5, 1);
        docB.commit();
        syncBtoA(docA, docB);

        expect(ll.length).toBe(5);
        expect(ll.index(0)).toEqual({ id: "remote-new", done: false });
        // hydrated item shifted by id, keeping its data
        const newPos = ll.indexOf("item-2");
        expect(newPos).toBe(3);
        expect(ll.ids()[newPos]).toBe(itemCid);
        expect(ll.isHydrated(newPos)).toBe(true);
        expect(ll.get(newPos)).toBe(itemValue);
        expect(ll.version).toBeGreaterThan(v0);
        mirrorA.dispose();
    });

    it("applies remote edits inside hydrated items like non-lazy state", async () => {
        const { docA, docB, mirrorA, ll } = twoPeers(4);
        await ll.hydrate(1, 2);
        const before = ll.get(1)!;
        const cid = ll.ids()[1];

        const itemB = docB.getList("history").get(1) as LoroMap;
        itemB.set("done", true);
        (itemB.get("title") as LoroText).insert(0, "edited ");
        docB.commit();
        syncBtoA(docA, docB);

        const after = ll.get(1)!;
        expect(after.done).toBe(true);
        expect(after.title).toBe("edited title 1");
        // structural sharing: unchanged fields share references? item identity
        // changes (produce), $cid stays
        expect(after).not.toBe(before);
        expect(Object.getOwnPropertyDescriptor(after, "$cid")?.value).toBe(cid);
        // index cache refreshed from the hydrated value
        expect(ll.index(1)).toEqual({ id: "item-1", done: true });
        mirrorA.dispose();
    });

    it("updates the index cache for non-hydrated items without hydrating them", () => {
        const { docA, docB, mirrorA, ll } = twoPeers(4);
        expect(ll.isHydrated(2)).toBe(false);
        const v0 = ll.version;

        const itemB = docB.getList("history").get(2) as LoroMap;
        itemB.set("done", false); // item-2 had done=true
        docB.commit();
        syncBtoA(docA, docB);

        expect(ll.isHydrated(2)).toBe(false);
        expect(ll.index(2)).toEqual({ id: "item-2", done: false });
        expect(ll.version).toBe(v0 + 1);
        mirrorA.dispose();
    });

    it("ignores non-index field changes on non-hydrated items", () => {
        const { docA, docB, mirrorA, ll } = twoPeers(4);
        const v0 = ll.version;
        const itemB = docB.getList("history").get(1) as LoroMap;
        (itemB.get("title") as LoroText).insert(0, "x"); // title not in index
        docB.commit();
        syncBtoA(docA, docB);
        expect(ll.version).toBe(v0);
        expect(ll.isHydrated(1)).toBe(false);
        mirrorA.dispose();
    });

    it("keeps text index fields fresh on non-hydrated items", () => {
        const textIndexSchema = schema({
            history: schema.LoroList(itemSchema(), (it) => it.id, {
                lazy: { index: ["id", "title"] },
            }),
        });
        const docA = new LoroDoc();
        seedDoc(docA, 3);
        const docB = new LoroDoc();
        docB.import(docA.export({ mode: "update" }));
        const mirrorA = new Mirror({ doc: docA, schema: textIndexSchema });
        const ll = mirrorA.getState().history as unknown as LazyList<Item>;

        expect(ll.index(0)).toEqual({ id: "item-0", title: "title 0" });
        const itemB = docB.getList("history").get(0) as LoroMap;
        (itemB.get("title") as LoroText).insert(0, "remote ");
        docB.commit();
        docA.import(docB.export({ mode: "update" }));

        expect(ll.isHydrated(0)).toBe(false);
        expect(ll.index(0)).toEqual({ id: "item-0", title: "remote title 0" });
        mirrorA.dispose();
    });

    it("notifies subscribeRange listeners for remote changes in range", () => {
        const { docA, docB, mirrorA, ll } = twoPeers(5);
        let fired = 0;
        const unsub = ll.subscribeRange(1, 3, () => fired++);

        const listB = docB.getList("history");
        (listB.get(2) as LoroMap).set("done", false); // in range
        (listB.get(4) as LoroMap).set("done", true); // out of range
        docB.commit();
        syncBtoA(docA, docB);
        expect(fired).toBe(1);

        // structural change shifting indices within the range
        listB.delete(0, 1);
        docB.commit();
        syncBtoA(docA, docB);
        expect(fired).toBe(2);
        unsub();
        mirrorA.dispose();
    });

    it("global mirror.subscribe fires on lazy-list-affecting batches", () => {
        const { docA, docB, mirrorA, ll } = twoPeers(3);
        let calls = 0;
        const unsub = mirrorA.subscribe((state, meta) => {
            calls++;
            expect(meta.source).toBe(UpdateSource.LORO);
            // state identity: the LazyList instance stays stable
            expect(state.history).toBe(ll);
        });
        const listB = docB.getList("history");
        listB.delete(0, 1);
        docB.commit();
        syncBtoA(docA, docB);
        expect(calls).toBe(1);
        expect(ll.length).toBe(2);
        unsub();
        mirrorA.dispose();
    });
});

describe("lazy list - consistency, ephemeral, immer", () => {
    it("checkStateConsistency passes with lazy lists (hydrated or not)", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 5);
        const mirror = new Mirror({
            doc,
            schema: LAZY_SCHEMA(),
            checkStateConsistency: true,
        });
        const ll = lazyListOf(mirror);
        await ll.hydrate(0, 2);
        mirror.checkStateConsistency();
        mirror.setState((s) => {
            s.meta.label = "after";
        });
        mirror.checkStateConsistency();
        mirror.dispose();
    });

    it("LazyList passes through the ephemeral compose untouched", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 3);
        const eph = new EphemeralStore(30_000);
        const mirror = new Mirror({
            doc,
            schema: LAZY_SCHEMA(),
            ephemeralStore: eph,
        });
        const before = mirror.getState().history;
        // ephemeral-eligible change (primitive on existing map key)
        mirror.setState((s) => {
            s.meta.label = "eph";
        });
        expect(mirror.getState().meta.label).toBe("eph");
        expect(mirror.getState().history).toBe(before);
        mirror.finalizeEphemeralPatches();
        expect(mirror.getState().history).toBe(before);
        // recompose from scratch
        expect(mirror.getState().history).toBe(before);
        mirror.dispose();
    });

    it("survives immer produce and stripUndefined in setState", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 3);
        const mirror = openLazy(doc);
        const before = mirror.getState().history;
        await (before as unknown as LazyList<Item>).hydrate(0, 1);
        mirror.setState((s) => {
            s.meta.label = "immer";
        });
        const after = mirror.getState().history;
        expect(after).toBe(before);
        expect((after as unknown as LazyList<Item>).isHydrated(0)).toBe(true);
        mirror.dispose();
    });
});

describe("lazy list - round trip with non-lazy schema", () => {
    const plainSchema = () =>
        schema({
            history: schema.LoroList(itemSchema(), (it) => it.id),
        });
    const lazyOnlySchema = () =>
        schema({
            history: schema.LoroList(itemSchema(), (it) => it.id, {
                lazy: lazyOptions,
            }),
        });

    it("write-API docs are identical to setState-produced docs", () => {
        // Doc A: built via mirror.list on a lazy schema
        const docA = new LoroDoc();
        const mirrorA = new Mirror({ doc: docA, schema: lazyOnlySchema() });
        const writer = mirrorA.list<Item>("history");
        writer.push({ id: "a", title: "first", done: false });
        writer.push({ id: "b", title: "second", done: true });
        writer.insert(1, { id: "c", title: "middle", done: false });
        writer.updateById("b", (d) => {
            d.done = false;
            d.title = "second!";
        });
        writer.deleteById("c");

        // Doc B: same edits via setState on the equivalent non-lazy schema
        const docB = new LoroDoc();
        const mirrorB = new Mirror({ doc: docB, schema: plainSchema() });
        mirrorB.setState((s) => {
            s.history.push(
                { id: "a", title: "first", done: false },
                { id: "b", title: "second", done: true },
            );
        });
        mirrorB.setState((s) => {
            s.history.splice(1, 0, { id: "c", title: "middle", done: false });
        });
        mirrorB.setState((s) => {
            const b = s.history.find((x) => x.id === "b")!;
            b.done = false;
            b.title = "second!";
        });
        mirrorB.setState((s) => {
            s.history.splice(
                s.history.findIndex((x) => x.id === "c"),
                1,
            );
        });

        // Readers on other peers see identical data shapes.
        expect(JSON.stringify(docA.toJSON())).toBe(
            JSON.stringify(docB.toJSON()),
        );

        // Open docA with the non-lazy schema: deep-equals docB's state.
        const readerA = new Mirror({ doc: docA, schema: plainSchema() });
        const stateA = JSON.parse(JSON.stringify(readerA.getState()));
        const stateB = JSON.parse(JSON.stringify(mirrorB.getState()));
        expect(stateA).toEqual(stateB);

        readerA.dispose();
        mirrorA.dispose();
        mirrorB.dispose();
    });

    it("a lazy mirror reads docs produced by setState on a non-lazy mirror", async () => {
        const docB = new LoroDoc();
        const mirrorB = new Mirror({ doc: docB, schema: plainSchema() });
        mirrorB.setState((s) => {
            s.history.push(
                { id: "x", title: "one", done: false },
                { id: "y", title: "two", done: true },
            );
        });

        const mirrorA = new Mirror({ doc: docB, schema: lazyOnlySchema() });
        const ll = lazyListOf(mirrorA);
        expect(ll.length).toBe(2);
        expect(ll.index(1)).toEqual({ id: "y", done: true });
        await ll.hydrate(0, 2);
        expect(ll.get(0)).toMatchObject({ id: "x", title: "one" });
        expect(ll.get(1)).toMatchObject({ id: "y", title: "two" });
        mirrorA.dispose();
        mirrorB.dispose();
    });
});
