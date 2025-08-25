import { describe, it, expect } from "vitest";
import { LoroDoc, LoroText, LoroList, LoroMap, LoroCounter } from "loro-crdt";
import { applyEventBatchToState } from "./loroEventApply";

const commitAndAssert = async (
    doc: LoroDoc,
    getState: () => unknown,
) => {
    doc.commit();
    // allow microtask queue to flush if needed
    await Promise.resolve();
    expect(getState()).toEqual(doc.toJSON());
};

describe("applyEventBatchToState (inline)", () => {
    it("syncs map primitives", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        m.set("a", 1);
        await commitAndAssert(doc, () => state);

        m.set("b", 2);
        await commitAndAssert(doc, () => state);

        m.delete("a");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("syncs list operations", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const l = doc.getList("l");
        l.insert(0, "x");
        await commitAndAssert(doc, () => state);

        l.insert(1, "y");
        await commitAndAssert(doc, () => state);

        l.delete(0, 1);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("syncs text updates", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const t = doc.getText("t");
        t.update("Hello");
        await commitAndAssert(doc, () => state);

        t.update("Hello World");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("syncs nested container in map (text)", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        const inner = new LoroText();
        inner.update("Hi");
        m.setContainer("inner", inner);
        await commitAndAssert(doc, () => state);

        inner.update("Hello");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("preserves null values and supports deletes", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        // Setting null should persist as a normal value
        m.set("a", null);
        await commitAndAssert(doc, () => state);

        // Setting a value then deleting it removes the key
        m.set("a", 42);
        await commitAndAssert(doc, () => state);
        m.delete("a");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("syncs nested container in list (text)", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const list = doc.getList("list");
        const text = list.insertContainer(0, new LoroText());
        text.update("Item 0");
        await commitAndAssert(doc, () => state);

        list.insert(1, "plain");
        await commitAndAssert(doc, () => state);

        text.update("Item 0 updated");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("syncs movable list moves", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const ml = doc.getMovableList("ml");
        ml.push("a");
        ml.push("b");
        ml.push("c");
        await commitAndAssert(doc, () => state);

        ml.move(0, 2); // [b, c, a]
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("handles deep nested paths (map -> list -> map)", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const rootMap = doc.getMap("root");
        const list = rootMap.setContainer("list", new LoroList());
        const innerMap = list.insertContainer(0, new LoroMap());
        innerMap.set("k", 1);
        await commitAndAssert(doc, () => state);

        innerMap.set("k", 2);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("batches multiple container diffs in one commit", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        const t = doc.getText("t");
        const l = doc.getList("l");

        // Multiple operations before a single commit should arrive as one batch
        m.set("a", 1);
        t.update("hello");
        l.push("x");
        doc.commit();
        await Promise.resolve();
        expect(state).toEqual(doc.toJSON());

        unsub();
    });

    it("syncs counter increments", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const c = doc.getCounter("count");
        c.increment(5);
        await commitAndAssert(doc, () => state);

        c.decrement(2);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("map.clear and list.clear propagate", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        m.set("a", 1);
        m.set("b", 2);
        const l = doc.getList("l");
        l.push(1);
        l.push(2);
        await commitAndAssert(doc, () => state);

        m.clear();
        l.clear();
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("movable list set/replace and delete in same commit", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const ml = doc.getMovableList("ml");
        ml.push("x");
        ml.push("y");
        ml.push("z");
        await commitAndAssert(doc, () => state);

        // Replace middle with a container and delete last in one commit
        const t = new LoroText();
        t.update("middle");
        ml.setContainer(1, t);
        ml.delete(2, 1);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("nested counter inside map and list", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const root = doc.getMap("root");
        const cnt = root.setContainer("cnt", new LoroCounter());
        const lst = root.setContainer("lst", new LoroList());
        const cnt2 = lst.insertContainer(0, new LoroCounter());
        cnt.increment(3);
        cnt2.increment(7);
        await commitAndAssert(doc, () => state);

        cnt.decrement(1);
        cnt2.decrement(2);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("list: multiple container inserts then edits in one batch", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const l = doc.getList("l");
        const t0 = l.insertContainer(0, new LoroText());
        const t1 = l.insertContainer(1, new LoroText());
        t0.update("A");
        t1.update("B");
        await commitAndAssert(doc, () => state);

        t0.update("AA");
        t1.update("BB");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("text complex edits: splice, delete, applyDelta, mark/unmark", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const t = doc.getText("t");
        t.insert(0, "Hello");
        t.splice(5, 0, " World");
        await commitAndAssert(doc, () => state);

        t.delete(0, 1); // remove 'H'
        await commitAndAssert(doc, () => state);

        t.applyDelta([{ retain: 0 }, { insert: "Start: " }]);
        await commitAndAssert(doc, () => state);

        // Mark/unmark shouldn't change string content
        doc.configTextStyle({ bold: { expand: "after" } });
        t.mark({ start: 0, end: 3 }, "bold", true);
        t.unmark({ start: 0, end: 3 }, "bold");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("import updates apply via event (by: import)", async () => {
        const a = new LoroDoc();
        const b = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = b.subscribe((batch) => {
            state = applyEventBatchToState(state, batch);
        });

        // author edits on a
        const m = a.getMap("m");
        const l = a.getList("l");
        const t = a.getText("t");
        m.set("x", 1);
        l.push("a");
        l.push("b");
        t.update("hello");
        a.commit();

        const updates = a.export({ mode: "update" });
        b.import(updates);
        await Promise.resolve();
        expect(state).toEqual(b.toJSON());

        unsub();
    });

    it("setting a map key to same value is a no-op (no divergence)", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        m.set("k", 1);
        await commitAndAssert(doc, () => state);

        // Setting the same value should not emit changes; state should remain in sync
        m.set("k", 1);
        doc.commit();
        await Promise.resolve();
        expect(state).toEqual(doc.toJSON());

        unsub();
    });

    it("map: container replaced with primitive in same commit", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        const txt = new LoroText();
        txt.update("A");
        m.setContainer("k", txt);
        // Replace with primitive before commit
        m.set("k", "B");
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("map: primitive replaced with container in same commit", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const m = doc.getMap("m");
        m.set("k", "B");
        const txt = new LoroText();
        txt.update("C");
        m.setContainer("k", txt);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("list: insert container then delete it in same commit (no residual)", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            state = applyEventBatchToState(state, b);
        });

        const l = doc.getList("l");
        const t = new LoroText();
        t.update("x");
        l.insertContainer(0, t);
        l.delete(0, 1);
        await commitAndAssert(doc, () => state);

        unsub();
    });

    it("random fuzz maintains mirrored state", async () => {
        const doc = new LoroDoc();
        let state: Record<string, unknown> = {};
        const unsub = doc.subscribe((b) => {
            // console.log("state", JSON.stringify(state, null, 2));
            // console.log("batch", JSON.stringify(b, null, 2));
            state = applyEventBatchToState(state, b);
        });

        // Seeded PRNG for reproducibility
        function mulberry32(seed: number) {
            return function () {
                let t = (seed += 0x6d2b79f5) | 0;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }
        const rnd = mulberry32(0xdecafbad);
        const rand = (n: number) => Math.floor(rnd() * n);
        const chance = (p: number) => rnd() < p;
        const randStr = () =>
            Array.from({ length: rand(6) + 1 }, () =>
                String.fromCharCode(97 + rand(26)),
            ).join("");

        // Root containers
        const maps = [doc.getMap("m0"), doc.getMap("m1")];
        const lists = [doc.getList("l0"), doc.getList("l1")];
        const mlist = doc.getMovableList("ml0");
        const texts = [doc.getText("t0"), doc.getText("t1")];
        const counters = [doc.getCounter("c0"), doc.getCounter("c1")];

        // Track nested containers for later mutations
        const nestedTexts: LoroText[] = [];
        const nestedLists: LoroList[] = [];
        const nestedMaps: LoroMap[] = [];
        const nestedCounters: LoroCounter[] = [];

        const mapSetPrimitive = () => {
            const m = maps[rand(maps.length)];
            const key = `k${rand(6)}`;
            const valueTypes = [
                () => rand(100),
                () => randStr(),
                () => (chance(0.5) ? true : false),
                () => null,
            ];
            const v = valueTypes[rand(valueTypes.length)]();
            m.set(key, v as any);
        };

        const mapDelete = () => {
            const m = maps[rand(maps.length)];
            if (m.isDeleted()) {
                return;
            }

            const keys = m.keys();
            if (keys.length === 0) return;
            const k = keys[rand(keys.length)];
            m.delete(k);
        };

        const mapSetContainer = () => {
            const m = maps[rand(maps.length)];
            if (m.isDeleted()) {
                return;
            }

            const key = `c${rand(6)}`;
            const which = rand(4);
            if (which === 0) {
                const t = new LoroText();
                m.setContainer(key, t);
                if (chance(0.8)) t.update(randStr());
                nestedTexts.push(t);
            } else if (which === 1) {
                const l = new LoroList();
                m.setContainer(key, l);
                if (chance(0.8)) l.push(randStr());
                nestedLists.push(l);
            } else if (which === 2) {
                const mm = new LoroMap();
                m.setContainer(key, mm);
                if (chance(0.8)) mm.set("x", rand(10));
                nestedMaps.push(mm);
            } else {
                const c = new LoroCounter();
                m.setContainer(key, c);
                if (chance(0.8)) c.increment(rand(5) + 1);
                nestedCounters.push(c);
            }
        };

        const listOp = () => {
            const isMovable = chance(0.3);
            const list = isMovable ? mlist : lists[rand(lists.length)];
            if (list.isDeleted()) {
                return;
            }

            const len = list.length;
            const doWhat = rand(isMovable ? 4 : 3);
            if (doWhat === 0) {
                // insert primitive
                const idx = rand(len + 1);
                list.insert(idx, chance(0.5) ? randStr() : rand(100));
            } else if (doWhat === 1) {
                // insert container
                const idx = rand(len + 1);
                const pick = rand(3);
                if (pick === 0) {
                    const t = list.insertContainer(idx, new LoroText());
                    if (chance(0.8)) t.update(randStr());
                    nestedTexts.push(t);
                } else if (pick === 1) {
                    const l2 = list.insertContainer(idx, new LoroList());
                    if (chance(0.8)) l2.push(randStr());
                    nestedLists.push(l2);
                } else {
                    const m2 = list.insertContainer(idx, new LoroMap());
                    if (chance(0.8)) m2.set("z", rand(10));
                    nestedMaps.push(m2);
                }
            } else if (doWhat === 2) {
                // delete
                if (len > 0) {
                    const idx = rand(len);
                    list.delete(idx, 1);
                }
            } else {
                // move (movable only)
                if (len > 1 && "move" in (list as any)) {
                    const from = rand(len);
                    let to = rand(len);
                    if (to === from) to = (to + 1) % len;
                    (list as any).move(from, to);
                }
            }
        };

        const textOp = () => {
            const t = chance(0.5) ? texts[rand(texts.length)] : nestedTexts[rand(nestedTexts.length)] || texts[0];
            if (t.isDeleted()) {
                return;
            }

            const s = t.toString();
            const kind = rand(3);
            if (kind === 0) {
                const pos = rand(s.length + 1);
                t.insert(pos, randStr());
            } else if (kind === 1) {
                if (s.length > 0) {
                    const pos = rand(s.length);
                    const del = Math.min(s.length - pos, 1 + rand(3));
                    t.delete(pos, del);
                }
            } else {
                t.update(randStr());
            }
        };

        const counterOp = () => {
            const c = chance(0.5)
                ? counters[rand(counters.length)]
                : nestedCounters[rand(nestedCounters.length)] || counters[0];
            if (doc.getPathToContainer(c.id) == null) {
                return;
            }

            const delta = (rand(7) + 1) * (chance(0.5) ? 1 : -1);
            if (delta >= 0) c.increment(delta);
            else c.decrement(-delta);
        };

        const nestedMapOp = () => {
            if (nestedMaps.length === 0) return;
            const mm = nestedMaps[rand(nestedMaps.length)];
            if (mm.isDeleted()) {
                return;
            }

            if (chance(0.5)) mm.set(`n${rand(5)}`, rand(10));
            else {
                const ks = mm.keys();
                if (ks.length) mm.delete(ks[rand(ks.length)]);
            }
        };

        const nestedListOp = () => {
            if (nestedLists.length === 0) return;
            const l = nestedLists[rand(nestedLists.length)];
            if (l.isDeleted()) {
                return;
            }

            const len = l.length;
            if (chance(0.5)) l.insert(rand(len + 1), randStr());
            else if (len > 0) l.delete(rand(len), 1);
        };

        // Perform random ops in random-sized commits
        const commits = 1000;
        for (let c = 0; c < commits; c++) {
            const ops = 1 + rand(5);
            for (let i = 0; i < ops; i++) {
                const pick = rand(7);
                switch (pick) {
                    case 0:
                        mapSetPrimitive();
                        break;
                    case 1:
                        mapDelete();
                        break;
                    case 2:
                        mapSetContainer();
                        break;
                    case 3:
                        listOp();
                        break;
                    case 4:
                        textOp();
                        break;
                    case 5:
                        counterOp();
                        break;
                    default:
                        // mutate nested content occasionally
                        if (chance(0.5)) nestedMapOp();
                        else nestedListOp();
                }
            }
            // Commit this batch and validate
            doc.commit();
            await Promise.resolve();
            // console.log(JSON.stringify({ state, doc: doc.toJSON(), updates: doc.exportJsonUpdates() }, null, 2));
            expect(normalize(state)).toEqual(normalize(doc.toJSON()));
        }

        unsub();
    });
});

function normalize(i: Record<string, unknown>): Record<string, unknown> {
    const s = JSON.parse(JSON.stringify(i));
    for (const [k, v] of Object.entries(s)) {
        if (Array.isArray(v)) {
            if (v.length === 0) {
                delete s[k];
            }
        } else if (typeof v === "object" && v !== null) {
            if (Object.keys(v).length === 0) {
                delete s[k];
            }
        } else if (typeof v === "number") {
            if (v === 0) {
                delete s[k]
            }
        } else if (typeof v === "string") {
            if (v === "") {
                delete s[k];
            }
        }
    }

    return s;
}
