import { LoroDoc, UndoManager } from "loro-crdt";
import { schema } from "loro-mirror";
import { LoroWebsocketClient } from "loro-websocket";
import { createLoroAdaptorFromDoc } from "loro-adaptors";

// --------------------
// Public Sync constants
// --------------------
export const AUTH_SALT = "loro-public-sync-server" as const;
export const SYNC_BASE = "wss://sync.loro.dev" as const;
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
export async function exportRawPublicKeyHex(
    pubKey: CryptoKey,
): Promise<string> {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pubKey));
    // 65 bytes: 0x04 || X(32) || Y(32)
    return bytesToHex(raw);
}

export async function signSaltTokenHex(privateKey: CryptoKey): Promise<string> {
    const msg = new TextEncoder().encode(AUTH_SALT);
    const sig = new Uint8Array(
        await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            privateKey,
            msg,
        ),
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
    const jwkPriv = (await crypto.subtle.exportKey(
        "jwk",
        privateKey,
    )) as JsonWebKey;
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
const DOC_DB_VERSION = 2 as const; // bump to ensure all stores exist
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
        putReq.onerror = () =>
            reject(putReq.error ?? new Error("IDB put error"));
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
        getReq.onerror = () =>
            reject(getReq.error ?? new Error("IDB get error"));
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
        putReq.onerror = () =>
            reject(putReq.error ?? new Error("IDB put error"));
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
        req.onsuccess = () =>
            resolve(req.result as WorkspaceRecord | undefined);
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

export function deleteWorkspace(db: IDBDatabase, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        const store = tx.objectStore(KEY_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("IDB delete error"));
    });
}

// --------------------
// Loro schema and doc builders
// --------------------
export type TodoStatus = "todo" | "done";

export const todoSchema = schema({
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

export const initialTodoState = {
    todos: [] as { $cid?: string; text: string; status: TodoStatus }[],
    workspace: { name: "Untitled Workspace" },
};

export function createConfiguredDoc(): LoroDoc {
    const d = new LoroDoc();
    d.setRecordTimestamp(true);
    d.setChangeMergeInterval(1);
    return d;
}

export function createUndoManager(doc: LoroDoc): UndoManager {
    return new UndoManager(doc, {});
}

// --------------------
// Public sync setup for a LoroDoc
// --------------------
export type PublicSyncHandlers = {
    setDetached: (detached: boolean) => void;
    setOnline: (online: boolean) => void;
    setWorkspaceHex: (hex: string) => void;
    setShareUrl: (url: string) => void;
    setWorkspaces?: (list: WorkspaceRecord[]) => void;
    getWorkspaceTitle?: () => string;
};

export async function setupPublicSync(
    doc: LoroDoc,
    handlers: PublicSyncHandlers,
): Promise<() => Promise<void> | void> {
    const adaptor = createLoroAdaptorFromDoc(doc);
    let roomCleanup: (() => Promise<void> | void) | null = null;

    try {
        // Parse keys from URL if present; otherwise generate and update URL.
        const pathParts = window.location.pathname.split("/").filter(Boolean);
        const maybePubHex =
            pathParts.length >= 1 ? pathParts[pathParts.length - 1] : "";
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
                history.replaceState(null, "", `/${publicHex}#${privateHex}`);
            }
        } else {
            const generated = await generatePairAndUrl();
            privateKey = generated.privateKey;
            publicKey = generated.publicKey;
            publicHex = generated.publicHex;
            privateHex = generated.privateHex;
            share = generated.share;
            history.replaceState(null, "", `/${publicHex}#${privateHex}`);
        }

        handlers.setWorkspaceHex(publicHex);
        handlers.setShareUrl(share);

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
                name:
                    handlers.getWorkspaceTitle?.() ||
                    existing?.name ||
                    existing?.label,
            };
            await upsertWorkspace(db, rec);
            if (handlers.setWorkspaces) {
                const all = await listWorkspaces(db);
                handlers.setWorkspaces(all);
            }
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
        const room = await client.join({
            roomId: ROOM_ID,
            crdtAdaptor: adaptor,
        });
        // Wait until we're caught up with server
        await room.waitForReachingServerVersion();
        // reflect attached state in UI
        handlers.setDetached(doc.isDetached());
        handlers.setOnline(true);

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
        handlers.setOnline(false);
    }

    return () => {
        void roomCleanup?.();
        adaptor.destroy();
        handlers.setOnline(false);
    };
}

// --------------------
// Simple helpers for workspace navigation
// --------------------
export async function switchToWorkspace(id: string): Promise<void> {
    const db = await openDocDb();
    const rec = await getWorkspace(db, id);
    db.close();
    if (!rec) return;
    window.location.assign(`/${rec.id}#${rec.privateHex}`);
}

export async function createNewWorkspace(): Promise<void> {
    const gen = await generatePairAndUrl();
    window.location.assign(`/${gen.publicHex}#${gen.privateHex}`);
}
