import { expect, it } from "vitest";
import { LoroDoc, LoroList } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it("Ignore in tree data does not break a subsequent normal write", () => {
    const doc = new LoroDoc();
    const node = doc.getTree("tree").createNode();
    node.data.set("name", "before");
    const cache = node.data.setContainer("cache", new LoroList());
    cache.push("original");
    doc.commit();
    const mirror = new Mirror({
        doc,
        checkStateConsistency: true,
        schema: schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    name: schema.String(),
                    cache: schema.Ignore(),
                }),
            ),
        }),
    });
    cache.push("doc-only");
    doc.commit();
    expect(() => {
        mirror.setState((draft) => {
            draft.tree[0].data.name = "after";
        });
    }).not.toThrow();
    expect(node.data.get("name")).toBe("after");
    mirror.dispose();
});

it("preserves nested tree Ignore values while checking ordinary descendants", () => {
    const doc = new LoroDoc();
    const root = doc.getTree("tree").createNode();
    const child = root.createNode();
    for (const node of [root, child]) {
        node.data.set("name", "before");
        node.data.setContainer("cache", new LoroList()).push("old");
    }
    doc.commit();
    const mirror = new Mirror({
        doc,
        checkStateConsistency: true,
        schema: schema({
            tree: schema.LoroTree(
                schema.LoroMap({
                    name: schema.String(),
                    cache: schema.Ignore(),
                }),
            ),
        }),
    });
    (child.data.get("cache") as LoroList).push("ignored");
    doc.commit();
    mirror.setState((draft) => {
        draft.tree[0].children[0].data.name = "after";
    });
    expect(child.data.get("name")).toBe("after");
    expect(() => {
        mirror.checkStateConsistency();
    }).not.toThrow();
    mirror.dispose();
});
