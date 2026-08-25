// @ts-check

/**
 * @file Logger.js
 * Highly structured, context-aware logging utility.
 *
 * Responsibilities:
 * - Provides debug/info/warn/error logging with severity filtering.
 * - Maintains an in-memory ring buffer (250 entries) for DevTools inspection.
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
     * In-memory ring buffer holding recent log entries for DevTools inspection.
     * @type {LogEntry[]} 
     */
    static buffer = [];

    /** 
     * Maximum entries retained in the ring buffer.
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
     * Returns a snapshot of the in-memory ring buffer.
     * @returns {LogEntry[]}
     */
    static getRecentLogs() {
        return [...Logger.buffer];
    }

    /**
     * Clears the in-memory log buffer.
     * @returns {void}
     */
    static clearBuffer() {
        Logger.buffer.length = 0;
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

        Logger.buffer.push(entry);
        if (Logger.buffer.length > Logger.MAX_BUFFER) {
            Logger.buffer.shift();
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