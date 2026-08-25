// @ts-check

/**
 * Value formats supported by Key data structures.
 * @typedef {string|string[]|null} KeyValue
 */

/**
 * Expiration parameters supported by Key structures.
 * - `Date`: Absolute future expiration boundary.
 * - `-1`: Permanent key that never expires.
 * - `null`: Unset or uninitialized expiry.
 * @typedef {Date|null|-1} KeyExpiry
 */

/**
 * Persistent representation of a Key inside IndexedDB.
 * @typedef {{
 *     name: string,
 *     value: KeyValue,
 *     prev: KeyValue,
 *     expiry: string|null|"forever"
 * }} KeyStorageJSON
 */

/**
 * Structured presentation format passed to LLM Prompt Builders.
 * @typedef {{
 *     name: string,
 *     value: KeyValue,
 *     expiry: string|null|"forever"|"notset"
 * }} KeyFormattedJSON
 */

/**
 * Serialized collection of keys written to IndexedDB.
 * @typedef {KeyStorageJSON[]} MemoryStorageJSON
 */

/**
 * Serialized collection of keys structured for Prompts.
 * @typedef {KeyFormattedJSON[]} MemoryFormattedJSON
 */

/**
 * Serialized representation of the World state inside IndexedDB.
 * @typedef {Object} WorldStorageJSON
 * @property {string} now ISO string tracking when the state was saved.
 * @property {Object.<string, KeyStorageJSON>} memories Active key-value records.
 */

/**
 * Serialized representation of the World state passed to Prompt Builders.
 * @typedef {Object} WorldFormattedJSON
 * @property {string} now ISO string tracking current time parameters.
 * @property {Object.<string, KeyFormattedJSON>} memories Active formatted key-value records.
 */

export {};