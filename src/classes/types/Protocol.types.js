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
 * Discriminated union of all protocol records supported by ProtocolCodec.
 * (Memory records were removed with the legacy keyed-memory architecture;
 * factual memory is written by SituationEngine into UnifiedMemory.)
 * @typedef {MessageProtocolRecord} ProtocolRecord
 */

export {};