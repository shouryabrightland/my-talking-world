# MASTER IMPLEMENTATION SPECIFICATION: TOM & FRIENDS REFACTOR & FEATURE HARDENING

You are tasked with refactoring and hardening the codebase for "Tom & Friends" (T&F).
Strict execution requirements:
1. Run `npx tsc --noEmit` and ensure 0 TypeScript errors after changes.
2. Run `npm test` and ensure all tests pass (update tests according to new contracts).
3. Ensure `npm run build` exits with code 0.
4. Commit working changes incrementally per phase.

---

## 🎯 OBJECTIVES & SCOPE OVERVIEW
1. **Housekeeping & Bundle**: Lazy-load the hackathon presentation view via `React.lazy()`; completely purge the "garage" bias across all prompts/presets; remove legacy keyed memory (`Key.js`, `Memory.js`) and transient IndexedDB churning (`stateMemory`).
2. **Unified Memory & Needle**: Enforce a strict 80-character maximum per memory record; replace the Web Worker in `NeedleRouter` with a fast, synchronous deterministic extractor; prioritize character personal memories over `%world%` news items.
3. **Situation Engine (Memory & News Only)**: Refocus `SituationEngine` to handle memory extraction and news summarization only (no macro scene rewriting). Run on a 1-minute timer if `unreadCount > 0`, or immediately when `unreadCount >= 6` (and reset the timer).
4. **Timeline Processor Reload Catch-Up**: Make chat member and user timelines timestamp-resilient so past-due scheduled messages immediately flush into the chat on app load/reload instead of dropping.
5. **Hybrid 24-Hour Planner (Templates + Deltas)**: Implement block recurrence (`"once"`, `"forever"`, `"weekdays"`, `"weekends"`, specific calendar dates) with template resolution priority; generate Gemini deltas ONLY for empty gaps; directly inject the active block's Title and Dense Scene Paragraph into the Groq prompt; free reordering without AI stabilizer; regenerate upcoming deltas on persona edit.
6. **Director Twist Engine & Footer UI**: Implement 30s cooldown; max 5 concurrent active twists; Gemma twist synthesizer returning conflict cancellation and 3 plots (`<pre_plot>`, `<mid_plot>`, `<post_plot>`); multi-twist selection for ending; 1-turn lock on twist ending.

---

## 📁 PHASE 1: HOUSEKEEPING, DE-BIASING & BUNDLE OPTIMIZATION

### 1.1 Lazy-Load Presentation View
* File: `src/App.jsx`
* Action:
  * Remove static import of `PresentationView`.
  * Replace with:
    ```jsx
    const PresentationView = React.lazy(() => import("./components/presentation/PresentationView"));
    ```
  * In `PresentationRoute`, wrap `<PresentationView>` in `<React.Suspense fallback={<div style={{ background: "#070a13", height: "100vh" }} />}>`.
  * Verify `npm run build` splits `PresentationView` into its own dynamic chunk.

### 1.2 Complete Purge of "Garage" Bias
* Action: Search and remove all occurrences of the word `"garage"` across the codebase:
  * `src/util/prompts.js`
  * `src/util/member.js` (bios)
  * `src/util/directorPresets.js` (cues)
  * `src/util/Constants.js`
  * `src/components/SceneBar.jsx`, `src/components/footer.jsx`, `src/components/screens/StudioLobbyScreen.jsx`
  * `src/classes/SituationEngine.js`, `src/classes/WorldSetter.js`, `src/classes/ConversationManager.js`
* Replace "garage" references with varied, natural living spaces in Lucknow (e.g., apartment living room, rooftop adda, balcony, study room, tea stall, local canteen).

### 1.3 Remove Legacy Keyed Memory & Transient IndexedDB Churn
* Files to remove:
  * `src/classes/lib/Key.js`
  * `src/classes/lib/Memory.js`
* File: `src/classes/ChatMember.js`
  * Remove `this.stateMemory`.
  * Make `setTransientState(key, value, durationMs)` purely in-memory (updating local boolean/emotion properties and emitting member events). Remove all IndexedDB calls (`saveStateMemory`).
  * Remove references to `Memory` across `ChatMember.js`, `World.js`, and `ConversationManager.js`.
  * Delete/update unit tests for `Key.js` and `Memory.js` if they fail.

---

## 📁 PHASE 2: UNIFIED MEMORY & SYNCHRONOUS NEEDLE ROUTER

### 2.1 Enforce Strict 80-Character Cap in UnifiedMemory
* File: `src/classes/lib/UnifiedMemory.js`
* Action:
  * Update `add({ datetime, tags, data, expiry })`:
    ```javascript
    const trimmedData = String(data || "").trim();
    if (!trimmedData) return null;
    const cleanData = trimmedData.length > 80 ? trimmedData.slice(0, 80).trim() : trimmedData;
    ```
  * Enforce that all stored entries have `data.length <= 80`.
  * Update `MAX_CHARACTERS` and character count calculations accordingly.

### 2.2 Synchronous Deterministic NeedleRouter
* File: `src/classes/lib/NeedleRouter.js`
* Action:
  * Completely eliminate `Worker` creation and dependency on `needleWorker.js`. (Keep or clean `needleWorker.js` safely).
  * Make `route(userText)` synchronous or return an immediately resolved Promise:
    * Extract candidate members (`tom`, `angela`, `ben`, `ginger`, `hank`, `becca`).
    * Filter out stopwords (English + Hindi/Hinglish glue words).
    * Return `{ keywords: string[], member: string }` within $\le 1\text{ms}$.
  * Update `searchDeterministic(keywords, targetTags)` in `UnifiedMemory.js`:
    * **Priority Scoring**:
      * Tag matches for cast member names (`tom`, `angela`, etc.) get **+5 points**.
      * Content keyword matches get **+3 points**.
      * `%world%` news items get **+2 points** and only match if the query explicitly mentions news/weather/world keywords.
      * **Constraint**: In the top 2 returned memories, never return more than 1 `%world%` news item.

---

## 📁 PHASE 3: TIMELINE CATCH-UP ON RELOAD

### 3.1 Persistent Schedulers & Reload Flush
* File: `src/classes/lib/ChatMemberScheduler.js` and `src/classes/TimelineProcessor.js`
* Action:
  * In `ChatMemberScheduler.prototype.executeDue`:
    * Remove the logic that discards messages when `now - event.time > this.ExpiryThreshold`.
    * For `type === "message"`: If `event.time <= Date.now()`, **immediately deliver the message to `this.member.send(event.message)` regardless of how much time has elapsed**.
    * For transient visual events (`typing:start`, `reading:start`): If the event is in the past, skip the visual delay, set state to false, and immediately advance to the message delivery.
  * In `init()` / `load()`: After loading persisted timeline queues from `Storage`, immediately call `this.executeDue()` to flush any past-due messages that arrived while the user was away or reloading.

---

## 📁 PHASE 4: SITUATION ENGINE (MEMORY & NEWS MANAGER)

### 4.1 Scope Reduction & News Distillation
* File: `src/classes/SituationEngine.js`
* Action:
  * Remove scene paragraph rewriting responsibilities (the macro scene setting is now managed directly by the Planner's `denseParagraph`).
  * Add a dedicated News Distillation method `ingestNews(newsHeadlines)`:
    * Takes top headlines from `environment.js`.
    * Runs a minimal Gemma/Gemini prompt to convert headlines into 3–5 dense factual records ($\le 80$ chars each) tagged with `["%world%", "news", ...]`, expiry `"1h"`.
    * Writes them into `UnifiedMemory`.
  * Update the Dialogue Memory Pass:
    * Prompt analyzes recent dialogue and returns:
      1. `<new_memories>`: list of `<memory tags="..." expiry="...">` where text is strictly $\le 80$ characters.
      2. `<deletions>`: list of `<delete index="..."/>` to prune outdated memories.

### 4.2 Trigger & Timer Synchronization
* Requirements:
  * Runs periodically every **1 minute** IF `unreadMessagesCount > 0`.
  * Runs **immediately** IF `unreadMessagesCount >= 6`.
  * When the volume trigger (`unreadMessagesCount >= 6`) fires, **it must reset the 1-minute timer** so both triggers never collide.
  * Guard with `isProcessing` flag to guarantee single-flight execution.

---

## 📁 PHASE 5: HYBRID 24-HOUR PLANNER (TEMPLATES + DELTAS)

### 5.1 Recurrence Schema & Storage
* File: `src/classes/types/World.types.js` & `src/classes/WorldSetter.js`
* Schedule Record Schema:
  ```typescript
  type ScheduleType = "once" | "forever" | "weekdays" | "weekends" | string; // e.g. "2 oct", "15 aug"
  interface ScheduleRecord {
    id: string;
    startHour: number; // decimal (e.g. 14.5)
    endHour: number;
    timeRange: string;
    title: string;
    denseParagraph: string; // The macro atmospheric scene setting
    type: ScheduleType;
    createdAt: number;
    updatedAt: number;
  }
  ```
* Separate storage:
  * `world:schedule_templates`: Array of non-`"once"` template blocks (`"forever"`, `"weekdays"`, `"weekends"`, specific dates).
  * `world:schedule_today`: Today's resolved 24-hour timeline.

### 5.2 Resolution Priority Ladder & Delta Generation
* Algorithm for `resolveTodaySchedule(now = new Date())`:
  1. Determine today's date string (e.g. `"9 oct"`) and day type (`"weekdays"` vs `"weekends"`).
  2. Filter template blocks from library based on priority:
     * Specific date matches override day group matches.
     * Day group matches override `"forever"` daily matches.
  3. Non-destructive replacement: If a user or director demand overrides a template block for today, the template block remains intact in the template library for future days.
  4. Find empty time gaps in the 24-hour span (0.0 to 24.0).
  5. For any gaps, call Gemini to generate **Delta Blocks ONLY**:
     * Prompt asks Gemini: *"Fill the missing time gap from [start] to [end] with 1-2 plausible scene blocks for Tom & Friends in Lucknow."*
     * Generated gap-filler blocks are assigned `type: "once"`.
  6. Return the sorted, contiguous 24-hour schedule.

### 5.3 Direct Prompt Injection
* File: `src/classes/ConversationManager.js`
* Action in `registerPrompt(builder)`:
  * Resolve `activeSchedule = this.world.activeSchedule` (or `getActiveRecord(this.world.now)`).
  * Inject directly into `## Current Scene`:
    ```markdown
    ## Current Scene: ${activeSchedule.title} (${activeSchedule.timeRange})
    ${activeSchedule.denseParagraph}
    ```
  * Groq dialogue model now has direct, unambiguous awareness of the active macro scene!

### 5.4 Reorder & Persona Change Hooks
* In `WorldSetter.js`:
  * Allow free block reordering without calling any AI stabilizer.
  * When a character's bio (`ABOUT`) is updated in `ChatMember`, trigger re-generation of upcoming delta scenes for today.

### 5.5 Planner Drawer UI Updates
* File: `src/components/PlannerDrawer.jsx` & `PlannerDrawer.module.css`
  * Add visual distinction:
    * Blocks with `type === "once"`: slightly muted background, dotted border (`border: 1.5px dashed var(--border-color)`).
    * Template blocks (`"forever"`, `"weekdays"`, etc.): solid bright highlight border, recurrence pill (`[Daily]`, `[Weekdays]`, `[Date]`).
  * Add a Filter/Search bar at the top: `[All | Today | Templates]` + text search by title.
  * Form inputs when adding/editing: Start time, End time, Title, Dense Scene Paragraph, and Recurrence Type dropdown.

---

## 📁 PHASE 6: DIRECTOR TWIST ENGINE & INCIDENTS FOOTER

### 6.1 State & Cooldown
* File: `src/classes/ConversationManager.js` & `src/contexts/InputBoxContext.jsx`
* State:
  * `activeDirectives = []` (Array of active twist objects, max 5).
  * `directorCooldownUntil = 0` (Epoch timestamp).
  * `endLockUntilTurn = 0` (Locks ending twists for 1 turn after an end operation).

### 6.2 Gemma Twist Synthesizer
* When user inputs a directive in Director Mode:
  1. Check 30-second cooldown: if `Date.now() < directorCooldownUntil`, reject.
  2. Check limit: if `activeDirectives.length >= 5`, reject with alert/notification.
  3. Set `directorCooldownUntil = Date.now() + 30000`.
  4. Call Gemma/Gemini with:
     * Current scene `denseParagraph`.
     * Existing active twists.
     * New directive text.
  5. Gemma returns XML:
     ```xml
     <twist_analysis>
       <cancellations>
         <cancel id="twist-id-to-remove" />
       </cancellations>
       <plot>
         <pre_plot>Immediate shock / inciting action for Turn 1</pre_plot>
         <mid_plot>Ongoing situation / background tension for subsequent turns</mid_plot>
         <post_plot>Resolution / aftermath to conclude the incident</post_plot>
       </plot>
     </twist_analysis>
     ```
  6. Apply cancellations to `activeDirectives`.
  7. Add new twist to `activeDirectives`:
     ```javascript
     {
       id: crypto.randomUUID(),
       title: cleanTitle,
       prePlot,
       midPlot,
       postPlot,
       status: "pre", // transitions to "mid" after turn 1, "ending" on user request
     }
     ```
  8. Immediately abort any in-flight Groq stream and trigger a fresh turn so the cast reacts to the new incident.

### 6.3 Prompt Feeding Logic
* In `ConversationManager.registerPrompt`:
  * If any twist has `status === "pre"`: inject its `<pre_plot>` under `## Active Director Beats`. (After the turn, flip `status = "mid"`).
  * If any twist has `status === "mid"`: inject its `<mid_plot>`.
  * If any twist has `status === "ending"`: inject its `<post_plot>`. (After the turn completes, remove the twist from `activeDirectives` and unlock ending).

### 6.4 Director Footer UI
* File: `src/components/footer.jsx` & `footer.module.css`
  * Add cooldown indicator to Director input (countdown timer on button when active).
  * Above the input row, render the **Active Twists Rail**:
    * If 1 twist active: render pill with direct `[✕ End]` button.
    * If $> 1$ twists active: render pills with selection checkboxes + an **`"End Selected"`** button.
    * When `End` / `End Selected` is tapped:
      * Mark selected twist(s) as `status = "ending"`.
      * Lock ending controls for 1 turn.
      * Immediately trigger a Groq turn with `<post_plot>`.
      * After the turn, prune ended twists from `activeDirectives`.

---

## 📁 PHASE 7: ENVIRONMENT 1-HOUR SCHEDULE & VERIFICATION

### 7.1 Environment Sync
* File: `src/util/environment.js` & `src/classes/World.js`
* Fetch weather, holidays, and top 50 headlines.
* Send to `SituationEngine.ingestNews()` to store condensed $\le 80$-char memories under tag `%world%` with `1h` expiry.
* Set recurring check interval to 1 hour (3600000ms).

### 7.2 Verification Checklist
* Run `npx tsc --noEmit` $\rightarrow$ must be **0 errors**.
* Run `npm test` $\rightarrow$ fix or update tests matching new contracts (ensure all tests pass).
* Run `npm run build` $\rightarrow$ verify successful Vite build and clean bundle splitting.
