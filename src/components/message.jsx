// @ts-check

import React, { memo, useEffect, useMemo, useState } from "react";
import styles from "./message.module.css";
import Avatar from "./Avatar";
import { useOptionalChat } from "../contexts/ChatContext";
import MemoryExpiryParser from "../classes/lib/MemoryExpiryParser";
import { Sound } from "../util/sound";

/**
 * @typedef {import("../classes/Message").default} Message
 * @typedef {import("../classes/ChatMember").default} ChatMember
 */

export const MessageUX = memo(
    /**
     * Living Dialogue Message Component.
     * Displays character-branded comic balloons and Director Stage Directive banners.
     *
     * @param {Object} props
     * @param {Message} props.message Context Message instance.
     * @param {ChatMember} props.user Context human user ChatMember.
     * @returns {React.JSX.Element|null}
     */
    function MessageUX({ message, user }) {
        /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
        const [isInspectorOpen, setIsInspectorOpen] = useState(false);

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

        return (
            <>
                <div className={rowClass}>
                    {/* Character Avatar (Double-Click for Full X-Ray Inspector) */}
                    {isOther && (
                        <div
                            className={styles.avatarWrapper}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsInspectorOpen(true);
                            }}
                            title="Double-Click to Inspect Mind"
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
                            </div>
                        )}

                        <p className={isOther ? styles.bubbleTextOther : styles.bubbleTextUser}>
                            {message.text}
                        </p>

                        <div className={styles.bubbleFooter}>
                            {isOther && message.emotion?.emoji && (
                                <span className={styles.emotionTag} title={`Emotion: ${message.emotion.name}`}>
                                    {message.emotion.emoji}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Character Dynamic Memory Inspector Modal */}
                {isOther && (
                    <CharacterInspectorModal
                        isOpen={isInspectorOpen}
                        member={message.sender}
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
 * Renders a UnifiedMemory entry expiry as a short human-readable badge.
 *
 * @param {string|number|null|undefined} expiry "forever", "-1", epoch ms, "15m"/"2h"/"7d", or ISO.
 * @returns {{ permanent: boolean, label: string }}
 */
function formatUnifiedExpiry(expiry) {
    if (expiry === -1 || expiry === "-1" || expiry === "forever" || !expiry) {
        return { permanent: true, label: "♾️ Forever" };
    }

    const parsed = typeof expiry === "number" ? new Date(expiry) : MemoryExpiryParser.parse(expiry);
    if (!(parsed instanceof Date)) return { permanent: true, label: "♾️ Forever" };

    const msLeft = parsed.getTime() - Date.now();
    if (msLeft <= 0) return { permanent: false, label: "⚠️ Expired" };

    const minsLeft = Math.max(1, Math.round(msLeft / 60000));
    return {
        permanent: false,
        label: `⏱️ ${minsLeft > 60 ? `${Math.round(minsLeft / 60)}h left` : `${minsLeft}m left`}`
    };
}

/**
 * Unified Memory Inspector Modal.
 * Reads reference-based memories tagged for this member from UnifiedMemory.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {ChatMember} props.member
 * @param {() => void} props.onClose
 * @returns {React.JSX.Element}
 */
function CharacterInspectorModal({ isOpen, member, onClose }) {
    const memberId = String(member?.id || "tom").toLowerCase();
    const conv = useOptionalChat();

    const activeMemories = useMemo(() => {
        if (!conv?.unifiedMemory) return [];
        return conv.unifiedMemory.getEntriesForMember(memberId);
    }, [conv, memberId, isOpen]);

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
                        <div className={styles.inspectorAvatarWrapper}>
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

                    {/* Reference-Based Unified Memories Tagged for this Member */}
                    <div className={styles.inspectorRow}>
                        <span className={styles.inspectorLabel}>🧠 Tagged Memories:</span>
                        {activeMemories.length === 0 ? (
                            <span className={styles.inspectorValueMuted}>No unified memory entries are tagged for this character yet.</span>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                                {activeMemories.map(entry => {
                                    const expiry = formatUnifiedExpiry(entry.expiry);
                                    const entryTitle = entry.tags.filter(t => t !== memberId).join(", ") || "Memory";

                                    return (
                                        <div
                                            key={entry.id}
                                            className={styles.memoryNotebookCard}
                                            style={{ borderLeftColor: `var(--char-${memberId}, var(--primary))` }}
                                        >
                                            <div className={styles.memoryCardTopRow}>
                                                <span className={styles.memoryCardTitle}>📌 {entryTitle}</span>
                                                <span className={expiry.permanent ? styles.memoryCardExpiryTagPermanent : styles.memoryCardExpiryTag}>
                                                    {expiry.label}
                                                </span>
                                            </div>
                                            <span className={styles.memoryCardContent}>
                                                {entry.data}
                                            </span>
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