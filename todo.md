

ULTIMATE MASTER SPECIFICATION & PROMPT: TOM & FRIENDS REFACTOR

You are the Principal Systems Engineer executing a comprehensive, zero-error
refactor of the Tom & Friends codebase. Your job is to implement the exact code
modifications specified below.

🛡️ STRICT COMPILATION & VERIFICATION RULES:

1.  Zero Hardcoded Models: Never hardcode specific model strings in runtime
    logic. All models must be dynamically discovered and ranked via
    GroqModelPool and GeminiModelResolver querying the live /models endpoints
    using the user's active API keys.
2.  npx tsc --noEmit must return 0 errors.
3.  npm test must pass 100% of unit and integration tests.

Execute the following 15 tasks across the repository exactly as specified:

TASK 1: The Reload Bug (MessageStore Hydration Fix)

  - File: src/classes/lib/MessageStore.js
  - What to Do: In #validRecord(value), remove the legacy replyId validation
    check entirely (if (value.replyId !== null && !this.#validId(value.replyId))
    { return false; }). This leftover check from the removed reply system causes
    undefined reply IDs to be flagged as corrupt, dropping the entire chat
    history on reload.

TASK 2: Dynamic Model Discovery Enforcement (Zero Hardcoded Models)

  - Files: src/util/config.js, src/classes/lib/GeminiModelResolver.js,
    src/classes/WorldSetter.js
  - What to Do:
    1.  Set DEFAULT_GEMINI_MODEL = "gemini-3.7-flash". Ensure
        GeminiModelResolver.js targets active frontier checkpoints
        (gemini-3.7-flash, gemini-3.5-flash-lite, gemini-3.1-pro,
        gemma-3-27b-it).
    2.  Exclude Pro & Image Models: Update NON_TEXT_MARKERS in apiKeys.js and
        GeminiModelResolver.js to strictly filter out "pro", "image", "imagen",
        and "embed". Pro models burn strict free-tier quotas and must never
        enter the routine candidate pool.
    3.  In WorldSetter.js, strip TOOLS: GOOGLE_SEARCH_TOOL from routine planner
        and demand generation calls (tools: null), eliminating search grounding
        rate limits.

TASK 3: 24-Hour Storyline Planner & Time Boundary Fixes

  - Files: src/classes/WorldSetter.js, src/components/PlannerDrawer.jsx
  - What to Do:
    1.  Fix Midnight Wrap-Around: Redesign #clampHour(h) in WorldSetter.js so
        24.0 remains 24.0 (0.0 <= h <= 24.0).
    2.  Fix Minute Overflow: In formatHour / #formatDecimalRange: if
        floating-point drift yields m === 60, safely increment h by 1 and reset
        m = 0.
    3.  Preserve 24-Hour Day: Remove past-block deletion from ensureSchedule.
        Keep all 24 hours of today in world:schedule_today (00:00 - 24:00). Tag
        past blocks with a status (past | active | upcoming).
    4.  Day Rollover: Bind WorldEvents.DAY_CHANGE in WorldSetter to cleanly
        resolve a fresh day from templates at midnight.
    5.  Consolidated Gap Filling: In resolveTodaySchedule, calculate all missing
        time intervals across today and send them in a single consolidated
        prompt to Gemini rather than looping sequentially per gap.

TASK 4: Reorder, Template & Proposal Diff Fixes

  - Files: src/classes/WorldSetter.js, src/components/PlannerDrawer.jsx
  - What to Do:
    1.  Fix Reorder Cascade: Update reorderBlocks to swap time slots or adjust
        only the affected pair without recalculating and shifting unrelated
        afternoon/evening blocks. Bind reorders strictly to record.id.
    2.  Render Interactive Proposal Diffs (PlannerDrawer.jsx): Implement a
        merged preview list when a proposal is active, rendering existing blocks
        with red − REMOVED indicators alongside newly proposed blocks rendered
        in bright green + PROPOSED at their exact time slots.
    3.  Template Protection: In PlannerDrawer.jsx and WorldSetter.js,
        distinguish between deleting today's instance of a block vs. deleting
        the permanent recurring template rule in storage
        (TEMPLATES_STORAGE_KEY).

TASK 5: On-Demand & Demand Engine Enhancements

  - Files: src/classes/WorldSetter.js, src/components/PlannerDrawer.jsx,
    src/classes/ConversationManager.js
  - What to Do:
    1.  Enrich Demand Prompts: Pass full cast personas, computed ages, and
        current environment context into the demand prompt. Require
        dense_paragraph in the XML output schema.
    2.  Smart Interval Splicing (#mergeDemandSchedule): Wire up
        #mergeDemandSchedule so inserting a demanded activity splits or trims
        only the overlapping time window, preserving the rest of the 24-hour day
        intact.
    3.  Recurrence Parsing: Parse recurrence keywords from user demand text
        (e.g., "daily", "weekdays"). If detected, set type: "forever" or
        "weekdays" and register the block into world:schedule_templates.
    4.  Instant Chat Bridge: If an accepted demand encompasses the current hour,
        update world.activeSchedule immediately and trigger an in-character
        reaction in ConversationManager.

TASK 6: Needle Retrieval, Short-Term Memory & Recency Fallback

  - Files: src/classes/lib/NeedleRouter.js, src/classes/lib/UnifiedMemory.js,
    src/classes/ConversationManager.js, src/classes/SituationEngine.js
  - What to Do:
    1.  Needle Filtering: Change w.length > 3 to w.length > 2 so crucial short
        words (kal, aaj, tea, car, app, bus, key) survive. Expand STOPWORDS to
        include conversational filler (remember, thinking, thought, know, tell,
        said, think, kahan, kaise), and increase MAX_KEYWORDS from 3 to 5.
    2.  Invert Scoring Weights (UnifiedMemory.js): Content keyword match in
        memory text scores +5, keyword match in tag scores +4, and member tag
        match scores +2 (used only as a tie-breaker). A memory must match at
        least one keyword to be eligible. Add basic suffix normalization (-s,
        -es, -ed, -ing).
    3.  Recency Fallback (ConversationManager.js): In #resolveMemorySnippet, if
        Needle yields 0 matches (or if the user query contains recall words like
        "what", "remember", "earlier", "before"), inject the 3 most recent
        non-world entries from unifiedMemory.entries into the prompt as a safety
        net.
    4.  Short-Term Memory Extraction (SituationEngine.js): Update the Gemma
        memory extraction prompt to aggressively capture immediate facts, math
        calculations, and temporary context into <new_memories> with the tag
        %short term% and a 15m expiry.

TASK 7: Chat Generation Prompts & Bubble Lengths

  - Files: src/util/prompts.js, src/classes/ConversationManager.js
  - What to Do:
    1.  Expand Bubble Length: Increase MAX_BUBBLE_CHARACTERS from 70 to 100–140
        characters (WhatsApp/tweet length) to allow natural sitcom banter,
        humor, and punchlines.
    2.  Dynamic Runtime Personas: Strip hardcoded name and age strings out of
        prompt templates (prompts.js). Build prompt character blocks dynamically
        at runtime directly from live ChatMember objects (member.age,
        member.about).
    3.  SceneBar & Prompt Alignment: Inject the exact weather, temperature,
        occasion, active scene topic, denseParagraph, and live news headlines
        displayed on the SceneBar directly into the dialogue prompt. Include ##
        Active Memories explicitly in the Turn Priority hierarchy.

TASK 8: Pacing, Delays & Avatar Presence

  - Files: src/classes/ConversationManager.js, src/classes/ProtocolCodec.js,
    src/components/footer.jsx, src/components/footer.module.css
  - What to Do:
    1.  Seconds-Based Delay Parser: Migrate the prompt contract to seconds:
        <delay sec="2"/>. In the parser: if a model outputs a number < 20, treat
        it as seconds and multiply by 1000 (2\text{s} = 2000\text{ ms}). If it
        outputs > 100, treat it as milliseconds.
    2.  Stable Room Presence: Change active/resting avatar translate state from
        100% (underground) to 40% (resting/present in the lounge) when active in
        the scene. Avatars only sink 100% completely underground when sleeping
        or off-duty.

TASK 9: Background Bar, Model Pool & Twist/Memory Safety

  - Files: src/components/BackgroundBar.jsx,
    src/contexts/BackgroundBarContext.jsx, src/classes/ConversationManager.js,
    src/classes/SituationEngine.js, src/util/environment.js
  - What to Do:
    1.  Background Bar Lifecycle: Keep notification bars active with live
        spinner phases until the background process or stream emits [DONE],
        showing a green checkmark (✅ Done) before auto-dismissing after 3
        seconds. Track all background tasks (24h schedule, Gemma report, news,
        compression). Ensure it handles aborts/interruptions cleanly.
    2.  Twist & Memory Safety:
          - Cap concurrent active director twists to a maximum of 2 in
            ConversationManager.js.
          - In SituationEngine.js, update Gemma memory deletions to delete
            memories by stable Memory ID (id="..."), never by raw array index.
          - In environment.js, clamp festival countdowns to \le 30 days
            (avoiding "180 days until Diwali" in April).

TASK 10: Director Mode & Preset Curation

  - Files: src/util/directorPresets.js, src/classes/ConversationManager.js
  - What to Do:
    1.  Curate Presets: Streamline the preset library down to 25 elite,
        high-impact, funny, child-safe sitcom cues.
    2.  Harden Twist Parser (parseTwistAnalysis): Automatically strip markdown
        fences and <think> blocks before parsing. Make <title> and <mid_plot>
        optional, falling back to the exact directive text if needed so user
        input is never replaced by generic garbage.

TASK 11: Mobile Background Tab Re-Sync

  - Files: src/classes/World.js
  - What to Do:
      - Add a visibilitychange listener to World.js. When
        document.visibilityState === "visible", immediately recalculate this.now
        = new Date(), evaluate if hours or days passed while backgrounded,
        trigger tick(), and flush any past-due scheduler events instantly so
        mobile PWA tabs never freeze simulation time.

TASK 12: Multi-Tab IndexedDB Reconnection

  - Files: src/classes/lib/Storage.js
  - What to Do:
      - Wrap all Storage transaction openings in a self-healing reconnection
        wrapper. If a transaction fails due to a closed database context or
        multi-tab onversionchange conflict, Storage must automatically re-open
        indexedDB.open() transparently instead of throwing unhandled errors.

TASK 13: UTC-Anchored TTLs

  - Files: src/classes/lib/MemoryExpiryParser.js,
    src/classes/lib/UnifiedMemory.js
  - What to Do:
      - Store all memory and schedule expiry boundaries as absolute UTC epoch
        millisecond numbers (number timestamps) rather than loose relative
        string offsets, making them completely immune to local clock shifts and
        timezone travel.

TASK 14: User Input Spam & Flood Protection

  - Files: src/components/footer.jsx, src/classes/ConversationManager.js
  - What to Do:
    1.  In footer.jsx (UserInputBox), disable the message input field and send
        button (disabled={conv.requesting}) while an AI turn is actively
        requesting or streaming.
    2.  Implement a strict 1.5-second submission debounce/cooldown on the send
        button and Enter key after a message is submitted to prevent rapid-fire
        message spam and rate-limit lockouts.

TASK 15: Test Suite Synchronization

  - Files: tests/classes/UnifiedMemory.test.js,
    tests/classes/ConversationManager.test.js,
    tests/classes/NeedleRouter.test.js, tests/classes/WorldSetter.test.js,
    tests/e2e/real-env.spec.js, tests/classes/MessageStore.test.js
  - What to Do:
      - Update test assertions to match the new keyword-first memory scoring (+5
        keyword, +2 tag), 100-140 char bubble split limits, 24-hour day
        preservation, seconds-based delay parsing, and ID-based memory deletion.
      - Update any MessageStore tests to reflect the removed replyId.
      - Run npx tsc --noEmit and npm test to verify 100% pass rate.

