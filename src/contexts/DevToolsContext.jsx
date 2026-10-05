// @ts-check

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import Logger from "../classes/lib/Logger";
import PromptLogger from "../classes/lib/PromptLogger";
import { useChat } from "./ChatContext";

/** @typedef {import("../classes/lib/Logger").LogEntry} LogEntry */
/** @typedef {import("../classes/lib/PromptLogger").PromptLogEntry} PromptLogEntry */
/** @typedef {import("../classes/lib/PromptLogger").PromptType} PromptType */
/** @typedef {import("../classes/ConversationManager").default} ConversationManager */
/** @typedef {import("../classes/types/World.types").ScheduleRecord} ScheduleRecord */
/** @typedef {import("../classes/types/World.types").CharacterGoalRecord} CharacterGoalRecord */
/** @typedef {import("../classes/types/World.types").EnvironmentSnapshot} EnvironmentSnapshot */
/** @typedef {"debug" | "info" | "warn" | "error" | "state" | "prompts"} DevToolsTab */

/**
 * @typedef {Object} DevToolsActiveScheduleState
 * @property {string} id
 * @property {string} timeRange
 * @property {string} topic
 * @property {string} mainGoal
 * @property {CharacterGoalRecord[]} characterGoals
 * @property {string[]} facts
 * @property {string} prePlot
 * @property {string} postPlot
 */

/**
 * @typedef {Object} DevToolsSystemState
 * @property {string} timestamp Current ISO timestamp.
 * @property {string} timeWindow Current simulation clock window.
 * @property {DevToolsActiveScheduleState|null} activeSchedule Active schedule block metrics.
 * @property {EnvironmentSnapshot|null} environment Real-world environment snapshot.
 * @property {Array<{
 *   id: string,
 *   name: string,
 *   age: number,
 *   isAI: boolean,
 *   currentEmotion: string,
 *   activity: { isTyping: boolean, isReading: boolean, isThinking: boolean, isActive: boolean },
 *   memories: Array<{ key: string, value: string, expiry: string }>
 * }>} characters Detailed participant cognitive states.
 * @property {{
 *   totalMessages: number,
 *   membersCount: number,
 *   pendingQueuesCount: number,
 *   activeModel: string
 * }} chatEngine Engine metrics.
 */

/**
 * @typedef {Object} DevToolsContextValue
 * @property {boolean} isDevToolsEnabled Whether DevTools ribbon & panel are activated.
 * @property {(enabled: boolean) => void} setIsDevToolsEnabled Setter to toggle DevTools activation.
 * @property {boolean} isDevToolsOpen Whether the bottom DevTools drawer is expanded.
 * @property {(open: boolean) => void} setIsDevToolsOpen Setter for drawer expansion.
 * @property {DevToolsTab} activeTab Currently selected inspection tab.
 * @property {(tab: DevToolsTab) => void} setActiveTab Setter for active tab.
 * @property {LogEntry[]} logs Filtered or complete collection of buffered log entries.
 * @property {() => void} clearLogs Clears all buffered logs.
 * @property {Record<PromptType, PromptLogEntry[]>} promptLogs Grouped prompt execution and thinking traces.
 * @property {() => void} clearPromptLogs Clears all buffered prompt logs.
 * @property {() => DevToolsSystemState | { status: string }} getSystemState Generates structured dashboard cards payload.
 */

const STORAGE_DEVTOOLS_ENABLED_KEY = "tgf:devtools:enabled";

/**
 * Formats memory expiry time safely into a readable label.
 * @param {Date | unknown} expiry
 * @returns {string}
 */
function formatMemoryExpiry(expiry) {
    if (expiry instanceof Date) {
        const msLeft = expiry.getTime() - Date.now();
        if (msLeft <= 0) return "Expired";
        const minsLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
        return minsLeft > 60 ? `${Math.round(minsLeft / 60)}h left` : `${minsLeft}m left`;
    }
    return "Permanent";
}

/**
 * Pure extractor converting engine memory and schedule into a structured diagnostic state.
 * @param {ConversationManager|null} conv
 * @returns {DevToolsSystemState | { status: string }}
 */
function extractSystemState(conv) {
    if (!conv || !conv.world) {
        return { status: "World is not initialized." };
    }

    const { world, chat } = conv;
    const schedule = world.activeSchedule;
    const env = world.environment;
    const membersList = world.members ? Array.from(world.members.values()) : [];

    return {
        timestamp: new Date().toISOString(),
        timeWindow: `${world.date || "Unknown Date"}, ${world.time || "Unknown Time"}`,
        activeSchedule: schedule ? {
            id: schedule.id || "",
            timeRange: schedule.timeRange || "",
            topic: schedule.topic || "",
            mainGoal: schedule.mainGoal || "",
            characterGoals: schedule.characterGoals || [],
            facts: schedule.facts || [],
            prePlot: schedule.prePlot || "",
            postPlot: schedule.postPlot || ""
        } : null,
        environment: env || null,
        characters: membersList.map((m) => {
            // Safely iterate memories (m.memory may be a Map or custom container)
            /** @type {Array<{key: string, value: string, expiry: string}>} */
            let usableMemories = [];
            if (m?.memory?.values) {
                const memEntries = Array.from(m.memory.values());
                usableMemories = memEntries
                    .filter((k) => typeof k?.isUsable === "function" ? k.isUsable() : true)
                    .map((k) => ({
                        key: String(k?.name || "unnamed"),
                        value: Array.isArray(k?.value) ? k.value.join(", ") : String(k?.value ?? ""),
                        expiry: formatMemoryExpiry(k?.expiry)
                    }));
            }

            return {
                id: m.id,
                name: m.name || "Unknown",
                age: m.age || 0,
                isAI: Boolean(m.isAI),
                currentEmotion: m.currentEmotion?.name || "Default",
                activity: {
                    isTyping: Boolean(m.isTyping),
                    isReading: Boolean(m.isReading),
                    isThinking: Boolean(m.isThinking),
                    isActive: Boolean(m.isActive)
                },
                memories: usableMemories
            };
        }),
        chatEngine: {
            totalMessages: chat?.getMessages ? chat.getMessages().length : 0,
            membersCount: chat?.getMembers ? chat.getMembers().length : 0,
            pendingQueuesCount: membersList.reduce((acc, m) => {
                const timeline = m?.scheduler?.getTimeline ? m.scheduler.getTimeline() : [];
                return acc + (Array.isArray(timeline) ? timeline.length : 0);
            }, 0),
            activeModel: conv.client?.defaultModel || "openai/gpt-oss-120b"
        }
    };
}

/** @type {React.Context<DevToolsContextValue|null>} */
const DevToolsContext = createContext(/** @type {DevToolsContextValue|null} */ (null));

/**
 * Context Provider managing real-time system logs, prompt traces with thinking chains,
 * and structured state inspection across AI clients.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @returns {React.JSX.Element}
 */
export function DevToolsProvider({ children }) {
    const conv = useChat();

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isDevToolsEnabled, setIsDevToolsEnabledState] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_DEVTOOLS_ENABLED_KEY) === "true";
        } catch {
            return false;
        }
    });

    const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState(/** @type {DevToolsTab} */ ("info"));
    const [logs, setLogs] = useState(() => Logger.getRecentLogs());
    const [promptLogs, setPromptLogs] = useState(() => PromptLogger.getAllLogs());

    /** @type {React.MutableRefObject<LogEntry[]>} */
    const pendingLogsBuffer = useRef([]);
    /** @type {React.MutableRefObject<ReturnType<typeof setTimeout>|null>} */
    const throttleTimer = useRef(null);

    const setIsDevToolsEnabled = useCallback((/** @type {boolean} */ enabled) => {
        setIsDevToolsEnabledState(enabled);
        try {
            localStorage.setItem(STORAGE_DEVTOOLS_ENABLED_KEY, String(enabled));
        } catch {}
    }, []);

    const clearLogs = useCallback(() => {
        Logger.clearBuffer();
        setLogs([]);
    }, []);

    const clearPromptLogs = useCallback(() => {
        PromptLogger.clear();
        setPromptLogs({
            dialogue: [],
            scheduler: [],
            demand: [],
            stabilizer: []
        });
    }, []);

    // Throttled Log Stream Consumer (150ms buffer flush prevents render jank)
    useEffect(() => {
        if (!isDevToolsEnabled) {
            pendingLogsBuffer.current = [];
            return;
        }

        /** @param {LogEntry} entry */
        const handleNewLog = (entry) => {
            pendingLogsBuffer.current.push(entry);

            if (!throttleTimer.current) {
                throttleTimer.current = setTimeout(() => {
                    throttleTimer.current = null;
                    const flushed = [...pendingLogsBuffer.current];
                    pendingLogsBuffer.current = [];

                    setLogs((prev) => {
                        const next = [...prev, ...flushed];
                        return next.slice(-Logger.MAX_LOGS);
                    });
                }, 150);
            }
        };

        const offLog = Logger.onLog(handleNewLog);
        return () => {
            offLog();
            if (throttleTimer.current) {
                clearTimeout(throttleTimer.current);
                throttleTimer.current = null;
            }
        };
    }, [isDevToolsEnabled]);

    // Live Prompt & Thinking Chain Logger Subscription
    useEffect(() => {
        if (!isDevToolsEnabled) return;

        const offPromptLog = PromptLogger.onLog(() => {
            setPromptLogs(PromptLogger.getAllLogs());
        });

        return () => {
            offPromptLog();
        };
    }, [isDevToolsEnabled]);

    const getSystemState = useCallback(() => {
        return extractSystemState(conv);
    }, [conv]);

    /** @type {DevToolsContextValue} */
    const value = useMemo(() => ({
        isDevToolsEnabled,
        setIsDevToolsEnabled,
        isDevToolsOpen,
        setIsDevToolsOpen,
        activeTab,
        setActiveTab,
        logs,
        clearLogs,
        promptLogs,
        clearPromptLogs,
        getSystemState
    }), [
        isDevToolsEnabled,
        isDevToolsOpen,
        activeTab,
        logs,
        promptLogs,
        setIsDevToolsEnabled,
        clearLogs,
        clearPromptLogs,
        getSystemState
    ]);

    return (
        <DevToolsContext.Provider value={value}>
            {children}
        </DevToolsContext.Provider>
    );
}

/**
 * Hook to consume active DevTools context safely.
 * @returns {DevToolsContextValue}
 */
export function useDevTools() {
    const context = useContext(DevToolsContext);
    if (!context) {
        throw new Error("useDevTools must be used within DevToolsProvider.");
    }
    return context;
}