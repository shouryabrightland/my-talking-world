// @ts-check

import React, { memo, useEffect, useMemo, useState } from "react";
import styles from "./message.module.css";
import Avatar from "./Avatar";
import { useInputBox } from "../contexts/InputBoxContext";
import { Sound } from "../util/sound";

/**
 * @typedef {import("../classes/Message").default} Message
 * @typedef {import("../classes/ChatMember").default} ChatMember
 * @typedef {import("../classes/lib/Key").Key} Key
 */

export const MessageUX = memo(
    /**
     * Living Dialogue Message Component.
     * Displays dynamic per-message live thoughts, character-branded comic balloons,
     * quote replies, and Director Stage Directive banners.
     *
     * @param {Object} props
     * @param {Message} props.message Context Message instance.
     * @param {ChatMember} props.user Context human user ChatMember.
     * @returns {React.JSX.Element|null}
     */
    function MessageUX({ message, user }) {
        const { setReply } = useInputBox();

        /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
        const [isInspectorOpen, setIsInspectorOpen] = useState(false);

        /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
        const [isThoughtOpen, setIsThoughtOpen] = useState(false);

        const isLiveArrival = useMemo(() => {
            if (!message?.sentAt) return false;
            return (Date.now() - new Date(message.sentAt).getTime()) < 3500;
        }, [message]);

        useEffect(() => {
            if (!message) return;

            if (isLiveArrival) {
                Sound.playMessagePop();

                if (message.sender && message.sender.isAI) {
                    const timer = setTimeout(() => {
                        Sound.playCharacterVoice(message.sender?.id);
                    }, 50);
                    return () => clearTimeout(timer);
                }
            }
        }, [message, isLiveArrival]);

        if (!message) return null;

        // 1. Director Stage Directive Banner (God Mode)
        if (!message.sender) {
            return (
                <div className={`${styles.directorRow} ${isLiveArrival ? styles.popIn : ""}`}>
                    <div className={styles.directorBanner}>
                        <div className={styles.directorHeader}>
                            <span className={styles.directorBadge}>🎬 STAGE DIRECTIVE</span>
                        </div>
                        <p className={styles.directorText}>"{message.text}"</p>
                    </div>
                </div>
            );
        }

        // 2. Character / User Speech Balloon
        const isOther = message.sender.id !== user.id;
        const memberId = String(message.sender.id || "tom").toLowerCase();

        const rowClass = isOther
            ? `${styles.msgRowLeft} ${isLiveArrival ? styles.popIn : ""}`.trim()
            : `${styles.msgRowRight} ${isLiveArrival ? styles.popIn : ""}`.trim();

        // Resolves the dynamic thought generated specifically for this turn
        const dynamicThought = message.thought || null;

        // Dynamic Posture or Prop from short-term memory if present
        const activePosture = isOther && message.sender.memory
            ? message.sender.memory.getValue("Current Posture") || message.sender.memory.getValue("Current Prop")
            : null;

        return (
            <>
                <div className={rowClass}>
                    {/* Character Avatar (Click to Quote Reply, Double-Click for Full X-Ray Inspector) */}
                    {isOther && (
                        <div
                            className={styles.avatarWrapper}
                            onClick={() => setReply(message)}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsInspectorOpen(true);
                            }}
                            title="Click to Reply • Double-Click to Inspect Mind"
                        >
                            <Avatar member={message.sender} emotion={message.emotion?.name || "Default"} />
                        </div>
                    )}

                    <div
                        className={isOther ? styles.bubbleOther : styles.bubbleUser}
                        style={/** @type {React.CSSProperties} */ ({
                            "--char-accent": `var(--char-${memberId}, var(--primary))`
                        })}
                    >
                        {isOther && (
                            <div className={styles.senderRow}>
                                <span
                                    className={styles.senderName}
                                    style={{ color: `var(--char-${memberId}, var(--primary))` }}
                                >
                                    {message.sender.name}
                                </span>
                                {typeof activePosture === "string" && activePosture.trim() && (
                                    <span className={styles.propTag} title={`Dynamic State: ${activePosture}`}>
                                        🏃 {activePosture.split(",")[0]}
                                    </span>
                                )}
                            </div>
                        )}

                        <ReplyBox message={message.reply} />

                        <p className={isOther ? styles.bubbleTextOther : styles.bubbleTextUser}>
                            {message.text}
                        </p>

                        <div className={styles.bubbleFooter}>
                            {/* Dynamic Live Thought Peel Trigger */}
                            {isOther && dynamicThought && (
                                <button
                                    onClick={() => setIsThoughtOpen(prev => !prev)}
                                    className={isThoughtOpen ? styles.thoughtBtnActive : styles.thoughtBtn}
                                    title="Peek at what this character was thinking for this line"
                                >
                                    💭 {isThoughtOpen ? "Hide Thought" : "Peek Thought"}
                                </button>
                            )}

                            {isOther && message.emotion?.emoji && (
                                <span className={styles.emotionTag} title={`Emotion: ${message.emotion.name}`}>
                                    {message.emotion.emoji}
                                </span>
                            )}
                        </div>

                        {/* Collapsible Dynamic Thought Peel */}
                        {isOther && isThoughtOpen && dynamicThought && (
                            <div className={styles.thoughtPeelContainer}>
                                <span className={styles.thoughtLabel}>💭 INNER MONOLOGUE:</span>
                                <p className={styles.thoughtText}>"{dynamicThought}"</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Character Dynamic Memory & Mindset Inspector Modal */}
                {isOther && (
                    <CharacterInspectorModal
                        isOpen={isInspectorOpen}
                        member={message.sender}
                        latestThought={message.thought}
                        onClose={() => setIsInspectorOpen(false)}
                    />
                )}
            </>
        );
    }
);

/**
 * @param {Object} props
 * @param {ChatMember} props.member
 * @returns {React.JSX.Element|null}
 */
export function TypingMessageUX({ member }) {
    if (!member) return null;

    const memberId = String(member.id || "tom").toLowerCase();

    return (
        <div className={`${styles.msgRowLeft} ${styles.popIn}`}>
            <div className={styles.avatarWrapper}>
                <Avatar member={member} emotion="Thinking" />
            </div>
            <div className={styles.typingBubble}>
                <span
                    className={styles.senderName}
                    style={{ color: `var(--char-${memberId}, var(--primary))` }}
                >
                    {member.name}
                </span>
                <div className={styles.dotsContainer}>
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                </div>
            </div>
        </div>
    );
}

/**
 * @param {Object} props
 * @param {Message|null} [props.message]
 * @returns {React.JSX.Element|null}
 */
export function ReplyBox({ message }) {
    if (!message || !message.sender) return null;

    const memberId = String(message.sender.id || "tom").toLowerCase();

    return (
        <div className={styles.replyCard}>
            <span
                className={styles.replyAuthor}
                style={{ color: `var(--char-${memberId}, var(--primary))` }}
            >
                {message.sender.name}
            </span>
            <span className={styles.replyContent}>
                {message.text}
            </span>
        </div>
    );
}

/**
 * Dynamic Memory & Mindset Inspector Modal.
 * Scans all active unexpired memories (reminders, postures, thoughts, facts) with live TTL countdowns.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {ChatMember} props.member
 * @param {string|null} [props.latestThought]
 * @param {() => void} props.onClose
 * @returns {React.JSX.Element}
 */
function CharacterInspectorModal({ isOpen, member, latestThought, onClose }) {
    const memberId = String(member?.id || "tom").toLowerCase();

    const activeMemories = useMemo(() => {
        if (!member?.memory) return [];
        return member.memory.values().filter(k => k.isUsable());
    }, [member, isOpen]);

    return (
        <div
            className={`${styles.modalOverlay} ${isOpen ? styles.modalOverlayVisible : ""}`}
            onClick={onClose}
        >
            <div
                className={`${styles.inspectorCard} ${isOpen ? styles.inspectorCardVisible : ""}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.inspectorHeader}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "42px", height: "42px", flexShrink: 0 }}>
                            <Avatar member={member} emotion={member.currentEmotion?.name || "Default"} />
                        </div>
                        <div>
                            <h3
                                className={styles.inspectorName}
                                style={{ color: `var(--char-${memberId}, var(--primary))` }}
                            >
                                {member.name}
                            </h3>
                            <span className={styles.inspectorStatus}>Age: {member.age} yrs • Dynamic Mindset</span>
                        </div>
                    </div>
                    <button onClick={onClose} className={styles.inspectorCloseBtn}>✕</button>
                </div>

                <div className={styles.inspectorBody}>
                    {/* Character Bio */}
                    <div className={styles.inspectorRow}>
                        <span className={styles.inspectorLabel}>🎭 Biography:</span>
                        <span className={styles.inspectorValue}>{member.about}</span>
                    </div>

                    {/* Latest Unspoken Thought */}
                    {latestThought && (
                        <div className={styles.inspectorHighlightSection}>
                            <span className={styles.inspectorLabelHighlight}>💭 Latest Unfiltered Thought:</span>
                            <p className={styles.inspectorThoughtText}>"{latestThought}"</p>
                        </div>
                    )}

                    {/* Active Dynamic Short-Term & Long-Term Memories */}
                    <div className={styles.inspectorRow}>
                        <span className={styles.inspectorLabel}>🧠 Active Dynamic Memories & States:</span>
                        {activeMemories.length === 0 ? (
                            <span className={styles.inspectorValueMuted}>No dynamic states or facts currently active in memory.</span>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                                {activeMemories.map(memKey => {
                                    const isForever = memKey.isForever();
                                    let expiryBadge = "Permanent";

                                    if (memKey.expiry instanceof Date) {
                                        const msLeft = memKey.expiry.getTime() - Date.now();
                                        const minsLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
                                        expiryBadge = minsLeft > 60
                                            ? `${Math.round(minsLeft / 60)}h left`
                                            : `${minsLeft}m left`;
                                    }

                                    return (
                                        <div key={memKey.name} className={styles.memoryFactItem}>
                                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                    <span className={styles.memoryKeyTitle}>{memKey.name}</span>
                                                    <span className={isForever ? styles.foreverTag : styles.ttlTag}>
                                                        {isForever ? "♾️ Perm" : `⏱️ ${expiryBadge}`}
                                                    </span>
                                                </div>
                                                <span className={styles.memoryValueText}>
                                                    {Array.isArray(memKey.value) ? memKey.value.join(", ") : String(memKey.value)}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}