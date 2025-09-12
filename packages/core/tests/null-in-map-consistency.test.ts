import { describe, it, expect } from "vitest";
import { LoroDoc, LoroMap, LoroList } from "loro-crdt";
import { Mirror, schema, toNormalizedJson } from "../src";

function stripCid(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripCid);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (k === "$cid") continue;
            out[k] = stripCid(v);
        }
        return out;
    }
    return value;
}

describe("setState consistency with null fields in LoroMap", () => {
    it("does not diverge when a loro-map field contains null and checkStateConsistency is enabled", async () => {
        const withSchema = schema({
            m: schema.LoroMap({
                nested: schema.LoroMap({}),
            }),
        });

        const doc = new LoroDoc();
        const m = doc.getMap("m");
        // Pre-populate a null field inside a loro map
        m.set("nested", null);
        doc.commit();
        await Promise.resolve();

        const mirror = new Mirror({
            schema: withSchema,
            doc,
            // rely on doc state; just enable consistency check
            checkStateConsistency: true,
        });

        // Sanity: mirror picks up the null from doc (ignoring $cid, which is app-only)
        expect(stripCid(mirror.getState())).toEqual(toNormalizedJson(doc));
        console.log(JSON.stringify(doc.toJSON(), null, 2));

        // Update another field (unrelated) to force a diff run
        expect(() => {
            void mirror.setState((s) => {
                // write a new primitive field alongside nested
                (s as any).m["other"] = 1;
            });
        }).not.toThrow();

        // State remains in sync with doc (ignoring $cid)
        expect(stripCid(mirror.getState())).toEqual(toNormalizedJson(doc));
        // And the original null is preserved
        expect((mirror.getState() as any).m.nested).toBeNull();
    });

    it("remains stable when the null lives deeper (list -> map) and we no-op setState", async () => {
        const withSchema = schema({
            root: schema.LoroMap({
                list: schema.LoroList(
                    schema.LoroMap({ child: schema.LoroMap({}) }),
                ),
            }),
        });

        const doc = new LoroDoc();
        const root = doc.getMap("root");
        // Attach a new list container under the root map, not the root-level list
        // to avoid introducing an unexpected top-level key for validation.
        const list = root.setContainer("list", new LoroList());
        const item = list.pushContainer(new LoroMap());
        // child is a loro-map by schema, but currently null in the doc JSON
        item.set("child", null);

        const mirror = new Mirror({
            schema: withSchema,
            doc,
            checkStateConsistency: true,
        });

        // No-op update should not throw or change representation
        expect(() => {
            void mirror.setState((s) => s);
        }).not.toThrow();
        expect(stripCid(mirror.getState())).toEqual(toNormalizedJson(doc));
        expect((mirror.getState() as any).root.list[0].child).toBeNull();
    });
});
