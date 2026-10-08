// @ts-check

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import Logger from "../classes/lib/Logger";
import PromptLogger from "../classes/lib/PromptLogger";
import MemoryExpiryParser from "../classes/lib/MemoryExpiryParser";
import { useChat } from "./ChatContext";
import { probeGroqModel, probeGeminiModel } from "../util/apiKeys";

/** @typedef {import("../classes/lib/Logger").LogEntry} LogEntry */
/** @typedef {import("../classes/lib/PromptLogger").PromptLogEntry} PromptLogEntry */
/** @typedef {import("../classes/lib/PromptLogger").PromptType} PromptType */
/** @typedef {import("../classes/ConversationManager").default} ConversationManager */
/** @typedef {import("../classes/types/World.types").ScheduleRecord} ScheduleRecord */
/** @typedef {import("../classes/types/World.types").CharacterGoalRecord} CharacterGoalRecord */
/** @typedef {import("../classes/types/World.types").EnvironmentSnapshot} EnvironmentSnapshot */
/** @typedef {import("../util/apiKeys").ModelVerifyResult} ModelVerifyResult */
/** @typedef {"debug" | "info" | "warn" | "error" | "state" | "prompts"} DevToolsTab */
/** @typedef {"healthy" | "cooling" | "ejected"} ModelHealthStatus */

/**
 * @typedef {Object} ModelPoolEntry
 * @property {string} id Canonical model id.
 * @property {string} displayName Human-readable label.
 * @property {number} tier Priority tier.
 * @property {number} version Parsed version.
 * @property {ModelHealthStatus} status healthy / cooling / ejected.
 * @property {number|null} cooldownRemainingMs Remaining cooldown (cooling only).
 * @property {boolean} isActive Member of the live active stack.
 */

/**
 * @typedef {Object} ModelPoolState
 * @property {string|null} activeModel Currently active model id (null before discovery).
 * @property {ModelPoolEntry[]} models Per-model health snapshot.
 */

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
 * @property {ModelPoolState} groqModelPool Snapshot of conv.client.modelPool.
 * @property {ModelPoolState} geminiModelPool Snapshot of conv.world.worldSetter.modelPool.
 * @property {DevToolsSituationEngineState} situationEngine Tier-2 situation distiller snapshot.
 * @property {DevToolsNeedleRouterState} needleRouter Tier-3 Needle query router snapshot.
 */

/**
 * @typedef {Object} DevToolsSituationEngineState
 * @property {string} situationText Current 500-char ambient paragraph.
 * @property {number} unreadCount Messages accumulated toward the distillation trigger.
 * @property {string} lastRunTime Formatted time of the last distillation pass.
 * @property {boolean} isProcessing Whether a pass is in flight.
 */

/**
 * @typedef {Object} DevToolsNeedleRouterState
 * @property {boolean} isReady Wasm worker availability.
 * @property {string} lastRoute Last keyword/member route extracted from a human utterance.
 * @property {string} lastMemorySnippet Most recent UnifiedMemory lines injected into the prompt.
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
 * @property {(provider: "groq" | "gemini", modelId: string) => Promise<ModelVerifyResult>} verifyModel Sends a 1-token probe to one specific model and reports health back into its pool.
 */

const STORAGE_DEVTOOLS_ENABLED_KEY = "tgf:devtools:enabled";

/**
 * Formats a UnifiedMemory TTL directive ("forever", "1h", ISO…) into a label.
 * @param {string|Date|null|-1} expiry
 * @returns {string}
 */
function formatMemoryExpiry(expiry) {
    // UnifiedMemory entries store TTL directives ("forever", "1h", ISO...).
    if (!expiry || expiry === "forever" || expiry === "-1") return "Permanent";

    const parsed = MemoryExpiryParser.parse(expiry);
    if (!(parsed instanceof Date)) return "Permanent";

    const msLeft = parsed.getTime() - Date.now();
    if (msLeft <= 0) return "Expired";
    const minsLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
    return minsLeft > 60 ? `${Math.round(minsLeft / 60)}h left` : `${minsLeft}m left`;
}

/**
 * Reads a full per-model health snapshot from either pool, tolerating reduced
 * test harnesses that mount DevTools without an engine.
 *
 * @param {any} pool GroqModelPool | GeminiModelPool | null | undefined
 * @returns {ModelPoolEntry[]}
 */
function extractModelPool(pool) {
    if (!pool || typeof pool.listModels !== "function") return [];
    try {
        const list = pool.listModels();
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
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
            // Reference-based query: UnifiedMemory entries tagged with this member id.
            /** @type {Array<{key: string, value: string, expiry: string}>} */
            const memberMemories = (conv.unifiedMemory?.getEntriesForMember(m.id) || []).map((entry) => ({
                key: entry.tags.filter((t) => t !== String(m.id).toLowerCase()).join(", ") || "memory",
                value: entry.data,
                expiry: formatMemoryExpiry(entry.expiry)
            }));

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
                memories: memberMemories
            };
        }),
        chatEngine: {
            totalMessages: chat?.getMessages ? chat.getMessages().length : 0,
            membersCount: chat?.getMembers ? chat.getMembers().length : 0,
            pendingQueuesCount: membersList.reduce((acc, m) => {
                const timeline = m?.scheduler?.getTimeline ? m.scheduler.getTimeline() : [];
                return acc + (Array.isArray(timeline) ? timeline.length : 0);
            }, 0),
            activeModel: conv.client?.activeModel || conv.client?.defaultModel || ""
        },
        groqModelPool: {
            activeModel: conv.client?.activeModel || null,
            models: extractModelPool(conv.client?.modelPool)
        },
        geminiModelPool: {
            activeModel: conv.world?.worldSetter?.modelPool?.getActiveModelSync?.() || null,
            models: extractModelPool(conv.world?.worldSetter?.modelPool)
        },
        situationEngine: {
            situationText: conv.situationEngine?.situationText || "Not loaded",
            unreadCount: conv.situationEngine?.unreadMessagesCount || 0,
            lastRunTime: conv.situationEngine?.lastRunTime
                ? new Date(conv.situationEngine.lastRunTime).toLocaleTimeString("en-GB", { hour12: false })
                : "Never",
            isProcessing: Boolean(conv.situationEngine?.isProcessing)
        },
        needleRouter: {
            isReady: Boolean(conv.needleRouter?.isReady),
            lastRoute: conv.lastNeedleRoute || "None",
            lastMemorySnippet: conv.lastRetrievedMemory || "None"
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
            stabilizer: [],
            situation: []
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

    /**
     * Verifies ONE model with a minimal 1-token probe, measures latency and
     * reports the outcome back into the owning pool.
     *
     * @returns {Promise<ModelVerifyResult>}
     */
    const verifyModel = useCallback(async (
        /** @type {"groq" | "gemini"} */ provider,
        /** @type {string} */ modelId
    ) => {
        if (provider === "gemini") {
            const pool = conv?.world?.worldSetter?.modelPool ?? null;
            return probeGeminiModel(modelId, pool);
        }

        const pool = conv?.client?.modelPool ?? null;
        return probeGroqModel(modelId, pool);
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
        getSystemState,
        verifyModel
    }), [
        isDevToolsEnabled,
        isDevToolsOpen,
        activeTab,
        logs,
        promptLogs,
        setIsDevToolsEnabled,
        clearLogs,
        clearPromptLogs,
        getSystemState,
        verifyModel
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