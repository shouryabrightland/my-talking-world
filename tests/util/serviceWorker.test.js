// @ts-check

/**
 * @file serviceWorker.test.js
 * Covers the PWA update handshake:
 *  - registration always busts the HTTP cache (`updateViaCache: "none"`)
 *  - first controller claim must NOT reload the first page view
 *  - a real update shows the toast, reloads once (grace + manual button)
 *  - tabs re-check for deploys when they become visible again
 *  - registration is a no-op outside production builds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    initServiceWorker,
    registerServiceWorker,
    showUpdateToast,
} from "../../src/util/serviceWorker";

/** @type {any} Currently installed fake service-worker container. */
let fakeContainer = null;

/** @type {any} Currently installed fake registration. */
let fakeRegistration = null;

/**
 * Minimal EventTarget-ish helper.
 * @returns {{ addEventListener: (t: string, fn: () => void) => void, dispatch: (t: string) => void }}
 */
function makeEmitter() {
    /** @type {Record<string, Array<() => void>>} */
    const listeners = {};
    return {
        addEventListener(type, fn) {
            (listeners[type] ||= []).push(fn);
        },
        dispatch(type) {
            for (const fn of listeners[type] || []) fn();
        },
    };
}

/**
 * Builds a fake ServiceWorkerRegistration whose `update()` is a vi.fn().
 * @returns {any}
 */
function makeRegistration() {
    const emitter = makeEmitter();
    return {
        installing: null,
        update: vi.fn(async () => undefined),
        addEventListener: emitter.addEventListener,
        dispatch: emitter.dispatch,
    };
}

/**
 * Installs a fake `navigator.serviceWorker` for one test.
 * @param {{ controller?: object|null }} [opts]
 * @returns {{ container: any, registration: any }}
 */
function installFakeContainer({ controller = null } = {}) {
    const emitter = makeEmitter();
    fakeRegistration = makeRegistration();
    fakeContainer = {
        controller,
        register: vi.fn(async () => fakeRegistration),
        addEventListener: emitter.addEventListener,
        dispatch: emitter.dispatch,
    };
    Object.defineProperty(navigator, "serviceWorker", {
        value: fakeContainer,
        configurable: true,
        writable: true,
    });
    return { container: fakeContainer, registration: fakeRegistration };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const el of Array.from(document.body.querySelectorAll('[role="status"]'))) {
        el.remove();
    }
});

describe("showUpdateToast", () => {
    it("renders the update notice and reloads when 'Reload now' is clicked", () => {
        const onReload = vi.fn();
        const toast = showUpdateToast(onReload);

        expect(toast.getAttribute("role")).toBe("status");
        expect(toast.textContent).toContain("New version installed");

        const btn = toast.querySelector("button");
        expect(btn).toBeTruthy();
        btn?.click();
        expect(onReload).toHaveBeenCalledTimes(1);

        toast.remove();
    });
});

describe("initServiceWorker", () => {
    it("registers /sw.js with updateViaCache: none", async () => {
        const { container } = installFakeContainer();

        const reg = await initServiceWorker({ reload: vi.fn() });

        expect(container.register).toHaveBeenCalledWith("/sw.js", {
            updateViaCache: "none",
        });
        expect(reg).toBe(fakeRegistration);
    });

    it("returns null (and warns) when registration fails", async () => {
        installFakeContainer();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        fakeContainer.register.mockRejectedValueOnce(new Error("boom"));

        const reg = await initServiceWorker({ reload: vi.fn() });

        expect(reg).toBeNull();
        expect(warn).toHaveBeenCalled();
    });

    it("does not reload on the first controller claim, then reloads exactly once", async () => {
        const { container } = installFakeContainer({ controller: null });
        const reload = vi.fn();

        await initServiceWorker({ reload });

        // First claim (fresh install): page must not bounce.
        container.dispatch("controllerchange");
        expect(reload).not.toHaveBeenCalled();

        // Subsequent claim (a real update): toast + grace-period reload.
        container.dispatch("controllerchange");
        container.dispatch("controllerchange");
        const toast = document.body.querySelector('[role="status"]');
        expect(toast).toBeTruthy();
        expect(reload).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5_000);
        expect(reload).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(60_000);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("shows the toast and reloads when an update finishes installing", async () => {
        const { container, registration } = installFakeContainer({ controller: {} });
        const reload = vi.fn();

        await initServiceWorker({ reload });

        // A new worker is found and reaches "installed" while we have a controller.
        /** @type {any} */
        const worker = { state: "installing", ...makeEmitter() };
        registration.installing = worker;
        registration.dispatch("updatefound");
        worker.state = "installed";
        worker.dispatch("statechange");

        const toast = document.body.querySelector('[role="status"]');
        expect(toast?.textContent).toContain("New version installed");

        vi.advanceTimersByTime(5_000);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(container.register).toHaveBeenCalled();
    });

    it("ignores an install that happens before any controller exists", async () => {
        const { container, registration } = installFakeContainer({ controller: null });
        const reload = vi.fn();

        await initServiceWorker({ reload });

        /** @type {any} */
        const worker = { state: "installing", ...makeEmitter() };
        registration.installing = worker;
        registration.dispatch("updatefound");
        worker.state = "installed";
        worker.dispatch("statechange");

        container.dispatch("controllerchange");
        vi.advanceTimersByTime(10_000);
        expect(reload).not.toHaveBeenCalled();
        expect(document.body.querySelector('[role="status"]')).toBeNull();
    });

    it("re-checks for a new sw.js when the tab becomes visible again", async () => {
        installFakeContainer();
        const registration = await initServiceWorker({ reload: vi.fn() });
        registration?.update.mockClear();

        document.dispatchEvent(new Event("visibilitychange"));

        expect(registration?.update).toHaveBeenCalledTimes(1);
    });
});

describe("registerServiceWorker (production gate)", () => {
    it("never registers outside a production build", () => {
        const { container } = installFakeContainer();

        registerServiceWorker();
        window.dispatchEvent(new Event("load"));

        expect(container.register).not.toHaveBeenCalled();
    });
});
