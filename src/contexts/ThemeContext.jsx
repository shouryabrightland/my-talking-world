// @ts-check

/**
 * @file ThemeContext.jsx
 * Theme Provider managing light/dark mode.
 *
 * Responsibilities:
 * - Persists theme preference to localStorage.
 * - Syncs HTML element data-theme attribute for CSS variable selectors.
 * - Listens for OS color scheme adjustments via matchMedia.
 * - Provides toggleTheme and setTheme controls.
 */

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import "../theme.css";

/**
 * @typedef {"light" | "dark"} ThemeMode
 */

/**
 * @typedef {Object} ThemeContextValue
 * @property {ThemeMode} mode Current active theme mode.
 * @property {boolean} isDark Convenience boolean flag for dark mode.
 * @property {() => void} toggleTheme Switches between light and dark modes.
 * @property {(mode: ThemeMode) => void} setTheme Explicitly sets the theme mode.
 */

const STORAGE_THEME_KEY = "tgf:ui:theme_mode";

/**
 * Resolves the initial theme preference safely from storage or OS media query.
 * @returns {ThemeMode}
 */
function getInitialTheme() {
    try {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem(STORAGE_THEME_KEY);
            if (saved === "light" || saved === "dark") return saved;

            if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
                return "dark";
            }
        }
    } catch {
        // Fallback for sandboxed iframes or private browsing storage errors
    }
    return "light";
}

/** @type {React.Context<ThemeContextValue|null>} */
const ThemeContext = createContext(/** @type {ThemeContextValue|null} */ (null));

/**
 * Theme Provider managing light/dark mode and syncing with document data-theme attribute.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @returns {React.JSX.Element}
 */
export function ThemeProvider({ children }) {
    /** @type {[ThemeMode, React.Dispatch<React.SetStateAction<ThemeMode>>]} */
    const [mode, setModeState] = useState(getInitialTheme);

    
    const setTheme = useCallback(
        /** @param {ThemeMode} newMode */
        (newMode) => {
        if (newMode !== "light" && newMode !== "dark") return;
        setModeState(newMode);
        try {
            localStorage.setItem(STORAGE_THEME_KEY, newMode);
        } catch {}
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(mode === "dark" ? "light" : "dark");
    }, [mode, setTheme]);

    // Synchronize HTML element data attribute for CSS variable selectors
    useEffect(() => {
        if (typeof document !== "undefined") {
            document.documentElement.setAttribute("data-theme", mode);
        }
    }, [mode]);

    // Listen for OS color scheme adjustments if user hasn't explicitly set preference
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleSystemThemeChange = (/** @type {MediaQueryListEvent} */ e) => {
            const saved = localStorage.getItem(STORAGE_THEME_KEY);
            if (!saved) {
                setModeState(e.matches ? "dark" : "light");
            }
        };

        mediaQuery.addEventListener("change", handleSystemThemeChange);
        return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
    }, []);

    /** @type {ThemeContextValue} */
    const value = useMemo(() => ({
        mode,
        isDark: mode === "dark",
        toggleTheme,
        setTheme
    }), [mode, toggleTheme, setTheme]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

/**
 * Hook to consume active theme mode and controls.
 * @returns {ThemeContextValue}
 */
export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider.");
    }
    return context;
}