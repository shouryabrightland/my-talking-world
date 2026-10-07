// src/App.jsx
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
import PresentationView from "./components/presentation/PresentationView";

export default function App() {
    const conv = useChat();
    const { isOnline } = useOffline();

    // Presentation Mode toggle:
    // Defaults to true for human presenters/judges; Playwright automated test runs bypass it.
    const [showPresentation, setShowPresentation] = useState(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            if (params.get("presentation") === "false") return false;
            if (params.get("presentation") === "true") return true;
            if (navigator.webdriver && !params.has("presentation")) return false;
        }
        return true;
    });

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [hasKey, setHasKey] = useState(() => hasApiKey() && hasGeminiApiKey());

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    // Dynamic initialization: if the engine (re)mounted while this component
    // was unmounted (StrictMode remount, previous login, offline auto-login),
    // derive readiness from live engine state instead of trapping the app on
    // the Stage Card with `false` forever.
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isReady, setIsReady] = useState(() => Boolean(conv?.isReady && conv?.world?.isReady));

    /** @type {[string|null, React.Dispatch<React.SetStateAction<string|null>>]} */
    const [initError, setInitError] = useState(/** @type {string|null} */ (null));

    // Listen for custom trigger event to replay presentation tour from Header or Lobby
    useEffect(() => {
        const handleOpenTour = () => setShowPresentation(true);
        window.addEventListener("tgf:open-presentation", handleOpenTour);
        return () => window.removeEventListener("tgf:open-presentation", handleOpenTour);
    }, []);

    // Auto-login when coming back online after being offline.
    // ConversationManager.init() is single-flight, so racing the login handler
    // can never boot the World twice.
    useEffect(() => {
        if (isOnline && isLoggedIn && !isReady && !initError) {
            if (!conv?.initialized) {
                conv.init().catch((err) => {
                    console.error("[App] Re-initialization failed after reconnect:", err);
                    setInitError(err instanceof Error ? err.message : "Failed to re-initialize engine.");
                });
            }
        }
    }, [isOnline, isLoggedIn, isReady, initError, conv]);

    // Readiness observers: READY can fire before this effect attaches (engine
    // already booted in RAM), so the check runs once IMMEDIATELY on mount and
    // the listeners cover every future READY/LOGOUT transition.
    useEffect(() => {
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

        // IMMEDIATELY invoke on mount to catch pre-existing readiness — an
        // event listener alone would miss a READY that fired in the past.
        handleCheckReadiness();

        if (!conv?.events) return;

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
     * Short-circuits when the singleton engine is already booted in RAM so a
     * re-login can never strand the app on the Stage Card.
     */
    const handleStartLogin = useCallback(() => {
        setIsLoggedIn(true);
        setInitError(null);

        // Engine already ready in RAM → transition to chat immediately.
        if (conv?.isReady && conv?.world?.isReady) {
            setIsReady(true);
            return;
        }

        setIsReady(false);

        if (!conv?.initialized) {
            conv.init()
                .then(() => {
                    setIsReady(true);
                })
                .catch((err) => {
                    console.error("[App] Engine initialization failed during login:", err);
                    setInitError(err instanceof Error ? err.message : "Failed to initialize engine.");
                });
        } else {
            // Initialized (listeners above still guard the final READY state).
            setIsReady(true);
        }
    }, [conv]);

    // 0. Presentation View
    if (showPresentation) {
        return <PresentationView onFinish={() => setShowPresentation(false)} />;
    }

    // 1. Offline Mode handling
    if (!isOnline) {
        if (!isLoggedIn) {
            setTimeout(() => handleStartLogin(), 0);
            return <StudioBackstageLoadingScreen />;
        }
        if (!isReady) {
            return (
                <>
                    <OfflineBanner />
                    <StudioBackstageLoadingScreen error={initError} onRetry={handleStartLogin} />
                </>
            );
        }
        return (
            <>
                <OfflineBanner />
                <ChatUX />
            </>
        );
    }

    // 2. Dual-Key Onboarding screen if missing keys
    if (!hasKey) {
        return <ApiKeyOnboardingScreen onKeySaved={() => setHasKey(true)} />;
    }

    // 3. Studio Lobby gate screen
    if (!isLoggedIn) {
        return <StudioLobbyScreen onLogin={handleStartLogin} />;
    }

    // 4. Backstage Loading screen while world & conv are booting
    if (!isReady) {
        return <StudioBackstageLoadingScreen error={initError} onRetry={handleStartLogin} />;
    }

    // 5. Primary Live Chat UI
    return <ChatUX />;
}