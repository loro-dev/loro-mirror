import { performance } from "node:perf_hooks";

import loroCrdt from "loro-crdt";

import { Mirror, schema } from "../dist/index.js";

const { LoroDoc, LoroList, LoroMap, LoroText } = loroCrdt;

const DEFAULT_ENTRIES = 171;
const DEFAULT_ITEMS_PER_ENTRY = 30;
const DEFAULT_WARMUP = 3;
const DEFAULT_ITERATIONS = 10;

// Doc shape mirrors a real session-history document: `history` is a list of
// turn maps, each turn has an `items` list of maps whose fields are mostly
// LoroText. With 171 turns x 30 items this yields ~67k containers
// (Map ~10k / List ~5k / Text ~51k) — text-dominated, like the real thing.
function itemSchema() {
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
    });
}

const HISTORY_SCHEMA = schema({
    history: schema.LoroList(
        schema.LoroMap({
            id: schema.String(),
            items: schema.LoroList(itemSchema()),
        }),
    ),
});

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

// Realistic text payloads: session turns hold paragraphs, not 30-char stubs.
const TEXT_CHUNK =
    "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ";

function text(...parts) {
    return (TEXT_CHUNK.repeat(3) + parts.join(" ")).slice(0, 220);
}

function createHistoryDoc(entryCount, itemsPerEntry) {
    const doc = new LoroDoc();
    const history = doc.getList("history");

    for (let index = 0; index < entryCount; index += 1) {
        const turn = history.insertContainer(history.length, new LoroMap());
        turn.set("id", `turn-${index}`);
        const items = turn.setContainer("items", new LoroList());
        for (let item = 0; item < itemsPerEntry; item += 1) {
            const entry = items.insertContainer(items.length, new LoroMap());
            entry.set("id", `item-${index}-${item}`);
            for (let field = 0; field < 6; field += 1) {
                const t = entry.setContainer(`f${field}`, new LoroText());
                t.insert(0, text(`field ${field} of item ${item} of ${index}`));
            }
            const meta = entry.setContainer("meta", new LoroMap());
            meta.setContainer("a", new LoroText()).insert(
                0,
                text(`a-${index}-${item}`),
            );
            meta.setContainer("b", new LoroText()).insert(
                0,
                text(`b-${index}-${item}`),
            );
            const subs = entry.setContainer("subs", new LoroList());
            subs.pushContainer(new LoroText()).insert(
                0,
                text(`sub0-${index}-${item}`),
            );
            subs.pushContainer(new LoroText()).insert(
                0,
                text(`sub1-${index}-${item}`),
            );
        }
    }

    doc.commit();
    return doc;
}

function openMirror(doc, entryCount) {
    const mirror = new Mirror({
        doc,
        schema: HISTORY_SCHEMA,
    });

    if (mirror.getState().history.length !== entryCount) {
        mirror.dispose();
        throw new Error("Mirror did not read the complete history");
    }

    return mirror;
}

function getPrototypeMethod(prototype, name) {
    const method = Object.getOwnPropertyDescriptor(prototype, name)?.value;
    if (typeof method !== "function") {
        throw new Error(`Missing prototype method: ${name}`);
    }

    return method;
}

function countTraversalCalls(doc, entryCount) {
    const originalListGet = getPrototypeMethod(LoroList.prototype, "get");
    const originalMapGet = getPrototypeMethod(LoroMap.prototype, "get");
    const originalTextToJSON = getPrototypeMethod(LoroText.prototype, "toJSON");
    const originalGetDeepValueWithID = getPrototypeMethod(
        LoroDoc.prototype,
        "getDeepValueWithID",
    );
    const calls = {
        getDeepValueWithID: 0,
        listGet: 0,
        mapGet: 0,
        textToJSON: 0,
    };

    LoroDoc.prototype.getDeepValueWithID = function () {
        calls.getDeepValueWithID += 1;
        return Reflect.apply(originalGetDeepValueWithID, this, []);
    };
    LoroList.prototype.get = function (index) {
        calls.listGet += 1;
        return Reflect.apply(originalListGet, this, [index]);
    };
    LoroMap.prototype.get = function (key) {
        calls.mapGet += 1;
        return Reflect.apply(originalMapGet, this, [key]);
    };
    LoroText.prototype.toJSON = function () {
        calls.textToJSON += 1;
        return Reflect.apply(originalTextToJSON, this, []);
    };

    try {
        const mirror = openMirror(doc, entryCount);
        mirror.dispose();
        return calls;
    } finally {
        LoroDoc.prototype.getDeepValueWithID = originalGetDeepValueWithID;
        LoroList.prototype.get = originalListGet;
        LoroMap.prototype.get = originalMapGet;
        LoroText.prototype.toJSON = originalTextToJSON;
    }
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

function benchmarkInitialization(doc, entryCount, warmup, iterations) {
    for (let index = 0; index < warmup; index += 1) {
        const mirror = openMirror(doc, entryCount);
        mirror.dispose();
    }

    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
        gcIfAvailable();
        const start = performance.now();
        const mirror = openMirror(doc, entryCount);
        samples.push(performance.now() - start);
        mirror.dispose();
    }

    const sorted = [...samples].sort((a, b) => a - b);
    return {
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        minMs: sorted[0],
    };
}

function formatMs(value) {
    return `${value.toFixed(3)} ms`;
}

function main() {
    const entryCount = parsePositiveInt(
        process.env.BULK_INIT_BENCH_ENTRIES,
        DEFAULT_ENTRIES,
    );
    const itemsPerEntry = parsePositiveInt(
        process.env.BULK_INIT_BENCH_ITEMS_PER_ENTRY,
        DEFAULT_ITEMS_PER_ENTRY,
    );
    const warmup = parsePositiveInt(
        process.env.BULK_INIT_BENCH_WARMUP,
        DEFAULT_WARMUP,
    );
    const iterations = parsePositiveInt(
        process.env.BULK_INIT_BENCH_ITERATIONS,
        DEFAULT_ITERATIONS,
    );
    const doc = createHistoryDoc(entryCount, itemsPerEntry);
    const calls = countTraversalCalls(doc, entryCount);
    const timing = benchmarkInitialization(doc, entryCount, warmup, iterations);

    console.log("bulk initialization benchmark (getDeepValueWithID)");
    console.log(
        `entries=${entryCount} itemsPerEntry=${itemsPerEntry} warmup=${warmup} iterations=${iterations}`,
    );
    console.table([
        {
            getDeepValueWithID: calls.getDeepValueWithID,
            listGet: calls.listGet,
            mapGet: calls.mapGet,
            textToJSON: calls.textToJSON,
            min: formatMs(timing.minMs),
            p50: formatMs(timing.p50Ms),
            p95: formatMs(timing.p95Ms),
        },
    ]);
}

main();
