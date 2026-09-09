// Build first, then: node packages/core/scripts/single-text-event-bench.mjs
// This measures event-to-state application, not writes, UI latency or startup.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import loro from "loro-crdt";
import { Mirror } from "../dist/index.js";
import { applyEventBatchToState } from "../dist/core/loroEventApply.js";

const { LoroDoc, LoroMap, LoroText } = loro;
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
};
// Optional module URL for a previously built event applier; same events, no noop.
const baseline = process.env.TEXT_EVENT_BASELINE
    ? (await import(process.env.TEXT_EVENT_BASELINE)).applyEventBatchToState
    : undefined;
for (const size of [1000, 5000, 20000]) {
    const doc = new LoroDoc();
    const rows = doc.getList("rows");
    let text;
    for (let i = 0; i < size; i++) {
        const row = rows.pushContainer(new LoroMap());
        text = row.setContainer("body", new LoroText());
        text.update("seed");
        row.set("payload", { description: "synthetic", values: [1, 2, 3] });
    }
    doc.commit();
    const mirror = new Mirror({ doc });
    const initial = mirror.getState();
    mirror.dispose();
    const batches = [];
    const unsubscribe = doc.subscribe((batch) => batches.push(batch));
    for (let i = 0; i < 30; i++) {
        text.insert(text.length, "x");
        doc.commit();
    }
    unsubscribe();
    const controls = batches.map((batch) => {
        assert.equal(batch.events.length, 1);
        assert.equal(batch.events[0].diff.type, "text");
        // Same net delta, plus an empty text event to force the general path.
        return {
            ...batch,
            events: [
                ...batch.events,
                {
                    ...batch.events[0],
                    diff: { type: "text", diff: [] },
                },
            ],
        };
    });
    const run = (events, apply = applyEventBatchToState) => {
        let state = initial;
        const start = performance.now();
        for (const batch of events) state = apply(state, batch);
        const msPerChunk = (performance.now() - start) / events.length;
        assert.deepEqual(state, doc.toJSON());
        return msPerChunk;
    };
    run(batches);
    run(controls);
    if (baseline) run(batches, baseline);
    const fast = [],
        general = [],
        previous = [];
    for (let i = 0; i < 5; i++) {
        if (i % 2) {
            general.push(run(controls));
            if (baseline) previous.push(run(batches, baseline));
            fast.push(run(batches));
        } else {
            fast.push(run(batches));
            if (baseline) previous.push(run(batches, baseline));
            general.push(run(controls));
        }
    }
    console.log(
        JSON.stringify({
            size,
            fastMs: median(fast),
            generalMs: median(general),
            ...(baseline ? { previousMs: median(previous) } : {}),
        }),
    );
}
