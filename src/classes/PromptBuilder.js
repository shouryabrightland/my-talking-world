// @ts-check

/**
 * Standard OpenAI-compatible message object.
 * @typedef {Object} ChatMessage
 * @property {"system" | "user" | "assistant"} role
 * @property {string} content
 */

/**
 * Compiled prompt request payload for Groq chat completions.
 * @typedef {Object} PromptPayload
 * @property {ChatMessage[]} messages
 */

/**
 * @callback PromptBuilderFunction
 * @param {PromptPayload} payload Current compiled prompt state.
 * @returns {string | ChatMessage | Array<string | ChatMessage> | null | undefined | Promise<string | ChatMessage | Array<string | ChatMessage> | null | undefined>}
 */

/**
 * Assembles and compiles structured, context-heavy Prompt payloads for Groq OpenAI-compatible APIs.
 * Supports asynchronous, decoupled prompt blocks registered by modular subsystems,
 * executing sub-routines inside safe error boundaries.
 */
export default class PromptBuilder {

    constructor() {
        /**
         * System instruction provider callbacks.
         * @type {PromptBuilderFunction[]}
         */
        this.systemBuilders = [];

        /**
         * User turn provider callbacks.
         * @type {PromptBuilderFunction[]}
         */
        this.userBuilders = [];

        /**
         * Pre-existing or injected conversation messages.
         * @type {ChatMessage[]}
         */
        this.historyMessages = [];
    }

    /**
     * Registers a callback that appends content to the System message.
     *
     * @param {PromptBuilderFunction} builder
     * @returns {PromptBuilder}
     */
    useSystem(builder) {
        if (typeof builder !== "function") {
            throw new TypeError("useSystem() rejected: registered builder must be a function.");
        }
        this.systemBuilders.push(builder);
        return this;
    }

    /**
     * Registers a callback that appends content to the User message.
     *
     * @param {PromptBuilderFunction} builder
     * @returns {PromptBuilder}
     */
    useUser(builder) {
        if (typeof builder !== "function") {
            throw new TypeError("useUser() rejected: registered builder must be a function.");
        }
        this.userBuilders.push(builder);
        return this;
    }

    /**
     * Appends an explicit historical message.
     *
     * @param {"system"|"user"|"assistant"} role
     * @param {string} content
     * @returns {PromptBuilder}
     */
    addMessage(role, content) {
        if (typeof content === "string" && content.trim()) {
            this.historyMessages.push({ role, content: content.trim() });
        }
        return this;
    }

    /**
     * Safely compiles and constructs the final OpenAI-compatible `{ messages }` payload.
     *
     * @param {Object} [options]
     * @param {ChatMessage[]} [options.history=[]] Existing dialogue history messages.
     * @param {boolean} [options.includeSystem=true] Execute registered System instruction blocks.
     * @param {boolean} [options.includeUser=true] Execute registered User content blocks.
     * @returns {Promise<PromptPayload>}
     */
    async build({
        history = [],
        includeSystem = true,
        includeUser = true
    } = {}) {
        /** @type {ChatMessage[]} */
        const messages = [];

        // 1. Compile System Instructions
        if (includeSystem && this.systemBuilders.length > 0) {
            /** @type {string[]} */
            const systemParts = [];

            for (const builder of this.systemBuilders) {
                try {
                    const result = await builder({ messages });
                    this.#appendContent(systemParts, result);
                } catch (/** @type {unknown} */ error) {
                    console.error("[PromptBuilder] Error encountered executing System instruction builder:", error);
                }
            }

            if (systemParts.length > 0) {
                messages.push({
                    role: "system",
                    content: systemParts.join("\n\n")
                });
            }
        }

        // 2. Append Existing / Injected History
        const combinedHistory = [...this.historyMessages, ...(Array.isArray(history) ? history : [])];
        for (const msg of combinedHistory) {
            if (msg && typeof msg.content === "string" && msg.content.trim()) {
                messages.push({
                    role: msg.role,
                    content: msg.content.trim()
                });
            }
        }

        // 3. Compile User Content
        if (includeUser && this.userBuilders.length > 0) {
            /** @type {string[]} */
            const userParts = [];

            for (const builder of this.userBuilders) {
                try {
                    const result = await builder({ messages });
                    this.#appendContent(userParts, result);
                } catch (/** @type {unknown} */ error) {
                    console.error("[PromptBuilder] Error encountered executing User content builder:", error);
                }
            }

            if (userParts.length > 0) {
                messages.push({
                    role: "user",
                    content: userParts.join("\n\n")
                });
            }
        }

        return { messages };
    }

    /**
     * Wipes all registered callbacks and stored history cleanly.
     *
     * @returns {void}
     */
    clear() {
        this.systemBuilders.length = 0;
        this.userBuilders.length = 0;
        this.historyMessages.length = 0;
    }

    /**
     * Flattens and extracts string content from mixed return types.
     *
     * @param {string[]} target Target string accumulator.
     * @param {string|{content?: string}|Array<string|{content?: string}>|null|undefined} value Raw return from builder callback.
     */
    #appendContent(target, value) {
        if (value == null) return;

        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) target.push(trimmed);
            return;
        }

        if (typeof value === "object" && !Array.isArray(value) && typeof value.content === "string") {
            const trimmed = value.content.trim();
            if (trimmed) target.push(trimmed);
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                this.#appendContent(target, item);
            }
            return;
        }

        // Fallback: coerce unknown types to prevent [Object object]
        const coerced = String(value).trim();
        if (coerced && coerced !== "[object Object]") {
            target.push(coerced);
        }
    }

    /**
     * Helper to wrap raw strings into prompt builder compatibility.
     *
     * @param {string} text Raw string.
     * @returns {string}
     */
    part(text) {
        return String(text ?? "");
    }
}