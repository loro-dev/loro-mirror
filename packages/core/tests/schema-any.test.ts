import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";
import { valueIsContainer, valueIsContainerOfType } from "../src/core/utils.js";

const waitForSync = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe("schema.Any", () => {
    it("infers string as LoroText when preferred", async () => {
        const doc = new LoroDoc();
        const s = schema({
            map: schema.LoroMap({}).catchall(
                schema.Any({ defaultLoroText: true }),
            ),
        });
        const mirror = new Mirror({ doc, schema: s });

        mirror.setState({
            map: { a: "Hello" },
        });
        await waitForSync();

        const serialized = doc.getDeepValueWithID() as unknown as Record<
            string,
            unknown
        >;
        const map = serialized["map"];
        expect(valueIsContainerOfType(map, ":Map")).toBeTruthy();

        const inner = (map as { value: Record<string, unknown> }).value;
        const a = inner["a"];
        expect(valueIsContainerOfType(a, ":Text")).toBeTruthy();
        expect((a as { value: string }).value).toBe("Hello");

        const state = mirror.getState() as unknown as Record<string, unknown>;
        const stateMap = state["map"] as Record<string, unknown>;
        const stateA = stateMap["a"];
        expect(stateA).toBe("Hello");
    });

    it("defaults defaultLoroText to false (overrides global defaultLoroText)", async () => {
        const doc = new LoroDoc();
        const s = schema({
            map: schema.LoroMap({}).catchall(schema.Any()),
        });
        const mirror = new Mirror({
            doc,
            schema: s,
            inferOptions: { defaultLoroText: true },
        });

        mirror.setState({
            map: { a: "Hello" },
        });
        await waitForSync();

        const serialized = doc.getDeepValueWithID() as unknown as Record<
            string,
            unknown
        >;
        const map = serialized["map"] as { value: Record<string, unknown> };
        const a = map.value["a"];
        expect(valueIsContainer(a)).toBeFalsy();
        expect(a).toBe("Hello");
    });

    it("infers list items as LoroText when preferred", async () => {
        const doc = new LoroDoc();
        const s = schema({
            list: schema.LoroList(schema.Any({ defaultLoroText: true })),
        });
        const mirror = new Mirror({ doc, schema: s });

        mirror.setState({
            list: ["Hello"],
        });
        await waitForSync();

        const serialized = doc.getDeepValueWithID() as unknown as Record<
            string,
            unknown
        >;
        const list = serialized["list"] as { value: unknown[] };
        expect(valueIsContainerOfType(list, ":List")).toBeTruthy();
        expect(valueIsContainerOfType(list.value[0], ":Text")).toBeTruthy();
    });

    it("propagates Any preference to inferred subtree", async () => {
        const doc = new LoroDoc();
        const s = schema({
            map: schema.LoroMap({}).catchall(
                schema.Any({ defaultLoroText: true }),
            ),
        });
        const mirror = new Mirror({ doc, schema: s });

        mirror.setState({
            map: { a: { b: "Hello" } },
        });
        await waitForSync();

        let serialized = doc.getDeepValueWithID() as unknown as Record<
            string,
            unknown
        >;
        const rootMap = serialized["map"] as { value: Record<string, unknown> };
        const a = rootMap.value["a"];
        expect(valueIsContainerOfType(a, ":Map")).toBeTruthy();

        const aValue = (a as { value: Record<string, unknown> }).value;
        const b = aValue["b"];
        expect(valueIsContainerOfType(b, ":Text")).toBeTruthy();

        mirror.setState({
            map: { a: { b: "Hello2" } },
        });
        await waitForSync();

        serialized = doc.getDeepValueWithID() as unknown as Record<string, unknown>;
        const rootMap2 = serialized["map"] as { value: Record<string, unknown> };
        const a2 = rootMap2.value["a"] as { value: Record<string, unknown> };
        const b2 = a2.value["b"];
        expect(valueIsContainerOfType(b2, ":Text")).toBeTruthy();
        expect((b2 as { value: string }).value).toBe("Hello2");
    });
});
