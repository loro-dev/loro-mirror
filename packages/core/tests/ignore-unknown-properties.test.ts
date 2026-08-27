/**
 * Tests for the opt-in `ignoreUnknownProperties` mirror option.
 *
 * A shared doc can contain properties the local schema does not declare —
 * typically written by a peer running a newer schema version. With the
 * option enabled:
 *
 * - Undeclared properties are mirrored into state from every read path
 *   (initial snapshot and incremental events behave the same).
 * - `validateUpdates` no longer rejects state with `Unknown property`.
 * - State stays the source of truth on writes: unknown keys are written
 *   back while present, and deleted from the doc when removed from state.
 *
 * With the option disabled (default), behavior is exactly the pre-existing
 * one.
 */
import { describe, it, expect } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

// "New" schema version: adds a `forkOperation` root LoroMap and a nested
// `extra` field inside `meta`.
const newSchema = schema({
    title: schema.LoroText(),
    meta: schema.LoroMap({
        name: schema.String(),
        extra: schema.String(),
    }),
    forkOperation: schema.LoroMap({
        forkedFrom: schema.String(),
        detail: schema.LoroMap({ note: schema.String() }),
    }),
});

// "Old" schema version: no `forkOperation`, no `meta.extra`.
const oldSchema = schema({
    title: schema.LoroText(),
    meta: schema.LoroMap({
        name: schema.String(),
    }),
});

function makeNewClientDoc() {
    const doc = new LoroDoc();
    const mirror = new Mirror({ doc, schema: newSchema });
    mirror.setState((s) => {
        s.meta.name = "from-new";
        s.meta.extra = "new-only-field";
        s.forkOperation.forkedFrom = "session-1";
        s.forkOperation.detail = { note: "keep me" };
    });
    mirror.setState({ title: "hello" });
    mirror.dispose();
    return doc;
}

function forkDetailId(doc: LoroDoc): string {
    const detail = doc.getMap("forkOperation").get("detail");
    if (!detail || !(detail instanceof LoroMap)) {
        throw new Error("forkOperation.detail is not a LoroMap");
    }
    return detail.id;
}

describe("ignoreUnknownProperties", () => {
    it("mirrors undeclared root keys into state when opening from a snapshot, and preserves them across write-backs", () => {
        const docNew = makeNewClientDoc();
        const detailId = forkDetailId(docNew);
        const updates = docNew.export({ mode: "update" });

        // Old client imports the updates and opens the doc from the snapshot.
        const docOld = new LoroDoc();
        docOld.import(updates);
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            ignoreUnknownProperties: true,
            checkStateConsistency: true,
        });

        // Unknown keys are present in state from the start — same as the
        // event path would produce.
        const state = mirrorOld.getState() as Record<string, unknown>;
        expect(state.forkOperation).toEqual({
            forkedFrom: "session-1",
            detail: { note: "keep me" },
        });
        expect((state.meta as Record<string, unknown>).extra).toBe(
            "new-only-field",
        );

        // validateUpdates no longer throws "Unknown property".
        expect(() => {
            mirrorOld.setState((s) => {
                s.meta.name = "old-edit-1";
            });
        }).not.toThrow();

        // Spread-style return updater keeps the unknown keys; several
        // unrelated writes leave them untouched in both state and doc.
        mirrorOld.setState((s) => ({ ...s, title: "edited by old" }));
        mirrorOld.setState((s) => ({
            ...s,
            meta: { ...(s.meta as object), name: "old-edit-2" },
        }));

        const stateAfter = mirrorOld.getState() as Record<string, unknown>;
        expect(stateAfter.forkOperation).toEqual({
            forkedFrom: "session-1",
            detail: { note: "keep me" },
        });
        expect(docOld.getMap("forkOperation").toJSON()).toEqual({
            forkedFrom: "session-1",
            detail: { note: "keep me" },
        });
        expect(forkDetailId(docOld)).toBe(detailId);

        // Reopening with the new schema shows both the preserved new field
        // and the old client's edits.
        docNew.import(
            docOld.export({ mode: "update", from: docNew.version() }),
        );
        const mirrorNew2 = new Mirror({ doc: docNew, schema: newSchema });
        const reopened = mirrorNew2.getState();
        expect(reopened.forkOperation.forkedFrom).toBe("session-1");
        expect(reopened.forkOperation.detail.note).toBe("keep me");
        expect(reopened.meta.extra).toBe("new-only-field");
        expect(reopened.meta.name).toBe("old-edit-2");
        expect(reopened.title).toBe("edited by old");
        mirrorNew2.dispose();
    });

    it("keeps state consistent when unknown keys arrive via import after open", () => {
        // Old client opens an empty doc first, then receives the new field
        // through the incremental event path.
        const docOld = new LoroDoc();
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            ignoreUnknownProperties: true,
            checkStateConsistency: true,
        });

        const docNew = makeNewClientDoc();
        docOld.import(docNew.export({ mode: "update" }));

        const state = mirrorOld.getState() as Record<string, unknown>;
        expect(state.forkOperation).toEqual({
            forkedFrom: "session-1",
            detail: { note: "keep me" },
        });

        // Writes keep working and do not disturb the unknown subtree.
        expect(() => {
            mirrorOld.setState((s) => {
                s.meta.name = "old-after-import";
            });
        }).not.toThrow();
        mirrorOld.setState((s) => ({ ...s, title: "old title" }));

        expect(docOld.getMap("forkOperation").toJSON()).toEqual({
            forkedFrom: "session-1",
            detail: { note: "keep me" },
        });
        expect(forkDetailId(docOld)).toBe(forkDetailId(docNew));
    });

    it("deletes unknown keys from the doc when an update removes them from state", () => {
        const docNew = new LoroDoc();
        const meta = docNew.getMap("meta");
        meta.set("name", "n1");
        meta.set("extraPrimitive", "new-value");
        const extraContainer = meta.setContainer(
            "extraContainer",
            new LoroMap(),
        );
        extraContainer.set("note", "nested-unknown");
        docNew.commit();

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            ignoreUnknownProperties: true,
        });

        // Sanity: both unknown child keys are in state.
        const metaState = mirrorOld.getState().meta as Record<string, unknown>;
        expect(metaState.extraPrimitive).toBe("new-value");
        expect(metaState.extraContainer).toEqual({ note: "nested-unknown" });

        // Removing them from state deletes them from the doc — the default
        // delete semantics are unchanged.
        mirrorOld.setState((s) => ({
            title: s.title,
            meta: { name: "n2" },
        }));

        const metaAfter = docOld.getMap("meta");
        expect(metaAfter.get("name")).toBe("n2");
        expect(metaAfter.get("extraPrimitive")).toBeUndefined();
        expect(metaAfter.get("extraContainer")).toBeUndefined();
    });

    it("tolerates unknown child keys inside declared LoroMaps end to end", () => {
        const docNew = new LoroDoc();
        const meta = docNew.getMap("meta");
        meta.set("name", "n1");
        meta.set("extraPrimitive", "new-value");
        const extraContainer = meta.setContainer(
            "extraContainer",
            new LoroMap(),
        );
        extraContainer.set("note", "nested-unknown");
        docNew.commit();
        const extraContainerId = extraContainer.id;

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            ignoreUnknownProperties: true,
            checkStateConsistency: true,
        });

        // Unrelated writes (including wholesale replacement of the declared
        // map with all known keys spread over) do not throw and preserve the
        // unknown child keys, because state — the source of truth — still
        // carries them.
        expect(() => {
            mirrorOld.setState((s) => ({
                ...s,
                meta: {
                    ...(s.meta as Record<string, unknown>),
                    name: "n2",
                },
            }));
        }).not.toThrow();

        const metaAfter = docOld.getMap("meta");
        expect(metaAfter.get("name")).toBe("n2");
        expect(metaAfter.get("extraPrimitive")).toBe("new-value");
        const preserved = metaAfter.get("extraContainer");
        expect(preserved instanceof LoroMap).toBe(true);
        expect((preserved as LoroMap).id).toBe(extraContainerId);
        expect((preserved as LoroMap).toJSON()).toEqual({
            note: "nested-unknown",
        });
    });

    it("keeps the default behavior unchanged when the option is not set", () => {
        const docNew = makeNewClientDoc();

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({ doc: docOld, schema: oldSchema });

        // Default: unknown root keys are not mirrored into state at open...
        const state = mirrorOld.getState() as Record<string, unknown>;
        expect("forkOperation" in state).toBe(false);

        // ...but the incremental event path still applies them, after which
        // validateUpdates rejects writes with "Unknown property".
        docNew.getMap("forkOperation").set("forkedFrom", "session-2");
        docNew.commit();
        docOld.import(
            docNew.export({ mode: "update", from: docOld.version() }),
        );
        expect("forkOperation" in (mirrorOld.getState() as object)).toBe(true);
        expect(() => {
            mirrorOld.setState((s) => {
                s.meta.name = "blocked";
            });
        }).toThrow("Unknown property: forkOperation");
    });
});
