import { describe, it, expect } from "vitest";
import { longestIncreasingSubsequence } from "../../src/core/diff";
import { Mirror, schema } from "../../src";
import { LoroDoc } from "loro-crdt";

describe("longestIncreasingSubsequence", () => {
    it("should return empty array for empty input", () => {
        expect(longestIncreasingSubsequence([])).toEqual([]);
    });

    it("should return the element itself for a single-element array", () => {
        expect(longestIncreasingSubsequence([5])).toEqual([0]);
    });

    it("should find LIS in a sorted array", () => {
        expect(longestIncreasingSubsequence([1, 2, 3, 4, 5])).toEqual([
            0, 1, 2, 3, 4,
        ]);
    });

    it("should find LIS in a reverse-sorted array", () => {
        const result = longestIncreasingSubsequence([5, 4, 3, 2, 1]);
        expect(result.length).toBe(1);
        expect([0, 1, 2, 3, 4]).toContain(result[0]);
    });

    it("should find LIS in a random array", () => {
        const sequence = [10, 22, 9, 33, 21, 50, 41, 60];
        const result = longestIncreasingSubsequence(sequence);

        const values = result.map((i) => sequence[i]);

        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThan(values[i - 1]);
        }
        // The LIS is [10, 22, 33, 50, 60] or [10, 22, 33, 41, 60]
        expect(result.length).toBe(5);
    });

    it("should handle sequences with duplicates", () => {
        const sequence = [1, 2, 2, 3, 1, 5];
        const result = longestIncreasingSubsequence(sequence);

        const values = result.map((i) => sequence[i]);

        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
        }

        // Should be length 4 (e.g., [1, 2, 3, 5])
        expect(result.length).toBe(4);
    });

    it("should handle arrays with all identical elements", () => {
        const result = longestIncreasingSubsequence([7, 7, 7, 7]);
        expect(result.length).toBe(1);
    });

    it("should find the correct indices for a known LIS", () => {
        const sequence = [3, 1, 8, 2, 5];
        const expected = [1, 3, 4];
        expect(longestIncreasingSubsequence(sequence)).toEqual(expected);
    });

    it("should handle non-consecutive increasing elements", () => {
        const sequence = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9];
        const result = longestIncreasingSubsequence(sequence);

        const values = result.map((i) => sequence[i]);

        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThan(values[i - 1]);
        }

        expect(result.length).toBe(4);
    });
});

describe("setState for LoroList", () => {
    it("with selector", () => {
        const withIdSchema = schema({
            items: schema.LoroList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                }),
                (item) => item.id,
            ),
        });
        const doc = new LoroDoc();
        const m = new Mirror({ doc, schema: withIdSchema });
        {
            const s = { items: [{ id: "123" }] };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        {
            const s = {
                items: [{ id: "0" }, { id: "1" }, { id: "2" }, { id: "123" }],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        {
            const s = {
                items: [{ id: "1" }, { id: "0" }, { id: "123" }, { id: "2" }],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        {
            const s = {
                items: [{ id: "1" }],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
    });

    it("without selector", () => {
        const s = schema({
            items: schema.LoroList(schema.Number()),
        });
        const doc = new LoroDoc();
        const m = new Mirror({ doc, schema: s });
        {
            const s = { items: [123] };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        let counter = doc.frontiers()[0].counter;
        expect(counter).toBe(0);

        {
            const s = {
                items: [0, 1, 123],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        counter = doc.frontiers()[0].counter;
        expect(counter).toBe(2);

        {
            const s = {
                items: [0, 1, 123, 5],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        counter = doc.frontiers()[0].counter;
        expect(counter).toBe(3);

        {
            const s = {
                items: [0, 1, 2, 123, 5],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        counter = doc.frontiers()[0].counter;
        expect(counter).toBe(4);

        {
            const s = {
                items: [2, 123, 5],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        counter = doc.frontiers()[0].counter;
        expect(counter).toBe(6);

        {
            const s = {
                items: [2, 5],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        counter = doc.frontiers()[0].counter;
        expect(counter).toBe(7);

        {
            const s = {
                items: [2],
            };
            m.setState(s);
            expect(doc.toJSON()).toStrictEqual(s);
        }
        counter = doc.frontiers()[0].counter;
        expect(counter).toBe(8);
    });
});
