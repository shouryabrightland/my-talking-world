// @ts-check

/**
 * @file XmlEncoder.js
 * Shared XML entity encoding/decoding utilities.
 *
 * Responsibilities:
 * - Encodes raw text to safe XML strings (escaping &, <, >, ", ').
 * - Decodes XML entities back to raw text.
 * - Extracted from duplicated code across ConversationManager, World, and WorldSetter.
 */
export default class XmlEncoder {

    /**
     * Encodes raw text to safe XML string.
     * @param {string} str Raw text input.
     * @returns {string} XML-safe encoded string.
     */
    static encode(str) {
        if (!str || typeof str !== "string") return "";
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    /**
     * Decodes XML entities back to raw text.
     * @param {string} str XML-encoded string.
     * @returns {string} Decoded string.
     */
    static decode(str) {
        if (!str || typeof str !== "string") return "";
        return str
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'");
    }
}
