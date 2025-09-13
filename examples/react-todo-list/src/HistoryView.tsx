import React from "react";
import type { LoroDoc, Change, VersionVector } from "loro-crdt";

type Props = {
    doc: LoroDoc;
};

function formatTs(ts?: number): string {
    if (!ts) return "Unknown";
    try {
        return new Date(ts * 1000).toLocaleString();
    } catch {
        return String(ts);
    }
}

export function HistoryView({ doc }: Props) {
    const [timestamps, setTimestamps] = React.useState<number[]>([]);
    const [value, setValue] = React.useState<number>(0);
    const [isLive, setIsLive] = React.useState<boolean>(!doc.isDetached());
    const [hoverTs, setHoverTs] = React.useState<number | undefined>(undefined);
    const isInternalRef = React.useRef(false);

    const collectTimestamps = React.useCallback(() => {
        const changes = doc.getAllChanges();
        const set = new Set<number>();
        for (const [, arr] of changes.entries()) {
            for (const c of arr as Change[]) {
                if (c.timestamp && c.timestamp > 0) set.add(c.timestamp);
            }
        }
        const list = Array.from(set.values()).sort((a, b) => a - b);
        return list;
    }, [doc]);

    const getFrontiersForTimestamp = React.useCallback(
        (ts: number) => {
            const changes = doc.getAllChanges();
            const frontiers: { peer: `${number}`, counter: number }[] = [];
            for (const [peer, arr] of changes.entries()) {
                let counter = -1;
                for (const c of arr as Change[]) {
                    if (!c.timestamp || c.timestamp <= ts) {
                        counter = Math.max(counter, c.counter + c.length - 1);
                    }
                }
                if (counter > -1) frontiers.push({ peer: peer as `${number}`, counter });
            }
            return frontiers;
        },
        [doc],
    );

    // Initialize and subscribe to updates
    React.useEffect(() => {
        const initTs = collectTimestamps();
        setTimestamps(initTs);
        setIsLive(!doc.isDetached());
        setValue(initTs.length ? initTs.length - 1 : 0);

        const unsub = doc.subscribe(() => {
            // Avoid double-setting while our own checkout triggers events
            if (isInternalRef.current) return;
            const ts = collectTimestamps();
            setTimestamps(ts);
            const live = !doc.isDetached();
            setIsLive(live);
            if (live) setValue(ts.length ? ts.length - 1 : 0);
        });
        return () => {
            unsub();
        };
    }, [collectTimestamps, doc]);

    const max = Math.max(0, timestamps.length - 1);
    const currentTs = timestamps[Math.min(value, max)];

    const onChange = (i: number) => {
        setValue(i);
        if (!timestamps.length) return;
        const atEnd = i >= timestamps.length - 1;
        isInternalRef.current = true;
        try {
            if (atEnd) {
                doc.checkoutToLatest();
                setIsLive(true);
            } else {
                const ts = timestamps[i];
                const frontiers = getFrontiersForTimestamp(ts);
                doc.checkout(frontiers);
                setIsLive(false);
            }
        } finally {
            // release flag on next tick to let subscribers settle
            setTimeout(() => (isInternalRef.current = false), 0);
        }
    };

    return (
        <div className="history card">
            <div className="history-header">
                <span className="history-title">History</span>
                <div className="history-meta">
                    <span className="history-count">{timestamps.length} versions</span>
                    <span className={`history-status ${isLive ? "live" : "detached"}`}>
                        {isLive ? "Live" : "Preview"}
                    </span>
                </div>
            </div>
            <div className="history-row">
                <input
                    className="history-slider"
                    type="range"
                    min={0}
                    max={max}
                    value={Math.min(value, max)}
                    onChange={(e) => onChange(Number(e.currentTarget.value))}
                    onMouseMove={(e) => {
                        const i = Number((e.target as HTMLInputElement).value);
                        setHoverTs(timestamps[i]);
                    }}
                    onMouseLeave={() => setHoverTs(undefined)}
                />
                <div className="history-timestamp">
                    {timestamps.length === 0
                        ? "No history"
                        : formatTs(hoverTs ?? currentTs)}
                </div>
            </div>
            {!isLive && (
                <div className="history-actions">
                    <button className="btn btn-secondary" onClick={() => onChange(max)}>
                        Return to latest
                    </button>
                </div>
            )}
        </div>
    );
}

export default HistoryView;
