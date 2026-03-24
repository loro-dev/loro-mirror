/**
 * Deadline-based debounce timer.
 *
 * Instead of clearing and re-creating a setTimeout on every call
 * (expensive at high frequency, e.g. 60fps mousemove), this pushes out
 * a `debounceUntil` deadline. The single running timer callback checks
 * whether the deadline has been reached:
 *   - If not, it re-schedules itself for the remaining time.
 *   - If so, it executes the callback.
 *
 * This means at most one `setTimeout` is live at any time, and
 * high-frequency `schedule()` calls only update a numeric field.
 */
export class DebounceTimer {
    private timer?: ReturnType<typeof setTimeout>;
    private callback?: () => void;
    private debounceUntil: number = 0;
    private defaultMs: number;

    constructor(defaultMs: number = 50_000) {
        this.defaultMs = defaultMs;
    }

    /**
     * Schedule (or postpone) the callback.
     * If a timer is already running, only the deadline is pushed out.
     */
    schedule(callback: () => void, ms?: number): void {
        const delay = ms ?? this.defaultMs;
        this.debounceUntil = Date.now() + delay;
        this.callback = callback;

        if (this.timer == null) {
            this.timer = setTimeout(() => this.onFired(), delay);
        }
    }

    /** Cancel any pending execution. */
    clear(): void {
        if (this.timer != null) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.callback = undefined;
        this.debounceUntil = 0;
    }

    /** Whether a timer is currently scheduled. */
    get pending(): boolean {
        return this.timer != null;
    }

    private onFired(): void {
        this.timer = undefined;
        const remaining = this.debounceUntil - Date.now();
        if (remaining > 0) {
            this.timer = setTimeout(() => this.onFired(), remaining);
        } else {
            const cb = this.callback;
            this.callback = undefined;
            cb?.();
        }
    }
}
