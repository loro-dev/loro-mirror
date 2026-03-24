import { performance } from "node:perf_hooks";

import loroCrdt from "loro-crdt";

import { Mirror, schema } from "../dist/index.js";

const { EphemeralStore, LoroDoc } = loroCrdt;

const DEFAULT_LOCAL_SIZES = [100, 1000, 5000];
const DEFAULT_REMOTE_PATCH_COUNTS = [1, 100, 1000, 3000];
const DEFAULT_REMOTE_DOC_SIZE = 5000;
const DEFAULT_WARMUP = 30;
const DEFAULT_ITERATIONS = 200;
const FINALIZE_TIMEOUT = 60_000;

const ITEM_SCHEMA = schema.LoroMap({
    x: schema.Number(),
    y: schema.Number(),
    name: schema.String(),
});

const TEST_SCHEMA = schema({
    items: schema.LoroList(ITEM_SCHEMA),
});

function parseNumberList(value, fallback) {
    if (!value) return fallback;

    const numbers = value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isFinite(part) && part > 0);

    return numbers.length > 0 ? numbers : fallback;
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

function createItems(count) {
    return Array.from({ length: count }, (_, index) => ({
        x: index,
        y: index * 2,
        name: `item-${index}`,
    }));
}

function createScene(itemCount) {
    const doc = new LoroDoc();
    const eph = new EphemeralStore();
    const mirror = new Mirror({
        doc,
        schema: TEST_SCHEMA,
        ephemeralStore: eph,
        initialState: { items: [] },
    });

    mirror.setState({
        items: createItems(itemCount),
    });

    return { doc, eph, mirror };
}

function getItemContainerId(mirror, index) {
    const state = mirror.getState();
    const containerId = state.items[index]?.$cid;
    if (typeof containerId !== "string") {
        throw new Error(`Missing $cid for items[${index}]`);
    }

    return containerId;
}

function gcIfAvailable() {
    if (typeof globalThis.gc === "function") {
        globalThis.gc();
    }
}

function summarizeSamples(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (ratio) => {
        const index = Math.min(
            sorted.length - 1,
            Math.floor((sorted.length - 1) * ratio),
        );
        return sorted[index];
    };

    const total = samples.reduce((sum, value) => sum + value, 0);
    return {
        avgMs: total / samples.length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: sorted[sorted.length - 1],
    };
}

function measureOperation(run, warmup, iterations) {
    for (let index = 0; index < warmup; index += 1) {
        run(index);
    }

    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
        const start = performance.now();
        run(index + warmup);
        samples.push(performance.now() - start);
    }

    return summarizeSamples(samples);
}

function formatMs(value) {
    return `${value.toFixed(3)} ms`;
}

function printTable(title, rows) {
    console.log(`\n${title}`);
    console.table(
        rows.map((row) => ({
            case: row.case,
            avg: formatMs(row.avgMs),
            p50: formatMs(row.p50Ms),
            p95: formatMs(row.p95Ms),
            max: formatMs(row.maxMs),
        })),
    );
}

function benchLocalSetState(itemCount, warmup, iterations) {
    const { mirror } = createScene(itemCount);
    const targetIndex = Math.floor(itemCount / 2);

    const result = measureOperation((step) => {
        const base = step + 1;
        mirror.setState(
            (state) => {
                state.items[targetIndex].x = base;
                state.items[targetIndex].y = base + 1;
            },
            { finalizeTimeout: FINALIZE_TIMEOUT },
        );
    }, warmup, iterations);

    mirror.dispose();
    gcIfAvailable();

    return { case: `setState x/y, ${itemCount} items`, ...result };
}

function benchPatchEphemeral(itemCount, warmup, iterations) {
    const { mirror } = createScene(itemCount);
    const targetIndex = Math.floor(itemCount / 2);
    const containerId = getItemContainerId(mirror, targetIndex);

    const result = measureOperation((step) => {
        mirror.patchEphemeral(containerId, "x", step + 1, {
            finalizeTimeout: FINALIZE_TIMEOUT,
        });
    }, warmup, iterations);

    mirror.dispose();
    gcIfAvailable();

    return { case: `patchEphemeral x, ${itemCount} items`, ...result };
}

function seedRemotePatches(mirror, eph, patchCount) {
    for (let index = 0; index < patchCount; index += 1) {
        const containerId = getItemContainerId(mirror, index);
        eph.set(containerId, {
            x: -index,
            y: -index,
        });
    }
}

function benchRemoteApply(docSize, activePatchCount, warmup, iterations) {
    if (activePatchCount > docSize) {
        throw new Error(
            `activePatchCount (${activePatchCount}) must be <= remoteDocSize (${docSize})`,
        );
    }

    const { eph, mirror } = createScene(docSize);
    seedRemotePatches(mirror, eph, activePatchCount);

    const targetIndex = Math.floor(activePatchCount / 2);
    const targetId = getItemContainerId(mirror, targetIndex);

    const result = measureOperation((step) => {
        const base = step + 1;
        eph.set(targetId, {
            x: base,
            y: base + 1,
        });
    }, warmup, iterations);

    mirror.dispose();
    gcIfAvailable();

    return {
        case: `remote apply, ${activePatchCount} active patches`,
        ...result,
    };
}

function main() {
    const warmup = parsePositiveInt(process.env.EPHEMERAL_BENCH_WARMUP, DEFAULT_WARMUP);
    const iterations = parsePositiveInt(
        process.env.EPHEMERAL_BENCH_ITERATIONS,
        DEFAULT_ITERATIONS,
    );
    const localSizes = parseNumberList(
        process.env.EPHEMERAL_BENCH_LOCAL_SIZES,
        DEFAULT_LOCAL_SIZES,
    );
    const remotePatchCounts = parseNumberList(
        process.env.EPHEMERAL_BENCH_REMOTE_PATCH_COUNTS,
        DEFAULT_REMOTE_PATCH_COUNTS,
    );
    const remoteDocSize = parsePositiveInt(
        process.env.EPHEMERAL_BENCH_REMOTE_DOC_SIZE,
        DEFAULT_REMOTE_DOC_SIZE,
    );

    console.log("Ephemeral performance benchmark");
    console.log(
        [
            `warmup=${warmup}`,
            `iterations=${iterations}`,
            `finalizeTimeout=${FINALIZE_TIMEOUT}`,
            `remoteDocSize=${remoteDocSize}`,
        ].join(" "),
    );

    const localRows = [];
    for (const itemCount of localSizes) {
        localRows.push(benchLocalSetState(itemCount, warmup, iterations));
        localRows.push(benchPatchEphemeral(itemCount, warmup, iterations));
    }
    printTable("Local hot path", localRows);

    const remoteRows = [];
    for (const activePatchCount of remotePatchCounts) {
        remoteRows.push(
            benchRemoteApply(remoteDocSize, activePatchCount, warmup, iterations),
        );
    }
    printTable("Remote apply hot path", remoteRows);
}

try {
    main();
    setImmediate(() => {
        process.exit(0);
    });
} catch (error) {
    console.error(error);
    process.exit(1);
}
