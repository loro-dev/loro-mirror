import { expect, it } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it("keeps a literal cid-shaped string in a lazy index", async () => {
    const doc = new LoroDoc();
    const raw = doc.getList("items").pushContainer(new LoroMap());
    raw.set("id", "cid:123@456:Map");
    raw.set("body", "body");
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(
                schema.LoroMap({ id: schema.String(), body: schema.String() }),
                (item) => item.id,
                { lazy: { index: ["id"] } },
            ),
        }),
    });
    const list = mirror.getState().items;
    expect(list.index(0)?.id).toBe("cid:123@456:Map");
    expect(list.indexOf("cid:123@456:Map")).toBe(0);
    await list.hydrate(0, 1);
    expect(list.get(0)?.id).toBe("cid:123@456:Map");
    mirror.dispose();
});

it("keeps a literal cid-shaped primitive lazy item", async () => {
    const doc = new LoroDoc();
    doc.getList("items").push("cid:123@456:Map");
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(schema.String(), undefined, {
                lazy: { index: [] },
            }),
        }),
    });
    const list = mirror.getState().items;
    await list.hydrate(0, 1);
    expect(list.get(0)).toBe("cid:123@456:Map");
    mirror.dispose();
});

it("distinguishes a real item from a literal of the same id across inserts and refreshes", async () => {
    const doc = new LoroDoc();
    const raw = doc.getList("items");
    const item = raw.pushContainer(new LoroMap());
    item.set("body", "real");
    raw.push(item.id);
    doc.getMap("meta").set("name", "before");
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(schema.Any(), undefined, {
                lazy: { index: [] },
            }),
            meta: schema.LoroMap({ name: schema.String() }),
        }),
    });
    const list = mirror.getState().items;
    await list.hydrate(0, 2);
    expect(list.get(0)).toMatchObject({ body: "real" });
    expect(list.get(1)).toBe(item.id);
    expect(list.indexOf(item.id)).toBe(0);
    const remote = new LoroDoc();
    remote.import(doc.export({ mode: "snapshot" }));
    remote.getList("items").insert(0, item.id);
    remote.commit();
    doc.import(remote.export({ mode: "update" }));
    expect(list.get(0)).toBe(item.id);
    expect(list.indexOf(item.id)).toBe(1);
    mirror.setState((draft) => {
        draft.meta.name = "after";
    });
    expect(list.get(0)).toBe(item.id);
    await list.hydrate(0, 3);
    expect(list.get(1)).toMatchObject({ body: "real" });
    raw.delete(1, 1);
    doc.commit();
    expect(list.indexOf(item.id)).toBe(-1);
    expect(list.slice(0, 2)).toEqual([item.id, item.id]);
    mirror.dispose();
});

it("keeps literal index fields even when they name a live sibling container", async () => {
    const doc = new LoroDoc();
    const sibling = doc.getMap("sibling");
    sibling.set("other", true);
    const raw = doc.getList("items").pushContainer(new LoroMap());
    raw.set("id", sibling.id);
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(
                schema.LoroMap({ id: schema.String() }),
                (item) => item.id,
                { lazy: { index: ["id"] } },
            ),
        }),
    });
    const list = mirror.getState().items;
    expect(list.index(0)?.id).toBe(sibling.id);
    await list.hydrate(0, 1);
    expect(list.get(0)?.id).toBe(sibling.id);
    raw.set("id", "cid:123@456:Text");
    doc.commit();
    expect(list.index(0)?.id).toBe("cid:123@456:Text");
    expect(list.indexOf("cid:123@456:Text")).toBe(0);
    mirror.dispose();
});
