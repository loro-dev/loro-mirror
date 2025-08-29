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

    // FROM_LORO edge cases
    it.todo("FROM_LORO: creates nested subtree and normalizes meta->data shape");
    it.todo("FROM_LORO: updates node.data fields (set/add/delete) reflect under data");
    it("FROM_LORO: move within same parent (forward and backward) updates order correctly", async () => {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "root");
        const a = root.createNode();
        a.data.set("title", "A");
        const b = root.createNode();
        b.data.set("title", "B");
        const c = root.createNode();
        c.data.set("title", "C");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        // Initial order A,B,C
        expect(m.getState().tree[0].children.map((n: any) => n.data.title)).toEqual([
            "A",
            "B",
            "C",
        ]);

        // Move B forward to the end: A,C,B
        tree.move(b.id, root.id, 2);
        doc.commit();
        await tick();
        expect(m.getState().tree[0].children.map((n: any) => n.data.title)).toEqual([
            "A",
            "C",
            "B",
        ]);

        // Move B to the front: B,A,C
        tree.move(b.id, root.id, 0);
        doc.commit();
        await tick();
        expect(m.getState().tree[0].children.map((n: any) => n.data.title)).toEqual([
            "B",
            "A",
            "C",
        ]);
    });
    it.todo("FROM_LORO: move across parents (root <-> child) preserves subtree");
    it.todo("FROM_LORO: delete leaf vs delete subtree remove expected nodes");
    it.todo("FROM_LORO: out-of-bounds create index clamps to valid range");
    it.todo("FROM_LORO: move with wrong indices still finds by id and moves");
    it.todo("FROM_LORO: delete with wrong index falls back to delete by id");
    it.todo("FROM_LORO: nested containers in node.data (e.g., LoroText) propagate updates");
    it.todo("FROM_LORO: ignores own origin 'to-loro' events to avoid feedback");

    // TO_LORO edge cases
    it.todo("TO_LORO: setState can create nested subtree and initialize node.data");
    it.todo("TO_LORO: setState reorders siblings to match state order");
    it.todo("TO_LORO: setState moves nodes across parents (root <-> child)");
    it("TO_LORO: setState deletes leaf and subtree nodes", async () => {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        // Create nested tree: A(A1,A2), B
        m.setState({
            tree: [
                {
                    id: "",
                    data: { title: "A" },
                    children: [
                        { id: "", data: { title: "A1" }, children: [] },
                        { id: "", data: { title: "A2" }, children: [] },
                    ],
                },
                { id: "", data: { title: "B" }, children: [] },
            ],
        } as any);
        await tick();

        // Now delete subtree A by setting only B as root
        m.setState({
            tree: [
                { id: "", data: { title: "B" }, children: [] },
            ],
        } as any);
        await tick();

        // Verify doc tree contains only B and no A/A1/A2
        const titles = doc
            .getTree("tree")
            .getNodes()
            .map((n: any) => n.data.get("title"));
        expect(titles).toContain("B");
        expect(titles).not.toContain("A");
        expect(titles).not.toContain("A1");
        expect(titles).not.toContain("A2");

        // Verify mirror state
        const st = m.getState();
        expect(st.tree.length).toBe(1);
        expect(st.tree[0].data.title).toBe("B");
        expect(st.tree[0].children.length).toBe(0);
    });
    it.todo("TO_LORO: setState updates node.data fields and nested containers");
    it.todo("TO_LORO: explicit node ids in state are ignored; Loro assigns ids");
    it.todo("TO_LORO: invalid tree value (non-array) throws validation error");
    it.todo("TO_LORO: invalid node shape (children not array) throws");

    // Nested tree container inside a map
    it.todo("Nested Tree in Map: incremental diff yields create/move/delete (no full rebuild)");
    it.todo("Schema registration: node.data containers are registered for nested updates");
});
