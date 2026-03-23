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
