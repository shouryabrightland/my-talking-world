// @ts-check

/**
 * @file ChatContext.jsx
 * React Context storing the active ConversationManager engine instance.
 *
 * Responsibilities:
 * - Provides the ConversationManager to all child components.
 * - useChat() hook for mandatory consumption (throws if used outside provider).
 * - useOptionalChat() hook for safe consumption (returns null if unmounted).
 */

import React, { createContext, useContext } from "react";

/** @typedef {import("../classes/ConversationManager").default} ConversationManager */

/** 
 * React Context storing the active conversation orchestrator engine.
 * @type {React.Context<ConversationManager|null>} 
 */
const ChatContext = createContext(/** @type {ConversationManager|null} */ (null));

/**
 * Context Provider exposing the ConversationManager instance to children.
 *
 * @param {Object} props
 * @param {ConversationManager} props.ConversationManager
 * @param {React.ReactNode} props.children
 * @returns {React.JSX.Element}
 */
export function ChatProvider({ ConversationManager, children }) {
    return (
        <ChatContext.Provider value={ConversationManager}>
            {children}
        </ChatContext.Provider>
    );
}

/**
 * Hook to consume the active ConversationManager.
 * Throws an explicit error if consumed outside ChatProvider.
 *
 * @returns {ConversationManager}
 */
export function useChat() {
    const context = useContext(ChatContext);

    if (!context) {
        throw new Error("Failed to consume ChatContext: useChat must be nested inside ChatProvider.");
    }

    return context;
}

/**
 * Safe alternative to useChat that returns null instead of throwing when unmounted.
 * Useful for error screens or global header elements.
 *
 * @returns {ConversationManager|null}
 */
export function useOptionalChat() {
    return useContext(ChatContext);
}