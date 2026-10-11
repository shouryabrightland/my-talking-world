

# TASK: Complete Prompt Streamlining, Memory Synchronization & Engine Hardening

You are tasked with executing a surgical refactor of the "Tom & Friends" codebase across 8 files to:
1. Fix the 5 failing Vitest TTL duration string assertions in `UnifiedMemory.js`.
2. Retire the obsolete AI "Stabilize" requirement and allow direct saving (dense paragraphs are self-contained).
3. Update prompt instructions across the codebase so `<dense_paragraph>` is explicitly order- and time-independent (no sequence or transition phrases).
4. Synchronize `UnifiedMemory` in real-time whenever the schedule planner is modified (create, edit, delete, reorder, demand).
5. Eliminate the `<next>` / `<delay>` chat freeze and human message race condition.
6. Add a realistic human reaction baseline (1.0s–1.8s) to `ChatMember.typingDelay()`.
7. Restrict Director Demands in `applyUserDemand()` to generate ONLY the demanded delta block, not the entire schedule.

Strict verification rules:
- Zero TypeScript errors (`npx tsc --noEmit`).
- 100% Vitest pass rate (`npm test`).
- Zero hardcoded model names in runtime logic.

---

## FILE 1: `src/classes/lib/UnifiedMemory.js`

### A. Fix `add()` to preserve human-readable duration strings
In `add({ datetime, tags, data, expiry = "forever" })` (around lines 75–105), do NOT convert `expiry` into a millisecond timestamp with `toEpochMs()`. Keep the duration string as passed:

Replace:
```javascript
        // Task 12: UTC-anchored TTLs — store expiry as absolute UTC epoch millisecond number
        const epochExpiry = MemoryExpiryParser.toEpochMs(expiry);
        const resolvedExpiry = (epochExpiry !== null && epochExpiry !== undefined) ? epochExpiry : (expiry || "forever");

        /** @type {UnifiedMemoryEntry} */
        const entry = {
            id: crypto.randomUUID(),
            datetime: datetime || new Date().toISOString().slice(0, 16).replace("T", " "),
            tags: Array.isArray(tags)
                ? [...new Set(tags.map(t => String(t).toLowerCase().trim()).filter(Boolean))]
                : [],
            data: cleanData,
            expiry: resolvedExpiry
        };

With:

        /** @type {UnifiedMemoryEntry} */
        const entry = {
            id: crypto.randomUUID(),
            datetime: datetime || new Date().toISOString().slice(0, 16).replace("T", " "),
            tags: Array.isArray(tags)
                ? [...new Set(tags.map(t => String(t).toLowerCase().trim()).filter(Boolean))]
                : [],
            data: cleanData,
            expiry: (expiry === null || expiry === undefined) ? "forever" : expiry
        };

B. Fix syncEnvironment() TTLs

In syncEnvironment(env) (around lines 330–385), replace all
MemoryExpiryParser.toEpochMs(...) calls with clean duration strings:

  - Weather: expiry: "1h"
  - Today's Celebration: expiry: "24h"
  - Upcoming Events (calendar): expiry: "24h"
  - News Headlines: expiry: "1h"

C. Update syncPlannerScenes() to use denseParagraph and "24h" string expiry

In syncPlannerScenes(schedule) (around lines 410–445):

1.  Change expiry: MemoryExpiryParser.toEpochMs("24h") to expiry: "24h".
2.  Format the memory entry data using block.denseParagraph instead of the
    retired block.mainGoal:

            const sceneDescription = block.denseParagraph || block.topic || "Casual hangout";
            const data = UnifiedMemory.clampRecord(
                `Scene ${time}: ${block.topic} — ${sceneDescription}`
            );

FILE 2: src/util/prompts.js

A. Compress PROMPT_AGE_MANDATE

Replace PROMPT_AGE_MANDATE with this concise, self-contained version:

export const PROMPT_AGE_MANDATE = [
    "<age_factor>",
    "  <principle>Character age in the cast profiles strictly anchors vocabulary, maturity, concerns, and energy level. Keep each character grounded in their life stage:</principle>",
    "  <bands>",
    "    <band range=\"11-14\">High-energy, short messages, playful reactions, school/gaming/hobby focus. Avoid adult concerns.</band>",
    "    <band range=\"15-17\">Identity-forming, witty banter, slang, strong opinions, dreams, peer-focused.</band>",
    "    <band range=\"18-24\">Ambitious, independent, college/early career talk, confident, active social life.</band>",
    "    <band range=\"25-34\">Grounded, pragmatic, career/life balance, measured advice, collaborative problem-solving.</band>",
    "    <band range=\"35+\">Protective, experienced, calm emotional register, mentor figure, nostalgic humor.</band>",
    "  </bands>",
    "  <guidelines>Keep scenes and dialogue natural to the age group. Teens banter with rapid reactions; young adults discuss plans and projects; older members provide steady grounding.</guidelines>",
    "</age_factor>"
].join("\n");

B. Update PROMPT_DEMAND_RULES for Self-Contained, Independent Scenes

Replace PROMPT_DEMAND_RULES with:

export const PROMPT_DEMAND_RULES = Object.freeze([
    "The user's requested activity has highest priority. Schedule it at the requested time window.",
    "LOCATIONS: Dynamically choose a realistic, varied, real-world location across Lucknow that fits the activity (parks, markets, local cafes, streets, rooftops, libraries, home spaces).",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: Avoid repetitive defaults to Hazratganj or Chowk — prefer varied Lucknow spots and domestic spaces unless requested otherwise.",
    "SELF-CONTAINED SCENE: The <dense_paragraph> of every block MUST vividly describe the scene setting, atmosphere, and what individual cast members are actively doing or aiming for.",
    "ORDER & TIME INDEPENDENCE: Every <dense_paragraph> must be completely self-contained and independent of neighboring scenes or chronological sequence. Never write transition phrases like 'Continuing from earlier', 'After the previous study session', or 'Before winding down'. The scene must stand entirely on its own.",
    "Preserve all timeline blocks before and after the requested activity intact. Do not overwrite unrelated blocks.",
    "Use relevant saved memories to contextualize topic details without overriding the user's explicit request.",
    "Output strictly valid XML <demand_resolution> containing a 2-line summary, the updated schedule, and a structured <narrative_report>.",
    "The <narrative_report> must contain: <summary> (1-2 sentences of what changed), <continuity_impact> (flow effect), <character_shifts> (affected character motivations), and <transition_hooks> (lead-in and lead-out hooks).",
    "If any <narrative_report> sub-element is not applicable, omit it rather than providing empty text."
]);

C. Update PROMPT_RESTABILIZER_TASK & PROMPT_RESTABILIZER_RULES

Replace with:

export const PROMPT_RESTABILIZER_TASK =
    "Review the schedule blocks to ensure each scene description is self-contained and cohesive, " +
    "preserving the core topic and objective of each scene without narrative dependencies between blocks.";

export const PROMPT_RESTABILIZER_RULES = Object.freeze([
    "Preserve existing topics, times, and facts unless an adjustment is necessary for continuity.",
    "Ensure every block has a cohesive, self-contained <dense_paragraph> describing the scene atmosphere and individual character actions, completely independent of neighboring blocks or sequence order.",
    "Ensure timeline blocks maintain chronological sequence without overlaps.",
    "Output strictly valid XML <schedule><block start=\"...\" end=\"...\">...</block></schedule>.",
    "Return the complete and final updated schedule."
]);

FILE 3: src/classes/WorldSetter.js

A. Add Real-Time Memory Sync Helper

Add a private helper method to WorldSetter:

    #syncPlannerScenesToMemory() {
        if (this.world?.unifiedMemory?.syncPlannerScenes) {
            void this.world.unifiedMemory.syncPlannerScenes(this.schedule);
        }
    }

Call this.#syncPlannerScenesToMemory() immediately inside:

1.  createRecord() (right after this.world.tick(this.world.now);)
2.  updateRecord() (right after this.world.tick(this.world.now);)
3.  deleteRecord() & deleteTodayInstance() (right after
    this.world.tick(this.world.now);)
4.  reorderBlocks() (right after this.world.tick(this.world.now);)
5.  acceptProposal() (right after this.world.tick(this.world.now);)
6.  resolveTodaySchedule() (right after this.world.tick(this.world.now);)

B. Make updateRecord() and restabilizeAndSave() Save Directly Without AI Overhead

1.  In updateRecord(id, updates):

        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = false;

        await this.#syncTemplateLibrary(record);
        await this.#persistToday();
        this.world.tick(this.world.now);
        this.#syncPlannerScenesToMemory();

        return record;

2.  In restabilizeAndSave(): Keep it fast, boundary-validated, and direct
    without an unnecessary AI round-trip:

    async restabilizeAndSave() {
        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = false;
        await this.#persistToday();
        this.world.tick(this.world.now);
        this.#syncPlannerScenesToMemory();

        this.logger.info(`Schedule saved directly. ${this.schedule.length} blocks persisted.`);
        return { success: true, message: `Saved ${this.schedule.length} blocks.`, schedule: this.schedule };
    }

C. Update planHorizon() Prompt & Schema

In planHorizon(), update Rule 4 and the output schema to enforce order
independence:

                "## Rules & Constraints",
                "1. Provide a complete, unbroken sequence of blocks covering the full 24-hour cycle.",
                "2. Contiguous start/end times with no overlapping hours.",
                "3. Rotate settings across Lucknow (Gomti Nagar riverfront, Aliganj markets, university campus, balconies, living rooms, terraces).",
                "4. INDEPENDENT SCENES: In each block, the <dense_paragraph> MUST be a 2-4 sentence self-contained scene description showing the setting, atmosphere, and individual cast actions. It must be completely independent of order, preceding blocks, or future scenes — no transitional phrases like 'after the earlier session' or 'preparing for tonight'.",
                "",
                "## Output Schema",
                "Output strictly valid XML matching this structure:",
                `<schedule date="${XmlEncoder.encode(this.world.date)}">`,
                "  <summary>Brief 1-2 sentence overview of the daily arc.</summary>",
                '  <block start="14.0" end="15.5">',
                "    <topic>Scene title</topic>",
                "    <dense_paragraph>2-4 sentence self-contained scene description showing the setting and individual cast actions/goals. Completely independent of time sequence or neighboring blocks.</dense_paragraph>",
                "    <facts><fact>Concrete item or constraint</fact></facts>",
                "  </block>",
                "</schedule>"

D. Enforce Delta-Only Output in applyUserDemand()

1.  In applyUserDemand() (around lines 630–675), simplify existingBlocksXml to
    a 1-line reference per block:

        const existingBlocksXml = this.schedule.map(b => (
            `    <block time="${b.timeRange}" topic="${XmlEncoder.encode(b.topic)}" />`
        )).join("\n");

2.  Update the prompt to mandate that Gemini outputs ONLY the demanded block(s),
    not the whole schedule:

        promptBuilder.useSystem(() => promptBuilder.part(
            "<demand_engine>\n" +
            `  <task>${PROMPT_DEMAND_TASK}</task>\n` +
            "  <rules>\n" +
            PROMPT_DEMAND_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
            "    <rule>DELTA ONLY: Output ONLY the 1-2 new block(s) needed for the demanded activity at the requested time. Do NOT re-emit or duplicate untouched existing blocks. Our engine automatically splices your block into the timeline.</rule>\n" +
            "  </rules>\n" +
            `${PROMPT_AGE_MANDATE}\n` +
            "  <output_schema>\n" +
            "    <demand_resolution>\n" +
            "      <summary_line_1>Clear 1-sentence summary of what was scheduled</summary_line_1>\n" +
            "      <summary_line_2>Exact time window</summary_line_2>\n" +
            "      <schedule>\n" +
            '        <block start="17.0" end="18.0">\n' +
            "          <topic>Demanded activity title</topic>\n" +
            "          <dense_paragraph>2-3 sentence self-contained scene setting detailing the activity and individual character roles without time or sequence dependencies.</dense_paragraph>\n" +
            "          <facts><fact>Relevant context item</fact></facts>\n" +
            "        </block>\n" +
            "      </schedule>\n" +
            "    </demand_resolution>\n" +
            "  </output_schema>\n" +
            "</demand_engine>"
        ));

E. Update #generateDeltaBlocksForGaps()

Update Rule 3 and output schema:

            "## Rules",
            "1. Blocks stay strictly inside their own gap: contiguous, non-overlapping.",
            "2. Rotate varied Lucknow settings (Gomti Nagar riverfront, Aliganj markets, university campus, balconies, study rooms, terraces, society parks).",
            "3. The <dense_paragraph> must be a vivid, self-contained 2-4 sentence scene setting describing who is where, atmosphere, and what individual members are actively doing or aiming for, completely independent of chronological order or neighboring blocks.",
            "",
            "## Age Factor",
            PROMPT_AGE_MANDATE,
            "",
            "## Child Safety",
            PROMPT_CHILD_SAFETY_MANDATE,
            "",
            "## Output Schema",
            "Output strictly valid XML matching this structure — one <block> per generated scene:",
            "<schedule>",
            `  <block start="${gaps[0].start}" end="${Math.min(gaps[0].end, gaps[0].start + 2)}">`,
            "    <topic>Scene title</topic>",
            "    <dense_paragraph>2-4 sentence self-contained scene setting showing cast actions and goals, independent of sequence.</dense_paragraph>",
            "    <facts><fact>Concrete item or constraint</fact></facts>",
            "  </block>",
            "</schedule>"

FILE 4: src/classes/ConversationManager.js

A. Clean Duplicated Scene Lines in registerPrompt()

In registerPrompt(builder) (around line 1445), streamline sceneBarLines so it
avoids duplicating the scene topic and paragraph already present in ## Current
Scene:

            // Live environmental context: weather, occasion, and real headlines.
            // (Scene title and narrative are already declared in ## Current Scene above)
            const env = this.world.environment;
            const sceneBarLines = [
                "",
                "## Live Environment",
                "```",
                `- Weather: ${env?.temperature || "32°C"}, ${env?.weather || "Warm"} (Humidity: ${env?.humidity || "55%"})`,
                `- Occasion: ${env?.todayCelebration || "No festival today"}`,
                `- Headlines: ${(env?.newsHeadlines || []).slice(0, 3).join(" | ") || "None"}`,
                "```"
            ];

B. Tighten <next> and <delay> Output Instructions to Prevent False Sleep Freezes

In registerPrompt(builder), clarify the end-of-turn pacing instructions so the
model defaults to 2-4 second banter and only uses <next> for explicit
night/sleep sign-offs:

                "- After the LAST message, output exactly one end-of-turn pacing tag:",
                '  * Normal banter (default): <delay sec="2"/> to <delay sec="4"/>',
                '  * Thinking / quiet pause: <delay sec="5"/> to <delay sec="10"/>',
                '  * ONLY when the group explicitly says goodbye, goes to sleep, or parts ways until a later hour: <next time="HH:MM"/> (e.g. <next time="22:30"/>). NEVER use <next> during active conversation.'

C. Guard Daytime Banter Delays Against Excess Freezes

In scheduleNextRequest() (around line 1320), cap explicitDelay during normal
chat turns to a 15-second ceiling:

        } else if (explicitDelay !== null) {
            // Cap daytime banter delays to 15 seconds max to prevent chat freeze
            const safeDelay = Math.min(15_000, explicitDelay);
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + safeDelay;
            localStorage.setItem(NEXT_WAKE_STORAGE_KEY, String(targetTimeMs));

FILE 5: src/components/footer.jsx

Immediately Clear user.isTyping on Message Submit

In handleSendWithEmotion in footer.jsx (around line 250), immediately clear the
typing timeout and emit TYPING: false synchronously on submission so the engine
does not treat the user as mid-sentence:

        user.send(message);

        setText("");
        setIsDrawerOpen(false);

        // Immediate reset: clear typing indicator synchronously on submit
        if (typingTimeout.current) {
            clearTimeout(typingTimeout.current);
            typingTimeout.current = null;
        }
        user.events.emit(ChatMemberEvents.TYPING, false);

FILE 6: src/classes/ChatMember.js

Add Human Reaction Time to typingDelay()

In ChatMember.js (around line 340), update typingDelay() to add a realistic
human reaction window (1.0s to 1.8s) so character typing does not burst
unrealistically in milliseconds:

    /**
     * Calculates realistic human typing delay in milliseconds:
     * 1. Baseline reaction/reading time (1.0 to 1.8 seconds) to read the previous line and open the keyboard.
     * 2. Pacing time per letter based on character typing speed.
     *
     * @param {Message} message
     * @returns {number} Delay in milliseconds.
     */
    typingDelay(message) {
        const text = message?.text || "";
        const length = Math.max(text.length, 1);
        const rate = this.typingSpeedMs || 32;

        // Human reaction time: 1.0s to 1.8s to react and start typing
        const reactionDelay = random(1000, 1800);

        // Actual typing duration: ~28-40ms per letter with variance
        const typingDuration = random(length * (rate * 0.9), length * (rate * 1.3));

        return Math.round(reactionDelay + typingDuration);
    }

FILE 7: src/classes/SituationEngine.js

Streamline ingestNews Prompt

In SituationEngine.js (around line 430), replace PROMPT_CHILD_SAFETY_MANDATE in
the news distillation prompt with a direct factual rule:

        const prompt = [
            "# News Distillation Task",
            'You are the world-news updater for "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
            "Condense the headlines below into 3 to 5 dense factual memory records.",
            `Each record MUST be ${MAX_RECORD_CHARS} characters or fewer: one self-contained fact with concrete entities (place, person, event, number).`,
            "No opinions, no predictions, no advice, no duplicated facts, no meta commentary.",
            "Skip sensationalist gossip. Ensure all selected items are positive or constructive real-world updates suitable for a family sitcom.",
            "",
            "## Headlines",
            "```",
            headlines.map((h, i) => `${i + 1}. ${h}`).join("\n"),
            "```",
            "",
            "## Output Format",
            "Output ONLY valid XML matching this structure:",
            "<news_records>",
            `  <record>One dense factual news memory in ${MAX_RECORD_CHARS} characters or fewer.</record>`,
            "</news_records>"
        ].join("\n");

FILE 8: src/components/PlannerDrawer.jsx

1.  Update the Action Bar (around line 525) to save changes directly without
    requiring AI stabilization:

                    {/* Dynamic Action Bar — Manual Edit Controls */}
                    {isDirty && !proposal && (
                        <div className={styles.actionBar}>
                            <div className={styles.actionBtnRow}>
                                <button
                                    onClick={handleDiscardManual}
                                    className={styles.discardBtn}
                                    title="Discard unsaved manual changes"
                                >
                                    ↩ Discard
                                </button>
                                <button
                                    onClick={handleStabilizeSave}
                                    className={styles.stabilizeSaveBtn}
                                    disabled={isStabilizing}
                                    title="Save schedule changes directly"
                                >
                                    {isStabilizing ? "⏳ Saving..." : "💾 Save Changes"}
                                </button>
                            </div>
                        </div>
                    )}

2.  In lines 467 and 746, update the denseParagraph textarea placeholders to:

placeholder="2-3 sentence self-contained scene setting (who is where, cast actions) independent of time sequence"

FILE 9: tests/classes/WorldSetter.test.js

In tests/classes/WorldSetter.test.js (around line 455), update the test "injects
the UnifiedMemory stack, cast profiles and continuity locks" to assert on
<dense_paragraph>:

        const text = capturedSystemText();
        expect(text).toContain("# 24-Hour Storyline Planner & Director Engine");
        expect(text).toContain("Tom promised chai at 5");
        expect(text).toContain("**Tom** (ID: `tom`, Age: 21y)");
        expect(text).toContain("LOCKED / PAST");
        expect(text).toContain("FUTURE - SUBJECT TO RE-STABILIZATION");
        expect(text).toContain("full 24-hour cycle");
        expect(text).toContain("<dense_paragraph>");

VERIFICATION STEP

After applying these changes, run:

npx tsc --noEmit
npm test

Confirm:

1.  npx tsc --noEmit returns 0 errors.
2.  npm test passes 100% of tests (all 38 test files, 488/488 passing).

