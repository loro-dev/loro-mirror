const DOC_DB_NAME = "loro-example-docs" as const;
const DOC_DB_VERSION = 2 as const;
const DOC_STORE = "docs" as const;
const KEY_STORE = "keys" as const;

export type DocRecord = { id: string; snapshot: ArrayBuffer };
export type WorkspaceRecord = {
    id: string;
    privateHex: string;
    createdAt: number;
    lastUsedAt: number;
    name?: string;
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
        request.onerror = () => reject(request.error ?? new Error("IDB open error"));
    });
}

export function putDocSnapshot(
    db: IDBDatabase,
    id: string,
    snapshot: ArrayBuffer,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DOC_STORE, "readwrite");
        const store = tx.objectStore(DOC_STORE);
        const request = store.put({ id, snapshot } satisfies DocRecord);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("IDB put error"));
    });
}

export function getDocSnapshot(
    db: IDBDatabase,
    id: string,
): Promise<ArrayBuffer | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DOC_STORE, "readonly");
        const store = tx.objectStore(DOC_STORE);
        const request = store.get(id) as IDBRequest<DocRecord | undefined>;
        request.onsuccess = () => {
            const record = request.result as DocRecord | undefined;
            resolve(record?.snapshot);
        };
        request.onerror = () => reject(request.error ?? new Error("IDB get error"));
    });
}

export function upsertWorkspace(
    db: IDBDatabase,
    record: WorkspaceRecord,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        const store = tx.objectStore(KEY_STORE);
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("IDB put error"));
    });
}

export function getWorkspace(
    db: IDBDatabase,
    id: string,
): Promise<WorkspaceRecord | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readonly");
        const store = tx.objectStore(KEY_STORE);
        const request = store.get(id) as IDBRequest<WorkspaceRecord | undefined>;
        request.onsuccess = () =>
            resolve(request.result as WorkspaceRecord | undefined);
        request.onerror = () => reject(request.error ?? new Error("IDB get error"));
    });
}

export function listWorkspaces(db: IDBDatabase): Promise<WorkspaceRecord[]> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readonly");
        const store = tx.objectStore(KEY_STORE);
        const request = store.getAll() as IDBRequest<WorkspaceRecord[]>;
        request.onsuccess = () => {
            const records = (request.result ?? []) as WorkspaceRecord[];
            records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
            resolve(records);
        };
        request.onerror = () => reject(request.error ?? new Error("IDB getAll error"));
    });
}

export function deleteWorkspace(db: IDBDatabase, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        const store = tx.objectStore(KEY_STORE);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("IDB delete error"));
    });
}
