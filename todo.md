# TODO — Memory/Settings refactor + residue cleanup (handoff)

> Context dump for continuing this task. Read this first after resuming.
> Last updated: 2026-10-08. Session cut short by user — finish items below.

## Goal / Definition of done

All three must pass with **zero errors**:

```bash
npx tsc --noEmit      # currently: 48 pre-existing errors (see Pending A)
npm run test          # currently: 6 pre-existing failures (see Pending B)
npm run build         # not yet verified this session
```

Commit in stable checkpoints (conventional style, e.g. `fix(groq): ...`),
footer:
```
🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
```

---

## Completed (committed as `3a919e5 refactor(memory): replace legacy per-character memory with UnifiedMemory references`)

- **UnifiedMemory** (`src/classes/lib/UnifiedMemory.js`): added
  `getEntriesForMember(memberId)` → filters `entry.tags.includes(memberId.toLowerCase())`.
- **ChatMember**: removed legacy `this.memory` table + `saveMemory()` / `loadMemory()` /
  `clearMemory()`; `stateMemory` (transient visual states) intentionally kept.
- **ConversationManager**: removed `handleMemorySet`/`handleMemoryRemove`,
  `MEMORY_UPDATE` event, `MemoryExpiryParser` import; `reset()` still purges legacy
  `memory:<id>` IndexedDB rows (kept deliberately as data cleanup).
  Added `compressUnifiedMemory()` returning `"compressed"|"skipped"|"error"|"busy"`
  and emitting `MEMORY_COMPRESS_START/DONE/ERROR` (in `ConversationEvents`).
- **ProtocolCodec + Protocol.types**: removed `memory-set` / `memory-remove` record
  parsing, `_parseValue`, `_parseExpiry`, typedefs; `ProtocolRecord` = `MessageProtocolRecord`.
- **prompts.js**: removed all `memory-set`/`memory-remove` dialogue rules; removed dead
  `PROMPT_SCHEDULER_TASK/RULES` (old 4-block horizon prompt — planHorizon owns it inline);
  removed re-exports from `Constants.js`; fixed stale `<saved_memories>` doc comments.
- **World.js**: deleted write-only legacy `world.memory` Memory table (+ `#initializeDefaults`,
  `SIMULATION_TIMEZONE` import, `memory.load()` in init).
- **WorldSetter.applyUserDemand**: now `unifiedMemory.getEntriesForMember(this.world.User.id).map(e => e.data)`.
- **message.jsx**: dropped 🏄 posture/prop bubble tag (+ `.propTag` CSS);
  `CharacterInspectorModal` reads `conv.unifiedMemory.getEntriesForMember(memberId)`
  via `useOptionalChat()`; local `formatUnifiedExpiry()` helper.
- **DevToolsContext**: `characters[].memories` built from
  `conv.unifiedMemory.getEntriesForMember(m.id)`; `formatMemoryExpiry` now parses TTL strings.
- **SettingsModal** rewritten to 3 tabs (see decisions below) + new CSS classes in
  `SettingsModal.module.css` (`lockBadge`, `editableBadge`, `lockedHintText`, `gauge*`,
  `compressBtn`, `compressStatusText`, `tagChip*`, `unifiedItem*`, `memoryTimestamp`,
  `memoryListWide`).
- **DevTools State tab**: Unified Memory card removed (Settings owns that view);
  `unifiedMemory` block + `DevToolsUnifiedMemoryState` typedef removed from
  `DevToolsContext`; `tests/components/DevToolsStateTab.test.jsx` updated.
- **BackgroundBar**: subscribes to `MEMORY_COMPRESS_START/DONE/ERROR` → shows live
  notification (id `unified-memory-compress`) while Settings' **Compress Stack** runs.
- **Tests/mocks migrated** off `member.memory`: ConversationManager mock ChatMember,
  makeMockMember, removed `addWorldMember` + "per-member memory clock (legacy)" describe,
  ProtocolCodec "multiple consecutive records" + new "ignores legacy memory-set" test,
  PromptBuilder memory-set expectation inverted, WorldSetter* / integration /
  BackgroundBar / live-harness `User: { memory }` → `User: { id: "me" }` + world
  `unifiedMemory` stubs.

### Uncommitted at cut-off (verify with `git status`)
- Deleted dead files: `src/util/deley.js`, `src/mocks/browser.js` (+ README tree line).
- This file (`todo.md`).
→ Stage + commit as e.g. `chore(cleanup): drop dead deley util and MSW browser worker`.

### User decisions made this task (do not re-ask)
1. Posture/prop tag → **dropped** as residue.
2. `memory-set` protocol handlers → **removed** entirely (SituationEngine writes memories).
3. Legacy `world.memory` table → **deleted**.
4. Dead files `deley.js` + `mocks/browser.js` → **deleted**.
5. Cast Profiles: **lock AI names only** (badge); birthday/bio/typing-speed stay editable;
   human user edits own display name (messages hold member refs → no history rewrite).
6. Unified Memory card removed from DevTools State tab (Settings has it now).
7. Compress button must show progress in the **Background Bar** (done via events above).

---

## Pending A — `npx tsc --noEmit`: 48 errors (all pre-existing at baseline, none new)

Baseline file saved at session start had the same 48. Fix by adding JSDoc types
(> rewriting logic). `checkJs: true, strict: true`; tests are NOT typechecked.

### 1. `src/classes/GroqClient.js` — 37 errors
`PromptType` typedef already imported (line 19) =
`"dialogue" | "scheduler" | "demand" | "stabilizer" | "situation"`.
`requestMessages` type = `Array<{ role: string, content: string }>` (see PromptLogger).

| Line | Fix |
|---|---|
| 173, 192 | JSDoc on `streamChat(messages, {...})`: `@param {Array<{role: string, content: string}>} messages`; options: `temperature`/`maxTokens`/`maxRetries` number, `model` `string\|null`, `promptType` `PromptType` (fixes TS2322 at 192 too) |
| 213, 230 | same on `generateText` + `jsonMode` boolean |
| 250 | JSDoc on `#streamWithFallback(messages, {temperature, maxTokens, model, activeKey, startTime, promptType, maxRetries})` — typed options object (kills 8 errors) |
| 297 | Fixed automatically once `GroqModelPool.reportFailure` has proper JSDoc (below) |
| 342 | JSDoc on `#generateWithFallback(...)` incl. `jsonMode`; returns `{text, model, thinking, usage}` (kills 8 errors) |
| 441 | JSDoc on `#executeStream(model, messages, temperature, maxTokens, key)` — `string, Array<...>, number, number, string`; returns `{text, usage, finishReason}` |
| 530 | `#getRetryDelay(err, attempt)`: `@param {{status?: number, retryAfter?: string\|number\|null, rateLimitResetMs?: number, name?: string, message?: string}} err`, `@param {number} attempt` → `number\|null` |
| 550 | `#getRetryFromResponse(response /* Response */, attempt /* number */)` → `number\|null` |
| 560 | `#parseRateLimitHeaders(response /* Response */)` |
| 571 | `#exactRateLimitResetMs(response /* Response */)` → `number\|null` |
| 580 | `#exponentialBackoff(attempt, baseMs, maxMs /* numbers */)` → `number` |
| 620 | `#sleep(ms /* number */)` |

### 2. `src/classes/lib/GroqModelPool.js` — 7 errors
Add JSDoc above each:
- L218 `reportFailure(modelId, status = null, resetMs = null)`:
  `@param {string} modelId`, `@param {number|null} [status]`, `@param {number|null} [resetMs]`,
  `@returns {boolean}` — **this also fixes DevToolsContext L355** (ModelPoolReporter
  mismatch: apiKeys.js:502 expects `(modelId: string, status?: number|null) => void`;
  optional 3rd param + boolean→void is assignable).
- L244 `reportSuccess(modelId /* string */)`
- L256 `observeRateLimit(modelId /* string */, rateInfo /* {remainingRequests: string|null, remainingTokens: string|null, resetRequests: string|null, resetTokens: string|null, retryAfter: string|null} */)` → `number|null`
- L282 `cooldownRemaining(modelId /* string */)` → `number|null`
- L348 `isEjected(modelId /* string */)` → boolean
- L420 `#fetchAndCache(apiKey /* string */)`

### 3. `src/classes/ConversationManager.js` — 2 errors
- L224 `injectDirectorPlot(plotText)` → add `@param {string} plotText`.
- L463 `activeSchedule?.setting` → property doesn't exist on `ScheduleRecord`
  **and WorldSetter never parses `<setting>`** (only emits it in the prompt schema).
  This is dead code — change to:
  `location: this.world.environment?.city || "Lucknow Studio",`

### 4. `src/contexts/DevToolsContext.jsx` — 2 errors
- L205 `conv.client?.defaultModel` doesn't exist on GroqClient → delete the
  `|| conv.client?.defaultModel` fallback (leave `conv.client?.activeModel || ""`).
- L355 fixed by GroqModelPool.reportFailure JSDoc above.

---

## Pending B — `npm run test`: 6 failing tests (all pre-existing baseline)

Run: `npx vitest run > /tmp/vitest.log 2>&1; grep -a FAIL /tmp/vitest.log`

### `tests/classes/GroqClient.test.js` (5)
1. **"records a PromptLogger card for EACH failed model with its own name and error"**
   — `expected undefined to be defined`. Inspect PromptLogger.record calls when
   `#streamWithFallback` cascades: the error-path record (GroqClient.js ~L430) may be
   emitted only once at the end instead of per failed model, or `PromptLogger` is mocked
   and a per-model hook changed. Decide: fix source (per-model error card) or update test
   if behavior intentionally changed.
2. **"filters safeguard & audio models and ranks text chat models by tier"** —
   expects 6 models, gets 4. The `>=12B` restriction (commit `a29c273`, `9a11fdd`)
   intentionally drops small models → **update expected list to the 4 survivors**
   (check `normalizeGroqModels`/`prioritizeGroqModels` in `src/classes/lib/GroqModelPool.js`).
3. **"discovers filtered, tier-ranked candidates from GET /models end-to-end"** —
   expects `llama-3.1-8b-instant` (8B) to be included; it's now excluded by the ≥12B
   filter → update fixture/expectation.
4. **"feeds the exact x-ratelimit-reset timing to the pool on 429"** —
   `reportFailure` called with `["openai/gpt-oss-120b", 429, 2500]` expected but args
   differ — compare actual `mock.calls` (likely resetMs null/other value). Check
   `#exactRateLimitResetMs` header parsing vs the mocked response headers in the test.
5. **"pauses the exact server window from success-path rate-limit headers"** —
   `cooldownRemaining()` "received object" → test does `expect(rem).toBeGreaterThan(0)`
   but got an object. Look at test line ~267 (`client.modelPool.cooldownRemaining(...)`);
   possibly returns `snapshot()`-style object now, or the test calls a different method.
   Verify intended API (`cooldownRemaining` returns `number|null` in source) — likely the
   test calls a wrapper/mocked pool. Read test before changing source.

### `tests/util/apiKeys.test.js` (1)
6. **"should accept a valid key with a single max_tokens:1 generation request"** —
   fetch hit `https://api.groq.com/openai/v1/models` instead of `/chat/completions`.
   Read `verifyApiKey` in `src/util/apiKeys.js` — if verification was intentionally
   changed to a `/models` probe, update the test; if not, it's a source regression and
   the probe should use `/chat/completions` with `max_tokens: 1`.

> Rule: fix the **cause**; only update tests when the source behavior is the intended
> new architecture. Don't weaken assertions.

---

## Pending C — final verification + commit

```bash
npx tsc --noEmit        # target: 0 errors
npm run test            # target: all pass
npm run build           # target: success (NOT yet run this session)
npx eslint .            # optional; repo has lint but it wasn't part of acceptance
```
Then commit remaining work in logical checkpoints.

## Quick architecture notes (for Context)

- `conv` = ConversationManager via `useChat()` (`src/contexts/ChatContext.jsx`);
  `conv.unifiedMemory` is the single memory store; `world.unifiedMemory` mirrors it.
- UnifiedMemory entry: `{id, datetime: "YYYY-MM-DD HH:mm", tags: string[], data, expiry}`
  where expiry ∈ `"forever" | "15m" | "1h" | "24h" | "7d" | ISO`; budget 20,000 chars;
  `compressIfExceeded(gemmaClient)` needs `world.worldSetter.geminiClient`.
- Memory writes: `SituationEngine` (Tier-2 extraction) + Settings manual add +
  `syncEnvironment` (weather/news).
- Settings tabs typedef: `SettingsTab = "general" | "cast" | "memory"`.
- Tests: `vitest.config.js` excludes `tests/e2e/**` and `tests/live/**`.
- `npx tsc` only checks `src/` (tsconfig include).
