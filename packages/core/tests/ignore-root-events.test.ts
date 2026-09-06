import { describe, expect, it, vi } from "vitest";
import { LoroDoc, LoroList, LoroMap } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";

/**
 * `schema.Ignore()` fields are memory-only: they must not be backed by the
 * LoroDoc in either direction. Initialization already skips them, but doc
 * events targeting an ignored field used to be registered, normalized, and
 * materialized into state — rebuilding e.g. an ignored root list item by item
 * with wrong indices and growing the container registry with every container.
 * These tests pin the event-side filtering: such events are dropped before
 * registration/application, and a batch containing only ignored events never
 * notifies subscribers.
 */

const rootIgnoreSchema = () =>
    schema({
        history: schema.Ignore(),
        session: schema.LoroMap({ name: schema.String() }),
    });

/** Sync `from` into `to`, returning nothing (events fire on `to`). */
function sync(from: LoroDoc, to: LoroDoc) {
    to.import(from.export({ mode: "update" }));
}

describe("schema.Ignore event filtering", () => {
    it("drops peer events under an ignored root: no state, no registry growth, no notify", () => {
        const docA = new LoroDoc();
        docA.setPeerId(1);
        const docB = new LoroDoc();
        docB.setPeerId(2);

        const mirror = new Mirror({ doc: docA, schema: rootIgnoreSchema() });
        const subscriber = vi.fn();
        mirror.subscribe(subscriber);
        const idsBefore = mirror.getContainerIds();

        // Peer creates the root `history` list and appends nested containers.
        const history = docB.getList("history");
        for (let i = 0; i < 3; i++) {
            const item = history.pushContainer(new LoroMap());
            item.set("text", `turn-${i}`);
        }
        docB.commit();
        sync(docB, docA);

        const state = mirror.getState() as Record<string, unknown>;
        expect("history" in state).toBe(false);
        expect(mirror.getContainerIds()).toEqual(idsBefore);
        expect(subscriber).not.toHaveBeenCalled();
    });

    it("applies the non-ignored part of a mixed batch and notifies once", () => {
        const docA = new LoroDoc();
        docA.setPeerId(1);
        const docB = new LoroDoc();
        docB.setPeerId(2);

        const mirror = new Mirror({ doc: docA, schema: rootIgnoreSchema() });
        const subscriber = vi.fn();
        mirror.subscribe(subscriber);

        // One commit touching both the ignored root and a real root field.
        docB.getList("history").pushContainer(new LoroMap());
        docB.getMap("session").set("name", "s1");
        docB.commit();
        sync(docB, docA);

        const state = mirror.getState() as {
            session: { name: string };
        } & Record<string, unknown>;
        expect(state.session.name).toBe("s1");
        expect("history" in state).toBe(false);
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Only the `session` map may be registered — nothing from `history`.
        const ids = mirror.getContainerIds();
        expect(ids).toHaveLength(1);
        expect(ids[0]).toBe(docA.getMap("session").id);
    });

    it("keeps setState writes to an ignored root memory-only", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: rootIgnoreSchema() });

        mirror.setState((draft) => {
            (draft as Record<string, unknown>).history = [
                { text: "memory-only" },
            ];
        });

        const state = mirror.getState() as Record<string, unknown>;
        expect(state.history).toEqual([{ text: "memory-only" }]);
        // Nothing was written to the doc for the ignored key.
        expect(doc.toJSON()).toEqual({ session: {} });
        expect("history" in doc.toJSON()).toBe(false);
        expect(mirror.getContainerIds()).toEqual([doc.getMap("session").id]);
    });

    it("drops events whose path resolves to a nested Ignore field", () => {
        const nestedSchema = () =>
            schema({
                session: schema.LoroMap({
                    name: schema.String(),
                    cache: schema.Ignore(),
                }),
            });

        const docA = new LoroDoc();
        docA.setPeerId(1);
        const docB = new LoroDoc();
        docB.setPeerId(2);

        const mirror = new Mirror({ doc: docA, schema: nestedSchema() });

        // First commit creates a container at the ignored nested path. The
        // creating event's path points at the parent map (`["session"]`), so
        // it is applied — only events *inside* the ignored field are dropped.
        docB.getMap("session").setContainer("cache", new LoroList());
        docB.commit();
        sync(docB, docA);

        const idsAfterCreate = mirror.getContainerIds();
        const stateAfterCreate = mirror.getState();

        const subscriber = vi.fn();
        mirror.subscribe(subscriber);

        // Events inside `cache` resolve to the Ignore field and must be dropped.
        const cache = docB.getMap("session").get("cache") as LoroList;
        const item = cache.pushContainer(new LoroMap());
        item.set("v", "x");
        cache.insert(1, "plain");
        docB.commit();
        sync(docB, docA);

        expect(mirror.getState()).toBe(stateAfterCreate);
        expect(mirror.getContainerIds()).toEqual(idsAfterCreate);
        expect(subscriber).not.toHaveBeenCalled();
    });
});

it("keeps nested Ignore memory values out of consistency comparisons", () => {
    const doc = new LoroDoc();
    const session = doc.getMap("session");
    session.set("name", "before");
    const cache = session.setContainer("cache", new LoroList());
    cache.push("original");
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            session: schema.LoroMap({
                name: schema.String(),
                cache: schema.Ignore(),
            }),
        }),
        checkStateConsistency: true,
    });
    const before = mirror.getState().session.cache;
    cache.push("doc-only");
    doc.commit();
    expect(() => {
        mirror.setState((draft) => {
            draft.session.name = "after";
        });
    }).not.toThrow();
    expect(mirror.getState().session.cache).toEqual(before);
    expect(session.get("name")).toBe("after");
    expect(cache.toJSON()).toEqual(["original", "doc-only"]);
    // Replacing the ignored value with memory-only data must also compare cleanly.
    mirror.setState((draft) => {
        draft.session.cache = { local: true };
    });
    expect(() => {
        mirror.checkStateConsistency();
    }).not.toThrow();
    // Normal fields must still be checked, not skipped with their ignored sibling.
    session.set("name", "different");
    expect(() => {
        mirror.checkStateConsistency();
    }).toThrow("State diverged");
    mirror.dispose();
});
