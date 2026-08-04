import { describe, it, expect } from "vitest";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";
import { CID_KEY } from "../src/constants.js";

/**
 * Regression tests for `$cid` being dropped by Immer during draft mutation.
 *
 * `$cid` is stamped as a non-enumerable descriptor, and Immer's default `shallowCopy`
 * (`{ ...base }`) copies enumerable properties only. Every object on the mutation path
 * therefore lost its `$cid`, which made `diffMovableList` treat a mutated list item as
 * "old item deleted + brand-new item inserted" instead of a key update on the existing
 * Map container. Beyond the wasted ops that destroys container identity, so a concurrent
 * remote delete of the original container no longer removes the item after a merge.
 */

const itemSchema = () => schema.LoroMap({ text: schema.String() });

const movableListSchema = () =>
    schema({
        items: schema.LoroMovableList(itemSchema(), (item) => item.$cid),
    });

/**
 * `$cid` must stay exactly as `defineCidProperty` stamps it. Immer's strict shallow copy
 * preserves the descriptor but rewrites non-writable data properties to
 * `{ writable: true, configurable: true }`, so the flags have to be re-locked afterwards.
 */
function expectLockedCid(target: object, cid: unknown) {
    expect(Object.getOwnPropertyDescriptor(target, CID_KEY)).toEqual({
        value: cid,
        writable: false,
        enumerable: false,
        configurable: false,
    });
}

/** Structural ops emitted on the outer list container since `from`. */
function listOpsSince(doc: LoroDoc, from: ReturnType<LoroDoc["oplogVersion"]>) {
    return doc
        .exportJsonUpdates(from)
        .changes.flatMap((change) => change.ops)
        .filter((op) => op.container === "cid:root-items:MovableList")
        .map((op) => op.content.type);
}

describe("$cid survives Immer draft mutation", () => {
    it("keeps $cid and does not rewrite the list item on a field update", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: movableListSchema() });

        mirror.setState((draft) => {
            draft.items.push({ text: "before" });
        });

        const originalCid = mirror.getState().items[0][CID_KEY];
        const beforeEdit = doc.oplogVersion();

        mirror.setState((draft) => {
            draft.items[0].text = "after";
        });

        expect(mirror.getState().items[0][CID_KEY]).toBe(originalCid);
        expect(listOpsSince(doc, beforeEdit)).toEqual([]);
        expect(doc.toJSON()).toEqual({ items: [{ text: "after" }] });
    });

    it("leaves sibling items untouched when one item is mutated", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: movableListSchema() });

        mirror.setState((draft) => {
            draft.items.push({ text: "a" }, { text: "b" }, { text: "c" });
        });

        const cids = mirror.getState().items.map((i) => i[CID_KEY]);
        const beforeEdit = doc.oplogVersion();

        mirror.setState((draft) => {
            draft.items[1].text = "B";
        });

        expect(mirror.getState().items.map((i) => i[CID_KEY])).toEqual(cids);
        expect(listOpsSince(doc, beforeEdit)).toEqual([]);
    });

    it("emits a move (not delete+insert) when a mutation and a reorder share a setState", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: movableListSchema() });

        mirror.setState((draft) => {
            draft.items.push({ text: "a" }, { text: "b" }, { text: "c" });
        });

        const [cidA, cidB, cidC] = mirror
            .getState()
            .items.map((i) => i[CID_KEY]);
        const beforeEdit = doc.oplogVersion();

        mirror.setState((draft) => {
            draft.items[0].text = "A";
            const [moved] = draft.items.splice(0, 1);
            draft.items.push(moved);
        });

        expect(listOpsSince(doc, beforeEdit)).toEqual(["move"]);
        expect(mirror.getState().items.map((i) => i[CID_KEY])).toEqual([
            cidB,
            cidC,
            cidA,
        ]);
        expect(doc.toJSON()).toEqual({
            items: [{ text: "b" }, { text: "c" }, { text: "A" }],
        });
    });

    it("keeps the full read-only $cid descriptor after a draft mutation", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: movableListSchema() });

        mirror.setState((draft) => {
            draft.items.push({ text: "before" });
        });
        const cid = mirror.getState().items[0][CID_KEY];
        expectLockedCid(mirror.getState().items[0], cid);

        mirror.setState((draft) => {
            draft.items[0].text = "after";
        });

        expectLockedCid(mirror.getState().items[0], cid);
        expect(JSON.stringify(mirror.getState())).toBe(
            JSON.stringify({ items: [{ text: "after" }] }),
        );
    });

    it("rejects reassigning $cid on published state after a draft mutation", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: movableListSchema() });

        mirror.setState((draft) => {
            draft.items.push({ text: "before" });
        });
        mirror.setState((draft) => {
            draft.items[0].text = "after";
        });

        const cid = mirror.getState().items[0][CID_KEY];
        expect(() => {
            (mirror.getState().items[0] as { [CID_KEY]: string })[CID_KEY] =
                "forged";
        }).toThrow(TypeError);
        expect(mirror.getState().items[0][CID_KEY]).toBe(cid);
    });

    it("keeps the full read-only $cid descriptor on nested maps", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: schema({
                items: schema.LoroMovableList(
                    schema.LoroMap({
                        text: schema.String(),
                        meta: schema.LoroMap({ v: schema.String() }),
                    }),
                    (item) => item.$cid,
                ),
            }),
        });

        mirror.setState((draft) => {
            draft.items.push({ text: "t", meta: { v: "1" } });
        });
        const itemCid = mirror.getState().items[0][CID_KEY];
        const metaCid = mirror.getState().items[0].meta[CID_KEY];

        mirror.setState((draft) => {
            draft.items[0].meta.v = "2";
        });

        // Both the mutated map and the ancestor Immer copied on the way down.
        expectLockedCid(mirror.getState().items[0], itemCid);
        expectLockedCid(mirror.getState().items[0].meta, metaCid);
    });

    it("preserves the nested LoroText container instead of recreating it", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: schema({
                items: schema.LoroMovableList(
                    schema.LoroMap({ text: schema.LoroText() }),
                    (item) => item.$cid,
                ),
            }),
        });

        mirror.setState((draft) => {
            draft.items.push({ text: "hello" });
        });

        const nestedTextCid = () =>
            (
                (doc.getMovableList("items").get(0) as LoroMap).get(
                    "text",
                ) as LoroText
            ).id;

        const mapCid = mirror.getState().items[0][CID_KEY];
        const textCid = nestedTextCid();
        const beforeEdit = doc.oplogVersion();

        mirror.setState((draft) => {
            draft.items[0].text = "hello world";
        });

        expect(mirror.getState().items[0][CID_KEY]).toBe(mapCid);
        expect(nestedTextCid()).toBe(textCid);
        expect(listOpsSince(doc, beforeEdit)).toEqual([]);
    });

    it("keeps $cid on ancestors when a remote event updates a nested map", () => {
        const nested = () =>
            schema({
                items: schema.LoroMovableList(
                    schema.LoroMap({
                        text: schema.String(),
                        meta: schema.LoroMap({ v: schema.String() }),
                    }),
                    (item) => item.$cid,
                ),
            });

        const docA = new LoroDoc();
        docA.setPeerId(1);
        const docB = new LoroDoc();
        docB.setPeerId(2);
        const mirrorA = new Mirror({ doc: docA, schema: nested() });
        const mirrorB = new Mirror({ doc: docB, schema: nested() });

        mirrorA.setState((draft) => {
            draft.items.push({ text: "t", meta: { v: "1" } });
        });
        docB.import(docA.export({ mode: "update" }));

        const cidOnB = mirrorB.getState().items[0][CID_KEY];
        expect(cidOnB).toBeDefined();

        // Remote-only edit of a nested container: the parent item is on the delta path
        // but is not itself an event target, so nothing re-stamps its `$cid`.
        (
            (docA.getMovableList("items").get(0) as LoroMap).get(
                "meta",
            ) as LoroMap
        ).set("v", "2");
        docA.commit();
        docB.import(docA.export({ mode: "update" }));

        expect(mirrorB.getState().items[0][CID_KEY]).toBe(cidOnB);
        // The remote apply path runs through Immer too, so it must re-lock as well.
        expectLockedCid(mirrorB.getState().items[0], cidOnB);
        expectLockedCid(
            mirrorB.getState().items[0].meta,
            mirrorB.getState().items[0].meta[CID_KEY],
        );

        // ...and a purely local field edit afterwards must not rewrite the outer list.
        const beforeEdit = docB.oplogVersion();
        mirrorB.setState((draft) => {
            draft.items[0].text = "local";
        });
        expect(listOpsSince(docB, beforeEdit)).toEqual([]);
    });

    it("does not resurrect an item that a peer deleted concurrently", () => {
        const docA = new LoroDoc();
        docA.setPeerId(1);
        const docB = new LoroDoc();
        docB.setPeerId(2);

        const mirrorA = new Mirror({ doc: docA, schema: movableListSchema() });
        mirrorA.setState((draft) => {
            draft.items.push({ text: "m1" }, { text: "m2" });
        });
        docB.import(docA.export({ mode: "update" }));
        const mirrorB = new Mirror({ doc: docB, schema: movableListSchema() });

        // B is a queue consumer popping the head...
        mirrorB.setState((draft) => {
            draft.items.shift();
        });
        // ...while A concurrently edits a field of that same item.
        mirrorA.setState((draft) => {
            draft.items[0].text = "m1-edited";
        });

        docA.import(docB.export({ mode: "update" }));
        docB.import(docA.export({ mode: "update" }));

        expect(docA.toJSON()).toEqual({ items: [{ text: "m2" }] });
        expect(docB.toJSON()).toEqual(docA.toJSON());
    });

    it("survives a cyclic schema.Ignore value, with and without the consistency check", () => {
        const cyclicSchema = () => {
            const ignored: Record<string, unknown> = {};
            ignored.self = ignored;
            return schema({
                settings: schema.LoroMap({ value: schema.String() }),
                // Root-level Ignore is not part of `ContainerSchemaType`; same cast the
                // existing Ignore regression tests use.
                ignored: schema.Ignore({ defaultValue: ignored }) as never,
            });
        };

        for (const checkStateConsistency of [false, true]) {
            const doc = new LoroDoc();
            const mirror = new Mirror({
                doc,
                schema: cyclicSchema(),
                checkStateConsistency,
            });

            expect(() => {
                mirror.setState((draft) => {
                    draft.settings.value = "x";
                });
            }).not.toThrow();
            expect(doc.toJSON()).toEqual({ settings: { value: "x" } });
            // The ignored payload is untouched and still cyclic.
            const ignored = mirror.getState().ignored as Record<string, unknown>;
            expect(ignored.self).toBe(ignored);
        }
    });

    it("README quickstart toggle preserves container identity", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            schema: schema({
                todos: schema.LoroMovableList(
                    schema.LoroMap({
                        text: schema.String(),
                        completed: schema.Boolean(),
                    }),
                    (todo) => todo.$cid,
                ),
            }),
        });

        mirror.setState((draft) => {
            draft.todos.push({ text: "write docs", completed: false });
        });

        const cid = mirror.getState().todos[0][CID_KEY];
        const beforeToggle = doc.oplogVersion();

        mirror.setState((draft) => {
            const i = draft.todos.findIndex((t) => t[CID_KEY] === cid);
            if (i !== -1) draft.todos[i].completed = !draft.todos[i].completed;
        });

        expect(mirror.getState().todos[0][CID_KEY]).toBe(cid);
        expect(
            doc
                .exportJsonUpdates(beforeToggle)
                .changes.flatMap((change) => change.ops)
                .filter((op) => op.container === "cid:root-todos:MovableList"),
        ).toEqual([]);
        expect(mirror.getState().todos[0].completed).toBe(true);
    });
});
