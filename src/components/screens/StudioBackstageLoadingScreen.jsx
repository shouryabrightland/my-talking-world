// @ts-check
import React, { useState, useEffect } from "react";
import styles from "./StudioBackstageLoadingScreen.module.css";

const PHASES = [
    { icon: "🎬", text: "Opening studio stage & storyline horizon..." },
    { icon: "🌤️", text: "Fetching live weather, calendar & headlines..." },
    { icon: "🧠", text: "Planning character agendas & dynamic memories..." },
    { icon: "🎭", text: "Tuning character voices & raising the curtain..." }
];

/**
 * @param {Object} props
 * @param {string|null} [props.error]
 * @param {() => void} [props.onRetry]
 */
export default function StudioBackstageLoadingScreen({ error, onRetry }) {
    const [phaseIndex, setPhaseIndex] = useState(0);

    useEffect(() => {
        if (error) return;

        const interval = setInterval(() => {
            setPhaseIndex((prev) => (prev + 1) % PHASES.length);
        }, 1800);

        return () => clearInterval(interval);
    }, [error]);

    const activePhase = PHASES[phaseIndex] || PHASES[0];

    return (
        <div className={styles.backdrop}>
            <div className={styles.ambientGlowTop} />
            <div className={styles.ambientGlowBottom} />

            <div className={styles.stageCard}>
                <div className={styles.studioBadge}>
                    <span className={styles.badgeDot} />
                    <span>LIVING STAGE ENGINE</span>
                </div>

                <div className={styles.avatarWrapper}>
                    <div className={styles.avatarPulseRing} />
                    <img
                        src="/group.png"
                        alt="Tom & Friends Cast"
                        width={90}
                        height={90}
                        className={styles.avatarImage}
                    />
                </div>

                <h1 className={styles.mainTitle}>Tom & Friends</h1>
                <p className={styles.tagline}>Interactive Living Sitcom & Story Sandbox</p>

                {error ? (
                    <div className={styles.errorContainer}>
                        <span className={styles.errorIcon}>⚠️</span>
                        <p className={styles.errorText}>{error}</p>
                        {onRetry && (
                            <button onClick={onRetry} className={styles.retryBtn}>
                                🔄 Retry Initialization
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className={styles.phaseContainer}>
                            <span className={styles.phaseIcon}>{activePhase.icon}</span>
                            <span className={styles.phaseText}>{activePhase.text}</span>
                        </div>
                        <div className={styles.progressBarTrack}>
                            <div className={styles.progressBarGlow} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}