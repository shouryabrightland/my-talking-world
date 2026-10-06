// @ts-check

/**
 * @file footer.jsx
 * Dual-Mode Footer Hub containing:
 * - Character Lounge: Visual strip of AI character avatars with live emotion states.
 * - User Input Box: Text input with emotion drawer for sending messages as the human user.
 * - Director Input Box: Plot twist injection console (disabled when offline).
 *
 * In offline mode:
 * - User can still send messages locally (they appear in chat history).
 * - Director mode is disabled (requires AI to generate responses).
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import styles from "./footer.module.css";
import Message from "../classes/Message";
import Reaction from "../classes/Reaction";
import { ChatEvents } from "../classes/Chat";
import { ChatMemberEvents } from "../classes/ChatMember";
import { useChat } from "../contexts/ChatContext";
import { useInputBox } from "../contexts/InputBoxContext";
import { useOffline } from "../contexts/OfflineContext";
import Avatar from "./Avatar";
import { ReplyBox } from "./message";
import { sampleDirectorPresets } from "../util/directorPresets";

/**
 * Dual-Mode Footer Hub.
 * Renders either the User input or Director input based on the current mode.
 * In offline mode, forces User mode and disables Director mode.
 *
 * @returns {React.JSX.Element}
 */
export const Footer = memo(function Footer() {
    const { mode } = useInputBox();
    const { isOffline } = useOffline();

    // In offline mode, force user mode (Director requires AI)
    const effectiveMode = isOffline ? "user" : mode;

    return (
        <footer className={`${styles.footerContainer} ${effectiveMode === "director" ? styles.footerDirector : ""}`}>
            {effectiveMode === "user" && <Characters />}
            {effectiveMode === "user" ? <UserInputBox /> : <DirectorInputBox />}
        </footer>
    );
});

/**
 * Living Cast Lounge.
 * Displays a horizontal strip of AI character avatars that respond to live emotion/typing states.
 *
 * @returns {React.JSX.Element}
 */
function Characters() {
    const conv = useChat();
    const chat = conv.chat;

    /** @type {[import("../classes/ChatMember").default[], React.Dispatch<React.SetStateAction<import("../classes/ChatMember").default[]>>]} */
    const [members, setMembers] = useState(() => chat.getMembers().filter(m => m.isAI));

    /** Subscribe to member add/remove events to keep the list synchronized */
    useEffect(() => {
        const update = () => setMembers(chat.getMembers().filter(m => m.isAI));
        const offAdd = chat.events.on(ChatEvents.MEMBER_ADD, update, "Footer: member add");
        const offRemove = chat.events.on(ChatEvents.MEMBER_REMOVE, update, "Footer: member remove");

        return () => {
            offAdd();
            offRemove();
        };
    }, [chat]);

    return (
        <div className={styles.charactersTrack}>
            {members.map(member => (
                <Character key={member.id} member={member} />
            ))}
        </div>
    );
}

/**
 * Single AI character avatar in the lounge.
 * Responds to live emotion, typing, reading, and thinking state changes.
 *
 * @param {Object} props
 * @param {import("../classes/ChatMember").default} props.member The AI character.
 * @returns {React.JSX.Element}
 */
function Character({ member }) {
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [emotion, setEmotion] = useState(member.currentEmotion?.name || "Default");

    /** @type {[{ active: boolean, reading: boolean, typing: boolean, thinking: boolean }, React.Dispatch<React.SetStateAction<{ active: boolean, reading: boolean, typing: boolean, thinking: boolean }>>]} */
    const [state, setState] = useState({
        active: member.isActive,
        reading: member.isReading,
        typing: member.isTyping,
        thinking: member.isThinking
    });

    /** Subscribe to all member state events for live avatar updates */
    useEffect(() => {
        const offEmotion = member.events.on(
            ChatMemberEvents.EMOTION,
            /** @param {any} em */ (em) => setEmotion(em?.name || "Default"),
            "Footer: emotion"
        );
        const offTyping = member.events.on(
            ChatMemberEvents.TYPING,
            /** @param {boolean} status */ (status) => setState(prev => ({ ...prev, typing: status })),
            "Footer: typing"
        );
        const offReading = member.events.on(
            ChatMemberEvents.READING,
            /** @param {boolean} status */ (status) => setState(prev => ({ ...prev, reading: status })),
            "Footer: reading"
        );
        const offThinking = member.events.on(
            ChatMemberEvents.THINKING,
            /** @param {boolean} status */ (status) => setState(prev => ({ ...prev, thinking: status })),
            "Footer: thinking"
        );
        const offActive = member.events.on(
            ChatMemberEvents.ACTIVE,
            /** @param {boolean} status */ (status) => setState(prev => ({ ...prev, active: status })),
            "Footer: active"
        );

        return () => {
            offEmotion();
            offTyping();
            offReading();
            offThinking();
            offActive();
        };
    }, [member]);

    // Determine vertical translation based on activity state
    /** @type {string} */
    let translateY = "0%";
    if (state.active && (state.typing || state.reading || state.thinking)) {
        translateY = "0%";
    } else if (state.active) {
        translateY = "40%";
    }

    return (
        <div
            className={styles.charItem}
            style={{ transform: `translate3d(0, ${translateY}, 0)` }}
            title={`${member.name} • Mood: ${member.currentEmotion?.name || "Neutral"}`}
        >
            {state.typing && (
                <div className={styles.avatarTypingCloud} aria-label={`${member.name} is typing`}>
                    <span className={styles.cloudDot} />
                    <span className={styles.cloudDot} />
                    <span className={styles.cloudDot} />
                </div>
            )}
            <Avatar member={member} emotion={emotion} />
        </div>
    );
}

/**
 * 👤 User Mode Input Hub.
 * Allows the human user to type messages and send them with emotions.
 * Works fully offline — messages are stored locally in IndexedDB.
 *
 * @returns {React.JSX.Element}
 */
const UserInputBox = memo(function UserInputBox() {
    const conv = useChat();
    const user = conv.User;
    const { Reply, setReply } = useInputBox();

    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [text, setText] = useState("");

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    /** Ref to track typing debounce timeout */
    /** @type {React.MutableRefObject<ReturnType<typeof setTimeout>|null>} */
    const typingTimeout = useRef(null);

    /**
     * Updates input text and manages typing indicator state.
     * @param {string} newText The new input value.
     * @returns {string} The text to set.
     */
    const updateText = useCallback((/** @type {string} */ newText) => {
        if (typingTimeout.current) {
            clearTimeout(typingTimeout.current);
            typingTimeout.current = null;
        }

        if (!newText) {
            user.events.emit(ChatMemberEvents.TYPING, false);
            return newText;
        }

        user.events.emit(ChatMemberEvents.TYPING, true);

        typingTimeout.current = setTimeout(() => {
            user.events.emit(ChatMemberEvents.TYPING, false);
            typingTimeout.current = null;
        }, 1200);

        return newText;
    }, [user]);

    /** Handle text input change events */
    const handleChange = useCallback((/** @type {React.ChangeEvent<HTMLInputElement>} */ event) => {
        setText(updateText(event.target.value));
    }, [updateText]);

    /**
     * Sends a message with the specified emotion.
     * Works offline — message is stored in local IndexedDB.
     * @param {string} emotionName The emotion to attach to the message.
     */
    const handleSendWithEmotion = useCallback((/** @type {string} */ emotionName) => {
        const trimmed = text.trim();
        const messageText = trimmed || (Reply ? `Reacted to quote` : `*${emotionName} expression*`);

        const message = new Message({
            sender: user,
            text: messageText,
            protocolReplyId: Reply?.protocol?.id ?? null,
            protocolId: crypto.randomUUID(),
            emotion: { name: emotionName }
        });

        user.send(message);

        setReply(null);
        setText("");
        setIsDrawerOpen(false);
        user.events.emit(ChatMemberEvents.TYPING, false);

        if (typingTimeout.current) {
            clearTimeout(typingTimeout.current);
            typingTimeout.current = null;
        }
    }, [text, user, Reply, setReply]);

    /** Handle form submission (Enter key or Send button) */
    const handleFormSubmit = useCallback((/** @type {React.FormEvent} */ event) => {
        event.preventDefault();
        if (text.trim()) {
            handleSendWithEmotion("Default");
        } else {
            setIsDrawerOpen(true);
        }
    }, [text, handleSendWithEmotion]);

    /** Cleanup typing indicator on unmount */
    useEffect(() => {
        return () => {
            if (typingTimeout.current) clearTimeout(typingTimeout.current);
            user.events.emit(ChatMemberEvents.TYPING, false);
        };
    }, [user]);

    return (
        <div className={styles.inputHub}>
            {/* Quote Reply Banner */}
            {Reply && (
                <div className={styles.replyBanner}>
                    <div style={{ flex: 1 }}>
                        <ReplyBox message={Reply} />
                    </div>
                    <button
                        onClick={() => setReply(null)}
                        className={styles.replyCloseBtn}
                        aria-label="Cancel reply"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Slide-Up Emotion Drawer */}
            <div className={`${styles.drawer} ${isDrawerOpen ? styles.drawerOpen : ""}`}>
                <div className={styles.drawerHeader}>
                    <span className={styles.drawerTitle}>
                        {text.trim() ? "Send message as emotion:" : "Send quick emotion reaction:"}
                    </span>
                    <button
                        onClick={() => setIsDrawerOpen(false)}
                        className={styles.drawerCloseBtn}
                        aria-label="Close drawer"
                    >
                        ✕
                    </button>
                </div>

                <div className={styles.emotionGrid}>
                    {Reaction.EMOTION.map(em => (
                        <button
                            key={em.name}
                            onClick={() => handleSendWithEmotion(em.name)}
                            className={styles.emotionTile}
                            title={`Send as ${em.name}`}
                        >
                            <span className={styles.emotionEmoji}>{em.emoji}</span>
                            <span className={styles.emotionLabel}>{em.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Message Input Row */}
            <form onSubmit={handleFormSubmit} className={styles.inputForm}>
                <input
                    placeholder={Reply ? "Type your reply..." : "Talk with Tom and the cast..."}
                    value={text}
                    onChange={handleChange}
                    className={styles.inputField}
                />
                <button
                    type="button"
                    onClick={() => setIsDrawerOpen(prev => !prev)}
                    className={isDrawerOpen ? styles.expressionBtnActive : styles.expressionBtn}
                    title="Select expression & send"
                    aria-label="Select expression and send"
                >
                    🎭
                </button>
                {text.trim() && (
                    <button type="submit" className={styles.sendBtn} title="Send Message">
                        🚀
                    </button>
                )}
            </form>
        </div>
    );
});

/**
 * 🎬 Fluid Director Console.
 * Allows injecting plot twists and stage directives into the dialogue flow.
 * **Disabled when offline** — requires AI to generate character responses.
 *
 * @returns {React.JSX.Element}
 */
const DirectorInputBox = memo(function DirectorInputBox() {
    const conv = useChat();
    const { isOffline } = useOffline();

    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [plotText, setPlotText] = useState("");

    /** 10 random unique director cues sampled once per mount from the 200-cue library */
    const [quickPresets] = useState(() => sampleDirectorPresets(10));

    /**
     * Injects a director plot twist into the conversation flow.
     * @param {string} directive The plot twist text.
     */
    const handleInject = useCallback((/** @type {string} */ directive) => {
        const clean = directive.trim();
        if (!clean) return;
        conv.injectDirectorPlot(clean);
        setPlotText("");
    }, [conv]);

    /** Handle form submission */
    const handleSubmit = useCallback((/** @type {React.FormEvent} */ e) => {
        e.preventDefault();
        handleInject(plotText);
    }, [plotText, handleInject]);

    // Offline guard: Show disabled state when offline
    if (isOffline) {
        return (
            <div className={styles.directorHub} style={{ opacity: 0.5, pointerEvents: "none" }}>
                <div className={styles.presetTrack}>
                    <span className={styles.presetHeading}>🎬 DIRECTOR MODE — OFFLINE</span>
                </div>
                <div className={styles.directorForm}>
                    <input
                        placeholder="Director mode is disabled while offline..."
                        disabled
                        className={styles.directorInput}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className={styles.directorHub}>
            {/* Horizontal Presets Rail */}
            <div className={styles.presetTrack}>
                <span className={styles.presetHeading}>DIRECTOR CUES:</span>
                {quickPresets.map((preset) => (
                    <button
                        key={preset.label}
                        onClick={() => setPlotText(preset.plot)}
                        className={styles.presetChip}
                        title={preset.plot}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>

            {/* Fluid Input & Inject Action */}
            <form onSubmit={handleSubmit} className={styles.directorForm}>
                <input
                    placeholder="Inject a plot twist (e.g. 'finds a mystery package on the doorstep')..."
                    value={plotText}
                    onChange={(e) => setPlotText(e.target.value)}
                    className={styles.directorInput}
                />
                <button
                    type="submit"
                    className={styles.directorSendBtn}
                    disabled={!plotText.trim()}
                    title="Execute Stage Directive"
                >
                    <span className={styles.directorBtnTextFull}>⚡ Inject Twist</span>
                    <span className={styles.directorBtnTextShort}>⚡ Inject</span>
                </button>
            </form>
        </div>
    );
});
