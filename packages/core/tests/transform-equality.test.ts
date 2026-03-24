import { describe, expect, it, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { valuesEqual } from "../src/core/utils.js";
import { schema } from "../src/schema/index.js";

/**
 * Tests for the `isEqual` equality strategy on transforms.
 *
 * The `isEqual` setting controls how domain values are compared:
 * - "reference-equality" (default): Same ref = equal, different ref = not equal (no encoding for comparison)
 * - "encoded-value-equality": Same ref = equal, different ref = encode both and compare
 * - Custom function: Your own comparison logic
 *
 * Reference equality (===) is ALWAYS checked first as an optimization.
 */
describe("Transform Equality Strategy", () => {
    describe("reference-equality (default)", () => {
        it("skips when same reference", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const spiedTransform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                // isEqual defaults to "reference-equality"
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(spiedTransform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });
            const testDate = new Date("2025-01-19T10:00:00.000Z");

            // First setState - should encode
            mirror.setState({ record: { date: testDate } });
            const encodeCountAfterFirst = encodeSpy.mock.calls.length;
            expect(encodeCountAfterFirst).toBeGreaterThan(0);

            // Second setState with SAME reference - should skip
            mirror.setState({ record: { date: testDate } });
            const encodeCountAfterSecond = encodeSpy.mock.calls.length;

            // Should not have called encode again (reference equality)
            expect(encodeCountAfterSecond).toBe(encodeCountAfterFirst);
        });

        it("treats different references as not equal", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const spiedTransform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                isEqual: "reference-equality" as const,
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(spiedTransform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            // First setState
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const encodeCountAfterFirst = encodeSpy.mock.calls.length;

            // Second setState with DIFFERENT reference (same value)
            // With reference-equality, different ref = not equal, so update happens
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const encodeCountAfterSecond = encodeSpy.mock.calls.length;

            // Should encode for the update (different reference = not equal)
            expect(encodeCountAfterSecond).toBeGreaterThan(encodeCountAfterFirst);

            // Also verify truly different value triggers update and stores correctly
            const date2 = new Date("2025-12-31T23:59:59.000Z");
            mirror.setState({ record: { date: date2 } });
            const encodeCountAfterThird = encodeSpy.mock.calls.length;
            expect(encodeCountAfterThird).toBeGreaterThan(encodeCountAfterSecond);

            const state = mirror.getState();
            expect(state.record.date!.getTime()).toBe(date2.getTime());
        });

        it("works correctly in lists", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const spiedTransform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                // isEqual defaults to "reference-equality"
            };

            const testSchema = schema({
                dates: schema.LoroList(schema.String().transform(spiedTransform)),
            });

            const mirror = new Mirror({ doc, schema: testSchema });
            const date1 = new Date("2025-01-01T00:00:00.000Z");
            const date2 = new Date("2025-06-01T00:00:00.000Z");

            // First setState
            mirror.setState({ dates: [date1, date2] });
            const encodeCountAfterFirst = encodeSpy.mock.calls.length;

            // Second setState with same references
            mirror.setState({ dates: [date1, date2] });
            const encodeCountAfterSecond = encodeSpy.mock.calls.length;

            // Should not encode again (same references)
            expect(encodeCountAfterSecond).toBe(encodeCountAfterFirst);
        });
    });

    describe("encoded-value-equality", () => {
        it("encodes for comparison when references differ", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const transform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                isEqual: "encoded-value-equality" as const,
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(transform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            // First setState with one Date object
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const countAfterFirst = encodeSpy.mock.calls.length;

            // Second setState with a DIFFERENT Date object (same value)
            // With encoded-value-equality, both are encoded for comparison
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const countAfterSecond = encodeSpy.mock.calls.length;

            // Should encode for comparison (even though values are equal)
            expect(countAfterSecond).toBeGreaterThan(countAfterFirst);

            // Also verify truly different value triggers update
            mirror.setState({
                record: { date: new Date("2026-06-15T12:00:00.000Z") },
            });

            const state = mirror.getState();
            expect(state.record.date!.getFullYear()).toBe(2026);
            expect(state.record.date!.getMonth()).toBe(5); // June is month 5
        });

        it("works correctly in lists with different objects", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const transform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                isEqual: "encoded-value-equality" as const,
            };

            const testSchema = schema({
                dates: schema.LoroList(schema.String().transform(transform)),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            // First setState
            mirror.setState({
                dates: [
                    new Date("2025-01-01T00:00:00.000Z"),
                    new Date("2025-06-01T00:00:00.000Z"),
                ],
            });
            const countAfterFirst = encodeSpy.mock.calls.length;

            // Second setState with different objects (same values)
            mirror.setState({
                dates: [
                    new Date("2025-01-01T00:00:00.000Z"),
                    new Date("2025-06-01T00:00:00.000Z"),
                ],
            });
            const countAfterSecond = encodeSpy.mock.calls.length;

            // Should encode for comparison
            expect(countAfterSecond).toBeGreaterThan(countAfterFirst);
        });

        it("treats null and undefined as different values", () => {
            const fieldSchema = schema
                .String({ required: false })
                .transform({
                    decode: (s: string) => new Date(s),
                    encode: (d: Date) => d.toISOString(),
                    isEqual: "encoded-value-equality" as const,
                });

            expect(
                valuesEqual(fieldSchema, null, undefined, "reference-equality"),
            ).toBe(false);
        });
    });

    describe("deep-equality", () => {
        it("skips update when different references have equal value", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const transform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                isEqual: "deep-equality" as const,
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(transform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            // First setState
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const countAfterFirst = encodeSpy.mock.calls.length;

            // Second setState with DIFFERENT reference (same value)
            // deep-equality compares via deepEqual (handles Date.getTime()),
            // so it should detect they are equal and skip the update.
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const countAfterSecond = encodeSpy.mock.calls.length;

            // Should NOT encode again — deepEqual recognizes same value
            expect(countAfterSecond).toBe(countAfterFirst);
        });

        it("detects change when values truly differ", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const transform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                isEqual: "deep-equality" as const,
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(transform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });
            const countAfterFirst = encodeSpy.mock.calls.length;

            // Different value — should trigger update
            mirror.setState({
                record: { date: new Date("2026-06-15T12:00:00.000Z") },
            });
            const countAfterSecond = encodeSpy.mock.calls.length;

            expect(countAfterSecond).toBeGreaterThan(countAfterFirst);

            const state = mirror.getState();
            expect(state.record.date!.getFullYear()).toBe(2026);
        });

        it("works in lists", () => {
            const doc = new LoroDoc();
            const encodeSpy = vi.fn((d: Date) => d.toISOString());

            const transform = {
                decode: (s: string) => new Date(s),
                encode: encodeSpy,
                isEqual: "deep-equality" as const,
            };

            const testSchema = schema({
                dates: schema.LoroList(schema.String().transform(transform)),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            mirror.setState({
                dates: [
                    new Date("2025-01-01T00:00:00.000Z"),
                    new Date("2025-06-01T00:00:00.000Z"),
                ],
            });
            const countAfterFirst = encodeSpy.mock.calls.length;

            // Same values, different references
            mirror.setState({
                dates: [
                    new Date("2025-01-01T00:00:00.000Z"),
                    new Date("2025-06-01T00:00:00.000Z"),
                ],
            });
            const countAfterSecond = encodeSpy.mock.calls.length;

            // deep-equality should detect same values without encoding
            expect(countAfterSecond).toBe(countAfterFirst);
        });
    });

    describe("custom equality function", () => {
        it("uses custom function when provided", () => {
            const doc = new LoroDoc();
            const customEqualSpy = vi.fn((a: Date, b: Date) => a.getTime() === b.getTime());

            const transform = {
                decode: (s: string) => new Date(s),
                encode: (d: Date) => d.toISOString(),
                isEqual: customEqualSpy,
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(transform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            // First setState
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });

            // Second setState with different object (same value)
            mirror.setState({
                record: { date: new Date("2025-01-19T10:00:00.000Z") },
            });

            // Custom function should have been called
            expect(customEqualSpy).toHaveBeenCalled();
        });

        it("receives domain values (not encoded)", () => {
            const doc = new LoroDoc();
            let receivedValues: [unknown, unknown] | null = null;

            const transform = {
                decode: (s: string) => new Date(s),
                encode: (d: Date) => d.toISOString(),
                isEqual: (a: Date, b: Date) => {
                    receivedValues = [a, b];
                    return a.getTime() === b.getTime();
                },
            };

            const testSchema = schema({
                record: schema.LoroMap({
                    date: schema.String().transform(transform),
                }),
            });

            const mirror = new Mirror({ doc, schema: testSchema });

            const date1 = new Date("2025-01-19T10:00:00.000Z");
            mirror.setState({ record: { date: date1 } });

            const date2 = new Date("2025-06-15T12:00:00.000Z");
            mirror.setState({ record: { date: date2 } });

            // Custom function should receive Date objects, not strings
            expect(receivedValues).not.toBeNull();
            expect(receivedValues![0]).toBeInstanceOf(Date);
            expect(receivedValues![1]).toBeInstanceOf(Date);
        });
    });
});
