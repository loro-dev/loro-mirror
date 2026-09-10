import { expect, it } from "vitest";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it("prefers toContainerTree and never interprets nodes inside opaque values", () => {
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
    const typed = doc as unknown as { toContainerTree?: () => unknown };
    typed.toContainerTree = () => ({
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

it.each([false, true])(
    "selects schema roots without reading Ignore roots (unknown=%s)",
    (keepUnknown) => {
        const doc = new LoroDoc();
        doc.getMap("root").set("value", "kept");
        doc.getMap("history").set("large", "ignored");
        doc.getMap("unknown").set("value", "peer");
        doc.commit();
        const typed = doc as unknown as {
            toContainerTree?: (options?: {
                roots?: readonly string[];
            }) => unknown;
        };
        typed.toContainerTree = (options) => {
            if (!options?.roots || options.roots.includes("history")) {
                throw new Error("ignored root must not be materialized");
            }
            return Object.fromEntries(
                options.roots.map((name) => [
                    name,
                    {
                        type: "Map",
                        cid: `cid:root-${name}:Map`,
                        value: {
                            value: {
                                type: "Value",
                                value: name === "root" ? "kept" : "peer",
                            },
                        },
                    },
                ]),
            );
        };
        const mirror = new Mirror({
            doc,
            schema: schema({
                root: schema.LoroMapRecord(schema.Any()),
                history: schema.Ignore(),
            }),
            ignoreUnknownProperties: keepUnknown,
        });
        expect(mirror.getState()).toEqual(
            keepUnknown
                ? { root: { value: "kept" }, unknown: { value: "peer" } }
                : { root: { value: "kept" } },
        );
        expect(doc.getMap("history").toJSON()).toEqual({ large: "ignored" });
        mirror.dispose();
    },
);

it("initializes from the published loro-crdt container tree API", () => {
    const doc = new LoroDoc();
    const root = doc.getMap("root");
    const text = root.setContainer("text", new LoroText());
    text.insert(0, "published API");
    const opaque = { type: "Map", cid: text.id, value: ["ordinary"] };
    root.set("opaque", opaque);
    doc.commit();
    expect(typeof doc.toContainerTree).toBe("function");
    doc.getDeepValueWithID = () => {
        throw new Error("must use the published container tree API");
    };
    const mirror = new Mirror({
        doc,
        schema: schema({ root: schema.LoroMapRecord(schema.Any()) }),
        checkStateConsistency: true,
    });
    expect(mirror.getState()).toEqual({
        root: { text: "published API", opaque },
    });
    expect(mirror.getContainerIds().sort((a, b) => a.localeCompare(b))).toEqual(
        [root.id, text.id].sort((a, b) => a.localeCompare(b)),
    );
    expect(() => {
        mirror.checkStateConsistency();
    }).not.toThrow();
    mirror.dispose();
});
