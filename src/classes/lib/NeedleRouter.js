// @ts-check

/**
 * @file NeedleRouter.js
 * In-app Tier-3 query router.
 *
 * Dispatches user utterances to the Needle 2 Web Worker for keyword/member
 * extraction and always resolves within a hard 300ms budget — the deterministic
 * inline fallback guarantees the dialogue pipeline is never blocked on Wasm.
 *
 * @typedef {Object} NeedleRouteResult
 * @property {string[]} keywords 1-3 distinct search terms.
 * @property {string} member Target cast id ("tom" ... "becca") or "any".
 */

/** Hard latency budget for a worker round-trip before the fallback answers. */
const ROUTE_TIMEOUT_MS = 300;

/** Cast ids recognised as memory tag targets. */
const MEMBERS = ["tom", "angela", "ben", "ginger", "hank", "becca"];

export default class NeedleRouter {

    constructor() {
        /** @type {Worker|null} */
        this.worker = null;

        /** @type {boolean} */
        this.isReady = false;

        if (typeof Worker !== "undefined") {
            try {
                this.worker = new Worker(
                    new URL("../../workers/needleWorker.js", import.meta.url),
                    { type: "module" }
                );
                this.worker.postMessage({ type: "INIT" });
                this.isReady = true;
            } catch {
                this.isReady = false;
                this.worker = null;
            }
        }
    }

    /**
     * Deterministic inline extraction used when the worker is unavailable or
     * exceeds the latency budget.
     *
     * @param {string} userText
     * @returns {NeedleRouteResult}
     */
    static fallbackRoute(userText) {
        const lower = String(userText || "").toLowerCase();

        let member = "any";
        for (const candidate of MEMBERS) {
            if (lower.includes(candidate)) {
                member = candidate;
                break;
            }
        }

        const words = lower
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w.length > 3);

        /** @type {string[]} */
        const keywords = [];
        for (const word of words) {
            if (!keywords.includes(word)) keywords.push(word);
            if (keywords.length >= 3) break;
        }

        return { keywords, member };
    }

    /**
     * Extracts keywords and the target member tag from user input.
     * Resolves with `keywords: []` on empty input and never rejects.
     *
     * @param {string} userText
     * @returns {Promise<NeedleRouteResult>}
     */
    async route(userText) {
        if (!userText || !userText.trim()) return { keywords: [], member: "any" };

        if (!this.worker || !this.isReady) {
            return NeedleRouter.fallbackRoute(userText);
        }

        const worker = this.worker;
        const reqId = crypto.randomUUID();

        return new Promise((resolve) => {
            /** @type {ReturnType<typeof setTimeout>|null} */
            let timer = null;

            const handler = (/** @type {MessageEvent} */ e) => {
                const data = /** @type {{ id?: string, result?: NeedleRouteResult }} */ (e.data || {});
                if (data.id !== reqId) return;
                if (timer !== null) clearTimeout(timer);
                worker.removeEventListener("message", handler);
                resolve(data.result || { keywords: [], member: "any" });
            };

            worker.addEventListener("message", handler);

            timer = setTimeout(() => {
                worker.removeEventListener("message", handler);
                resolve(NeedleRouter.fallbackRoute(userText));
            }, ROUTE_TIMEOUT_MS);

            worker.postMessage({ id: reqId, type: "EXTRACT_KEYWORDS", text: userText });
        });
    }

    /** Terminates the worker (used on logout / engine teardown). @returns {void} */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}
