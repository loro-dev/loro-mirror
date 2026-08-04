import { describe, it, expect } from "vitest";
import {
    deepEqual,
    getPathValue,
    setPathValue,
    isObject,
    cidsEqual,
    hardenCidDescriptors,
    stripUndefined,
    defineCidProperty,
} from "../src/core/utils.js";
import type { ContainerID } from "loro-crdt";
import { CID_KEY } from "../src/constants.js";

/**
 * `schema.Ignore()` fields hold arbitrary user objects, which may be cyclic. Every helper
 * that walks the state tree has to terminate on them instead of overflowing the stack.
 */
const makeCyclic = () => {
    const node: Record<string, unknown> = { name: "n" };
    node.self = node;
    return node;
};

describe("cyclic values in state (schema.Ignore payloads)", () => {
    it("stripUndefined leaves a cyclic subgraph alone", () => {
        const cyclic = makeCyclic();
        const state = { keep: 1, drop: undefined, ignored: cyclic };
        const result = stripUndefined(state) as Record<string, unknown>;
        expect(Object.keys(result)).toEqual(["keep", "ignored"]);
        expect(result.ignored).toBe(cyclic);
    });

    it("cidsEqual terminates on cyclic values", () => {
        const shared = makeCyclic();
        expect(cidsEqual({ ignored: shared }, { ignored: shared })).toBe(true);
        // Two structurally identical but distinct cyclic graphs.
        expect(cidsEqual({ ignored: makeCyclic() }, { ignored: makeCyclic() })).toBe(
            true,
        );
    });

    it("cidsEqual still reports a $cid mismatch below a cyclic value", () => {
        const a: Record<string, unknown> = { m: {}, ignored: makeCyclic() };
        const b: Record<string, unknown> = { m: {}, ignored: makeCyclic() };
        defineCidProperty(a.m, "cid:0@1:Map" as ContainerID);
        defineCidProperty(b.m, "cid:9@1:Map" as ContainerID);
        expect(cidsEqual(a, b)).toBe(false);
    });

    it("hardenCidDescriptors terminates on cyclic values and still re-locks", () => {
        const cyclic = makeCyclic();
        const item: Record<string, unknown> = { text: "t" };
        // Mimic Immer's strict shallow copy: preserved but no longer read-only.
        Object.defineProperty(item, CID_KEY, {
            value: "cid:0@1:Map",
            writable: true,
            enumerable: false,
            configurable: true,
        });

        hardenCidDescriptors({ item, ignored: cyclic }, undefined);

        expect(Object.getOwnPropertyDescriptor(item, CID_KEY)).toEqual({
            value: "cid:0@1:Map",
            writable: false,
            enumerable: false,
            configurable: false,
        });
    });
});

describe("stripUndefined", () => {
    it("returns the very same object when there is nothing to strip", () => {
        const child = { x: 1 };
        const state = { a: 1, b: "s", child, list: [1, 2] };
        // Mirror compares the result by reference to decide whether the state changed, so
        // an untouched tree has to come back identical all the way down.
        expect(stripUndefined(state)).toBe(state);
    });

    it("drops undefined keys while keeping the original key order", () => {
        const state = { a: 1, gone: undefined, b: 2, alsoGone: undefined, c: 3 };
        const result = stripUndefined(state) as Record<string, unknown>;
        expect(result).not.toBe(state);
        expect(Object.keys(result)).toEqual(["a", "b", "c"]);
        expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("rebuilds only the branches that changed", () => {
        const untouched = { deep: { x: 1 } };
        const dirty = { y: 2, gone: undefined };
        const state = { untouched, dirty };

        const result = stripUndefined(state) as Record<string, unknown>;

        expect(result).not.toBe(state);
        expect(result.untouched).toBe(untouched);
        expect(result.dirty).not.toBe(dirty);
        expect(Object.keys(result)).toEqual(["untouched", "dirty"]);
        expect(result.dirty).toEqual({ y: 2 });
    });

    it("keeps key order when a nested change forces a rebuild", () => {
        const state = { a: 1, nested: { keep: 1, gone: undefined }, z: 3 };
        const result = stripUndefined(state) as Record<string, unknown>;
        expect(Object.keys(result)).toEqual(["a", "nested", "z"]);
        expect(Object.keys(result.nested as object)).toEqual(["keep"]);
    });

    it("leaves undefined entries inside arrays alone", () => {
        const list = [1, undefined, 3];
        const state = { list };
        expect(stripUndefined(state)).toBe(state);
        expect(state.list).toEqual([1, undefined, 3]);
    });

    it("returns a new array only when one of its items changes", () => {
        const stable = { a: 1 };
        const dirty = { b: 2, gone: undefined };
        const list = [stable, dirty];

        const result = stripUndefined(list) as Record<string, unknown>[];

        expect(result).not.toBe(list);
        expect(result[0]).toBe(stable);
        expect(result[1]).toEqual({ b: 2 });
    });

    it("does not rebuild an object just because it carries an unsafe key", () => {
        const state = { safe: 1 } as Record<string, unknown>;
        Object.defineProperty(state, "__proto__", {
            value: { polluted: true },
            enumerable: true,
            writable: true,
            configurable: true,
        });
        // Unchanged behaviour: the unsafe key alone is not a reason to copy, so the
        // original object (unsafe key included) is handed back untouched.
        expect(stripUndefined(state)).toBe(state);
    });

    it("drops unsafe keys when the object is rebuilt for another reason", () => {
        const state = { safe: 1, gone: undefined } as Record<string, unknown>;
        Object.defineProperty(state, "__proto__", {
            value: { polluted: true },
            enumerable: true,
            writable: true,
            configurable: true,
        });

        const result = stripUndefined(state) as Record<string, unknown>;

        expect(Object.keys(result)).toEqual(["safe"]);
        expect(Object.getPrototypeOf(result)).toBe(null);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("carries $cid over to a rebuilt object, still non-enumerable and locked", () => {
        const state: Record<string, unknown> = { keep: 1, gone: undefined };
        defineCidProperty(state, "cid:0@1:Map" as ContainerID);

        const result = stripUndefined(state) as Record<string, unknown>;

        expect(result).not.toBe(state);
        expect(Object.keys(result)).toEqual(["keep"]);
        expect(Object.getOwnPropertyDescriptor(result, CID_KEY)).toEqual({
            value: "cid:0@1:Map",
            writable: false,
            enumerable: false,
            configurable: false,
        });
    });

    it("reads each property exactly once", () => {
        let reads = 0;
        const state = {} as Record<string, unknown>;
        // A `schema.Ignore()` field can hold any user object, accessors included. Reading
        // one twice would run its getter twice and could store an un-stripped value.
        Object.defineProperty(state, "accessor", {
            get() {
                reads++;
                return { nested: 1 };
            },
            enumerable: true,
            configurable: true,
        });
        state.gone = undefined;

        const result = stripUndefined(state) as Record<string, unknown>;

        expect(reads).toBe(1);
        expect(Object.keys(result)).toEqual(["accessor"]);
        expect(result.accessor).toEqual({ nested: 1 });
    });

    it("still strips below the cycle-guard depth", () => {
        const DEPTH = 100; // well past CYCLE_GUARD_DEPTH
        let leaf: Record<string, unknown> = { keep: 1, gone: undefined };
        const bottom = leaf;
        for (let i = 0; i < DEPTH; i++) leaf = { child: leaf };

        let result = stripUndefined(leaf) as Record<string, unknown>;
        expect(result).not.toBe(leaf);
        for (let i = 0; i < DEPTH; i++) {
            result = result.child as Record<string, unknown>;
        }
        expect(result).not.toBe(bottom);
        expect(Object.keys(result)).toEqual(["keep"]);
    });
});

describe("Utility Functions", () => {
    describe("isObject", () => {
        it("should return true for objects", () => {
            expect(isObject({})).toBe(true);
            expect(isObject({ a: 1 })).toBe(true);
            expect(isObject(new Object())).toBe(true);
        });

        it("should return false for non-objects", () => {
            expect(isObject(null)).toBe(false);
            expect(isObject(undefined)).toBe(false);
            expect(isObject(42)).toBe(false);
            expect(isObject("string")).toBe(false);
            expect(isObject(true)).toBe(false);
            expect(isObject([])).toBe(false);
            expect(isObject(new Date())).toBe(false);
            expect(isObject(() => {})).toBe(false);
        });
    });

    describe("deepEqual", () => {
        it("should return true for identical primitive values", () => {
            expect(deepEqual(42, 42)).toBe(true);
            expect(deepEqual("hello", "hello")).toBe(true);
            expect(deepEqual(true, true)).toBe(true);
            expect(deepEqual(null, null)).toBe(true);
            expect(deepEqual(undefined, undefined)).toBe(true);
        });

        it("should return false for different primitive values", () => {
            expect(deepEqual(42, 43)).toBe(false);
            expect(deepEqual("hello", "world")).toBe(false);
            expect(deepEqual(true, false)).toBe(false);
            expect(deepEqual(null, undefined)).toBe(false);
            expect(deepEqual(0, null)).toBe(false);
        });

        it("should return true for identical simple objects", () => {
            expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
            expect(deepEqual({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true); // Order doesn't matter
        });

        it("should return false for different simple objects", () => {
            expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
            expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
            expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        });

        it("should return true for identical arrays", () => {
            expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        });

        it("should return false for different arrays", () => {
            expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
            expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
            expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
        });

        it("should handle nested objects and arrays", () => {
            expect(
                deepEqual(
                    { a: 1, b: { c: 3, d: [4, 5] } },
                    { a: 1, b: { c: 3, d: [4, 5] } },
                ),
            ).toBe(true);

            expect(
                deepEqual(
                    { a: 1, b: { c: 3, d: [4, 5] } },
                    { a: 1, b: { c: 3, d: [4, 6] } },
                ),
            ).toBe(false);
        });
    });

    describe("getPathValue", () => {
        const testObj = {
            a: 1,
            b: {
                c: 2,
                d: [3, 4, 5],
                e: {
                    f: 6,
                },
            },
        };

        it("should return the value at a simple path", () => {
            expect(getPathValue(testObj, ["a"])).toBe(1);
        });

        it("should return the value at a nested path", () => {
            expect(getPathValue(testObj, ["b", "c"])).toBe(2);
            expect(getPathValue(testObj, ["b", "e", "f"])).toBe(6);
        });

        it("should return the value from an array", () => {
            expect(getPathValue(testObj, ["b", "d", "1"])).toBe(4);
        });

        it("should return undefined for non-existent paths", () => {
            expect(getPathValue(testObj, ["x"])).toBeUndefined();
            expect(getPathValue(testObj, ["b", "x"])).toBeUndefined();
            expect(getPathValue(testObj, ["b", "d", "10"])).toBeUndefined();
        });

        it("should handle empty path", () => {
            expect(getPathValue(testObj, [])).toBe(testObj);
        });
    });

    describe("setPathValue", () => {
        it("should set a value at a simple path", () => {
            const obj = { a: 1 };
            setPathValue(obj, ["b"], 2);
            expect(obj).toEqual({ a: 1, b: 2 });
        });

        it("should update a value at an existing path", () => {
            const obj = { a: 1, b: 2 };
            setPathValue(obj, ["b"], 3);
            expect(obj).toEqual({ a: 1, b: 3 });
        });

        it("should set a value at a nested path", () => {
            const obj = { a: 1 };
            setPathValue(obj, ["b", "c"], 2);
            expect(obj).toEqual({ a: 1, b: { c: 2 } });
        });

        it("should update a value at an existing nested path", () => {
            const obj = { a: 1, b: { c: 2 } };
            setPathValue(obj, ["b", "c"], 3);
            expect(obj).toEqual({ a: 1, b: { c: 3 } });
        });

        it("should set a value in an array", () => {
            const obj = { a: [1, 2, 3] };
            setPathValue(obj, ["a", "1"], 4);
            expect(obj).toEqual({ a: [1, 4, 3] });
        });

        it("should handle creating intermediate objects", () => {
            const obj = {};
            setPathValue(obj, ["a", "b", "c"], 1);
            expect(obj).toEqual({ a: { b: { c: 1 } } });
        });

        it("should handle empty path by returning the original object", () => {
            const obj = { a: 1 };
            setPathValue(obj, [], { b: 2 });
            expect(obj).toEqual({ a: 1 });
        });
    });
});
