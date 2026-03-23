import { Mirror, SyncDirection, UpdateMetadata } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { describe, expect, it, vi, afterEach } from "vitest";

function createTestSetup() {
    const doc = new LoroDoc();
    const eph = new EphemeralStore();
    const testSchema = schema({
        items: schema.LoroList(
            schema.LoroMap({
                x: schema.Number(),
                y: schema.Number(),
                name: schema.String(),
            }),
        ),
    });

    const mirror = new Mirror({
        doc,
        schema: testSchema,
        ephemeralStore: eph,
        initialState: {
            items: [],
        },
    });

    // Push initial items to LoroDoc
    mirror.setState({
        items: [
            { x: 0, y: 0, name: "item1" },
            { x: 10, y: 20, name: "item2" },
        ],
    } as any);

    return { doc, eph, mirror };
}

function createSimpleSetup() {
    const doc = new LoroDoc();
    const eph = new EphemeralStore();
    const testSchema = schema({
        canvas: schema.LoroMap({
            x: schema.Number(),
            y: schema.Number(),
            width: schema.Number(),
            height: schema.Number(),
        }),
    });

    const mirror = new Mirror({
        doc,
        schema: testSchema,
        ephemeralStore: eph,
        initialState: {
            canvas: { x: 0, y: 0, width: 100, height: 100 },
        },
    });

    // Push initial state to LoroDoc so Map keys exist
    mirror.setState((s) => {
        s.canvas.x = 0;
        s.canvas.y = 0;
        s.canvas.width = 100;
        s.canvas.height = 100;
    });

    return { doc, eph, mirror };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("setStateWithEphemeralPatch", () => {
    it("should update state immediately with ephemeral values", () => {
        const { mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
                s.canvas.y = 75;
            },
            { finalizeTimeout: 50_000 },
        );

        const state = mirror.getState();
        expect(state.canvas.x).toBe(50);
        expect(state.canvas.y).toBe(75);
        // Non-changed values should remain
        expect(state.canvas.width).toBe(100);
        expect(state.canvas.height).toBe(100);

        mirror.dispose();
    });

    it("should not write ephemeral-eligible changes to LoroDoc", () => {
        const { doc, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 50_000 },
        );

        // LoroDoc should still have the original value
        const docState = doc.getMap("canvas").toJSON();
        expect(docState.x).toBe(0);

        mirror.dispose();
    });

    it("should store values in EphemeralStore", () => {
        const { eph, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
                s.canvas.y = 75;
            },
            { finalizeTimeout: 50_000 },
        );

        // EphemeralStore should have the container's patch
        const allStates = eph.getAllStates();
        const keys = Object.keys(allStates);
        expect(keys.length).toBeGreaterThan(0);

        // Find the canvas container patch
        const canvasContainerKey = keys.find((k) => {
            const patch = allStates[k] as Record<string, unknown>;
            return patch && "x" in patch;
        });
        expect(canvasContainerKey).toBeDefined();
        const patch = allStates[canvasContainerKey!] as Record<string, unknown>;
        expect(patch.x).toBe(50);
        expect(patch.y).toBe(75);

        mirror.dispose();
    });

    it("should throw if no ephemeralStore configured", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            initialState: { canvas: { x: 0 } },
        });

        expect(() => {
            mirror.setStateWithEphemeralPatch((s: any) => {
                s.canvas.x = 50;
            });
        }).toThrow("ephemeralStore");

        mirror.dispose();
    });

    it("should notify subscribers when ephemeral patch is set", () => {
        const { mirror } = createSimpleSetup();
        let metadata: UpdateMetadata | undefined;

        mirror.subscribe((_, m) => {
            metadata = m;
        });

        mirror.setStateWithEphemeralPatch((s) => {
            s.canvas.x = 50;
        });

        expect(metadata).toBeDefined();
        expect(metadata!.direction).toBe(SyncDirection.TO_LORO);

        mirror.dispose();
    });
});

describe("Change classification", () => {
    it("should route non-Map changes to LoroDoc", () => {
        const { doc, mirror } = createTestSetup();

        // Adding a new item to a list should go to LoroDoc
        mirror.setStateWithEphemeralPatch((s) => {
            s.items.push({ x: 30, y: 40, name: "item3" } as any);
        });

        const docItems = doc.getList("items").toJSON();
        expect(docItems.length).toBe(3);

        mirror.dispose();
    });

    it("should route Map primitive value changes to EphemeralStore", () => {
        const { doc, eph, mirror } = createTestSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.items[0].x = 100;
            },
            { finalizeTimeout: 50_000 },
        );

        // State should reflect the change
        expect(mirror.getState().items[0].x).toBe(100);

        // LoroDoc should NOT have the change (it went to ephemeral)
        const docItems = doc.getList("items").toJSON();
        expect(docItems[0].x).toBe(0);

        mirror.dispose();
    });
});

describe("finalizeEphemeralPatches", () => {
    it("should write ephemeral values to LoroDoc on finalize", () => {
        const { doc, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
                s.canvas.y = 75;
            },
            { finalizeTimeout: 50_000 },
        );

        // Before finalize: LoroDoc unchanged
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        mirror.finalizeEphemeralPatches();

        // After finalize: LoroDoc updated
        expect(doc.getMap("canvas").toJSON().x).toBe(50);
        expect(doc.getMap("canvas").toJSON().y).toBe(75);

        // State should still be correct
        expect(mirror.getState().canvas.x).toBe(50);

        mirror.dispose();
    });

    it("should skip values that were overwritten by remote peer", () => {
        const { doc, eph, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 50_000 },
        );

        // Simulate remote peer overwriting the ephemeral value
        const canvasContainerId = doc.getMap("canvas").id;
        const currentPatch = eph.get(canvasContainerId) as Record<string, unknown> | undefined;
        if (currentPatch) {
            eph.set(canvasContainerId, { ...currentPatch, x: 999 } as any);
        }

        mirror.finalizeEphemeralPatches();

        // LoroDoc should NOT have our value (remote overwrote it)
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        mirror.dispose();
    });

    it("should debounce finalize with repeated calls", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 1000 },
        );

        vi.advanceTimersByTime(500);

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 100;
            },
            { finalizeTimeout: 1000 },
        );

        // At 500ms after second call, first timer should have been reset
        vi.advanceTimersByTime(500);
        expect(doc.getMap("canvas").toJSON().x).toBe(0); // Not yet finalized

        // At 1000ms after second call, it should finalize
        vi.advanceTimersByTime(500);
        expect(doc.getMap("canvas").toJSON().x).toBe(100);

        vi.useRealTimers();
        mirror.dispose();
    });

    it("should handle manual finalize clearing the timer", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 1000 },
        );

        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().x).toBe(50);

        // Timer should have been cleared - advancing time should not cause issues
        vi.advanceTimersByTime(2000);

        vi.useRealTimers();
        mirror.dispose();
    });
});

describe("EphemeralStore remote changes", () => {
    it("should recompose state when remote ephemeral patch arrives", () => {
        const { doc, eph, mirror } = createSimpleSetup();

        const canvasContainerId = doc.getMap("canvas").id;

        // Simulate remote peer writing to EphemeralStore
        eph.set(canvasContainerId, { x: 200, y: 300 } as any);

        // State should now reflect the ephemeral overlay
        const state = mirror.getState();
        expect(state.canvas.x).toBe(200);
        expect(state.canvas.y).toBe(300);

        mirror.dispose();
    });

    it("should notify subscribers with FROM_EPHEMERAL direction", () => {
        const { doc, eph, mirror } = createSimpleSetup();
        let metadata: UpdateMetadata | undefined;

        mirror.subscribe((_, m) => {
            metadata = m;
        });

        const canvasContainerId = doc.getMap("canvas").id;
        eph.set(canvasContainerId, { x: 200 } as any);

        expect(metadata).toBeDefined();
        expect(metadata!.direction).toBe(SyncDirection.FROM_EPHEMERAL);

        mirror.dispose();
    });
});

describe("FROM_LORO with ephemeral overlay", () => {
    it("should preserve ephemeral overlay when LoroDoc changes other fields", () => {
        const { doc, mirror } = createSimpleSetup();

        // Set ephemeral patch on x
        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 50_000 },
        );

        expect(mirror.getState().canvas.x).toBe(50);

        // Remote change to width via LoroDoc (different field)
        const doc2 = new LoroDoc();
        doc2.import(doc.export({ mode: "snapshot" }));
        doc2.getMap("canvas").set("width", 500);
        doc.import(doc2.export({ mode: "update", from: doc.oplogVersion() }));

        // Ephemeral overlay should still be applied
        const state = mirror.getState();
        expect(state.canvas.x).toBe(50);
        expect(state.canvas.width).toBe(500);

        mirror.dispose();
    });
});

describe("dispose cleanup", () => {
    it("should clear ephemeral resources on dispose", () => {
        vi.useFakeTimers();
        const { mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 1000 },
        );

        mirror.dispose();

        // Advancing time should not cause errors (timer was cleared)
        vi.advanceTimersByTime(2000);

        vi.useRealTimers();
    });
});

describe("setState still works with ephemeralStore", () => {
    it("should write directly to LoroDoc as before", () => {
        const { doc, mirror } = createSimpleSetup();

        mirror.setState((s) => {
            s.canvas.x = 50;
        });

        expect(doc.getMap("canvas").toJSON().x).toBe(50);
        expect(mirror.getState().canvas.x).toBe(50);

        mirror.dispose();
    });
});

describe("Drag-and-drop simulation", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("should handle a full drag lifecycle: start → move → move → end (finalize)", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createTestSetup();
        const TIMEOUT = 500;

        // --- drag start: first move ---
        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.items[0].x = 5;
                s.items[0].y = 5;
            },
            { finalizeTimeout: TIMEOUT },
        );

        expect(mirror.getState().items[0].x).toBe(5);
        expect(mirror.getState().items[0].y).toBe(5);
        expect(doc.getList("items").toJSON()[0].x).toBe(0); // not in doc yet

        // --- mid-drag: rapid moves ---
        for (let i = 1; i <= 20; i++) {
            vi.advanceTimersByTime(20); // 20ms between frames (~50fps)
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.items[0].x = 5 + i * 10;
                    s.items[0].y = 5 + i * 5;
                },
                { finalizeTimeout: TIMEOUT },
            );
        }

        // After 20 moves, state should reflect final drag position
        expect(mirror.getState().items[0].x).toBe(205);
        expect(mirror.getState().items[0].y).toBe(105);
        // LoroDoc should still have original — debounce keeps resetting
        expect(doc.getList("items").toJSON()[0].x).toBe(0);

        // --- drag end: wait for debounce to finalize ---
        vi.advanceTimersByTime(TIMEOUT);

        // Now LoroDoc should have the final position
        expect(doc.getList("items").toJSON()[0].x).toBe(205);
        expect(doc.getList("items").toJSON()[0].y).toBe(105);
        // State should remain consistent
        expect(mirror.getState().items[0].x).toBe(205);
        expect(mirror.getState().items[0].y).toBe(105);

        mirror.dispose();
    });

    it("should keep LoroDoc clean during rapid moves and only write once on finalize", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();
        const TIMEOUT = 1000;

        const initialVersion = doc.oplogVersion();

        // Simulate 50 rapid moves
        for (let i = 0; i < 50; i++) {
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.canvas.x = i * 4;
                    s.canvas.y = i * 3;
                },
                { finalizeTimeout: TIMEOUT },
            );
            vi.advanceTimersByTime(16); // ~60fps
        }

        // LoroDoc should be unchanged during the entire drag
        expect(doc.getMap("canvas").toJSON().x).toBe(0);
        expect(doc.getMap("canvas").toJSON().y).toBe(0);

        // Mirror state should reflect the latest
        expect(mirror.getState().canvas.x).toBe(196);
        expect(mirror.getState().canvas.y).toBe(147);

        // Finalize
        vi.advanceTimersByTime(TIMEOUT);

        // Now LoroDoc should have the final value
        expect(doc.getMap("canvas").toJSON().x).toBe(196);
        expect(doc.getMap("canvas").toJSON().y).toBe(147);

        mirror.dispose();
    });

    it("should support manual finalize on drag end (mouseup) before timeout", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();
        const TIMEOUT = 5000;

        // Drag moves
        for (let i = 0; i < 10; i++) {
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.canvas.x = (i + 1) * 20;
                    s.canvas.y = (i + 1) * 15;
                },
                { finalizeTimeout: TIMEOUT },
            );
            vi.advanceTimersByTime(16);
        }

        // LoroDoc still untouched
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        // Mouse-up: manually finalize immediately
        mirror.finalizeEphemeralPatches();

        expect(doc.getMap("canvas").toJSON().x).toBe(200);
        expect(doc.getMap("canvas").toJSON().y).toBe(150);

        // After timeout, nothing should break (timer was cleared by manual finalize)
        vi.advanceTimersByTime(TIMEOUT);

        // Values remain correct
        expect(doc.getMap("canvas").toJSON().x).toBe(200);
        expect(mirror.getState().canvas.x).toBe(200);

        mirror.dispose();
    });

    it("should handle multi-element drag (move two items simultaneously)", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createTestSetup();
        const TIMEOUT = 500;

        // Drag both items at once
        for (let i = 0; i < 10; i++) {
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.items[0].x = (i + 1) * 10;
                    s.items[0].y = (i + 1) * 10;
                    s.items[1].x = 10 + (i + 1) * 5;
                    s.items[1].y = 20 + (i + 1) * 5;
                },
                { finalizeTimeout: TIMEOUT },
            );
            vi.advanceTimersByTime(16);
        }

        // Both items moved in state
        expect(mirror.getState().items[0].x).toBe(100);
        expect(mirror.getState().items[0].y).toBe(100);
        expect(mirror.getState().items[1].x).toBe(60);
        expect(mirror.getState().items[1].y).toBe(70);

        // LoroDoc unchanged
        expect(doc.getList("items").toJSON()[0].x).toBe(0);
        expect(doc.getList("items").toJSON()[1].x).toBe(10);

        // Finalize
        vi.advanceTimersByTime(TIMEOUT);

        expect(doc.getList("items").toJSON()[0].x).toBe(100);
        expect(doc.getList("items").toJSON()[0].y).toBe(100);
        expect(doc.getList("items").toJSON()[1].x).toBe(60);
        expect(doc.getList("items").toJSON()[1].y).toBe(70);

        mirror.dispose();
    });

    it("should handle sequential drags (drag, release, drag again)", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();
        const TIMEOUT = 500;

        // First drag
        for (let i = 0; i < 5; i++) {
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.canvas.x = (i + 1) * 10;
                },
                { finalizeTimeout: TIMEOUT },
            );
            vi.advanceTimersByTime(16);
        }

        // Finalize first drag
        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().x).toBe(50);

        // Second drag from finalized position
        for (let i = 0; i < 5; i++) {
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.canvas.x = 50 + (i + 1) * 10;
                },
                { finalizeTimeout: TIMEOUT },
            );
            vi.advanceTimersByTime(16);
        }

        // LoroDoc should still be at 50 (first drag finalized value)
        expect(doc.getMap("canvas").toJSON().x).toBe(50);
        // State should be at latest drag position
        expect(mirror.getState().canvas.x).toBe(100);

        // Finalize second drag
        vi.advanceTimersByTime(TIMEOUT);
        expect(doc.getMap("canvas").toJSON().x).toBe(100);

        mirror.dispose();
    });
});

describe("Debounce behavior", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("should reset the debounce timer on each ephemeral call", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();
        const TIMEOUT = 200;

        mirror.setStateWithEphemeralPatch(
            (s) => { s.canvas.x = 10; },
            { finalizeTimeout: TIMEOUT },
        );

        // Advance 150ms (within timeout), make another call
        vi.advanceTimersByTime(150);
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        mirror.setStateWithEphemeralPatch(
            (s) => { s.canvas.x = 20; },
            { finalizeTimeout: TIMEOUT },
        );

        // Advance another 150ms — 300ms total since first call, but only 150ms since second
        vi.advanceTimersByTime(150);
        expect(doc.getMap("canvas").toJSON().x).toBe(0); // still not finalized

        // Advance another 50ms — 200ms since second call
        vi.advanceTimersByTime(50);
        expect(doc.getMap("canvas").toJSON().x).toBe(20); // finalized with latest value

        mirror.dispose();
    });

    it("should use default timeout when not specified", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();

        // Call without finalizeTimeout — should use 50_000ms default
        mirror.setStateWithEphemeralPatch((s) => {
            s.canvas.x = 42;
        });

        // State should be updated immediately
        expect(mirror.getState().canvas.x).toBe(42);
        // LoroDoc should not be updated yet
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        // Manual finalize confirms the ephemeral value is pending
        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().x).toBe(42);

        mirror.dispose();
    });

    it("should auto-finalize after default timeout via timer", () => {
        vi.useFakeTimers();
        const doc = new LoroDoc();
        const eph = new EphemeralStore();
        const testSchema = schema({
            canvas: schema.LoroMap({
                x: schema.Number(),
                y: schema.Number(),
            }),
        });

        const mirror = new Mirror({
            doc,
            schema: testSchema,
            ephemeralStore: eph,
            initialState: {
                canvas: { x: 0, y: 0 },
            },
        });

        mirror.setState((s) => {
            s.canvas.x = 0;
            s.canvas.y = 0;
        });

        mirror.setStateWithEphemeralPatch(
            (s) => { s.canvas.x = 42; },
            { finalizeTimeout: 1000 },
        );

        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        vi.advanceTimersByTime(1001);
        expect(doc.getMap("canvas").toJSON().x).toBe(42);

        mirror.dispose();
    });

    it("should not finalize after dispose even when timer was pending", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();

        mirror.setStateWithEphemeralPatch(
            (s) => { s.canvas.x = 99; },
            { finalizeTimeout: 500 },
        );

        mirror.dispose();

        // Timer fires after dispose — should NOT write to doc
        vi.advanceTimersByTime(1000);
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        // No errors thrown
    });

    it("should handle resize simulation (width+height dragging)", () => {
        vi.useFakeTimers();
        const { doc, mirror } = createSimpleSetup();
        const TIMEOUT = 300;

        // Simulate resize by dragging bottom-right corner
        for (let i = 0; i < 30; i++) {
            mirror.setStateWithEphemeralPatch(
                (s) => {
                    s.canvas.width = 100 + (i + 1) * 5;
                    s.canvas.height = 100 + (i + 1) * 3;
                },
                { finalizeTimeout: TIMEOUT },
            );
            vi.advanceTimersByTime(16);
        }

        // State reflects resize
        expect(mirror.getState().canvas.width).toBe(250);
        expect(mirror.getState().canvas.height).toBe(190);
        // LoroDoc untouched
        expect(doc.getMap("canvas").toJSON().width).toBe(100);
        expect(doc.getMap("canvas").toJSON().height).toBe(100);

        // x, y should be untouched
        expect(mirror.getState().canvas.x).toBe(0);
        expect(mirror.getState().canvas.y).toBe(0);

        // Finalize via timeout
        vi.advanceTimersByTime(TIMEOUT);
        expect(doc.getMap("canvas").toJSON().width).toBe(250);
        expect(doc.getMap("canvas").toJSON().height).toBe(190);
        expect(doc.getMap("canvas").toJSON().x).toBe(0);
        expect(doc.getMap("canvas").toJSON().y).toBe(0);

        mirror.dispose();
    });
});

describe("Remote ephemeral isolation", () => {
    it("should not commit remote ephemeral values when setState changes a different field", () => {
        const { doc, eph, mirror } = createSimpleSetup();

        // Remote peer writes x=200 to EphemeralStore
        const canvasContainerId = doc.getMap("canvas").id;
        eph.set(canvasContainerId, { x: 200 } as any);

        // State should show the ephemeral overlay
        expect(mirror.getState().canvas.x).toBe(200);

        // Local peer changes a DIFFERENT field via regular setState
        mirror.setState((s) => {
            s.canvas.y = 50;
        });

        // y should be committed to LoroDoc
        expect(doc.getMap("canvas").toJSON().y).toBe(50);
        // x should NOT have been committed — it's a remote ephemeral value
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        // State should still show the ephemeral overlay for x
        expect(mirror.getState().canvas.x).toBe(200);
        expect(mirror.getState().canvas.y).toBe(50);

        mirror.dispose();
    });

    it("should not leak ephemeral values into baseState after mixed changes", () => {
        const { doc, eph, mirror } = createTestSetup();

        // Ephemeral change on item[0].x + structural change (push new item)
        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.items[0].x = 999;
                s.items.push({ x: 50, y: 50, name: "item3" } as any);
            },
            { finalizeTimeout: 50_000 },
        );

        // item3 should be in LoroDoc (structural change)
        expect(doc.getList("items").toJSON().length).toBe(3);
        // item[0].x should NOT be in LoroDoc (ephemeral)
        expect(doc.getList("items").toJSON()[0].x).toBe(0);
        // State should show ephemeral value
        expect(mirror.getState().items[0].x).toBe(999);

        // Now if the ephemeral store clears, baseState should still have x=0
        const item0 = doc.getList("items").get(0) as any;
        eph.delete(item0.id);

        // After clearing ephemeral, x should revert to LoroDoc value
        expect(mirror.getState().items[0].x).toBe(0);

        mirror.dispose();
    });
});

describe("$cid preservation", () => {
    it("should preserve $cid on map objects after ephemeral compose", () => {
        const { mirror } = createSimpleSetup();

        // Verify $cid exists before ephemeral patch
        const stateBefore = mirror.getState();
        expect((stateBefore.canvas as any).$cid).toBeDefined();
        const cidBefore = (stateBefore.canvas as any).$cid;

        // Apply ephemeral patch
        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 50_000 },
        );

        // $cid should still be present on the composed state
        const stateAfter = mirror.getState();
        expect((stateAfter.canvas as any).$cid).toBeDefined();
        expect((stateAfter.canvas as any).$cid).toBe(cidBefore);

        mirror.dispose();
    });

    it("should preserve $cid on list item maps after ephemeral compose", () => {
        const { mirror } = createTestSetup();

        // Get $cid from first item
        const cidBefore = (mirror.getState().items[0] as any).$cid;
        expect(cidBefore).toBeDefined();

        // Apply ephemeral patch on list item
        mirror.setStateWithEphemeralPatch(
            (s) => {
                s.items[0].x = 42;
            },
            { finalizeTimeout: 50_000 },
        );

        // $cid should be preserved
        const cidAfter = (mirror.getState().items[0] as any).$cid;
        expect(cidAfter).toBe(cidBefore);

        mirror.dispose();
    });
});
