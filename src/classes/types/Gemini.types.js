/**
 * A Gemini content part.
 *
 * @typedef {Object} Part
 * @property {string} [text]
 * @property {{
 *   mimeType: string,
 *   data: string
 * }} [inlineData]
 * @property {{
 *   fileUri: string,
 *   mimeType: string
 * }} [fileData]
 */

/**
 * Gemini Live API response.
 *
 * @typedef {Object} LiveResponse
 *
 * @property {boolean} [setupComplete]
 *
 * @property {{
 *   modelTurn?: {
 *     parts?: ResponsePart[]
 *   },
 *   outputTranscription?: {
 *     text?: string
 *   }
 * }} [serverContent]
 */

/**
 * A Gemini response part.
 *
 * @typedef {Object} ResponsePart
 *
 * @property {string} [text]
 *
 * @property {{
 *   mimeType?: string,
 *   data?: string
 * }} [inlineData]
 */

export {}