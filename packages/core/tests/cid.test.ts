import { describe, it, expect, expectTypeOf } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror } from "../src/core/mirror";
import { schema } from "../src/schema";
import { InferType } from "../src";
import { CID_KEY } from "../src/constants";
import { diffMap } from "../src/core/diff";

describe("$cid: state injection and write ignoring (always-on for LoroMap)", () => {
    it("types: LoroMap includes $cid by default", () => {
        const map = schema.LoroMap({ name: schema.String() });
        type T = InferType<typeof map>;
        expectTypeOf<T>().toExtend<{ name: string; $cid: string }>();
    });

    it("types: root schema maps include $cid", () => {
        const rootSchema = schema({
            a: schema.LoroMap({ title: schema.String() }),
            b: schema.LoroMap({ title: schema.String() }),
        });
        type RootState = InferType<typeof rootSchema>;

        expectTypeOf<RootState["a"]>().toMatchObjectType<{
            title: string;
            $cid: string;
        }>();
        expectTypeOf<RootState["b"]>().toMatchObjectType<{
            title: string;
            $cid: string;
        }>();
    });

    it("types: list items pick up $cid when item is LoroMap", () => {
        const items = schema.LoroList(
            schema.LoroMap({ value: schema.Number() }),
        );
        type Items = InferType<typeof items>;
        expectTypeOf<Items>().toExtend<
            Array<{ value: number; $cid: string }>
        >();
    });

    it("types: nested child map has $cid", () => {
        const nested = schema.LoroMap({
            child: schema.LoroMap({ name: schema.String() }),
        });
        type Nested = InferType<typeof nested>;
        expectTypeOf<Nested["child"]>().toMatchObjectType<{
            name: string;
            $cid: string;
        }>();
    });

    it("types: tree node data includes $cid", () => {
        const node = schema.LoroMap({ label: schema.String() });
        const tree = schema.LoroTree(node);
        type Tree = InferType<typeof tree>;
        // Check element type's data shape to avoid recursive assertion
        expectTypeOf<Tree[number]["data"]>().toExtend<{
            label: string;
            $cid: string;
        }>();
    });
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
            m1: schema.LoroMap({ name: schema.String() }),
            m2: schema.LoroMap({ name: schema.String() }),
            tree: schema.LoroTree(schema.LoroMap({ label: schema.String() })),
        });

        const mirror = new Mirror({ doc, schema: s });
        const state = mirror.getState();

        // m1 has $cid
        expect(typeof (state as any).m1[CID_KEY]).toBe("string");
        expect((state as any).m1[CID_KEY]).toBe(String(m1.id));
        // m2 also has $cid
        expect(typeof (state as any).m2[CID_KEY]).toBe("string");
        expect((state as any).m2[CID_KEY]).toBe(String(m2.id));

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
            list: schema.LoroList(schema.LoroMap({ value: schema.Number() })),
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
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
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

    it("diffMap ignores $cid for maps", () => {
        const doc = new LoroDoc();
        const sMap = schema.LoroMap({ name: schema.String() });
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

    it("includes $cid on empty root map", () => {
        const doc = new LoroDoc();
        const s = schema({ a: schema.LoroMap({}), b: schema.LoroMap({}) });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        // a shows only synthetic $cid
        expect(st.a).toBeDefined();
        expect(typeof st.a[CID_KEY]).toBe("string");
        expect(Object.keys(st.a)).toEqual([CID_KEY]);

        // b exists by default and includes $cid
        expect(st.b).toBeDefined();
        expect(typeof st.b).toBe("object");
        expect(typeof st.b[CID_KEY]).toBe("string");
        expect(Object.keys(st.b)).toEqual([CID_KEY]);
    });

    it("nested maps: both parent and child have $cid", () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        const child = new LoroMap();
        root.setContainer("child", child);
        doc.commit();

        const s = schema({
            root: schema.LoroMap({
                child: schema.LoroMap({}),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        expect(st.root[CID_KEY]).toBe(String(root.id));
        const attachedChild = root.get("child") as LoroMap;
        expect(st.root.child[CID_KEY]).toBe(String(attachedChild.id));
    });

    it("nested maps: parent and child both have $cid (no config needed)", () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        const child = new LoroMap();
        root.setContainer("child", child);
        doc.commit();

        const s = schema({
            root: schema.LoroMap({ child: schema.LoroMap({}) }),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        expect(st.root[CID_KEY]).toBe(String(root.id));
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
                inner: schema.LoroMap({ name: schema.String() }),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        const st = m.getState() as any;

        const expectedId = String((attached ?? inner).id);
        expect(st.root.inner.name).toBe("x");
        expect(st.root.inner[CID_KEY]).toBe(expectedId);
    });

    it("attempting to write $cid is ignored for maps (never synced to Loro)", async () => {
        const doc = new LoroDoc();
        const s = schema({ x: schema.LoroMap({ foo: schema.String() }) });
        const m = new Mirror({ doc, schema: s });

        await m.setState((draft: any) => {
            draft.x.foo = "bar";
            draft.x[CID_KEY] = "user-defined";
        });
        await Promise.resolve();

        const xMap = doc.getMap("x");
        expect(xMap.get("foo")).toBe("bar");
        // `$cid` is reserved and never written into Loro
        expect(xMap.get(CID_KEY)).toBeUndefined();
    });

    it("TO_LORO: deleting $cid on map is ignored (no Loro changes)", async () => {
        const doc = new LoroDoc();
        const s = schema({ m: schema.LoroMap({ name: schema.String() }) });
        const m = new Mirror({ doc, schema: s });

        // Take a baseline of Loro JSON
        const before = JSON.stringify(doc.toJSON());

        // Remove synthetic field from state; diffMap should ignore
        await m.setState((draft: any) => {
            delete draft.m[CID_KEY];
        });
        await Promise.resolve();

        const after = JSON.stringify(doc.toJSON());
        expect(after).toBe(before);
    });

    it("TO_LORO + consistency check: changing $cid throws divergence error", async () => {
        const doc = new LoroDoc();
        const s = schema({ m: schema.LoroMap({ label: schema.String() }) });
        const m = new Mirror({ doc, schema: s, checkStateConsistency: true });

        await expect(
            m.setState((draft: any) => {
                draft.m.label = "ok";
                draft.m[CID_KEY] = "tamper"; // should be ignored to Loro and trigger consistency error
            }),
        ).rejects.toThrow();
    });

    it("list items: $cid values exist and are unique per item", async () => {
        const doc = new LoroDoc();
        const list = doc.getList("list");
        const s = schema({
            list: schema.LoroList(schema.LoroMap({ value: schema.Number() })),
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
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
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
                schema.LoroMap({ val: schema.Number() }),
                (it) => it.$cid,
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
        await m.setState({ items: [second, first] } as any);
        await Promise.resolve();

        const after = m.getState();
        expect(after.items[0][CID_KEY]).toBe(second[CID_KEY]);
        expect(after.items[1][CID_KEY]).toBe(first[CID_KEY]);
    });

    // setState-created containers should have $cid in final state
    it("TO_LORO setState: nested map container gets $cid in final state (same mirror)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            root: schema.LoroMap({
                child: schema.LoroMap({ name: schema.String() }),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        // Create nested container via setState
        await m.setState({ root: { child: { name: "x" } } } as any);
        const st = m.getState() as any;
        expect(st.root.child.name).toBe("x");
        expect(typeof st.root.child[CID_KEY]).toBe("string");
    });

    it("TO_LORO setState: replacing existing child map with plain object reattaches $cid", async () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        const child = new LoroMap();
        child.set("name", "x");
        const attached = root.setContainer("child", child);
        doc.commit();

        const s = schema({
            root: schema.LoroMap({
                child: schema.LoroMap({ name: schema.String() }),
            }),
        });
        const m = new Mirror({ doc, schema: s });
        const before = m.getState() as any;
        const cidBefore = before.root.child[CID_KEY];
        expect(cidBefore).toBe(attached.id);

        // Replace existing child map by passing a plain object without $cid
        await m.setState({ root: { child: { name: "y" } } } as any);

        const after = m.getState() as any;
        expect(after.root.child.name).toBe("y");
        // $cid should persist/be reattached
        expect(after.root.child[CID_KEY]).toBe(cidBefore);
    });

    it("TO_LORO setState: updating existing tree node data without $cid preserves it", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const n = tree.createNode(undefined, 0);
        n.data.set("title", "A");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        const before = m.getState() as any;
        const prevCid = before.tree[0].data[CID_KEY];
        expect(typeof prevCid).toBe("string");

        // Update node data via setState, omitting $cid
        await m.setState({
            tree: [
                { id: before.tree[0].id, data: { title: "A*" }, children: [] },
            ],
        } as any);

        const after = m.getState() as any;
        expect(after.tree[0].data.title).toBe("A*");
        expect(after.tree[0].data[CID_KEY]).toBe(prevCid);
    });

    it("TO_LORO setState: list items get $cid in final state (same mirror)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            list: schema.LoroList(schema.LoroMap({ v: schema.Number() })),
        });
        const m = new Mirror({ doc, schema: s });
        await m.setState({ list: [{ v: 1 }, { v: 2 }] } as any);
        const st = m.getState() as any;
        expect(st.list).toHaveLength(2);
        expect(typeof st.list[0][CID_KEY]).toBe("string");
        expect(typeof st.list[1][CID_KEY]).toBe("string");
    });

    it("TO_LORO setState: tree nodes' data get $cid in final state (same mirror)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });
        await m.setState({
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
