// @ts-check

/**
 * @file PromptLogger.js
 * In-Memory Ring Buffer for tracking LLM prompt request/response pairs.
 *
 * Responsibilities:
 * - Records the last 5 prompt executions per type (dialogue, scheduler, demand, stabilizer).
 * - Tracks thinking chains, latency, status, and error details.
 * - Provides live subscription hooks for real-time DevTools updates.
 * - Supports clearing and querying logs by type.
 */

/**
 * Supported prompt categorizations in the simulation engine.
 * @typedef {"dialogue" | "scheduler" | "demand" | "stabilizer" | "situation"} PromptType
 */

/**
 * Detailed prompt request/response trace record.
 * @typedef {Object} PromptLogEntry
 * @property {string} id Unique UUID.
 * @property {PromptType} type Categorized prompt type.
 * @property {string} model Groq model ID used.
 * @property {number} timestamp Millisecond epoch when initiated.
 * @property {string} time Formatted 24-hour time string.
 * @property {number} latencyMs Total request round-trip time in milliseconds.
 * @property {"success" | "error"} status Execution status.
 * @property {Array<{ role: string, content: string }>} requestMessages Full request payload sent to model.
 * @property {string} rawResponse Full unparsed text returned by model.
 * @property {string|null} thinkingChain Extracted <think>...</think> reasoning chain.
 * @property {string|null} error Error description if request failed.
 * @property {Record<string, any>|null} groundingMetadata Google Search grounding metadata (queries, chunks, citations).
 * @property {number|null} tokensIn Prompt tokens consumed (usage.prompt_tokens).
 * @property {number|null} tokensOut Completion tokens generated (usage.completion_tokens).
 * @property {string|null} finishReason Final finish reason (e.g. "stop", "length").
 */

/**
 * In-Memory Ring Buffer tracking the last 5 request/response pairs and thinking chains
 * for all 4 simulation prompt types.
 */
export default class PromptLogger {

    /** 
     * Maximum entries retained per prompt type.
     * @readonly
     */
    static MAX_ENTRIES_PER_TYPE = 5;

    /** 
     * Category ring buffers.
     * @type {Record<PromptType, PromptLogEntry[]>} 
     */
    static _buffers = {
        dialogue: [],
        scheduler: [],
        demand: [],
        stabilizer: [],
        situation: []
    };

    /** 
     * Registered subscriber callbacks.
     * @type {Set<(entry: PromptLogEntry) => void>} 
     */
    static _subscribers = new Set();

    /**
     * Records a completed prompt execution into the ring buffer.
     *
     * @param {Object} options
     * @param {PromptType} options.type
     * @param {string} options.model
     * @param {number} options.startTime Millisecond epoch when request started.
     * @param {Array<{ role: string, content: string }>} options.requestMessages
     * @param {string} options.rawResponse
     * @param {string|null} [options.thinkingChain=null]
     * @param {Record<string, any>|null} [options.groundingMetadata=null] Google Search grounding metadata.
     * @param {"success" | "error"} [options.status="success"]
     * @param {string|null} [options.error=null]
     * @param {number|null} [options.tokensIn=null] Prompt token count.
     * @param {number|null} [options.tokensOut=null] Completion token count.
     * @param {string|null} [options.finishReason=null] Final finish reason from the model.
     * @returns {PromptLogEntry}
     */
    static record({
        type,
        model,
        startTime,
        requestMessages,
        rawResponse,
        thinkingChain = null,
        groundingMetadata = null,
        status = "success",
        error = null,
        tokensIn = null,
        tokensOut = null,
        finishReason = null
    }) {
        const now = new Date();
        const latencyMs = Math.max(1, now.getTime() - startTime);

        /** @type {PromptLogEntry} */
        const entry = {
            id: crypto.randomUUID(),
            type,
            model,
            timestamp: now.getTime(),
            time: now.toLocaleTimeString("en-GB", { hour12: false }),
            latencyMs,
            status,
            requestMessages,
            rawResponse,
            thinkingChain,
            groundingMetadata,
            error,
            tokensIn,
            tokensOut,
            finishReason
        };

        if (PromptLogger._buffers[type]) {
            PromptLogger._buffers[type].unshift(entry);
            if (PromptLogger._buffers[type].length > PromptLogger.MAX_ENTRIES_PER_TYPE) {
                PromptLogger._buffers[type].pop();
            }
        }

        for (const sub of PromptLogger._subscribers) {
            try {
                sub(entry);
            } catch (/** @type {unknown} */ err) {
                console.error("[PromptLogger] Subscriber error:", err);
            }
        }

        return entry;
    }

    /**
     * Retrieves the last 5 entries for a specific prompt type.
     *
     * @param {PromptType} type
     * @returns {PromptLogEntry[]}
     */
    static getLogsForType(type) {
        return PromptLogger._buffers[type] ? [...PromptLogger._buffers[type]] : [];
    }

    /**
     * Retrieves all recent prompt logs grouped by type.
     *
     * @returns {Record<PromptType, PromptLogEntry[]>}
     */
    static getAllLogs() {
        return {
            dialogue: [...PromptLogger._buffers.dialogue],
            scheduler: [...PromptLogger._buffers.scheduler],
            demand: [...PromptLogger._buffers.demand],
            stabilizer: [...PromptLogger._buffers.stabilizer],
            situation: [...PromptLogger._buffers.situation]
        };
    }

    /**
     * Subscribes a listener to live prompt logging events.
     *
     * @param {(entry: PromptLogEntry) => void} callback
     * @returns {() => void} Clean unsubscribe callback.
     */
    static onLog(callback) {
        if (typeof callback !== "function") return () => {};
        PromptLogger._subscribers.add(callback);
        return () => {
            PromptLogger._subscribers.delete(callback);
        };
    }

    /**
     * Wipes all stored prompt logs.
     * @returns {void}
     */
    static clear() {
        PromptLogger._buffers.dialogue = [];
        PromptLogger._buffers.scheduler = [];
        PromptLogger._buffers.demand = [];
        PromptLogger._buffers.stabilizer = [];
        PromptLogger._buffers.situation = [];
    }
}