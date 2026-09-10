import { expect, it, vi } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it("initializes a valid deeply nested selected root", () => {
    const doc = new LoroDoc();
    let current = doc.getMap("data");
    for (let i = 0; i < 270; i++)
        current = current.setContainer("child", new LoroMap());
    current.set("end", true);
    doc.commit();
    expect(() => {
        const mirror = new Mirror({
            doc,
            schema: schema({ data: schema.LoroMapRecord(schema.Any()) }),
        });
        mirror.dispose();
    }).not.toThrow();
});

it("does not hide unrelated container-tree read failures", () => {
    const doc = new LoroDoc();
    const failure = new Error("unexpected read failure");
    vi.spyOn(doc, "toContainerTree").mockImplementation(() => {
        throw failure;
    });
    expect(
        () =>
            new Mirror({
                doc,
                schema: schema({ data: schema.LoroMapRecord(schema.Any()) }),
            }),
    ).toThrow(failure);
});

it("hydrates a deep lazy item through the same depth-limit fallback", async () => {
    const doc = new LoroDoc();
    let map = doc.getList("items").pushContainer(new LoroMap());
    for (let i = 0; i < 270; i++)
        map = map.setContainer("child", new LoroMap());
    map.set("end", true);
    doc.commit();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(
                schema.LoroMapRecord(schema.Any()),
                undefined,
                { lazy: { index: [] } },
            ),
        }),
    });
    const list = mirror.getState().items;
    await list.hydrate(0, 1);
    let value = list.get(0) as Record<string, unknown>;
    for (let i = 0; i < 270; i++)
        value = value.child as Record<string, unknown>;
    expect(value.end).toBe(true);
    mirror.dispose();
});
