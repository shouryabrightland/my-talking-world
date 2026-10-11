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
import { ConversationEvents } from "../classes/ConversationManager";
import Avatar from "./Avatar";
import { sampleDirectorPresets } from "../util/directorPresets";

/**
 * Typing inactivity cadence in ms (Task 6): `isTyping` flips true on every
 * keystroke and only returns to false once typing has ceased for a full 800ms,
 * so rapid follow-up messages keep the flag alive while the turn orchestrator
 * defers the AI turn until the pause settles.
 * @type {number}
 */
const TYPING_IDLE_MS = 800;

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
    let translateY = "100%";
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

        user.events.emit(ChatMemberEvents.TYPING, true);

        typingTimeout.current = setTimeout(() => {
            user.events.emit(ChatMemberEvents.TYPING, false);
            typingTimeout.current = null;
        }, TYPING_IDLE_MS);

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
        const messageText = trimmed || `*${emotionName} expression*`;

        const message = new Message({
            sender: user,
            text: messageText,
            protocolId: crypto.randomUUID(),
            emotion: { name: emotionName }
        });

        user.send(message);

        setText("");
        setIsDrawerOpen(false);

        // Immediate reset: clear typing indicator synchronously on submit so
        // the engine never treats the user as mid-sentence.
        if (typingTimeout.current) {
            clearTimeout(typingTimeout.current);
            typingTimeout.current = null;
        }
        user.events.emit(ChatMemberEvents.TYPING, false);
    }, [text, user]);

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
                    placeholder="Talk with Tom and the cast..."
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
 * Phase 6.4: 30-second cooldown countdown on the inject button, plus the
 * Active Twists Rail — a single twist gets a direct `[✕ End]` pill, multiple
 * twists get selection checkboxes + "End Selected", and ending controls lock
 * for 1 turn after an end operation.
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

    /** UI mirror of ConversationManager.activeDirectives (twists rail). */
    const [twists, setTwists] = useState(() => [...(conv.activeDirectives || [])]);

    /** Twist ids checked in the multi-twist selection. */
    const [selected, setSelected] = useState(() => new Set());

    /** Epoch ms when the 30s injection cooldown expires. */
    const [cooldownUntil, setCooldownUntil] = useState(() => conv.directorCooldownUntil || 0);

    /** Rejection / hint notice rendered under the rail. */
    const [notice, setNotice] = useState("");

    /** Re-render tick driving the cooldown countdown. */
    const [, setTick] = useState(0);

    // Keep the rail in sync with every engine-side twist mutation
    // (injection, Gemma cancellations, ending, post-turn pruning).
    useEffect(() => {
        const unsubscribe = conv.events.on(
            ConversationEvents.DIRECTOR_TWIST_CHANGE,
            (/** @type {import("../classes/ConversationManager").DirectorTwist[]|undefined} */ list) => {
                const next = list || conv.activeDirectives || [];
                setTwists([...next]);
                setSelected(prev => {
                    const alive = new Set(next.map(t => t.id));
                    const kept = [...prev].filter(id => alive.has(id));
                    return kept.length === prev.size ? prev : new Set(kept);
                });
            },
            "DirectorInputBox: twist changes"
        );
        setTwists([...(conv.activeDirectives || [])]);
        return () => { unsubscribe(); };
    }, [conv]);

    // Cooldown countdown: ticks at 250ms and stops itself once the window closes.
    useEffect(() => {
        if (cooldownUntil <= Date.now()) return undefined;

        const intervalId = setInterval(() => {
            if (Date.now() >= cooldownUntil) {
                setTick(0);
                clearInterval(intervalId);
            } else {
                setTick(Date.now());
            }
        }, 250);

        return () => clearInterval(intervalId);
    }, [cooldownUntil]);

    const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    const onCooldown = cooldownSeconds > 0;
    const endingLocked = typeof conv.isEndingLocked === "function" ? conv.isEndingLocked() : false;

    /**
     * Injects a director plot twist into the conversation flow.
     * Runs the synchronous gate (cooldown / 5-twist limit / offline) BEFORE
     * consuming the text so a rejected directive stays editable.
     * @param {string} directive The plot twist text.
     */
    const handleInject = useCallback((/** @type {string} */ directive) => {
        const clean = directive.trim();
        if (!clean) return;

        const gate = conv.directorGate();
        if (!gate.ok) {
            setCooldownUntil(conv.directorCooldownUntil || Date.now());
            setNotice(
                gate.reason === "cooldown"
                    ? `⏳ Wait ${gate.waitSeconds ?? 30}s before the next twist.`
                    : gate.reason === "limit"
                        ? "Max 5 active twists — end one before adding another."
                        : "Director mode is offline right now."
            );
            return;
        }

        setNotice("");
        setPlotText("");
        // Fire the injection (engine arms its cooldown synchronously before
        // the first await) and mirror it into the countdown state.
        void conv.injectDirectorPlot(clean);
        setCooldownUntil(conv.directorCooldownUntil || Date.now() + 30000);
    }, [conv]);

    /**
     * Marks the given twists as ending — their post_plot leads the next turn
     * and the controls lock for 1 turn.
     * @param {string[]} ids Twist ids to end.
     */
    const handleEnd = useCallback((/** @type {string[]} */ ids) => {
        if (!ids.length || typeof conv.endTwists !== "function") return;

        const result = conv.endTwists(ids);
        if (!result.ok) {
            setNotice(
                result.reason === "locked"
                    ? "⏳ Resolving the current incident — ending is locked for one turn."
                    : "Nothing to end."
            );
            return;
        }

        setNotice("");
        setSelected(new Set());
    }, [conv]);

    /** Toggles a twist's checkbox in the multi-twist rail. */
    const toggleSelect = useCallback((/** @type {string} */ id) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

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

    const singleTwist = twists.length === 1;

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

            {/* Active Twists Rail (Phase 6.4) */}
            {twists.length > 0 && (
                <div className={styles.twistRail}>
                    <span className={styles.twistRailLabel}>ACTIVE:</span>
                    {twists.map((twist) => (
                        <label
                            key={twist.id}
                            className={`${styles.twistPill} ${twist.status === "ending" ? styles.twistPillEnding : ""}`}
                            title={twist.directive}
                        >
                            {!singleTwist && (
                                <input
                                    type="checkbox"
                                    className={styles.twistCheck}
                                    checked={selected.has(twist.id)}
                                    disabled={endingLocked || twist.status === "ending"}
                                    onChange={() => toggleSelect(twist.id)}
                                    aria-label={`Select twist: ${twist.title}`}
                                />
                            )}
                            <span className={styles.twistTitle}>
                                {twist.status === "ending" ? "⏳ " : "⚡ "}{twist.title}
                            </span>
                        </label>
                    ))}
                    {singleTwist ? (
                        <button
                            type="button"
                            className={styles.twistEndBtn}
                            disabled={endingLocked || twists[0].status === "ending"}
                            onClick={() => handleEnd([twists[0].id])}
                        >
                            ✕ End
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={styles.twistEndBtn}
                            disabled={endingLocked || selected.size === 0}
                            onClick={() => handleEnd([...selected].map(String))}
                        >
                            End Selected{selected.size > 0 ? ` (${selected.size})` : ""}
                        </button>
                    )}
                </div>
            )}

            {/* Rejection / hint notice */}
            {notice && <div className={styles.directorNotice}>{notice}</div>}

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
                    disabled={!plotText.trim() || onCooldown}
                    title="Execute Stage Directive"
                >
                    {onCooldown ? (
                        <span className={styles.directorCooldownText}>⏳ {cooldownSeconds}s</span>
                    ) : (
                        <>
                            <span className={styles.directorBtnTextFull}>⚡ Inject Twist</span>
                            <span className={styles.directorBtnTextShort}>⚡ Inject</span>
                        </>
                    )}
                </button>
            </form>
        </div>
    );
});
