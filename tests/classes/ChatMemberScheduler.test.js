// @ts-check

/**
 * @file ChatMemberScheduler.test.js
 * Reload catch-up contract (Phase 3):
 * - Past-due messages flush into the chat immediately on init()/reload.
 * - Stale typing/reading visuals are skipped without dropping the queue.
 * - Future events stay scheduled (never delivered early).
 */

import { describe, it, expect, afterEach } from "vitest";
import ChatMember from "../../src/classes/ChatMember.js";
import Message from "../../src/classes/Message.js";

/** @type {ChatMember[]} */
const members = [];

afterEach(() => {
    for (const member of members) {
        try {
            member.destroy();
        } catch { /* teardown is best-effort */ }
    }
    members.length = 0;
});

/**
 * Builds a ChatMember wired to a fake chat that records deliveries.
 * @returns {{ member: ChatMember, delivered: import("../../src/classes/Message.js").default[] }}
 */
function makeMember() {
    const member = new ChatMember({ id: `tom-${crypto.randomUUID().slice(0, 8)}`, name: "Tom" });
    /** @type {import("../../src/classes/Message.js").default[]} */
    const delivered = [];

    member.connect(/** @type {any} */ ({
        getMember: (/** @type {string} */ id) => (id === member.id ? member : null),
        addMessage: (/** @type {import("../../src/classes/Message.js").default} */ msg) => {
            delivered.push(msg);
        }
    }));

    members.push(member);
    return { member, delivered };
}

describe("ChatMemberScheduler — reload catch-up", () => {
    it("flushes past-due messages into the chat on init(), before readyPromise resolves", async () => {
        const { member, delivered } = makeMember();
        const past = Date.now() - 60_000;
        const message = new Message({ sender: member, text: "Late night snack run!" });

        await member.schedulerStorage.setItem(`scheduler:${member.id}`, [
            { type: "typing:start", time: past, message: message.toJSON() },
            { type: "typing:end", time: past + 100, message: message.toJSON() },
            { type: "message", time: past + 200, message: message.toJSON() }
        ]);

        const initPromise = member.init();
        await member.scheduler.readyPromise;

        // The flush runs BEFORE the scheduler reports ready.
        expect(delivered).toHaveLength(1);
        expect(delivered[0].text).toBe("Late night snack run!");

        // Stale typing visuals were skipped, not replayed, and the queue drained.
        expect(member.isTyping).toBe(false);
        expect(member.scheduler.getTimeline()).toHaveLength(0);

        await initPromise;
    });

    it("skips stale visual cues but still delivers an hours-old message", async () => {
        const { member, delivered } = makeMember();
        const hoursAgo = Date.now() - 3_600_000;
        const message = new Message({ sender: member, text: "The viva got postponed to Monday." });

        await member.schedulerStorage.setItem(`scheduler:${member.id}`, [
            { type: "reading:start", time: hoursAgo, message: message.toJSON() },
            { type: "message", time: hoursAgo + 50, message: message.toJSON() },
            { type: "reading:end", time: hoursAgo + 60, message: message.toJSON() }
        ]);

        await member.init();

        expect(delivered).toHaveLength(1);
        expect(delivered[0].text).toBe("The viva got postponed to Monday.");
        expect(member.isReading).toBe(false);
        expect(member.scheduler.isEmpty()).toBe(true);
    });

    it("keeps future events scheduled instead of delivering them early", async () => {
        const { member, delivered } = makeMember();
        const future = Date.now() + 60_000;
        const message = new Message({ sender: member, text: "Not yet!" });

        await member.schedulerStorage.setItem(`scheduler:${member.id}`, [
            { type: "message", time: future, message: message.toJSON() }
        ]);

        await member.init();

        expect(delivered).toHaveLength(0);
        expect(member.scheduler.getTimeline()).toHaveLength(1);
    });
});
