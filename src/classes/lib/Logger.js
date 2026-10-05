// @ts-check

/**
 * @file Logger.js
 * Highly structured, context-aware logging utility.
 *
 * Responsibilities:
 * - Provides debug/info/warn/error logging with severity filtering.
 * - Maintains 4 dedicated in-memory ring buffers (errors 100, warns 150,
 *   infos 250, debugs 350) so chatty debug logs can never evict critical
 *   error/warn entries.
 * - Supports hierarchical child loggers (e.g. 'World/Members/Tom').
 * - Provides subscription hooks for real-time log streaming.
 * - Protects subscriber execution with try/catch error boundaries.
 */

/**
 * @typedef {"debug" | "info" | "warn" | "error"} LogSeverity
 */

/**
 * @typedef {Object} LogEntry
 * @property {string} id Unique log event UUID.
 * @property {LogSeverity} level Severity level name.
 * @property {string} name Namespace identity of the emitting logger.
 * @property {string} message Formatted log string.
 * @property {any[]} raw Original raw parameter references.
 * @property {number} timestamp Millisecond epoch timestamp.
 * @property {string} time Formatted 24-hour clock string.
 */

/**
 * Highly structured, context-aware logging utility.
 * Features an in-memory ring buffer and subscription hooks for real-time DevTools.
 */
export default class Logger {

    static DEBUG = 0;
    static INFO = 1;
    static WARN = 2;
    static ERROR = 3;
    static NONE = 4;

    /** 
     * Active logging boundary. Adjust to filter console output.
     * @type {number} 
     */
    static level = Logger.INFO;

    /** 
     * Dedicated in-memory ring buffer per severity, so low-severity churn
     * can never push critical entries out of memory.
     * @type {Record<LogSeverity, LogEntry[]>} 
     */
    static stacks = {
        error: [],
        warn: [],
        info: [],
        debug: []
    };

    /** @readonly @type {number} Max retained error entries (never evicted by debug logs). */
    static MAX_ERRORS = 100;

    /** @readonly @type {number} Max retained warn entries. */
    static MAX_WARNS = 150;

    /** @readonly @type {number} Max retained info entries. */
    static MAX_INFOS = 250;

    /** @readonly @type {number} Max retained debug entries. */
    static MAX_DEBUGS = 350;

    /** 
     * Combined capacity across all ring buffers.
     * @readonly
     */
    static MAX_LOGS = Logger.MAX_ERRORS + Logger.MAX_WARNS + Logger.MAX_INFOS + Logger.MAX_DEBUGS;

    /** 
     * Maximum entries retained in a single flat view (kept for compatibility).
     * @readonly
     */
    static MAX_BUFFER = 250;

    /** 
     * Active subscriber observer callbacks.
     * @type {Set<(entry: LogEntry) => void>} 
     */
    static subscribers = new Set();

    /**
     * Subscribes a listener to live log emissions.
     *
     * @param {(entry: LogEntry) => void} callback
     * @returns {() => void} Clean unsubscribe callback.
     */
    static onLog(callback) {
        if (typeof callback !== "function") return () => {};
        Logger.subscribers.add(callback);
        return () => {
            Logger.subscribers.delete(callback);
        };
    }

    /**
     * Returns a merged, chronologically sorted snapshot of every ring buffer.
     * @returns {LogEntry[]}
     */
    static getRecentLogs() {
        return [...Logger.stacks.error, ...Logger.stacks.warn, ...Logger.stacks.info, ...Logger.stacks.debug]
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Returns a snapshot of the dedicated ring buffer for a single severity.
     *
     * @param {LogSeverity} level Severity stack to read.
     * @returns {LogEntry[]}
     */
    static getStack(level) {
        return [...(Logger.stacks[level] || [])];
    }

    /**
     * Clears every log ring buffer.
     * @returns {void}
     */
    static clearBuffer() {
        Logger.stacks.error.length = 0;
        Logger.stacks.warn.length = 0;
        Logger.stacks.info.length = 0;
        Logger.stacks.debug.length = 0;
    }

    /**
     * Internal dispatcher pushing log items to ring buffer and subscribers.
     *
     * @param {LogSeverity} level
     * @param {string} name
     * @param {any[]} args
     */
    static _record(level, name, args) {
        const now = new Date();
        const message = args.map(arg => {
            if (typeof arg === "string") return arg;
            if (arg instanceof Error) return arg.stack || arg.message;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        }).join(" ");

        /** @type {LogEntry} */
        const entry = {
            id: crypto.randomUUID(),
            level,
            name,
            message,
            raw: args,
            timestamp: now.getTime(),
            time: now.toLocaleTimeString("en-GB", { hour12: false })
        };

        const stack = Logger.stacks[level];
        if (stack) {
            stack.push(entry);
            const cap = level === "error" ? Logger.MAX_ERRORS
                : level === "warn" ? Logger.MAX_WARNS
                : level === "info" ? Logger.MAX_INFOS
                : Logger.MAX_DEBUGS;
            while (stack.length > cap) {
                stack.shift();
            }
        }

        for (const sub of Logger.subscribers) {
            try {
                sub(entry);
            } catch (/** @type {unknown} */ err) {
                console.error("[Logger] Subscriber error:", err);
            }
        }
    }

    /**
     * @param {string} name Context tag identifying where the logs originate.
     */
    constructor(name) {
        /** 
         * @readonly 
         * @type {string} 
         */
        this.name = typeof name === "string" && name.trim() ? name : "App";
    }

    /**
     * Generates a nested child logger maintaining parent tracing.
     *
     * @param {string} childName
     * @returns {Logger}
     */
    child(childName) {
        return new Logger(`${this.name}/${childName}`);
    }

    /**
     * Outputs debug details.
     * @param {...any} args
     */
    debug(...args) {
        Logger._record("debug", this.name, args);
        if (Logger.level <= Logger.DEBUG) {
            console.debug(`[DEBUG] [${this.name}]`, ...args);
        }
    }

    /**
     * Outputs general system lifecycle events.
     * @param {...any} args
     */
    info(...args) {
        Logger._record("info", this.name, args);
        if (Logger.level <= Logger.INFO) {
            console.info(`[INFO]  [${this.name}]`, ...args);
        }
    }

    /**
     * Outputs warning notifications.
     * @param {...any} args
     */
    warn(...args) {
        Logger._record("warn", this.name, args);
        if (Logger.level <= Logger.WARN) {
            console.warn(`[WARN]  [${this.name}]`, ...args);
        }
    }

    /**
     * Outputs critical error conditions.
     * @param {...any} args
     */
    error(...args) {
        Logger._record("error", this.name, args);
        if (Logger.level <= Logger.ERROR) {
            console.error(`[ERROR] [${this.name}]`, ...args);
        }
    }
}