// @ts-check

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Header.module.css";
import { useChat } from "../contexts/ChatContext";
import { useInputBox } from "../contexts/InputBoxContext";
import { useOffline } from "../contexts/OfflineContext";
import { ChatEvents } from "../classes/Chat";
import { ChatMemberEvents } from "../classes/ChatMember";
import SettingsModal from "./SettingsModal";

/**
 * Live tri-state engine status surfaced as the header dot (Task 5).
 * @typedef {"idle" | "busy" | "blocked"} EngineStatus
 */

/**
 * Computes the tri-state engine status.
 *
 * - 🟢 idle    : online + ready + no turn generation or SSE stream in flight.
 * - 🟡 busy    : a turn request is in flight or an SSE token stream is active.
 * - 🔴 blocked : offline, circuit breaker open, every Groq chat model is
 *                cooling down, or the engine is in consecutive-error backoff.
 *
 * @param {any} conv ConversationManager instance.
 * @param {boolean} isOffline Browser/app offline flag.
 * @returns {EngineStatus}
 */
export function computeEngineStatus(conv, isOffline) {
    if (isOffline === true) return "blocked";

    const client = conv?.client;
    const pool = client?.modelPool;

    const circuitOpen =
        (typeof client?.isCircuitOpen === "boolean" && client.isCircuitOpen) ||
        client?.circuitState === "open" ||
        client?.circuitState === "CIRCUIT_OPEN";

    const allModelsCooling =
        (typeof pool?.allModelsCooling === "function" && pool.allModelsCooling() === true) ||
        (typeof pool?.allModelsBlocked === "function" ? pool.allModelsBlocked() === true : false);

    const inErrorBackoff = typeof conv?.consecutiveErrors === "number" && conv.consecutiveErrors > 0;

    if (circuitOpen || allModelsCooling || inErrorBackoff) return "blocked";

    const turnInFlight = conv?.requesting === true || client?.isStreaming === true;
    if (turnInFlight) return "busy";

    return "idle";
}

/**
 * Accessible tooltip for each status state.
 * @param {EngineStatus} status
 * @returns {string}
 */
function statusLabel(status) {
    if (status === "busy") return "Engine busy — generating a response…";
    if (status === "blocked") return "Engine blocked — offline, rate-limited or cooling down";
    return "Engine idle — ready to chat";
}

/**
 * Top Navigation Header Bar.
 *
 * @param {Object} [props]
 * @param {string} [props.title="Tom & Friends"]
 * @returns {React.JSX.Element}
 */
export default function Header({ title = "Tom & Friends" } = {}) {
    const conv = useChat();
    const { chat } = conv;
    const { mode, setMode, setIsPlannerOpen } = useInputBox();
    const { isOffline } = useOffline();

    /** @type {[EngineStatus, React.Dispatch<React.SetStateAction<EngineStatus>>]} */
    const [engineStatus, setEngineStatus] = useState(/** @type {EngineStatus} */("idle"));

    /**
     * Poll engine health (cheap, synchronous field reads) so the dot reacts to
     * streaming starts/stops, cooldowns, circuit trips and offline flips.
     */
    useEffect(() => {
        const refresh = () => setEngineStatus(computeEngineStatus(conv, isOffline));
        refresh();
        const interval = setInterval(refresh, 500);
        return () => clearInterval(interval);
    }, [conv, isOffline]);

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [memberCount, setMemberCount] = useState(() => chat.getMembers().length);

    /** @type {[string[], React.Dispatch<React.SetStateAction<string[]>>]} */
    const [typingMembers, setTypingMembers] = useState(/** @type {string[]} */([]));

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    /** @type {React.RefObject<HTMLDivElement|null>} */
    const menuRef = useRef(null);

    useEffect(() => {
        const updateCount = () => setMemberCount(chat.getMembers().length);
        const offAdd = chat.events.on(ChatEvents.MEMBER_ADD, updateCount, "Header: count add");
        const offRemove = chat.events.on(ChatEvents.MEMBER_REMOVE, updateCount, "Header: count remove");

        return () => {
            offAdd();
            offRemove();
        };
    }, [chat]);

    useEffect(() => {
        /** @type {Map<string, Function>} */
        const unsubs = new Map();

        /** @param {import("../classes/ChatMember").default} member */
        const observeTyping = (member) => {
            if (!member.isAI) return;

            const updateList = () => {
                setTypingMembers(prev => {
                    const exists = prev.includes(member.name);
                    if (member.isTyping && !exists) return [...prev, member.name];
                    if (!member.isTyping && exists) return prev.filter(n => n !== member.name);
                    return prev;
                });
            };

            const unsub = member.events.on(ChatMemberEvents.TYPING, updateList, `Header: typing ${member.id}`);
            unsubs.set(member.id, unsub);
            if (member.isTyping) updateList();
        };

        for (const member of chat.getMembers()) {
            observeTyping(member);
        }

        const offAdd = chat.events.on(ChatEvents.MEMBER_ADD, observeTyping, "Header: observe add");
        const offRemove = chat.events.on(
            ChatEvents.MEMBER_REMOVE,
            /** @param {import("../classes/ChatMember").default} member */
            (member) => {
                const unsub = unsubs.get(member.id);
                if (unsub) {
                    unsub();
                    unsubs.delete(member.id);
                }
                setTypingMembers(prev => prev.filter(n => n !== member.name));
            },
            "Header: unobserve remove"
        );

        return () => {
            offAdd();
            offRemove();
            for (const unsub of unsubs.values()) unsub();
            unsubs.clear();
        };
    }, [chat]);

    useEffect(() => {
        if (!isMenuOpen) return;

        /** @param {MouseEvent} event */
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(/** @type {Node} */(event.target))) {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isMenuOpen]);

    /**
     * Executes teardown logout and returns cleanly to Studio Lobby.
     */
    const handleLogout = useCallback(() => {
        setIsMenuOpen(false);
        conv.logout();
    }, [conv]);

    let subtitleText = `${memberCount} In Room • Active`;
    let isTyping = false;

    if (typingMembers.length === 1) {
        subtitleText = `✍️ ${typingMembers[0]} is typing...`;
        isTyping = true;
    } else if (typingMembers.length > 1) {
        subtitleText = `✍️ ${typingMembers.join(" & ")} typing...`;
        isTyping = true;
    }

    return (
        <>
            <header className={`${styles.header} ${mode === "director" ? styles.headerDirector : ""}`}>
                {/* Left: Cast Info */}
                <div className={styles.leftSection}>
                    <img
                        src="/group.png"
                        alt="Group"
                        width={38}
                        height={38}
                        className={styles.avatar}
                    />
                    <div className={styles.titleColumn}>
                        <h3 className={styles.title}>{title}</h3>
                        <p className={isTyping ? styles.subtitleTyping : styles.subtitleIdle}>
                            <span
                                className={`${styles.statusDot} ${engineStatus === "blocked" ? styles.statusDotBlocked
                                        : engineStatus === "busy" ? styles.statusDotBusy
                                            : styles.statusDotIdle
                                    }`}
                                data-status={engineStatus}
                                role="status"
                                aria-label={statusLabel(engineStatus)}
                                title={statusLabel(engineStatus)}
                            />
                            {subtitleText}
                        </p>
                    </div>
                </div>

                {/* Right: 44px Menu Button */}
                <div className={styles.rightSection} ref={menuRef}>
                    <button
                        onClick={() => setIsMenuOpen(prev => !prev)}
                        className={styles.dotsButton}
                        aria-label="Open menu"
                    >
                        ⋮
                    </button>

                    {/* Consolidated 3-Dots Menu Dropdown */}
                    {isMenuOpen && (
                        <div className={styles.dropdownMenu}>
                            {/* 1. Mode Switcher */}
                            <div className={styles.modeSection}>
                                <span className={styles.modeSectionLabel}>INTERACTION MODE</span>
                                <div className={styles.modePill}>
                                    <button
                                        onClick={() => {
                                            setMode("user");
                                            setIsMenuOpen(false);
                                        }}
                                        className={mode === "user" ? styles.modeBtnActiveUser : styles.modeBtnInactive}
                                    >
                                        👤 User
                                    </button>
                                    <button
                                        onClick={() => {
                                            setMode("director");
                                            setIsMenuOpen(false);
                                        }}
                                        className={mode === "director" ? styles.modeBtnActiveDirector : styles.modeBtnInactive}
                                    >
                                        🎬 Director
                                    </button>
                                </div>
                            </div>

                            <div className={styles.menuDivider} />

                            {/* 2. Storyline Scheduler */}
                            <button
                                onClick={() => {
                                    setIsMenuOpen(false);
                                    setIsPlannerOpen(true);
                                }}
                                className={styles.menuItem}
                            >
                                <span>📅 Storyline Scheduler</span>
                                <span className={styles.menuTag}>Goals</span>
                            </button>

                            {/* 3. Settings Hub */}
                            <button
                                onClick={() => {
                                    setIsMenuOpen(false);
                                    setIsSettingsOpen(true);
                                }}
                                className={styles.menuItem}
                            >
                                <span>⚙️ Settings & Mixer</span>
                                <span className={styles.menuTag}>Config</span>
                            </button>

                            {/* Replay 3D Tour */}
                            <button
                                onClick={() => {
                                    setIsMenuOpen(false);
                                    window.dispatchEvent(new CustomEvent("tgf:open-presentation"));
                                }}
                                className={styles.menuItem}
                            >
                                <span>✨ 3D Pitch Tour</span>
                                <span className={styles.menuTag}>Demo</span>
                            </button>

                            <div className={styles.menuDivider} />

                            {/* 4. Log Out (Exit Studio & Return to Lobby) */}
                            <button
                                onClick={handleLogout}
                                className={styles.menuItemLogout}
                            >
                                <span>🚪 Log Out (Exit Studio)</span>
                                <span className={styles.menuTagLogout}>Lobby</span>
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Always-Mounted Settings Modal */}
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </>
    );
}