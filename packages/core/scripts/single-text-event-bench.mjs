// Build first, then: node packages/core/scripts/single-text-event-bench.mjs
// This measures event-to-state application, not writes, UI latency or startup.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import loro from "loro-crdt";
import { Mirror } from "../dist/index.js";
import { applyEventBatchToState } from "../dist/core/loroEventApply.js";

const { LoroDoc, LoroMap, LoroText } = loro;
const median = (values) => values.sort((a, b) => a - b)[2];
for (const size of [200, 1000]) {
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
    for (let i = 0; i < 100; i++) {
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
    const run = (events) => {
        let state = initial;
        const start = performance.now();
        for (const batch of events)
            state = applyEventBatchToState(state, batch);
        const msPerChunk = (performance.now() - start) / events.length;
        assert.deepEqual(state, doc.toJSON());
        return msPerChunk;
    };
    run(batches);
    run(controls);
    const fast = [],
        general = [];
    for (let i = 0; i < 5; i++) {
        if (i % 2) {
            general.push(run(controls));
            fast.push(run(batches));
        } else {
            fast.push(run(batches));
            general.push(run(controls));
        }
    }
    console.log(
        JSON.stringify({
            size,
            fastMs: median(fast),
            generalMs: median(general),
        }),
    );
}
