// @ts-check

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

/** @typedef {import("../classes/Message").default} Message */

/**
 * Supported interaction perspectives in the simulation:
 * - "user": The human acts as an in-room conversational participant ("Me").
 * - "director": The human acts as an invisible narrator/director ("God Mode").
 * @typedef {"user" | "director"} AppMode
 */

/**
 * @typedef {Object} InputBoxContextValue
 * @property {Message|null} reply Quoted message reference being replied to.
 * @property {Message|null} Reply Deprecated alias for reply.
 * @property {React.Dispatch<React.SetStateAction<Message|null>>} setReply Setter to assign or clear quoted reply target.
 * @property {() => void} clearReply Helper to directly cancel the active quote reply.
 * @property {AppMode} mode Active user perspective mode.
 * @property {(mode: AppMode) => void} setMode Setter to toggle between User and Director modes.
 * @property {boolean} isPlannerOpen Whether the 24-Hour Storyline Planner slide-over panel is visible.
 * @property {(isOpen: boolean) => void} setIsPlannerOpen Setter for planner drawer visibility.
 */

/** @type {React.Context<InputBoxContextValue|null>} */
const InputBoxContext = createContext(/** @type {InputBoxContextValue|null} */ (null));

/**
 * Context Provider exposing input actions, mode states, and planner visibility.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @returns {React.JSX.Element}
 */
export function InputBoxContextProvider({ children }) {
    /** @type {[Message|null, React.Dispatch<React.SetStateAction<Message|null>>]} */
    const [reply, setReply] = useState(/** @type {Message|null} */ (null));

    /** @type {[AppMode, React.Dispatch<React.SetStateAction<AppMode>>]} */
    const [mode, setModeState] = useState(/** @type {AppMode} */ ("user"));

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isPlannerOpen, setIsPlannerOpenState] = useState(false);

    const setMode = useCallback(
        /** @param {AppMode} newMode */
        (newMode) => {
        if (newMode === "user" || newMode === "director") {
            setModeState(newMode);
        }
    }, []);

    const setIsPlannerOpen = useCallback(
        /** @param {boolean} isOpen */
        (isOpen) => {
        setIsPlannerOpenState(Boolean(isOpen));
    }, []);

    const clearReply = useCallback(() => {
        setReply(null);
    }, []);

    /** @type {InputBoxContextValue} */
    const value = useMemo(() => ({
        reply,
        Reply: reply, // Preserved for backwards compatibility
        setReply,
        clearReply,
        mode,
        setMode,
        isPlannerOpen,
        setIsPlannerOpen
    }), [reply, mode, isPlannerOpen, setMode, setIsPlannerOpen, clearReply]);

    return (
        <InputBoxContext.Provider value={value}>
            {children}
        </InputBoxContext.Provider>
    );
}

/**
 * Hook to consume active input and interaction mode parameters safely.
 * @returns {InputBoxContextValue}
 */
export function useInputBox() {
    const context = useContext(InputBoxContext);

    if (context === null) {
        throw new Error("useInputBox must be consumed within an InputBoxContextProvider.");
    }

    return context;
}