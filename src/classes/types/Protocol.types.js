// @ts-check

/**
 * Parsed chat dialogue exchange record.
 * @typedef {Object} MessageProtocolRecord
 * @property {"message"} recordType
 * @property {number} id Unique turn integer ID.
 * @property {string|null} replyToID Target message ID (integer string or UUID), or null.
 * @property {string} reaction Expressed emotion identifier.
 * @property {string} sender Character ID of the author.
 * @property {string} text Spoken dialogue payload.
 */

/**
 * Autonomous memory creation record emitted by Gemini Live.
 * @typedef {Object} MemorySetProtocolRecord
 * @property {"memory-set"} recordType
 * @property {string} member Target participant ID (e.g., 'tom', 'me').
 * @property {string} key Unique memory fact key identifier.
 * @property {any} value Fact value payload.
 * @property {string|Date|null|-1} expiry Expiration directive ('forever', '-1', relative like '24h', or ISO date).
 */

/**
 * Autonomous memory deletion record emitted by Gemini Live.
 * @typedef {Object} MemoryRemoveProtocolRecord
 * @property {"memory-remove"} recordType
 * @property {string} member Target participant ID.
 * @property {string} key Memory fact key to purge.
 */

/**
 * Discriminated union of all protocol records supported by ProtocolCodec.
 * @typedef {MessageProtocolRecord | MemorySetProtocolRecord | MemoryRemoveProtocolRecord} ProtocolRecord
 */

export {};