import React, {
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    SVGProps,
} from "react";
import { useLoroStore } from "loro-mirror-react";
import {
    createConfiguredDoc,
    createUndoManager,
    initialTodoState,
    todoSchema,
    type TodoStatus,
} from "./state/doc";
import type { WorkspaceRecord } from "./state/storage";
import type { ClientStatusValue } from "loro-websocket";
import type { WorkspaceConnectionKeys } from "./state/publicSync";
import { useLongPressDrag } from "./useLongPressDrag";
import { NetworkStatusIndicator } from "./NetworkStatusIndicator";
import {
    createPresenceScheduler,
    type IdleWindow,
} from "./state/presence";

const HistoryView = React.lazy(() => import("./HistoryView"));

type StorageModule = typeof import("./state/storage");
type PublicSyncModule = typeof import("./state/publicSync");
type CryptoModule = typeof import("./state/crypto");
type WorkspaceKeys = WorkspaceConnectionKeys;

let storageModulePromise: Promise<StorageModule> | null = null;
function loadStorageModule(): Promise<StorageModule> {
    if (!storageModulePromise) {
        storageModulePromise = import("./state/storage");
    }
    return storageModulePromise;
}

let publicSyncModulePromise: Promise<PublicSyncModule> | null = null;
function loadPublicSyncModule(): Promise<PublicSyncModule> {
    if (!publicSyncModulePromise) {
        publicSyncModulePromise = import("./state/publicSync");
    }
    return publicSyncModulePromise;
}

let cryptoModulePromise: Promise<CryptoModule> | null = null;
function loadCryptoModule(): Promise<CryptoModule> {
    if (!cryptoModulePromise) {
        cryptoModulePromise = import("./state/crypto");
    }
    return cryptoModulePromise;
}
async function switchToWorkspace(id: string): Promise<void> {
    const { openDocDb, getWorkspace } = await loadStorageModule();
    const db = await openDocDb();
    try {
        const record = await getWorkspace(db, id);
        if (!record) return;
        window.location.assign(`/${record.id}#${record.privateHex}`);
    } finally {
        db.close();
    }
}

async function createNewWorkspace(): Promise<void> {
    const { generatePairAndUrl } = await loadCryptoModule();
    const generated = await generatePairAndUrl();
    window.location.assign(`/${generated.publicHex}#${generated.privateHex}`);
}

function getWorkspaceRouteKey(): string {
    if (typeof window === "undefined") return "ssr";
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const toLowerHex = (value: string): string => value.trim().toLowerCase();
    const maybePub =
        pathParts.length > 0 ? toLowerHex(pathParts[pathParts.length - 1]) : "";
    const rawHash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
    const maybePriv = rawHash ? toLowerHex(rawHash) : "";
    return `${maybePub}#${maybePriv}`;
}

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

export function MdiTrayArrowUp(props: SVGProps<SVGSVGElement>) {
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
                d="M2 12h2v5h16v-5h2v5c0 1.11-.89 2-2 2H4a2 2 0 0 1-2-2zM12 2L6.46 7.46l1.42 1.42L11 5.75V15h2V5.75l3.13 3.13l1.42-1.43z"
            />
        </svg>
    );
}

export function MdiTrayArrowDown(props: SVGProps<SVGSVGElement>) {
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
                d="M2 12h2v5h16v-5h2v5c0 1.11-.89 2-2 2H4a2 2 0 0 1-2-2zm10 3l5.55-5.46l-1.42-1.41L13 11.25V2h-2v9.25L7.88 8.13L6.46 9.55z"
            />
        </svg>
    );
}

export function MdiLinkVariant(props: SVGProps<SVGSVGElement>) {
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
                d="M10.59 13.41c.41.39.41 1.03 0 1.42c-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0a5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a2.98 2.98 0 0 0 0-4.24a2.98 2.98 0 0 0-4.24 0l-3.53 3.53a2.98 2.98 0 0 0 0 4.24m2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0a5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.43l-.47.47a2.98 2.98 0 0 0 0 4.24a2.98 2.98 0 0 0 4.24 0l3.53-3.53a2.98 2.98 0 0 0 0-4.24a.973.973 0 0 1 0-1.42"
            />
        </svg>
    );
}

export function MdiHelpCircleOutline(props: SVGProps<SVGSVGElement>) {
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
                d="M11 18h2v-2h-2zm1-16A10 10 0 0 0 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8m0-14a4 4 0 0 0-4 4h2a2 2 0 0 1 2-2a2 2 0 0 1 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4"
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

type WorkspaceSessionProps = {
    workspace: WorkspaceKeys;
};

function WorkspaceSession({ workspace }: WorkspaceSessionProps) {
    const doc = useMemo(() => createConfiguredDoc(), []);
    (window as unknown as { doc?: unknown }).doc = doc;
    const undo = useMemo(() => createUndoManager(doc), [doc]);

    const { state, setState } = useLoroStore<typeof todoSchema>({
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
    const [connectionStatus, setConnectionStatus] =
        useState<ClientStatusValue>("connecting");
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [presenceCount, setPresenceCount] = useState<number>(1);
    const [workspaceHex, setWorkspaceHex] = useState<string>(workspace.publicHex);
    const [presencePeers, setPresencePeers] = useState<string[]>([]);
    const [shareUrl, setShareUrl] = useState<string>("");
    const [toast, setToast] = useState<string | null>(null);
    const toastTimerRef = useRef<number | undefined>(undefined);
    const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
    const [workspaceTitle, setWorkspaceTitle] = useState<string>("Untitled List");
    const wsDebounceRef = useRef<number | undefined>(undefined);
    const [showWsMenu, setShowWsMenu] = useState<boolean>(false);
    const wsTitleRef = useRef<HTMLDivElement | null>(null);
    const wsTitleInputRef = useRef<HTMLInputElement | null>(null);
    const wsMeasureRef = useRef<HTMLSpanElement | null>(null);
    const wsMenuRef = useRef<HTMLDivElement | null>(null);
    const wsImportInputRef = useRef<HTMLInputElement | null>(null);
    // Flag to skip snapshot on navigations that intentionally delete the workspace
    const skipSnapshotOnUnloadRef = useRef<boolean>(false);

    const [selectedTextCid, setSelectedTextCid] = useState<string | null>(null);
    const hasDone = useMemo(
        () => state.todos.some((t) => t.status === "done"),
        [state.todos],
    );

    // Layout: transform-translate positioning for smooth transitions
    const [itemHeights, setItemHeights] = useState<Record<string, number>>({});
    const ITEM_GAP = 10; // vertical gap between items (px)
    const DEFAULT_HEIGHT = 48; // fallback before first measurement
    const handleRowHeight = useCallback((cid: string, h: number) => {
        setItemHeights((prev) => {
            if (prev[cid] === h) return prev;
            return { ...prev, [cid]: h };
        });
    }, []);

    const positions = useMemo(() => {
        let y = 0;
        const pos: Record<string, number> = {};
        for (const t of state.todos) {
            pos[t.$cid] = y;
            const h = itemHeights[t.$cid] ?? DEFAULT_HEIGHT;
            y += h + ITEM_GAP;
        }
        const height = Math.max(0, y - (state.todos.length > 0 ? ITEM_GAP : 0));
        return { pos, height } as const;
    }, [state.todos, itemHeights]);

    const workspaceFileName = useMemo(() => {
        const fallback = workspaceHex || "workspace";
        const rawBase = workspaceTitle.trim() || fallback;
        const safeBase = rawBase
            .replace(/[^a-zA-Z0-9-_]+/g, "_")
            .replace(/^_+|_+$/g, "");
        const base = safeBase.length > 0 ? safeBase : fallback;
        return `${base}.loro`;
    }, [workspaceHex, workspaceTitle]);

    useEffect(() => {
        if (!selectedTextCid) return;
        if (state.todos.some((t) => t.$cid === selectedTextCid)) return;
        setSelectedTextCid(null);
    }, [selectedTextCid, state.todos]);

    // Ensure mobile viewport is not scalable (disable pinch-zoom)
    useEffect(() => {
        if (typeof document === "undefined") return;
        const selector = 'meta[name="viewport"]';
        let meta = document.querySelector<HTMLMetaElement>(selector);
        const previous = meta?.getAttribute("content") ?? null;
        const content =
            "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
        if (!meta) {
            meta = document.createElement("meta");
            meta.setAttribute("name", "viewport");
            document.head.appendChild(meta);
        }
        meta.setAttribute("content", content);
        return () => {
            if (!meta) return;
            if (previous !== null) {
                meta.setAttribute("content", previous);
            }
        };
    }, []);

    // Presence tuning
    const TOAST_DURATION_MS = 2600; // slightly longer toast display

    const handleStatusToast = useCallback((message: string | null) => {
        if (!message) return;
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
        }
        setToast(message);
        toastTimerRef.current = window.setTimeout(() => {
            setToast(null);
        }, TOAST_DURATION_MS);
    }, [setToast]);

    useEffect(() => {
        setConnectionStatus("connecting");
        setLatencyMs(null);
        setOnline(false);
        const idleWindow = window as IdleWindow;
        let mounted = true;
        let sessionCleanup: void | (() => void | Promise<void>);
        let idleHandle: number | undefined;
        let startTimeout: number | undefined;

        const presenceScheduler = createPresenceScheduler({
            idleWindow,
            docPeerId: doc.peerIdStr,
            setPresencePeers,
            setPresenceCount,
            isActive: () => mounted,
        });

        const start = async () => {
            try {
                const { setupPublicSync } = await loadPublicSyncModule();
                if (!mounted) return;
                const session = await setupPublicSync(doc, workspace, {
                    setDetached,
                    setOnline,
                    setWorkspaceHex,
                    setShareUrl,
                    setWorkspaces,
                    setConnectionStatus,
                    setLatency: setLatencyMs,
                });
                if (!mounted) {
                    if (session?.cleanup) void session.cleanup();
                    return;
                }
                sessionCleanup = session.cleanup;
                const client = session.client;
                if (client) {
                    presenceScheduler.schedule(client);
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to start public sync:", error);
                if (mounted) setOnline(false);
            }
        };

        if (typeof idleWindow.requestIdleCallback === "function") {
            idleHandle = idleWindow.requestIdleCallback(() => {
                idleHandle = undefined;
                void start();
            });
        } else {
            startTimeout = window.setTimeout(() => {
                startTimeout = undefined;
                void start();
            }, 200);
        }

        return () => {
            mounted = false;
            presenceScheduler.dispose();
            if (
                idleHandle !== undefined &&
                typeof idleWindow.cancelIdleCallback === "function"
            ) {
                idleWindow.cancelIdleCallback(idleHandle);
            }
            if (startTimeout !== undefined) window.clearTimeout(startTimeout);
            if (sessionCleanup) void sessionCleanup();
        };
        // doc/workspace stay stable within a session (component remounts on change)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc, workspace]);

    // Debounced persistence to IndexedDB keyed by workspace
    useEffect(() => {
        if (!workspaceHex) return;
        const idleWindow = window as IdleWindow;
        let disposed = false;
        let dbRef: IDBDatabase | null = null;
        let saveTimer: number | undefined;
        let storage: StorageModule | null = null;
        let pendingSave = false;
        let ensureDbPromise: Promise<void> | null = null;
        let ensureScheduled = false;
        let idleHandle: number | undefined;
        let ensureTimeout: number | undefined;

        const scheduleSave = () => {
            if (!dbRef || !storage) return;
            if (saveTimer) window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(async () => {
                if (disposed || !dbRef || !storage) return;
                try {
                    const bytes = doc.export({ mode: "snapshot" as const });
                    await storage.putDocSnapshot(dbRef, workspaceHex, bytes);
                    pendingSave = false;
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.warn("IndexedDB save failed:", error);
                }
            }, 400);
        };

        const ensureDb = async () => {
            if (dbRef) return;
            try {
                const module = await loadStorageModule();
                storage = module;
                dbRef = await module.openDocDb();
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("IndexedDB open failed:", error);
            } finally {
                ensureScheduled = false;
                if (!dbRef) {
                    ensureDbPromise = null;
                }
                if (!disposed && pendingSave && dbRef && storage) {
                    scheduleSave();
                }
            }
        };

        const scheduleEnsureDb = () => {
            if (dbRef || ensureDbPromise || ensureScheduled) return;
            ensureScheduled = true;
            if (typeof idleWindow.requestIdleCallback === "function") {
                idleHandle = idleWindow.requestIdleCallback(() => {
                    idleHandle = undefined;
                    ensureDbPromise = ensureDb();
                });
            } else {
                ensureTimeout = window.setTimeout(() => {
                    ensureTimeout = undefined;
                    ensureDbPromise = ensureDb();
                }, 350);
            }
        };

        const markSaveNeeded = () => {
            pendingSave = true;
            if (dbRef && storage) {
                scheduleSave();
            } else {
                scheduleEnsureDb();
            }
        };

        scheduleEnsureDb();

        const unsub = doc.subscribe(() => {
            if (disposed) return;
            markSaveNeeded();
        });

        return () => {
            disposed = true;
            unsub();
            if (saveTimer) window.clearTimeout(saveTimer);
            if (dbRef) dbRef.close();
            if (
                idleHandle !== undefined &&
                typeof idleWindow.cancelIdleCallback === "function"
            ) {
                idleWindow.cancelIdleCallback(idleHandle);
            }
            if (ensureTimeout !== undefined) window.clearTimeout(ensureTimeout);
        };
    }, [doc, workspaceHex]);

    // Load workspace list initially after the first paint
    useEffect(() => {
        let alive = true;
        const idleWindow = window as IdleWindow;
        let idleHandle: number | undefined;
        let startTimeout: number | undefined;

        const run = async () => {
            try {
                const storage = await loadStorageModule();
                const db = await storage.openDocDb();
                const all = await storage.listWorkspaces(db);
                if (alive) setWorkspaces(all);
                db.close();
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("IndexedDB list workspaces failed:", error);
            }
        };

        if (typeof idleWindow.requestIdleCallback === "function") {
            idleHandle = idleWindow.requestIdleCallback(() => {
                idleHandle = undefined;
                void run();
            });
        } else {
            startTimeout = window.setTimeout(() => {
                startTimeout = undefined;
                void run();
            }, 320);
        }

        return () => {
            alive = false;
            if (
                idleHandle !== undefined &&
                typeof idleWindow.cancelIdleCallback === "function"
            ) {
                idleWindow.cancelIdleCallback(idleHandle);
            }
            if (startTimeout !== undefined) window.clearTimeout(startTimeout);
        };
    }, []);

    const removeCurrentWorkspace = useCallback(async () => {
        if (!workspaceHex) return;
        try {
            skipSnapshotOnUnloadRef.current = true;
            const storage = await loadStorageModule();
            const db = await storage.openDocDb();
            try {
                await storage.deleteWorkspace(db, workspaceHex);
                const all = await storage.listWorkspaces(db);
                setWorkspaces(all);
                const next = all.find((w) => w.id !== workspaceHex) ?? null;
                if (next) {
                    window.location.assign(`/${next.id}#${next.privateHex}`);
                } else {
                    await createNewWorkspace();
                }
            } finally {
                db.close();
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Delete workspace failed:", error);
            skipSnapshotOnUnloadRef.current = false;
        }
    }, [workspaceHex]);

    // Persist the latest snapshot immediately (used before programmatic navigations)
    const persistSnapshotNow = useCallback(async (): Promise<void> => {
        if (!workspaceHex) return;
        try {
            const storage = await loadStorageModule();
            const db = await storage.openDocDb();
            try {
                const bytes = doc.export({ mode: "snapshot" as const });
                await storage.putDocSnapshot(db, workspaceHex, bytes);
            } finally {
                db.close();
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Forced snapshot save failed:", error);
        }
    }, [doc, workspaceHex]);

    const handleExportWorkspace = useCallback(() => {
        if (!workspaceHex) {
            handleStatusToast("Workspace not ready");
            return;
        }
        try {
            const snapshot = doc.export({ mode: "snapshot" as const });
            const blob = new Blob([snapshot], {
                type: "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = workspaceFileName;
            const body = document.body;
            if (!body) {
                throw new Error("Document body unavailable");
            }
            body.appendChild(anchor);
            anchor.click();
            body.removeChild(anchor);
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            handleStatusToast("Workspace exported");
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Export workspace failed:", error);
            handleStatusToast("Export failed");
        } finally {
            setShowWsMenu(false);
        }
    }, [doc, handleStatusToast, setShowWsMenu, workspaceFileName, workspaceHex]);

    const handleRequestImport = useCallback(() => {
        if (!workspaceHex) {
            handleStatusToast("Workspace not ready");
            return;
        }
        setShowWsMenu(false);
        window.setTimeout(() => {
            wsImportInputRef.current?.click();
        }, 0);
    }, [handleStatusToast, setShowWsMenu, workspaceHex]);

    const handleImportFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            if (!workspaceHex) {
                event.currentTarget.value = "";
                handleStatusToast("Workspace not ready");
                return;
            }
            const input = event.currentTarget;
            const file = input.files?.[0] ?? null;
            input.value = "";
            if (!file) return;
            try {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                doc.import(bytes);
                await persistSnapshotNow();
                handleStatusToast("Workspace imported");
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("Import workspace failed:", error);
                handleStatusToast("Import failed");
            }
        },
        [doc, handleStatusToast, persistSnapshotNow, workspaceHex],
    );

    useEffect(() => {
        const unsub = doc.subscribe(() => {
            setDetached(doc.isDetached());
        });
        return () => unsub();
    }, [doc]);

    // Keep local title in sync with CRDT state
    useEffect(() => {
        const name = state.workspace?.name;
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
                const storage = await loadStorageModule();
                const db = await storage.openDocDb();
                try {
                    const existing = await storage.getWorkspace(db, workspaceHex);
                    if (existing) {
                        const rec: WorkspaceRecord = {
                            ...existing,
                            name: workspaceTitle,
                        };
                        await storage.upsertWorkspace(db, rec);
                        const all = await storage.listWorkspaces(db);
                        setWorkspaces(all);
                    }
                } finally {
                    db.close();
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("Persist workspace name failed:", error);
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
            // Insert new todos at the top of the list
            s.todos.splice(0, 0, { text, status: "todo" });
        });
        setNewText("");
    }

    // Best-effort snapshot flush on page navigation/close (skip when deleting workspace)
    useEffect(() => {
        const onLeave = () => {
            if (skipSnapshotOnUnloadRef.current) return;
            void persistSnapshotNow();
        };
        window.addEventListener("pagehide", onLeave);
        window.addEventListener("beforeunload", onLeave);
        return () => {
            window.removeEventListener("pagehide", onLeave);
            window.removeEventListener("beforeunload", onLeave);
        };
    }, [persistSnapshotNow]);

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
                const from = s.todos.findIndex((x) => x.$cid === cid);
                if (from === -1) return;
                s.todos[from].status = done ? "done" : "todo";
                if (done) {
                    // Count trailing done items (contiguous from the end)
                    let trailingDone = 0;
                    for (let idx = s.todos.length - 1; idx >= 0; idx--) {
                        if (s.todos[idx].status === "done") trailingDone++;
                        else break;
                    }
                    let startIdx = s.todos.length - trailingDone; // first index of trailing done block
                    // Move this item to the start of the trailing done block
                    let to = startIdx;
                    if (from < to) to -= 1; // account for index shift after removal
                    const [item] = s.todos.splice(from, 1);
                    s.todos.splice(to, 0, item);
                } else {
                    // Move to the start of the unfinished block (boundary before trailing done block)
                    // Recompute trailing done items after status change
                    let trailingDone = 0;
                    for (let idx = s.todos.length - 1; idx >= 0; idx--) {
                        if (
                            s.todos[idx].status === "done" ||
                            s.todos[idx].$cid === cid
                        )
                            trailingDone++;
                        else break;
                    }
                    let to = s.todos.length - trailingDone; // index where done block starts
                    if (from < to) to -= 1; // account for shift after removal
                    if (to < 0) to = 0;
                    if (to > s.todos.length) to = s.todos.length;
                    if (from !== to) {
                        const [item] = s.todos.splice(from, 1);
                        s.todos.splice(to, 0, item);
                    }
                }
            });
        },
        [setState],
    );

    const handleDelete = useCallback(
        (cid: string) => {
            void setState((s) => {
                const i = s.todos.findIndex((x) => x.$cid === cid);
                if (i !== -1) s.todos.splice(i, 1);
            });
        },
        [setState],
    );

    const handleDragStart = useCallback((cid: string) => {
        setDragCid(cid);
    }, []);

    const handleDragEndBase = useCallback(() => {
        setDragCid(null);
        setInsertIndex(null);
    }, []);

    const updateInsertIndexFromPointer = useCallback(
        (clientY: number) => {
            const ul = listRef.current;
            if (!ul) return;
            // convert to container-local Y
            const rect = ul.getBoundingClientRect();
            const y = clientY - rect.top;
            // default to end of list
            let idx = state.todos.length;
            for (let i = 0; i < state.todos.length; i++) {
                const t = state.todos[i];
                if (t.$cid === dragCid) continue; // ignore dragging item
                const top = positions.pos[t.$cid] ?? 0;
                const h = itemHeights[t.$cid] ?? DEFAULT_HEIGHT;
                const midpoint = top + h / 2;
                if (y < midpoint) {
                    idx = i;
                    break;
                }
            }
            setInsertIndex(idx);
        },
        [state.todos, positions.pos, itemHeights, dragCid],
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

    const shouldHandleLongPress = useCallback(
        (cid: string, e: React.PointerEvent<HTMLLIElement>) => {
            if (detached) return false;
            const target = e.target as HTMLElement | null;
            if (!target) return false;
            if (target.closest(".delete-btn")) return false;
            if (e.pointerType === "mouse") {
                return !!target.closest(".drag-handle");
            }
            const textarea = target.closest("textarea.todo-text");
            if (textarea) {
                return selectedTextCid !== cid;
            }
            if (target.closest("input, select, button, a")) {
                return false;
            }
            return true;
        },
        [detached, selectedTextCid],
    );

    const handleTextSelect = useCallback((cid: string) => {
        setSelectedTextCid(cid);
    }, []);

    const handleTextDeselect = useCallback((cid: string) => {
        setSelectedTextCid((prev) => (prev === cid ? null : prev));
    }, []);

    const {
        manualDrag,
        handlePointerDown: handleManualPointerDown,
        handlePointerMove: handleManualPointerMove,
        handlePointerUp: handleManualPointerUp,
        handlePointerCancel: handleManualPointerCancel,
    } = useLongPressDrag({
        listRef,
        positions,
        itemHeights,
        defaultHeight: DEFAULT_HEIGHT,
        detached,
        onDragStart: handleDragStart,
        onDragEnd: handleDragEndBase,
        onUpdateInsertIndex: updateInsertIndexFromPointer,
        onCommitDrop: commitDrop,
        shouldHandlePointerDown: shouldHandleLongPress,
    });

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
                        {workspaceTitle || "Untitled List"}
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
                                    // Force-save current snapshot before navigating
                                    await persistSnapshotNow();
                                    await switchToWorkspace(id);
                                    setShowWsMenu(false);
                                };
                                const onCreate = async () => {
                                    // Force-save current snapshot before navigating
                                    await persistSnapshotNow();
                                    await createNewWorkspace();
                                    setShowWsMenu(false);
                                };
                                const onDelete = async () => {
                                    await removeCurrentWorkspace();
                                    setShowWsMenu(false);
                                };
                                const onJoin = async () => {
                                    const input = window.prompt(
                                        "Paste the invite URL to join:",
                                        "",
                                    );
                                    if (!input) return;
                                    const url = input.trim();
                                    try {
                                        if (workspaceHex) {
                                            await persistSnapshotNow();
                                        }
                                    } finally {
                                        setShowWsMenu(false);
                                        window.location.assign(url);
                                    }
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
                                            onClick={handleExportWorkspace}
                                            role="menuitem"
                                            type="button"
                                        >
                                            <MdiTrayArrowUp
                                                className="ws-icon"
                                                aria-hidden
                                            />
                                            <span>Export</span>
                                            <span
                                                className="ws-help-icon"
                                                title="Exports a .loro CRDT snapshot (loro.dev format)"
                                            >
                                                <MdiHelpCircleOutline aria-hidden />
                                            </span>
                                        </button>
                                        <button
                                            className="ws-action"
                                            onClick={handleRequestImport}
                                            role="menuitem"
                                            type="button"
                                        >
                                            <MdiTrayArrowDown
                                                className="ws-icon"
                                                aria-hidden
                                            />
                                            <span>Import</span>
                                            <span
                                                className="ws-help-icon"
                                                title="Imports a .loro CRDT snapshot (loro.dev format) into this workspace"
                                            >
                                                <MdiHelpCircleOutline aria-hidden />
                                            </span>
                                        </button>
                                        <button
                                            className="ws-action"
                                            onClick={() => void onJoin()}
                                            role="menuitem"
                                            type="button"
                                        >
                                            <MdiLinkVariant
                                                className="ws-icon"
                                                aria-hidden
                                            />
                                            Join by URL…
                                        </button>
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
                    <input
                        ref={wsImportInputRef}
                        type="file"
                        accept=".loro,application/octet-stream"
                        style={{ display: "none" }}
                        onChange={(event) => {
                            void handleImportFileChange(event);
                        }}
                    />
                </div>
                <NetworkStatusIndicator
                    connectionStatus={connectionStatus}
                    presenceCount={presenceCount}
                    presencePeers={presencePeers}
                    latencyMs={latencyMs}
                    onRequestToast={handleStatusToast}
                />
                {/* Room ID inline display removed; shown via selector options */}
            </header>

            <div className="new-todo">
                <input
                    className="todo-input"
                    style={{ fontSize: 15 }}
                    placeholder="Add a todo..."
                    value={newText}
                    onChange={(e) => {
                        setNewText(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        const isComposing = (e.nativeEvent as KeyboardEvent)
                            .isComposing;
                        const isIMEKeyCode =
                            (e.nativeEvent as KeyboardEvent).keyCode === 229;
                        if (
                            e.key === "Enter" &&
                            !isComposing &&
                            !isIMEKeyCode
                        ) {
                            e.preventDefault();
                            addTodo(newText);
                        }
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
                            }, TOAST_DURATION_MS);
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
            {showHistory && (
                <Suspense fallback={null}>
                    <HistoryView doc={doc} />
                </Suspense>
            )}

            <ul
                className="todo-list"
                ref={listRef}
                onDragOver={handleListDragOver}
                onDrop={handleListDrop}
                style={{
                    height: positions.height,
                    touchAction: manualDrag ? "none" : undefined,
                }}
            >
                {(() => {
                    const stableTodos = [...state.todos].sort((a, b) =>
                        a.$cid.localeCompare(b.$cid),
                    );
                    const indexByCid: Record<string, number> = {};
                    for (let i = 0; i < state.todos.length; i++) {
                        indexByCid[state.todos[i].$cid] = i;
                    }
                    return stableTodos.map((t) => {
                        const realIndex = indexByCid[t.$cid] ?? 0;
                        const isInsertTop =
                            insertIndex != null && insertIndex === realIndex;
                        const isInsertBottom =
                            insertIndex != null &&
                            insertIndex === state.todos.length &&
                            realIndex === state.todos.length - 1;
                        const baseY = positions.pos[t.$cid] ?? 0;
                        let translateY = baseY;
                        let transition = "transform 240ms ease";
                        let zIndex = 1;
                        const activeDragCid = manualDrag?.cid ?? dragCid;
                        const isManualActive = manualDrag?.cid === t.$cid;
                        const activeDragIndex =
                            activeDragCid != null
                                ? (indexByCid[activeDragCid] ?? -1)
                                : -1;
                        const activeDragHeight =
                            activeDragCid != null
                                ? (manualDrag?.height ??
                                  itemHeights[activeDragCid] ??
                                  DEFAULT_HEIGHT)
                                : DEFAULT_HEIGHT;
                        if (isManualActive && manualDrag) {
                            const rawY =
                                manualDrag.clientY -
                                manualDrag.listTop -
                                manualDrag.offsetY;
                            const minY = -manualDrag.height * 0.6;
                            const maxY = Math.max(
                                positions.height - manualDrag.height * 0.4,
                                minY,
                            );
                            const clampedY = Math.min(
                                Math.max(rawY, minY),
                                maxY,
                            );
                            translateY = clampedY;
                            transition = "transform 0ms linear";
                            zIndex = 5;
                        } else if (
                            activeDragCid === t.$cid &&
                            dragCid === t.$cid
                        ) {
                            transition = "transform 0ms linear";
                            zIndex = 5;
                        }
                        if (
                            activeDragCid &&
                            activeDragIndex !== -1 &&
                            insertIndex != null &&
                            t.$cid !== activeDragCid
                        ) {
                            if (insertIndex > activeDragIndex) {
                                if (
                                    realIndex > activeDragIndex &&
                                    realIndex <= insertIndex - 1
                                ) {
                                    translateY -= activeDragHeight + ITEM_GAP;
                                }
                            } else if (insertIndex <= activeDragIndex) {
                                if (
                                    realIndex >= insertIndex &&
                                    realIndex < activeDragIndex
                                ) {
                                    translateY += activeDragHeight + ITEM_GAP;
                                }
                            }
                        }
                        return (
                            <TodoItemRow
                                key={t.$cid}
                                todo={t}
                                onTextChange={handleTextChange}
                                onDoneChange={handleDoneChange}
                                onDelete={handleDelete}
                                dragging={dragCid === t.$cid}
                                insertTop={!!isInsertTop}
                                insertBottom={!!isInsertBottom}
                                onManualPointerDown={handleManualPointerDown}
                                onManualPointerMove={handleManualPointerMove}
                                onManualPointerUp={handleManualPointerUp}
                                onManualPointerCancel={
                                    handleManualPointerCancel
                                }
                                textSelected={selectedTextCid === t.$cid}
                                onTextSelect={handleTextSelect}
                                onTextDeselect={handleTextDeselect}
                                detached={detached}
                                onHeightChange={handleRowHeight}
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    transform: `translateY(${translateY}px)`,
                                    transition,
                                    willChange: "transform",
                                    zIndex,
                                    touchAction:
                                        manualDrag?.cid === t.$cid
                                            ? "none"
                                            : undefined,
                                }}
                            />
                        );
                    });
                })()}
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

export function App() {
    const [workspace, setWorkspace] = useState<WorkspaceKeys | null>(null);
    const ensureCounterRef = useRef(0);
    const workspaceRef = useRef<WorkspaceKeys | null>(null);
    const currentKeyRef = useRef<string | null>(null);

    useEffect(() => {
        workspaceRef.current = workspace;
        currentKeyRef.current = workspace
            ? `${workspace.publicHex}#${workspace.privateHex}`
            : null;
    }, [workspace]);

    const ensureWorkspace = useCallback(async () => {
        if (typeof window === "undefined") return;
        const routeKey = getWorkspaceRouteKey();
        const current = currentKeyRef.current;
        const activeWorkspace = workspaceRef.current;
        if (current === routeKey && activeWorkspace) {
            const canonicalPath = `/${activeWorkspace.publicHex}`;
            const canonicalHash = `#${activeWorkspace.privateHex}`;
            if (
                window.location.pathname !== canonicalPath ||
                window.location.hash !== canonicalHash
            ) {
                history.replaceState(null, "", `${canonicalPath}${canonicalHash}`);
            }
            setWorkspace(activeWorkspace);
            return;
        }

        ensureCounterRef.current += 1;
        const ensureId = ensureCounterRef.current;
        setWorkspace(null);

        const commit = (value: WorkspaceKeys | null) => {
            if (ensureCounterRef.current !== ensureId) return;
            currentKeyRef.current = value
                ? `${value.publicHex}#${value.privateHex}`
                : null;
            workspaceRef.current = value;
            setWorkspace(value);
        };

        const [rawPub, rawPriv = ""] = routeKey.split("#");
        const candidatePub = rawPub?.trim().toLowerCase() ?? "";
        const candidatePriv = rawPriv.trim().toLowerCase();
        const hexPattern = /^[0-9a-f]+$/i;

        const useResolvedWorkspace = (value: WorkspaceKeys | null) => {
            if (!value) {
                commit(null);
                return;
            }
            const canonicalPath = `/${value.publicHex}`;
            const canonicalHash = `#${value.privateHex}`;
            if (
                window.location.pathname !== canonicalPath ||
                window.location.hash !== canonicalHash
            ) {
                history.replaceState(null, "", `${canonicalPath}${canonicalHash}`);
            }
            commit(value);
        };

        try {
            if (
                candidatePub &&
                candidatePriv &&
                hexPattern.test(candidatePub) &&
                hexPattern.test(candidatePriv)
            ) {
                const cryptoModule = await loadCryptoModule();
                const imported = await cryptoModule.importKeyPairFromHex(
                    candidatePub,
                    candidatePriv,
                );
                if (imported) {
                    const publicHex = await cryptoModule.exportRawPublicKeyHex(
                        imported.publicKey,
                    );
                    const jwk = (await crypto.subtle.exportKey(
                        "jwk",
                        imported.privateKey,
                    )) as JsonWebKey;
                    const privateHex = cryptoModule.bytesToHex(
                        cryptoModule.base64UrlToBytes(jwk.d ?? ""),
                    );
                    useResolvedWorkspace({ publicHex, privateHex });
                    return;
                }
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Workspace key validation failed:", error);
        }

        try {
            const storage = await loadStorageModule();
            const db = await storage.openDocDb();
            try {
                const all = await storage.listWorkspaces(db);
                if (all.length > 0) {
                    const latest = all[0];
                    useResolvedWorkspace({
                        publicHex: latest.id.toLowerCase(),
                        privateHex: latest.privateHex.toLowerCase(),
                    });
                    return;
                }
            } finally {
                db.close();
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Load last workspace failed:", error);
        }

        try {
            const cryptoModule = await loadCryptoModule();
            const generated = await cryptoModule.generatePairAndUrl();
            useResolvedWorkspace({
                publicHex: generated.publicHex,
                privateHex: generated.privateHex,
            });
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Failed to create workspace:", error);
            commit(null);
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const handleRouteChange = () => {
            void ensureWorkspace();
        };
        window.addEventListener("hashchange", handleRouteChange);
        window.addEventListener("popstate", handleRouteChange);
        void ensureWorkspace();
        return () => {
            window.removeEventListener("hashchange", handleRouteChange);
            window.removeEventListener("popstate", handleRouteChange);
        };
    }, [ensureWorkspace]);

    if (!workspace) return null;

    const key = `${workspace.publicHex}#${workspace.privateHex}`;
    return <WorkspaceSession key={key} workspace={workspace} />;
}

type Todo = { $cid: string; text: string; status: TodoStatus };

function TodoItemRow({
    todo,
    onTextChange,
    onDoneChange,
    onDelete,
    dragging,
    insertTop,
    insertBottom,
    onManualPointerDown,
    onManualPointerMove,
    onManualPointerUp,
    onManualPointerCancel,
    textSelected = false,
    onTextSelect,
    onTextDeselect,
    detached,
    onHeightChange,
    style,
}: {
    todo: Todo;
    onTextChange: (cid: string, value: string) => void;
    onDoneChange: (cid: string, done: boolean) => void;
    onDelete: (cid: string) => void;
    dragging: boolean;
    insertTop: boolean;
    insertBottom: boolean;
    onManualPointerDown?: (
        cid: string,
        e: React.PointerEvent<HTMLLIElement>,
    ) => void;
    onManualPointerMove?: (
        cid: string,
        e: React.PointerEvent<HTMLLIElement>,
    ) => void;
    onManualPointerUp?: (
        cid: string,
        e: React.PointerEvent<HTMLLIElement>,
    ) => void;
    onManualPointerCancel?: (
        cid: string,
        e: React.PointerEvent<HTMLLIElement>,
    ) => void;
    textSelected?: boolean;
    onTextSelect?: (cid: string) => void;
    onTextDeselect?: (cid: string) => void;
    detached: boolean;
    onHeightChange?: (cid: string, height: number) => void;
    style?: React.CSSProperties;
}) {
    const selection = React.useRef<{ start: number; end: number } | null>(null);
    const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
    const rowRef = React.useRef<HTMLLIElement | null>(null);
    const isComposingRef = React.useRef<boolean>(false);
    const touchSkipChangeRef = React.useRef<boolean>(false);
    const [localText, setLocalText] = React.useState<string>(todo.text);
    const sanitizeSingleLine = React.useCallback((s: string): string => {
        // Replace line breaks with spaces; strip stray CR
        return s.replace(/\r/g, "").replace(/\n/g, " ");
    }, []);

    // Restore caret/selection after state-driven rerender
    React.useLayoutEffect(() => {
        if (localText.includes("\n")) {
            setLocalText(sanitizeSingleLine(localText));
        }
        if (selection.current && inputRef.current) {
            const { start, end } = selection.current;
            try {
                inputRef.current.setSelectionRange(start, end);
            } catch {}
            selection.current = null;
        }
        // Auto-resize textarea height to fit content
        if (inputRef.current) {
            const el = inputRef.current;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
        }
    }, [localText]);

    // Keep local text in sync with CRDT text when not actively editing
    React.useEffect(() => {
        const isFocused = document.activeElement === inputRef.current;
        if (!isComposingRef.current && !isFocused) {
            setLocalText(sanitizeSingleLine(todo.text));
        }
        // If focused or composing, defer sync until editing finishes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todo.text]);

    const isDone = todo.status === "done";

    // Report row height for transform-based layout; observe changes
    React.useLayoutEffect(() => {
        const el = rowRef.current;
        if (!el || !onHeightChange) return;
        const report = () => onHeightChange(todo.$cid, el.offsetHeight);
        report();
        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(() => report());
            ro.observe(el);
        }
        return () => {
            if (ro) ro.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localText, isDone]);
    return (
        <li
            className={`todo-item card${isDone ? " done" : ""}${dragging ? " dragging" : ""}${insertTop ? " insert-top" : ""}${insertBottom ? " insert-bottom" : ""}${textSelected ? " selected" : ""}`}
            ref={rowRef}
            data-cid={todo.$cid}
            style={style}
            onPointerDown={(e) => {
                if (
                    (e.target as HTMLElement | null)?.closest(".todo-checkbox")
                ) {
                    return;
                }
                onManualPointerDown?.(todo.$cid, e);
            }}
            onPointerMove={(e) => {
                if (
                    (e.target as HTMLElement | null)?.closest(".todo-checkbox")
                ) {
                    return;
                }
                onManualPointerMove?.(todo.$cid, e);
            }}
            onPointerUp={(e) => {
                if (
                    (e.target as HTMLElement | null)?.closest(".todo-checkbox")
                ) {
                    return;
                }
                onManualPointerUp?.(todo.$cid, e);
            }}
            onPointerCancel={(e) => {
                if (
                    (e.target as HTMLElement | null)?.closest(".todo-checkbox")
                ) {
                    return;
                }
                onManualPointerCancel?.(todo.$cid, e);
            }}
        >
            <button
                className="drag-handle"
                draggable={false}
                aria-label="Drag to reorder"
                title="Drag to reorder"
            >
                ☰
            </button>
            <div
                aria-checked={isDone}
                aria-label={isDone ? "Mark as todo" : "Mark as done"}
                tabIndex={detached ? -1 : 0}
                className={`todo-checkbox${isDone ? " checked" : ""}${detached ? " disabled" : ""}`}
                onPointerUp={(e) => {
                    if (detached) return;
                    if (e.pointerType === "touch") {
                        touchSkipChangeRef.current = true;
                        onDoneChange(todo.$cid, !isDone);
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }}
                onPointerCancel={(e) => {
                    if (e.pointerType === "touch") {
                        touchSkipChangeRef.current = false;
                    }
                }}
                onClick={(e) => {
                    if (detached) return;
                    if (touchSkipChangeRef.current) {
                        touchSkipChangeRef.current = false;
                        return;
                    }
                    onDoneChange(todo.$cid, !isDone);
                }}
            />
            <textarea
                ref={inputRef}
                className="todo-text"
                value={localText}
                rows={1}
                onPointerDown={(e) => {
                    if (textSelected || detached) return;
                    if (e.pointerType === "touch" || e.pointerType === "pen") {
                        // Prevent iOS long-press text selection when not selected yet
                        if (e.cancelable) e.preventDefault();
                        inputRef.current?.blur();
                    }
                }}
                onFocus={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                    onTextSelect?.(todo.$cid);
                }}
                onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                }}
                onBlur={() => {
                    onTextDeselect?.(todo.$cid);
                }}
                onKeyDown={(e) => {
                    if (!isComposingRef.current && e.key === "Enter") {
                        e.preventDefault();
                    }
                }}
                onCompositionStart={() => {
                    isComposingRef.current = true;
                }}
                onCompositionEnd={(e) => {
                    isComposingRef.current = false;
                    const start =
                        e.currentTarget.selectionStart ??
                        e.currentTarget.value.length;
                    const end = e.currentTarget.selectionEnd ?? start;
                    selection.current = { start, end };
                    // Commit the composed text once composition finishes
                    const v = sanitizeSingleLine(e.currentTarget.value);
                    setLocalText(v);
                    onTextChange(todo.$cid, v);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                }}
                onChange={(e) => {
                    const start =
                        e.currentTarget.selectionStart ??
                        e.currentTarget.value.length;
                    const end = e.currentTarget.selectionEnd ?? start;
                    selection.current = { start, end };
                    const v = sanitizeSingleLine(e.currentTarget.value);
                    setLocalText(v);
                    if (isComposingRef.current) return;
                    onTextChange(todo.$cid, v);
                }}
                readOnly={detached}
            />
            <button
                className="delete-btn"
                onClick={() => onDelete(todo.$cid)}
                aria-label="Delete todo"
                title="Delete"
                disabled={detached}
            >
                <StreamlinePlumpRecycleBin2Remix />
            </button>
        </li>
    );
}
