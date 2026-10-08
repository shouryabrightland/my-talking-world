// @ts-check

/**
 * Centralized application configuration constants.
 * Pure data — no logic, no side effects.
 */

// =========================================================================
// GROQ API
// =========================================================================

/** @readonly @type {string} */
export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";

/** @readonly @type {string} */
export const GROQ_CONSOLE_KEYS_URL = "https://console.groq.com/keys";

// =========================================================================
// GEMINI API
// =========================================================================

/** @readonly @type {string} */
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** @readonly @type {string} */
export const GEMINI_CONSOLE_KEYS_URL = "https://aistudio.google.com/app/apikey";

/** @readonly @type {string} */
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

/** @readonly @type {number} */
export const GEMINI_MAX_OUTPUT_TOKENS = 65536;

// =========================================================================
// SIMULATION LOCATION
// =========================================================================

/** @readonly @type {string} */
export const SIMULATION_CITY = "Lucknow";

/** @readonly @type {string} */
export const SIMULATION_STATE = "Uttar Pradesh";

/** @readonly @type {string} */
export const SIMULATION_COUNTRY = "India";

/** @readonly @type {string} */
export const SIMULATION_LOCATION_FULL = `${SIMULATION_CITY}, ${SIMULATION_STATE} (${SIMULATION_COUNTRY})`;

/** @readonly @type {number} */
export const SIMULATION_LATITUDE = 26.8467;

/** @readonly @type {number} */
export const SIMULATION_LONGITUDE = 80.9462;

/** @readonly @type {string} */
export const SIMULATION_TIMEZONE = "Asia/Kolkata";

// =========================================================================
// PARTICIPANT TYPES
// =========================================================================

/** @readonly @type {string} */
export const PARTICIPANT_TYPE_CHARACTER = "character";

/** @readonly @type {string} */
export const PARTICIPANT_TYPE_HUMAN = "human_user";

// =========================================================================
// ENGINE PARAMETERS
// =========================================================================

/** @readonly @type {number} */
export const Message_Buffer_live_request = 1;

/** @readonly @type {number} */
export const Message_generate_per_live_request = 3;

// =========================================================================
// STORAGE / DATABASE
// =========================================================================

/** @readonly @type {readonly string[]} */
export const STORAGE_TABLES = Object.freeze([
    "MessageStore",
    "Scheduler",
    "Memories",
    "ModelCache"
]);

/** @readonly @type {string} */
export const STORAGE_DATABASE_NAME = "tgf";

/** @readonly @type {number} */
export const STORAGE_DATABASE_VERSION = 8;

/** @readonly @type {string} */
export const STORAGE_API_KEY_NAME = "tgf:groq_api_key";

/** @readonly @type {string} */
export const STORAGE_GEMINI_API_KEY_NAME = "tgf:gemini_api_key";