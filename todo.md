***

# MASTER IMPLEMENTATION SPECIFICATION: TOM & FRIENDS (CBSE HACKATHON EDITION)
## Architecture Hardening, Child-Safe Content Guardrails, Pacing & Memory Refactor

You are tasked with refactoring, de-biasing, child-safeguarding, and hardening the entire codebase for **Tom & Friends** (T&F). The target audience is **school children (CBSE Hackathon 2026 showcase)**. Every feature must be functional, robust, and free of lazy placeholder text.

### 🛡️ Compilation & Quality Requirements:
1. `npx tsc --noEmit` must return **0 errors**.
2. `npm test` must pass **100% of tests** (update/add unit and integration tests to match new contracts).
3. `npm run build` must succeed with clean dynamic bundle chunking.
4. Execute and test each phase systematically.

---

## 📋 TABLE OF IMPLEMENTATION PHASES
* **Phase 1**: Child Safety Mandate, Complete Cliché Purge & In-Character Bullying Shield
* **Phase 2**: Presentation Lazy-Loading & Legacy Keyed Memory Deletion
* **Phase 3**: Unified Memory $\le 80$-Char Limit & Synchronous Needle Router
* **Phase 4**: Real Calendar Countdown & Seeding the Next 10 Events into `%world%`
* **Phase 5**: Groq Reasoning Token Tracking & DevTools Thinking Budget Display
* **Phase 6**: Message Auto-Splitting & Inter-Message `<delay>` Pacing Engine
* **Phase 7**: Timeline Processor Catch-Up on Reload/Mount
* **Phase 8**: Refocused Situation Engine (Pure Memory Extraction & News Distillation)
* **Phase 9**: Hybrid 24-Hour Planner (Template Ladder + Delta Gaps + Direct Scene Injection)
* **Phase 10**: Director Twist Engine (30s Cooldown, Gemma 3-Act Beats, Conflict Cancellation & Multi-End UI)
* **Phase 11**: Ben's "Cartoon Science" Curriculum Hook & "Today's Episode" Comic Card
* **Phase 12**: Verification, Linting & Test Hardening

---

## 📁 PHASE 1: CHILD SAFETY MANDATE, COMPLETE CLICHÉ PURGE & BULLYING SHIELD

### 1.1 Export `<child_safety_mandate>` in `src/util/prompts.js`
Add and export `PROMPT_CHILD_SAFETY_MANDATE`:
```javascript
export const PROMPT_CHILD_SAFETY_MANDATE =
  "<child_safety_mandate>\n" +
  "  <rating>Strictly G-Rated / Family-Friendly (CBSE School Standards)</rating>\n" +
  "  <core_values>Promote positive teamwork, curiosity, scientific problem-solving, empathy, kindness, and clean cartoon slapstick humor.</core_values>\n" +
  "  <strictly_forbidden>\n" +
  "    - NO foul language, abusive slang, or derogatory insults.\n" +
  "    - NO bullying, exclusion, toxic silent treatments, or mean-spirited roasting.\n" +
  "    - NO romantic/dating drama, breakups, flirting, or mature adolescent angst.\n" +
  "    - NO physical danger or hazards children could imitate: electrical outlets, open flames, kitchen gas, leaning over balcony railings, climbing roofs, traffic/scooter stunts, or dangerous sharp tools.\n" +
  "    - NO scary or horror tropes: midnight knocking, masked strangers, breathing prank calls, ghosts, or ticking packages.\n" +
  "  </strictly_forbidden>\n" +
  "  <in_character_safety_intervention>\n" +
  "    If the human user uses inappropriate, offensive, or bullying words, NEVER give a robotic AI disclaimer. Characters MUST react in-character with playful cartoon boundaries:\n" +
  "    - Angela (hands on hips): 'Haww! Aise gande words yahan allowed nahi hain! Sorry bolo pehle!'\n" +
  "    - Ginger (pointing): 'Ooo! Bad word bola! Main sabko bata dunga!'\n" +
  "    - Ben: 'Mere scanner ne ek inappropriate word detect kiya hai. Word deleted!'\n" +
  "  </in_character_safety_intervention>\n" +
  "  <conflict_resolution>All character disagreements must remain playful cartoon bickering and resolve with empathy, teamwork, and laughter.</conflict_resolution>\n" +
  "</child_safety_mandate>";
```
Inject this mandate into `ConversationManager.registerPrompt()`, `WorldSetter.planHorizon()`, and `SituationEngine.js`.

### 1.2 Purge Dangerous, Creepy & Mature Presets from `src/util/directorPresets.js`
Search and replace all unsafe or mature presets in `DIRECTOR_PRESETS`:
1. **Physical Danger Replacements**:
   * Replace `Outlet Spark` with `"🎈 Balloon Static: Rubbing a balloon creates funny static electricity that makes everyone's hair stand straight up!"`
   * Replace `Balcony Rescue` with `"🪁 Stuck Kite: A toy kite gets snagged on a low tree branch and requires teamwork to retrieve!"`
   * Replace `Gas Smell` and `Kitchen Flare-Up` with `"🥞 Pancake Flip Fail: A pancake launch goes sky-high and lands upside down on the table!"`
   * Replace `Lane Sprint` with `"🏃 Hallway Sack Race: An obstacle race breaks out across the living room!"`
   * Replace `Skyline Sneak` with `"🔭 Stargazing Spot: The group sets up a toy telescope by the window to spot constellations!"`
2. **Creepy / Thriller Tropes Replacements**:
   * Replace `Watched Figure`, `Breathing Caller`, `3AM Doorbell`, `Midnight Knocking`, `Stranger's Suitcase`, `Prank Timer`, `Pickpocketed Phone` with fun mystery and comedy tropes:
     * `"🔍 Cookie Crumb Trail: A trail of biscuit crumbs leads directly to Hank's cozy nap corner!"`
     * `"📦 Surprise Gift Box: A mystery parcel with a giant ribbon arrives addressed to the whole squad!"`
     * `"📻 Funky Frequency: The radio picks up a catchy cartoon theme song that gets everyone humming!"`
     * `"🧦 Missing Sock Mystery: Ginger launches an official detective investigation to find a missing colorful sock!"`
3. **Mature / Toxic Tropes Replacements**:
   * Replace `Overheard Breakup`, `Wrong-Target Egg`, `Group Silent Treatment`, `Misdirected Love Letter` with clean cartoon situations:
     * `"🎨 Painting Mix-Up: Ben's automated paintbrush slips and leaves neon green dots on Tom's favorite cap!"`
     * `"🏆 Paper Plane Derby: An epic distance championship with folded paper airplanes!"`
     * `"🎭 Silly Charades: Someone challenges the room to 5 minutes of cartoon pantomime without talking!"`

### 1.3 Neutralize Cultural & Setting Clichés
* **Purge "Garage" everywhere**: Ensure no prompt, bio, or fallback refers to a "garage". Characters reside and hang out in lived-in Lucknow apartments, living rooms, rooftop addas, balconies, study spaces, neighborhood parks, and school canteens.
* **Remove "Chai Adda" & "Tea Stall" default anchors** in `src/util/prompts.js` (`PROMPT_LOCATION_MANDATE`):
  ```javascript
  export const PROMPT_LOCATION_MANDATE =
    "<location_diversity_mandate>\n" +
    "  <rule>Ground scenes in varied everyday spaces: living room, balcony, study room, terrace, society badminton court, neighborhood park, library corner, school canteen.</rule>\n" +
    "  <rule>Do not default every break to drinking tea or coffee. Characters should engage in varied activities: board games, science experiments, listening to music, checking out books, drawing comics, playing badminton, or doing homework together.</rule>\n" +
    "</location_diversity_mandate>";
  ```
* **Rename Audio Preset in `src/util/sound.js` & `src/components/SettingsModal.jsx`**:
  * Rename internal preset ID `"coffee"` to `"lounge"`. The UI button remains labeled `"☕ Cozy Lounge"`.

---

## 📁 PHASE 2: LAZY-LOADING & LEGACY MEMORY CLEANUP

### 2.1 Lazy-Load `PresentationView`
* File: `src/App.jsx`
* Action:
  * Remove static import of `PresentationView`.
  * Replace with:
    ```jsx
    const PresentationView = React.lazy(() => import("./components/presentation/PresentationView"));
    ```
  * In `PresentationRoute`, wrap `<PresentationView>` in `<React.Suspense fallback={<div style={{ background: "#070a13", height: "100vh" }} />}>`.
  * Verify `npm run build` splits `PresentationView` into a separate chunk.

### 2.2 Purge Legacy Keyed Memory
* Delete `src/classes/lib/Key.js` and `src/classes/lib/Memory.js`.
* File: `src/classes/ChatMember.js`
  * Remove `this.stateMemory`.
  * Ensure `setTransientState(key, value, durationMs)` updates in-memory flags and emits events without calling IndexedDB (`saveStateMemory`).
  * Remove any remaining references to `Memory.js` in `ChatMember.js`, `World.js`, and `ConversationManager.js`.

---

## 📁 PHASE 3: UNIFIED MEMORY $\le 80$-CHAR CAP & FAST NEEDLE ROUTER

### 3.1 Strict 80-Character Cap in `src/classes/lib/UnifiedMemory.js`
* In `UnifiedMemory.js`:
  ```javascript
  static MAX_RECORD_CHARACTERS = 80;
  static clampRecord(data) {
    const cleaned = String(data || "").trim();
    if (cleaned.length <= UnifiedMemory.MAX_RECORD_CHARACTERS) return cleaned;
    return cleaned.slice(0, UnifiedMemory.MAX_RECORD_CHARACTERS).trim();
  }
  ```
* In `add({ datetime, tags, data, expiry })`:
  * Enforce `data = UnifiedMemory.clampRecord(data)`. Reject empty payloads.
* In `init()`:
  * Clamp any legacy entries loaded from IndexedDB so they never exceed 80 characters.

### 3.2 Synchronous Deterministic NeedleRouter & Priority Scoring
* File: `src/classes/lib/NeedleRouter.js`
  * Ensure `NeedleRouter` runs purely synchronously in microseconds (zero Web Workers, zero Wasm network calls).
  * Word-boundary check for cast names (`\btom\b`, `\bangela\b`, etc.).
  * Stopword filtering for English and Hinglish glue words.
  * Return `{ keywords: string[], member: string }`.
* File: `src/classes/lib/UnifiedMemory.js` in `searchDeterministic(keywords, targetTags)`:
  * **Scoring Rules**:
    * Match on target cast member tag: **+5 points**.
    * Content keyword matches: **+3 points**.
    * `%world%` news items: **+2 points** (only matched if the query contains world/news/weather keywords: `news`, `weather`, `world`, `headline`, `mausam`, `khabar`, `event`, `festival`).
    * **Constraint**: In the top 2 returned memories, **never return more than one `%world%` entry**. Personal cast memories must always take priority over external news.

---

## 📁 PHASE 4: REAL CALENDAR COUNTDOWN & SEEDING THE NEXT 10 EVENTS

### 4.1 Eliminate "Regular Day" with Live Countdowns
* File: `src/util/environment.js` in `fetchCalendarBharatFestivals(date)`:
  * If `todayCelebration` does not match an event for today:
    * Calculate days remaining until the nearest future festival in `dated`:
      ```javascript
      const daysLeft = Math.ceil((future[0].ts - todayStart) / dayMs);
      ```
    * If `daysLeft === 1`: `todayCelebration = `⏳ Tomorrow is ${future[0].name}!``;
    * If `daysLeft > 1`: `todayCelebration = `⏳ ${daysLeft} days left until ${future[0].name}``;
    * If today matches: `todayCelebration = `🎉 Today is ${entry.name}!``;
  * **Never return `"Regular day in Lucknow"`**.

### 4.2 Seed the Next 10 Events into `UnifiedMemory`
* In `src/classes/lib/UnifiedMemory.js` (or via `syncEnvironment` in `World.js`):
  * Extract the next **10 upcoming calendar events** from the parsed Calendar Bharat schedule.
  * Store each event as an episodic record ($\le 80$ chars):
    ```javascript
    const daysLeft = Math.ceil((eventTs - todayStart) / dayMs);
    const data = UnifiedMemory.clampRecord(`In ${daysLeft}d: ${eventName} (${eventDateStr})`);
    await this.add({
      tags: ["%world%", "event", "calendar", ...eventKeywords],
      data,
      expiry: "24h"
    });
    ```
  * Enable the cast to naturally answer when children ask: *"Diwali kab hai?"* or *"Agla festival kaunsa hai?"*.

---

## 📁 PHASE 5: GROQ THINKING BUDGET & DEVTOOLS OBSERVABILITY

### 5.1 Capture Reasoning Tokens in `src/classes/GroqClient.js`
* In `GroqClient.js`, ensure `applyGroqThinking(body)` sets `reasoning_effort: "low"` and tops up `max_tokens` with `GROQ_THINKING_BUDGET_TOKENS` (512).
* In `#executeStream` and `#generateWithFallback`:
  * Parse `usage.completion_tokens_details.reasoning_tokens` from the usage payload.
  * Pass `tokensThinking: usage?.completion_tokens_details?.reasoning_tokens ?? null` into `PromptLogger.record()`.

### 5.2 Record & Display Thinking Tokens in DevTools
* In `src/classes/lib/PromptLogger.js`:
  * Add `tokensThinking: number|null` to `PromptLogEntry`.
* In `src/components/devtools/DevToolsPromptsTab.jsx`:
  * Render a distinct thinking badge alongside `In` and `Out`:
    ```jsx
    {entry.tokensThinking != null && entry.tokensThinking > 0 && (
      <span className={styles.promptThinkingTokenBadge} title={`Thinking Tokens: ${entry.tokensThinking}`}>
        🧠 Think: {entry.tokensThinking} tok (Budget: 512)
      </span>
    )}
    ```

---

## 📁 PHASE 6: MESSAGE AUTO-SPLITTING & INTER-MESSAGE `<delay>` PACING

### 6.1 Prompt Guidelines for Child-Friendly Chat
* In `src/util/prompts.js` (`PROMPT_DIALOGUE_RULES`) and `ConversationManager.registerPrompt()`:
  * Instruct Groq:
    ```markdown
    - Bubble Length: Every <msg> MUST be 1 short sentence (under 65 characters). NEVER output long paragraphs.
    - Splitting: If a character has more to say, break it across 2 to 3 separate <msg> tags with a <delay ms="..."/> under each.
    - Timing: Put <delay ms="1000"/> to <delay ms="2000"/> directly after EACH <msg> tag for natural animated cartoon timing.
    - End of Turn: The final <delay ms="3000"/> to <delay ms="5000"/> or <next time="HH:MM"/> marks the wait until the next turn.
    ```

### 6.2 Programmatic `MessageSplitter` Fallback in `ConversationManager.js`
In `src/classes/ConversationManager.js`:
* Implement `splitMessageText(text)`:
  * If `text.length > 70` or contains multiple sentences (`.`, `!`, `?`), split cleanly on sentence boundaries or punctuation pauses.
  * Ensure no sub-chunk exceeds 70 characters.
* In `handleBanterMessage(sender, reaction, text)`:
  * Run `splitMessageText(text)`.
  * For each chunk, queue a distinct `Message` sharing the same author and emotion.
  * Insert an inter-message delay (e.g. 1000ms–1500ms) between consecutive chunks.

### 6.3 Supporting Inter-Message `<delay>` in Stream Parsing & Timeline
* In `ConversationManager.prototype.onStreamToken`:
  * When `<delay ms="X"/>` is encountered immediately following a `<msg>`, treat `X` as the inter-message pacing gap for the *next* message.
  * Only when `<delay>` or `<next>` is trailing at the end of the full stream buffer does it schedule the *next conversational turn* via `this.scheduleNextRequestWithDelay()`.
* In `src/classes/TimelineProcessor.js`:
  * Update `#processMessage(message, interMessageDelay = 0)` so that `senderTime` is offset by `Math.max(0, interMessageDelay)` before `typingDelay` begins.
  * Bubbles now pop in sequentially with realistic typing animations and pauses.

---

## 📁 PHASE 7: TIMELINE CATCH-UP ON RELOAD

### 7.1 Verify & Solidify `ChatMemberScheduler.js`
* In `ChatMemberScheduler.prototype.executeDue()` and `init()`:
  * For `type === "message"`: Any queued message where `time <= Date.now()` **must be delivered immediately via `this.member.send(event.message)` regardless of how much time has passed**.
  * Never drop past-due messages upon app reload or re-mounting.
  * For visual animations (`typing:start`, `reading:start`) whose timestamps are past, set the visual state to `false` and advance directly to message delivery.

---

## 📁 PHASE 8: SITUATION ENGINE (MEMORY & NEWS MANAGER ONLY)

### 8.1 Scope Refactoring in `src/classes/SituationEngine.js`
* The Situation Engine **does not rewrite the macro scene paragraph** (the macro setting is owned by the Planner's `denseParagraph`).
* Update `SituationEngine`:
  * `ingestNews(newsHeadlines)`:
    * Takes top headlines from `environment.js`.
    * Prompts Gemma to condense headlines into 3 to 5 dense factual memory records ($\le 80$ chars each) tagged with `["%world%", "news", ...]`, expiry `"1h"`.
    * Writes them into `UnifiedMemory`.
  * Dialogue Memory Extraction:
    * Extracts new memories ($\le 80$ chars each).
    * Prunes stale memories using `<deletions><delete index="..."/></deletions>`.

### 8.2 Trigger Synchronization (Zero Collision)
* Trigger 1: Volume trigger runs **immediately when `unreadMessagesCount >= 6` AND resets the 1-minute timer**.
* Trigger 2: 1-minute timer runs periodically **only if `unreadMessagesCount > 0`**.
* Maintain single-flight protection via `this.isProcessing`.

---

## 📁 PHASE 9: HYBRID 24-HOUR PLANNER (TEMPLATES + DELTA GAPS)

### 9.1 Schema & Dual Storage in `src/classes/WorldSetter.js`
* Block Schema:
  ```typescript
  type ScheduleType = "once" | "forever" | "weekdays" | "weekends" | string; // e.g. "2 oct"
  interface ScheduleRecord {
    id: string;
    startHour: number;
    endHour: number;
    timeRange: string;
    title: string;
    denseParagraph: string; // The macro atmospheric scene setting
    type: ScheduleType;
    source?: "delta" | "user" | "demand" | "horizon";
    createdAt: number;
    updatedAt: number;
  }
  ```
* Separate Storage Keys:
  * `world:schedule_templates`: Array of non-`"once"` template blocks (`"forever"`, `"weekdays"`, `"weekends"`, specific dates).
  * `world:schedule_today`: Today's resolved 24-hour timeline.

### 9.2 Resolution Priority Ladder & Delta-Only Generation
* In `resolveTodaySchedule(now = new Date())`:
  1. Priority order: Specific Date (3) > Day Group (`"weekdays"` / `"weekends"`) (2) > Daily Routine (`"forever"`) (1).
  2. Non-destructive replacement: Overriding a template block for today supersedes it on today's timeline, **never deleting it from `world:schedule_templates`**.
  3. Detect empty time gaps in the 24-hour span (0.0 to 24.0).
  4. Call Gemini to generate **Delta Blocks ONLY** for the empty gaps (assigned `type: "once"`, `source: "delta"`).
  5. Contiguity guarantee: Backfill any remaining sub-gaps deterministically so the schedule is always continuous.

### 9.3 Direct Macro Scene Injection
* In `ConversationManager.registerPrompt(builder)`:
  * Pull active block: `activeRecord = this.world.activeSchedule || this.world.worldSetter.getActiveRecord(this.world.now)`.
  * Inject directly:
    ```markdown
    ## Current Scene: ${activeRecord.title} (${activeRecord.timeRange})
    ${activeRecord.denseParagraph}
    ```

### 9.4 Free Reordering & Persona Trigger
* `reorderBlocks(index, direction)` directly swaps blocks, adjusts time ranges, and persists without calling an AI stabilizer.
* Updating any cast member's bio (`ChatMemberEvents.ABOUT`) triggers `WorldSetter.regenerateUpcomingDeltas()`.

### 9.5 UI Styling in `PlannerDrawer.jsx` & `PlannerDrawer.module.css`
* Filter Bar at top: `[All | Today | Templates]` + search input by title.
* Card Styling:
  * `type === "once"`: Muted styling with dotted border (`border: 1.5px dashed var(--border-color)`).
  * Template blocks: Solid bright highlight border with recurrence badge (`[Daily]`, `[Weekdays]`, `[Date]`).

---

## 📁 PHASE 10: DIRECTOR TWIST ENGINE & ACTIVE TWISTS FOOTER RAIL

### 10.1 Cooldown, Max-5 Limit & Gemma Synthesis
* File: `src/classes/ConversationManager.js`
  * State:
    * `directorCooldownUntil = 0` (30s cooldown).
    * `activeDirectives = []` (Max 5 active twists).
    * `endLockUntilTurn = 0` (Locks ending twists for 1 turn).
  * In `injectDirectorPlot(cleanPlot)`:
    * Reject if cooldown active or `activeDirectives.length >= 5`.
    * Arm cooldown: `directorCooldownUntil = Date.now() + 30000`.
    * Abort in-flight Groq stream.
    * Call Gemma with current `denseParagraph`, existing twists, and new directive text.
    * Gemma output schema:
      ```xml
      <twist_analysis>
        <cancellations>
          <cancel id="conflicting-twist-id" />
        </cancellations>
        <plot>
          <title>Short incident title</title>
          <pre_plot>Immediate inciting shock for Turn 1</pre_plot>
          <mid_plot>Ongoing disruption for subsequent turns</mid_plot>
          <post_plot>Resolution / aftermath to conclude the incident</post_plot>
        </plot>
      </twist_analysis>
      ```
    * Apply cancellations and append new twist `{ id, title, prePlot, midPlot, postPlot, status: "pre" }`.
    * Immediately fire a Groq turn with `<pre_plot>`.

### 10.2 Prompt Feeding & Lifecycle Progression
* In `ConversationManager.registerPrompt`:
  * If `status === "pre"`: inject its `<pre_plot>`. (Transitions to `"mid"` after turn completes).
  * If `status === "mid"`: inject its `<mid_plot>`.
  * If `status === "ending"`: inject its `<post_plot>`. (Pruned from `activeDirectives` after turn completes).

### 10.3 Twist Rail UI in `src/components/footer.jsx`
* Above Director input row, render the Active Twists Rail:
  * When 1 twist active: render pill with direct `[✕ End]` button.
  * When >1 twists active: render pills with selection checkboxes + an **`"End Selected"`** button.
  * Clicking "End" sets twist `status = "ending"`, locks ending controls for 1 turn, triggers a turn with `<post_plot>`, and prunes ended twists upon turn completion.
  * Director Send button shows the live 30s countdown: `⏳ 24s`.

---

## 📁 PHASE 11: BEN'S "CARTOON SCIENCE" & "TODAY'S EPISODE" RECAP

### 11.1 Ben's Science Explanations in `src/util/prompts.js`
* In `PROMPT_DIALOGUE_RULES` / character instructions:
  ```markdown
  - Ben's Science Role: Whenever the human user asks 'Why', 'How', or a school science/math question, Ben enthusiastically explains it using funny cartoon analogies (e.g. comparing electricity to flowing water, or gravity to falling fruit) in friendly Lucknow Hinglish. Keep explanations accurate, simple, and exciting for kids!
  ```

### 11.2 "Today's Episode" Comic Card Modal
* In `src/components/Header.jsx`:
  * Add a menu item: **`"🎬 Today's Episode Card"`**.
* Implement a lightweight modal (`EpisodeCardModal.jsx`):
  * **Episode Title**: Derived from the active scene title.
  * **Scene Atmosphere**: Excerpt from the scene's `denseParagraph`.
  * **Star of the Day**: Character with the most messages today.
  * **Festival Countdown**: Badge displaying the live countdown string (e.g. `⏳ 18 days left until Diwali`).
  * **Best Line**: A funny quote from today's chat.

---

## 📁 PHASE 12: VERIFICATION & COMPILATION PASS

1. **Strict TypeScript Check**:
   ```bash
   npx tsc --noEmit
   ```
   Must output **0 errors**.

2. **Run Full Test Suite**:
   ```bash
   npm test
   ```
   Ensure all tests in `tests/classes/`, `tests/components/`, `tests/integration/`, and `tests/util/` pass. Update test fixtures where strings changed.

3. **Production Build & Bundle Verification**:
   ```bash
   npm run build
   ```
   Ensure Vite compiles cleanly, `PresentationView` is code-split into an asynchronous chunk, and no circular dependencies occur.

***
