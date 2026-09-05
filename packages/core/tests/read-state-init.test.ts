import { expect, it } from "vitest";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it("prefers readState and never interprets nodes inside opaque values", () => {
    const doc = new LoroDoc();
    const root = doc.getMap("root");
    const child = root.setContainer("child", new LoroMap());
    const text = child.setContainer("body", new LoroText());
    text.insert(0, "hello");
    const opaque = {
        type: "Map",
        cid: child.id,
        value: [{ type: "Text", cid: text.id, value: "ordinary" }],
    };
    root.set("opaque", opaque);
    doc.getMap("unknown").set("opaque", opaque);
    doc.commit();
    const typed = doc as LoroDoc & { readState?: () => unknown };
    typed.readState = () => ({
        root: {
            type: "Map",
            cid: root.id,
            value: {
                opaque: { type: "Value", value: structuredClone(opaque) },
                child: {
                    type: "Map",
                    cid: child.id,
                    value: {
                        body: { type: "Text", cid: text.id, value: "hello" },
                    },
                },
            },
        },
        unknown: {
            type: "Map",
            cid: "cid:root-unknown:Map",
            value: {
                opaque: { type: "Value", value: structuredClone(opaque) },
            },
        },
    });
    doc.getDeepValueWithID = () => {
        throw new Error("legacy read should not be used");
    };
    const mirror = new Mirror({
        doc,
        schema: schema({ root: schema.LoroMapRecord(schema.Any()) }),
        ignoreUnknownProperties: true,
    });
    expect(mirror.getState()).toEqual({
        root: { opaque, child: { body: "hello" } },
        unknown: { opaque },
    });
    expect(mirror.getContainerIds().sort((a, b) => a.localeCompare(b))).toEqual(
        [root.id, child.id, text.id].sort((a, b) => a.localeCompare(b)),
    );
    expect(
        Object.getOwnPropertyDescriptor(mirror.getState().root.opaque, "$cid"),
    ).toBeUndefined();
    mirror.dispose();
});
