/**
 * Service Worker for Tom & Friends PWA.
 *
 * Strategy: Cache-First for static assets (HTML, CSS, JS, images).
 * Network-First for API calls (falls back to offline).
 *
 * On install: Pre-cache the app shell.
 * On activate: Clean old caches.
 * On fetch: Serve from cache, fallback to network, then offline page.
 */

const CACHE_NAME = "tgf-shell-v1";
const OFFLINE_CACHE = "tgf-offline-v1";

/** App shell files to pre-cache on install */
const SHELL_FILES = [
    "/",
    "/index.html",
    "/group.png",
    "/manifest.json"
];

/**
 * Install event: Pre-cache app shell files.
 * @param {ExtendableEvent} event
 */
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
    );
});

/**
 * Activate event: Clean up old versioned caches.
 * @param {ExtendableEvent} event
 */
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME && name !== OFFLINE_CACHE)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

/**
 * Fetch event: Cache-first for static assets, network-first for API calls.
 * @param {FetchEvent} event
 */
self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests and cross-origin API calls
    if (request.method !== "GET") return;

    // For same-origin requests: cache-first strategy
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(request)
                .then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;

                    return fetch(request)
                        .then((networkResponse) => {
                            // Cache successful responses
                            if (networkResponse.ok) {
                                const responseClone = networkResponse.clone();
                                caches.open(CACHE_NAME).then((cache) => {
                                    cache.put(request, responseClone);
                                });
                            }
                            return networkResponse;
                        })
                        .catch(() => {
                            // Offline fallback: return cached index.html for navigation
                            if (request.mode === "navigate") {
                                return caches.match("/index.html");
                            }
                            return new Response("Offline", { status: 503 });
                        });
                })
        );
        return;
    }

    // For external API calls (Groq, Gemini, etc.): network-first, fail silently
    event.respondWith(
        fetch(request)
            .catch(() => {
                return new Response(
                    JSON.stringify({ error: "Offline" }),
                    {
                        status: 503,
                        headers: { "Content-Type": "application/json" }
                    }
                );
            })
    );
});
