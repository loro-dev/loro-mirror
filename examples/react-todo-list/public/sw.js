/* Simple service worker for offline support */
const CACHE_NAME = "todo-pwa-v1";
const APP_SHELL = [
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/offline.html",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((k) => k !== CACHE_NAME)
                    .map((k) => caches.delete(k)),
            );
            await self.clients.claim();
        })(),
    );
});

// Navigation requests: network-first with offline fallbacks
async function handleNavigate(request) {
    try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put("/", fresh.clone());
        return fresh;
    } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const cached =
            (await cache.match("/index.html")) || (await cache.match("/"));
        return cached || (await cache.match("/offline.html"));
    }
}

// Static assets: cache-first, update in background
async function handleAsset(request) {
    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;
    if (!sameOrigin) return fetch(request);

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fetchAndUpdate = fetch(request)
        .then((resp) => {
            if (resp && resp.status === 200 && resp.type !== "opaque") {
                cache.put(request, resp.clone());
            }
            return resp;
        })
        .catch(() => undefined);

    return cached || fetchAndUpdate || fetch(request);
}

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    // Handle navigation requests
    if (request.mode === "navigate") {
        event.respondWith(handleNavigate(request));
        return;
    }

    // Runtime caching for same-origin assets
    event.respondWith(handleAsset(request));
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});
