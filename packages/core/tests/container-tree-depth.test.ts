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
