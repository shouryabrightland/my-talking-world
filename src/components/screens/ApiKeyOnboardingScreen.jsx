// @ts-check
import React, { useState, useCallback } from "react";
import styles from "./ApiKeyOnboardingScreen.module.css";
import {
    setApiKey,
    setGeminiApiKey,
    verifyAndProbeDualKeys,
    GROQ_CONSOLE_KEYS_URL,
    GEMINI_CONSOLE_KEYS_URL
} from "../../util/Constants";

/**
 * Dual-Key API Onboarding Screen.
 * Requires BOTH Groq and Gemini API keys with model probe verification.
 *
 * @param {Object} props
 * @param {() => void} props.onKeySaved
 */
export default function ApiKeyOnboardingScreen({ onKeySaved }) {
    const [groqKeyInput, setGroqKeyInput] = useState("");
    const [geminiKeyInput, setGeminiKeyInput] = useState("");
    const [isVerifying, setIsVerifying] = useState(false);
    /** @type {[string|null, React.Dispatch<React.SetStateAction<string|null>>]} */
    const [errorMessage, setErrorMessage] = useState(/**@type {string|null}*/(null));
    /** @type {[Array<{model: string, working: boolean, error: string|null, latencyMs: number}>|null, React.Dispatch<React.SetStateAction<Array<{model: string, working: boolean, error: string|null, latencyMs: number}>|null>>]} */
    const [probeResults, setProbeResults] = useState(/** @type {Array<{model: string, working: boolean, error: string|null, latencyMs: number}>|null} */ (null));

    const handleVerifyAndSubmit = useCallback(async (/** @type {React.FormEvent} */ e) => {
        e.preventDefault();
        const cleanGroq = groqKeyInput.trim();
        const cleanGemini = geminiKeyInput.trim();

        // Dual-key enforcement: BOTH are required
        if (!cleanGroq) {
            setErrorMessage("Groq API key is required for live chat. Please enter a valid Groq key (gsk_...).");
            setProbeResults(null);
            return;
        }

        if (!cleanGemini) {
            setErrorMessage("Gemini API key is required for schedule planning. Please enter a valid Gemini key (AIzaSy...).");
            setProbeResults(null);
            return;
        }

        setIsVerifying(true);
        setErrorMessage(null);
        setProbeResults(null);

        try {
            const result = await verifyAndProbeDualKeys(cleanGroq, cleanGemini);

            if (!result.success) {
                setErrorMessage(result.error);
                if (result.gemini.probeResults.length > 0) {
                    setProbeResults(result.gemini.probeResults);
                }
                return;
            }

            // Both keys verified, models probed — surface probe diagnostics
            // (latency badges + model checkmarks) briefly so users can see which
            // models responded, then transition into the studio.
            setApiKey(cleanGroq);
            setGeminiApiKey(cleanGemini);
            setProbeResults(result.gemini.probeResults);
            await new Promise((/** @type {(value: undefined) => void} */ resolve) => setTimeout(() => resolve(undefined), 1500));
            onKeySaved();
        } catch (/** @type {unknown} */ err) {
            setErrorMessage(`Verification crashed: ${err instanceof Error ? err.message : "Unknown error"}`);
            setProbeResults(null);
        } finally {
            setIsVerifying(false);
        }
    }, [groqKeyInput, geminiKeyInput, onKeySaved]);

    const isSubmitDisabled = isVerifying || !groqKeyInput.trim() || !geminiKeyInput.trim();

    return (
        <div className={styles.backdrop}>
            <div className={styles.ambientGlow} />

            <div className={styles.card}>
                <div className={styles.badge}>
                    <span>⚡ HYBRID AI SETUP</span>
                </div>

                <div className={styles.avatarWrapper}>
                    <img src="/group.png" alt="Tom & Friends" width={72} height={72} className={styles.avatar} />
                </div>

                <h2 className={styles.title}>Welcome to Tom & Friends!</h2>
                <p className={styles.subtitle}>
                    Both API keys are required. Groq powers instant live chat and Gemini handles 65K schedule planning.
                </p>

                <form onSubmit={handleVerifyAndSubmit} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <label className={styles.groqLabel}>
                            ⚡ 1. Groq API Key (Required for Live Chat):
                        </label>
                        <input
                            type="password"
                            placeholder="Paste Groq Key (gsk_...)"
                            value={groqKeyInput}
                            onChange={(e) => setGroqKeyInput(e.target.value)}
                            disabled={isVerifying}
                            className={styles.input}
                        />
                        <a
                            href={GROQ_CONSOLE_KEYS_URL}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.link}
                        >
                            Get free Groq API Key at Groq Keys ↗
                        </a>
                    </div>

                    <div className={styles.inputGroup}>
                        <label className={styles.geminiLabel}>
                            ✨ 2. Gemini API Key (Required for Planner):
                        </label>
                        <input
                            type="password"
                            placeholder="Paste Google AI Studio Key (AIzaSy...)"
                            value={geminiKeyInput}
                            onChange={(e) => setGeminiKeyInput(e.target.value)}
                            disabled={isVerifying}
                            className={styles.input}
                        />
                        <a
                            href={GEMINI_CONSOLE_KEYS_URL}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.linkGold}
                        >
                            Get free Gemini API Key at Google AI Studio ↗
                        </a>
                    </div>

                    {errorMessage && (
                        <div className={styles.errorBanner}>
                            <span>⚠️ {errorMessage}</span>
                        </div>
                    )}

                    {probeResults && probeResults.length > 0 && (
                        <div className={styles.probeResults}>
                            <div className={styles.probeHeader}>Model Status Breakdown:</div>
                            {probeResults.map((r) => (
                                <div key={r.model} className={r.working ? styles.probeWorking : styles.probeFailed}>
                                    <span>{r.working ? "✅" : "❌"}</span>
                                    <span className={styles.probeModel}>{r.model}</span>
                                    <span className={styles.probeLatency}>{r.latencyMs}ms</span>
                                    {!r.working && r.error && (
                                        <span className={styles.probeError}>{r.error}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSubmitDisabled}
                        className={isSubmitDisabled ? styles.btnDisabled : styles.btnSubmit}
                    >
                        {isVerifying ? "Verifying Keys & Probing Models..." : "Verify & Enter Studio 🚀"}
                    </button>
                </form>
            </div>
        </div>
    );
}
