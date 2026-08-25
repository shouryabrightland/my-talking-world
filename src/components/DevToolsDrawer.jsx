// @ts-check

/**
 * @file DevToolsDrawer.jsx
 * Bottom-sheet drawer panel for DevTools inspection.
 *
 * Responsibilities:
 * - Renders as an overlay bottom-sheet with tab navigation.
 * - Hosts DevToolsStateTab, DevToolsLogsTab, DevToolsPromptsTab.
 * - Refreshes live system state on relevant world events via EventManager.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./DevToolsDrawer.module.css";
import { useDevTools } from "../contexts/DevToolsContext";
import { useChat } from "../contexts/ChatContext";
import { WorldEvents } from "../classes/World";
import DevToolsStateTab from "./devtools/DevToolsStateTab";
import DevToolsLogsTab from "./devtools/DevToolsLogsTab";
import DevToolsPromptsTab from "./devtools/DevToolsPromptsTab";

/**
 * Tab definition for the drawer header.
 * @typedef {Object} TabDef
 * @property {string} id Tab identifier.
 * @property {string} label Display label.
 * @property {string} icon Emoji icon.
 */

/** @type {TabDef[]} */
const TABS = [
    { id: "state", label: "State", icon: "🧩" },
    { id: "info", label: "Logs", icon: "📋" },
    { id: "prompts", label: "Prompts", icon: "🤖" }
];

/**
 * DevTools Bottom-Sheet Drawer Panel.
 * Renders the active tab content and refreshes state on world events.
 *
 * @returns {React.JSX.Element}
 */
export default function DevToolsDrawer() {
    const {
        isDevToolsOpen,
        setIsDevToolsOpen,
        activeTab,
        setActiveTab,
        logs,
        clearLogs,
        promptLogs,
        clearPromptLogs,
        getSystemState
    } = useDevTools();

    const conv = useChat();
    const { world } = conv;

    // Live state with auto-refresh on world events
    /** @type {[import("../contexts/DevToolsContext").DevToolsSystemState | { status: string }, React.Dispatch<React.SetStateAction<import("../contexts/DevToolsContext").DevToolsSystemState | { status: string }>>]} */
    const [liveState, setLiveState] = useState(() => getSystemState());

    // JSON copy state
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [copied, setCopied] = useState(false);

    // Log filter state
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [searchQuery, setSearchQuery] = useState("");

    /** @type {[import("../classes/lib/Logger").LogSeverity, React.Dispatch<React.SetStateAction<import("../classes/lib/Logger").LogSeverity>>]} */
    const [activeLevel, setActiveLevel] = useState(/** @type {import("../classes/lib/Logger").LogSeverity} */ ("info"));

    // Refresh state when world events fire
    useEffect(() => {
        if (!world || !isDevToolsOpen) return;

        const refresh = () => setLiveState(getSystemState());

        const offSchedule = world.events.on(WorldEvents.SCHEDULE_CHANGE, refresh, "DevToolsDrawer: schedule");
        const offHour = world.events.on(WorldEvents.HOUR_CHANGE, refresh, "DevToolsDrawer: hour");
        const offDay = world.events.on(WorldEvents.DAY_CHANGE, refresh, "DevToolsDrawer: day");
        const offReady = world.events.on(WorldEvents.READY, refresh, "DevToolsDrawer: ready");

        // Periodic refresh every 2 seconds when drawer is open
        const interval = setInterval(refresh, 2000);

        // Initial refresh
        refresh();

        return () => {
            offSchedule();
            offHour();
            offDay();
            offReady();
            clearInterval(interval);
        };
    }, [world, isDevToolsOpen, getSystemState]);

    // Copy raw JSON to clipboard
    const handleCopyState = useCallback(() => {
        try {
            const json = JSON.stringify(liveState, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            });
        } catch {
            // Ignore clipboard errors
        }
    }, [liveState]);

    const overlayClass = `${styles.drawerOverlay} ${isDevToolsOpen ? styles.drawerOverlayVisible : ""}`;
    const cardClass = `${styles.drawerCard} ${isDevToolsOpen ? styles.drawerCardVisible : ""}`;

    return (
        <div className={overlayClass} onClick={() => setIsDevToolsOpen(false)}>
            <div className={cardClass} onClick={(e) => e.stopPropagation()}>
                {/* Header with tabs */}
                <div className={styles.drawerHeader}>
                    <div className={styles.tabList}>
                        {TABS.map(tab => {
                            const activeClass = tab.id === "state" ? styles.tabActiveState
                                : tab.id === "prompts" ? styles.tabActivePrompts
                                : styles.tabActiveInfo;
                            return (
                                <button
                                    key={tab.id}
                                    className={`${styles.tab} ${activeTab === tab.id ? activeClass : ""}`}
                                    onClick={() => setActiveTab(/** @type {import("../contexts/DevToolsContext").DevToolsTab} */ (tab.id))}
                                >
                                    <span>{tab.icon} </span>
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    <button
                        className={styles.closeBtn}
                        onClick={() => setIsDevToolsOpen(false)}
                        aria-label="Close DevTools"
                    >
                        ✕
                    </button>
                </div>

                {/* Tab Content */}
                <div className={styles.contentBody}>
                    {activeTab === "state" && (
                        <DevToolsStateTab
                            liveState={liveState}
                            handleCopyState={handleCopyState}
                            copied={copied}
                        />
                    )}

                    {activeTab === "info" && (
                        <DevToolsLogsTab
                            logs={logs}
                            activeLevel={activeLevel}
                            searchQuery={searchQuery}
                            setSearchQuery={setSearchQuery}
                            clearLogs={clearLogs}
                        />
                    )}

                    {activeTab === "prompts" && (
                        <DevToolsPromptsTab
                            promptLogs={promptLogs}
                            clearPromptLogs={clearPromptLogs}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
