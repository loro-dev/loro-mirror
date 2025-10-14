/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable unicorn/consistent-function-scoping */
import { describe, it, expect } from "vitest";
import { LoroDoc, LoroText, type LoroEventBatch } from "loro-crdt";
import { Mirror } from "../src/core/mirror";
import { applyEventBatchToState } from "../src/core/loroEventApply";
import { schema } from "../src/schema";

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

    it("FUZZ: setState with random tree moves (deterministic, consistency check only)", async () => {
        // Deterministic PRNG (mulberry32)
        const mulberry32 = (seed: number) => () => {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        type Node = { id: string; data: { title: string }; children: Node[] };

        const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

        const pick = <T>(rng: () => number, arr: T[]): T =>
            arr[Math.floor(rng() * arr.length)];

        const allNodes = (roots: Node[]): Node[] => {
            const out: Node[] = [];
            const walk = (ns: Node[]) => {
                for (const n of ns) {
                    out.push(n);
                    if (n.children.length) walk(n.children);
                }
            };
            walk(roots);
            return out;
        };

        const findParent = (
            roots: Node[],
            id: string,
        ): {
            parentChildren: Node[];
            index: number;
            parentId?: string;
        } | null => {
            const stack: { parent?: Node; list: Node[] }[] = [{ list: roots }];
            while (stack.length) {
                const { parent, list } = stack.pop()!;
                for (let i = 0; i < list.length; i++) {
                    const n = list[i];
                    if (n.id === id) {
                        return {
                            parentChildren: list,
                            index: i,
                            parentId: parent?.id,
                        };
                    }
                    if (n.children.length)
                        stack.push({ parent: n, list: n.children });
                }
            }
            return null;
        };

        const isDescendant = (
            roots: Node[],
            ancestorId: string,
            maybeChildId: string,
        ) => {
            if (ancestorId === undefined || maybeChildId === undefined)
                return false;
            const parent = findParent(roots, maybeChildId);
            let curParentId = parent?.parentId;
            while (curParentId) {
                if (curParentId === ancestorId) return true;
                curParentId = findParent(roots, curParentId)?.parentId;
            }
            return false;
        };

        const moveNode = (
            roots: Node[],
            nodeId: string,
            newParentId: string | undefined,
            newIndex: number,
        ): Node[] => {
            const tree = clone(roots);
            const from = findParent(tree, nodeId);
            if (!from) return tree; // shouldn't happen
            const [node] = from.parentChildren.splice(from.index, 1);
            // Compute destination list
            let destList: Node[];
            if (!newParentId) {
                destList = tree;
            } else {
                const parentLoc = findParent(tree, newParentId);
                if (!parentLoc) return tree;
                destList = parentLoc.parentChildren[parentLoc.index].children;
            }
            // Clamp index
            const idx = Math.max(0, Math.min(newIndex, destList.length));
            destList.splice(idx, 0, node);
            return tree;
        };

        const buildInitial = (rng: () => number, count: number): Node[] => {
            const nodes: Node[] = Array.from({ length: count }, (_, i) => ({
                id: "",
                data: { title: `n${i}` },
                children: [],
            }));
            const roots: Node[] = [];
            for (let i = 0; i < nodes.length; i++) {
                const parentPick = Math.floor(rng() * (i + 1)) - 1; // -1 => root
                const n = nodes[i];
                if (parentPick < 0) {
                    const pos = Math.floor(rng() * (roots.length + 1));
                    roots.splice(pos, 0, n);
                } else {
                    const parent = nodes[parentPick];
                    const pos = Math.floor(
                        rng() * (parent.children.length + 1),
                    );
                    parent.children.splice(pos, 0, n);
                }
            }
            return roots;
        };

        const runOnce = async (seed: number) => {
            const rng = mulberry32(seed);
            const doc = new LoroDoc();
            const s = schema({
                tree: schema.LoroTree(
                    schema.LoroMap({
                        title: schema.String(),
                    }),
                ),
            });
            const m = new Mirror({
                doc,
                schema: s,
                checkStateConsistency: true,
            });

            const docB = new LoroDoc();
            const mB = new Mirror({
                doc: docB,
                schema: s,
            });

            // 1) Create an initial random tree
            const initial = buildInitial(rng, 12);
            m.setState({ tree: initial } as any);

            // 2) Apply a sequence of random moves by producing next state trees
            const steps = 60;
            for (let step = 0; step < steps; step++) {
                const cur = m.getState() as any;
                const roots: Node[] = cur.tree as Node[];
                const nodes = allNodes(roots);
                if (nodes.length <= 1) continue;

                // Choose a node to move
                const src = pick(rng, nodes);

                // Choose a new parent (possibly root); avoid cycles
                const parentCandidates: (string | undefined)[] = [undefined];
                for (const n of nodes) {
                    if (n.id !== src.id && !isDescendant(roots, src.id, n.id)) {
                        parentCandidates.push(n.id);
                    }
                }
                const targetParentId = pick(rng, parentCandidates);

                // Choose a target index in the parent
                let targetSiblingsLen = 0;
                if (!targetParentId) {
                    targetSiblingsLen = roots.length;
                } else {
                    const loc = findParent(roots, targetParentId)!;
                    targetSiblingsLen =
                        loc.parentChildren[loc.index].children.length;
                }
                const targetIndex = Math.floor(rng() * (targetSiblingsLen + 1));

                const nextTree = moveNode(
                    roots,
                    src.id,
                    targetParentId,
                    targetIndex,
                );
                // If the move is a no-op (same parent + index), skip sometimes to avoid churn
                m.setState({ tree: nextTree } as any);
                docB.import(
                    doc.export({ mode: "update", from: docB.version() }),
                );
                await Promise.resolve();
                expect(mB.getState()).toStrictEqual(m.getState());
                mB.checkStateConsistency();
            }
        };

        // Try multiple seeds
        for (const seed of [1, 42, 2025]) {
            await runOnce(seed);
        }
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
        expect(
            titles.sort((a, b) => String(a).localeCompare(String(b))),
        ).toEqual(["A", "B"]);
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
    it("FROM_LORO: out-of-bounds create index clamps to valid range", () => {
        // Start with empty tree state
        let state: any = { tree: [] };

        // Create with very large index -> should clamp to end (index 0 when empty)
        state = applyEventBatchToState(state, {
            by: "local",
            events: [
                {
                    target: "cid:root-tree:Tree" as any,
                    path: ["tree"],
                    diff: {
                        type: "tree",
                        diff: [
                            {
                                action: "create",
                                target: "1@1" as any,
                                parent: undefined,
                                index: 1000,
                            },
                        ],
                    },
                } as any,
            ],
            from: [],
            to: [],
        } as any);
        expect(state.tree.map((n: any) => n.id)).toEqual(["1@1"]);

        // Create with negative index -> should clamp to 0 (insert at front)
        state = applyEventBatchToState(state, {
            by: "local",
            events: [
                {
                    target: "cid:root-tree:Tree" as any,
                    path: ["tree"],
                    diff: {
                        type: "tree",
                        diff: [
                            {
                                action: "create",
                                target: "2@1" as any,
                                parent: undefined,
                                index: -100,
                            },
                        ],
                    },
                } as any,
            ],
            from: [],
            to: [],
        } as any);
        expect(state.tree.map((n: any) => n.id)).toEqual(["2@1", "1@1"]);
    });
    it("FROM_LORO: move with wrong indices still finds by id and moves", () => {
        // Pre-populate state with three roots
        let state: any = {
            tree: [
                { id: "1@1", data: {}, children: [] },
                { id: "2@1", data: {}, children: [] },
                { id: "3@1", data: {}, children: [] },
            ],
        };

        // Move target "2@1" to front but provide a bogus oldIndex
        state = applyEventBatchToState(state, {
            by: "local",
            events: [
                {
                    target: "cid:root-tree:Tree" as any,
                    path: ["tree"],
                    diff: {
                        type: "tree",
                        diff: [
                            {
                                action: "move",
                                target: "2@1" as any,
                                parent: undefined,
                                index: 0,
                                oldParent: undefined,
                                oldIndex: 999, // wrong, should fall back to id search
                            },
                        ],
                    },
                } as any,
            ],
            from: [],
            to: [],
        } as any);
        expect(state.tree.map((n: any) => n.id)).toEqual(["2@1", "1@1", "3@1"]);
    });
    it("FROM_LORO: delete with wrong index falls back to delete by id", () => {
        // Pre-populate state with three roots
        let state: any = {
            tree: [
                { id: "1@1", data: {}, children: [] },
                { id: "2@1", data: {}, children: [] },
                { id: "3@1", data: {}, children: [] },
            ],
        };

        // Delete target "2@1" but pass an out-of-range oldIndex
        state = applyEventBatchToState(state, {
            by: "local",
            events: [
                {
                    target: "cid:root-tree:Tree" as any,
                    path: ["tree"],
                    diff: {
                        type: "tree",
                        diff: [
                            {
                                action: "delete",
                                target: "2@1" as any,
                                oldParent: undefined,
                                oldIndex: 999, // wrong, should fall back to id search
                            },
                        ],
                    },
                } as any,
            ],
            from: [],
            to: [],
        } as any);
        expect(state.tree.map((n: any) => n.id)).toEqual(["1@1", "3@1"]);
    });
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
    it("FROM_LORO: move and update in same batch resolves TreeID to new location", async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");

        // Initial structure: [A, B]
        const a = tree.createNode();
        a.data.set("title", "A");
        const b = tree.createNode();
        b.data.set("title", "B");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        // In one batch: move A after B, then update A.title
        tree.move(a.id, undefined, 1); // target order: [B, A]
        a.data.set("title", "A-updated");
        doc.commit();
        await tick();

        const titles = m.getState().tree.map((n: any) => n.data.title);
        expect(titles).toEqual(["B", "A-updated"]);
    });
    it("FROM_LORO: Tree nested in Map uses TreeID path to write into node.data", async () => {
        const doc = new LoroDoc();
        const rootMap = doc.getMap("root");
        const tree = rootMap.setContainer("tree", doc.getTree("inner"));

        // Create a node and update its data in one commit
        const node = tree.createNode();
        node.data.set("label", "n1");
        doc.commit();

        const s = schema({
            root: schema.LoroMap({
                tree: schema.LoroTree(
                    schema.LoroMap({ label: schema.String() }),
                ),
            }),
        });

        const m = new Mirror({ doc, schema: s });
        const state = m.getState() as any;
        // Expect path mapping: state.root.tree[0].data.label
        expect(state.root.tree).toBeTruthy();
        expect(state.root.tree[0].data.label).toBe("n1");

        // Update the node's data and ensure it propagates
        node.data.set("label", "n1*");
        doc.commit();
        await tick();
        expect(m.getState().root.tree[0].data.label).toBe("n1*");
    });
    it('FROM_LORO: LoroList in node.data applies list deltas via ["tree", TreeID, "tags"] path', async () => {
        const doc = new LoroDoc();
        const tree = doc.getTree("tree");
        const n = tree.createNode();
        // Attach a list container in node.data
        const tags = n.data.setContainer("tags", doc.getList("tags"));
        tags.push("x");
        tags.push("y");
        doc.commit();

        const s = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    tags: schema.LoroList(schema.String()),
                }),
            ),
        });
        const m = new Mirror({ doc, schema: s });

        // Initial mirror should show ["x","y"]
        expect(m.getState().tree[0].data.tags).toEqual(["x", "y"]);

        // Modify the list and ensure deltas are applied
        tags.insert(1, "mid"); // ["x","mid","y"]
        tags.delete(0, 1); // ["mid","y"]
        doc.commit();
        await tick();
        expect(m.getState().tree[0].data.tags).toEqual(["mid", "y"]);
    });
    it("FROM_LORO: ignores mirror-produced events to avoid feedback", async () => {
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

        // Only TO_LORO notification should be recorded (FROM_LORO ignored because we suppress local commits)
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
                    data: { title: "A", done: false },
                    children: [
                        {
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
    it("TO_LORO: invalid tree value (non-array) throws validation error", () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        expect(() => {
            m.setState({
                tree: { id: "", data: { title: "X" } },
            } as any);
        }).toThrow();
    });
    it("TO_LORO: invalid node shape (children not array) throws", () => {
        const doc = new LoroDoc();
        const s = schema({
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const m = new Mirror({ doc, schema: s });

        expect(() => {
            m.setState({
                tree: [
                    {
                        id: "",
                        data: { title: "X" },
                        children: "oops",
                    },
                ],
            } as any);
        }).toThrow();
    });

    // Nested tree container inside a map
    it("Nested Tree in Map: incremental diff yields create/move/delete (no full rebuild)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            root: schema.LoroMap({
                tree: schema.LoroTree(
                    schema.LoroMap({ title: schema.String() }),
                ),
            }),
        });
        const m = new Mirror({ doc, schema: s });

        // Initial state: three root nodes A, B, C under root.tree
        m.setState({
            root: {
                tree: [
                    { id: "", data: { title: "A" }, children: [] },
                    { id: "", data: { title: "B" }, children: [] },
                    { id: "", data: { title: "C" }, children: [] },
                ],
            },
        } as any);
        await tick();

        // Grab ids from mirror state to preserve identity across update
        const st0: any = m.getState();
        const [A, B, C] = st0.root.tree;
        expect([A, B, C].map((n: any) => typeof n.id === "string")).toEqual([
            true,
            true,
            true,
        ]);

        // Collect only the tree diffs from the reorder commit
        let lastTreeOps: any[] = [];
        const batches: LoroEventBatch[] = [];
        const unsub = doc.subscribe((batch) => {
            batches.push(batch);
        });

        // New state: reorder to C, A, B (by ids) – expect only moves, not full delete+create
        m.setState({
            root: {
                tree: [C, A, B],
            },
        } as any);
        await tick();
        unsub();

        const lastBatch = batches[batches.length - 1];
        expect(lastBatch).toBeDefined();
        if (lastBatch) {
            for (const e of lastBatch.events) {
                if (e.diff.type === "tree") {
                    lastTreeOps.push(...e.diff.diff);
                }
            }
        }

        // Validate we only saw move operations (no full rebuild)
        expect(lastTreeOps.length).toBeGreaterThan(0);
        expect(lastTreeOps.every((op) => op.action === "move")).toBe(true);
        // And final state order matches
        expect(m.getState().root.tree.map((n: any) => n.data.title)).toEqual([
            "C",
            "A",
            "B",
        ]);
    });
    it("Schema registration: node.data containers are registered for nested updates", async () => {
        const doc = new LoroDoc();
        const s = schema({
            root: schema.LoroMap({
                tree: schema.LoroTree(
                    schema.LoroMap({
                        title: schema.String(),
                        desc: schema.LoroText(),
                    }),
                ),
            }),
        });
        const m = new Mirror({ doc, schema: s });

        // Create a single node with a LoroText under data.desc via setState
        m.setState({
            root: {
                tree: [
                    {
                        id: "",
                        data: { title: "A", desc: "hello" },
                        children: [],
                    },
                ],
            },
        } as any);
        await tick();

        // Ensure initial state reflects text value
        expect(m.getState().root.tree[0].data.desc).toBe("hello");

        // Update desc via LoroText container and ensure FROM_LORO event updates state
        const tree = doc.getMap("root").get("tree") as any; // LoroTree
        const node = tree.getNodes()[0];
        const descText = node.data.get("desc") as LoroText;
        descText.update("world");
        doc.commit();
        await tick();

        expect(m.getState().root.tree[0].data.desc).toBe("world");
    });
});
