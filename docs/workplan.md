# Recall — Work plan

**Status:** Draft v0.1 — built from `design.md`, `architecture.md`, `techstack.md` on 2026-09-11
**Owner:** Haz
**Hard deadline:** Oct 23, 2026, 12:00pm PDT · **Target submit:** Oct 20, 2026

Source references use `[D§x]` = design.md, `[A§x]` = architecture.md, `[T§x]` = techstack.md.
Each work item has a week, a priority, and a "done when". Priorities:

- **P0 — core:** the shared core that both demo directions depend on. Build first. [A§9, D§7]
- **MS — must ship:** Tier A items picked for the demo (proposal in §3 — confirm before build).
- **IG — ship if green:** only if the core is green by end of week 4.
- **B — Tier B:** instrumentation on things already being built.
- **C — Tier C:** goes into product feedback / feature requests only; nothing gets built. [D§3.2]

---

## Progress

**W2 (started early, as of 2026-09-11)**

- ✅ Migration `0002`: grants, audit log, household tokens, magic-link sign-in, utterances, job queue, fact embeddings (1024-dim, HNSW), LLM usage metering
- ✅ Per-household MCP bearer tokens (only SHA-256 stored, cached lookup, revoke); owner-only token API; console magic-link sign-in and `/me`
- ✅ Access rules as pure functions in `@recall/core` (caregiver grants, parental access, revocation with capacity flag), with tests
- ✅ Write-time sensitivity screen (card, credential, account and ID numbers; diagnoses) before anything is stored or sent to a model
- ✅ Async extraction: utterance + job → `qwen3:8b` drafts → rules set scope, confidence, sensitivity and expiry → embeddings → LLM judge → reinforce / supersede / insert. Pending statements are recallable at once
- ✅ `speaker_confidence` + `speaker_candidate` (Q5 closed); Bee has no heart-rate export (Q6 closed)
- ✅ Demo seed for both directions (cared-for elder, caregiver living elsewhere, guest, child)
- ✅ 81 tests (unit + e2e on `recall_test` with a scripted LLM); prompt tests pass against the real `qwen3:8b`; live extraction verified on the dev server (8 s)
- ⏳ Entity edge table, retrieval fusion (vector + keyword + graph), consolidation, forget → W3 as planned
- ⏳ Membership management API (grant or revoke caregivers) → with the console in W5; rules and audit table are ready

**W1 (as of 2026-09-11)**

- ✅ Monorepo (pnpm workspaces, TS 5.9 strict, ESM), docs moved to `docs/`, F1–F5 fixed, MIT licence, friction log + feedback started
- ✅ Postgres 16 + pgvector in Docker (localhost:5435); migration `0001_init` (household, person, membership, fact per A§1.2); demo seed
- ✅ NestJS 12 MCP server, stateless Streamable HTTP: `session_brief`, `recall`, `remember`; speaker scoping (unknown → household only + ask); guest mode; dev bearer token; `/health`
- ✅ `LlmProvider`: Ollama `qwen3:8b` (tool calling verified), Bedrock stub, env switch
- ✅ Dockerfile: the container migrates, starts and serves `/mcp` (verified locally)
- ✅ 17 tests passing (unit + end-to-end over HTTP/Postgres); `pnpm smoke`; warm `session_brief` round trip 6–8 ms
- ⏳ Devpost registration + $150 AWS credits request — Haz
- ⏳ Connect Claude Desktop / Claude Code (project `.mcp.json` + README instructions ready)
- ✅ Bee heart-rate export spike: not exposed, so the stream is replayed (Q6 closed)
- ⏳ Confirm the must-ship list (§3); queue and auth defaults applied (decision log); then F6/F7
- ✅ Biome lint/format and GitHub Actions CI (green); repo at github.com/0xhaz/Recall (private: make public and set About before submission)

---

## 0. Calendar

| Week | Dates | Theme |
|---|---|---|
| W1 | Sep 11 – Sep 18 | Admin, repo, skeleton MCP server, local LLM, Claude Desktop hooked up |
| W2 | Sep 19 – Sep 25 | Data model, tenancy, auth, facts, extraction |
| W3 | Sep 26 – Oct 2 | Event log/HLC/sync, speaker scoping, forget, rules, honesty tools |
| W4 | Oct 3 – Oct 9 | Routine miner, context engine, pre-flight/undo, simulator, AWS deploy |
| W5 | Oct 10 – Oct 16 | Console, latency numbers, Agent Skill, direction-specific polish, dry run → **pick the direction** |
| W6 | Oct 17 – Oct 20 | Video, feedback, friction log, submission |
| Buffer | Oct 21 – Oct 23 | Slack only, no new scope |

---

## 1. Scope at a glance

### 1.1 In scope (hackathon) [D§3]
1. Persona memory: per-person facts with provenance, confidence and bi-temporal validity
2. Stated rules as a hard-constraint layer on top of learned memory
3. Routine learning from the cross-device event log
4. Context engine (workout, wind-down first; party/festive/focus as time allows) driving music
5. Cross-device sync: append-only log, HLC, cursors, tombstones, snapshots
6. Privacy and control: explain, edit, forget, sensitivity filter, TTLs, retention, export
7. Honesty mechanisms: state-of-record, session history, temporal stamp, confidence gating, pre-flight, undo
8. Care mode + caregiver view (Direction B)
9. MCP server (Streamable HTTP) + Agent Skill packaging
10. Next.js console + simulated Alexa+ web app
11. Multi-tenant model (household = tenant) with a self-hosted option
12. AWS deployment (AgentCore Runtime + Bedrock)

### 1.2 Out of scope [D§3]
Real Voice ID, real Echo device access, production multi-tenant billing, full smart-home command routing, graph DB, OAuth for Alexa+, pricing tiers, clinical review of phrasing (all deferred [D§11]).

### 1.3 Tier C — feedback only, never built [D§3.2, D§3.3]
Deterministic smart-home routing, companion app rebuild, pricing/ads, Kindle Assistive Reader regression (severity high), honesty about reverting from Alexa+, false wake, lost legacy features (breathing exercises), small-model routing, local device execution, streaming TTS, late "Timer started" announce [A§7.1].

---

## 2. Before we start: doc fixes and open decisions

### 2.1 Inconsistencies to fix in the docs (do this first, 30 min)

| # | Issue | Where | Proposed fix |
|---|---|---|---|
| F1 ✅ | Companion links point to `techstack.md`; the file was `techstack-recall.md` | D header, A header, A§7.1, T§2 | Rename the file to `techstack.md` (matches the repo layout in T§2) |
| F2 ✅ | Rule precedence differs. D§4.3: stated rule → caregiver rule → learned → default. A§1.5 (after Q1 closed): caregiver `safety` rule → person's rule → other caregiver rule → learned → default | D§4.3 vs A§1.5 | Update D§4.3 to match A§1.5 (A is the later decision) |
| F3 ✅ | Care mode described as "a per-person profile flag set by a designated caregiver", but Q3 closed as a membership role `cared_for` granted per household by the **owner** | D§5 intro vs A§1.3, D§9, D§11 Q3 | Reword D§5 intro to match the membership-role model |
| F4 ✅ | Read-path latency: A§7.1 says "< 100 ms server-side" for `recall`; T§5 and D§3.2 say `recall` < 300 ms p95 | A§7.1 vs T§5 | Treat T§5 as the enforced budget; keep 100 ms as the aspirational server-side target and say so in A§7.1 |
| F5 ✅ | The temporal stamp list in D§3.3 omits `session_brief`; A§5 includes it | D§3.3 | Add `session_brief` |
| F6 | The six-week plan [D§10] has no slot for: stated rules, `session_history`, `device_state`, `resolve_speaker`, `checkin`, care mode/caregiver view, snapshot/compaction worker, sensitivity filter DDL, `communication_style` rules | D§10 | This work plan gives each one a week (§5). Update D§10 after this plan is agreed |
| F7 | The scope-discipline step ("mark ~6 Tier A items must-ship") has not been done yet | D§10 | Proposal in §3 below; record the decision in A§10 |

### 2.2 Open questions and when each must be closed [D§11]

| # | Question | Close by | Blocks | Default if nobody decides |
|---|---|---|---|---|
| Q5 ✅ | Speaker resolution in the simulator: explicit `speaker_id` or confidence faked from a hint | End of W2 (earlier than the doc's W3, because `resolve_speaker` shape affects `session_brief`) | WS5, WS12 | Closed 2026-09-11: explicit `speaker` + optional `speaker_confidence`; below 0.7 → unknown, household only, `speaker_candidate` to confirm |
| Q6 ✅ | Can Bee CLI/MCP export Apple Watch HR at useful granularity? | W1 spike, final answer W3 | WS9 real-data claim | Closed 2026-09-11: not exposed. Recorded stream only; no "real Bee data" claim in the video. Bee utterance/location events are an optional second signal |
| Q7 | Routines write-back: offers only, or also create real Alexa+ Routines? | W3 | WS8 | Offers only |
| Q8 | Music metadata: real provider or a mocked catalogue labelled honestly | W3 | WS9 | Mocked catalogue with tempo/energy fields, labelled in the UI and the video |
| Q9 | Demo direction A vs B | W5 dry run | WS18 | — (scheduled) |
| Q10 | Opener: forgotten recipe vs `explain_memory` "no uncle" beat | W5 | WS18 | — (scheduled) |
| New ✅ | Job queue: BullMQ + Redis vs Postgres-backed queue [T§1] | W1 | WS13 | Default applied: Postgres-backed queue (one less container; Redis only if sync demo needs it) |
| New ✅ | Local model: Qwen3 8B vs Gemma 4, Ollama vs MLX [T§3] | W1 | WS13 | Ollama + Qwen3 8B, non-think mode; `qwen3-embedding:0.6b` for embeddings |
| New ✅ | Auth: magic link vs passkeys [T§1, D§9] | W2 | WS1 | Default applied: magic link |

Each closed question gets a line in the decision log [A§10].

---

## 3. Must-ship vs ship-if-green (proposal — confirm before build)

Tier A has 12 items [D§3.2, D§3.3]. D§10 asks for about 6 must-ships. Proposal:

| Tier A item | Proposed | Why |
|---|---|---|
| State-of-record: `device_state` + `session_history` | **MS** | Already part of the shared core; answers the most-voted community failure |
| Temporal stamp on every response | **MS** | Cheap (one middleware); fixes the "tonight = yesterday" failure |
| Confidence-gated answers (`verify_claim`) | **MS** | The main anti-hallucination lever; reuses retrieval |
| Action pre-flight + undo | **MS** | Closing demo beat; answers the loudest complaint [D§7] |
| Provenance-gated proactivity + never-initiate list | **MS** | Required for care mode to be safe; it's a filter on `propose_action` |
| Quiet hours | **MS** | Falls out of the wind-down context; used in both directions |
| Check-in routine (`checkin` + absence detection) | **MS if B is still live**, otherwise IG | Direction B depends on it; absence detection shares the miner |
| Tone dial (`communication_style`) | IG | It's just a fact plus an instruction in `session_brief`; cheap but not demo-critical |
| Tone rule (no emotion-labelling) | IG | Extends the tone dial |
| Response budget per intent class | IG | Extends the tone dial |

Tier B (regression guard, latency budgets, household transparency, retention/export, repeat detector, intent aliases): build the instrumentation as the underlying pieces land. Latency numbers and the repeat detector (needed for care-mode inversion) should be treated as **MS**.

---

## 4. Workstreams

Checkboxes are the tasks. "Done when" is the acceptance test.

### WS0 — Admin, repo, hackathon hygiene (W1, P0)
- [ ] Register on Devpost; request the $150 AWS credits [D§10]
- [ ] Read the MCP Streamable HTTP transport spec, Agent Skills docs, Amazon Devices Builder Tools [T§6]
- [x] Create a pnpm workspaces monorepo following T§2 — `apps/mcp-server`, `packages/{core,llm}`, `docker/`, `docs/` exist; `apps/console`, `packages/{miner,context,skill}`, `scripts/{replay,seed}` get added in the week they start
- [x] Node 22, TypeScript strict, lint/format, CI (typecheck + tests + latency checks later)
- [ ] MIT licence; set the public GitHub repo's About [T§1, T§7]
- [x] Move `design.md`, `architecture.md`, `techstack.md`, `workplan.md` into `docs/`
- [x] Create `docs/friction-log.md` (task, steps, expected vs actual, severity, workaround, suggestion) and `docs/feedback.md`; **log from day one** [D§8, T§7]
- [x] 12-factor env config: `DATABASE_URL`, `LLM_PROVIDER`, `AWS_REGION`, `HOUSEHOLD_TOKEN_SECRET` [T§3]
- [ ] Apply doc fixes F1–F7 (§2.1) — F1–F5 done 2026-09-11; F6, F7 wait on the must-ship confirmation

**Done when:** a fresh clone runs `docker compose up` and `pnpm dev`, and the friction log has its first entry.

### WS1 — Data model, tenancy, identity, auth (W2, P0)
- [x] `household_id` + `region` on every household-owned table; every query filters on `household_id` (enforce with a repository layer or Postgres RLS) [A§1.2, D§9] — repository layer
- [x] `person` (global, no `household_id`) + `membership {household_id, person_id, role, granted_by, granted_at, revoked_at, capacity_flag}`; roles: owner, adult, child, guest, caregiver, cared_for [A§1.3]
- [x] Caregiver grants per membership: `edit_care_plan`, `view_daily`, `enter_facts`, `set_rules` (default on), `view_full_memory` (opt-in); never other members' memory [A§1.3] — `@recall/core` access rules
- [ ] Revocation rules: owner always; cared-for person unless `capacity_flag` is set (flag visible to the person + logged) [A§1.3] — rules and tests done; API with the console (W5)
- [ ] Audit log for membership, role and grant changes — table done, token and sign-in changes logged; membership changes get logged when their API lands (W5)
- [x] Magic-link auth for the console; per-household bearer token on the MCP endpoint [D§9, T§1]
- [ ] Guest = ephemeral (store nothing by default); child = minimal retention + parental deletion [A§1.3] — guest ✓, child facts expire within 30 days ✓; parental deletion needs the forget path (W3)
- [x] Usage metering on LLM calls per household (free-tier protection) [D§9]
- [x] Migrations + seed script for the demo household (two adults, a child, a guest, a cared-for elder, a caregiver in another household) [T§2 `scripts/seed`] — in `src/db/seed.ts` for now; moves to `scripts/seed` with the replay scripts

**Done when:** an integration test shows household A's token cannot read household B's data through any tool, and a caregiver can't read another member's facts. ✅ Met 2026-09-11 (`auth.e2e`, `access.test`).

### WS2 — Event log, HLC, sync, retention (W3, P0)
- [ ] Event shape `{event_id, household_id, hlc, device_id, person_id, person_confidence, location, kind, payload}` [A§2]
- [ ] HLC implementation in `packages/core` (wall time + counter + device id; tie-break on device id) [A§4]
- [ ] `ingest_events`: idempotent batch append, dedupe on UUID [A§4, A§6]
- [ ] Projections rebuilt by workers, never hand-merged: facts, rules, routines, context scores, session/state, sync cursors [A§7]
- [ ] Conflict semantics: LWW register (by HLC) for single-valued prefs; add/remove set for set-valued facts [A§4]
- [ ] Tombstone events for `forget`, `undo`, `remove_rule` [A§4]
- [ ] `sync(device, cursor)` → `{mode: replay | snapshot}`; per-device cursors; light SSE endpoint [A§4, A§4.1]
- [ ] Sessions: `session.open/turn/close` with TTL in minutes; a device joining mid-session continues it [A§4]
- [ ] Nightly snapshot worker records `snapshot_hlc` [A§4.1]
- [ ] Compaction: delete events older than retention **and** the latest snapshot; retention 90 days default (30–365 configurable), **7 days in the hackathon build** [A§4.1]
- [ ] Tombstones kept retention + 30 days; sensitive raw events 7 days; zero-membership persons purged after 30 days [A§4.1]

**Done when:** a two-device replay test converges to identical projections; a stale device replaying old events can't bring back a forgotten fact; a device with a cursor older than retention gets `mode: snapshot`.

### WS3 — Persona memory (W2–W3, P0)
- [x] Fact record exactly as in A§1.2 (scope, type, entities, source with speaker confidence, bi-temporal validity, confidence, sensitivity tag, TTL, `superseded_by`)
- [x] Bi-temporal supersession: never delete on update; "true now" is a filter [A§1.2]
- [x] Stable vs transient: durable traits have no TTL; transient context gets a TTL and expires [A§1.2] — end words resolved by `resolveEnd()`
- [x] Calibrated claims: one mention ≠ a trait; generalise only after it recurs [A§1.2] — 0.5 per mention, +0.1 per recurrence
- [x] Sensitivity classifier at write time; blocked categories never stored (passwords, card/account numbers, raw HR, diagnoses, non-consenting third parties) [A§1.2, D§4.2] — deterministic screen; third parties are skipped by the prompt only
- [x] Extraction worker via `LlmProvider`: single-pass salient facts → dedupe → supersede; runs async after `remember` acks [A§1.4]
- [ ] pgvector embeddings + keyword index + entity edge table [A§1.4] — embeddings ✓, keyword index ✓; entity edges → W3
- [ ] Retrieval: fuse vector + keyword + graph hops → rerank → top-k compact results [A§1.4]
- [x] Speaker scoping: below the confidence threshold, return household-scoped facts only and ask who's speaking [A§1.3]
- [ ] Preference conflicts: household rule → speaker identity → ask; never favour the owner [A§1.3]
- [ ] Consolidation worker: merge duplicates, expire TTLs, decay unused facts; per-person size budget → "review these" prompt, not silent pruning [A§1.4]
- [ ] Forget: by fact id or topic → tombstone, close `valid_to`; "forget me" cascades across all memberships [A§1.3]
- [ ] `communication_style` fact (terse / warm / no jokes / no emotional language) — IG [D§3.2 #6]
- [ ] Intent aliases as per-person facts learned from successful invocations — B [D§3.3]
- [ ] Temporary-chat mode: neither reads nor writes [D§4.2]

**Done when:** two family members get different, correct answers to "what should we cook tonight?"; a guest gets household-only; "forget that I'm on a diet" sets `valid_to` and the fact drops out of every retrieval.

### WS4 — Stated rules (W3 storage, W4 enforcement, P0)
- [ ] Rule record as in A§1.5 (verbatim text + structured `condition`, `effect` ∈ block/require_confirm/prefer/suppress_offer, `severity` ∈ safety/hard/soft, `expires_at`, tombstone)
- [ ] `severity = safety` only allowed for caregiver rules on `cared_for` members
- [ ] Precedence engine: caregiver safety → person's rule → other caregiver rule → learned → default [A§1.5]
- [ ] NL → structured rule parsing via LLM, with the verbatim text always kept
- [ ] Rules can tag/exclude learned facts (e.g. "never peanuts" filters recipe recall) [A§1.5]
- [ ] Conflict detection: rule vs rule, rule vs routine → conflict item with a plain-language explanation; never silently resolved [A§1.5]
- [ ] Enforcement inside `propose_action` and `action_preflight` → `blocked_by: {rule_id, text}`; device-state rules verified afterwards via `device_state` [A§1.5]
- [ ] "Want me to make that a rule?" offer after repeated manual corrections (IG)

**Done when:** "no music after 10pm on school nights" suppresses a learned 10:30pm music routine in a replayed scenario, and zero rule violations show up across all replay tests [A§8].

### WS5 — MCP server and tool surface (W1 skeleton → W4 complete, P0)
NestJS, MCP spec 2025-11-25+, Streamable HTTP; the repo must actually call MCP in code [T§1, T§7].

| Tool | Week | Priority | Notes |
|---|---|---|---|
| `session_brief` | W1 stub → W3 full | P0 | Default first call: top facts, rules, context scores, quiet-hours flag, device state, temporal stamp [A§6] |
| `remember` | W1 | P0 | Ack < 100 ms; async extraction |
| `recall` | W1 stub → W3 scoped | P0 | Ranked, with provenance; household-only when confidence is low |
| `resolve_speaker` | W3 | P0 | Simulated Voice ID; warms the cache [A§7.1] |
| `forget` | W3 | P0 | Tombstone |
| `explain_memory` | W3 | P0 | Human-readable; the main spoken feature in care mode |
| `ingest_events` | W3 | P0 | Idempotent, HLC |
| `sync` | W3 | P0 | replay/snapshot |
| `session_history` | W3 | P0 / MS | Actual turn log |
| `device_state` | W3 | P0 / MS | Only source for state answers |
| `verify_claim` | W3 | MS | Fact + source + validity, or "unknown, ask" |
| `set_rule` / `list_rules` / `remove_rule` | W3 | P0 | Verbatim, with author and date |
| `get_context` | W4 | P0 | Scores + active routines |
| `propose_action` | W4 | P0 | Offer-first with rationale; `blocked_by`; provenance-gated |
| `action_preflight` | W4 | MS | Memory, rules, quiet hours, order history |
| `undo` | W4 | MS | Within the undo window; tombstone on the action event |
| `checkin` | W4 | MS if B | Logs event, messages the household |

- [ ] Temporal stamp middleware (device local date/time/timezone) on `session_brief`, `recall`, `get_context`, `propose_action`; timers/alarms include the actual start timestamp [A§5]
- [ ] Tool descriptions tuned against Claude Desktop so the model reliably calls `session_brief` first [T§3]
- [ ] Streaming: send the deterministic parts first (state, rules, hot facts), enrichment after [A§7.1]
- [ ] Bearer-token guard per household

**Done when:** Claude Desktop, connected over Streamable HTTP, completes every demo scenario using real tool calls.

### WS6 — Honesty mechanisms (W3–W4, MS)
- [ ] State-of-record: every "turn X off" is re-read from `device_state` after the change [A§5]
- [ ] Assert in tests that `session_history` / `device_state` are consulted before any state claim [A§8]
- [ ] Repeat detector on the session projection: the same answer N times → abstain + offer an alternative; **inverted in care mode** (answer consistently) [A§5, D§5]
- [ ] Undo log: every action through Recall gets an undo handle with a window [D§3.2 #3]
- [ ] Pre-flight checks: known addresses, venues used before, routine conflicts, order history, quiet hours → "confirm these N things" payload [D§3.2 #2]

### WS7 — Behaviour policy (W4, MS/IG)
- [ ] Tiered proactivity: inform → suggest → draft → act; only high-confidence, low-risk actions run autonomously; everything autonomous can be undone [D§4.1]
- [ ] Per-person accept/dismiss feeds thresholds [D§4.1]
- [ ] Provenance gate: no proactive utterance without a source record visible in the console [A§1.2, D§3.3]
- [ ] Never-initiate list: health, bereavement, financial, third-party, child → answer-only [D§3.3]
- [ ] Quiet hours: wind-down/sleep hard-suppresses proactive output; unsolicited purchase/delivery notices must pass pre-flight against order history [D§3.3]
- [ ] Tone rule and response budget per intent class (transactional → confirmation word only) — IG [D§3.3]

### WS8 — Routine miner (W4, P0)
- [ ] Bucket per person × day-of-week × 15-min bin; DBSCAN/KDE over time of day [A§2]
- [ ] PrefixSpan-style sequence mining over each day's ordered events [A§2]
- [ ] Support, confidence, `last_seen`, decay; drift detection (recent vs long window) [A§2]
- [ ] Exceptions as conditions: weekday/weekend, Malaysian public holidays, travel [A§2]
- [ ] Lifecycle: candidate → offered → active → retired; first occurrence is an offer [A§2]
- [ ] Regression guard: "stopped doing it" vs "action started failing" → broken-routine flag in the console + friction log — B [A§2]
- [ ] Absence detection for check-in routines: prompt the person first, then escalate; never auto-send [A§2]
- [ ] Per-person baselines feed context thresholds [A§3]

**Done when:** a replayed 3-week event stream produces "coffee 07:10 ± 12 min weekdays" and a morning chain, and holidays don't count as misses.

### WS9 — Context engine + music policy (W4 engine, W5 music polish, P0)
- [ ] Context scores 0..1 from weighted signals with per-person weights; several can be live at once [A§3]
- [ ] Workout and wind-down first (the demo contexts); party, festive, focus if green [A§10]
- [ ] Debounce (threshold + hold window), exit conditions, manual override that also teaches [A§3]
- [ ] Relative thresholds from the miner's baselines; **store derived context only, never raw HR** [A§3]
- [ ] Scores as a worker-recomputed projection so every device sees the same value [A§3]
- [ ] Quiet-hours flag from wind-down/sleep
- [ ] Music policy: seed → context-tagged learning (skips are per context) → ranking (fit × affinity × recency) → household blend for shared contexts → offer first, auto-start after 2 accepts; party/festive stay ask-first; rules suppress [A§3.1]
- [ ] Music catalogue per Q8 (mocked + labelled by default)
- [ ] Bee HR bridge (optional) per Q6; recorded HR stream otherwise

**Done when:** replaying an HR stream pushes the workout score over threshold → running-mix offer; at 11pm the wind-down playlist is proposed instead; a "no music after 10pm" rule blocks it.

### WS10 — Care mode and check-in (W4 core, W5 polish; MS if Direction B is live)
- [ ] Inversions keyed off `membership.role = cared_for` for the requesting household [A§1.3]
- [ ] Repeat handling inverted: consistent, warm, never "I already told you" [D§5]
- [ ] Absolute provenance: only caregiver-entered/confirmed facts get stated; no inference about people or events [D§5]
- [ ] Correction/redirect policy as caregiver rules: correct for safety (stove, door, medication), redirect on reality-orientation topics [D§5]
- [ ] Orientation routine (date/time/weather/plan/visitors); medication and meal reminders with spoken confirmation logged for the caregiver [D§5]
- [ ] Sundowning → wind-down context [D§5]
- [ ] Presence escalation: door/motion at unusual hours → caregiver alert [D§5]
- [ ] Plain statement to the person of what is shared ("your daughter can see your reminders") [D§5]
- [ ] **No diagnosis stored**; not a medical device; document the never-initiate-on-health rule so nobody "fixes" it later [D§5]
- [ ] Check-in: "Good morning/Good night" → family group message; absence by the usual time → gentle prompt → escalation [D§3.3]

### WS11 — Console (Next.js) (W5, P0 for the demo moments)
Hackathon scope [D§6]:
- [ ] Memory browser: source, date, confidence, scope; edit / delete / mark wrong; filters
- [ ] "What do you know about me" page (same content as the voice answer)
- [ ] Rules manager: add/edit/expire/remove, conflicts explained, blocked-action log
- [ ] Routines review: candidates accept/dismiss, active/retired, broken-routine flags
- [ ] Household transparency: members, scopes, guest/child settings (basic) — B
- [ ] Retention and export: retention window, delete by item/day/range, JSON export, temporary-mode toggle — B
- [ ] Action history and undo (basic)
- [ ] Chat with your memory (the simulator doubles as this)
- [ ] Context dashboard: live scores, contributing signals, adjustable thresholds, **p50/p95 per tool**
- [ ] Sources and devices: connect/disconnect, last sync per device (basic)

Caregiver view (Direction B):
- [ ] Care plan editor · daily view · alerts with adjustable delay · shared-view statement

Not a general chatbot. Must-show moments: fixing a wrong fact, a rule blocking an action, a caregiver catching a missed reminder [D§7].

### WS12 — Simulated Alexa+, devices, replay (W4, P0)
- [ ] Simulated Alexa+ web app: browser speech in/out, speaker picker (per Q5), talks to Recall only via MCP [A§9]
- [ ] Two simulated devices side by side for the forget-propagation beat
- [ ] Simulated Ring / Fire TV / coffee machine / lights event producers
- [ ] Replay scripts: heart rate, door, check-in, playback, morning routine (JSON streams with fake device ids + HLC) [T§2]
- [ ] Demo seed data for both directions
- [ ] Simulator source included in the repo [T§7]

### WS13 — LLM provider and workers (W1 local → W4 Bedrock, P0)
- [ ] `LlmProvider` interface + adapters: Ollama/MLX (local), Anthropic API, Bedrock (Nova Lite for extraction; Claude on Bedrock for pre-flight/propose if budget allows) [T§1, T§4] — interface + Ollama ✓ (chat and embeddings); Bedrock stubbed
- [ ] Bedrock adapter written and documented early; switching is one env var [T§3] — env switch ✓; Converse and Titan calls when credits land
- [ ] Job queue (per the decision in §2.2) and stateless workers: extractor, consolidator, pre-flight checker, explainer, rule parser. One orchestrator; workers hold no memory and don't talk to each other [A§7] — Postgres queue ✓, extractor + judge ✓; the rest as their features land
- [x] Keep the LLM off the read path entirely [A§7.1] — `recall` and `session_brief` are SQL only

### WS14 — AWS deployment (W4 first deploy, W6 final, P0)
- [x] Dockerfile for the server from W1 [T§3]
- [ ] AgentCore Runtime deployment; keep instances warm [T§4]
- [ ] RDS or containerised Postgres; persistent pool [T§4]
- [ ] Region co-located with the Alexa+ endpoint (us-east-1); simulator co-located for the video [T§4]
- [ ] Re-run the replay scripts on AWS; log p95 regressions in the friction log [T§4]
- [ ] Document the Bedrock/AgentCore integration (AWS Builder mini challenge) [T§4]
- [ ] Optional: Strands SDK for the orchestrator + worker pattern [T§4]
- [ ] Guard the credits: dev iteration stays local; Bedrock only for the final week and the video [T§3]

### WS15 — Latency (instrument from W3, publish W5, MS)
Budgets [T§5]: `session_brief` < 400 ms p95 · `recall` < 300 ms p95 · `get_context`, `device_state`, `list_rules`, `session_history` < 100 ms p95 · `remember` ack < 100 ms.
- [ ] Per-tool timing middleware; p50/p95 histograms
- [ ] Hot-fact and context caches; warm on `resolve_speaker`; prefetch from the active routine [A§7.1]
- [ ] Deterministic fast path for rule hits, routine triggers and check-ins [A§7.1]
- [ ] CI latency check on the replay suite
- [ ] Publish numbers in the README and the console dashboard

### WS16 — Evaluation and tests (continuous; suite frozen W5) [A§8]
- [ ] Memory: a small multi-session LoCoMo/LongMemEval-style set; accuracy + tokens/query + p50/p95 tracked together
- [ ] Personalisation: correct-attribution rate with multiple speakers; stale-fact error rate; forget-propagation latency across devices
- [ ] Rules: zero violations in replayed scenarios; `blocked_by` text readable
- [ ] Routines/context: offer precision; workout false-trigger rate; exit timing; absence-detection latency
- [ ] Honesty: state claims preceded by `session_history`/`device_state`; repeat detector normal vs care mode
- [ ] Tenancy isolation tests (WS1)
- [ ] Proactivity: offer acceptance rate (self-report in the demo)

### WS17 — Agent Skill and open source (W5, P0)
- [ ] Package the same capability as an Agent Skill in `packages/skill`; verify in Claude and Kiro [A§6, T§1]
- [ ] Show the Skill in the video [T§7]
- [ ] README: what it is, architecture diagram, run instructions (self-hosted `docker compose`), latency table, licence
- [ ] Open Source mini challenge fields: contribution URL, repo URL, GitHub username, description [T§7]

### WS18 — Demo, video, submission (W5 dry run, W6 ship)
- [ ] W5 dry run of both directions → pick A or B (Q9) and the opener (Q10); log it in A§10
- [ ] Script ≤ 3 min, best material first [D§7]. Direction A: scoped recall → forget propagation → workout/wind-down → pre-flight + undo. Direction B: caregiver setup → orientation → consistent repeated answers → medication confirmation → missed check-in escalation
- [ ] Cut order if long: drop wind-down before pre-flight [D§7]
- [ ] Architecture closing slide (Bedrock/AgentCore)
- [ ] Video: public, English, < 3 min, no third-party trademarks or music [T§7]
- [ ] Product feedback for every tool/API/SDK used, including which AWS services and how [T§7]
- [ ] Feature requests with urgency (critical / important / nice-to-have), including every Tier C item [D§3.2, T§7]
- [ ] Friction log cleaned up (up to 10% bonus) [D§8]
- [ ] Submit by **Oct 20**

---

## 5. Week-by-week plan

Covers everything in D§10 plus the items the doc's plan is missing (F6).

### W1 (Sep 11 – 18)
- WS0 in full; doc fixes F1–F7; close the queue and local-model decisions; must-ship list confirmed (§3)
- Docker Postgres + pgvector; NestJS MCP skeleton with `session_brief` / `remember` / `recall` stubs over Streamable HTTP
- `LlmProvider` with the local adapter; Bedrock adapter stubbed
- Claude Desktop connected as the Alexa+ stand-in
- Dockerfile for the server
- Bee HR export spike (Q6)
- Friction log started

### W2 (Sep 19 – 25)
- WS1: schema with `household_id` / `region` / person / membership / grants / audit; magic link + bearer token; isolation tests
- WS3: fact model, pgvector, bi-temporal supersession, extraction worker, sensitivity classifier
- Seed data for the demo household
- Close Q5 (speaker resolution)

### W3 (Sep 26 – Oct 2)
- WS2: event log, HLC, `ingest_events`, `sync`, cursors, sessions, snapshot + compaction worker
- WS3: speaker scoping, retrieval fusion + rerank, `forget`, `explain_memory`, `communication_style`
- WS4: rule storage + `set_rule` / `list_rules` / `remove_rule` + precedence
- WS5/WS6: `resolve_speaker`, `session_history`, `device_state`, `verify_claim`, temporal stamp, full `session_brief`
- WS15: timing middleware on
- Close Q6, Q7, Q8
- **Checkpoint:** the shared core is green (scoped recall, forget propagation across two devices, honesty tools passing tests)

### W4 (Oct 3 – 9)
- WS8 routine miner (+ regression guard signal, absence detection)
- WS9 context engine (workout, wind-down, quiet hours)
- WS4 enforcement + WS6/WS7: `propose_action`, `action_preflight`, `undo`, provenance gate, never-initiate, quiet hours
- WS10 core: `cared_for` inversions, `checkin`, repeat detector inversion
- WS12 simulated Alexa+ web app + replay scripts
- WS14 first AgentCore deployment (if credits have landed)
- **Checkpoint:** core green? If yes, IG items open up. If no, IG items are cut.

### W5 (Oct 10 – 16)
- WS11 console incl. household transparency and retention/export; caregiver view
- WS9 music policy polish (Direction A) and WS10 care-mode phrasing (Direction B), in parallel
- WS15 latency numbers published; WS17 Agent Skill, README, licence
- Optional Bee bridge
- **Dry run → choose direction and opener**

### W6 (Oct 17 – 20)
- Switch to Bedrock on AWS; re-run replays; log p95
- Record the video; product feedback; feature requests; friction log
- Submit by Oct 20. Oct 21–23 is buffer only.

---

## 6. Dependencies (critical path)

```
WS0 repo/env ─► WS1 tenancy/auth ─► WS3 facts/extraction ─┐
          │                                               ├─► WS5 session_brief/recall ─► WS12 simulator ─► WS18 demo
          └─► WS13 LlmProvider ──────────────────────────┘                ▲
WS2 event log/HLC ─► WS8 miner ─► WS9 context ─► WS7 quiet hours / propose_action
        │                              │
        └─► sync/forget propagation    └─► WS10 care mode (absence, sundowning)
WS4 rules ─► action_preflight / propose_action (blocked_by)
WS15 timing ─► published p50/p95 ─► README / console dashboard
```

Critical path: event log → miner → context engine → `propose_action`/pre-flight → simulator → dry run. Anything that slips here in W3–W4 goes straight into W5.

---

## 7. Risks and mitigations [A§9, D§9]

| Risk | Mitigation |
|---|---|
| No real Alexa+ Preview MCP connection | Simulated path from day one; Claude Desktop in W1–3; convincing simulator with browser speech |
| The web app outshines the MCP server with judges | Every demo beat visibly goes through MCP tool calls; show the tool log on screen |
| Over-scoping | Shared core first; IG items only after the W4 checkpoint; hard cut list in §3 |
| Bee HR data unavailable | Recorded stream; no "real Bee data" claim |
| AWS credits arrive late | Everything runs locally; the Bedrock adapter is ready; the AgentCore deploy can slip to W6 |
| Cold starts / latency on the video | Warm instances, co-located region, cached projections, measured p95 |
| Local model struggles with tool calling | Pick a tool-calling model (Qwen3/Gemma 4, non-think); Anthropic API as the dev fallback |
| Care-mode phrasing could cause harm | "Support tool, not medical device"; no diagnosis stored; clinical review flagged before any real deployment |
| Vendor memory benchmarks are contested | Present our own numbers as directional |

---

## 8. Definition of done (submission) [T§7]

- [ ] Public GitHub repo, MIT licence in About, full source + run instructions
- [ ] MCP over Streamable HTTP actually called in code (entry point + loaded MCP config)
- [ ] Agent Skill present and shown in the video
- [ ] Simulated Alexa+ source included
- [ ] Demo video < 3 min, public, English, no third-party trademarks/music
- [ ] Product feedback for every tool/API/SDK used (incl. AWS services and how)
- [ ] Open Source mini challenge fields filled
- [ ] Friction log entries in the required format
- [ ] Feature requests with urgency
- [ ] p50/p95 per tool published
- [ ] Decision log [A§10] up to date, with every open question closed or explicitly deferred

---

## 9. Parked / post-hackathon [D§6, D§11]

Memory import/export between assistants · family shared-facts editor · per-topic notification preferences enforced via `device_state` · console accessibility mode · mobile-first caregiver view · graph DB · OAuth for Alexa+ · pricing tiers and self-hosted parity · clinical review of care-mode phrasing · Reliability Guard MCP [D§3.1] · care-mode assistants for multigenerational households (Malaysia/SEA).
