// @ts-check

/**
 * Backward-compatible barrel re-export.
 * All constants are now defined in focused modules:
 *   - config.js: Pure configuration constants
 *   - prompts.js: Prompt templates and rules
 *   - apiKeys.js: API key management helpers
 *
 * This file re-exports everything so existing imports continue to work.
 * New code should import directly from the focused modules.
 */

export {
    // Config
    GROQ_API_BASE_URL,
    GROQ_CONSOLE_KEYS_URL,
    DEFAULT_CHAT_MODEL,
    CHAT_MODEL_FALLBACK_CHAIN,
    GEMINI_API_BASE_URL,
    GEMINI_CONSOLE_KEYS_URL,
    DEFAULT_GEMINI_MODEL,
    GEMINI_MAX_OUTPUT_TOKENS,
    SIMULATION_CITY,
    SIMULATION_STATE,
    SIMULATION_COUNTRY,
    SIMULATION_LOCATION_FULL,
    SIMULATION_LATITUDE,
    SIMULATION_LONGITUDE,
    SIMULATION_TIMEZONE,
    PARTICIPANT_TYPE_CHARACTER,
    PARTICIPANT_TYPE_HUMAN,
    Message_Buffer_live_request,
    Message_generate_per_live_request,
    STORAGE_TABLES,
    STORAGE_DATABASE_NAME,
    STORAGE_DATABASE_VERSION,
    STORAGE_API_KEY_NAME,
    STORAGE_GEMINI_API_KEY_NAME
} from "./config";

export {
    // Prompts
    PROMPT_DIALOGUE_TASK,
    PROMPT_DIALOGUE_RULES,
    PROMPT_SCHEDULER_TASK,
    PROMPT_SCHEDULER_RULES,
    PROMPT_DEMAND_TASK,
    PROMPT_DEMAND_RULES,
    PROMPT_RESTABILIZER_TASK,
    PROMPT_RESTABILIZER_RULES
} from "./prompts";

export {
    // API Keys
    getApiKey,
    setApiKey,
    clearApiKey,
    hasApiKey,
    verifyApiKey,
    getGeminiApiKey,
    setGeminiApiKey,
    clearGeminiApiKey,
    hasGeminiApiKey,
    verifyGeminiApiKey,
    verifyAndProbeDualKeys,
    filterTextGenerationModels,
    getBlockedGeminiModels,
    blockGeminiModel,
    clearBlockedGeminiModels,
    NON_TEXT_MODEL_MARKERS
} from "./apiKeys";
