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
import { BrowserRouter } from "react-router";
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
import { registerServiceWorker } from "./util/serviceWorker";

/** Root logger for top-level diagnostics */
const logger = new Logger("Root");

// Production only: register the build-versioned service worker and wire the
// "new version available" → reload handshake (no-ops during dev/tests).
registerServiceWorker();

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

// PHASE 6: Dev/harness exposure — Playwright (tests/e2e/real-env.spec.js)
// drives live engine internals (needleRouter, unifiedMemory, storage, world)
// directly on the window during browser execution.
if (import.meta.env.DEV || typeof window !== "undefined") {
    // @ts-ignore
    window.conv = conv;
}

const rootEl = document.getElementById("root");
if (!rootEl) {
    throw new Error("Initialization aborted: Root entry DOM element '#root' is absent.");
}

ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
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
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>
);
