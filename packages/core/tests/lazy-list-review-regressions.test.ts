import { expect, it } from "vitest";
import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it.each(["updateAt", "updateById"] as const)(
    "%s pins an uncached target and releases it even when the updater throws",
    async (method) => {
        const doc = new LoroDoc();
        const raw = doc.getList("items");
        for (let i = 0; i < 3; i++) {
            const m = raw.pushContainer(new LoroMap());
            m.set("id", String(i));
            m.set("n", i);
        }
        doc.commit();
        const mirror = new Mirror({
            doc,
            schema: schema({
                items: schema.LoroList(
                    schema.LoroMap({ id: schema.String(), n: schema.Number() }),
                    (x) => x.id,
                    { lazy: { index: ["id"], maxHydrated: 1, tailKeep: 0 } },
                ),
            }),
        });
        const list = mirror.getState().items;
        const off = list.subscribeRange(0, 1, () => {});
        await list.hydrate(0, 1);
        const writer = mirror.list<{ id: string; n: number }>("items");
        const update = (fn: (draft: { id: string; n: number }) => void) => {
            if (method === "updateAt") writer.updateAt(2, fn);
            else writer.updateById("2", fn);
        };
        update((d) => {
            d.n = 100;
        });
        expect((raw.get(2) as LoroMap).toJSON()).toEqual({ id: "2", n: 100 });
        expect(list.get(0)).toMatchObject({ id: "0", n: 0 });
        expect(list.isHydrated(2)).toBe(false);
        expect(() => {
            update(() => {
                throw new Error("abort");
            });
        }).toThrow("abort");
        expect(list.isHydrated(2)).toBe(false);
        expect((raw.get(2) as LoroMap).toJSON()).toEqual({ id: "2", n: 100 });
        off();
        mirror.dispose();
    },
);

it.each([false, true])(
    "applies a new nested subtree once (remote=%s)",
    async (remote) => {
        const doc = new LoroDoc();
        const m = doc.getList("items").pushContainer(new LoroMap());
        m.set("id", "a");
        doc.commit();
        const mirror = new Mirror({
            doc,
            schema: schema({
                items: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        title: schema.LoroText({ required: false }),
                        details: schema.Any(),
                    }),
                    (x) => x.id,
                    { lazy: { index: ["id"] } },
                ),
            }),
        });
        const list = mirror.getState().items;
        await list.hydrate(0, 1);
        const peer = remote ? new LoroDoc() : doc;
        if (remote) peer.import(doc.export({ mode: "snapshot" }));
        const target = peer.getList("items").get(0) as LoroMap;
        target.setContainer("title", new LoroText()).insert(0, "hello");
        const details = target.setContainer("details", new LoroMap());
        details.setContainer("text", new LoroText()).insert(0, "nested");
        details.setContainer("values", new LoroList()).push("once");
        peer.commit();
        if (remote) doc.import(peer.export({ mode: "update" }));
        expect(list.get(0)).toEqual({
            id: "a",
            title: "hello",
            details: { text: "nested", values: ["once"] },
        });
        expect(list.get(0)).toEqual(m.toJSON());
        mirror.dispose();
    },
);
