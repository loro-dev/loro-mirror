/**
 * Forward-compatibility contract tests.
 *
 * A doc may contain root keys (or nested map keys) that the local schema does
 * not declare — typically written by a peer running a newer schema version.
 * Mirrors must treat such keys as fully transparent:
 *
 * - Read path: unknown keys are never materialized into Mirror state, so they
 *   cannot break `validateUpdates` ("Unknown property"), the `InferType<S>`
 *   contract, or diffing.
 * - Write path: unknown keys are never deleted or overwritten in the doc.
 *   Their values, nested containers, and CRDT history are preserved for the
 *   peers that own them.
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

function makeNewClient() {
    const doc = new LoroDoc();
    const mirror = new Mirror({ doc, schema: newSchema });
    mirror.setState((s) => {
        s.meta.name = "from-new";
        s.meta.extra = "new-only-field";
        s.forkOperation.forkedFrom = "session-1";
        s.forkOperation.detail = { note: "keep me" };
    });
    mirror.setState({ title: "hello" });
    return { doc, mirror };
}

function forkDetailId(doc: LoroDoc): string {
    const detail = doc.getMap("forkOperation").get("detail");
    if (!detail || !(detail instanceof LoroMap)) {
        throw new Error("forkOperation.detail is not a LoroMap");
    }
    return detail.id;
}

describe("forward compatibility with unknown root keys", () => {
    it("old-schema mirror ignores unknown root keys and preserves them across write-backs", () => {
        // New client writes a doc containing the new root field and exports
        // updates.
        const { doc: docNew } = makeNewClient();
        const detailId = forkDetailId(docNew);
        const updates = docNew.export({ mode: "update" });

        // Old client imports the updates and opens the doc.
        const docOld = new LoroDoc();
        docOld.import(updates);
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            checkStateConsistency: true,
        });

        // Unknown keys never enter Mirror state...
        const state = mirrorOld.getState() as Record<string, unknown>;
        expect("forkOperation" in state).toBe(false);
        expect("extra" in (state.meta as Record<string, unknown>)).toBe(false);

        // ...so validateUpdates no longer rejects every write with
        // "Unknown property".
        expect(() => {
            mirrorOld.setState((s) => {
                s.meta.name = "old-edit-1";
            });
        }).not.toThrow();
        mirrorOld.setState({ title: "edited by old" });
        // Wholesale replacement of a declared map must also be safe.
        mirrorOld.setState((s) => ({ ...s, meta: { name: "old-edit-2" } }));

        // The unknown subtree is preserved in the doc with its container
        // identity intact (still the original LoroMap, not a replacement).
        expect(docOld.getMap("forkOperation").toJSON()).toEqual({
            forkedFrom: "session-1",
            detail: { note: "keep me" },
        });
        expect(forkDetailId(docOld)).toBe(detailId);
        expect(docOld.getMap("meta").get("extra")).toBe("new-only-field");

        // Reopen with the new schema: the new field's value and container
        // identity survived the old client's writes, and the old client's
        // edits are visible too.
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
        expect(forkDetailId(docNew)).toBe(detailId);
    });

    it("keeps unknown keys out of state during ongoing sync (import after open)", () => {
        const { doc: docNew, mirror: mirrorNew } = makeNewClient();

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            checkStateConsistency: true,
        });
        mirrorNew.dispose();

        // New client keeps editing the unknown root map while the old client
        // is online; the old client imports those updates.
        docNew.getMap("forkOperation").set("forkedFrom", "session-2");
        docNew.commit();
        docOld.import(
            docNew.export({ mode: "update", from: docOld.version() }),
        );

        // The unknown key must not leak into state through the event path...
        const state = mirrorOld.getState() as Record<string, unknown>;
        expect("forkOperation" in state).toBe(false);

        // ...and writes must keep working afterwards.
        expect(() => {
            mirrorOld.setState((s) => {
                s.meta.name = "old-after-import";
            });
        }).not.toThrow();

        expect(docOld.getMap("forkOperation").get("forkedFrom")).toBe(
            "session-2",
        );
    });

    it("preserves new-field data under concurrent bidirectional edits", () => {
        const { doc: docNew, mirror: mirrorNew } = makeNewClient();
        const detailId = forkDetailId(docNew);

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({ doc: docOld, schema: oldSchema });

        // Concurrent edits without exchanging updates first.
        mirrorNew.setState((s) => {
            s.forkOperation.forkedFrom = "session-new-concurrent";
            s.forkOperation.detail.note = "edited by new";
        });
        mirrorOld.setState((s) => {
            s.meta.name = "old-concurrent";
        });

        // Exchange updates in both directions.
        const updatesFromNew = docNew.export({
            mode: "update",
            from: docOld.version(),
        });
        const updatesFromOld = docOld.export({
            mode: "update",
            from: docNew.version(),
        });
        docOld.import(updatesFromNew);
        docNew.import(updatesFromOld);

        // New client: sees both its own new-field edits and the old client's
        // declared-field edit.
        const stateNew = mirrorNew.getState();
        expect(stateNew.forkOperation.forkedFrom).toBe(
            "session-new-concurrent",
        );
        expect(stateNew.forkOperation.detail.note).toBe("edited by new");
        expect(stateNew.meta.name).toBe("old-concurrent");

        // Old client: the new field converged in the doc (untouched by the
        // old mirror's state machinery) with identity preserved.
        expect(docOld.getMap("forkOperation").toJSON()).toEqual({
            forkedFrom: "session-new-concurrent",
            detail: { note: "edited by new" },
        });
        expect(forkDetailId(docOld)).toBe(detailId);
        const stateOld = mirrorOld.getState() as Record<string, unknown>;
        expect("forkOperation" in stateOld).toBe(false);
        expect((stateOld.meta as { name: string }).name).toBe("old-concurrent");

        // One more old-client write after convergence must not clobber the
        // new field either.
        mirrorOld.setState({ title: "old final" });
        expect(docOld.getMap("forkOperation").get("forkedFrom")).toBe(
            "session-new-concurrent",
        );
        expect(forkDetailId(docOld)).toBe(detailId);
    });

    it("never deletes or overwrites unknown root keys, even with validation off and destructive updaters", () => {
        const { doc: docNew } = makeNewClient();
        const detailId = forkDetailId(docNew);

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({
            doc: docOld,
            schema: oldSchema,
            validateUpdates: false,
        });

        // Import more remote edits to the unknown subtree.
        docNew.getMap("forkOperation").set("forkedFrom", "session-2");
        docNew.commit();
        docOld.import(
            docNew.export({ mode: "update", from: docOld.version() }),
        );

        // Return-style updater that rebuilds state without the unknown key:
        // previously this crashed or deleted the unknown root key.
        mirrorOld.setState((s) => ({
            title: s.title,
            meta: { name: "rebuilt" },
        }));

        // Object-form updater that explicitly tries to write the unknown key:
        // the write must be ignored, not overwrite the existing LoroMap.
        mirrorOld.setState({
            forkOperation: { forkedFrom: "hijack" },
        } as never);

        expect(docOld.getMap("forkOperation").toJSON()).toEqual({
            forkedFrom: "session-2",
            detail: { note: "keep me" },
        });
        expect(forkDetailId(docOld)).toBe(detailId);
        expect(docOld.getMap("meta").get("name")).toBe("rebuilt");
    });

    it("ignores unknown child keys inside declared LoroMaps and preserves them on write", () => {
        // The doc carries an undeclared primitive and an undeclared nested
        // container inside the declared `meta` map.
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
            checkStateConsistency: true,
        });

        // Unknown child keys are not mirrored into state.
        const metaState = mirrorOld.getState().meta as Record<string, unknown>;
        expect(metaState).toEqual({ name: "n1" });

        // Remote edits to unknown child keys stay out of state too.
        meta.set("extraPrimitive", "new-value-2");
        docNew.commit();
        docOld.import(
            docNew.export({ mode: "update", from: docOld.version() }),
        );
        expect(mirrorOld.getState().meta).toEqual({ name: "n1" });

        // Wholesale replacement of the declared map must not delete the
        // unknown child keys.
        mirrorOld.setState((s) => ({ ...s, meta: { name: "n2" } }));
        const metaAfter = docOld.getMap("meta");
        expect(metaAfter.get("name")).toBe("n2");
        expect(metaAfter.get("extraPrimitive")).toBe("new-value-2");
        const preserved = metaAfter.get("extraContainer");
        expect(preserved instanceof LoroMap).toBe(true);
        expect((preserved as LoroMap).id).toBe(extraContainerId);
        expect((preserved as LoroMap).toJSON()).toEqual({
            note: "nested-unknown",
        });
    });

    it("ignores unknown keys in tree node data and preserves them on write", () => {
        // Covers both direct unknown node.data keys and unknown keys nested
        // inside a declared LoroMap field of node.data.
        const newTreeSchema = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    extra: schema.String(),
                    metadata: schema.LoroMap({
                        known: schema.String(),
                        extra: schema.String(),
                    }),
                }),
            ),
        });
        const oldTreeSchema = schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    title: schema.String(),
                    metadata: schema.LoroMap({ known: schema.String() }),
                }),
            ),
        });

        const docNew = new LoroDoc();
        const mirrorNew = new Mirror({ doc: docNew, schema: newTreeSchema });
        mirrorNew.setState({
            tree: [
                {
                    id: "",
                    data: {
                        title: "t",
                        extra: "new-only",
                        metadata: { known: "k", extra: "nested-x" },
                    },
                    children: [],
                },
            ],
        });
        const metadataId = (
            docNew.getTree("tree").getNodes()[0].data.get("metadata") as LoroMap
        ).id;

        const docOld = new LoroDoc();
        docOld.import(docNew.export({ mode: "snapshot" }));
        const mirrorOld = new Mirror({ doc: docOld, schema: oldTreeSchema });

        // Unknown node.data keys are not mirrored into state — neither at the
        // top level nor inside declared nested maps.
        const treeState = mirrorOld.getState().tree as Array<{
            data: Record<string, unknown>;
        }>;
        expect(treeState[0].data).toEqual({
            title: "t",
            metadata: { known: "k" },
        });

        // Renaming the node preserves the unknown data fields in the doc,
        // including the nested container and its identity.
        mirrorOld.setState((s) => {
            (s.tree as Array<{ data: { title: string } }>)[0].data.title =
                "renamed";
        });
        const node = docOld.getTree("tree").getNodes()[0];
        expect(node.data.get("title")).toBe("renamed");
        expect(node.data.get("extra")).toBe("new-only");
        const metadata = node.data.get("metadata") as LoroMap;
        expect(metadata.id).toBe(metadataId);
        expect(metadata.toJSON()).toEqual({ known: "k", extra: "nested-x" });
        mirrorNew.dispose();
    });
});
