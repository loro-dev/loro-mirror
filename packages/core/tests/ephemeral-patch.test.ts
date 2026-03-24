import { Mirror, SyncDirection, UpdateMetadata } from "../src/core/mirror.js";
import { EphemeralPatchManager, PathResolverContext } from "../src/core/ephemeral.js";
import { schema } from "../src/schema/index.js";
import { LoroDoc, EphemeralStore, ContainerID, LoroMap, LoroList } from "loro-crdt";
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

describe("setState with ephemeral routing", () => {
    it("should update state immediately with ephemeral values", () => {
        const { mirror } = createSimpleSetup();

        mirror.setState(
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

        mirror.setState(
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

        mirror.setState(
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

    it("should write directly to LoroDoc when no ephemeralStore configured", () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
            doc,
            initialState: { canvas: { x: 0 } },
        });

        mirror.setState((s: any) => {
            s.canvas.x = 50;
        });
        expect((mirror.getState() as any).canvas.x).toBe(50);

        mirror.dispose();
    });

    it("should notify subscribers when ephemeral patch is set", () => {
        const { mirror } = createSimpleSetup();
        let metadata: UpdateMetadata | undefined;

        mirror.subscribe((_, m) => {
            metadata = m;
        });

        mirror.setState((s) => {
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
        mirror.setState((s) => {
            s.items.push({ x: 30, y: 40, name: "item3" } as any);
        });

        const docItems = doc.getList("items").toJSON();
        expect(docItems.length).toBe(3);

        mirror.dispose();
    });

    it("should route Map primitive value changes to EphemeralStore", () => {
        const { doc, eph, mirror } = createTestSetup();

        mirror.setState(
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

        mirror.setState(
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

        mirror.setState(
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

        mirror.setState(
            (s) => {
                s.canvas.x = 50;
            },
            { finalizeTimeout: 1000 },
        );

        vi.advanceTimersByTime(500);

        mirror.setState(
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

        mirror.setState(
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
        mirror.setState(
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

        mirror.setState(
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

describe("setState routes through ephemeral when ephemeralStore present", () => {
    it("should route eligible primitive changes to EphemeralStore, not LoroDoc", () => {
        const { doc, mirror } = createSimpleSetup();

        mirror.setState((s) => {
            s.canvas.x = 50;
        });

        // Visible in composed state
        expect(mirror.getState().canvas.x).toBe(50);
        // Not yet in LoroDoc
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        // After finalize, committed to LoroDoc
        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().x).toBe(50);

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
        mirror.setState(
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
            mirror.setState(
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
            mirror.setState(
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
            mirror.setState(
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
            mirror.setState(
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
            mirror.setState(
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
            mirror.setState(
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

        mirror.setState(
            (s) => { s.canvas.x = 10; },
            { finalizeTimeout: TIMEOUT },
        );

        // Advance 150ms (within timeout), make another call
        vi.advanceTimersByTime(150);
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        mirror.setState(
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
        mirror.setState((s) => {
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

        mirror.setState(
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

        mirror.setState(
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
            mirror.setState(
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

        // Local peer changes a DIFFERENT field via setState
        // (y=50 is also ephemeral-eligible, so it goes to EphemeralStore)
        mirror.setState((s) => {
            s.canvas.y = 50;
        });

        // Neither x nor y committed to LoroDoc yet (both in EphemeralStore)
        expect(doc.getMap("canvas").toJSON().y).toBe(0);
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        // State should show both ephemeral values
        expect(mirror.getState().canvas.x).toBe(200);
        expect(mirror.getState().canvas.y).toBe(50);

        // Finalize: only local writes (y) should commit; remote x=200 is skipped
        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().y).toBe(50);
        expect(doc.getMap("canvas").toJSON().x).toBe(0);

        mirror.dispose();
    });

    it("should not leak ephemeral values into baseState after mixed changes", () => {
        const { doc, eph, mirror } = createTestSetup();

        // Ephemeral change on item[0].x + structural change (push new item)
        mirror.setState(
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

describe("Ephemeral routing: only existing LoroMap key primitives go to Eph", () => {
    /**
     * Helper with a richer schema:
     *   settings: LoroMap { title: String, darkMode: Boolean, count: Number }
     *   items: LoroList(LoroMap { x: Number, y: Number, name: String })
     *   notes: LoroText
     */
    function createRichSetup() {
        const doc = new LoroDoc();
        const eph = new EphemeralStore();
        const testSchema = schema({
            settings: schema.LoroMap({
                title: schema.String({ defaultValue: "Docs" }),
                darkMode: schema.Boolean({ defaultValue: false }),
                count: schema.Number({ defaultValue: 0 }),
            }),
            items: schema.LoroList(
                schema.LoroMap({
                    x: schema.Number(),
                    y: schema.Number(),
                    name: schema.String(),
                }),
            ),
            notes: schema.LoroText(),
        });

        const mirror = new Mirror({
            doc,
            schema: testSchema,
            ephemeralStore: eph,
        });

        // Initialize LoroDoc with all values
        mirror.setState({
            settings: { title: "Docs", darkMode: false, count: 0 },
            items: [
                { x: 0, y: 0, name: "item1" },
                { x: 10, y: 20, name: "item2" },
            ],
            notes: "",
        } as any);

        return { doc, eph, mirror };
    }

    // --- Changes that MUST go to EphemeralStore ---

    it("number value change on existing Map key → Eph", () => {
        const { doc, eph, mirror } = createRichSetup();

        mirror.setState(
            (s) => { s.settings.count = 42; },
            { finalizeTimeout: 50_000 },
        );

        // State updated
        expect(mirror.getState().settings.count).toBe(42);
        // LoroDoc unchanged
        expect(doc.getMap("settings").toJSON().count).toBe(0);
        // EphemeralStore has it
        const allStates = eph.getAllStates();
        const settingsKey = Object.keys(allStates).find(k => {
            const p = allStates[k] as Record<string, unknown>;
            return p && "count" in p;
        });
        expect(settingsKey).toBeDefined();
        expect((allStates[settingsKey!] as Record<string, unknown>).count).toBe(42);

        mirror.dispose();
    });

    it("string value change on existing Map key → Eph", () => {
        const { doc, eph, mirror } = createRichSetup();

        mirror.setState(
            (s) => { s.settings.title = "New Title"; },
            { finalizeTimeout: 50_000 },
        );

        expect(mirror.getState().settings.title).toBe("New Title");
        expect(doc.getMap("settings").toJSON().title).toBe("Docs");

        const allStates = eph.getAllStates();
        const settingsKey = Object.keys(allStates).find(k => {
            const p = allStates[k] as Record<string, unknown>;
            return p && "title" in p;
        });
        expect(settingsKey).toBeDefined();

        mirror.dispose();
    });

    it("boolean value change on existing Map key → Eph", () => {
        const { doc, eph, mirror } = createRichSetup();

        mirror.setState(
            (s) => { s.settings.darkMode = true; },
            { finalizeTimeout: 50_000 },
        );

        expect(mirror.getState().settings.darkMode).toBe(true);
        expect(doc.getMap("settings").toJSON().darkMode).toBe(false);

        const allStates = eph.getAllStates();
        const settingsKey = Object.keys(allStates).find(k => {
            const p = allStates[k] as Record<string, unknown>;
            return p && "darkMode" in p;
        });
        expect(settingsKey).toBeDefined();

        mirror.dispose();
    });

    it("null value on existing Map key → Eph", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState(
            (s) => { (s.settings as any).title = null; },
            { finalizeTimeout: 50_000 },
        );

        expect(mirror.getState().settings.title).toBe(null);
        expect(doc.getMap("settings").toJSON().title).toBe("Docs");

        mirror.dispose();
    });

    it("primitive change on list item's existing Map key → Eph", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState(
            (s) => {
                s.items[0].x = 999;
                s.items[0].name = "moved";
                s.items[1].y = 888;
            },
            { finalizeTimeout: 50_000 },
        );

        expect(mirror.getState().items[0].x).toBe(999);
        expect(mirror.getState().items[0].name).toBe("moved");
        expect(mirror.getState().items[1].y).toBe(888);

        // LoroDoc untouched
        const docItems = doc.getList("items").toJSON();
        expect(docItems[0].x).toBe(0);
        expect(docItems[0].name).toBe("item1");
        expect(docItems[1].y).toBe(20);

        mirror.dispose();
    });

    // --- Changes that MUST go to LoroDoc ---

    it("push new item to list → LoroDoc", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState((s) => {
            s.items.push({ x: 50, y: 60, name: "newItem" } as any);
        });

        expect(doc.getList("items").toJSON().length).toBe(3);
        expect(doc.getList("items").toJSON()[2].name).toBe("newItem");

        mirror.dispose();
    });

    it("delete item from list → LoroDoc", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState((s) => {
            s.items.splice(0, 1);
        });

        expect(doc.getList("items").toJSON().length).toBe(1);
        expect(doc.getList("items").toJSON()[0].name).toBe("item2");

        mirror.dispose();
    });

    it("LoroText change → LoroDoc", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState((s) => {
            (s as any).notes = "Hello world";
        });

        expect(doc.getText("notes").toString()).toBe("Hello world");

        mirror.dispose();
    });

    // --- Mixed: some go to Eph, some to LoroDoc ---

    it("mixed: primitive on existing key → Eph, new list item → LoroDoc", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState(
            (s) => {
                s.items[0].x = 500;                             // → Eph
                s.items.push({ x: 0, y: 0, name: "new" } as any); // → LoroDoc
            },
            { finalizeTimeout: 50_000 },
        );

        // New item committed to LoroDoc
        expect(doc.getList("items").toJSON().length).toBe(3);
        // Existing key change NOT in LoroDoc
        expect(doc.getList("items").toJSON()[0].x).toBe(0);
        // State reflects both
        expect(mirror.getState().items[0].x).toBe(500);
        expect(mirror.getState().items.length).toBe(3);

        mirror.dispose();
    });

    it("mixed: multiple Map key changes → Eph, text change → LoroDoc", () => {
        const { doc, mirror } = createRichSetup();

        mirror.setState(
            (s) => {
                s.settings.count = 77;         // → Eph
                s.settings.darkMode = true;     // → Eph
                (s as any).notes = "Updated";   // → LoroDoc
            },
            { finalizeTimeout: 50_000 },
        );

        // Text committed to LoroDoc
        expect(doc.getText("notes").toString()).toBe("Updated");
        // Map values NOT in LoroDoc
        expect(doc.getMap("settings").toJSON().count).toBe(0);
        expect(doc.getMap("settings").toJSON().darkMode).toBe(false);
        // State shows all changes
        expect(mirror.getState().settings.count).toBe(77);
        expect(mirror.getState().settings.darkMode).toBe(true);
        expect(mirror.getState().notes).toBe("Updated");

        mirror.dispose();
    });
});

describe("finalizeEphemeralPatches flushes all pending to LoroDoc", () => {
    it("should flush all local ephemeral values to LoroDoc immediately", () => {
        const { doc, eph, mirror } = createSimpleSetup();

        // Multiple ephemeral patches
        mirror.setState(
            (s) => { s.canvas.x = 50; s.canvas.y = 75; },
            { finalizeTimeout: 50_000 },
        );
        mirror.setState(
            (s) => { s.canvas.width = 200; s.canvas.height = 150; },
            { finalizeTimeout: 50_000 },
        );

        // Nothing in LoroDoc yet
        const docBefore = doc.getMap("canvas").toJSON();
        expect(docBefore.x).toBe(0);
        expect(docBefore.width).toBe(100);

        // Flush
        mirror.finalizeEphemeralPatches();

        // All values now in LoroDoc
        const docAfter = doc.getMap("canvas").toJSON();
        expect(docAfter.x).toBe(50);
        expect(docAfter.y).toBe(75);
        expect(docAfter.width).toBe(200);
        expect(docAfter.height).toBe(150);

        // EphemeralStore should be empty for this container
        const canvasId = doc.getMap("canvas").id;
        expect(eph.get(canvasId)).toBeUndefined();

        // State still correct
        const state = mirror.getState();
        expect(state.canvas.x).toBe(50);
        expect(state.canvas.width).toBe(200);

        mirror.dispose();
    });

    it("should flush ephemeral values from multiple containers", () => {
        const { doc, eph, mirror } = createTestSetup();

        mirror.setState(
            (s) => {
                s.items[0].x = 100;
                s.items[0].y = 200;
                s.items[1].x = 300;
                s.items[1].y = 400;
            },
            { finalizeTimeout: 50_000 },
        );

        // LoroDoc untouched
        expect(doc.getList("items").toJSON()[0].x).toBe(0);
        expect(doc.getList("items").toJSON()[1].x).toBe(10);

        // Flush all at once
        mirror.finalizeEphemeralPatches();

        // All values committed
        expect(doc.getList("items").toJSON()[0].x).toBe(100);
        expect(doc.getList("items").toJSON()[0].y).toBe(200);
        expect(doc.getList("items").toJSON()[1].x).toBe(300);
        expect(doc.getList("items").toJSON()[1].y).toBe(400);

        mirror.dispose();
    });

    it("should be idempotent (second call is a no-op)", () => {
        const { doc, mirror } = createSimpleSetup();

        mirror.setState(
            (s) => { s.canvas.x = 42; },
            { finalizeTimeout: 50_000 },
        );

        mirror.finalizeEphemeralPatches();
        const versionAfterFirst = doc.oplogVersion().toJSON();

        // Second call should be a no-op
        mirror.finalizeEphemeralPatches();
        const versionAfterSecond = doc.oplogVersion().toJSON();

        expect(versionAfterFirst).toEqual(versionAfterSecond);
        expect(doc.getMap("canvas").toJSON().x).toBe(42);

        mirror.dispose();
    });

    it("after flush, subsequent ephemeral patches start clean", () => {
        const { doc, mirror } = createSimpleSetup();

        // First round of ephemeral patches
        mirror.setState(
            (s) => { s.canvas.x = 50; },
            { finalizeTimeout: 50_000 },
        );
        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().x).toBe(50);

        // Second round
        mirror.setState(
            (s) => { s.canvas.x = 100; },
            { finalizeTimeout: 50_000 },
        );

        // LoroDoc should still be at 50 (new patch not flushed yet)
        expect(doc.getMap("canvas").toJSON().x).toBe(50);
        // State shows latest
        expect(mirror.getState().canvas.x).toBe(100);

        mirror.finalizeEphemeralPatches();
        expect(doc.getMap("canvas").toJSON().x).toBe(100);

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
        mirror.setState(
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
        mirror.setState(
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

describe("EphemeralPatchManager edge cases", () => {
    function createManager() {
        const store = new EphemeralStore();
        const manager = new EphemeralPatchManager(store);
        return { store, manager };
    }

    function createDocWithMap() {
        const doc = new LoroDoc();
        const map = doc.getMap("root");
        map.set("x", 0);
        map.set("y", 0);
        doc.commit();
        return doc;
    }

    describe("isEligible edge cases", () => {
        it("should reject change with kind 'delete'", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            expect(manager.isEligible(
                { kind: "delete", container: mapId, key: "x", index: 0 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change with empty container", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();

            expect(manager.isEligible(
                { kind: "set", container: "", key: "x", value: 1 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change with no container", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();

            expect(manager.isEligible(
                { kind: "set", key: "x", value: 1 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change without a key property", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            expect(manager.isEligible(
                { kind: "set", container: mapId, value: 1 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change with numeric key", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            expect(manager.isEligible(
                { kind: "set", container: mapId, key: 0, value: 1 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change with object or array value", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            // object value
            expect(manager.isEligible(
                { kind: "set", container: mapId, key: "x", value: { nested: true } } as any,
                doc,
            )).toBe(false);

            // array value (also typeof "object")
            expect(manager.isEligible(
                { kind: "set", container: mapId, key: "x", value: [1, 2] } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change on a non-existent key", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            expect(manager.isEligible(
                { kind: "set", container: mapId, key: "nonexistent", value: 1 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change targeting a List container", () => {
            const { manager } = createManager();
            const doc = new LoroDoc();
            const list = doc.getList("myList");
            list.push(1);
            doc.commit();

            expect(manager.isEligible(
                { kind: "insert", container: list.id, key: "0", value: 99 } as any,
                doc,
            )).toBe(false);
        });

        it("should reject change with invalid container ID", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();

            expect(manager.isEligible(
                { kind: "set", container: "invalid:container:id" as ContainerID, key: "x", value: 1 } as any,
                doc,
            )).toBe(false);
        });

        it("should accept null value on existing key", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            expect(manager.isEligible(
                { kind: "set", container: mapId, key: "x", value: null } as any,
                doc,
            )).toBe(true);
        });

        it("should accept 'insert' kind on existing Map key", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            expect(manager.isEligible(
                { kind: "insert", container: mapId, key: "x", value: 42 } as any,
                doc,
            )).toBe(true);
        });
    });

    describe("compose edge cases", () => {
        it("should return base when store is empty", () => {
            const { manager } = createManager();
            const doc = new LoroDoc();
            const ctx: PathResolverContext = { doc };

            const base = { a: 1 };
            expect(manager.compose(base, ctx)).toBe(base); // same reference
        });

        it("should skip fields that are not objects in store", () => {
            const { store, manager } = createManager();
            const doc = new LoroDoc();
            const map = doc.getMap("root");
            map.set("x", 0);
            doc.commit();

            // Put a non-object "field" into the store
            store.set(map.id, null as any);

            const ctx: PathResolverContext = { doc };

            const base = { root: { x: 0 } };
            // Should not crash, just return base
            const result = manager.compose(base, ctx);
            expect(result).toBe(base);
        });

        it("should skip when path is not resolvable", () => {
            const { store, manager } = createManager();
            const doc = new LoroDoc();

            // Use a fake container ID that doesn't exist
            const fakeId = "cid:fake@0" as ContainerID;
            store.set(fakeId, { x: 100 } as any);

            const ctx: PathResolverContext = { doc };

            const base = { x: 0 };
            const result = manager.compose(base, ctx);
            expect(result).toBe(base); // unchanged
        });

        it("should skip when navigation hits a non-object value", () => {
            const { store, manager } = createManager();
            const doc = new LoroDoc();
            const map = doc.getMap("settings");
            const nested = map.setContainer("theme", new LoroMap());
            nested.set("color", "red");
            doc.commit();

            // Store a patch on the nested container
            store.set(nested.id, { color: "blue" } as any);

            const ctx: PathResolverContext = { doc };

            // Create a base where "settings" is a primitive (not an object), so navigation fails
            const base = { settings: "not-an-object" };
            const result = manager.compose(base, ctx);
            expect(result).toBe(base); // unchanged
        });

        it("should not clone when ephemeral values already match base", () => {
            const { store, manager } = createManager();
            const doc = new LoroDoc();
            const map = doc.getMap("root");
            map.set("x", 42);
            doc.commit();

            // Store a patch with the same value
            store.set(map.id, { x: 42 } as any);

            const ctx: PathResolverContext = { doc };

            const base = { root: { x: 42 } };
            const result = manager.compose(base, ctx);
            expect(result).toBe(base); // same reference — no clone needed
        });

        it("should handle array segments in path (list items via tree walk)", () => {
            const { store, manager } = createManager();
            const doc = new LoroDoc();
            const list = doc.getList("items");
            const itemMap = list.insertContainer(0, new LoroMap());
            itemMap.set("x", 0);
            doc.commit();

            store.set(itemMap.id, { x: 99 } as any);

            const ctx: PathResolverContext = { doc };

            const base = { items: [{ x: 0 }] };
            const result = manager.compose(base, ctx);
            expect(result.items[0].x).toBe(99);
            // Original unchanged
            expect(base.items[0].x).toBe(0);
        });
    });

    describe("finalize edge cases", () => {
        it("should return false when no local patches exist", () => {
            const { manager } = createManager();
            const doc = createDocWithMap();

            expect(manager.finalize(doc)).toBe(false);
        });

        it("should handle finalize when ephemeral store was externally cleared", () => {
            const { store, manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            // Write a change
            manager.writeChanges(
                [{ kind: "set", container: mapId, key: "x", value: 50 } as any],
            );

            // Externally clear the store (simulates remote overwrite or clear)
            store.delete(mapId);

            // Finalize — ephemeral value was cleared, so it should not commit
            const result = manager.finalize(doc);
            // x should still be 0
            expect(doc.getMap("root").toJSON().x).toBe(0);
            expect(result).toBe(false);
        });

        it("should preserve remaining keys when only some are finalized", () => {
            const { store, manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            // Write local change on x only
            manager.writeChanges(
                [{ kind: "set", container: mapId, key: "x", value: 50 } as any],
            );

            // Add a remote ephemeral value on y (not tracked as local)
            const currentPatch = store.get(mapId) as Record<string, unknown>;
            store.set(mapId, { ...currentPatch, y: 999 } as any);

            // Finalize
            manager.finalize(doc);

            // x was local, should be committed
            expect(doc.getMap("root").toJSON().x).toBe(50);
            // y was remote-only — should remain in EphemeralStore, NOT committed
            expect(doc.getMap("root").toJSON().y).toBe(0);
            // y should remain in the store
            const remaining = store.get(mapId) as Record<string, unknown>;
            expect(remaining).toBeDefined();
            expect(remaining.y).toBe(999);
        });
    });

    describe("resolvePath (via getPathToContainer)", () => {
        it("should resolve path for nested containers", () => {
            const doc = new LoroDoc();
            const store = new EphemeralStore();
            const manager = new EphemeralPatchManager(store);

            // Create a nested structure: root Map → "color" Map → {value: "red"}
            const root = doc.getMap("root");
            const colorMap = root.setContainer("color", new LoroMap());
            colorMap.set("value", "red");
            doc.commit();

            const ctx: PathResolverContext = { doc };

            // Write ephemeral change on the nested container
            store.set(colorMap.id, { value: "blue" } as any);

            const base = { root: { color: { value: "red" } } };
            const result = manager.compose(base, ctx);
            expect(result.root.color.value).toBe("blue");
        });

        it("should resolve path through List parent", () => {
            const doc = new LoroDoc();
            const store = new EphemeralStore();
            const manager = new EphemeralPatchManager(store);

            // Create: root list → item map { x: 0 }
            const list = doc.getList("items");
            const itemMap = list.insertContainer(0, new LoroMap());
            itemMap.set("x", 0);
            doc.commit();

            const ctx: PathResolverContext = { doc };

            store.set(itemMap.id, { x: 42 } as any);

            const base = { items: [{ x: 0 }] };
            const result = manager.compose(base, ctx);
            expect(result.items[0].x).toBe(42);
        });

        it("should return undefined for unknown container ID", () => {
            const doc = new LoroDoc();
            const store = new EphemeralStore();
            const manager = new EphemeralPatchManager(store);

            // Use a fake container ID that doesn't exist in the doc
            const fakeId = "cid:fake@0" as ContainerID;
            store.set(fakeId, { x: 99 } as any);

            const ctx: PathResolverContext = { doc };

            const base = { orphan: { x: 0 } };
            const result = manager.compose(base, ctx);
            // Should be unchanged since path can't be resolved
            expect(result).toBe(base);
        });
    });

    describe("subscribe", () => {
        it("should forward store subscription and return unsubscribe", () => {
            const { store, manager } = createManager();
            const doc = new LoroDoc();
            const map = doc.getMap("root");
            map.set("x", 0);
            doc.commit();

            let called = 0;
            const unsub = manager.subscribe(() => { called++; });

            store.set(map.id, { x: 1 } as any);
            expect(called).toBeGreaterThan(0);

            const prev = called;
            unsub();
            store.set(map.id, { x: 2 } as any);
            expect(called).toBe(prev);
        });
    });

    describe("scheduleFinalizeAfter and clearTimer", () => {
        afterEach(() => { vi.useRealTimers(); });

        it("should call callback after timeout", () => {
            vi.useFakeTimers();
            const { manager } = createManager();

            let finalized = false;
            manager.scheduleFinalizeAfter(100, () => { finalized = true; });

            vi.advanceTimersByTime(50);
            expect(finalized).toBe(false);
            vi.advanceTimersByTime(51);
            expect(finalized).toBe(true);
        });

        it("should reset timer on repeated calls", () => {
            vi.useFakeTimers();
            const { manager } = createManager();

            let count = 0;
            manager.scheduleFinalizeAfter(100, () => { count++; });
            vi.advanceTimersByTime(80);
            manager.scheduleFinalizeAfter(100, () => { count++; });
            vi.advanceTimersByTime(80);
            expect(count).toBe(0);
            vi.advanceTimersByTime(21);
            expect(count).toBe(1);
        });

        it("clearTimer should prevent callback", () => {
            vi.useFakeTimers();
            const { manager } = createManager();

            let called = false;
            manager.scheduleFinalizeAfter(100, () => { called = true; });
            manager.clearTimer();
            vi.advanceTimersByTime(200);
            expect(called).toBe(false);
        });
    });

    describe("dispose", () => {
        it("should clear all internal state", () => {
            vi.useFakeTimers();
            const { store, manager } = createManager();
            const doc = createDocWithMap();
            const mapId = doc.getMap("root").id;

            const ctx: PathResolverContext = { doc };

            let callbackFired = false;
            manager.writeChanges(
                [{ kind: "set", container: mapId, key: "x", value: 50 } as any],
            );
            manager.scheduleFinalizeAfter(100, () => { callbackFired = true; });

            expect(manager.hasLocalPatches).toBe(true);

            manager.dispose();

            expect(manager.hasLocalPatches).toBe(false);

            // Scheduled callback should not fire after dispose
            vi.advanceTimersByTime(200);
            expect(callbackFired).toBe(false);

            vi.useRealTimers();
        });
    });
});

describe("Regression: remote ephemeral not committed by unrelated local ephemeral", () => {
    it("should not finalize remote ephemeral values into LoroDoc", () => {
        const doc = new LoroDoc();
        const eph = new EphemeralStore();
        const testSchema = schema({
            items: schema.LoroList(
                schema.LoroMap({
                    x: schema.Number(),
                    y: schema.Number(),
                }),
            ),
        });

        const mirror = new Mirror({
            doc,
            schema: testSchema,
            ephemeralStore: eph,
        });

        // Initialize an item
        mirror.setState({ items: [{ x: 0, y: 0 }] } as never);
        const itemCid = mirror.getState().items[0].$cid;

        // Simulate a remote ephemeral write: x = 200
        const remoteEph = new EphemeralStore();
        remoteEph.set(itemCid, { x: 200 });
        const bytes = remoteEph.encodeAll();
        eph.apply(bytes);

        // State should now show x = 200 from remote ephemeral
        expect(mirror.getState().items[0].x).toBe(200);

        // Local ephemeral update only touches y
        mirror.setState((s) => {
            s.items[0].y = 100;
        });

        expect(mirror.getState().items[0].x).toBe(200);
        expect(mirror.getState().items[0].y).toBe(100);

        // Finalize — should NOT commit remote x=200 into LoroDoc
        mirror.finalizeEphemeralPatches();

        // Check LoroDoc directly
        const loroMap = doc.getList("items").get(0) as LoroMap;
        expect(loroMap.get("y")).toBe(100); // local was committed
        expect(loroMap.get("x")).toBe(0);   // remote was NOT committed
    });
});

describe("Regression: schema.Ignore() fields preserved with ephemeralStore", () => {
    it("should not drop Ignore fields on setState when ephemeralStore is set", () => {
        const doc = new LoroDoc();
        const eph = new EphemeralStore();
        // IgnoreSchemaType isn't in the ContainerSchemaType union at the type level,
        // but it works at runtime — use `as never` to bypass the type constraint.
        const testSchema = schema({
            name: schema.LoroText(),
            cache: schema.Ignore({ defaultValue: { hits: 42 } }) as never,
        });

        const mirror = new Mirror({
            doc,
            schema: testSchema,
            ephemeralStore: eph,
        });

        const state = mirror.getState() as Record<string, unknown>;
        expect(state.cache).toEqual({ hits: 42 });

        // Normal setState that doesn't touch cache
        mirror.setState({ name: "hello" } as never);

        // cache should still be preserved
        const updated = mirror.getState() as Record<string, unknown>;
        expect(updated.cache).toEqual({ hits: 42 });
    });

    it("should not drop Ignore fields during ephemeral updates", () => {
        const doc = new LoroDoc();
        const eph = new EphemeralStore();
        const testSchema = schema({
            items: schema.LoroList(
                schema.LoroMap({
                    x: schema.Number(),
                }),
            ),
            cache: schema.Ignore({ defaultValue: "important" }) as never,
        });

        const mirror = new Mirror({
            doc,
            schema: testSchema,
            ephemeralStore: eph,
        });

        // Add an item
        mirror.setState({ items: [{ x: 0 }] } as never);
        expect((mirror.getState() as Record<string, unknown>).cache).toBe("important");

        // Ephemeral update
        mirror.setState(((s: Record<string, unknown>) => {
            (s.items as Array<Record<string, unknown>>)[0].x = 50;
        }) as never);
        expect((mirror.getState() as Record<string, unknown>).cache).toBe("important");

        // Finalize
        mirror.finalizeEphemeralPatches();
        expect((mirror.getState() as Record<string, unknown>).cache).toBe("important");
    });
});
