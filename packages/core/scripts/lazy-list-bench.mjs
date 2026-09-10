import { performance } from "node:perf_hooks";

import loroCrdt from "loro-crdt";

import { Mirror, schema } from "../dist/index.js";

const { LoroDoc, LoroList, LoroMap, LoroText } = loroCrdt;

const DEFAULT_ITEMS = 2000;
const DEFAULT_HYDRATE_WINDOW = 30;
const DEFAULT_WARMUP = 3;
const DEFAULT_ITERATIONS = 10;

// Doc shape mirrors the acceptance target: one root list of 2000 item maps,
// each with ~30 nested containers (6 LoroText fields, a `meta` map with 2
// texts, a `subs` list with 2 texts, and 8 extra maps with 1 text each) —
// ~58k containers at the default size.
function itemSchema() {
    const extras = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
            `extra${i}`,
            schema.LoroMap({ t: schema.LoroText() }),
        ]),
    );
    return schema.LoroMap({
        id: schema.String(),
        f0: schema.LoroText(),
        f1: schema.LoroText(),
        f2: schema.LoroText(),
        f3: schema.LoroText(),
        f4: schema.LoroText(),
        f5: schema.LoroText(),
        meta: schema.LoroMap({
            a: schema.LoroText(),
            b: schema.LoroText(),
        }),
        subs: schema.LoroList(schema.LoroText()),
        ...extras,
    });
}

const LAZY_SCHEMA = schema({
    history: schema.LoroList(itemSchema(), (it) => it.id, {
        lazy: { index: ["id"] },
    }),
});

const EAGER_SCHEMA = schema({
    history: schema.LoroList(itemSchema(), (it) => it.id),
});

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

const TEXT_CHUNK =
    "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ";

function text(...parts) {
    return (TEXT_CHUNK.repeat(3) + parts.join(" ")).slice(0, 220);
}

function createHistoryDoc(itemCount) {
    const doc = new LoroDoc();
    const history = doc.getList("history");

    for (let item = 0; item < itemCount; item += 1) {
        const entry = history.insertContainer(history.length, new LoroMap());
        entry.set("id", `item-${item}`);
        for (let field = 0; field < 6; field += 1) {
            const t = entry.setContainer(`f${field}`, new LoroText());
            t.insert(0, text(`field ${field} of item ${item}`));
        }
        const meta = entry.setContainer("meta", new LoroMap());
        meta.setContainer("a", new LoroText()).insert(0, text(`a-${item}`));
        meta.setContainer("b", new LoroText()).insert(0, text(`b-${item}`));
        const subs = entry.setContainer("subs", new LoroList());
        subs.pushContainer(new LoroText()).insert(0, text(`sub0-${item}`));
        subs.pushContainer(new LoroText()).insert(0, text(`sub1-${item}`));
        for (let extra = 0; extra < 8; extra += 1) {
            const m = entry.setContainer(`extra${extra}`, new LoroMap());
            m.setContainer("t", new LoroText()).insert(
                0,
                text(`extra${extra}-${item}`),
            );
        }
    }

    doc.commit();
    return doc;
}

function openLazyMirror(doc, itemCount) {
    const mirror = new Mirror({ doc, schema: LAZY_SCHEMA });
    const state = mirror.getState();
    if (state.history.length !== itemCount) {
        mirror.dispose();
        throw new Error("Lazy mirror did not expose the full list length");
    }
    return mirror;
}

function openEagerMirror(doc, itemCount) {
    const mirror = new Mirror({ doc, schema: EAGER_SCHEMA });
    if (mirror.getState().history.length !== itemCount) {
        mirror.dispose();
        throw new Error("Eager mirror did not read the complete history");
    }
    return mirror;
}

function gcIfAvailable() {
    if (typeof globalThis.gc === "function") {
        globalThis.gc();
    }
}

function percentile(sorted, ratio) {
    const index = Math.min(
        sorted.length - 1,
        Math.floor((sorted.length - 1) * ratio),
    );
    return sorted[index];
}

function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
        minMs: sorted[0],
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
    };
}

function benchSync(label, itemCount, warmup, iterations, open) {
    for (let index = 0; index < warmup; index += 1) {
        open(itemCount).dispose();
    }
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
        gcIfAvailable();
        const start = performance.now();
        const mirror = open(itemCount);
        samples.push(performance.now() - start);
        mirror.dispose();
    }
    return { label, ...summarize(samples) };
}

async function benchHydrate(doc, itemCount, window, warmup, iterations) {
    for (let index = 0; index < warmup; index += 1) {
        const mirror = openLazyMirror(doc, itemCount);
        await mirror.getState().history.hydrate(0, window);
        mirror.dispose();
    }
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
        gcIfAvailable();
        const mirror = openLazyMirror(doc, itemCount);
        const start = performance.now();
        await mirror.getState().history.hydrate(0, window);
        samples.push(performance.now() - start);
        const hydrated = mirror.getState().history.slice(0, window);
        if (hydrated.some((entry) => entry === undefined)) {
            mirror.dispose();
            throw new Error("hydrate(0, window) left non-hydrated items");
        }
        mirror.dispose();
    }
    return { label: `lazy hydrate(0, ${window})`, ...summarize(samples) };
}

function formatMs(value) {
    return `${value.toFixed(3)} ms`;
}

async function main() {
    const itemCount = parsePositiveInt(
        process.env.LAZY_LIST_BENCH_ITEMS,
        DEFAULT_ITEMS,
    );
    const window = parsePositiveInt(
        process.env.LAZY_LIST_BENCH_WINDOW,
        DEFAULT_HYDRATE_WINDOW,
    );
    const warmup = parsePositiveInt(
        process.env.LAZY_LIST_BENCH_WARMUP,
        DEFAULT_WARMUP,
    );
    const iterations = parsePositiveInt(
        process.env.LAZY_LIST_BENCH_ITERATIONS,
        DEFAULT_ITERATIONS,
    );

    const doc = createHistoryDoc(itemCount);

    const lazyInit = benchSync(
        "lazy init",
        itemCount,
        warmup,
        iterations,
        (n) => openLazyMirror(doc, n),
    );
    const eagerInit = benchSync(
        "eager init (control)",
        itemCount,
        warmup,
        iterations,
        (n) => openEagerMirror(doc, n),
    );
    const hydrate = await benchHydrate(
        doc,
        itemCount,
        window,
        warmup,
        iterations,
    );

    console.log("lazy list benchmark (2000-item default, ~30 containers/item)");
    console.log(
        `items=${itemCount} window=${window} warmup=${warmup} iterations=${iterations}`,
    );
    console.table(
        [lazyInit, hydrate, eagerInit].map((row) => ({
            benchmark: row.label,
            min: formatMs(row.minMs),
            p50: formatMs(row.p50Ms),
            p95: formatMs(row.p95Ms),
        })),
    );
}

void main();
