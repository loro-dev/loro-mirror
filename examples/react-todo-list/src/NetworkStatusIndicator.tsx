import React, { useMemo } from "react";
import type { ClientStatusValue } from "loro-websocket";

const DOT_COLORS = [
    "var(--brand)",
    "color-mix(in oklab, var(--brand) 80%, #ffffff)",
    "color-mix(in oklab, var(--brand) 65%, #ffffff)",
    "color-mix(in oklab, var(--brand) 50%, #ffffff)",
    "var(--crimson)",
    "var(--secondary)",
    "var(--burnt)",
    "var(--golden)",
];

export type NetworkStatusIndicatorProps = {
    connectionStatus: ClientStatusValue;
    presenceCount: number;
    presencePeers: string[];
    latencyMs: number | null;
    onRequestToast: (message: string | null) => void;
};

function capitalize(value: string): string {
    if (value.length === 0) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export function NetworkStatusIndicator({
    connectionStatus,
    presenceCount,
    presencePeers,
    latencyMs,
    onRequestToast,
}: NetworkStatusIndicatorProps) {
    const statusDescription = useMemo(() => {
        switch (connectionStatus) {
            case "connected":
                return presenceCount > 1
                    ? `connected with ${presenceCount - 1} collaborators`
                    : "connected";
            case "connecting":
                return "connecting…";
            default:
                return "disconnected";
        }
    }, [connectionStatus, presenceCount]);

    const statusLabel = useMemo(() => capitalize(statusDescription), [statusDescription]);

    const latencyDisplay = useMemo(() => {
        if (connectionStatus !== "connected") return null;
        if (latencyMs == null) return "-- ms";
        const rounded = Math.max(0, Math.round(latencyMs));
        return `${rounded} ms`;
    }, [connectionStatus, latencyMs]);

    const statusToastMessage = useMemo(() => {
        if (latencyDisplay) {
            return `${statusLabel} · ${latencyDisplay} latency`;
        }
        return statusLabel;
    }, [latencyDisplay, statusLabel]);

    const statusIndicatorColor = useMemo(() => {
        switch (connectionStatus) {
            case "disconnected":
                return "#c0392b";
            case "connecting":
                return "var(--golden)";
            default:
                return "var(--muted)";
        }
    }, [connectionStatus]);

    const handleActivate = () => {
        onRequestToast(statusToastMessage);
    };

    return (
        <span
            className="status-inline"
            title={statusToastMessage}
            aria-live="polite"
            aria-label={statusToastMessage}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleActivate();
                }
            }}
            onClick={() => {
                handleActivate();
            }}
            style={{
                display: "inline-flex",
                alignItems: "center",
                cursor: "pointer",
                userSelect: "none",
            }}
        >
            {connectionStatus === "connected" ? (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        marginLeft: 8,
                    }}
                >
                    {(() => {
                        const dots = presencePeers.slice(0, 8).map((_, index) => (
                            <span
                                key={index}
                                aria-hidden
                                style={{
                                    marginLeft: index === 0 ? 0 : -4,
                                    color: DOT_COLORS[index % DOT_COLORS.length],
                                }}
                            >
                                ●
                            </span>
                        ));
                        const safeDots =
                            dots.length > 0 ? (
                                dots
                            ) : (
                                <span aria-hidden style={{ color: "#29c329" }}>
                                    ●
                                </span>
                            );
                        return (
                            <>
                                {safeDots}
                                {presenceCount !== 1 && (
                                    <span
                                        style={{
                                            marginLeft: 6,
                                            fontSize: "0.8rem",
                                            lineHeight: 1,
                                            color: "var(--muted)",
                                        }}
                                    >
                                        {presenceCount}
                                    </span>
                                )}
                            </>
                        );
                    })()}
                </span>
            ) : (
                <span
                    aria-hidden
                    style={{ color: statusIndicatorColor, marginLeft: 8 }}
                >
                    ○
                </span>
            )}
        </span>
    );
}
