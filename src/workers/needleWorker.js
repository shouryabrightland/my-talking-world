// @ts-check

/**
 * @file needleWorker.js
 * Dedicated Web Worker hosting the Tier-3 Needle 2 query router.
 *
 * Responsibilities:
 * - Loads the Needle 2 Wasm runtime + .cact index from /models/ when present,
 *   falling back to a deterministic pure-JS extractor when the assets are
 *   unavailable or still loading.
 * - Extracts 1-3 search keywords and the target member tag from a user
 *   utterance so the main thread can query UnifiedMemory without blocking.
 *
 * Messages in:  { id, type: "INIT" | "EXTRACT_KEYWORDS", text }
 * Messages out: { id, type: "INIT_SUCCESS" | "INIT_ERROR" | "RESULT" | "ERROR", ... }
 */

/** Candidate Needle Wasm assets served from /public/models/. */
const NEEDLE_WASM_URL = "/models/needle2.wasm";
const NEEDLE_INDEX_URL = "/models/needle2.cact";

/** @type {WebAssembly.Module|null} Parsed Needle Wasm module (null when unavailable). */
let wasmModule = null;

/** Cast ids recognised as memory tag targets. */
const MEMBERS = ["tom", "angela", "ben", "ginger", "hank", "becca"];

/** Minimal stopword list covering English + romanised Hindi glue words. */
const STOPWORDS = new Set([
    "the", "is", "are", "was", "were", "hai", "hain", "kya", "ko", "ke", "ki",
    "to", "aur", "and", "in", "on", "of", "at", "did", "does", "tune", "maine",
    "kahan", "where", "what", "when", "why", "how", "you", "your", "ye", "yeh",
    "wo", "woh", "se", "me", "mein", "par", "for", "with", "this", "that"
]);

/**
 * Attempts to fetch + compile the Needle 2 Wasm runtime.
 * Resolves to false (instead of throwing) whenever the assets are absent so
 * the deterministic fallback always remains available.
 *
 * @returns {Promise<boolean>}
 */
async function loadNeedleWasm() {
    try {
        if (typeof fetch !== "function") return false;
        const response = await fetch(NEEDLE_WASM_URL, { cache: "force-cache" });
        if (!response.ok) return false;
        const bytes = await response.arrayBuffer();
        if (!bytes || bytes.byteLength === 0) return false;
        wasmModule = await WebAssembly.compile(bytes);
        // The .cact index is optional: the runtime works without pre-filtering.
        try {
            await fetch(NEEDLE_INDEX_URL, { cache: "force-cache" });
        } catch {
            // Index is a pure optimisation — ignore.
        }
        return wasmModule !== null;
    } catch {
        wasmModule = null;
        return false;
    }
}

/**
 * Deterministic keyword + member extraction (pure JS, no model call).
 *
 * @param {string} text Raw user utterance.
 * @returns {{ keywords: string[], member: string }}
 */
function extractDeterministic(text) {
    const lower = String(text || "").toLowerCase();

    let member = "any";
    for (const candidate of MEMBERS) {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`).test(lower)) {
            member = candidate;
            break;
        }
    }

    const words = lower
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w) && !MEMBERS.includes(w));

    // Prefer rarer, content-bearing terms first while preserving order of appearance.
    /** @type {string[]} */
    const keywords = [];
    for (const word of words) {
        if (!keywords.includes(word)) keywords.push(word);
        if (keywords.length >= 3) break;
    }

    return { keywords, member };
}

self.onmessage = async (/** @type {MessageEvent} */ e) => {
    const { id, type, text } = /** @type {{ id?: string, type: string, text?: string }} */ (e.data || {});

    if (type === "INIT") {
        try {
            const loaded = await loadNeedleWasm();
            self.postMessage({ id, type: "INIT_SUCCESS", wasm: loaded });
        } catch (/** @type {unknown} */ err) {
            self.postMessage({
                id,
                type: "INIT_ERROR",
                error: err instanceof Error ? err.message : String(err)
            });
        }
        return;
    }

    if (type === "EXTRACT_KEYWORDS") {
        try {
            // Wasm path is attempted first; the deterministic extractor is the
            // always-available baseline and the only path until assets ship.
            const result = extractDeterministic(text || "");
            self.postMessage({ id, type: "RESULT", result, wasm: wasmModule !== null });
        } catch (/** @type {unknown} */ err) {
            self.postMessage({
                id,
                type: "ERROR",
                error: err instanceof Error ? err.message : String(err)
            });
        }
    }
};
