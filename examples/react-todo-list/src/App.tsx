import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    SVGProps,
} from "react";
import { useLoroStore } from "loro-mirror-react";
import { HistoryView } from "./HistoryView";
import {
    createConfiguredDoc,
    createUndoManager,
    todoSchema,
    initialTodoState,
    setupPublicSync,
    openDocDb,
    putDocSnapshot,
    getDocSnapshot,
    upsertWorkspace,
    getWorkspace,
    listWorkspaces,
    deleteWorkspace,
    switchToWorkspace,
    createNewWorkspace,
    type WorkspaceRecord,
    type TodoStatus,
} from "./loro-state";

// --------------------
// Public Sync constants
// --------------------
// Sync constants moved to loro-state.ts

// --------------------
// Encoding helpers
// --------------------
// Crypto and encoding helpers moved to loro-state.ts

// IndexedDB persistence helpers moved to loro-state.ts

export function MaterialSymbolsKeyboardArrowDown(
    props: SVGProps<SVGSVGElement>,
) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            {...props}
        >
            {/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}
            <path
                fill="currentColor"
                d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z"
            />
        </svg>
    );
}

export function MdiGithub(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            {...props}
        >
            {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
            <path
                fill="currentColor"
                d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
            />
        </svg>
    );
}

export function MdiBroom(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            {...props}
        >
            {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
            <path
                fill="currentColor"
                d="m19.36 2.72l1.42 1.42l-5.72 5.71c1.07 1.54 1.22 3.39.32 4.59L9.06 8.12c1.2-.9 3.05-.75 4.59.32zM5.93 17.57c-2.01-2.01-3.24-4.41-3.58-6.65l4.88-2.09l7.44 7.44l-2.09 4.88c-2.24-.34-4.64-1.57-6.65-3.58"
            />
        </svg>
    );
}

// Lucide Undo2 icon for undo/redo buttons
// Icon from Lucide by Lucide Contributors - https://github.com/lucide-icons/lucide/blob/main/LICENSE
export function LucideUndo2(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            {...props}
        >
            <g
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
            >
                <path d="M9 14L4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
            </g>
        </svg>
    );
}

export function IcSharpHistory(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            {...props}
        >
            {/* Icon from Google Material Icons by Material Design Authors - https://github.com/material-icons/material-icons/blob/master/LICENSE */}
            <path
                fill="currentColor"
                d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89l.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7s-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18m-1 5v5l4.25 2.52l.77-1.29l-3.52-2.09V8z"
            />
        </svg>
    );
}

export function StreamlinePlumpRecycleBin2Remix(
    props: SVGProps<SVGSVGElement>,
) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 48 48"
            {...props}
        >
            {/* Icon from Plump free icons by Streamline - https://creativecommons.org/licenses/by/4.0/ */}
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M15.864 5.595a9.045 9.045 0 0 1 16.273 0c3.586.085 6.359.209 8.052.298c1.421.074 2.963.687 3.77 2.14a9.7 9.7 0 0 1 .954 2.461c.065.274.087.541.087.788c0 1.44-.801 2.722-2.024 3.345a659 659 0 0 1-.714 25.01c-.185 3.856-3.142 7.025-7.042 7.351c-3.036.254-7.12.512-11.22.512c-4.099 0-8.184-.258-11.22-.512c-3.9-.326-6.857-3.495-7.042-7.352a659 659 0 0 1-.715-25.009A3.74 3.74 0 0 1 3 11.282c0-.247.022-.514.087-.788c.23-.98.593-1.809.955-2.46c.806-1.454 2.348-2.067 3.77-2.142a283 283 0 0 1 8.052-.297m-6.835 9.58c.102 10.208.454 19.062.704 24.27c.092 1.904 1.531 3.403 3.38 3.557c2.976.25 6.94.498 10.888.498s7.91-.249 10.886-.498c1.849-.154 3.288-1.653 3.38-3.558c.25-5.207.602-14.061.704-24.27c-3.23.167-8.106.326-14.97.326s-11.741-.159-14.972-.326m10.97 6.262a2 2 0 1 0-3.998.125l.5 16a2 2 0 1 0 3.998-.124zM30.063 19.5A2 2 0 0 0 28 21.438l-.5 16a2 2 0 1 0 3.998.124l.5-16a2 2 0 0 0-1.936-2.061"
                clipRule="evenodd"
            />
        </svg>
    );
}

// IDB helpers are imported from loro-state.ts

// Schema/types are imported from loro-state.ts

export function App() {
    const [routeEpoch, setRouteEpoch] = useState<number>(0);
    const doc = useMemo(() => createConfiguredDoc(), [routeEpoch]);
    (window as unknown as { doc?: unknown }).doc = doc;
    const undo = useMemo(() => createUndoManager(doc), [doc]);

    const { state, setState } = useLoroStore({
        doc,
        schema: todoSchema,
        initialState: initialTodoState,
    });

    const [newText, setNewText] = useState<string>("");
    const [dragCid, setDragCid] = useState<string | null>(null);
    const [insertIndex, setInsertIndex] = useState<number | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);
    const [detached, setDetached] = useState<boolean>(doc.isDetached());
    const [showHistory, setShowHistory] = useState<boolean>(false);
    const [online, setOnline] = useState<boolean>(false);
    const [workspaceHex, setWorkspaceHex] = useState<string>("");
    const [shareUrl, setShareUrl] = useState<string>("");
    const [toast, setToast] = useState<string | null>(null);
    const toastTimerRef = useRef<number | undefined>(undefined);
    const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
    const [workspaceTitle, setWorkspaceTitle] =
        useState<string>("Untitled Workspace");
    const wsDebounceRef = useRef<number | undefined>(undefined);
    const [showWsMenu, setShowWsMenu] = useState<boolean>(false);
    const wsTitleRef = useRef<HTMLDivElement | null>(null);
    const wsTitleInputRef = useRef<HTMLInputElement | null>(null);
    const wsMeasureRef = useRef<HTMLSpanElement | null>(null);
    const wsMenuRef = useRef<HTMLDivElement | null>(null);
    const hasDone = useMemo(
        () => state.todos.some((t) => t.status === "done"),
        [state.todos],
    );

    // Public Sync setup moved into loro-state.ts
    useEffect(() => {
        let mounted = true;
        let cleanup: void | (() => void | Promise<void>);
        (async () => {
            const c = await setupPublicSync(doc, {
                setDetached,
                setOnline,
                setWorkspaceHex,
                setShareUrl,
                setWorkspaces,
            });
            if (!mounted) {
                if (c) void c();
                return;
            }
            cleanup = c;
        })();
        return () => {
            mounted = false;
            if (cleanup) void cleanup();
        };
        // doc is stable (memoized)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc, routeEpoch]);

    // Debounced persistence to IndexedDB keyed by workspace
    useEffect(() => {
        if (!workspaceHex) return;
        let disposed = false;
        let dbRef: IDBDatabase | null = null;
        let saveTimer: number | undefined;

        const init = async () => {
            try {
                dbRef = await openDocDb();
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn("IndexedDB open failed:", e);
            }
        };
        void init();

        const scheduleSave = () => {
            if (!dbRef) return; // wait until DB opens
            if (saveTimer) window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(async () => {
                if (disposed || !dbRef) return;
                try {
                    const bytes = doc.export({ mode: "snapshot" as const });
                    await putDocSnapshot(dbRef, workspaceHex, bytes);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn("IndexedDB save failed:", e);
                }
            }, 400);
        };

        const unsub = doc.subscribe(() => {
            scheduleSave();
        });

        return () => {
            disposed = true;
            unsub();
            if (saveTimer) window.clearTimeout(saveTimer);
            if (dbRef) dbRef.close();
        };
    }, [doc, workspaceHex]);

    // Load workspace list initially
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const db = await openDocDb();
                const all = await listWorkspaces(db);
                if (alive) setWorkspaces(all);
                db.close();
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn("IndexedDB list workspaces failed:", e);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    // Workspace navigation helpers imported from loro-state.ts

    const removeCurrentWorkspace = useCallback(async () => {
        if (!workspaceHex) return;
        try {
            const db = await openDocDb();
            await deleteWorkspace(db, workspaceHex);
            const all = await listWorkspaces(db);
            setWorkspaces(all);
            db.close();
            // If we removed current, move to another or create new
            const next = all.find((w) => w.id !== workspaceHex) ?? null;
            if (next) {
                window.location.assign(`/${next.id}#${next.privateHex}`);
            } else {
                await createNewWorkspace();
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Delete workspace failed:", e);
        }
    }, [workspaceHex]);

    useEffect(() => {
        const unsub = doc.subscribe(() => {
            setDetached(doc.isDetached());
        });
        return () => unsub();
    }, [doc]);

    // Keep local title in sync with CRDT state
    useEffect(() => {
        const name = (state as any).workspace?.name as string | undefined;
        if (typeof name === "string" && name !== workspaceTitle) {
            setWorkspaceTitle(name);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.workspace?.name]);

    // Persist workspace name alongside key pairs when it changes
    useEffect(() => {
        if (!workspaceHex) return;
        let timer: number | undefined;
        timer = window.setTimeout(async () => {
            try {
                const db = await openDocDb();
                const existing = await getWorkspace(db, workspaceHex);
                if (existing) {
                    const rec: WorkspaceRecord = {
                        ...existing,
                        name: workspaceTitle,
                        // keep lastUsedAt unchanged on name update
                    };
                    await upsertWorkspace(db, rec);
                    const all = await listWorkspaces(db);
                    setWorkspaces(all);
                    db.close();
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn("Persist workspace name failed:", e);
            }
        }, 300);
        return () => {
            if (timer) window.clearTimeout(timer);
        };
    }, [workspaceTitle, workspaceHex]);

    // Close workspace menu on outside click or Escape
    useEffect(() => {
        if (!showWsMenu) return;
        const onDown = (e: MouseEvent) => {
            if (!wsTitleRef.current) return;
            if (!wsTitleRef.current.contains(e.target as Node)) {
                setShowWsMenu(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setShowWsMenu(false);
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [showWsMenu]);

    // Measure workspace title width to fit content precisely
    useEffect(() => {
        const input = wsTitleInputRef.current;
        const meas = wsMeasureRef.current;
        if (!input || !meas) return;
        input.style.width = meas.offsetWidth + 12 + "px";
    }, [workspaceTitle]);

    // Ensure workspace menu stays inside the viewport with margin
    useEffect(() => {
        if (!showWsMenu) return;
        const menu = wsMenuRef.current;
        if (!menu) return;
        const margin = 12;
        const adjust = () => {
            const rect = menu.getBoundingClientRect();
            let dx = 0;
            if (rect.right > window.innerWidth - margin) {
                dx = window.innerWidth - margin - rect.right;
            }
            if (rect.left + dx < margin) {
                dx = margin - rect.left;
            }
            menu.style.transform = `translateX(${dx}px)`;
            const available = Math.max(
                120,
                window.innerHeight - margin - rect.top,
            );
            menu.style.maxHeight = available + "px";
            menu.style.overflowY = "auto";
        };
        const raf = requestAnimationFrame(adjust);
        const onResize = () => adjust();
        window.addEventListener("resize", onResize);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
        };
    }, [showWsMenu]);

    function addTodo(text: string) {
        if (!text.trim()) return;
        void setState((s) => {
            s.todos.push({ text, status: "todo" });
        });
        setNewText("");
    }

    const handleTextChange = useCallback(
        (cid: string, value: string) => {
            void setState((s) => {
                const i = s.todos.findIndex((x) => x.$cid === cid);
                if (i !== -1) s.todos[i].text = value;
            });
        },
        [setState],
    );

    const handleDoneChange = useCallback(
        (cid: string, done: boolean) => {
            void setState((s) => {
                const i = s.todos.findIndex((x) => x.$cid === cid);
                if (i !== -1) s.todos[i].status = done ? "done" : "todo";
            });
        },
        [setState],
    );

    const handleDragStart = useCallback((cid: string) => {
        setDragCid(cid);
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragCid(null);
        setInsertIndex(null);
    }, []);

    const updateInsertIndexFromPointer = useCallback(
        (clientY: number) => {
            const ul = listRef.current;
            if (!ul) return;
            const items = Array.from(
                ul.querySelectorAll<HTMLLIElement>("li.todo-item"),
            );
            if (items.length === 0) {
                setInsertIndex(0);
                return;
            }
            const filtered = items.filter(
                (el) => !el.classList.contains("dragging"),
            );
            // default to end of the full list (after last item)
            let idx = state.todos.length;
            for (let i = 0; i < filtered.length; i++) {
                const rect = filtered[i].getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                if (clientY < midpoint) {
                    // insert before this element's current index in the full list
                    const cid = filtered[i].dataset.cid;
                    const realIndex = state.todos.findIndex(
                        (t) => t.$cid === cid,
                    );
                    idx = realIndex === -1 ? i : realIndex;
                    break;
                }
            }
            setInsertIndex(idx);
        },
        [state.todos],
    );

    const handleListDragOver = useCallback(
        (e: React.DragEvent<HTMLUListElement>) => {
            e.preventDefault();
            updateInsertIndexFromPointer(e.clientY);
        },
        [updateInsertIndexFromPointer],
    );

    const commitDrop = useCallback(() => {
        if (!dragCid || insertIndex == null) return;
        void setState((s) => {
            const from = s.todos.findIndex((x) => x.$cid === dragCid);
            if (from === -1) return;
            let to = insertIndex;
            if (from < to) to = Math.max(0, to - 1);
            to = Math.min(Math.max(0, to), s.todos.length);
            if (from === to) return;
            const [item] = s.todos.splice(from, 1);
            s.todos.splice(to, 0, item);
        });
        setDragCid(null);
        setInsertIndex(null);
    }, [dragCid, insertIndex, setState]);

    const handleListDrop = useCallback(
        (e?: React.DragEvent<HTMLUListElement>) => {
            e?.preventDefault();
            commitDrop();
        },
        [commitDrop],
    );

    // Global dragover/drop to handle dropping outside the list bounds
    useEffect(() => {
        if (!dragCid) return;
        const onDragOver = (e: DragEvent) => {
            // allow dropping anywhere by canceling default
            e.preventDefault();
            updateInsertIndexFromPointer(e.clientY);
        };
        const onDrop = (e: DragEvent) => {
            e.preventDefault();
            updateInsertIndexFromPointer(e.clientY);
            // small timeout to ensure insertIndex state updates if needed
            requestAnimationFrame(() => commitDrop());
        };
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("drop", onDrop);
        };
    }, [dragCid, updateInsertIndexFromPointer, commitDrop]);

    return (
        <div className="app">
            <header className="app-header">
                <div className="workspace-title" ref={wsTitleRef}>
                    <input
                        className="workspace-title-input"
                        ref={wsTitleInputRef}
                        value={workspaceTitle}
                        onChange={(e) => {
                            const v = e.currentTarget.value;
                            setWorkspaceTitle(v);
                            if (wsDebounceRef.current)
                                window.clearTimeout(wsDebounceRef.current);
                            wsDebounceRef.current = window.setTimeout(() => {
                                void setState((s) => {
                                    s.workspace.name = v;
                                });
                            }, 300);
                        }}
                        placeholder="Workspace name"
                        disabled={detached}
                        aria-label="Workspace name"
                    />
                    <span
                        className="workspace-title-measure"
                        ref={wsMeasureRef}
                        aria-hidden
                    >
                        {workspaceTitle || "Untitled Workspace"}
                    </span>
                    <button
                        className="title-dropdown btn-text"
                        type="button"
                        onClick={() => setShowWsMenu((v) => !v)}
                        aria-label="Switch workspace"
                        title="Switch workspace"
                        disabled={false}
                    >
                        <MaterialSymbolsKeyboardArrowDown />
                    </button>
                    {showWsMenu && (
                        <div
                            className="workspace-selector-pop"
                            ref={wsMenuRef}
                            role="menu"
                        >
                            {(() => {
                                const options: { id: string; name: string }[] =
                                    [];
                                if (workspaceHex) {
                                    options.push({
                                        id: workspaceHex,
                                        name:
                                            workspaceTitle ||
                                            `${workspaceHex.slice(0, 16)}`,
                                    });
                                }
                                for (const w of workspaces) {
                                    if (w.id === workspaceHex) continue;
                                    options.push({
                                        id: w.id,
                                        name:
                                            w.name ||
                                            w.label ||
                                            w.id.slice(0, 16),
                                    });
                                }
                                const onChoose = async (id: string) => {
                                    await switchToWorkspace(id);
                                    setShowWsMenu(false);
                                };
                                const onCreate = async () => {
                                    await createNewWorkspace();
                                    setShowWsMenu(false);
                                };
                                const onDelete = async () => {
                                    await removeCurrentWorkspace();
                                    setShowWsMenu(false);
                                };
                                return (
                                    <div className="ws-menu">
                                        {options.length === 0 && (
                                            <div className="ws-empty">
                                                No workspaces
                                            </div>
                                        )}
                                        {options.map(({ id, name }) => (
                                            <button
                                                key={id}
                                                className={`ws-item${id === workspaceHex ? " current" : ""}`}
                                                onClick={() =>
                                                    void onChoose(id)
                                                }
                                                role="menuitem"
                                            >
                                                {name}
                                            </button>
                                        ))}
                                        <div className="ws-sep" />
                                        <button
                                            className="ws-action"
                                            onClick={() => void onCreate()}
                                            role="menuitem"
                                        >
                                            ＋ New workspace…
                                        </button>
                                        {workspaceHex && (
                                            <button
                                                className="ws-action danger"
                                                onClick={() => void onDelete()}
                                                role="menuitem"
                                            >
                                                <StreamlinePlumpRecycleBin2Remix />{" "}
                                                Delete current…
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </div>
                <span
                    className="status-inline"
                    title={online ? "Online" : "Offline"}
                    aria-live="polite"
                    aria-label={online ? "Online" : "Offline"}
                    style={{ display: "inline-flex", alignItems: "center" }}
                >
                    {/*<span>{online ? "Online" : "Offline"}</span>*/}
                    <span
                        style={{
                            color: online ? "#29c329" : "#c0392b",
                            marginLeft: 8,
                        }}
                    >
                        {online ? "●" : "○"}
                    </span>
                </span>
                {/* Room ID inline display removed; shown via selector options */}
            </header>

            <div className="new-todo">
                <input
                    className="todo-input"
                    placeholder="Add a todo..."
                    value={newText}
                    onChange={(e) => {
                        setNewText(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") addTodo(newText);
                    }}
                    disabled={detached}
                />
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        addTodo(newText);
                    }}
                    disabled={detached}
                >
                    Add
                </button>
            </div>

            <div className="toolbar">
                <button
                    className="btn btn-secondary btn-icon-only"
                    onClick={() => {
                        undo.undo();
                    }}
                    disabled={!undo.canUndo?.() || detached}
                    aria-label="Undo"
                    title="Undo"
                >
                    <LucideUndo2 className="btn-icon" aria-hidden />
                </button>
                <button
                    className="btn btn-secondary btn-icon-only"
                    onClick={() => {
                        undo.redo();
                    }}
                    disabled={!undo.canRedo?.() || detached}
                    aria-label="Redo"
                    title="Redo"
                >
                    <LucideUndo2
                        className="btn-icon"
                        style={{ transform: "scaleX(-1)" }}
                        aria-hidden
                    />
                </button>
                <button
                    className="btn btn-secondary btn-icon-only"
                    onClick={() =>
                        void setState((s) => {
                            for (let i = s.todos.length - 1; i >= 0; i--) {
                                if (s.todos[i].status === "done") {
                                    s.todos.splice(i, 1);
                                }
                            }
                        })
                    }
                    disabled={detached || !hasDone}
                    aria-label="Clear completed"
                    title="Clear completed"
                >
                    <MdiBroom className="btn-icon" aria-hidden />
                </button>
                <button
                    className="btn btn-secondary push-right"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(shareUrl);
                            if (toastTimerRef.current)
                                window.clearTimeout(toastTimerRef.current);
                            setToast("Invite link copied");
                            toastTimerRef.current = window.setTimeout(() => {
                                setToast(null);
                            }, 1600);
                        } catch {
                            // Fallback: prompt
                            window.prompt(
                                "Copy this invite URL and share it:",
                                shareUrl,
                            );
                        }
                    }}
                    title="Copy invite URL"
                >
                    Share
                </button>
                <button
                    className={
                        "btn btn-secondary " +
                        (showHistory ? "" : "btn-icon-only")
                    }
                    onClick={() => setShowHistory((v) => !v)}
                >
                    {showHistory ? (
                        "Hide History"
                    ) : (
                        <IcSharpHistory className="btn-icon" />
                    )}
                </button>
            </div>
            {showHistory && <HistoryView doc={doc} />}

            <ul
                className="todo-list"
                ref={listRef}
                onDragOver={handleListDragOver}
                onDrop={handleListDrop}
            >
                {state.todos.map((t, i) => {
                    const isInsertTop =
                        insertIndex != null && insertIndex === i;
                    const isInsertBottom =
                        insertIndex != null &&
                        insertIndex === state.todos.length &&
                        i === state.todos.length - 1;
                    return (
                        <TodoItemRow
                            key={t.$cid}
                            todo={t}
                            onTextChange={handleTextChange}
                            onDoneChange={handleDoneChange}
                            dragging={dragCid === t.$cid}
                            insertTop={!!isInsertTop}
                            insertBottom={!!isInsertBottom}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            detached={detached}
                        />
                    );
                })}
            </ul>

            <footer className="app-footer">
                <a
                    className="footer-gh"
                    href="https://github.com/loro-dev/loro-mirror"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub repository"
                    title="GitHub repository"
                >
                    <span style={{ marginRight: 8, fontSize: "0.9rem" }}>
                        Built with Loro
                    </span>
                    <MdiGithub />
                </a>
            </footer>
            {toast && (
                <div className="toast" role="status" aria-live="polite">
                    {toast}
                </div>
            )}
        </div>
    );
}

type Todo = { $cid: string; text: string; status: TodoStatus };

function TodoItemRow({
    todo,
    onTextChange,
    onDoneChange,
    dragging,
    insertTop,
    insertBottom,
    onDragStart,
    onDragEnd,
    detached,
}: {
    todo: Todo;
    onTextChange: (cid: string, value: string) => void;
    onDoneChange: (cid: string, done: boolean) => void;
    dragging: boolean;
    insertTop: boolean;
    insertBottom: boolean;
    onDragStart: (cid: string) => void;
    onDragEnd: () => void;
    detached: boolean;
}) {
    const selection = React.useRef<{ start: number; end: number } | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    // Restore caret/selection after state-driven rerender
    React.useLayoutEffect(() => {
        if (selection.current && inputRef.current) {
            const { start, end } = selection.current;
            try {
                inputRef.current.setSelectionRange(start, end);
            } catch {}
            selection.current = null;
        }
    }, [todo.text]);

    const isDone = todo.status === "done";
    return (
        <li
            className={`todo-item card${isDone ? " done" : ""}${dragging ? " dragging" : ""}${insertTop ? " insert-top" : ""}${insertBottom ? " insert-bottom" : ""}`}
            data-cid={todo.$cid}
        >
            <button
                className="drag-handle"
                draggable={!detached}
                onDragStart={(e) => {
                    // Hint move semantics and ensure we have some drag data
                    try {
                        e.dataTransfer?.setData("text/plain", todo.$cid);
                        if (e.dataTransfer)
                            e.dataTransfer.effectAllowed = "move";
                    } catch {}
                    onDragStart(todo.$cid);
                }}
                onDragEnd={() => onDragEnd()}
                aria-label="Drag to reorder"
                title="Drag to reorder"
            >
                ☰
            </button>
            <input
                type="checkbox"
                className="todo-checkbox"
                checked={isDone}
                onChange={(e) =>
                    onDoneChange(todo.$cid, e.currentTarget.checked)
                }
                aria-label={isDone ? "Mark as todo" : "Mark as done"}
                disabled={detached}
            />
            <input
                ref={inputRef}
                className="todo-text"
                value={todo.text}
                onChange={(e) => {
                    const start =
                        e.currentTarget.selectionStart ??
                        e.currentTarget.value.length;
                    const end = e.currentTarget.selectionEnd ?? start;
                    selection.current = { start, end };
                    onTextChange(todo.$cid, e.currentTarget.value);
                }}
                readOnly={detached}
            />
        </li>
    );
}
