// @ts-check

/**
 * @file NeedleRouter.js
 * Synchronous in-app Tier-3 query router.
 *
 * Extracts keyword and cast-member targets from user utterances with a pure
 * deterministic tokenizer — no Web Worker, no Wasm round-trip, no latency
 * budget. A route answers immediately (well under the 1ms budget) so the
 * dialogue pipeline is never blocked.
 *
 * @typedef {Object} NeedleRouteResult
 * @property {string[]} keywords 1-5 distinct search terms.
 * @property {string} member Target cast id ("tom" ... "becca") or "any".
 */

/** Cast ids recognised as memory tag targets. */
const MEMBERS = ["tom", "angela", "ben", "ginger", "hank", "becca"];

/** Precompiled word-boundary patterns so "thank you" never routes to hank. */
const MEMBER_PATTERNS = MEMBERS.map(
    (id) => /** @type {[string, RegExp]} */ ([id, new RegExp(`\\b${id}\\b`)])
);

/**
 * English + Hindi/Hinglish glue words that carry no retrieval value.
 * Filtered out before keywords are collected.
 */
const STOPWORDS = new Set([
    // English function words
    "about", "above", "after", "again", "against", "because", "been", "before",
    "below", "between", "both", "cannot", "could", "doing", "during", "each",
    "from", "further", "have", "having", "here", "hers", "herself", "himself",
    "into", "itself", "just", "more", "most", "other", "ought", "ours",
    "ourselves", "over", "same", "should", "some", "such", "than", "that",
    "their", "theirs", "them", "themselves", "then", "there", "these", "they",
    "this", "those", "through", "under", "until", "very", "were", "what",
    "when", "where", "which", "while", "with", "would", "your", "yours",
    "yourself", "yourselves",
    // Hindi / Hinglish glue words
    "aapka", "aapse", "abhi", "accha", "achha", "arre", "baare", "bahut",
    "batao", "bata", "chalo", "hain", "hoon", "hoga", "hogi", "inka",
    "inki", "karke", "karta", "karti", "kaise", "kaisa", "kaisi", "kaun",
    "kehte", "kahan", "kya", "kyaa", "kyunki", "kyun", "lekin", "liye", "matlab",
    "mein", "mera", "mere", "meri", "mujhe", "phir", "raha", "rahe",
    "rahi", "saath", "sunao", "theek", "thik", "tumhe", "tumhara", "unka",
    "unki", "waise", "wala", "wali", "wahan", "yahan", "yaar",
    // Conversational filler that carries no retrieval value
    "know", "remember", "said", "tell", "think", "thinking", "thought"
]);

/** Maximum keywords returned per route (Task 5: raised 3 → 5). */
const MAX_KEYWORDS = 5;

export default class NeedleRouter {

    constructor() {
        /**
         * The deterministic extractor is always available; `destroy()` flips
         * this to false to signal a torn-down engine to DevTools.
         * @type {boolean}
         */
        this.isReady = true;
    }

    /**
     * Deterministic inline extraction: cast member detection via word
     * boundaries, keyword extraction via stopword-filtered tokenization.
     * Pure, synchronous and allocation-light — runs in microseconds.
     *
     * @param {string} userText
     * @returns {NeedleRouteResult}
     */
    static extract(userText) {
        const lower = String(userText || "").toLowerCase();

        let member = "any";
        for (const [id, pattern] of MEMBER_PATTERNS) {
            if (pattern.test(lower)) {
                member = id;
                break;
            }
        }

        // Task 5: keep 3-letter keywords ("kal", "aaj", "tea", "car", "app",
        // "bus", "key", ...) — only 1-2 letter tokens are dropped.
        const words = lower
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOPWORDS.has(w));

        /** @type {string[]} */
        const keywords = [];
        for (const word of words) {
            if (!keywords.includes(word)) keywords.push(word);
            if (keywords.length >= MAX_KEYWORDS) break;
        }

        return { keywords, member };
    }

    /**
     * Extracts keywords and the target member tag from user input.
     * Resolves immediately (synchronously under the hood) and never rejects.
     *
     * @param {string} userText
     * @returns {Promise<NeedleRouteResult>}
     */
    async route(userText) {
        if (!userText || !userText.trim()) return { keywords: [], member: "any" };
        return NeedleRouter.extract(userText);
    }

    /** Signals engine teardown (used on logout / engine teardown). @returns {void} */
    destroy() {
        this.isReady = false;
    }
}
