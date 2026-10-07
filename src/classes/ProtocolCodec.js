// @ts-check

/** @typedef {import("./lib/Logger").default} Logger */
/** @typedef {import("./types/Protocol.types").ProtocolRecord} ProtocolRecord */
/** @typedef {import("./types/Protocol.types").MessageProtocolRecord} MessageProtocolRecord */
/** @typedef {import("./types/Protocol.types").MemorySetProtocolRecord} MemorySetProtocolRecord */
/** @typedef {import("./types/Protocol.types").MemoryRemoveProtocolRecord} MemoryRemoveProtocolRecord */

/**
 * Hardened XML Tag Protocol Codec for Streaming & Reasoning Models.
 * Strips markdown fences (```xml) and parses structured `<record>` tags safely.
 * Residual `<thought>` spans are stripped from message bodies so they never
 * reach a chat bubble — the `<thought>` system itself has been eliminated.
 */
export default class ProtocolCodec {

    /** 
     * Maximum bytes retained in the stream buffer before discarding corrupt leading text.
     * @readonly
     */
    static MAX_BUFFER_LENGTH = 32_768;

    /**
     * Separates `<think>...</think>` reasoning chains from the clean payload text.
     *
     * @param {string} text Raw text returned by reasoning models.
     * @returns {{ cleanText: string, thinking: string | null }}
     */
    static extractThinkingChain(text) {
        if (!text || typeof text !== "string") {
            return { cleanText: "", thinking: null };
        }

        /** @type {string[]} */
        const thinkingParts = [];
        const thinkRegex = /<\s*think\b[^>]*>([\s\S]*?)<\/\s*think\s*>/gi;
        let match;

        while ((match = thinkRegex.exec(text)) !== null) {
            if (match[1] && match[1].trim()) {
                thinkingParts.push(match[1].trim());
            }
        }

        // Clean text by stripping think tags and markdown code blocks
        let cleanText = text.replace(/<\s*think\b[^>]*>[\s\S]*?<\/\s*think\s*>/gi, "");
        cleanText = cleanText.replace(/```(?:xml|json)?/gi, "").replace(/```/g, "").trim();

        return {
            cleanText,
            thinking: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : null
        };
    }

    /**
     * @param {{ logger: Logger }} options
     */
    constructor({ logger }) {
        if (!logger) throw new TypeError("ProtocolCodec requires a Logger instance.");

        /** @readonly @type {Logger} */
        this.logger = logger.child("ProtocolCodec");
    }

    /**
     * Strips incomplete/trailing `<record>` tags that were never closed (from aborted streams).
     * Prevents stale partial XML from polluting the next turn's buffer.
     *
     * @param {string} buffer The raw protocol buffer.
     * @returns {string} Buffer with any trailing incomplete record tags removed.
     */
    static stripIncompleteTrailingRecords(buffer) {
        if (!buffer || typeof buffer !== "string") return "";

        // Find the last occurrence of an opening <record> tag
        const lastOpenRecord = buffer.lastIndexOf("<record");
        if (lastOpenRecord === -1) return buffer;

        // Check if there's a matching </record> after the last opening tag
        const lastCloseRecord = buffer.lastIndexOf("</record>");
        if (lastCloseRecord > lastOpenRecord) return buffer;

        // No matching close tag — truncate at the opening tag
        return buffer.slice(0, lastOpenRecord).trimEnd();
    }

    /**
     * Parses a text block into an array of verified ProtocolRecords.
     * Automatically strips `<think>` tokens and markdown fences before processing.
     *
     * @param {string} text Raw text containing XML record tags.
     * @returns {ProtocolRecord[]} Array of parsed protocol records.
     */
    parseRecords(text) {
        if (!text || typeof text !== "string" || !text.trim()) {
            return [];
        }

        const { cleanText } = ProtocolCodec.extractThinkingChain(text);

        /** @type {ProtocolRecord[]} */
        const results = [];
        // Match both paired tags (<record>...</record>) and self-closing tags (<record ... />)
        const recordTagRegex = /<\s*record\b([^>]*)>([\s\S]*?)<\/\s*record\s*>/gi;
        const selfClosingRegex = /<\s*record\b([^>]*?)\s*\/\s*>/gi;
        let match;

        while ((match = recordTagRegex.exec(cleanText)) !== null) {
            const rawAttributes = match[1] || "";
            const innerContent = match[2] || "";

            const attributes = this.#extractAttributes(rawAttributes);
            const recordType = (attributes.type || "").toLowerCase();

            switch (recordType) {
                case "message": {
                    const record = this.#parseMessageTag(attributes, innerContent);
                    if (record) results.push(record);
                    break;
                }
                case "memory-set": {
                    const record = this.#parseMemorySetTag(attributes, innerContent);
                    if (record) results.push(record);
                    break;
                }
                case "memory-remove": {
                    const record = this.#parseMemoryRemoveTag(attributes, innerContent);
                    if (record) results.push(record);
                    break;
                }
                default:
                    this.logger.warn(`Ignored unrecognized <record type="${recordType}"> tag.`);
                    break;
            }
        }

        // Also process self-closing <record ... /> tags
        while ((match = selfClosingRegex.exec(cleanText)) !== null) {
            const rawAttributes = match[1] || "";
            const attributes = this.#extractAttributes(rawAttributes);
            const recordType = (attributes.type || "").toLowerCase();

            switch (recordType) {
                case "message": {
                    const record = this.#parseMessageTag(attributes, "");
                    if (record) results.push(record);
                    break;
                }
                case "memory-set": {
                    const record = this.#parseMemorySetTag(attributes, "");
                    if (record) results.push(record);
                    break;
                }
                case "memory-remove": {
                    const record = this.#parseMemoryRemoveTag(attributes, "");
                    if (record) results.push(record);
                    break;
                }
                default:
                    this.logger.warn(`Ignored unrecognized self-closing <record type="${recordType}"> tag.`);
                    break;
            }
        }

        return results;
    }

    /**
     * Extracts key-value attributes from opening tag safely.
     *
     * @param {string} attrString
     * @returns {Record<string, string>}
     */
    #extractAttributes(attrString) {
        /** @type {Record<string, string>} */
        const attributes = {};
        const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let match;

        while ((match = attrRegex.exec(attrString)) !== null) {
            const key = match[1].toLowerCase();
            const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
            attributes[key] = this.#decodeEntities(value.trim());
        }

        return attributes;
    }

    /**
     * Extracts text content enclosed inside an inner XML tag.
     *
     * @param {string} content
     * @param {string} tagName
     * @returns {string|null}
     */
    #extractTagContent(content, tagName) {
        const regex = new RegExp(`<\\s*${tagName}\\b[^>]*>([\\s\\S]*?)<\\/\\s*${tagName}\\s*>`, "i");
        const match = content.match(regex);
        return match && match[1] !== undefined ? this.#decodeEntities(match[1].trim()) : null;
    }

    /**
     * Parses `<record type="message">` tag.
     *
     * @param {Record<string, string>} attributes
     * @param {string} content
     * @returns {MessageProtocolRecord|null}
     */
    #parseMessageTag(attributes, content) {
        const id = this._parseInteger(attributes.id);
        if (id === null) {
            this.logger.warn("<record type='message'> missing valid numeric 'id' attribute.");
            return null;
        }

        const sender = attributes.sender ? attributes.sender.trim().toLowerCase() : "";
        if (!sender) {
            this.logger.warn("<record type='message'> missing required 'sender' attribute.");
            return null;
        }

        const replyToID = this._parseReplyId(attributes.reply || attributes.replytoid);
        const reaction = attributes.reaction ? attributes.reaction.trim() : "Default";

        // <thought> spans are stripped, never surfaced — see class docs.
        let text = this.#extractTagContent(content, "text");

        if (text === null) {
            text = content.replace(/<\s*thought\b[^>]*>[\s\S]*?<\/\s*thought\s*>/gi, "").trim();
            text = this.#decodeEntities(text);
        }

        if (!text) {
            return null;
        }

        return {
            recordType: "message",
            id,
            replyToID,
            reaction,
            sender,
            text
        };
    }

    /**
     * Parses `<record type="memory-set">` tag supporting flexible dynamic TTL expiries.
     *
     * @param {Record<string, string>} attributes
     * @param {string} content
     * @returns {MemorySetProtocolRecord|null}
     */
    #parseMemorySetTag(attributes, content) {
        const member = (attributes.member || attributes.sender || "me").toLowerCase().trim();
        const key = this.#extractTagContent(content, "key") || attributes.key;

        if (!key) {
            this.logger.warn("<record type='memory-set'> missing required <key> content.");
            return null;
        }

        const rawValue = this.#extractTagContent(content, "value") || attributes.value;
        const expiry = attributes.expiry || this.#extractTagContent(content, "expiry") || "forever";

        return {
            recordType: "memory-set",
            member,
            key,
            value: this._parseValue(rawValue),
            expiry: this._parseExpiry(expiry)
        };
    }

    /**
     * Parses `<record type="memory-remove">` tag.
     *
     * @param {Record<string, string>} attributes
     * @param {string} content
     * @returns {MemoryRemoveProtocolRecord|null}
     */
    #parseMemoryRemoveTag(attributes, content) {
        const member = (attributes.member || attributes.sender || "me").toLowerCase().trim();
        const key = this.#extractTagContent(content, "key") || attributes.key;

        if (!key) {
            this.logger.warn("<record type='memory-remove'> missing required <key> content.");
            return null;
        }

        return {
            recordType: "memory-remove",
            member,
            key
        };
    }

    /**
     * @param {string} str
     * @returns {string}
     */
    #decodeEntities(str) {
        if (!str || typeof str !== "string") return "";
        try {
            return str
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&apos;/g, "'");
        } catch {
            // Guard against malformed entities — return input as-is on failure
            return str;
        }
    }

    /**
     * @param {string|undefined} value
     * @returns {number|null}
     */
    _parseInteger(value) {
        if (value === undefined || value.trim() === "") return null;
        const num = Number(value.trim());
        return Number.isInteger(num) ? num : null;
    }

    /**
     * @param {string|undefined} value
     * @returns {string|null}
     */
    _parseReplyId(value) {
        if (value === undefined) return null;
        const trimmed = value.trim();
        if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
            return null;
        }
        return trimmed;
    }

    /**
     * @param {string|null|undefined} value
     * @returns {any}
     */
    _parseValue(value) {
        if (value === undefined || value === null) return null;
        const trimmed = value.trim();
        if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
        if (trimmed.toLowerCase() === "undefined") return undefined;

        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed;
        }
    }

    /**
     * @param {string|null|undefined} value
     * @returns {string|null}
     */
    _parseExpiry(value) {
        if (value === undefined || value === null) return null;
        const trimmed = value.trim();
        if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "notset") {
            return null;
        }
        return trimmed;
    }
}