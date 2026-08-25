// @ts-check

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./Chat.module.css";
import { Footer } from "./footer";
import Header from "./Header";
import SceneBar from "./SceneBar";
import DevToolsBar from "./DevToolsBar";
import DevToolsDrawer from "./DevToolsDrawer";
import PlannerDrawer from "./PlannerDrawer";
import BackgroundBar from "./BackgroundBar";
import { MessageUX, TypingMessageUX } from "./message";
import { InputBoxContextProvider } from "../contexts/InputBoxContext";
import { useChat } from "../contexts/ChatContext";
import { useTheme } from "../contexts/ThemeContext";
import { ChatEvents } from "../classes/Chat";
import { ChatMemberEvents } from "../classes/ChatMember";
import { WorldEvents } from "../classes/World";

const THRESHOLD_VIRTUALIZE = 70;
const CHUNK_SIZE = 25;
const MAX_VISIBLE_MESSAGES = 55;
const DEFAULT_ESTIMATED_HEIGHT = 68;

/**
 * @param {import("../classes/Message").default} msg
 * @returns {number}
 */
function estimateMessageHeight(msg) {
    if (!msg) return DEFAULT_ESTIMATED_HEIGHT;
    if (!msg.sender) return 52;
    const textLength = msg.text ? msg.text.length : 0;
    const lines = Math.ceil(textLength / 34);
    const replyPadding = msg.reply ? 34 : 0;
    return Math.max(DEFAULT_ESTIMATED_HEIGHT, 42 + (lines * 18) + replyPadding);
}

/**
 * Main Chat Container Screen.
 *
 * @returns {React.JSX.Element}
 */
export default function ChatUX() {
    const conv = useChat();
    const { world } = conv;
    const { isDark } = useTheme();

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [currentHour, setCurrentHour] = useState(() => new Date().getHours());

    useEffect(() => {
        if (!world) return;
        const offHour = world.events.on(
            WorldEvents.HOUR_CHANGE,
            /** @param {number} hour */
            (hour) => setCurrentHour(hour),
            "ChatUX: hour change"
        );
        return () => offHour();
    }, [world]);

    const backdropGradient = useMemo(() => {
        return getBackdropGradient(isDark, currentHour);
    }, [isDark, currentHour]);

    return (
        <div
            className={styles.chatShell}
            style={/** @type {React.CSSProperties} */ ({ "--backdrop-gradient": backdropGradient })}
        >
            <InputBoxContextProvider>
                <Header title="Tom & Friends" />
                <SceneBar />
                <DevToolsBar />
                <BackgroundBar />
                <ZeroClsVirtualMessageList />
                <Footer />
                <PlannerDrawer />
                <DevToolsDrawer />
            </InputBoxContextProvider>
        </div>
    );
}

/**
 * Zero-CLS Virtual Message List with Top-Spacer Delta Anchoring.
 */
const ZeroClsVirtualMessageList = React.memo(function ZeroClsVirtualMessageList() {
    const conv = useChat();
    const chat = conv.chat;
    const user = conv.User;

    /** @type {[import("../classes/Message").default[], React.Dispatch<React.SetStateAction<import("../classes/Message").default[]>>]} */
    const [allMessages, setAllMessages] = useState(() => [...chat.getMessages()]);

    /** @type {[Map<string, import("../classes/ChatMember").default>, React.Dispatch<React.SetStateAction<Map<string, import("../classes/ChatMember").default>>>]} */
    const [typingMembers, setTypingMembers] = useState(/** @type {Map<string, import("../classes/ChatMember").default>} */ (new Map()));

    /** @type {[{ start: number, end: number }, React.Dispatch<React.SetStateAction<{ start: number, end: number }>>]} */
    const [windowRange, setWindowRange] = useState(() => {
        const total = chat.getMessages().length;
        const start = total > THRESHOLD_VIRTUALIZE ? Math.max(0, total - MAX_VISIBLE_MESSAGES) : 0;
        return { start, end: total };
    });

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [unreadCount, setUnreadCount] = useState(0);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

    /** @type {React.RefObject<HTMLDivElement|null>} */
    const containerRef = useRef(null);

    /** @type {React.MutableRefObject<Map<string, number>>} */
    const heightLedger = useRef(new Map());

    /** @type {React.MutableRefObject<boolean>} */
    const isUserScrolledUp = useRef(false);

    /** @type {React.MutableRefObject<boolean>} */
    const isInitialMounted = useRef(false);

    /** 
     * Snapshot storing previous scroll coordinates and top spacer height before window shifts.
     * @type {React.MutableRefObject<{ previousScrollTop: number, previousTopSpacer: number } | null>} 
     */
    const scrollAnchorSnapshot = useRef(null);

    // 1. Synchronize Room Messages
    useEffect(() => {
        /** @param {import("../classes/Message").default} [newMsg] */
        const handleMessageAdd = (newMsg) => {
            const updated = [...chat.getMessages()];
            setAllMessages(updated);

            if (isUserScrolledUp.current) {
                if (newMsg && newMsg.sender && newMsg.sender.id !== user.id) {
                    setUnreadCount(prev => prev + 1);
                }
            } else {
                setWindowRange(prev => {
                    const nextEnd = updated.length;
                    const nextStart = (updated.length > THRESHOLD_VIRTUALIZE && (nextEnd - prev.start > MAX_VISIBLE_MESSAGES))
                        ? nextEnd - MAX_VISIBLE_MESSAGES
                        : (updated.length <= THRESHOLD_VIRTUALIZE ? 0 : prev.start);
                    return { start: nextStart, end: nextEnd };
                });
            }
        };

        const handleGeneralUpdate = () => {
            const updated = [...chat.getMessages()];
            setAllMessages(updated);
            setWindowRange({
                start: updated.length > THRESHOLD_VIRTUALIZE ? Math.max(0, updated.length - MAX_VISIBLE_MESSAGES) : 0,
                end: updated.length
            });
        };

        const offAdd = chat.events.on(ChatEvents.MESSAGE_ADD, handleMessageAdd, "Chat: msg add");
        const offRemove = chat.events.on(ChatEvents.MESSAGE_REMOVE, handleGeneralUpdate, "Chat: msg remove");
        const offUpdate = chat.events.on(ChatEvents.MESSAGE_UPDATE, handleGeneralUpdate, "Chat: msg update");
        const offClear = chat.events.on(ChatEvents.CLEAR, handleGeneralUpdate, "Chat: clear");

        return () => {
            offAdd();
            offRemove();
            offUpdate();
            offClear();
        };
    }, [chat, user]);

    // 2. Track AI Character Typing
    useEffect(() => {
        /** @type {Map<string, Function>} */
        const unsubs = new Map();

        /** @param {import("../classes/ChatMember").default} member */
        const observeTyping = (member) => {
            if (!member.isAI) return;

            const update = () => {
                setTypingMembers(prev => {
                    const has = prev.has(member.id);
                    if (member.isTyping && !has) {
                        const next = new Map(prev);
                        next.set(member.id, member);
                        return next;
                    }
                    if (!member.isTyping && has) {
                        const next = new Map(prev);
                        next.delete(member.id);
                        return next;
                    }
                    return prev;
                });
            };

            const unsub = member.events.on(ChatMemberEvents.TYPING, update, `Chat: typing for ${member.id}`);
            unsubs.set(member.id, unsub);
            if (member.isTyping) update();
        };

        for (const member of chat.getMembers()) observeTyping(member);

        const offAdd = chat.events.on(ChatEvents.MEMBER_ADD, observeTyping, "Chat: add member");
        const offRemove = chat.events.on(
            ChatEvents.MEMBER_REMOVE,
            /**@param {ChatMember} member */
            (member) => {
                const unsub = unsubs.get(member.id);
                if (unsub) {
                    unsub();
                    unsubs.delete(member.id);
                }
                setTypingMembers(prev => {
                    if (!prev.has(member.id)) return prev;
                    const next = new Map(prev);
                    next.delete(member.id);
                    return next;
                });
            },
            "Chat: remove member"
        );

        return () => {
            offAdd();
            offRemove();
            for (const unsub of unsubs.values()) unsub();
            unsubs.clear();
        };
    }, [chat]);

    // 3. Dynamic Spacer Calculations
    const topSpacerHeight = useMemo(() => {
        if (windowRange.start <= 0 || allMessages.length <= THRESHOLD_VIRTUALIZE) return 0;
        let sum = 0;
        for (let i = 0; i < windowRange.start; i++) {
            const msg = allMessages[i];
            if (!msg) continue;
            sum += heightLedger.current.get(msg.id) || estimateMessageHeight(msg);
        }
        return sum;
    }, [allMessages, windowRange.start]);

    const bottomSpacerHeight = useMemo(() => {
        if (windowRange.end >= allMessages.length || allMessages.length <= THRESHOLD_VIRTUALIZE) return 0;
        let sum = 0;
        for (let i = windowRange.end; i < allMessages.length; i++) {
            const msg = allMessages[i];
            if (!msg) continue;
            sum += heightLedger.current.get(msg.id) || estimateMessageHeight(msg);
        }
        return sum;
    }, [allMessages, windowRange.end]);

    // 4. Scroll Threshold Handler
    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el || !isInitialMounted.current) return;

        const { scrollTop, scrollHeight, clientHeight } = el;

        // Accurate bottom detection: Only true if within 35px of absolute bottom
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const scrolledUp = distanceFromBottom > 35;
        isUserScrolledUp.current = scrolledUp;
        setShowScrollBottomBtn(distanceFromBottom > 160);

        if (!scrolledUp) {
            setUnreadCount(0);
        }

        if (allMessages.length <= THRESHOLD_VIRTUALIZE) return;

        // UPWARD THRESHOLD: Approaching the top rendered slice
        const distanceToTopSlice = scrollTop - topSpacerHeight;
        if (distanceToTopSlice < 250 && windowRange.start > 0) {
            const nextStart = Math.max(0, windowRange.start - CHUNK_SIZE);
            let nextEnd = windowRange.end;

            if (nextEnd - nextStart > MAX_VISIBLE_MESSAGES) {
                nextEnd = nextStart + MAX_VISIBLE_MESSAGES;
            }

            scrollAnchorSnapshot.current = {
                previousScrollTop: scrollTop,
                previousTopSpacer: topSpacerHeight
            };

            setWindowRange({ start: nextStart, end: nextEnd });
            return;
        }

        // DOWNWARD THRESHOLD: Approaching the bottom rendered slice
        const distanceToBottomSlice = (scrollHeight - bottomSpacerHeight) - (scrollTop + clientHeight);
        if (distanceToBottomSlice < 250 && windowRange.end < allMessages.length) {
            const nextEnd = Math.min(allMessages.length, windowRange.end + CHUNK_SIZE);
            let nextStart = windowRange.start;

            if (nextEnd - nextStart > MAX_VISIBLE_MESSAGES) {
                nextStart = nextEnd - MAX_VISIBLE_MESSAGES;
            }

            scrollAnchorSnapshot.current = {
                previousScrollTop: scrollTop,
                previousTopSpacer: topSpacerHeight
            };

            setWindowRange({ start: nextStart, end: nextEnd });
        }
    }, [windowRange, allMessages.length, topSpacerHeight, bottomSpacerHeight]);

    // 5. Mathematical Zero-Shift Anchor (Top-Spacer Delta Correction)
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        // CRITICAL FIX: When window changes, adjust scrollTop strictly by the change in topSpacerHeight.
        // This guarantees that the items in front of your eyes never shift by even 1px!
        if (scrollAnchorSnapshot.current) {
            const topSpacerDelta = topSpacerHeight - scrollAnchorSnapshot.current.previousTopSpacer;
            el.scrollTop = scrollAnchorSnapshot.current.previousScrollTop + topSpacerDelta;
            scrollAnchorSnapshot.current = null;
            return;
        }

        // Initial Mount: Pin to bottom before first browser paint
        if (!isInitialMounted.current && el.scrollHeight > 0) {
            el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
            isInitialMounted.current = true;
            return;
        }

        // Auto-scroll when new live messages arrive ONLY if already at bottom
        if (!isUserScrolledUp.current) {
            el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        }
    }, [windowRange, allMessages.length, typingMembers.size, topSpacerHeight]);

    // 6. Deterministic Bottom Scroll Click
    const handleScrollToBottomClick = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;

        setWindowRange({
            start: allMessages.length > THRESHOLD_VIRTUALIZE ? Math.max(0, allMessages.length - MAX_VISIBLE_MESSAGES) : 0,
            end: allMessages.length
        });

        setUnreadCount(0);
        isUserScrolledUp.current = false;
        setShowScrollBottomBtn(false);

        requestAnimationFrame(() => {
            const container = containerRef.current;
            if (!container) return;
            const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
            container.scrollTo({ top: maxScrollTop, behavior: "smooth" });
        });
    }, [allMessages.length]);

    const recordItemHeight = useCallback((/** @type {string} */ id, /** @type {number} */ height) => {
        if (height > 0) {
            heightLedger.current.set(id, height);
        }
    }, []);

    const visibleMessages = useMemo(() => {
        const rawSlice = allMessages.slice(windowRange.start, windowRange.end);
        const seen = new Set();
        return rawSlice.filter((msg) => {
            if (!msg?.id || seen.has(msg.id)) return false;
            seen.add(msg.id);
            return true;
        });
    }, [allMessages, windowRange]);

    if (allMessages.length === 0 && typingMembers.size === 0) {
        return <EmptyChat />;
    }

    return (
        <main className={styles.messageListContainer}>
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className={styles.listCanvas}
            >
                {/* Top Spacer: Reserves exact px space for unmounted history */}
                {topSpacerHeight > 0 && (
                    <div
                        style={{ height: `${topSpacerHeight}px` }}
                        className={styles.virtualSpacer}
                        aria-hidden="true"
                    />
                )}

                {/* Visible Rendered Messages */}
                {visibleMessages.map((message) => (
                    <MeasuredMessageItem
                        key={message.id}
                        message={message}
                        user={user}
                        onMeasure={recordItemHeight}
                    />
                ))}

                {/* Live Animated Typing Dots */}
                {[...typingMembers.values()].map((member) => (
                    <div key={`typing-${member.id}`} className={styles.messageWrapper}>
                        <TypingMessageUX member={member} />
                    </div>
                ))}

                {/* Bottom Spacer */}
                {bottomSpacerHeight > 0 && (
                    <div
                        style={{ height: `${bottomSpacerHeight}px` }}
                        className={styles.virtualSpacer}
                        aria-hidden="true"
                    />
                )}
            </div>

            {/* Scroll-to-Bottom Floating Button */}
            {showScrollBottomBtn && (
                <button
                    onClick={handleScrollToBottomClick}
                    className={styles.scrollToBottomBtn}
                    aria-label="Scroll to bottom"
                >
                    <span className={styles.arrowIcon}>↓</span>
                    {unreadCount > 0 && (
                        <span className={styles.unreadBadge}>{unreadCount}</span>
                    )}
                </button>
            )}
        </main>
    );
});

/**
 * @param {Object} props
 * @param {import("../classes/Message").default} props.message
 * @param {import("../classes/ChatMember").default} props.user
 * @param {(id: string, height: number) => void} props.onMeasure
 * @returns {React.JSX.Element}
 */
function MeasuredMessageItem({ message, user, onMeasure }) {
    /** @type {React.RefObject<HTMLDivElement|null>} */
    const itemRef = useRef(null);

    useLayoutEffect(() => {
        if (itemRef.current) {
            onMeasure(message.id, itemRef.current.offsetHeight);
        }
    }, [message.id, message.text, onMeasure]);

    return (
        <div ref={itemRef} className={styles.messageWrapper}>
            <MessageUX message={message} user={user} />
        </div>
    );
}

/**
 * @returns {React.JSX.Element}
 */
function EmptyChat() {
    return (
        <div className={styles.emptyChat}>
            <div className={styles.emptyIcon}>🌟</div>
            <h3 className={styles.emptyTitle}>Welcome to Tom & Friends!</h3>
            <p className={styles.emptySubtitle}>
                Say hello in User Mode or switch to Director Mode to inject your first plot twist!
            </p>
        </div>
    );
}

/**
 * @param {boolean} isDark
 * @param {number} hour
 * @returns {string}
 */
function getBackdropGradient(isDark, hour) {
    if (isDark) {
        if (hour >= 20 || hour < 6) return "linear-gradient(180deg, #090d16 0%, #0f172a 100%)";
        if (hour >= 6 && hour < 12) return "linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)";
        if (hour >= 12 && hour < 17) return "linear-gradient(180deg, #0f2347 0%, #0f172a 100%)";
        return "linear-gradient(180deg, #31133f 0%, #0f172a 100%)";
    }

    if (hour >= 20 || hour < 6) return "linear-gradient(180deg, #e2e8f0 0%, #f3f4f6 100%)";
    if (hour >= 6 && hour < 12) return "linear-gradient(180deg, #fef3c7 0%, #f3f4f6 100%)";
    if (hour >= 12 && hour < 17) return "linear-gradient(180deg, #e0f2fe 0%, #f3f4f6 100%)";
    return "linear-gradient(180deg, #fae8ff 0%, #f3f4f6 100%)";
}