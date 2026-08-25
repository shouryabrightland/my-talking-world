// @ts-check

/**
 * @file App.jsx
 * Root Application Shell for Tom & Friends.
 *
 * Responsibilities:
 * - Manages the onboarding → lobby → loading → chat lifecycle.
 * - Supports offline mode: when network is unavailable, skips API key
 *   verification and lobby, allowing users to view cached chats and
 *   send messages locally (AI responses are disabled).
 * - Renders the OfflineBanner when connectivity is lost.
 */

import React, { useCallback, useEffect, useState } from "react";
import ChatUX from "./components/Chat";
import { useChat } from "./contexts/ChatContext";
import { ConversationEvents } from "./classes/ConversationManager";
import { WorldEvents } from "./classes/World";
import { hasApiKey, hasGeminiApiKey } from "./util/Constants";
import StudioLobbyScreen from "./components/screens/StudioLobbyScreen";
import ApiKeyOnboardingScreen from "./components/screens/ApiKeyOnboardingScreen";
import StudioBackstageLoadingScreen from "./components/screens/StudioBackstageLoadingScreen";
import { useOffline } from "./contexts/OfflineContext";
import OfflineBanner from "./components/OfflineBanner";

/**
 * Root Application Shell.
 * Coordinates onboarding, lobby login, initialization, and chat stage.
 * In offline mode, bypasses API key and lobby screens entirely.
 *
 * @returns {React.JSX.Element}
 */
export default function App() {
    const conv = useChat();
    const { isOnline } = useOffline();

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [hasKey, setHasKey] = useState(() => hasApiKey() && hasGeminiApiKey());

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isReady, setIsReady] = useState(false);

    /** @type {[string|null, React.Dispatch<React.SetStateAction<string|null>>]} */
    const [initError, setInitError] = useState(/** @type {string|null} */ (null));

    // Auto-login when coming back online after being offline
    useEffect(() => {
        if (isOnline && isLoggedIn && !isReady && !initError) {
            // Re-attempt initialization when connection is restored
            if (!conv?.initialized) {
                conv.init().catch((err) => {
                    console.error("[App] Re-initialization failed after reconnect:", err);
                    setInitError(err instanceof Error ? err.message : "Failed to re-initialize engine.");
                });
            }
        }
    }, [isOnline, isLoggedIn, isReady, initError, conv]);

    useEffect(() => {
        if (!conv?.events) return;

        /** Handle logout event from ConversationManager */
        const handleLogoutObserver = () => {
            setIsLoggedIn(false);
            setIsReady(false);
            setInitError(null);
        };

        /** Check if world and conversation are both ready */
        const handleCheckReadiness = () => {
            if (conv.isReady && conv.world?.isReady) {
                setIsReady(true);
                setInitError(null);
            }
        };

        const offLogout = conv.events.on(ConversationEvents.LOGOUT, handleLogoutObserver, "App: logout observer");
        const offConvReady = conv.events.on(ConversationEvents.READY, handleCheckReadiness, "App: conv ready observer");

        // Guard against conv.world being null/undefined initially
        const offWorldReady = conv.world?.events
            ? conv.world.events.on(WorldEvents.READY, handleCheckReadiness, "App: world ready observer")
            : () => {};

        return () => {
            offLogout?.();
            offConvReady?.();
            offWorldReady?.();
        };
    }, [conv]);

    /**
     * Starts engine initialization when user clicks 'Log In' in the lobby.
     * In offline mode, this is called automatically.
     */
    const handleStartLogin = useCallback(() => {
        setIsLoggedIn(true);
        setIsReady(false);
        setInitError(null);

        if (!conv?.initialized) {
            conv.init().catch((err) => {
                console.error("[App] Engine initialization failed during login:", err);
                setInitError(err instanceof Error ? err.message : "Failed to initialize engine.");
            });
        }
    }, [conv]);

    // ========================================================================
    // OFFLINE MODE: Skip API keys, skip lobby, go straight to chat
    // ========================================================================
    if (!isOnline) {
        // If not logged in yet, auto-login silently (no API key check needed)
        if (!isLoggedIn) {
            // Auto-trigger login on next tick
            setTimeout(() => handleStartLogin(), 0);
            return <StudioBackstageLoadingScreen />;
        }

        // If not ready yet, show loading
        if (!isReady) {
            return (
                <>
                    <OfflineBanner />
                    <StudioBackstageLoadingScreen
                        error={initError}
                        onRetry={handleStartLogin}
                    />
                </>
            );
        }

        // Show chat with offline banner
        return (
            <>
                <OfflineBanner />
                <ChatUX />
            </>
        );
    }

    // ========================================================================
    // ONLINE MODE: Standard lifecycle
    // ========================================================================

    // 1. Dual-Key Onboarding screen if missing keys
    if (!hasKey) {
        return <ApiKeyOnboardingScreen onKeySaved={() => setHasKey(true)} />;
    }

    // 2. Studio Lobby gate screen
    if (!isLoggedIn) {
        return <StudioLobbyScreen onLogin={handleStartLogin} />;
    }

    // 3. Backstage Loading screen while world & conv are booting
    if (!isReady) {
        return (
            <StudioBackstageLoadingScreen
                error={initError}
                onRetry={handleStartLogin}
            />
        );
    }

    // 4. Primary Live Chat UI
    return <ChatUX />;
}
