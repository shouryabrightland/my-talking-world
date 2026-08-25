// @ts-check

/**
 * @file main.jsx
 * Application entry point.
 *
 * Bootstraps the React root and wraps the component tree in providers:
 * - ErrorBoundary: Catches uncaught UI crashes.
 * - OfflineProvider: Tracks browser online/offline status.
 * - ThemeProvider: Manages light/dark mode.
 * - ChatProvider: Exposes the ConversationManager engine.
 * - DevToolsProvider: Real-time system inspection (when enabled).
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Logger from "./classes/lib/Logger";
import ConversationManager from "./classes/ConversationManager";
import ChatMember from "./classes/ChatMember";
import { ChatProvider } from "./contexts/ChatContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DevToolsProvider } from "./contexts/DevToolsContext";
import { OfflineProvider } from "./contexts/OfflineContext";
import { BackgroundBarProvider } from "./contexts/BackgroundBarContext";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";

/** Root logger for top-level diagnostics */
const logger = new Logger("Root");

/**
 * Human user participant instance.
 * Represents the person interacting with the AI characters.
 */
const me = new ChatMember({
    id: "me",
    name: "Me",
    about: "Human User Interacting with Other members.",
    isAI: false
});

/**
 * ConversationManager orchestrator instance.
 * Manages the dialogue engine, AI clients, and world state.
 */
const conv = new ConversationManager({
    logger,
    User: me
});

const rootEl = document.getElementById("root");
if (!rootEl) {
    throw new Error("Initialization aborted: Root entry DOM element '#root' is absent.");
}

ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
        <ErrorBoundary>
            <OfflineProvider>
                <ThemeProvider>
                    <ChatProvider ConversationManager={conv}>
                        <DevToolsProvider>
                            <BackgroundBarProvider>
                                <App />
                            </BackgroundBarProvider>
                        </DevToolsProvider>
                    </ChatProvider>
                </ThemeProvider>
            </OfflineProvider>
        </ErrorBoundary>
    </React.StrictMode>
);
