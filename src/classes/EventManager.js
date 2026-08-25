// @ts-check

/**
 * @file EventManager.js
 * Insulated Event Broker implementing observer patterns.
 *
 * Responsibilities:
 * - Registers and manages event listeners with labeled subscriptions.
 * - Emits events with defensive try/catch to prevent single-listener crashes.
 * - Supports one-time listeners, unsubscribe functions, and bulk cleanup.
 * - Provides inspection/debugging tools for active listener profiles.
 * - Protects runtime processes by wrapping execution loops in error boundaries.
 */

/** @typedef {import("./lib/Logger").default} Logger */

/**
 * @typedef {{
 *     listener: Function,
 *     label: string
 * }} EventListener
 */

/**
 * Insulated Event Broker implementing observer patterns.
 * Protects runtime processes by wrapping listener execution loops inside try/catch blocks.
 */
export default class EventManager {

    /**
     * @param {Logger} logger Root parent-context logger to allocate namespaces.
     */
    constructor(logger) {
        if (!logger) throw new TypeError("EventManager requires a Logger instance.");

        /** @readonly @type {Logger} */
        this.logger = logger.child("Events");

        /** 
         * Active mapping of registered event observers.
         * @type {Map<string, Set<EventListener>>} 
         */
        this.listeners = new Map();
    }

    /**
     * Registers an event observer.
     *
     * @param {string} event Namespace identifier string.
     * @param {Function} listener Target function.
     * @param {string} [label] Description tag to track listeners or memory leaks.
     * @returns {Function} Clean unsubscribe function.
     */
    on(event, listener, label = "") {
        if (typeof event !== "string" || !event.trim()) {
            this.logger.warn("on() aborted: event name must be a non-empty string.");
            return () => {};
        }

        if (typeof listener !== "function") {
            this.logger.error(`Failed to bind listener for event "${event}": provided listener parameter is not a function.`);
            throw new TypeError("Event listener must be a function.");
        }

        let listeners = this.listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(event, listeners);
        }

        const entry = {
            listener,
            label: label || "(unlabeled)"
        };

        listeners.add(entry);
        this.logger.debug(`Registered listener on event "${event}" [Label: ${entry.label}]. Total: ${listeners.size}`);

        return () => this.off(event, listener);
    }

    /**
     * Registers an event observer that executes exactly once, then cleans up.
     *
     * @param {string} event Namespace identifier string.
     * @param {Function} listener Target function.
     * @param {string} [label] Description tag.
     * @returns {Function} Clean unsubscribe function.
     */
    once(event, listener, label = "") {
        /**@param {any[]} args*/
        const wrapper = (...args) => {
            this.off(event, wrapper);
            listener(...args);
        };

        return this.on(event, wrapper, label);
    }

    /**
     * Unsubscribes an event observer.
     *
     * @param {string} event Namespace identifier string.
     * @param {Function} listener Target function reference.
     */
    off(event, listener) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;

        for (const entry of listeners) {
            if (entry.listener !== listener) {
                continue;
            }

            this.logger.debug(`Removing listener from event "${event}" [Label: ${entry.label}].`);
            listeners.delete(entry);
            break;
        }

        if (listeners.size === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Emits events to all registered observers.
     * Insulates operations defensively: If a single observer crashes, 
     * remaining observers in the loop continue to execute normally.
     *
     * @param {string} event Namespace identifier string.
     * @param {any[]} args Values passed directly to the registered observer functions.
     */
    emit(event, ...args) {
        const listeners = this.listeners.get(event);
        if (!listeners) {
            return; // No observers registered
        }

        this.logger.debug(`Emitting event "${event}" with args:`, args);

        for (const { listener, label } of [...listeners]) {
            try {
                listener(...args);
            } catch (/** @type {unknown} */ error) {
                this.logger.error(`Uncaught exception in event listener on "${event}" [Label: ${label}]:`, error);
            }
        }
    }

    /**
     * Checks if observers exist on the target namespace.
     *
     * @param {string} event Namespace identifier.
     * @returns {boolean}
     */
    has(event) {
        return this.listeners.has(event);
    }

    /**
     * Inspects active observer profiles for a namespace.
     *
     * @param {string} event Namespace identifier.
     * @returns {{label: string}[]}
     */
    inspect(event) {
        const listeners = this.listeners.get(event);
        if (!listeners) {
            return [];
        }
        return [...listeners].map(({ label }) => ({ label }));
    }

    /**
     * Clears all observers registered on a specific event namespace.
     *
     * @param {string} event Namespace identifier.
     */
    clear(event) {
        this.listeners.delete(event);
        this.logger.debug(`Wiped all observers for event: "${event}"`);
    }

    /**
     * Wipes all active observer references entirely.
     */
    clearAll() {
        this.listeners.clear();
        this.logger.debug("EventManager cleared entirely.");
    }
}