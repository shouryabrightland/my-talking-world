// @ts-check

import React, { useMemo } from "react";
import styles from "./Avatar.module.css";

/**
 * @typedef {import("../classes/ChatMember").default} ChatMember
 */

/**
 * Luxury Character Avatar Component.
 * Maps sprite sheet coordinates dynamically with cubic-bezier spring physics
 * and character-specific ambient glow rings via CSS Modules.
 *
 * @param {Object} props
 * @param {ChatMember} props.member Context ChatMember reference.
 * @param {string} [props.emotion="Default"] Target emotion name.
 * @param {boolean} [props.glow=true] Whether to display character neon glow ring.
 * @returns {React.JSX.Element}
 */
export default function Avatar({ member, emotion = "Default", glow = true }) {
    // 1. Resolve Sprite Sheet Metrics Safely
    const spriteMetrics = useMemo(() => {
        let x = 0;
        let y = 0;
        let size = 300;

        if (!member || !member.reaction) {
            return { x, y, size, url: "" };
        }

        try {
            const sprite = member.reaction.get(emotion);
            if (Array.isArray(sprite) && sprite.length >= 3) {
                x = sprite[0];
                y = sprite[1];
                size = sprite[2];
            }
        } catch (/** @type {unknown} */ err) {
            // Fallback to defaults
        }

        return { x, y, size, url: member.reaction.url || "" };
    }, [member, emotion]);

    const memberId = String(member?.id || "tom").toLowerCase();

    // Custom CSS Variables passed cleanly to feed the CSS Module
    /** @type {Record<string, string>} */
    const dynamicVariables = {
        "--sprite-x": `${spriteMetrics.x}%`,
        "--sprite-y": `${spriteMetrics.y}%`,
        "--sprite-size": `${spriteMetrics.size}%`,
        "--sprite-url": spriteMetrics.url ? `url(${spriteMetrics.url})` : "none",
        "--avatar-border": `var(--char-${memberId}, var(--primary))`,
        "--avatar-glow": glow ? `rgba(96, 165, 250, 0.35)` : "transparent", 
    };

    if (!member || !member.reaction) {
        return <div className={styles.fallbackAvatar} />;
    }

    return (

        <div className={styles.spriteLayer}
            style={/** @type {React.CSSProperties} */ (dynamicVariables)} />
    );
}