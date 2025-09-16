import type { LoroDoc } from "loro-crdt";
import { createLoroAdaptorFromDoc } from "loro-adaptors";
import { LoroWebsocketClient } from "loro-websocket";
import {
    base64UrlToBytes,
    buildAuthUrl,
    bytesToHex,
    exportRawPublicKeyHex,
    generatePairAndUrl,
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
};

export async function setupPublicSync(
    doc: LoroDoc,
    handlers: PublicSyncHandlers,
): Promise<() => Promise<void> | void> {
    const adaptor = createLoroAdaptorFromDoc(doc);
    let roomCleanup: (() => Promise<void> | void) | null = null;

    try {
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
        const client = new LoroWebsocketClient({ url });
        await client.waitConnected();
        const room = await client.join({
            roomId: ROOM_ID,
            crdtAdaptor: adaptor,
        });
        await room.waitForReachingServerVersion();
        handlers.setDetached(doc.isDetached());
        handlers.setOnline(true);

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
        handlers.setOnline(false);
    }

    return () => {
        void roomCleanup?.();
        adaptor.destroy();
        handlers.setOnline(false);
    };
}
