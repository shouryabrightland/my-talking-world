/**
 * @callback ChatListener
 * @param {...unknown[]} args
 * @returns {void}
 */

/**
 * @typedef {import("../ChatMember").default} ChatMember
 * @typedef {import("../Message").default} Message
 */

/**
 * @typedef {Object} ChatEvents
 *
 * @property {(members: ChatMember[]) => void} MemberUpdate
 * @property {(message: Message) => void} NewMessage
 * @property {(member: ChatMember) => void} MemberTypingUpdate
 * @property {(member: ChatMember) => void} MemberEmotionUpdate
 * @property {() => void} ChatStart
 */