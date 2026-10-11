# SYSTEM-WIDE ARCHITECTURAL REFACTOR & CODE-LEVEL HARDENING SPECIFICATION
# PROJECT: TOM & FRIENDS (AI LIVING SITCOM)

You are the Principal Systems Engineer executing a comprehensive, zero-error refactor of the Tom & Friends codebase. Your job is to implement the code modifications specified below with absolute precision. 

### 🛡️ STRICT COMPILATION & VERIFICATION RULES:
1. **Zero Hardcoded Models:** Never hardcode specific model strings in runtime logic. All models must be dynamically discovered and ranked via `GroqModelPool` and `GeminiModelResolver` querying the live `/models` endpoints using the user's active API keys.
2. `npx tsc --noEmit` must return **0 errors**.
3. `npm test` must pass **100% of unit and integration tests**.

Execute the following code-level instructions across the repository:

---

## TASK 1: Dynamic Model Discovery Enforcement (Zero Hardcoded Models)
- **Files:** `src/util/config.js`, `src/classes/lib/GeminiModelResolver.js`, `src/classes/lib/GroqModelPool.js`
- **What to Do:**
  1. Ensure `DEFAULT_GEMINI_MODEL` and Groq default models act *only* as last-resort fallbacks. Primary resolution must always query `modelPool.getActiveModel()` or `modelPool.getCandidates()`.
  2. Update `NON_TEXT_MARKERS` in `apiKeys.js` and `GeminiModelResolver.js` to strictly filter out `"pro"`, `"image"`, `"imagen"`, and `"embed"`. Pro models and multimodal image models must never enter the routine candidate pool to prevent strict free-tier rate limit (429) lockouts. Retain fast text models (Flash, Flash-Lite, and instruction-tuned Gemma checkpoints discovered dynamically via `/v1beta/models`).
  3. In `WorldSetter.js`, strip `TOOLS: GOOGLE_SEARCH_TOOL` from routine planner and demand generation calls (`tools: null`), eliminating search grounding rate limits.

---

## TASK 2: 24-Hour Storyline Planner & Time Boundary Fixes
- **Files:** `src/classes/WorldSetter.js`, `src/components/PlannerDrawer.jsx`
- **What to Do:**
  1. **Fix Midnight Wrap-Around (`#clampHour`):**
     Redesign `#clampHour(h)` in `WorldSetter.js`:
     ```javascript
     #clampHour(h) {
         if (!Number.isFinite(h)) return 0;
         let clamped = Math.max(0, Math.min(24, h));
         return Math.round(clamped * 2) / 2;
     }
     ```
  2. **Fix Minute Overflow (`14:60` bug):**
     In `#formatDecimalRange` and `PlannerDrawer.jsx`'s `formatHour`:
     ```javascript
     function formatHour(decimal) {
         let h = Math.floor(decimal);
         let m = Math.round((decimal - h) * 60);
         if (m >= 60) { h += 1; m = 0; }
         if (h >= 24) { h = 24; m = 0; }
         return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
     }
     ```
  3. **Preserve 24-Hour Day (No Past Purging):** Remove past-block filtering from `ensureSchedule`. Keep all 24 hours of today in `world:schedule_today` (`00:00 - 24:00`). Tag past blocks with a status (`past | active | upcoming`).
  4. **Day Rollover:** Bind `WorldEvents.DAY_CHANGE` in `WorldSetter` to cleanly resolve a fresh day from templates at midnight.
  5. **Single-Pass Gap Filling:** Consolidate gap filling in `resolveTodaySchedule` into a single Gemini prompt call rather than looping sequentially per gap.

---

## TASK 3: Reorder, Template & Proposal Diff Fixes
- **Files:** `src/classes/WorldSetter.js`, `src/components/PlannerDrawer.jsx`
- **What to Do:**
  1. **Fix Reorder Cascade:** Update `reorderBlocks(index, direction)` to swap time slots or adjust only the affected pair (`index` and `targetIndex`) without recalculating and shifting unrelated afternoon/evening blocks across the entire day. Bind reorders strictly to `record.id`.
  2. **Render Interactive Proposal Diffs (`PlannerDrawer.jsx`):** Implement a merged preview list when a proposal is active, rendering existing blocks with red `− REMOVED` indicators alongside newly proposed blocks rendered in bright green `+ PROPOSED` at their exact time slots.
  3. **Template Protection:** In `PlannerDrawer.jsx` and `WorldSetter.js`, distinguish between deleting *today's instance* of a block vs. deleting the permanent recurring template rule in storage (`TEMPLATES_STORAGE_KEY`).

---

## TASK 4: On-Demand & Demand Engine Enhancements
- **Files:** `src/classes/WorldSetter.js`, `src/components/PlannerDrawer.jsx`, `src/classes/ConversationManager.js`
- **What to Do:**
  1. **Enrich Demand Prompts:** Pass full cast personas, computed ages, and current environment context into the demand prompt. Require `dense_paragraph` in the demand XML output schema.
  2. **Smart Interval Splicing (`#mergeDemandSchedule`):** Wire up `#mergeDemandSchedule` in `WorldSetter.js` so inserting a demanded activity splits or trims *only* the overlapping time window, preserving the rest of the 24-hour day intact.
  3. **Recurrence Parsing:** Parse recurrence keywords from user demand text (e.g., *"daily"*, *"weekdays"*). If detected, set `type: "forever"` or `"weekdays"` and register the block into `world:schedule_templates`.
  4. **Instant Chat Bridge:** If an accepted demand encompasses the current hour, update `world.activeSchedule` immediately and trigger an in-character reaction in `ConversationManager`.

---

## TASK 5: Needle Retrieval & Unified Memory Fixes
- **Files:** `src/classes/lib/NeedleRouter.js`, `src/classes/lib/UnifiedMemory.js`
- **What to Do:**
  1. **Lower Word Length Limit (`NeedleRouter.js`):** Change `w.length > 3` to `w.length > 2` so crucial short words (`kal`, `aaj`, `tea`, `car`, `app`, `bus`, `key`, etc.) survive.
  2. **Expand Stopwords & Increase Cap:** Add conversational filler (`remember`, `thinking`, `thought`, `know`, `tell`, `said`, `think`, `kahan`, `kaise`) to `STOPWORDS`, and increase `MAX_KEYWORDS` from 3 to 5.
  3. **Isolate Query:** Isolate the search query to the user's latest message; only fall back to chat history if the user's message contains zero topical nouns.
  4. **Invert Scoring Weights & Add Suffix Normalization (`UnifiedMemory.js`):**
     - Invert scoring weights: content keyword match in memory text scores **+5**, keyword match in tag scores **+4**, and member tag match scores **+2** (used only as a tie-breaker). A memory must match at least one keyword to be eligible.
     - Add basic suffix normalization (`-s`, `-es`, `-ed`, `-ing`) during comparisons so `"drones"` matches `"drone"` and `"repaired"` matches `"repair"`.

---

## TASK 6: Chat Generation Prompts & Bubble Lengths
- **Files:** `src/util/prompts.js`, `src/classes/ConversationManager.js`
- **Implementation Details:**
  1. **Expand Bubble Length:** Increase `MAX_BUBBLE_CHARACTERS` from 70 to **100–140 characters** (standard WhatsApp/tweet length) to allow natural sitcom banter, humor, and punchlines.
  2. **Dynamic Runtime Personas:** Strip hardcoded name and age strings out of prompt templates (`prompts.js`). Build prompt character blocks dynamically at runtime directly from live `ChatMember` objects (`member.age`, `member.about`).
  3. **SceneBar & Prompt Alignment:** Inject the exact weather, temperature, occasion, active scene topic, `denseParagraph`, and live news headlines displayed on the SceneBar directly into the dialogue prompt.

---

## TASK 7: Pacing, Delays & Avatar Presence
- **Files:** `src/classes/ConversationManager.js`, `src/classes/ProtocolCodec.js`, `src/components/footer.jsx`, `src/components/footer.module.css`
- **Implementation Details:**
  1. **Seconds-Based Delay Parser:** Migrate the prompt contract to seconds: `<delay sec="2"/>` (or `<delay s="3"/>`). In the parser: if a model outputs a number $< 20$, treat it as seconds and multiply by 1000 ($2\text{s} = 2000\text{ ms}$). If it outputs $> 100$, treat it as milliseconds.
  2. **Stable Room Presence:** Change active/resting avatar translate state from `100%` (underground) to **`40%` (resting/present in the lounge)** when active in the scene. Avatars only sink `100%` completely underground when sleeping or off-duty.

---

## TASK 8: Background Bar, Model Pool & Twist/Memory Safety
- **Files:** `src/components/BackgroundBar.jsx`, `src/contexts/BackgroundBarContext.jsx`, `src/classes/ConversationManager.js`, `src/classes/SituationEngine.js`, `src/util/environment.js`
- **Implementation Details:**
  1. **Background Bar Completion Lifecycle:** Keep notification bars active with live spinner phases until the background process or stream emits `[DONE]`, showing a green checkmark (`✅ Done`) before auto-dismissing after 3 seconds. Track all background tasks (24h schedule, Gemma report, news, compression).
  2. **Twist & Memory Safety:**
     - Cap concurrent active director twists to a maximum of **2** in `ConversationManager.js`.
     - In `SituationEngine.js`, update Gemma memory deletions to delete memories by stable **Memory ID** (`id="..."`), never by raw array index.
     - In `environment.js`, clamp festival countdowns to $\le 30$ days (avoiding "180 days until Diwali" in April).

---

## TASK 9: Director Mode & Preset Curation
- **Files:** `src/util/directorPresets.js`, `src/classes/ConversationManager.js`
- **Implementation Details:**
  1. **Curate Presets:** Streamline the preset library down to **25 elite, high-impact, funny, child-safe sitcom cues** (5 per category: Everyday Chaos, Social & Comedy, Adventure & Drama, City Life & Outings, Mystery & Secrets).
  2. **Harden Twist Parser (`parseTwistAnalysis`):** Automatically strip markdown fences and `<think>` blocks before parsing. Make `<title>` and `<mid_plot>` optional, falling back to the exact directive text if needed.

---

## TASK 10: Mobile Background Tab Re-Sync
- **Files:** `src/classes/World.js`
- **Implementation Details:**
  - Add a `visibilitychange` listener to `World.js`. When `document.visibilityState === "visible"`, immediately recalculate `this.now = new Date()`, evaluate if hours or days passed while backgrounded, trigger `tick()`, and flush any past-due scheduler events instantly so mobile PWA tabs never freeze simulation time.

---

## TASK 11: Multi-Tab IndexedDB Reconnection
- **Files:** `src/classes/lib/Storage.js`
- **Implementation Details:**
  - Wrap all `Storage` transaction openings in a self-healing reconnection wrapper. If a transaction fails due to a closed database context or multi-tab `onversionchange` conflict, `Storage` must automatically re-open `indexedDB.open()` transparently instead of throwing unhandled errors.

---

## TASK 12: UTC-Anchored TTLs
- **Files:** `src/classes/lib/MemoryExpiryParser.js`, `src/classes/lib/UnifiedMemory.js`
- **Implementation Details:**
  - Store all memory and schedule expiry boundaries as absolute UTC epoch millisecond numbers (`number` timestamps) rather than loose relative string offsets, making them completely immune to local clock shifts and timezone travel.

---

## TASK 13: User Input Spam & Flood Protection
- **Files:** `src/components/footer.jsx`, `src/classes/ConversationManager.js`
- **Implementation Details:**
  1. In `footer.jsx` (`UserInputBox`), disable the message input field and send button (`disabled={conv.requesting}`) while an AI turn is actively requesting or streaming.
  2. Implement a strict 1.5-second submission debounce/cooldown on the send button and Enter key after a message is submitted to prevent rapid-fire message spam and rate-limit lockouts.

---

## TASK 14: Test Suite Synchronization
- **Files:** `tests/classes/UnifiedMemory.test.js`, `tests/classes/ConversationManager.test.js`, `tests/classes/NeedleRouter.test.js`, `tests/classes/WorldSetter.test.js`
- **Implementation Details:**
  - Update test assertions to match the new keyword-first memory scoring (+5 keyword, +2 tag), 100-140 char bubble split limits, 24-hour day preservation, seconds-based delay parsing, and ID-based memory deletion.
  - Run `npx tsc --noEmit` and `npm test` to verify 100% pass rate.