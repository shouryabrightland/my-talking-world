// @ts-check

/**
 * @file UI.types.js
 * Centralized type definitions for all React UI components.
 * Eliminates implicit any types across component files.
 */

/** @typedef {import("./Protocol.types").ProtocolRecord} ProtocolRecord */

// =========================================================================
// APP MODES & NAVIGATION
// =========================================================================

/**
 * User interaction mode in the chat input.
 * @typedef {"user" | "director"} AppMode
 */

/**
 * Active tab in the Settings modal.
 * @typedef {"general" | "keys" | "profiles" | "memories"} SettingsTab
 */

/**
 * Active tab in the DevTools drawer.
 * @typedef {"info" | "state" | "logs" | "prompts"} DevToolsTab
 */

// =========================================================================
// CONNECTION & NETWORK
// =========================================================================

/**
 * Current network connection quality level.
 * @typedef {"good" | "degraded" | "offline"} ConnectionQuality
 */

// =========================================================================
// LOG ENTRIES
// =========================================================================

/**
 * A single log entry from the Logger subsystem.
 * @typedef {Object} LogEntry
 * @property {number} timestamp Unix epoch ms when the log was created.
 * @property {"debug" | "info" | "warn" | "error"} level Severity level.
 * @property {string} tag Source module tag (e.g. "World", "GroqClient").
 * @property {string} message Human-readable log message.
 * @property {*} [data] Optional attached data payload.
 */

/**
 * A single prompt log entry from the PromptLogger subsystem.
 * @typedef {Object} PromptLogEntry
 * @property {number} timestamp Unix epoch ms when the prompt was recorded.
 * @property {PromptType} type Category of prompt generation.
 * @property {string} model Model ID used for the request.
 * @property {number} startTime When the request started.
 * @property {"success" | "error"} status Outcome of the prompt.
 * @property {string} [error] Error message if status is "error".
 * @property {string} [rawResponse] Full raw model response.
 * @property {string|null} [thinkingChain] Extracted thinking chain.
 * @property {Record<string, any>|null} [groundingMetadata] Google Search grounding metadata.
 */

/**
 * Type of prompt generation.
 * @typedef {"dialogue" | "scheduler" | "demand" | "stabilizer"} PromptType
 */

// =========================================================================
// COMPONENT STATE TYPES
// =========================================================================

/**
 * Member form state for profile editing in SettingsModal.
 * @typedef {Object} MemberFormState
 * @property {string} name Character display name.
 * @property {string} about Character bio/description.
 * @property {string} age Character age as string.
 */

/**
 * New memory form state for adding memories in SettingsModal.
 * @typedef {Object} NewMemoryFormState
 * @property {string} key Memory key name.
 * @property {string} value Memory value content.
 * @property {string} expiryOption Selected TTL option string.
 */

/**
 * Schedule form state for creating/editing schedule blocks.
 * @typedef {Object} ScheduleFormState
 * @property {string} topic Discussion topic for the block.
 * @property {string} mainGoal Main session objective.
 * @property {string} prePlot What led into this scene.
 * @property {string} postPlot What happens after this scene.
 * @property {string} startHour Start hour as decimal string.
 * @property {string} endHour End hour as decimal string.
 * @property {string} factsStr Comma-separated facts string.
 */

/**
 * API key verification result.
 * @typedef {Object} ApiKeyVerificationResult
 * @property {boolean} valid Whether the key passed verification.
 * @property {string} [error] Error message if verification failed.
 */

// =========================================================================
// MESSAGE & CHAT TYPES
// =========================================================================

/**
 * Parsed message for rendering in the chat UI.
 * @typedef {Object} ParsedMessage
 * @property {string} id Unique message identifier.
 * @property {import("../ChatMember").default | null} sender Message author.
 * @property {string} text Message body text.
 * @property {{ name?: string, intensity?: number }} emotion Emotion metadata.
 * @property {boolean} deleted Whether message is soft-deleted.
 * @property {ProtocolRecord | null} protocol Protocol metadata.
 * @property {ParsedMessage | null} reply Parent message for quote chains.
 * @property {boolean} isUser Whether message is from the human user.
 * @property {number} timestamp Message creation timestamp.
 */

/**
 * Character state displayed in the DevTools state tab.
 * @typedef {Object} CharacterState
 * @property {string} id Character identifier.
 * @property {string} name Character display name.
 * @property {string} age Character age.
 * @property {string} about Character bio.
 * @property {string} emotion Current emotion name.
 * @property {Array<{ key: string, value: string, expiry: string }>} memories Active memories with formatted TTL.
 */

// =========================================================================
// OFFLINE CONTEXT
// =========================================================================

/**
 * Retry function queued for offline reconnection.
 * @typedef {Object} RetryEntry
 * @property {() => Promise<void>} fn Async function to retry.
 * @property {string} label Human-readable label for the retry.
 */

export {};
