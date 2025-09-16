import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
    type PointerEvent as ReactPointerEvent,
} from "react";

type PendingLongPress = {
    pointerId: number;
    cid: string;
    timer: number | null;
    startX: number;
    startY: number;
    lastClientY: number;
    target: HTMLElement | null;
};

export type ManualDragState = {
    cid: string;
    pointerId: number;
    offsetY: number;
    clientY: number;
    listTop: number;
    height: number;
};

type UseLongPressDragOptions = {
    listRef: RefObject<HTMLUListElement | null>;
    positions: { pos: Record<string, number>; height: number };
    itemHeights: Record<string, number>;
    defaultHeight: number;
    detached: boolean;
    onDragStart: (cid: string) => void;
    onDragEnd: () => void;
    onUpdateInsertIndex: (clientY: number) => void;
    onCommitDrop: () => void;
    shouldHandlePointerDown?: (
        cid: string,
        e: ReactPointerEvent<HTMLLIElement>,
    ) => boolean;
};

type UseLongPressDragResult = {
    manualDrag: ManualDragState | null;
    handlePointerDown: (cid: string, e: ReactPointerEvent<HTMLLIElement>) => void;
    handlePointerMove: (cid: string, e: ReactPointerEvent<HTMLLIElement>) => void;
    handlePointerUp: (cid: string, e: ReactPointerEvent<HTMLLIElement>) => void;
    handlePointerCancel: (cid: string, e: ReactPointerEvent<HTMLLIElement>) => void;
};

const LONG_PRESS_MS = 280;
const LONG_PRESS_MOVE_THRESHOLD = 6;

export function useLongPressDrag({
    listRef,
    positions,
    itemHeights,
    defaultHeight,
    detached,
    onDragStart,
    onDragEnd,
    onUpdateInsertIndex,
    onCommitDrop,
    shouldHandlePointerDown,
}: UseLongPressDragOptions): UseLongPressDragResult {
    const [manualDrag, setManualDrag] = useState<ManualDragState | null>(null);
    const pendingRef = useRef<PendingLongPress | null>(null);

    const clearPending = useCallback(() => {
        const pending = pendingRef.current;
        if (pending?.timer != null) {
            window.clearTimeout(pending.timer);
        }
        pendingRef.current = null;
    }, []);

    const beginManualDrag = useCallback(
        (pending: PendingLongPress) => {
            pendingRef.current = null;
            if (pending.timer != null) {
                window.clearTimeout(pending.timer);
            }
            const ul = listRef.current;
            if (!ul) return;
            const rect = ul.getBoundingClientRect();
            const cid = pending.cid;
            const pointerId = pending.pointerId;
            const baseY = positions.pos[cid] ?? 0;
            const clientY = pending.lastClientY;
            const offsetY = clientY - (rect.top + baseY);
            const height = itemHeights[cid] ?? defaultHeight;
            const active = document.activeElement;
            if (active && active instanceof HTMLElement) {
                active.blur();
            }
            try {
                pending.target?.setPointerCapture(pointerId);
            } catch {}
            onDragStart(cid);
            onUpdateInsertIndex(clientY);
            setManualDrag({
                cid,
                pointerId,
                offsetY,
                clientY,
                listTop: rect.top,
                height,
            });
        },
        [
            listRef,
            positions,
            itemHeights,
            defaultHeight,
            onDragStart,
            onUpdateInsertIndex,
        ],
    );

    useEffect(() => {
        return () => {
            clearPending();
        };
    }, [clearPending]);

    useEffect(() => {
        if (!manualDrag) return;
        const body = document.body;
        const previousBodyTouchAction = body.style.touchAction;
        const previousBodyUserSelect = body.style.userSelect;
        body.style.touchAction = "none";
        body.style.userSelect = "none";
        const list = listRef.current;
        const previousListTouchAction = list?.style.touchAction ?? null;
        if (list) {
            list.style.touchAction = "none";
        }
        return () => {
            body.style.touchAction = previousBodyTouchAction;
            body.style.userSelect = previousBodyUserSelect;
            if (list) {
                if (previousListTouchAction !== null) {
                    list.style.touchAction = previousListTouchAction;
                } else {
                    list.style.removeProperty("touch-action");
                }
            }
        };
    }, [manualDrag, listRef]);

    const handlePointerDown = useCallback(
        (cid: string, e: React.PointerEvent<HTMLLIElement>) => {
            if (detached) return;
            if (manualDrag) return;
            const allow = shouldHandlePointerDown
                ? shouldHandlePointerDown(cid, e)
                : true;
            if (!allow) {
                clearPending();
                return;
            }

            clearPending();
            const pointerId = e.pointerId;
            if (e.pointerType !== "touch") {
                if (e.cancelable) e.preventDefault();
                beginManualDrag({
                    pointerId,
                    cid,
                    timer: null,
                    startX: e.clientX,
                    startY: e.clientY,
                    lastClientY: e.clientY,
                    target: e.currentTarget,
                });
                return;
            }

            const timer = window.setTimeout(() => {
                const pending = pendingRef.current;
                if (!pending) return;
                if (pending.pointerId !== pointerId || pending.cid !== cid) return;
                beginManualDrag(pending);
            }, LONG_PRESS_MS);
            pendingRef.current = {
                pointerId,
                cid,
                timer,
                startX: e.clientX,
                startY: e.clientY,
                lastClientY: e.clientY,
                target: e.currentTarget,
            };
        },
        [
            detached,
            manualDrag,
            clearPending,
            beginManualDrag,
            shouldHandlePointerDown,
        ],
    );

    const handlePointerMove = useCallback(
        (cid: string, e: React.PointerEvent<HTMLLIElement>) => {
            const pointerId = e.pointerId;
            if (manualDrag && manualDrag.pointerId === pointerId && manualDrag.cid === cid) {
                if (e.cancelable) e.preventDefault();
                const clientY = e.clientY;
                setManualDrag((prev) => {
                    if (!prev || prev.pointerId !== pointerId) return prev;
                    if (prev.clientY === clientY) return prev;
                    return { ...prev, clientY };
                });
                onUpdateInsertIndex(clientY);
                return;
            }
            const pending = pendingRef.current;
            if (pending && pending.pointerId === pointerId && pending.cid === cid) {
                pending.lastClientY = e.clientY;
                const dx = e.clientX - pending.startX;
                const dy = e.clientY - pending.startY;
                if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) {
                    if (pending.timer != null) window.clearTimeout(pending.timer);
                    try {
                        pending.target?.releasePointerCapture(pointerId);
                    } catch {}
                    pendingRef.current = null;
                }
            }
        },
        [manualDrag, onUpdateInsertIndex],
    );

    const finalizeManualDrag = useCallback(
        (pointerId: number, cid: string | null, cancel: boolean) => {
            if (manualDrag && manualDrag.pointerId === pointerId) {
                setManualDrag(null);
                if (cancel) {
                    onDragEnd();
                } else {
                    onCommitDrop();
                }
                return true;
            }
            const pending = pendingRef.current;
            if (pending && pending.pointerId === pointerId && (!cid || pending.cid === cid)) {
                if (pending.timer != null) window.clearTimeout(pending.timer);
                pendingRef.current = null;
                return true;
            }
            return false;
        },
        [manualDrag, onCommitDrop, onDragEnd],
    );

    const handlePointerUp = useCallback(
        (cid: string, e: React.PointerEvent<HTMLLIElement>) => {
            const pointerId = e.pointerId;
            const handled = finalizeManualDrag(pointerId, cid, false);
            if (handled && e.cancelable) e.preventDefault();
            try {
                if (e.currentTarget.hasPointerCapture?.(pointerId)) {
                    e.currentTarget.releasePointerCapture(pointerId);
                }
            } catch {}
        },
        [finalizeManualDrag],
    );

    const handlePointerCancel = useCallback(
        (cid: string, e: React.PointerEvent<HTMLLIElement>) => {
            const pointerId = e.pointerId;
            const handled = finalizeManualDrag(pointerId, cid, true);
            if (handled && e.cancelable) e.preventDefault();
            try {
                if (e.currentTarget.hasPointerCapture?.(pointerId)) {
                    e.currentTarget.releasePointerCapture(pointerId);
                }
            } catch {}
        },
        [finalizeManualDrag],
    );

    useEffect(() => {
        if (!manualDrag) return;
        const pointerId = manualDrag.pointerId;
        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            if (manualDrag.cid) {
                const clientY = e.clientY;
                setManualDrag((prev) => {
                    if (!prev || prev.pointerId !== pointerId) return prev;
                    if (prev.clientY === clientY) return prev;
                    return { ...prev, clientY };
                });
                onUpdateInsertIndex(clientY);
            }
        };
        const onUp = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            finalizeManualDrag(pointerId, manualDrag.cid, false);
        };
        const onCancel = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            finalizeManualDrag(pointerId, manualDrag.cid, true);
        };
        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
        };
    }, [manualDrag, finalizeManualDrag, onUpdateInsertIndex]);

    return {
        manualDrag,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
    };
}
