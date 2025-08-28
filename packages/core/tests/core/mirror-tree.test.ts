import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror } from "../../src/core/mirror";
import { schema } from "../../src/schema";

// Small helper to wait for microtasks (mirror commits async)
const tick = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("LoroTree integration", () => {
    it("FROM_LORO: applies create and data updates to state", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "root");
        const child = root.createNode();
        child.data.set("title", "child");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                }),
            ),
        });

        const m = new Mirror({ doc, schema: s });

        const st = m.getState();
        expect(Array.isArray(st.tree)).toBe(true);
        expect(st.tree.length).toBe(1);
        expect(st.tree[0].data.title).toBe("root");
        expect(st.tree[0].children.length).toBe(1);
        expect(st.tree[0].children[0].data.title).toBe("child");
    });

    it("TO_LORO: creates nodes and initializes data", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        m.setState({
            tree: [
                { id: "", data: { title: "A" }, children: [] },
                { id: "", data: { title: "B" }, children: [] },
            ],
        } as any);

        await tick();

        const nodes = doc.getTree("tree").getNodes();
        expect(nodes.length).toBe(2);
        // Verify data initialized
        const titles = nodes
            .filter((n) => (n.parent() === undefined))
            .map((n) => n.data.get("title"));
        expect(titles.sort()).toEqual(["A", "B"]);
    });
});

