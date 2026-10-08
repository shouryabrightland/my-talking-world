# TODO — session checkpoint (handoff)

> Context dump for continuing this task. Read this first after resuming.
> Last updated: 2026-10-08 (mid-session checkpoint requested by user).

## Goal / Definition of done

All three must pass with **zero errors**:

```bash
npx tsc --noEmit      # ✅ 0 errors (was 48; fixed this session)
npm run test          # 6 pre-existing failures remain (see Pending B)
npm run build         # was ✅ before this session; re-verify at the end
```

Commit in stable checkpoints (conventional style), one issue per commit,
footer:
```
🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
```
**User rule: commit after EACH completed issue (rollback safety).**

---

## ✅ Committed this session (in order)

| Commit | Issue |
|---|---|
| `4527103` | `fix(types)`: cleared all 48 pre-existing tsc errors (JSDoc in GroqClient, GroqModelPool, ConversationManager, DevToolsContext). `tsc` now exits 0. |
| `40f1ee1` | `fix(environment)`: **Calendar Bharat API never added events** — live payload nests `{year:{month:{day:{event,type,extras}}}}` but parser expected flat `{month:{YYYY-MM-DD:{name}}}`. Parser now walks all month blocks, parses both key formats, matches today by date, lists only future festivals nearest-first. MSW fixture updated to live shape + `tests/util/environment.test.js` (4 regression tests). |
| `6ea0597` | `fix(memory)`: duplicate React key `india` on Settings→Compress — `syncEnvironment` news tags `["news","india",...words]` duplicated when headline contains "India". Deduped via Set; Settings tag chips keyed `${entry.id}-${tag}`. |
| `aec211e` | `fix(situation)`: double AbortError warning at boot — World READY listener (ConversationManager L211) AND `init()` (L328) both fire the forced situation pass; overlapping passes shared ONE `GeminiClient.abortController` (entry abort killed old fetch → warning1 @line149; old call's `finally{this.abort()}` killed new request → warning2 @line172). Fixed: `executeIfDue` single-flight EVEN when forced; GeminiClient `streamGenerate`/`generateText` only clean up their OWN controller (`if (this.abortController === controller)`). Regression test added. |
| `bcc0539` | `feat(routing)`: app at `/`, presentation at `/presentation` via react-router (`BrowserRouter` in `src/main.jsx`, `Routes` in `src/App.jsx`: `Studio` component = old App body; `PresentationRoute` passes `onFinish → navigate("/")`; `?presentation=true` on `/` redirects; `*` → `/`; `tgf:open-presentation` event → `navigate("/presentation")`). |

---

## 🚧 IN FLIGHT — uncommitted right now

### 1. Presentation rewrite (code complete, tests GREEN, NOT committed)

Files modified/untracked (verify `git status`):
- `src/components/presentation/PresentationView.jsx` — **fully rewritten**: single-phone "bifurcating" scrollytelling, SBS The Boat style.
- `src/components/presentation/PresentationView.module.css` — **fully rewritten** (~880 lines).
- `tests/components/PresentationView.test.jsx` — **rewritten, 10/10 pass** (`npx vitest run tests/components/PresentationView.test.jsx`).

Design (final):
- `PRESENTATION_LAYERS` export (replaces old `PRESENTATION_STATIONS`) — 11 steps:
  1 Studio/intro (role intro), 2 Display, 3 Reality, 4 Director, 5 Memory, 6 Chip,
  7 Engines, 8 Sound, 9 Armor, 10 Cockpit (role layer, `layer: 0..8`), 11 Wheel (role finale).
- ONE sticky stage (`position: sticky; top:0; height:100vh`) with a phone stack of
  **9 slabs** (`slab-0` display … `slab-8` cockpit), caption card left, phone right,
  ghost step code behind. HUD: brand / progress (`--scroll-progress`) / 11 jump dots
  (aria `Step N: Label`) / skip `Enter Live Studio ⏩`. Finale CTA `Enter Live Studio 🚀` in
  `caption-11`.
- Scroll mechanics: scroller `data-testid="presentation-scroll"`, custom prop **`--t` =
  progress × 11** written per frame (no React re-render). Slab k inline transform:
  `translateY(calc(clamp(0, calc(var(--t) - ${k+1}), 1) * (1 - clamp(0, calc(var(--t) - 10), 1)) * ${k} * var(--gap)))`
  → each slab peels during its own step, finale (t∈[10,11]) snaps stack shut.
  Phone `scale(calc(1 - 0.3*clamp(0,(t-1)/9,1)))` so exploded view fits viewport.
- **Jump math**: `scrollTop = (index/11) * scrollable` (NOT scrollIntoView — would
  overshoot by the sticky stage's 100vh). Content = stage 100vh + track 11×100vh.
- Testids: `step-N` (track spacers, data-active/data-past), `caption-N`, `slab-k`.
  Keyboard: Arrow/PageDown/Up, Escape→onFinish. `Sound.playMessagePop()` on jumps.
- Slab mini-widgets (self-explanatory): chat bubbles+typing (Display), weather chips+
  news ticker+24h bar (Reality), +/− diff cards (Director), memory chips+20k gauge,
  Needle chip pulse (Chip), dual key chips+lock (Engines), EQ bars (Sound), shield+
  pills (Armor), gauges (Cockpit).

**Next steps for this item**: run FULL suite + `npx tsc --noEmit` + eslint on the 3 files,
then commit e.g. `feat(presentation): single-phone exploded-layer scrollytelling at /presentation`.
(Vite dev/preview serves SPA history fallback by default, so /presentation deep-link works.)

### 2. Compress Stack bug — "increasing records, not compressing" (ANALYZED, NOT STARTED)

Root-cause analysis (from reading source):
- `SettingsModal.handleCompressStack` → `ConversationManager.compressUnifiedMemory()`
  (events MEMORY_COMPRESS_START/DONE/ERROR) → `UnifiedMemory.compressIfExceeded(gemmaClient)`.
- `compressIfExceeded` (UnifiedMemory.js ~L218): (a) **silently returns false when stack
  < 20,000 chars** → button does nothing, Settings shows ℹ️ (matches "no error visible,
  not compressing at all"); (b) when over budget it **replaces `this.entries` with whatever
  `<memory>` records the model returns** — no guard that output is SMALLER, so a model that
  echoes input (plus the schema example `Consolidated memory entry`) **grows the record count**.

Fix plan (planned, not yet implemented):
- `compressIfExceeded(gemmaClient, force = false)` — manual button passes `force=true`
  (compress regardless of 20k budget); SituationEngine auto-call stays non-forced.
- **Acceptance guard**: build candidates (dedupe by exact `data`, drop literal
  `Consolidated memory entry` example echo); accept ONLY if
  `candidates.length <= beforeCount && candidateChars < beforeChars`
  (computed with the same toTextStack line format) — otherwise keep original, return false,
  log warn "model output not smaller — keeping original stack".
- Prompt: add "Output strictly FEWER <memory> records than input lines — merge aggressively;
  never echo the schema example or input verbatim."
- `ConversationManager.compressUnifiedMemory`: pass `force=true`; capture `wasOver =
  getCharacterCount() >= MAX` BEFORE; if `false && wasOver` → emit MEMORY_COMPRESS_ERROR
  ("Model output was not smaller — original stack kept") + return `"error"` (Settings ❌
  "original stack is untouched"); if `false && !wasOver` → DONE + `"skipped"`.
- `SettingsModal.handleCompressStack`: map `"busy"` → `"skipped"` status too (currently
  busy falls through to "failed" ❌); update skipped text (no longer "under budget" only).
- Tests: existing `tests/classes/UnifiedMemory.test.js` "Gemma compression" block asserts
  boolean contract (L149 false under budget without force; L154 true when 20k +
  mock returns 1 record; L174 false on throw; L185 false on empty text) — first CHECK
  `beforeEach` seeding (L1-60): if only the pushed 20k entry exists, beforeCount=1,
  candidates=1 → `<=` (not `<`) is required for L154 to keep passing.
  **ADD regression test**: model returns MORE/equal-but-larger records → resolves false,
  entries untouched. **ADD force test**: under-budget + force=true → runs.

### 3. SituationEngine deletions — "allow it to delete records, storage only goes up"
(ANALYZED, NOT STARTED)

- Today: `executeIfDue` only ADDS via `<new_memories>`; nothing ever removes (except
  clearExpired/syncEnvironment purge). Plan:
- Before the model call, snapshot: `const snapshot = [...this.unifiedMemory.entries]` and
  include a NUMBERED stack in the prompt:
  `` `${i}: [${e.datetime} | tags: ${e.tags.join(", ")}] ${e.data}` ``.
- Prompt instruction: delete stale/contradicted/trivial entries via
  `<deletions><delete index="N"/></deletions>` (indices refer to the numbered snapshot).
- Output schema section: add `<deletions>` block example.
- After parse: `for (const d of output.matchAll(/<delete\s+index="(\d+)"/gi))` →
  `snapshot[Number(d[1])]` → `await this.unifiedMemory.remove(target.id)` (id-based so
  concurrent adds during the await can't mis-target). Log deleted count.
- Also dedupe ADDS: skip a `<memory>` whose `data` exactly matches an existing entry.
- Tests (`tests/classes/SituationEngine.test.js`): SUCCESS_XML has no deletions → unchanged
  behavior must still pass; ADD test: output with `<deletions index…>` removes the right
  snapshot entries; ADD duplicate-data skip test.
- Commit separately (user wants one issue per commit): e.g.
  `feat(memory): let the SituationEngine delete stale records`.

---

## ⬜ PENDING B — 6 pre-existing failing tests (all baseline, none mine)

Run: `npx vitest run > /tmp/vitest.log 2>&1; grep -a FAIL /tmp/vitest.log`

### `tests/classes/GroqClient.test.js` (5)
1. **"records a PromptLogger card for EACH failed model with its own name and error"** —
   `expected undefined to be defined`. Inspect PromptLogger.record calls when
   `#streamWithFallback` cascades: error-path record (~L430 area, now shifted by JSDoc)
   may emit only once at end instead of per failed model. Decide: fix source or update
   test if behavior intentionally changed.
2. **"filters safeguard & audio models and ranks text chat models by tier"** — expects 6
   models, gets 4. `>=12B` restriction (commits `a29c273`, `9a11fdd`) intentional →
   **update expected list to the 4 survivors** (check `normalizeGroqModels`/
   `prioritizeGroqModels` in `src/classes/lib/GroqModelPool.js`).
3. **"discovers filtered, tier-ranked candidates from GET /models end-to-end"** — expects
   `llama-3.1-8b-instant` (8B); now excluded by ≥12B filter → update fixture/expectation.
4. **"feeds the exact x-ratelimit-reset timing to the pool on 429"** — `reportFailure`
   called with `["openai/gpt-oss-120b", 429, 2500]` expected but args differ — compare
   actual `mock.calls` (likely resetMs null/other). Check `#exactRateLimitResetMs` header
   parsing vs mocked response headers.
5. **"pauses the exact server window from success-path rate-limit headers"** —
   `cooldownRemaining()` got an object instead of number. Test line ~267 — verify intended
   API (`cooldownRemaining` returns `number|null` in source) — maybe test calls a
   wrapper/mocked pool. Read test before changing source.

### `tests/util/apiKeys.test.js` (1)
6. **"should accept a valid key with a single max_tokens:1 generation request"** — fetch hit
   `https://api.groq.com/openai/v1/models` instead of `/chat/completions`. Read
   `verifyApiKey` in `src/util/apiKeys.js` — if verification intentionally changed to a
   `/models` probe, update the test; else it's a source regression (probe should use
   `/chat/completions` with `max_tokens: 1`).

> Rule: fix the **cause**; only update tests when the source behavior is the intended
> new architecture. Don't weaken assertions.

---

## ⬜ Final verification + commits

```bash
npx tsc --noEmit        # ✅ currently 0 — re-check at end
npx eslint .            # repo lint (jsx/main files get "no config" warnings — fine)
npm run test            # target: only tests intentionally updated fail → 0
npm run build           # target: success (exit 0, >500kB warning ok)
```
Commit order going forward: presentation → compress fix → situation deletions →
GroqClient tests → apiKeys test → final todo.md/README touch-ups.

---

## Quick architecture notes

- `conv` = ConversationManager via `useChat()`; `conv.unifiedMemory` is the single memory
  store; `world.unifiedMemory` mirrors it.
- UnifiedMemory entry: `{id, datetime: "YYYY-MM-DD HH:mm", tags: string[], data, expiry}`
  where expiry ∈ `"forever" | "15m" | "1h" | "24h" | "7d" | ISO`; budget 20,000 chars.
- Memory writes: SituationEngine (Tier-2 extraction), Settings manual add, `syncEnvironment`
  (weather/news, replaces env+news tags each time).
- Compression callers: Settings button (`compressUnifiedMemory`) + auto after each
  SituationEngine pass (`compressIfExceeded(this.geminiClient)`).
- Settings tabs: `SettingsTab = "general" | "cast" | "memory"`; compress status strings
  `running|compressed|skipped|failed` (SettingsModal `compressStatusText`).
- Routing: `react-router` v7 (`BrowserRouter` in main.jsx; App exports route table;
  `Studio` = app; `PresentationRoute` at `/presentation`).
- Tests: `vitest.config.js` excludes `tests/e2e/**` and `tests/live/**`;
  `npx tsc` only checks `src/` (tsconfig include).
- Presentation exports `PRESENTATION_LAYERS` (used only by its own tests).

## User decisions this task (do not re-ask)
1. Posture/prop tag dropped as residue; `memory-set` protocol removed; `world.memory` deleted.
2. Dead files `deley.js` + `mocks/browser.js` deleted (commit `7dd725d`).
3. Cast Profiles: AI names locked; human edits own display name.
4. Compress progress shows in the Background Bar (MEMORY_COMPRESS_* events).
5. **Commit after every completed issue** (rollback checkpoints).
6. Presentation: single phone, layers revealed one-by-one ("bifurcating"), SBS The Boat-level
   dynamism, self-explanatory visuals, separate URL route (done via react-router).
7. Old commits contain NO phone visual (only "EXPLODED LAYER" caption tags in the
   pre-`ad275e5` acts version) — the new phone design is original.
