import { describe, it, expect } from "vitest";
import { LoroDoc, LoroList, LoroMap, LoroText, isContainer } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";
import { isLazyList } from "../src/core/lazy-list.js";
import type { LazyList } from "../src/schema/index.js";

type Prng = () => number;

const makePrng = (seed: number): Prng => {
    let s = seed >>> 0;
    return () => {
        s = (1664525 * s + 1013904223) >>> 0;
        return s / 0x100000000;
    };
};

const int = (rand: Prng, maxExclusive: number): number =>
    Math.floor(rand() * maxExclusive);

type Item = { id: string; title: string; done: boolean };

const itemSchema = () =>
    schema.LoroMap({
        id: schema.String(),
        title: schema.LoroText(),
        done: schema.Boolean(),
    });

const lazySchema = () =>
    schema({
        history: schema.LoroList(itemSchema(), (it) => it.id, {
            lazy: { index: ["id", "done"], maxHydrated: 12, tailKeep: 2 },
        }),
    });

function insertRawItem(list: LoroList, index: number, id: string) {
    const m = list.insertContainer(index, new LoroMap());
    m.set("id", id);
    m.setContainer("title", new LoroText()).insert(0, `title of ${id}`);
    m.set("done", false);
}

/**
 * Peer fuzz: mirror A (lazy schema) against raw edits on peer B and write-API
 * edits on A, synced both ways. After each batch, hydrated items must equal
 * the doc ground truth and ids/length must match the list itself.
 */
describe("lazy list peer fuzz", () => {
    for (const seed of [1, 7, 42]) {
        it(`converges under random ops (seed ${seed})`, async () => {
            const rand = makePrng(seed);
            const docA = new LoroDoc();
            docA.setPeerId(1n);
            const docB = new LoroDoc();
            docB.setPeerId(2n);

            const listA = docA.getList("history");
            let nextId = 0;
            for (let i = 0; i < 5; i++) {
                insertRawItem(listA, i, `item-${nextId++}`);
            }
            docA.commit();
            docB.import(docA.export({ mode: "update" }));

            const mirrorA = new Mirror({ doc: docA, schema: lazySchema() });
            const ll = mirrorA.getState().history;
            expect(isLazyList(ll)).toBe(true);
            const lazy = ll as unknown as LazyList<Item>;
            const writer = mirrorA.list<Item>("history");

            const subs: (() => void)[] = [];

            const assertConsistent = (label: string) => {
                // Ground truth from the doc itself
                const shallow = listA.getShallowValue();
                expect(lazy.length, `${label}: length`).toBe(listA.length);
                expect([...lazy.ids()], `${label}: ids`).toEqual(shallow);
                for (let i = 0; i < lazy.length; i++) {
                    // index cache always reflects the item map's index fields
                    const cid = lazy.ids()[i];
                    if (typeof cid !== "string") continue;
                    const container = docA.getContainerById(cid);
                    expect(
                        container,
                        `${label}: container ${cid}`,
                    ).toBeTruthy();
                    const json = container!.toJSON() as Record<string, unknown>;
                    expect(lazy.index(i), `${label}: index ${i}`).toEqual({
                        id: json.id,
                        done: json.done,
                    });
                    if (lazy.isHydrated(i)) {
                        expect(
                            JSON.parse(JSON.stringify(lazy.get(i))),
                            `${label}: hydrated ${i}`,
                        ).toEqual(JSON.parse(JSON.stringify(json)));
                    }
                }
            };

            for (let batch = 0; batch < 25; batch++) {
                const ops = 1 + int(rand, 5);
                for (let op = 0; op < ops; op++) {
                    const onB = rand() < 0.5;
                    const list = onB ? docB.getList("history") : listA;
                    const len = list.length;
                    const choice = int(rand, 6);
                    try {
                        if (choice === 0 || len === 0) {
                            // insert
                            const id = `item-${nextId++}`;
                            const index = int(rand, len + 1);
                            if (onB) {
                                insertRawItem(list, index, id);
                            } else {
                                writer.insert(index, {
                                    id,
                                    title: `title of ${id}`,
                                    done: false,
                                });
                            }
                        } else if (choice === 1) {
                            // delete
                            const index = int(rand, len);
                            if (onB) {
                                list.delete(index, 1);
                            } else {
                                const id = lazy.index(index)?.id;
                                if (id) writer.deleteById(id);
                            }
                        } else if (choice === 2) {
                            // toggle done (index field)
                            const index = int(rand, len);
                            if (onB) {
                                const m = list.get(index);
                                if (isContainer(m) && m.kind() === "Map") {
                                    const map = m as LoroMap;
                                    map.set(
                                        "done",
                                        !(map.get("done") as boolean),
                                    );
                                }
                            } else {
                                const id = lazy.index(index)?.id;
                                if (id) {
                                    writer.updateById(id, (d) => {
                                        d.done = !d.done;
                                    });
                                }
                            }
                        } else if (choice === 3) {
                            // text edit on title (non-index field)
                            const index = int(rand, len);
                            if (onB) {
                                const m = list.get(index);
                                if (isContainer(m) && m.kind() === "Map") {
                                    const t = (m as LoroMap).get("title");
                                    if (isContainer(t) && t.kind() === "Text") {
                                        const text = t as LoroText;
                                        text.insert(
                                            int(rand, text.length + 1),
                                            "x",
                                        );
                                    }
                                }
                            } else {
                                const id = lazy.index(index)?.id;
                                if (id) {
                                    writer.updateById(id, (d) => {
                                        d.title += "y";
                                    });
                                }
                            }
                        } else if (choice === 4) {
                            // random hydrate / release on A
                            if (lazy.length === 0) continue;
                            const from = int(rand, lazy.length);
                            const to = Math.min(
                                lazy.length,
                                from + 1 + int(rand, 8),
                            );
                            if (rand() < 0.7) {
                                await lazy.hydrate(from, to);
                            } else {
                                lazy.release(from, to);
                            }
                        } else {
                            // random subscribeRange churn
                            if (lazy.length === 0) continue;
                            if (subs.length > 0 && rand() < 0.4) {
                                subs.pop()!();
                            } else {
                                const from = int(rand, lazy.length);
                                const to = Math.min(
                                    lazy.length,
                                    from + 1 + int(rand, 5),
                                );
                                subs.push(
                                    lazy.subscribeRange(from, to, () => {}),
                                );
                            }
                        }
                    } catch (e) {
                        // Writes may legitimately race a not-yet-synced remote
                        // delete; skip those.
                        if (!/no item with id/.test(String(e))) throw e;
                    }
                }
                docB.commit();
                docA.import(docB.export({ mode: "update" }));
                docB.import(docA.export({ mode: "update" }));
                assertConsistent(`seed=${seed} batch=${batch}`);
            }

            for (const unsub of subs) unsub();
            mirrorA.dispose();
        }, 30_000);
    }
});
