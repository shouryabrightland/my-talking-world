// @ts-check

/**
 * @file serviceWorker.js
 * Production service-worker registration + PWA update handshake.
 *
 * Why this exists: the old static `public/sw.js` was a cache-first placeholder
 * that never changed between deploys, so installed clients kept rendering the
 * old shell until the user deleted the app. The build now emits a
 * version-stamped `dist/sw.js` (see vite.config.js), and this module makes
 * sure clients actually pick it up:
 *
 *  - `updateViaCache: "none"` — never trust an HTTP-cached copy of `sw.js`.
 *  - Periodic `registration.update()` (on load, when the tab returns to
 *    visibility, and hourly) so long-lived tabs still notice deploys.
 *  - `updatefound` → toast telling the user a new version was installed,
 *    with a "Reload now" action.
 *  - `controllerchange` → reload once the new worker takes control (guarded
 *    against reload loops and against the very first install, which must not
 *    bounce the first page view).
 *
 * Registration is production-only: a service worker must never cache the dev
 * server's module graph.
 */

/** How often a visible tab re-checks for a new `sw.js`. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Grace period before the automatic reload so the toast can be read/clicked. */
const RELOAD_GRACE_MS = 5_000;

/**
 * Mounts a small non-blocking toast announcing the update.
 *
 * @param {() => void} onReload Invoked when the user clicks "Reload now".
 * @returns {HTMLElement}
 */
export function showUpdateToast(onReload) {
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.textContent = "🆕 New version installed — reloading shortly…";
    Object.assign(el.style, {
        position: "fixed",
        left: "50%",
        bottom: "72px",
        transform: "translateX(-50%)",
        zIndex: "2147483000",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        maxWidth: "90vw",
        padding: "8px 12px",
        borderRadius: "999px",
        background: "#111827",
        color: "#f9fafb",
        font: "500 13px/1.2 system-ui, sans-serif",
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)"
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Reload now";
    Object.assign(btn.style, {
        border: "none",
        borderRadius: "999px",
        padding: "5px 12px",
        background: "#3b82f6",
        color: "#fff",
        font: "600 12px/1 system-ui, sans-serif",
        cursor: "pointer"
    });
    btn.addEventListener("click", onReload);

    el.appendChild(btn);
    document.body.appendChild(el);
    return el;
}

/**
 * Registers the build-versioned service worker and wires the update handshake.
 * Exported (and unit-testable) separately from the production gate below.
 *
 * @param {{ reload?: () => void }} [options] Test seam for the reload action.
 * @returns {Promise<ServiceWorkerRegistration|null>} The registration, or null on failure.
 */
export async function initServiceWorker({ reload = () => window.location.reload() } = {}) {
    /** @type {ServiceWorkerRegistration|null} */
    let registration = null;
    /** Whether a controller existed before this update (first install = false). */
    let hadController = Boolean(navigator.serviceWorker?.controller);
    let toastShown = false;
    let reloadScheduled = false;

    /**
     * Shows the update toast (once) and reloads after a short grace period.
     * @param {boolean} immediate
     */
    const scheduleReload = (immediate) => {
        if (reloadScheduled) return;
        reloadScheduled = true;
        if (!toastShown) {
            toastShown = true;
            showUpdateToast(() => reload());
        }
        window.setTimeout(() => reload(), immediate ? 0 : RELOAD_GRACE_MS);
    };

    // A new worker took control: either the first install (no prior
    // controller — nothing to reload) or a real update (reload once).
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) {
            hadController = true;
            return;
        }
        scheduleReload(false);
    });

    try {
        registration = await navigator.serviceWorker.register("/sw.js", {
            updateViaCache: "none"
        });
    } catch (err) {
        console.warn("[sw] registration failed:", err);
        return null;
    }

    // An update was found while the page was already under SW control.
    registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
            if (installing.state !== "installed") return;
            if (navigator.serviceWorker.controller) scheduleReload(false);
        });
    });

    // Re-check for deploys when the user returns to the tab …
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            void registration?.update().catch(() => undefined);
        }
    });

    // … and periodically while the tab stays open.
    window.setInterval(() => {
        void registration?.update().catch(() => undefined);
    }, UPDATE_CHECK_INTERVAL_MS);

    return registration;
}

/**
 * Registers the production service worker and wires the update handshake.
 * Safe to call once at startup; no-ops outside production builds.
 *
 * @returns {void}
 */
export function registerServiceWorker() {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // The load event may already have fired if this module evaluates late.
    if (document.readyState === "complete") {
        void initServiceWorker();
        return;
    }
    window.addEventListener("load", () => {
        void initServiceWorker();
    });
}
