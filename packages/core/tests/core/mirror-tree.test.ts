/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from "vitest";
import { LoroDoc, LoroText } from "loro-crdt";
import { Mirror } from "../../src/core/mirror";
import { schema } from "../../src/schema";

// Small helper to wait for microtasks (mirror commits async)
const tick = async () => {
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
            .filter((n) => n.parent() === undefined)
            .map((n) => n.data.get("title"));
        expect(titles.sort()).toEqual(["A", "B"]);
    });

    // FROM_LORO edge cases
    it("FROM_LORO: creates nested subtree and normalizes meta->data shape", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "A");
        const a1 = root.createNode();
        a1.data.set("title", "A1");
        const a11 = a1.createNode();
        a11.data.set("title", "A1-1");
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
        expect(st.tree.length).toBe(1);
        expect(st.tree[0].data.title).toBe("A");
        expect(st.tree[0].children.length).toBe(1);
        expect(st.tree[0].children[0].data.title).toBe("A1");
        expect(st.tree[0].children[0].children.length).toBe(1);
        expect(st.tree[0].children[0].children[0].data.title).toBe("A1-1");
        // ensure normalized shape uses `data` (not `meta`)
        // @ts-expect-error
        expect(st.tree[0].meta).toBeUndefined();
    });
    it("FROM_LORO: updates node.data fields (set/add/delete) reflect under data", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "root");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    done: schema.Boolean(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });
        await tick();

        // update existing field
        root.data.set("title", "root2");
        doc.commit();
        await tick();
        expect(m.getState().tree[0].data.title).toBe("root2");

        // add new field
        root.data.set("done", true);
        doc.commit();
        await tick();
        expect(m.getState().tree[0].data.done).toBe(true);

        // delete a field
        root.data.delete("title");
        doc.commit();
        await tick();
        expect(m.getState().tree[0].data.title).toBeUndefined();
    });
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
        expect(
            m.getState().tree[0].children.map((n: any) => n.data.title),
        ).toEqual(["A", "B", "C"]);

        // Move B forward to the end: A,C,B
        tree.move(b.id, root.id, 2);
        doc.commit();
        await tick();
        expect(
            m.getState().tree[0].children.map((n: any) => n.data.title),
        ).toEqual(["A", "C", "B"]);

        // Move B to the front: B,A,C
        tree.move(b.id, root.id, 0);
        doc.commit();
        await tick();
        expect(
            m.getState().tree[0].children.map((n: any) => n.data.title),
        ).toEqual(["B", "A", "C"]);
    });
    it("FROM_LORO: move across parents (root <-> child) preserves subtree", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "root");
        const a = root.createNode();
        a.data.set("title", "A");
        const a1 = a.createNode();
        a1.data.set("title", "A1");
        const b = root.createNode();
        b.data.set("title", "B");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        // Move A under B
        tree.move(a.id, b.id, 0);
        doc.commit();
        await tick();

        const st = m.getState();
        expect(st.tree.length).toBe(1);
        // Only B remains at root
        expect(st.tree[0].children[0].data.title).toBe("B");
        // A should now be B's first child, and A1 preserved under A
        expect(st.tree[0].children[0].children.length).toBe(1);
        expect(st.tree[0].children[0].children[0].data.title).toBe("A");
        expect(st.tree[0].children[0].children[0].children.length).toBe(1);
        expect(st.tree[0].children[0].children[0].children[0].data.title).toBe(
            "A1",
        );
    });
    it("FROM_LORO: delete leaf vs delete subtree remove expected nodes", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const a = tree.createNode();
        a.data.set("title", "A");
        const a1 = a.createNode();
        a1.data.set("title", "A1");
        const b = tree.createNode();
        b.data.set("title", "B");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        // Delete leaf A1
        tree.delete(a1.id);
        doc.commit();
        await tick();
        let st = m.getState();
        expect(st.tree.map((n: any) => n.data.title)).toEqual(["A", "B"]);
        expect(st.tree[0].children.length).toBe(0);

        // Delete subtree A
        tree.delete(a.id);
        doc.commit();
        await tick();
        st = m.getState();
        expect(st.tree.map((n: any) => n.data.title)).toEqual(["B"]);
    });
    it.todo("FROM_LORO: out-of-bounds create index clamps to valid range");
    it.todo("FROM_LORO: move with wrong indices still finds by id and moves");
    it.todo("FROM_LORO: delete with wrong index falls back to delete by id");
    it("FROM_LORO: nested containers in node.data (e.g., LoroText) propagate updates", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const root = tree.createNode();
        root.data.set("title", "root");

        // Attach a text container into node.data
        const descText = root.data.setContainer("desc", new LoroText());
        descText.update("Hello");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    desc: schema.LoroText(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        // Initial value from text container
        expect(m.getState().tree[0].data.desc).toBe("Hello");

        // Update text container and expect state update
        descText.update("Hello World");
        doc.commit();
        await tick();
        expect(m.getState().tree[0].data.desc).toBe("Hello World");
    });
    it("FROM_LORO: LoroText inside LoroMap inside a depth-2 LoroTreeNode updates correctly", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");

        // Build depth: root(0) -> child(1) -> grandchild(2)
        const root = tree.createNode();
        root.data.set("title", "root");
        const child = root.createNode();
        child.data.set("title", "child");
        const grand = child.createNode();
        grand.data.set("title", "grand");

        // Attach a text container at grandchild.data.text
        const text = grand.data.setContainer("text", new LoroText());
        text.update("depth2");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    text: schema.LoroText(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        // Initial mirrored value should reflect the container content
        expect(m.getState().tree[0].children[0].children[0].data.text).toBe(
            "depth2",
        );

        // Update the text and ensure it propagates via event path ["tree", grand.id, "text"]
        text.update("depth2-updated");
        doc.commit();
        await tick();
        expect(m.getState().tree[0].children[0].children[0].data.text).toBe(
            "depth2-updated",
        );
    });
    it("FROM_LORO: ignores own origin 'to-loro' events to avoid feedback", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        const directions: string[] = [];
        m.subscribe((_st, meta) => directions.push(meta.direction));

        m.setState({
            tree: [{ id: "", data: { title: "X" }, children: [] }],
        } as any);
        await tick();

        // Only TO_LORO notification should be recorded (FROM_LORO ignored due to origin)
        expect(directions.filter((d) => d === "TO_LORO").length).toBe(1);
        expect(directions.filter((d) => d === "FROM_LORO").length).toBe(0);
    });

    // TO_LORO edge cases
    it("TO_LORO: setState can create nested subtree and initialize node.data", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    done: schema.Boolean(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        m.setState({
            tree: [
                {
                    id: "",
                    data: { title: "A", done: false },
                    children: [
                        {
                            id: "",
                            data: { title: "A1", done: true },
                            children: [],
                        },
                    ],
                },
            ],
        } as any);
        await tick();

        const st = m.getState();
        expect(st.tree[0].data.title).toBe("A");
        expect(st.tree[0].data.done).toBe(false);
        expect(st.tree[0].children[0].data.title).toBe("A1");
        expect(st.tree[0].children[0].data.done).toBe(true);
    });
    it("TO_LORO: setState reorders siblings to match state order", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        m.setState({
            tree: [
                { id: "", data: { title: "A" }, children: [] },
                { id: "", data: { title: "B" }, children: [] },
                { id: "", data: { title: "C" }, children: [] },
            ],
        } as any);
        await tick();

        // Reorder to C, A, B
        m.setState({
            tree: [
                { id: "", data: { title: "C" }, children: [] },
                { id: "", data: { title: "A" }, children: [] },
                { id: "", data: { title: "B" }, children: [] },
            ],
        } as any);
        await tick();

        expect(m.getState().tree.map((n: any) => n.data.title)).toEqual([
            "C",
            "A",
            "B",
        ]);
    });
    it("TO_LORO: setState moves nodes across parents (root <-> child)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        m.setState({
            tree: [
                {
                    id: "",
                    data: { title: "A" },
                    children: [{ id: "", data: { title: "x" }, children: [] }],
                },
                { id: "", data: { title: "B" }, children: [] },
            ],
        } as any);
        await tick();

        // Move A under B in state
        m.setState({
            tree: [
                {
                    id: "",
                    data: { title: "B" },
                    children: [
                        {
                            id: "",
                            data: { title: "A" },
                            children: [
                                { id: "", data: { title: "x" }, children: [] },
                            ],
                        },
                    ],
                },
            ],
        } as any);
        await tick();

        const st = m.getState();
        expect(st.tree.length).toBe(1);
        expect(st.tree[0].data.title).toBe("B");
        expect(st.tree[0].children[0].data.title).toBe("A");
        expect(st.tree[0].children[0].children[0].data.title).toBe("x");
    });
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
            tree: [{ id: "", data: { title: "B" }, children: [] }],
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
    it("TO_LORO: setState updates node.data fields and nested containers", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    desc: schema.LoroText(),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        m.setState({
            tree: [{ id: "", data: { title: "A", desc: "one" }, children: [] }],
        } as any);
        await tick();
        // Update data fields in state
        m.setState({
            tree: [
                { id: "", data: { title: "A2", desc: "two" }, children: [] },
            ],
        } as any);
        await tick();

        // Verify doc reflects updates
        const titles = doc
            .getTree("tree")
            .getNodes()
            .map((n: any) => n.data.get("title"));
        expect(titles).toContain("A2");

        // The nested LoroText should hold updated content
        const node = doc
            .getTree("tree")
            .getNodes()
            .find((n: any) => {
                return n.data.get("title") === "A2";
            });
        expect((node!.data.get("desc") as LoroText).toString()).toBe("two");
    });
    it("TO_LORO: explicit node ids in state are ignored; Loro assigns ids", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        // Provide explicit ids in state
        m.setState({
            tree: [
                { id: "my-id", data: { title: "A" }, children: [] },
                { id: "my-id-2", data: { title: "B" }, children: [] },
            ],
        } as any);
        await tick();

        // Doc should have auto-assigned TreeIDs (number@peer), not "my-id"
        const nodeIds = doc
            .getTree("tree")
            .getNodes()
            .map((n: any) => n.id);
        expect(nodeIds).not.toContain("my-id");
        expect(nodeIds).not.toContain("my-id-2");
        // sanity: ensure format looks like `${number}@${peer}`
        expect(nodeIds.every((id: string) => /@/.test(id))).toBe(true);
    });
    it("TO_LORO: invalid tree value (non-array) throws validation error", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        expect(() =>
            m.setState({
                tree: { id: "", data: { title: "X" } },
            } as any),
        ).toThrow();
    });
    it("TO_LORO: invalid node shape (children not array) throws", async () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        expect(() =>
            m.setState({
                tree: [
                    {
                        id: "",
                        data: { title: "X" },
                        children: "oops",
                    },
                ],
            } as any),
        ).toThrow();
    });

    // Nested tree container inside a map
    // Leaving the following as TODOs as they depend on finer-grained diffing for nested trees
    it.todo(
        "Nested Tree in Map: incremental diff yields create/move/delete (no full rebuild)",
    );
    it.todo(
        "Schema registration: node.data containers are registered for nested updates",
    );
});
