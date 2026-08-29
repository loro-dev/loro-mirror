import { performance } from "node:perf_hooks";

import loroCrdt from "loro-crdt";

import { Mirror, schema } from "../dist/index.js";

const { LoroDoc, LoroList, LoroMap, LoroText } = loroCrdt;

const DEFAULT_ENTRIES = 2000;
const DEFAULT_WARMUP = 3;
const DEFAULT_ITERATIONS = 10;

const HISTORY_SCHEMA = schema({
    history: schema.LoroList(
        schema.LoroMap({
            id: schema.String(),
            body: schema.LoroText(),
            metadata: schema.LoroMap({
                agent: schema.String(),
                tokens: schema.Number(),
            }),
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

function createHistoryDoc(entryCount) {
    const doc = new LoroDoc();
    const history = doc.getList("history");

    for (let index = 0; index < entryCount; index += 1) {
        const entry = history.insertContainer(history.length, new LoroMap());
        entry.set("id", `turn-${index}`);
        const body = entry.setContainer("body", new LoroText());
        body.insert(0, `history body ${index}`);
        const metadata = entry.setContainer("metadata", new LoroMap());
        metadata.set("agent", index % 2 === 0 ? "codex" : "user");
        metadata.set("tokens", index);
    }

    doc.commit();
    return doc;
}

function openMirror(doc, entryCount) {
    const mirror = new Mirror({
        doc,
        schema: HISTORY_SCHEMA,
        ignoreUnknownProperties: true,
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
    const calls = { listGet: 0, mapGet: 0, textToJSON: 0 };

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
        process.env.IGNORE_UNKNOWN_BENCH_ENTRIES,
        DEFAULT_ENTRIES,
    );
    const warmup = parsePositiveInt(
        process.env.IGNORE_UNKNOWN_BENCH_WARMUP,
        DEFAULT_WARMUP,
    );
    const iterations = parsePositiveInt(
        process.env.IGNORE_UNKNOWN_BENCH_ITERATIONS,
        DEFAULT_ITERATIONS,
    );
    const doc = createHistoryDoc(entryCount);
    const calls = countTraversalCalls(doc, entryCount);
    const timing = benchmarkInitialization(doc, entryCount, warmup, iterations);

    console.log("ignoreUnknownProperties initialization benchmark");
    console.log(
        `entries=${entryCount} warmup=${warmup} iterations=${iterations}`,
    );
    console.table([
        {
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
