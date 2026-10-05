// @ts-check
import React from "react";
import styles from "./StudioLobbyScreen.module.css";

/**
 * @param {Object} props
 * @param {() => void} props.onLogin
 */
export default function StudioLobbyScreen({ onLogin }) {
    const todayFormatted = new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    return (
        <div className={styles.backdrop}>
            <div className={styles.ambientGlow} />

            <div className={styles.card}>
                <div className={styles.badge}>
                    <span>🎬 LIVING STUDIO LOBBY</span>
                </div>

                <div className={styles.avatarWrapper}>
                    <img src="/group.png" alt="Tom & Friends" width={86} height={86} className={styles.avatar} />
                </div>

                <h1 className={styles.title}>Tom & Friends</h1>
                <p className={styles.dateTag}>📍 Lucknow Studio • {todayFormatted}</p>

                <p className={styles.subtitle}>
                    Tom, Angela, Ben, Ginger, Hank, and Becca are hanging out. Step into the studio to chat or direct today's scene!
                </p>

                <button onClick={onLogin} className={styles.loginBtn}>
                    🎭 Log In & Enter Studio
                </button>
            </div>
        </div>
    );
}