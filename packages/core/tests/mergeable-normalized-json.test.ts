import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror, schema, toNormalizedJson } from "../src/index.js";

const tick = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};
function syncDocs(a: LoroDoc, b: LoroDoc) {
    a.import(b.export({ mode: "update" }));
    b.import(a.export({ mode: "update" }));
}

// Deep-equality of value content, ignoring the non-enumerable $cid (which is
// present in both getState and toNormalizedJson but not in doc.toJSON()).
function stripCid(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stripCid);
    if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v)) {
            if (k === "$cid") continue;
            out[k] = stripCid(val);
        }
        return out;
    }
    return v;
}

describe("toNormalizedJson resolves mergeable child containers", () => {
    it("resolves every mergeable child container type (not raw markers)", () => {
        const s = schema({
            root: schema.LoroMap(
                {
                    childMap: schema.LoroMap({ x: schema.Number() }),
                    childList: schema.LoroList(schema.String()),
                    childText: schema.LoroText(),
                },
                { mergeableMapChildContainers: true },
            ),
        });
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: s });
        mirror.setState({
            root: {
                childMap: { x: 1 },
                childList: ["a", "b"],
                childText: "hi",
            },
        });

        const norm = toNormalizedJson(doc);
        // Must match the raw resolved JSON, not leak binary markers.
        expect(stripCid(norm)).toEqual(doc.toJSON());
        expect(stripCid(norm)).toEqual(stripCid(mirror.getState()));
        // $cid must be injected on every map (root + mergeable child map).
        expect((norm as any).root.$cid).toBe(doc.getMap("root").id);
        expect(typeof (norm as any).root.childMap.$cid).toBe("string");
    });

    it("stays correct after a remote sync", async () => {
        const s = () =>
            schema({
                records: schema.LoroMapRecord(
                    schema.LoroMap({
                        body: schema.LoroText(),
                        n: schema.Number({ required: false }),
                    }),
                    { mergeableMapChildContainers: true },
                ),
            });
        const docA = new LoroDoc();
        const docB = new LoroDoc();
        const mA = new Mirror({ doc: docA, schema: s() });
        const mB = new Mirror({ doc: docB, schema: s() });
        mA.setState({ records: { note: { body: "AAA" } } });
        mB.setState({ records: { note: { body: "BBB" } } });
        syncDocs(docA, docB);
        await tick();

        expect(stripCid(toNormalizedJson(docA))).toEqual(docA.toJSON());
        expect(stripCid(toNormalizedJson(docA))).toEqual(
            stripCid(mA.getState()),
        );
    });

    it("does not regress regular (non-mergeable) nested containers + tree", () => {
        const s = schema({
            profile: schema.LoroMap({
                name: schema.String(),
                tags: schema.LoroList(schema.String()),
            }),
            tree: schema.LoroTree(schema.LoroMap({ title: schema.String() })),
        });
        const doc = new LoroDoc();
        const mirror = new Mirror({ doc, schema: s });
        mirror.setState({
            profile: { name: "x", tags: ["a"] },
            tree: [{ data: { title: "root" }, children: [] }],
        });
        expect(stripCid(toNormalizedJson(doc))).toEqual(
            stripCid(mirror.getState()),
        );
    });
});
