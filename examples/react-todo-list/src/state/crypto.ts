export const AUTH_SALT = "loro-public-sync-server" as const;

export function bytesToHex(arr: Uint8Array): string {
    let hex = "";
    for (let i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, "0");
    }
    return hex;
}

export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.trim().toLowerCase();
    if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        const byte = clean.slice(i * 2, i * 2 + 2);
        const value = Number.parseInt(byte, 16);
        if (Number.isNaN(value)) throw new Error("Invalid hex byte");
        out[i] = value;
    }
    return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = base64.length % 4 ? 4 - (base64.length % 4) : 0;
    const padded = base64 + "=".repeat(padLength);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

export async function exportRawPublicKeyHex(pubKey: CryptoKey): Promise<string> {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pubKey));
    return bytesToHex(raw);
}

export async function signSaltTokenHex(privateKey: CryptoKey): Promise<string> {
    const message = new TextEncoder().encode(AUTH_SALT);
    const signature = new Uint8Array(
        await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            privateKey,
            message,
        ),
    );
    return bytesToHex(signature);
}

export function buildAuthUrl(base: string, workspaceId: string, token: string): string {
    return `${base}/ws/${workspaceId}?token=${token}`;
}

export async function importKeyPairFromHex(
    publicHex: string,
    privateHex: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey } | null> {
    try {
        if (publicHex.length !== 130 || !publicHex.startsWith("04")) {
            return null;
        }
        const publicRaw = hexToBytes(publicHex);
        const x = publicRaw.slice(1, 33);
        const y = publicRaw.slice(33, 65);
        if (privateHex.length !== 64) return null;
        const d = hexToBytes(privateHex);

        const jwkPublic: JsonWebKey = {
            kty: "EC",
            crv: "P-256",
            x: bytesToBase64Url(x),
            y: bytesToBase64Url(y),
            ext: true,
        };
        const jwkPrivate: JsonWebKey = {
            kty: "EC",
            crv: "P-256",
            x: jwkPublic.x,
            y: jwkPublic.y,
            d: bytesToBase64Url(d),
            ext: true,
        };

        const publicKey = await crypto.subtle.importKey(
            "jwk",
            jwkPublic,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"],
        );
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            jwkPrivate,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign"],
        );

        const message = new TextEncoder().encode(AUTH_SALT);
        const signature = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            privateKey,
            message,
        );
        const verified = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            publicKey,
            signature,
            message,
        );
        if (!verified) return null;
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
    const keyPair = (await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    )) as CryptoKeyPair;
    const publicHex = await exportRawPublicKeyHex(keyPair.publicKey);
    const jwkPrivate = (await crypto.subtle.exportKey(
        "jwk",
        keyPair.privateKey,
    )) as JsonWebKey;
    const dBytes = base64UrlToBytes(jwkPrivate.d ?? "");
    const privateHex = bytesToHex(dBytes);
    const share = `${window.location.origin}/${publicHex}#${privateHex}`;
    return {
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        publicHex,
        privateHex,
        share,
    };
}
