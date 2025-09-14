import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { LoroDoc, UndoManager } from "loro-crdt";
import { schema } from "loro-mirror";
import { useLoroStore } from "loro-mirror-react";
import { HistoryView } from "./HistoryView";
import { LoroWebsocketClient } from "loro-websocket";
import { createLoroAdaptorFromDoc } from "loro-adaptors";

// --------------------
// Public Sync constants
// --------------------
export const AUTH_SALT = "loro-public-sync-server" as const;
export const SYNC_BASE =
    "wss://loro-public-free-sync-server.remch183.workers.dev" as const;
export const ROOM_ID = "react-todo-list" as const;

// --------------------
// Encoding helpers
// --------------------
export function bytesToHex(arr: Uint8Array): string {
    let s = "";
    for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        s += b.toString(16).padStart(2, "0");
    }
    return s;
}

export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.trim().toLowerCase();
    if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        const byte = clean.slice(i * 2, i * 2 + 2);
        const v = Number.parseInt(byte, 16);
        if (Number.isNaN(v)) throw new Error("Invalid hex byte");
        out[i] = v;
    }
    return out;
}

export function bytesToBase64Url(u8: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = btoa(bin);
    return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlToBytes(s: string): Uint8Array {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
    const b64p = b64 + "=".repeat(pad);
    const bin = atob(b64p);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// --------------------
// Crypto helpers
// --------------------
export async function exportRawPublicKeyHex(pubKey: CryptoKey): Promise<string> {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pubKey));
    // 65 bytes: 0x04 || X(32) || Y(32)
    return bytesToHex(raw);
}

export async function signSaltTokenHex(privateKey: CryptoKey): Promise<string> {
    const msg = new TextEncoder().encode(AUTH_SALT);
    const sig = new Uint8Array(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, msg),
    );
    // DER signature bytes -> hex
    return bytesToHex(sig);
}

export function buildAuthUrl(base: string, workspaceId: string, token: string) {
    return `${base}/ws/${workspaceId}?token=${token}`;
}

export async function importKeyPairFromHex(
    publicHex: string,
    privateHex: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey } | null> {
    try {
        // publicHex: 65 bytes, starts with 0x04
        if (publicHex.length !== 130 || !publicHex.startsWith("04")) {
            return null;
        }
        const pubRaw = hexToBytes(publicHex);
        const x = pubRaw.slice(1, 33);
        const y = pubRaw.slice(33, 65);
        if (privateHex.length !== 64) return null;
        const d = hexToBytes(privateHex);

        const jwkPub: JsonWebKey = {
            kty: "EC",
            crv: "P-256",
            x: bytesToBase64Url(x),
            y: bytesToBase64Url(y),
            ext: true,
        };
        const jwkPriv: JsonWebKey = {
            kty: "EC",
            crv: "P-256",
            x: jwkPub.x,
            y: jwkPub.y,
            d: bytesToBase64Url(d),
            ext: true,
        };

        const publicKey = await crypto.subtle.importKey(
            "jwk",
            jwkPub,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"],
        );
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            jwkPriv,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign"],
        );

        // Validate the pair by sign/verify of the fixed salt
        const msg = new TextEncoder().encode(AUTH_SALT);
        const sig = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            privateKey,
            msg,
        );
        const ok = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            publicKey,
            sig,
            msg,
        );
        if (!ok) return null;
        return { privateKey, publicKey };
    } catch {
        return null;
    }
}

export async function generatePairAndUrl(): Promise<{
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicHex: string;
    privateHex: string;
    share: string;
}> {
    const { publicKey, privateKey } = (await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    )) as CryptoKeyPair;
    const publicHex = await exportRawPublicKeyHex(publicKey);
    const jwkPriv = (await crypto.subtle.exportKey("jwk", privateKey)) as JsonWebKey;
    const dB64 = jwkPriv.d ?? "";
    const dBytes = base64UrlToBytes(dB64);
    const privateHex = bytesToHex(dBytes);
    const share = `${window.location.origin}/${publicHex}#${privateHex}`;
    return { privateKey, publicKey, publicHex, privateHex, share };
}

// --------------------
// IndexedDB persistence helpers
// --------------------
const DOC_DB_NAME = "loro-example-docs" as const;
const DOC_DB_VERSION = 1 as const;
const DOC_STORE = "docs" as const;
const KEY_STORE = "keys" as const;

type DocRecord = { id: string; snapshot: ArrayBuffer };
export type WorkspaceRecord = {
    id: string; // public key hex
    privateHex: string; // private key hex
    createdAt: number;
    lastUsedAt: number;
    // Persisted workspace display name
    name?: string;
    // Back-compat field
    label?: string;
};

export function openDocDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request: IDBOpenDBRequest = indexedDB.open(
            DOC_DB_NAME,
            DOC_DB_VERSION,
        );
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DOC_STORE)) {
                db.createObjectStore(DOC_STORE, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(KEY_STORE)) {
                db.createObjectStore(KEY_STORE, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IDB error"));
    });
}

export function putDocSnapshot(
    db: IDBDatabase,
    id: string,
    bytes: Uint8Array,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DOC_STORE, "readwrite");
        const store = tx.objectStore(DOC_STORE);
        const start = bytes.byteOffset;
        const end = start + bytes.byteLength;
        const snap = bytes.buffer.slice(start, end);
        const putReq = store.put({ id, snapshot: snap } satisfies DocRecord);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error ?? new Error("IDB put error"));
    });
}

export function getDocSnapshot(
    db: IDBDatabase,
    id: string,
): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DOC_STORE, "readonly");
        const store = tx.objectStore(DOC_STORE);
        const getReq = store.get(id) as IDBRequest<DocRecord | undefined>;
        getReq.onsuccess = () => {
            const rec = getReq.result as DocRecord | undefined;
            if (rec && rec.snapshot) {
                resolve(new Uint8Array(rec.snapshot));
            } else {
                resolve(null);
            }
        };
        getReq.onerror = () => reject(getReq.error ?? new Error("IDB get error"));
    });
}

export function upsertWorkspace(
    db: IDBDatabase,
    rec: WorkspaceRecord,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        const store = tx.objectStore(KEY_STORE);
        const putReq = store.put(rec);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error ?? new Error("IDB put error"));
    });
}

export function getWorkspace(
    db: IDBDatabase,
    id: string,
): Promise<WorkspaceRecord | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readonly");
        const store = tx.objectStore(KEY_STORE);
        const req = store.get(id) as IDBRequest<WorkspaceRecord | undefined>;
        req.onsuccess = () => resolve(req.result as WorkspaceRecord | undefined);
        req.onerror = () => reject(req.error ?? new Error("IDB get error"));
    });
}

export function listWorkspaces(db: IDBDatabase): Promise<WorkspaceRecord[]> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readonly");
        const store = tx.objectStore(KEY_STORE);
        const req = store.getAll() as IDBRequest<WorkspaceRecord[]>;
        req.onsuccess = () => {
            const res = (req.result ?? []) as WorkspaceRecord[];
            res.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
            resolve(res);
        };
        req.onerror = () => reject(req.error ?? new Error("IDB getAll error"));
    });
}

export function deleteWorkspace(
    db: IDBDatabase,
    id: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        const store = tx.objectStore(KEY_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("IDB delete error"));
    });
}

type TodoStatus = "todo" | "done";

const todoSchema = schema({
    workspace: schema.LoroMap({
        name: schema.String(),
    }),
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true },
        ),
        (t) => t.$cid,
    ),
});

export function App() {
    const doc = useMemo(() => {
        const doc = new LoroDoc();
        doc.setRecordTimestamp(true);
        doc.setChangeMergeInterval(1);
        return doc;
    }, []);
    (window as unknown as { doc?: LoroDoc }).doc = doc;
    const undo = useMemo(() => new UndoManager(doc, {}), [doc]);

    const { state, setState } = useLoroStore({
        doc,
        schema: todoSchema,
        initialState: { todos: [], workspace: { name: "Untitled Workspace" } },
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
    const [copied, setCopied] = useState<boolean>(false);
    const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
    const [routeEpoch, setRouteEpoch] = useState<number>(0);
    const [workspaceTitle, setWorkspaceTitle] = useState<string>("Untitled Workspace");
    const wsDebounceRef = useRef<number | undefined>(undefined);

    // Public Sync helpers/consts moved to module scope above for clarity

    useEffect(() => {
        let stopped = false;
        const adaptor = createLoroAdaptorFromDoc(doc);

        let roomCleanup: (() => Promise<void> | void) | null = null;

        (async () => {
            try {
                // Parse keys from URL if present; otherwise generate and update URL.
                const pathParts = window.location.pathname
                    .split("/")
                    .filter(Boolean);
                const maybePubHex =
                    pathParts.length >= 1
                        ? pathParts[pathParts.length - 1]
                        : "";
                const maybePrivHex = window.location.hash.startsWith("#")
                    ? window.location.hash.slice(1)
                    : "";

                let privateKey: CryptoKey;
                let publicKey: CryptoKey;
                let publicHex: string;
                let privateHex: string;
                let share: string;

                const imported =
                    maybePubHex && maybePrivHex
                        ? await importKeyPairFromHex(
                              maybePubHex.toLowerCase(),
                              maybePrivHex.toLowerCase(),
                          )
                        : null;

                if (imported) {
                    privateKey = imported.privateKey;
                    publicKey = imported.publicKey;
                    publicHex = await exportRawPublicKeyHex(publicKey);
                    // Ensure the path is normalized and compute privateHex from JWK
                    const jwkPriv = (await crypto.subtle.exportKey(
                        "jwk",
                        privateKey,
                    )) as JsonWebKey;
                    const dBytes = base64UrlToBytes(jwkPriv.d ?? "");
                    privateHex = bytesToHex(dBytes);
                    share = `${window.location.origin}/${publicHex}#${privateHex}`;
                    if (
                        window.location.pathname !== `/${publicHex}` ||
                        window.location.hash !== `#${privateHex}`
                    ) {
                        history.replaceState(
                            null,
                            "",
                            `/${publicHex}#${privateHex}`,
                        );
                    }
                } else {
                    const generated = await generatePairAndUrl();
                    privateKey = generated.privateKey;
                    publicKey = generated.publicKey;
                    publicHex = generated.publicHex;
                    privateHex = generated.privateHex;
                    share = generated.share;
                    history.replaceState(
                        null,
                        "",
                        `/${publicHex}#${privateHex}`,
                    );
                }

                setWorkspaceHex(publicHex);
                setShareUrl(share);

                // Persist the workspace key pair and refresh the list
                try {
                    const db = await openDocDb();
                    const existing = await getWorkspace(db, publicHex);
                    const now = Date.now();
                    const rec: WorkspaceRecord = {
                        id: publicHex,
                        privateHex,
                        createdAt: existing?.createdAt ?? now,
                        lastUsedAt: now,
                        name: workspaceTitle || existing?.name || existing?.label,
                    };
                    await upsertWorkspace(db, rec);
                    const all = await listWorkspaces(db);
                    setWorkspaces(all);
                    db.close();
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn("IndexedDB workspace save/list failed:", e);
                }

                // Try to load any persisted snapshot before connecting
                try {
                    const db = await openDocDb();
                    const snap = await getDocSnapshot(db, publicHex);
                    if (snap) {
                        doc.import(snap);
                    }
                    db.close();
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn("IndexedDB load failed:", e);
                }

                const token = await signSaltTokenHex(privateKey);
                const url = buildAuthUrl(SYNC_BASE, publicHex, token);
                const client = new LoroWebsocketClient({ url });
                await client.waitConnected();
                if (stopped) return;
                const room = await client.join({
                    roomId: ROOM_ID,
                    crdtAdaptor: adaptor,
                });
                // Wait until we're caught up with server
                await room.waitForReachingServerVersion();
                // reflect attached state in UI
                setDetached(doc.isDetached());
                setOnline(true);

                roomCleanup = async () => {
                    try {
                        await room.destroy();
                    } catch {
                        /* ignore */
                    }
                };
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("Failed to connect to Loro public sync:", err);
                setOnline(false);
            }
        })();

        return () => {
            stopped = true;
            void roomCleanup?.();
            adaptor.destroy();
            setOnline(false);
        };
        // doc is stable (memoized), setDetached is stable from React
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

    const switchToWorkspace = useCallback(async (id: string) => {
        try {
            const db = await openDocDb();
            const rec = await getWorkspace(db, id);
            db.close();
            if (!rec) return;
            history.replaceState(null, "", `/${rec.id}#${rec.privateHex}`);
            setRouteEpoch((x) => x + 1);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Switch workspace failed:", e);
        }
    }, []);

    const createNewWorkspace = useCallback(async () => {
        const gen = await generatePairAndUrl();
        history.replaceState(null, "", `/${gen.publicHex}#${gen.privateHex}`);
        setRouteEpoch((x) => x + 1);
    }, []);

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
                history.replaceState(null, "", `/${next.id}#${next.privateHex}`);
            } else {
                const gen = await generatePairAndUrl();
                history.replaceState(null, "", `/${gen.publicHex}#${gen.privateHex}`);
            }
            setRouteEpoch((x) => x + 1);
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
                <div className="workspace-title">
                    <input
                        className="workspace-title-input"
                        value={workspaceTitle}
                        onChange={(e) => {
                            const v = e.currentTarget.value;
                            setWorkspaceTitle(v);
                            if (wsDebounceRef.current) window.clearTimeout(wsDebounceRef.current);
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
                </div>
                <div className="header-controls" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <label style={{ fontSize: 12, opacity: 0.8 }}>Workspace:</label>
                        {(() => {
                            // Build option list with names
                            const options: { id: string; name: string }[] = [];
                            // Ensure current workspace appears first
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
                                    name: w.name || w.label || w.id.slice(0, 16),
                                });
                            }
                            const optionIds = options.map((o) => o.id);
                            const onChange = async (v: string) => {
                                if (v === "__create__") {
                                    await createNewWorkspace();
                                    return;
                                }
                                if (v === "__delete__") {
                                    await removeCurrentWorkspace();
                                    return;
                                }
                                await switchToWorkspace(v);
                            };
                            return (
                                <select
                                    className="select"
                                    value={workspaceHex || (optionIds[0] ?? "")}
                                    onChange={(e) => void onChange(e.currentTarget.value)}
                                >
                                    {optionIds.length === 0 && (
                                        <option value="" disabled>
                                            Loading…
                                        </option>
                                    )}
                                    {options.map(({ id, name }) => (
                                        <option key={id} value={id}>
                                            {name}
                                        </option>
                                    ))}
                                    <optgroup label="Actions">
                                        <option value="__create__">＋ New workspace…</option>
                                        {workspaceHex && (
                                            <option value="__delete__">🗑 Delete current…</option>
                                        )}
                                    </optgroup>
                                </select>
                            );
                        })()}
                    </div>
                    <span
                        className="status-inline btn-text"
                        title={online ? "Online" : "Offline"}
                        aria-live="polite"
                        aria-label={online ? "Online" : "Offline"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                        <span
                            style={{
                                color: online ? "#29a329" : "#c0392b",
                            }}
                        >
                            {online ? "●" : "○"}
                        </span>
                        {online ? "Online" : "Offline"}
                    </span>
                    <button
                        className="btn-text"
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(shareUrl);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1600);
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
                    {copied && (
                        <span style={{ fontSize: 12 }}>
                            Link copied — invite others with this URL
                        </span>
                    )}
                </div>
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
                    className="btn btn-secondary"
                    onClick={() => {
                        undo.undo();
                    }}
                    disabled={!undo.canUndo?.() || detached}
                >
                    <span className="btn-icon" aria-hidden>
                        ⟲
                    </span>
                    Undo
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        undo.redo();
                    }}
                    disabled={!undo.canRedo?.() || detached}
                >
                    <span className="btn-icon" aria-hidden>
                        ⟳
                    </span>
                    Redo
                </button>
                <button
                    className="btn btn-secondary push-right"
                    onClick={() => setShowHistory((v) => !v)}
                >
                    {showHistory ? "Hide History" : "History"}
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
                Built by <a href="https://loro.dev" target="_blank" rel="noopener noreferrer">Loro</a>
            </footer>
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
