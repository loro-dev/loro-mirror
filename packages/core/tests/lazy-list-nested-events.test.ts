import { expect, it } from "vitest";
import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";

const definition = schema({
    docs: schema.LoroList(
        schema.LoroMap({
            id: schema.String(),
            lines: schema.LoroList(
                schema.LoroMap({
                    id: schema.String(),
                    txt: schema.String(),
                    note: schema.LoroText(),
                }),
                (x) => x.id,
                { lazy: { index: ["id", "txt"] } },
            ),
        }),
        (x) => x.id,
        { lazy: { index: ["id"] } },
    ),
});

it("keeps hydrated nested lazy items current across remote and successive local edits", async () => {
    const doc = new LoroDoc();
    const entry = doc.getList("docs").insertContainer(0, new LoroMap());
    entry.set("id", "doc");
    const line = entry
        .setContainer("lines", new LoroList())
        .insertContainer(0, new LoroMap());
    line.set("id", "line");
    line.set("txt", "initial");
    line.setContainer("note", new LoroText()).insert(0, "note");
    doc.commit();
    const mirror = new Mirror({ doc, schema: definition });
    const docs = mirror.getState().docs;
    await docs.hydrate(0, 1);
    const lines = docs.get(0)!.lines;
    await lines.hydrate(0, 1);
    const remote = new LoroDoc();
    remote.import(doc.export({ mode: "snapshot" }));
    const remoteLine = remote.getContainerById(line.id) as LoroMap;
    remoteLine.set("txt", "remote");
    (remoteLine.get("note") as LoroText).insert(4, " updated");
    remote.commit();
    doc.import(remote.export({ mode: "update" }));
    expect(lines.get(0)).toMatchObject({ txt: "remote", note: "note updated" });
    expect(lines.index(0)).toMatchObject({ txt: "remote" });
    const writer = mirror.list<{ id: string; txt: string; note: string }>(
        "docs[0].lines",
    );
    writer.updateAt(0, (draft) => {
        draft.txt += " local";
    });
    writer.updateAt(0, (draft) => {
        draft.txt += " again";
    });
    expect(lines.get(0)?.txt).toBe("remote local again");
    expect(line.get("txt")).toBe("remote local again");
    mirror.dispose();
});

it("observes length separately without widening half-open range subscriptions", () => {
    const doc = new LoroDoc();
    const mirror = new Mirror({
        doc,
        schema: schema({
            items: schema.LoroList(schema.String(), undefined, {
                lazy: { index: [] },
            }),
        }),
    });
    const list = mirror.getState().items;
    const lengths: number[] = [];
    const snapshots: unknown[] = [];
    const unsubscribeLength = list.subscribeLength(() =>
        lengths.push(list.length),
    );
    const unsubscribeRange = list.subscribeRange(0, 0, () =>
        snapshots.push(list.slice(0, 0)),
    );
    const source = doc.getList("items");
    source.insert(0, "first");
    doc.commit();
    source.insert(1, "second");
    doc.commit();
    source.delete(0, 1);
    doc.commit();
    expect(lengths).toEqual([1, 2, 1]);
    expect(snapshots).toEqual([]);
    unsubscribeLength();
    unsubscribeRange();
    source.insert(1, "third");
    doc.commit();
    expect(lengths).toEqual([1, 2, 1]);
    mirror.dispose();
});
