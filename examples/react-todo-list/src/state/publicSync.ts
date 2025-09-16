import type { LoroDoc } from "loro-crdt";
import { createLoroAdaptorFromDoc } from "loro-adaptors";
import { ClientStatus, LoroWebsocketClient } from "loro-websocket";
import type { ClientStatusValue } from "loro-websocket";
import {
    base64UrlToBytes,
    buildAuthUrl,
    bytesToHex,
    exportRawPublicKeyHex,
    importKeyPairFromHex,
    signSaltTokenHex,
} from "./crypto";
import {
    getDocSnapshot,
    getWorkspace,
    listWorkspaces,
    openDocDb,
    type WorkspaceRecord,
    upsertWorkspace,
} from "./storage";
import { ROOM_ID, SYNC_BASE } from "./constants";

export { SYNC_BASE, ROOM_ID } from "./constants";

export type PublicSyncHandlers = {
    setDetached: (detached: boolean) => void;
    setOnline: (online: boolean) => void;
    setWorkspaceHex: (hex: string) => void;
    setShareUrl: (url: string) => void;
    setWorkspaces?: (list: WorkspaceRecord[]) => void;
    getWorkspaceTitle?: () => string;
    setConnectionStatus?: (status: ClientStatusValue) => void;
    setLatency?: (latency: number | null) => void;
};

export type PublicSyncSession = {
    client: LoroWebsocketClient | null;
    cleanup: () => Promise<void> | void;
};

export type WorkspaceConnectionKeys = {
    publicHex: string;
    privateHex: string;
};

export async function setupPublicSync(
    doc: LoroDoc,
    keys: WorkspaceConnectionKeys,
    handlers: PublicSyncHandlers,
): Promise<PublicSyncSession> {
    const adaptor = createLoroAdaptorFromDoc(doc);
    let roomCleanup: (() => Promise<void> | void) | null = null;
    let offStatus: (() => void) | null = null;
    let offLatency: (() => void) | null = null;
    let client: LoroWebsocketClient | null = null;

    try {
        const normalizedPub = keys.publicHex.trim().toLowerCase();
        const normalizedPriv = keys.privateHex.trim().toLowerCase();
        const imported = await importKeyPairFromHex(normalizedPub, normalizedPriv);
        if (!imported) {
            throw new Error("Invalid workspace keys");
        }
        const privateKey = imported.privateKey;
        const publicKey = imported.publicKey;
        const publicHex = await exportRawPublicKeyHex(publicKey);
        const jwkPriv = (await crypto.subtle.exportKey(
            "jwk",
            privateKey,
        )) as JsonWebKey;
        const dBytes = base64UrlToBytes(jwkPriv.d ?? "");
        const privateHex = bytesToHex(dBytes);
        const share = `${window.location.origin}/${publicHex}#${privateHex}`;

        handlers.setWorkspaceHex(publicHex);
        handlers.setShareUrl(share);

        try {
            const db = await openDocDb();
            const existing = await getWorkspace(db, publicHex);
            const now = Date.now();
            const record: WorkspaceRecord = {
                id: publicHex,
                privateHex,
                createdAt: existing?.createdAt ?? now,
                lastUsedAt: now,
                name:
                    handlers.getWorkspaceTitle?.() ||
                    existing?.name ||
                    existing?.label,
            };
            await upsertWorkspace(db, record);
            if (handlers.setWorkspaces) {
                const all = await listWorkspaces(db);
                handlers.setWorkspaces(all);
            }
            db.close();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("IndexedDB workspace save/list failed:", error);
        }

        try {
            const db = await openDocDb();
            const snapshot = await getDocSnapshot(db, publicHex);
            if (snapshot) {
                doc.import(new Uint8Array(snapshot));
            }
            db.close();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("IndexedDB load failed:", error);
        }

        const token = await signSaltTokenHex(privateKey);
        const url = buildAuthUrl(SYNC_BASE, publicHex, token);
        const activeClient = new LoroWebsocketClient({ url });
        client = activeClient;

        const applyStatus = (status: ClientStatusValue) => {
            handlers.setConnectionStatus?.(status);
            handlers.setOnline(status === ClientStatus.Connected);
            if (status === ClientStatus.Connected) {
                const currentLatency = activeClient.getLatency();
                if (currentLatency !== undefined) {
                    handlers.setLatency?.(currentLatency);
                }
            } else {
                handlers.setLatency?.(null);
            }
        };

        applyStatus(activeClient.getStatus());
        offStatus = activeClient.onStatusChange((status) => applyStatus(status));
        if (handlers.setLatency) {
            offLatency = activeClient.onLatency((ms) => {
                handlers.setLatency?.(ms);
            });
        }

        await activeClient.waitConnected();
        const room = await activeClient.join({
            roomId: ROOM_ID,
            crdtAdaptor: adaptor,
        });
        await room.waitForReachingServerVersion();
        handlers.setDetached(doc.isDetached());
        handlers.setOnline(true);
        try {
            void activeClient.ping().catch(() => undefined);
        } catch {
            /* noop */
        }

        roomCleanup = async () => {
            try {
                await room.destroy();
            } catch {
                /* noop */
            }
        };
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to connect to Loro public sync:", error);
        offStatus?.();
        offLatency?.();
        handlers.setConnectionStatus?.(ClientStatus.Disconnected);
        handlers.setLatency?.(null);
        handlers.setOnline(false);
    }

    const cleanup = () => {
        void roomCleanup?.();
        offStatus?.();
        offLatency?.();
        adaptor.destroy();
        handlers.setConnectionStatus?.(ClientStatus.Disconnected);
        handlers.setLatency?.(null);
        handlers.setOnline(false);
        if (client) {
            try {
                client.destroy();
            } catch {
                /* noop */
            }
            client = null;
        }
    };

    return { client, cleanup };
}
