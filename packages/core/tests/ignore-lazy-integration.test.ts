import { expect, it } from "vitest";
import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it.each([false, true])(
    "combines Ignore filtering and lazy updates (remote=%s)",
    async (remote) => {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const session = doc.getMap("session");
        session.set("name", "before");
        session.setContainer("cache", new LoroList()).push("initial");
        const item = doc.getList("items").pushContainer(new LoroMap());
        item.set("id", "item");
        item.setContainer("body", new LoroText()).insert(0, "before");
        doc.getList("history").push("ignored");
        doc.commit();
        const peer = new LoroDoc();
        peer.import(doc.export({ mode: "snapshot" }));
        peer.setPeerId(2);
        const writer = remote ? peer : doc;
        const mirror = new Mirror({
            doc,
            checkStateConsistency: true,
            schema: schema({
                history: schema.Ignore(),
                session: schema.LoroMap({
                    name: schema.String(),
                    cache: schema.Ignore(),
                }),
                items: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        body: schema.LoroText(),
                    }),
                    (x) => x.id,
                    { lazy: { index: ["id"], maxHydrated: 1, tailKeep: 0 } },
                ),
            }),
        });
        const list = mirror.getState().items;
        await list.hydrate(0, 1);
        const ignoredMemory = mirror.getState().session.cache;
        const registry = mirror
            .getContainerIds()
            .slice()
            .sort((a, b) => a.localeCompare(b));
        let notifications = 0;
        mirror.subscribe(() => {
            notifications++;
        });
        const flush = () => {
            writer.commit();
            if (remote)
                doc.import(
                    writer.export({ mode: "update", from: doc.version() }),
                );
        };
        writer
            .getList("history")
            .pushContainer(new LoroMap())
            .set("hidden", true);
        (writer.getMap("session").get("cache") as LoroList).push("doc-only");
        flush();
        expect(notifications).toBe(0);
        expect(
            mirror
                .getContainerIds()
                .slice()
                .sort((a, b) => a.localeCompare(b)),
        ).toEqual(registry);
        expect(mirror.getState().session.cache).toEqual(ignoredMemory);
        writer.getList("history").push("also ignored");
        const body = (writer.getList("items").get(0) as LoroMap).get(
            "body",
        ) as LoroText;
        body.insert(body.length, " after");
        writer.getMap("session").set("name", "changed");
        flush();
        expect(notifications).toBe(1);
        expect(list.get(0)).toEqual({ id: "item", body: "before after" });
        expect(mirror.getState().session.name).toBe("changed");
        expect(mirror.getState().session.cache).toEqual(ignoredMemory);
        expect(() => {
            mirror.setState((draft) => {
                draft.session.name = "local";
            });
        }).not.toThrow();
        mirror
            .list<{ id: string; body: string }>("items")
            .updateAt(0, (draft) => {
                draft.body = "written";
            });
        expect(list.get(0)).toEqual({ id: "item", body: "written" });
        expect(() => {
            mirror.checkStateConsistency();
        }).not.toThrow();
        expect(mirror.getState().items).toBe(list);
        mirror.dispose();
    },
);
