import { describe, it, expect, vi, afterEach } from "vitest";
import { DebounceTimer } from "../src/core/debounce-timer.js";

afterEach(() => {
    vi.useRealTimers();
});

describe("DebounceTimer", () => {
    it("fires callback after the specified delay", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();
        let fired = false;

        timer.schedule(() => { fired = true; }, 100);

        vi.advanceTimersByTime(99);
        expect(fired).toBe(false);

        vi.advanceTimersByTime(1);
        expect(fired).toBe(true);
    });

    it("uses default delay when none specified", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer(200);
        let fired = false;

        timer.schedule(() => { fired = true; });

        vi.advanceTimersByTime(199);
        expect(fired).toBe(false);

        vi.advanceTimersByTime(1);
        expect(fired).toBe(true);
    });

    it("postpones execution when schedule is called again before firing", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();
        let count = 0;

        timer.schedule(() => { count++; }, 100);

        // At t=80, push out the deadline by another 100ms → deadline = 180
        vi.advanceTimersByTime(80);
        timer.schedule(() => { count++; }, 100);

        // At t=100, original timer fires but deadline is at 180 → re-schedules
        vi.advanceTimersByTime(20);
        expect(count).toBe(0);

        // At t=180, re-scheduled timer fires, deadline reached → executes
        vi.advanceTimersByTime(80);
        expect(count).toBe(1);
    });

    it("does not create multiple timers on rapid schedule calls", () => {
        vi.useFakeTimers();
        const spy = vi.spyOn(globalThis, "setTimeout");
        const timer = new DebounceTimer();

        // Simulate 10 rapid calls
        for (let i = 0; i < 10; i++) {
            timer.schedule(() => {}, 100);
        }

        // Only 1 setTimeout should have been created (the first call)
        const callCount = spy.mock.calls.length;
        expect(callCount).toBe(1);

        spy.mockRestore();
    });

    it("updates the callback to the latest one", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();
        let result = "";

        timer.schedule(() => { result = "first"; }, 100);
        timer.schedule(() => { result = "second"; }, 100);

        vi.advanceTimersByTime(200);
        expect(result).toBe("second");
    });

    it("clear cancels pending execution", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();
        let fired = false;

        timer.schedule(() => { fired = true; }, 100);
        expect(timer.pending).toBe(true);

        timer.clear();
        expect(timer.pending).toBe(false);

        vi.advanceTimersByTime(200);
        expect(fired).toBe(false);
    });

    it("can be re-used after clear", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();
        let count = 0;

        timer.schedule(() => { count++; }, 100);
        timer.clear();

        timer.schedule(() => { count++; }, 50);
        vi.advanceTimersByTime(50);
        expect(count).toBe(1);
    });

    it("pending is false when no timer is scheduled", () => {
        const timer = new DebounceTimer();
        expect(timer.pending).toBe(false);
    });

    it("pending becomes false after callback fires", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();

        timer.schedule(() => {}, 100);
        expect(timer.pending).toBe(true);

        vi.advanceTimersByTime(100);
        expect(timer.pending).toBe(false);
    });

    it("handles multiple postponements correctly", () => {
        vi.useFakeTimers();
        const timer = new DebounceTimer();
        let fired = false;

        timer.schedule(() => { fired = true; }, 100);

        // Push out 5 times, each 50ms apart
        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(50);
            timer.schedule(() => { fired = true; }, 100);
        }

        // At this point we're at t=250, deadline is t=350
        expect(fired).toBe(false);

        vi.advanceTimersByTime(100);
        expect(fired).toBe(true);
    });
});
