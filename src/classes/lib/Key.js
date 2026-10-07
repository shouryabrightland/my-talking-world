// @ts-check

/**
 * @file Key.js
 * Thread-safe wrapper representing a single key-value memory item.
 *
 * Responsibilities:
 * - Encapsulates validation logic for key names, values, and expiry settings.
 * - Supports value types: string, string[], or null.
 * - Supports expiry types: Date (relative), -1 (permanent), null (unset).
 * - Provides deep copy operations to prevent mutate-by-reference bugs.
 * - Tracks value changes for dirty-checking via prev snapshot.
 * - Serializes/deserializes to JSON for IndexedDB persistence.
 */

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {import("./io.types").KeyValue} KeyValue
 * @typedef {import("./io.types").KeyExpiry} KeyExpiry
 * @typedef {import("./io.types").KeyStorageJSON} KeyStorageJSON
 * @typedef {import("./io.types").KeyFormattedJSON} KeyFormattedJSON
 */

/**
 * Validates JSDoc compatible Key values.
 *
 * @param {unknown} value
 * @returns {asserts value is KeyValue}
 */
function assertKeyValue(value) {
    if (value === null || typeof value === "string") {
        return;
    }

    if (
        Array.isArray(value) &&
        value.every(item => typeof item === "string")
    ) {
        return;
    }

    throw new TypeError("Memory value violates types: Must be a string, string[], or null.");
}

/**
 * Validates Key names to prevent empty identifiers.
 *
 * @param {unknown} name
 * @returns {asserts name is string}
 */
function assertName(name) {
    if (typeof name !== "string" || !name.trim()) {
        throw new TypeError("Memory Key name must be a non-empty string.");
    }
}

/**
 * Validates Key expiry values.
 *
 * @param {unknown} expiry
 * @returns {asserts expiry is Date|null|-1}
 */
function assertExpiry(expiry) {
    if (expiry === null || expiry === -1) {
        return;
    }

    if (expiry instanceof Date && !Number.isNaN(expiry.getTime())) {
        return;
    }

    throw new TypeError("Memory Key expiry violates types: Must be a valid Date object, -1, or null.");
}

/**
 * Generates deep copies of Memory values to prevent mutate-by-reference bugs.
 *
 * @param {KeyValue} value
 * @returns {KeyValue}
 */
function copyValue(value) {
    return Array.isArray(value) ? [...value] : value;
}

/**
 * Generates copies of Expiry dates.
 *
 * @param {Date|null|-1} expiry
 * @returns {Date|null|-1}
 */
function copyExpiry(expiry) {
    return expiry instanceof Date ? new Date(expiry.getTime()) : expiry;
}

/**
 * Parses raw serialized expiry values safely.
 *
 * @param {unknown} value
 * @returns {Date|null|-1}
 */
function parseExpiry(value) {
    if (value === null || value === "notset") {
        return null;
    }

    if (value === "forever" || value === -1) {
        return -1;
    }

    if (typeof value !== "string") {
        throw new TypeError("Key expiry must be null, 'notset', 'forever', or an ISO Date string.");
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Corrupted Key expiry date format parsed: "${value}".`);
    }

    return date;
}

/**
 * Thread-safe wrapper representing a single key-value memory item.
 * Encapsulates validation logic, value copy operations, and relative expiration checks.
 */
export class Key {

    /**
     * @param {Logger} logger Logging interface.
     * @param {{
     *     name: string,
     *     value: KeyValue,
     *     expiry?: Date|null|-1
     * }} options Initial key configuration options.
     */
    constructor(logger, {
        name,
        value,
        expiry = null
    }) {
        this.logger = logger.child("Key");

        try {
            assertName(name);
            assertKeyValue(value);
            assertExpiry(expiry);
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Initialization rejected due to invalid values:", error);
            throw error;
        }

        /** @type {string} */
        this.name = name;

        /** @type {KeyValue} */
        this.#value = copyValue(value);

        /** @type {KeyValue} */
        this.#prev = null;

        /** @type {Date|null|-1} */
        this.#expiry = copyExpiry(expiry);
    }

    /** @type {Logger} */
    logger;

    /** @type {KeyValue} */
    #value;

    /** @type {KeyValue} */
    #prev;

    /** @type {Date|null|-1} */
    #expiry;

    /**
     * Returns a copy of the current value.
     * @returns {KeyValue}
     */
    get value() {
        return copyValue(this.#value);
    }

    /**
     * Safely updates the key value and caches the previous state for delta tracking.
     * @param {KeyValue} value
     */
    set value(value) {
        try {
            assertKeyValue(value);
        } catch (/** @type {unknown} */ error) {
            this.logger.error(`Set operation rejected on key "${this.name}":`, error);
            throw error;
        }

        if (this.#sameValue(this.#value, value)) {
            return; // No-op if identical
        }

        this.#prev = copyValue(this.#value);
        this.#value = copyValue(value);
    }

    /**
     * Returns a copy of the expiry setting.
     * @returns {Date|null|-1}
     */
    get expiry() {
        return copyExpiry(this.#expiry);
    }

    /**
     * Safely updates the expiry setting.
     * @param {Date|null|-1} expiry
     */
    set expiry(expiry) {
        try {
            assertExpiry(expiry);
        } catch (/** @type {unknown} */ error) {
            this.logger.error(`Expiry modification rejected on key "${this.name}":`, error);
            throw error;
        }

        this.#expiry = copyExpiry(expiry);
    }

    /**
     * Returns the previous value. Useful for tracing updates.
     * @returns {KeyValue|null}
     */
    get prev() {
        return copyValue(this.#prev);
    }

    /**
     * Atomically modifies the value and expiry settings together.
     *
     * @param {KeyValue} value
     * @param {Date|null|-1} expiry
     */
    update(value, expiry) {
        try {
            assertKeyValue(value);
            assertExpiry(expiry);
        } catch (/** @type {unknown} */ error) {
            this.logger.error(`Atomic update rejected on key "${this.name}":`, error);
            throw error;
        }

        if (!this.#sameValue(this.#value, value)) {
            this.#prev = copyValue(this.#value);
        }

        this.#value = copyValue(value);
        this.#expiry = copyExpiry(expiry);
    }

    /**
     * Determines if the key is current and usable.
     * Compares raw epoch milliseconds so timezone/DST offsets can never skew
     * the expiry boundary. Non-Date inputs fall back to the current system
     * time instead of silently marking every key unusable.
     *
     * @param {Date} [date=new Date()]
     * @returns {boolean}
     */
    isUsable(date = new Date()) {
        if (this.#value === null || this.#expiry === null) {
            return false;
        }

        if (this.#expiry === -1) {
            return true; // Permanent keys never expire
        }

        const checkTime = date instanceof Date ? date.getTime() : Date.now();
        return this.#expiry.getTime() > checkTime;
    }

    /**
     * Determines if the key is expired or uninitialized.
     *
     * @param {Date} [date=new Date()]
     * @returns {boolean}
     */
    isUnusable(date = new Date()) {
        return !this.isUsable(date);
    }

    /**
     * Determines if the key's expiry boundary has passed.
     *
     * @param {Date} [date=new Date()]
     * @returns {boolean}
     */
    isExpired(date = new Date()) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return false;
        }

        if (this.#expiry === null || this.#expiry === -1) {
            return false;
        }

        return this.#expiry.getTime() <= date.getTime();
    }

    /**
     * Checks if expiry is unset.
     * @returns {boolean}
     */
    isUnset() {
        return this.#expiry === null;
    }

    /**
     * Checks if the key is permanent.
     * @returns {boolean}
     */
    isForever() {
        return this.#expiry === -1;
    }

    /**
     * Checks if the key has a relative expiry timestamp.
     * @returns {boolean}
     */
    hasExpiry() {
        return this.#expiry instanceof Date;
    }

    /**
     * Checks if the key's value has mutated during this cycle.
     * @returns {boolean}
     */
    hasChanged() {
        return this.#prev !== null;
    }

    /**
     * Clears mutations, establishing the current value as the base.
     */
    resetHistory() {
        this.#prev = null;
    }

    /**
     * Serializes Key parameters to JSON safely.
     *
     * @param {boolean} [formatted=false]
     * @returns {any}
     */
    toJSON(formatted = false) {
        const expiry = this.#expiry;
        let jsonExpiry;

        if (expiry === null) {
            jsonExpiry = formatted ? "notset" : null;
        } else if (expiry === -1) {
            jsonExpiry = "forever";
        } else {
            jsonExpiry = expiry.toISOString();
        }

        if (formatted) {
            return {
                name: this.name,
                value: copyValue(this.#value),
                expiry: jsonExpiry
            };
        }

        return {
            name: this.name,
            value: copyValue(this.#value),
            prev: copyValue(this.#prev),
            expiry: jsonExpiry
        };
    }

    /**
     * Restores a Key from JSON data safely.
     *
     * @param {Logger} logger
     * @param {any} json
     * @param {boolean} [formatted=false]
     * @returns {Key}
     */
    static fromJSON(logger, json, formatted = false) {
        const keyLogger = logger.child("Key");

        try {
            const state = Key.#parseJSON(json, formatted);
            const key = new Key(logger, state);

            if (!formatted && json) {
                key.#prev = copyValue(json.prev);
            }

            return key;
        } catch (/** @type {unknown} */ error) {
            keyLogger.error("Failed to construct Key from JSON source:", error);
            throw error;
        }
    }

    /**
     * Merges current parameters with serialized JSON parameters safely.
     *
     * @param {any} json
     * @param {boolean} [formatted=false]
     */
    fromJSON(json, formatted = false) {
        try {
            const state = Key.#parseJSON(json, formatted);

            this.name = state.name;
            this.#value = copyValue(state.value);
            this.#expiry = copyExpiry(state.expiry);

            if (!formatted && json) {
                this.#prev = copyValue(json.prev);
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to align Key state from JSON source:", error);
            throw error;
        }
    }

    /**
     * Outputs a human-readable trace string.
     *
     * @param {boolean} [showExpiry=false]
     * @param {boolean} [showChange=false]
     * @returns {string}
     */
    toString(showExpiry = false, showChange = false) {
        let expiryText = "";

        if (showExpiry && this.#expiry instanceof Date) {
            expiryText = ` (valid till: ${this.#expiry.toISOString()})`;
        }

        if (!this.isUsable()) {
            return `${this.name}:${expiryText} [expired/unusable]`;
        }

        if (showChange && this.#prev !== null) {
            return `${this.name}:${expiryText}` +
                `${Array.isArray(this.#value) ? "\n" : " "}` +
                `${this.#formatValue(this.#prev)} → ` +
                this.#formatValue(this.#value);
        }

        return `${this.name}:${expiryText}` +
            `${Array.isArray(this.#value) ? "\n" : " "}` +
            this.#formatValue(this.#value);
    }

    /**
     * Parses and strictly validates external JSON.
     *
     * @param {any} json
     * @param {boolean} formatted
     * @returns {{
     *     name: string,
     *     value: KeyValue,
     *     prev: KeyValue|null,
     *     expiry: Date|null|-1
     * }}
     */
    static #parseJSON(json, formatted) {
        if (json === null || typeof json !== "object" || Array.isArray(json)) {
            throw new TypeError("Raw JSON source is not a valid object structure.");
        }

        assertName(json.name);
        assertKeyValue(json.value);

        if (!("expiry" in json)) {
            throw new TypeError("Raw JSON is missing required 'expiry' field.");
        }

        let prev = null;
        if (!formatted) {
            if (!("prev" in json)) {
                throw new TypeError("Raw Key JSON is missing required 'prev' field.");
            }
            assertKeyValue(json.prev);
            prev = copyValue(json.prev);
        }

        return {
            name: json.name,
            value: copyValue(json.value),
            prev,
            expiry: parseExpiry(json.expiry)
        };
    }

    /**
     * Checks if two KeyValues are equal.
     *
     * @param {KeyValue} a
     * @param {KeyValue} b
     * @returns {boolean}
     */
    #sameValue(a, b) {
        if (a === b) {
            return true;
        }

        if (!Array.isArray(a) || !Array.isArray(b)) {
            return false;
        }

        if (a.length !== b.length) {
            return false;
        }

        return a.every((value, index) => value === b[index]);
    }

    /**
     * Formats values for CLI and prompt display.
     *
     * @param {KeyValue} value
     * @returns {string}
     */
    #formatValue(value) {
        if (value === null) {
            return "[unset]";
        }

        if (!Array.isArray(value)) {
            return value;
        }

        return value
            .map(item => ` [+] ${item}`)
            .join("\n") + "\n";
    }
}