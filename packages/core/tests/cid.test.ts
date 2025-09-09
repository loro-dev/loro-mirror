import { describe, it, expect } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror } from "../src/core/mirror";
import { schema } from "../src/schema";
import { CID_KEY } from "../src/constants";
import { diffMap } from "../src/core/diff";

describe("withCid: state injection and write ignoring", () => {
    it("injects $cid on initial snapshot for maps and tree node.data", () => {
        const doc = new LoroDoc();
        // Root containers
        const m1 = doc.getMap("m1");
        m1.set("name", "alpha");
        const m2 = doc.getMap("m2");
        m2.set("name", "beta");
        const tree = doc.getTree("tree");
        const n = tree.createNode(undefined, 0);
        n.data.set("label", "root");

        const s = schema({
            m1: schema.LoroMap({ name: schema.String() }, { withCid: true }),
            m2: schema.LoroMap({ name: schema.String() }),
            tree: schema.LoroTree(
                schema.LoroMap({ label: schema.String() }, { withCid: true }),
            ),
        });

        const mirror = new Mirror({ doc, schema: s });
        const state = mirror.getState();

        // m1 has $cid
        expect(typeof (state as any).m1[CID_KEY]).toBe("string");
        expect((state as any).m1[CID_KEY]).toBe(String(m1.id));
        // m2 has no $cid
        expect((state as any).m2[CID_KEY]).toBeUndefined();

        // tree node has $cid on data
        expect(Array.isArray((state as any).tree)).toBe(true);
        const node0 = (state as any).tree[0];
        expect(typeof node0.data[CID_KEY]).toBe("string");
        expect(node0.data[CID_KEY]).toBe(String(n.data.id));
    });

    it("adds $cid for map containers inserted by Loro (list items)", async () => {
        const doc = new LoroDoc();
        const list = doc.getList("list");

        const s = schema({
            list: schema.LoroList(
                schema.LoroMap({ value: schema.Number() }, { withCid: true }),
            ),
        });

        const mirror = new Mirror({ doc, schema: s });

        // Insert a detached map container into the list from Loro side
        const item = new LoroMap();
        item.set("value", 42);
        const inserted = list.insertContainer(0, item);
        doc.commit();
        await Promise.resolve();

        const state = mirror.getState() as any;
        expect(Array.isArray(state.list)).toBe(true);
        expect(state.list.length).toBe(1);
        expect(state.list[0][CID_KEY]).toBe(String((inserted ?? item).id));
        expect(state.list[0].value).toBe(42);
    });

    it("sets $cid for newly created tree nodes via events", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({ title: schema.String() }, { withCid: true }),
            ),
        });
        const mirror = new Mirror({ doc, schema: s });

        const node = tree.createNode(undefined, 0);
        node.data.set("title", "hello");
        doc.commit();
        await Promise.resolve();

        const state = mirror.getState() as any;
        const created = state.tree.find((n: any) => n.id === String(node.id));
        expect(created).toBeTruthy();
        expect(created.data[CID_KEY]).toBe(String(node.data.id));
    });

    it("diffMap ignores $cid for maps with withCid", () => {
        const doc = new LoroDoc();
        const sMap = schema.LoroMap(
            { name: schema.String() },
            { withCid: true },
        );
        const oldState = { name: "x", [CID_KEY]: "old" } as any;
        const newState = { name: "x", [CID_KEY]: "new" } as any;
        const changes = diffMap(
            doc,
            oldState,
            newState,
            "map@1" as any,
            sMap as any,
        );
        expect(changes.length).toBe(0);
    });

    it("includes $cid on empty root map with withCid, excludes on non-withCid", () => {
        const doc = new LoroDoc();
        const s = schema({
            a: schema.LoroMap({}, { withCid: true }),
            b: schema.LoroMap({}),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        // a shows only synthetic $cid
        expect(st.a).toBeDefined();
        expect(typeof st.a[CID_KEY]).toBe("string");
        expect(Object.keys(st.a)).toEqual([CID_KEY]);

        // b exists by default but does not include $cid
        expect(st.b).toBeDefined();
        expect(typeof st.b).toBe("object");
        expect(st.b[CID_KEY]).toBeUndefined();
        expect(Object.keys(st.b)).toEqual([]);
    });

    it("nested maps: parent withCid true, child without -> only parent has $cid", () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        const child = new LoroMap();
        root.setContainer("child", child);
        doc.commit();

        const s = schema({
            root: schema.LoroMap(
                {
                    child: schema.LoroMap({}), // no withCid
                },
                { withCid: true },
            ),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        expect(st.root[CID_KEY]).toBe(String(root.id));
        expect(st.root.child[CID_KEY]).toBeUndefined();
    });

    it("nested maps: parent without, child with withCid -> only child has $cid", () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        const child = new LoroMap();
        root.setContainer("child", child);
        doc.commit();

        const s = schema({
            root: schema.LoroMap({
                child: schema.LoroMap({}, { withCid: true }),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        expect(st.root[CID_KEY]).toBeUndefined();
        const attachedChild = root.get("child") as LoroMap;
        expect(st.root.child[CID_KEY]).toBe(String(attachedChild.id));
    });

    it("FROM_LORO: map.setContainer inserts nested map that gets $cid", async () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        const inner = new LoroMap();
        inner.set("name", "x");
        const attached = root.setContainer("inner", inner);
        doc.commit();
        await Promise.resolve();

        const s = schema({
            root: schema.LoroMap({
                inner: schema.LoroMap(
                    { name: schema.String() },
                    { withCid: true },
                ),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        const expectedId = String((attached ?? inner).id);
        expect(st.root.inner.name).toBe("x");
        expect(st.root.inner[CID_KEY]).toBe(expectedId);
    });

    it("withCid=false maps can store a normal '$cid' key in Loro", async () => {
        const doc = new LoroDoc();
        const s = schema({
            x: schema.LoroMap({ foo: schema.String() }), // no withCid
        });
        const m = new Mirror({ doc, schema: s });

        m.setState((draft: any) => {
            draft.x.foo = "bar";
            draft.x[CID_KEY] = "user-defined";
        });
        await Promise.resolve();

        // Verify Loro actually stored the user-provided "$cid" as a normal field
        const xMap = doc.getMap("x");
        expect(xMap.get("foo")).toBe("bar");
        expect(xMap.get(CID_KEY)).toBe("user-defined");
    });

    it("TO_LORO: deleting $cid on withCid map is ignored (no Loro changes)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            m: schema.LoroMap({ name: schema.String() }, { withCid: true }),
        });
        const m = new Mirror({ doc, schema: s });

        // Take a baseline of Loro JSON
        const before = JSON.stringify(doc.toJSON());

        // Remove synthetic field from state; diffMap should ignore
        m.setState((draft: any) => {
            delete draft.m[CID_KEY];
        });
        await Promise.resolve();

        const after = JSON.stringify(doc.toJSON());
        expect(after).toBe(before);
    });

    it("TO_LORO + consistency check: changing $cid throws divergence error", () => {
        const doc = new LoroDoc();
        const s = schema({
            m: schema.LoroMap({ label: schema.String() }, { withCid: true }),
        });
        const m = new Mirror({ doc, schema: s, checkStateConsistency: true });

        expect(() => {
            m.setState((draft: any) => {
                draft.m.label = "ok";
                draft.m[CID_KEY] = "tamper"; // should be ignored to Loro and trigger consistency error
            });
        }).toThrow();
    });

    it("list items withCid: $cid values exist and are unique per item", async () => {
        const doc = new LoroDoc();
        const list = doc.getList("list");
        const s = schema({
            list: schema.LoroList(
                schema.LoroMap({ value: schema.Number() }, { withCid: true }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        const a = new LoroMap();
        a.set("value", 1);
        const b = new LoroMap();
        b.set("value", 2);
        const ai = list.pushContainer(a);
        const bi = list.pushContainer(b);
        doc.commit();
        await Promise.resolve();

        const st = m.getState() as any;
        expect(st.list).toHaveLength(2);
        const cidA = st.list[0][CID_KEY];
        const cidB = st.list[1][CID_KEY];
        expect(typeof cidA).toBe("string");
        expect(typeof cidB).toBe("string");
        expect(cidA).not.toBe(cidB);
        // sanity-check against actual container ids
        expect(cidA).toBe(String((ai ?? a).id));
        expect(cidB).toBe(String((bi ?? b).id));
    });

    it("tree node $cid persists across moves", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "root");
        const a = root.createNode();
        a.data.set("title", "A");
        const b = root.createNode();
        b.data.set("title", "B");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({ title: schema.String() }, { withCid: true }),
            ),
        });
        const m = new Mirror({ doc, schema: s });
        await Promise.resolve();

        const before = m.getState() as any;
        const aNode = before.tree[0].children.find(
            (n: any) => n.data.title === "A",
        );
        const bNode = before.tree[0].children.find(
            (n: any) => n.data.title === "B",
        );
        expect(typeof aNode.data[CID_KEY]).toBe("string");
        expect(typeof bNode.data[CID_KEY]).toBe("string");

        // Move B under A
        tree.move(b.id, a.id, 0);
        doc.commit();
        await Promise.resolve();

        const after = m.getState() as any;
        const aAfter = after.tree[0].children.find(
            (n: any) => n.data.title === "A",
        );
        const bAfter = aAfter.children[0];
        expect(bAfter.data.title).toBe("B");
        expect(typeof bAfter.data[CID_KEY]).toBe("string");
    });

    it("list idSelector can use $cid to reorder items", async () => {
        const doc = new LoroDoc();
        const list = doc.getMovableList("items");
        const s = schema({
            items: schema.LoroMovableList(
                schema.LoroMap({ val: schema.Number() }, { withCid: true }),
                (it) => (it as any)[CID_KEY] ?? null,
            ),
        });
        const m = new Mirror({ doc, schema: s });

        const a = new LoroMap();
        a.set("val", 1);
        const b = new LoroMap();
        b.set("val", 2);
        list.pushContainer(a);
        list.pushContainer(b);
        doc.commit();
        await Promise.resolve();

        const first = m.getState().items[0];
        const second = m.getState().items[1];

        // Swap order using $cid-based idSelector
        m.setState({ items: [second, first] } as any);
        await Promise.resolve();

        const after = m.getState();
        expect(after.items[0][CID_KEY]).toBe(second[CID_KEY]);
        expect(after.items[1][CID_KEY]).toBe(first[CID_KEY]);
    });

    // setState-created containers with withCid should have $cid in final state
    it("TO_LORO setState: nested map container with withCid gets $cid in final state (same mirror)", () => {
        const doc = new LoroDoc();
        const s = schema({
            root: schema.LoroMap({
                child: schema.LoroMap(
                    { name: schema.String() },
                    { withCid: true },
                ),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        // Create nested container via setState
        m.setState({ root: { child: { name: "x" } } } as any);
        const st = m.getState() as any;
        expect(st.root.child.name).toBe("x");
        expect(typeof st.root.child[CID_KEY]).toBe("string");
    });

    it("TO_LORO setState: list items with withCid get $cid in final state (same mirror)", () => {
        const doc = new LoroDoc();
        const s = schema({
            list: schema.LoroList(
                schema.LoroMap({ v: schema.Number() }, { withCid: true }),
            ),
        });
        const m = new Mirror({ doc, schema: s });
        m.setState({ list: [{ v: 1 }, { v: 2 }] } as any);
        const st = m.getState() as any;
        expect(st.list).toHaveLength(2);
        expect(typeof st.list[0][CID_KEY]).toBe("string");
        expect(typeof st.list[1][CID_KEY]).toBe("string");
    });

    it("TO_LORO setState: tree nodes' data with withCid get $cid in final state (same mirror)", () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({ title: schema.String() }, { withCid: true }),
            ),
        });
        const m = new Mirror({ doc, schema: s });
        m.setState({
            tree: [
                { id: "", data: { title: "A" }, children: [] },
                { id: "", data: { title: "B" }, children: [] },
            ],
        } as any);
        const st = m.getState() as any;
        expect(st.tree.map((n: any) => n.data.title).sort()).toEqual([
            "A",
            "B",
        ]);
        expect(typeof st.tree[0].data[CID_KEY]).toBe("string");
    });
});
