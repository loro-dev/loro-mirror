import { describe, expect, it } from "vitest";
import { isContainer, LoroDoc, LoroList, LoroMap } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

const waitForSync = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

function syncDocs(a: LoroDoc, b: LoroDoc) {
    const updateA = a.export({ mode: "update" });
    const updateB = b.export({ mode: "update" });
    a.import(updateB);
    b.import(updateA);
}

const makeSchema = () =>
    schema({
        records: schema.LoroMapRecord(
            schema.LoroMap({
                entries: schema.LoroList(schema.String()),
            }),
        ),
    });

const makeRecordTextSchema = (mergeableMapChildContainers = true) =>
    schema({
        records: schema.LoroMapRecord(schema.LoroMapRecord(schema.String()), {
            mergeableMapChildContainers,
        }),
    });

const makeFixedTextSchema = () =>
    schema({
        root: schema.LoroMap(
            {
                note: schema.LoroMapRecord(schema.String()),
            },
            { mergeableMapChildContainers: true },
        ),
    });

const makeNestedContainerSchema = () =>
    schema({
        root: schema.LoroMap(
            {
                note: schema.LoroMap(
                    {
                        body: schema.LoroText(),
                        tags: schema.LoroList(schema.String()),
                    },
                    { mergeableMapChildContainers: true },
                ),
            },
            { mergeableMapChildContainers: true },
        ),
    });

const makeTextContainerSchema = () =>
    schema({
        root: schema.LoroMap(
            {
                body: schema.LoroText(),
            },
            { mergeableMapChildContainers: true },
        ),
    });

const selectItemId = (item: unknown) => {
    if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id: unknown }).id;
        return typeof id === "string" ? id : "";
    }
    return "";
};

const makeMovableListContainerSchema = () =>
    schema({
        root: schema.LoroMap(
            {
                items: schema.LoroMovableList(
                    schema.LoroMap({
                        id: schema.String(),
                        text: schema.String(),
                    }),
                    selectItemId,
                ),
            },
            { mergeableMapChildContainers: true },
        ),
    });

const makeTreeContainerSchema = () =>
    schema({
        root: schema.LoroMap(
            {
                tree: schema.LoroTree(
                    schema.LoroMap({
                        title: schema.String(),
                    }),
                ),
            },
            { mergeableMapChildContainers: true },
        ),
    });

const makeOptionalFieldSchema = () =>
    schema({
        root: schema.LoroMap(
            {
                note: schema.LoroMap({
                    title: schema.String(),
                    opt: schema.String({ required: false }),
                }),
            },
            { mergeableMapChildContainers: true },
        ),
    });

describe("mergeable map child containers", () => {
    it("keeps old setContainer semantics by default", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({ doc: docA, schema: makeSchema() });
        const mirrorB = new Mirror({ doc: docB, schema: makeSchema() });

        mirrorA.setState({
            records: { note: { entries: ["A"] } },
        });
        mirrorB.setState({
            records: { note: { entries: ["B"] } },
        });

        syncDocs(docA, docB);
        await waitForSync();

        const stateA = mirrorA.getState();
        const stateB = mirrorB.getState();
        const entriesA = stateA.records.note.entries;
        const entriesB = stateB.records.note.entries;

        expect(entriesA).toEqual(entriesB);
        expect(entriesA).toHaveLength(1);
        expect(["A", "B"]).toContain(entriesA[0]);
    });

    it("merges concurrent first creation when enabled", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const options = { mergeableMapChildContainers: true };
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeSchema(),
            inferOptions: options,
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeSchema(),
            inferOptions: options,
        });

        mirrorA.setState({
            records: { note: { entries: ["A"] } },
        });
        mirrorB.setState({
            records: { note: { entries: ["B"] } },
        });

        syncDocs(docA, docB);
        await waitForSync();

        const stateA = mirrorA.getState();
        const stateB = mirrorB.getState();
        const entriesA = [...stateA.records.note.entries].sort();
        const entriesB = [...stateB.records.note.entries].sort();

        expect(entriesA).toEqual(["A", "B"]);
        expect(entriesB).toEqual(["A", "B"]);
    });

    it("uses parent map options for non-Any catchall child containers", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeRecordTextSchema(),
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeRecordTextSchema(),
        });

        mirrorA.setState({
            records: { note: { title: "A" } },
        });
        mirrorB.setState({
            records: { note: { body: "B" } },
        });

        syncDocs(docA, docB);
        await waitForSync();

        expect(mirrorA.getState().records.note.title).toBe("A");
        expect(mirrorA.getState().records.note.body).toBe("B");
        expect(mirrorB.getState().records.note.title).toBe("A");
        expect(mirrorB.getState().records.note.body).toBe("B");
    });

    it("uses parent map options for fixed child containers", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeFixedTextSchema(),
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeFixedTextSchema(),
        });

        mirrorA.setState({
            root: { note: { title: "A" } },
        });
        mirrorB.setState({
            root: { note: { body: "B" } },
        });

        syncDocs(docA, docB);
        await waitForSync();

        expect(mirrorA.getState().root.note.title).toBe("A");
        expect(mirrorA.getState().root.note.body).toBe("B");
        expect(mirrorB.getState().root.note.title).toBe("A");
        expect(mirrorB.getState().root.note.body).toBe("B");
    });

    it("merges schema opted-in nested grandchildren on concurrent first creation", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeNestedContainerSchema(),
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeNestedContainerSchema(),
        });

        mirrorA.setState({
            root: { note: { body: "A", tags: [] } },
        });
        mirrorB.setState({
            root: { note: { body: "", tags: ["B"] } },
        });

        syncDocs(docA, docB);
        await waitForSync();

        expect(mirrorA.getState().root.note.body).toBe("A");
        expect(mirrorB.getState().root.note.body).toBe("A");
        expect(mirrorA.getState().root.note.tags).toEqual(["B"]);
        expect(mirrorB.getState().root.note.tags).toEqual(["B"]);
    });

    it("can edit an empty mergeable child created by an earlier setState", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: makeRecordTextSchema(),
        });

        mirror.setState({
            records: { note: {} },
        });

        expect(() => {
            mirror.setState({
                records: { note: { title: "later" } },
            });
        }).not.toThrow();
        expect(mirror.getState().records.note.title).toBe("later");
    });

    it("keeps opted-in LoroText fields as text containers", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: makeTextContainerSchema(),
        });

        mirror.setState({
            root: { body: "hello" },
        });

        const body = doc.getMap("root").get("body");
        expect(isContainer(body)).toBe(true);
        if (!isContainer(body)) {
            throw new Error("Expected LoroText to be stored as a container");
        }
        expect(body.kind()).toBe("Text");
        expect(mirror.getState().root.body).toBe("hello");
    });

    it("merges concurrent first creation for LoroText fields", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeTextContainerSchema(),
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeTextContainerSchema(),
        });

        mirrorA.setState({
            root: { body: "A" },
        });
        mirrorB.setState({
            root: { body: "B" },
        });

        syncDocs(docA, docB);
        await waitForSync();

        const bodyA = mirrorA.getState().root.body;
        const bodyB = mirrorB.getState().root.body;
        const bodyContainer = docA.getMap("root").get("body");

        expect(isContainer(bodyContainer)).toBe(true);
        if (!isContainer(bodyContainer)) {
            throw new Error("Expected LoroText to be stored as a container");
        }
        expect(bodyContainer.kind()).toBe("Text");
        expect(bodyA).toHaveLength(2);
        expect(bodyA).toContain("A");
        expect(bodyA).toContain("B");
        expect(bodyB).toBe(bodyA);
    });

    it("merges concurrent first creation for LoroMovableList fields", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeMovableListContainerSchema(),
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeMovableListContainerSchema(),
        });

        mirrorA.setState({
            root: { items: [{ id: "a", text: "A" }] },
        });
        mirrorB.setState({
            root: { items: [{ id: "b", text: "B" }] },
        });

        syncDocs(docA, docB);
        await waitForSync();

        const itemsA = mirrorA
            .getState()
            .root.items.map((item) => ({ id: item.id, text: item.text }))
            .sort((left, right) => left.id.localeCompare(right.id));
        const itemsB = mirrorB
            .getState()
            .root.items.map((item) => ({ id: item.id, text: item.text }))
            .sort((left, right) => left.id.localeCompare(right.id));
        const listContainer = docA.getMap("root").get("items");

        expect(isContainer(listContainer)).toBe(true);
        if (!isContainer(listContainer)) {
            throw new Error(
                "Expected LoroMovableList to be stored as a container",
            );
        }
        expect(listContainer.kind()).toBe("MovableList");
        expect(itemsA).toEqual([
            { id: "a", text: "A" },
            { id: "b", text: "B" },
        ]);
        expect(itemsB).toEqual(itemsA);
    });

    it("merges concurrent first creation for LoroTree fields", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeTreeContainerSchema(),
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeTreeContainerSchema(),
        });

        mirrorA.setState({
            root: {
                tree: [{ id: "", data: { title: "A" }, children: [] }],
            },
        });
        mirrorB.setState({
            root: {
                tree: [{ id: "", data: { title: "B" }, children: [] }],
            },
        });

        syncDocs(docA, docB);
        await waitForSync();

        const titlesA = mirrorA
            .getState()
            .root.tree.map((node) => node.data.title)
            .sort();
        const titlesB = mirrorB
            .getState()
            .root.tree.map((node) => node.data.title)
            .sort();
        const treeContainer = docA.getMap("root").get("tree");

        expect(isContainer(treeContainer)).toBe(true);
        if (!isContainer(treeContainer)) {
            throw new Error("Expected LoroTree to be stored as a container");
        }
        expect(treeContainer.kind()).toBe("Tree");
        expect(titlesA).toEqual(["A", "B"]);
        expect(titlesB).toEqual(["A", "B"]);
    });

    it("skips explicit undefined fields without writing nulls or diverging", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: makeOptionalFieldSchema(),
            checkStateConsistency: true,
        });

        mirror.setState({
            root: {
                note: {
                    title: "x",
                    opt: undefined,
                },
            },
        });

        const noteAfterFirstWrite = doc.getMap("root").get("note");
        expect(isContainer(noteAfterFirstWrite)).toBe(true);
        if (!isContainer(noteAfterFirstWrite)) {
            throw new Error("Expected note to be stored as a container");
        }
        expect(noteAfterFirstWrite.toJSON()).toEqual({
            title: "x",
        });
        expect(() => {
            mirror.setState({
                root: {
                    note: {
                        title: "y",
                        opt: undefined,
                    },
                },
            });
        }).not.toThrow();
        const noteAfterSecondWrite = doc.getMap("root").get("note");
        expect(isContainer(noteAfterSecondWrite)).toBe(true);
        if (!isContainer(noteAfterSecondWrite)) {
            throw new Error("Expected note to be stored as a container");
        }
        expect(noteAfterSecondWrite.toJSON()).toEqual({
            title: "y",
        });
    });

    it("lets parent map options override global mergeable defaults", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const options = { mergeableMapChildContainers: true };
        const mirrorA = new Mirror({
            doc: docA,
            schema: makeRecordTextSchema(false),
            inferOptions: options,
        });
        const mirrorB = new Mirror({
            doc: docB,
            schema: makeRecordTextSchema(false),
            inferOptions: options,
        });

        mirrorA.setState({
            records: { note: { title: "A" } },
        });
        mirrorB.setState({
            records: { note: { body: "B" } },
        });

        syncDocs(docA, docB);
        await waitForSync();

        const stateA = mirrorA.getState().records.note;
        const stateB = mirrorB.getState().records.note;
        const visibleValues = [stateA.title, stateA.body].filter(
            (value): value is string => typeof value === "string",
        );

        expect(stateA).toEqual(stateB);
        expect(visibleValues).toHaveLength(1);
        expect(["A", "B"]).toContain(visibleValues[0]);
    });

    it("does not replace existing regular containers when mergeable creation is enabled", () => {
        const doc = new LoroDoc();
        const records = doc.getMap("records");
        const note = records.setContainer("note", new LoroMap());
        const entries = note.setContainer("entries", new LoroList());
        entries.push("old");
        const noteId = note.id;
        const entriesId = entries.id;

        const mirror = new Mirror({
            doc,
            schema: makeSchema(),
            inferOptions: { mergeableMapChildContainers: true },
        });

        mirror.setState({
            records: { note: { entries: ["old", "new"] } },
        });

        const noteAfter = records.get("note");
        const entriesAfter = note.get("entries");

        expect(isContainer(noteAfter)).toBe(true);
        expect(isContainer(entriesAfter)).toBe(true);
        if (!isContainer(noteAfter) || !isContainer(entriesAfter)) {
            throw new Error("Expected regular containers to be preserved");
        }
        expect(noteAfter.id).toBe(noteId);
        expect(entriesAfter.id).toBe(entriesId);
        expect(entries.toArray()).toEqual(["old", "new"]);
    });

    it("deletes an occupied slot before ensuring a mergeable container", () => {
        const doc = new LoroDoc();
        const records = doc.getMap("records");
        records.set("note", "legacy");

        const mirror = new Mirror({
            doc,
            schema: makeRecordTextSchema(),
        });

        mirror.setState({
            records: { note: { title: "new" } },
        });

        const note = records.get("note");
        expect(isContainer(note)).toBe(true);
        if (!isContainer(note)) {
            throw new Error("Expected a mergeable container");
        }
        expect(note.id).toContain("root-");
        expect(mirror.getState().records.note.title).toBe("new");
    });
});
