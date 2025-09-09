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
});
