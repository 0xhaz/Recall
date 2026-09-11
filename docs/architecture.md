# Recall — Architecture (memory, routines, context, sync, tools)

**Status:** Draft v0.1 — working document until we lock scope for build
**Owner:** Haz

Companion documents: `design.md` (problem, product, behaviour, care mode, console, demo, business model, plan) · `techstack.md` (stack, local-first setup, AWS deployment, tooling, submission checklist).

---

## 1. Memory model

### 1.1 Memory types

| Type | Holds | Example |
|---|---|---|
| Working | Current conversation buffer | Handled by Alexa+; we expose session events for handoff |
| Episodic | Time-stamped events/interactions | "Asked for sushi reservation last Tuesday" |
| Semantic | Stable facts and preferences | Vegetarian; kids' shoe sizes; favourite restaurants |
| Procedural | Learned routines and how the user likes things done | Coffee 07:10 weekdays; running mix on workout |

### 1.2 Fact record

```
fact {
  id                uuid
  household_id      uuid                      -- tenant partition (every table)
  region            text                      -- data residency
  scope_type        person | household | device
  scope_id          uuid
  type              episodic | semantic | procedural
  content           text
  entities[]        [{name, kind, ref}]        -- links into the graph
  source            {event_id, device_id, speaker_id, speaker_confidence}
  created_at        timestamptz
  valid_from        timestamptz
  valid_to          timestamptz | null        -- null = currently true
  confidence        0..1
  sensitivity_tag   none | pii | health | financial | third_party | child
  ttl               interval | null           -- transient context expires
  last_accessed     timestamptz
  superseded_by     uuid | null
}
```

Rules:
- **Bi-temporal supersession, never deletion on update.** A corrected fact closes the old one (`valid_to`) and links `superseded_by`. History is preserved; "what's true now" is a filter.
- **Stable vs transient.** Durable traits (diet, allergies, taste, communication style, intent aliases) have no TTL and weight every interaction. Transient context (this week's travel, a craving) carries a TTL and expires automatically.
- **Provenance and confidence on every fact.** Low-confidence or conflicting facts are confirmed before being acted on. No proactive utterance may reference a fact without a source record. This is the anti-hallucination lever for personalization.
- **Calibrated claims.** One mention → "mentioned X once", not "X enthusiast". Generalisation only after recurrence.
- **Sensitivity classifier at write time.** Blocked categories are not stored at all (no placeholder); see `design.md` §4.2 for policy.

### 1.3 Scoping and household model

- Scopes: **person** (private), **household** (family calendar, grocery list, "our" restaurants), **device** (room-local).
- **Identity:** `person` is global (no `household_id`); `membership {household_id, person_id, role, granted_by, granted_at, revoked_at, capacity_flag}` with role ∈ owner | adult | child | guest | caregiver | cared_for. Everything a person owns is scoped by `(household_id, person_id)` through the membership. A person with zero memberships (departed guest) is purged after 30 days.
- **Forget me** cascades: tombstone every fact/rule/routine for the `person_id` in every household, plus membership rows; one command, all logged.
- **Care mode** = `membership.role = cared_for` for the household the request comes from; behavioural inversions key off that (see `design.md` §5). Granting/revoking is a membership change with an audit entry.
- **Caregiver grants** (per membership): `edit_care_plan`, `view_daily`, `enter_facts` (tagged `source = caregiver`), `set_rules` — on by default; `view_full_memory` — opt-in. Never read other members' memory. Revocation by owner always, by the cared-for person unless `capacity_flag` is set (flag visible to the person and logged).
- Speaker resolution: `speaker_id` + `speaker_confidence` on every request. Below threshold → return household-scoped facts only and ask who is asking. Never guess.
- Children: child profiles get minimal retention and parental deletion (COPPA posture). Guests: ephemeral mode, store nothing by default.
- Preference conflicts (thermostat, music): resolve by explicit household rule → speaker identity → ask. Never silently favour the account owner.

### 1.4 Storage and retrieval

- Postgres + pgvector (semantic recall), a lightweight edge table for the entity graph (multi-hop, temporal queries), plus key-value for hot lookups. Enough for the demo; swap to a graph DB later if needed.
- Extraction at write time via `LlmProvider` (local model in dev, Bedrock Nova/Claude in prod): single-pass salient-fact extraction, dedupe against existing facts, supersede rather than duplicate. Runs async after `remember` acks.
- Retrieval: fuse vector similarity + keyword + graph traversal, rerank, inject only top facts. Token-efficient retrieval is also the latency fix.
- Forgetting: automatic (TTL, recency decay in ranking) and user-commanded (tombstone event, see §4).
- Growth management: consolidation pass (merge duplicates, supersede, expire TTLs, decay unused); per-person size budget with a "review these" prompt rather than silent pruning.

### 1.5 Stated rules (hard constraints) vs learned memory

Two distinct layers. Learned memory (facts, routines, context weights) grows on its own, is confidence-weighted, decays and consolidates, and is treated as evidence. Stated rules are user-authored constraints and are treated as law.

| Property | Learned memory | Stated rule |
|---|---|---|
| Origin | Extracted / mined | User or caregiver, verbatim + structured form (`scope`, `condition`, `effect`, `severity`, optional `expires`) |
| Confidence | 0..1, decays | None — binary, never decays, never inferred |
| Supersession | By newer facts | Only by its author (or a caregiver above them) via a stated edit/remove with tombstone |
| Use | Offer, ask, calibrate | Enforce; suppress conflicting offers |

**Precedence (fixed):** caregiver rule with `severity = safety` → person's stated rule → other caregiver rule → learned preference → default behaviour. A rule beats any learned fact regardless of confidence (e.g. mined "plays music at 10:30pm" is suppressed by "no music after 10pm on school nights"). Safety rules (stove, door, medication) authored by a caregiver for a `cared_for` member outrank that person's own statements; everything else keeps the person first.

**Enforcement:** `propose_action` and `action_preflight` run every candidate through the rule check and return `blocked_by: {rule_id, text}`. Rules about device state ("notifications off on the kitchen Show") are verified after the action via `device_state`. Rule violations are never left to the model's intent.

**Conflicts:** colliding rules, or a rule that makes a routine impossible, produce a conflict item in the console with a plain-language explanation. Never silently resolved.

**Scope and readability:** per person / household / device, optionally time-boxed. `list_rules` returns them verbatim with author and date.

**Where the layers meet:** a rule can tag learned facts (e.g. "never peanuts" excludes peanut-containing facts from recipe recall); repeated manual corrections in the learned layer prompt "want me to make that a rule?" — offer-first. In care mode, the caregiver's correction policy, medication schedule and safety alerts are rules.

```
rule {
  id, household_id, author_id, scope_type, scope_id
  text            verbatim
  condition       jsonb   -- time window, context, intent class, device
  effect          block | require_confirm | prefer | suppress_offer
  severity        safety | hard | soft   -- safety only for caregiver rules on cared_for members
  expires_at      timestamptz | null
  created_at, removed_at (tombstone)
}
```

## 2. Routine learning (procedural memory)

Routines are not inferred by the LLM from conversation; they are mined from the structured event log.

**Event shape:** `{event_id, household_id, hlc, device_id, person_id, person_confidence, location, kind, payload}` — e.g. `lights.kitchen.on`, `coffee_machine.start`, `ring.front_door.leave`, `firetv.play`, `bee.transcript.mention`, `checkin.morning`.

**Algorithm:**
1. **Bucket & cluster** — per person × day-of-week × 15-min bin; DBSCAN / kernel density over time-of-day yields "coffee at 07:10 ± 12 min weekdays".
2. **Sequence mining** — PrefixSpan-style frequent sequences over each day's ordered events → chains like `wake → kitchen lights → coffee → news → leave`.
3. **Score & decay** — each routine carries `support`, `confidence`, `last_seen`, decay factor. Drift detection compares recent vs long window; shifts update rather than alarm.
4. **Exceptions first-class** — weekday/weekend, public holidays (Malaysian calendar for demo), travel (phone/Bee) stored as *conditions* on the routine.
5. **Promote, don't auto-execute** — candidate → offered → active → retired. First occurrence is an offer; accept/dismiss feeds the score.
6. **Regression guard** — distinguish "user stopped doing it" (support decays) from "action started failing" (action events show errors); surface broken routines in the console and friction log.
7. **Absence detection** — for check-in style routines the *absence* of the expected event by usual time is the signal: gentle prompt to the person first, then escalation to the household/caregiver. Never auto-sends on the person's behalf.

**Routine record:**
```
routine {
  id, household_id, person_id | null
  trigger        {type: time | event | context | absence, spec}
  sequence[]     [action]
  conditions     {dow[], holidays, not_travelling, ...}
  support, confidence, last_seen, decay
  status         candidate | offered | active | retired
  valid_from, valid_to
}
```

## 3. Context engine

Sits between the event log and routines. Signals in, a small set of named contexts out; routines key off contexts, never raw signals.

| Context | Raising signals | Confidence to act |
|---|---|---|
| Workout | HR above personal resting baseline (Bee on Apple Watch), phone motion, mined gym time, "I'm working out" | Medium (music is cheap and reversible) |
| Wind-down / sleep | Late local time, dimmed lights, phone charging, low ambient noise, calm speech | Medium; also sets quiet hours |
| Party | Multiple distinct voice IDs in one room, evening/weekend, Ring arrivals, higher noise | High — affects others, ask first |
| Festive | Calendar (Hari Raya, CNY, Deepavali, Christmas, birthdays from memory), guests | Low — playlist bias, not an action |
| Focus / work | Weekday daytime, single person, silence | Medium |

Mechanics:
- **Scores, not hard classes.** Each context 0..1 from a weighted signal sum with per-person weights; several can be live at once (festive + party).
- **Debounce.** Fire only when the score crosses threshold and holds for a window (no stair-climb triggering gym music).
- **Manual input wins and teaches.** "Workout mode" sets score 1.0 immediately *and* logs the signal snapshot, calibrating the automatic trigger per person.
- **Per-person baselines** from the routine miner: thresholds are relative ("20% above your resting rate"), never absolute.
- **Exit conditions.** Workout ends on HR return-to-baseline for N min or typical duration; wind-down at sleep event; party when voice count drops.
- **Store derived context and thresholds only — never raw heart-rate streams.**
- **Context scores are a projection** over the event log, recomputed by a worker, so every device sees the same value.

### 3.1 Music policy (first routine to ship)

1. Seed from explicit statements and linked-service history.
2. Learn from behaviour *tagged with active context*: play/skip/volume/completion. Skips in "workout" don't penalise a track in "wind-down".
3. Rank candidates by context fit (tempo/energy metadata) × personal affinity in that context × recency penalty.
4. Household blend for shared contexts (party/festive): intersect present people's affinities.
5. Offer first ("Looks like a workout — want your running mix?"); auto-start after two accepts at similar signal levels. Party/festive stay ask-first. Stated rules (e.g. "no music after 10pm") suppress the offer entirely.

## 4. Cross-device sync

Principle: **the event log is the source of truth, not any device.** Devices append events and derive their view; there is no device-to-device state sync.

- **Ordering** — hybrid logical clock (wall time + logical counter + device id). Device clocks drift and Bee may be offline for hours; order by HLC, tie-break on device id.
- **Idempotent writes** — every event has a UUID; server dedupes on retry/batch upload.
- **Projections, not merges** — persona facts, routines, context scores are derived views. Conflicts resolve by fact-type rule: LWW-register (by HLC) for single-valued preferences; add/remove set for set-valued facts (restaurants, allergies) so a stale replay never resurrects a removal.
- **Forget is an event** — `forget(fact_id)` writes a tombstone; because devices replay the log, no cached copy can reintroduce the fact. Same mechanism for `undo` on actions and `remove_rule`.
- **Pull by cursor** — each device keeps the last HLC seen and pulls `events since cursor` over MCP / a light SSE endpoint. All devices converge to the same projection.
- **Context handoff** — active conversation is a short-lived session (`session.open/turn/close`, TTL of minutes); a device joining mid-session reads the open session and continues. The session turn log is also what `session_history` returns.

### 4.1 Retention, snapshots and compaction (decided 2026-09-11)

- Raw events kept **90 days** by default (household-configurable, min 30, max 365). Hackathon build uses 7 days so the path is exercised.
- Nightly worker snapshots every projection (facts, rules, routines, context baselines, cursors) and records `snapshot_hlc`.
- Events older than retention *and* older than the latest snapshot are deleted.
- A device whose cursor is older than the oldest kept event gets a **full re-sync from snapshot**, not a replay. `sync` must return `{mode: replay | snapshot}`.
- **Tombstones are never compacted before their target is gone from every snapshot** — keep tombstones for retention + 30 days — so a stale device cannot resurrect a forgotten fact, undone action or removed rule.
- Sensitive-tagged raw events (health signals, classifier-flagged) have a **7-day** raw retention regardless; only derived context survives.
- Persons with zero memberships: purge after 30 days.

## 5. State-of-record and honesty mechanisms

- **State-of-record principle** — the assistant never answers a question about state from model belief. `device_state` is the only source for now-playing, timers/alarms, notification subscriptions and enabled features; every "turn X off" is re-read from state after the change.
- **Session history** — `session_history` returns the actual turn log; required before any claim about what the assistant said or did.
- **Temporal stamp** — every `session_brief` / `recall` / `get_context` / `propose_action` response carries device local date, time and timezone; timer/alarm acknowledgements include the actual start timestamp.
- **Repeat detector** — session projection flags the same answer N times in a row → abstain and offer an alternative. Profile-aware: inverted in care mode (answer consistently, never "I already told you").
- **Confidence-gated answers** — `verify_claim` returns fact + source + validity window, or "unknown, ask" below threshold.
- **Action pre-flight and undo** — `action_preflight` checks candidate actions against memory, rules, quiet hours and order history; `undo` reverses within a window.

## 6. MCP tool surface (draft)

| Tool | Purpose |
|---|---|
| `resolve_speaker(hints)` | Returns `speaker_id` + confidence from provided cues (simulated Voice ID) |
| `session_brief(speaker, hint)` | One-call bundle: top facts, applicable rules, context scores, quiet-hours flag, relevant device state, temporal stamp — the default first call for any request |
| `recall(speaker, query, scope?)` | Scoped, ranked facts with provenance; household-only when confidence low |
| `remember(speaker, text, source)` | Ack immediately; async extract → dedupe → supersede → append events |
| `forget(speaker, fact_id \| topic)` | Writes tombstone; closes `valid_to` |
| `explain_memory(speaker)` | Human-readable summary of what is stored and why (primary spoken feature in care mode) |
| `get_context(household)` | Current context scores and active routines |
| `propose_action(speaker, context)` | Offer-first routine/music suggestion with rationale; returns `blocked_by` when a rule applies |
| `ingest_events(device, events[])` | Idempotent batch append with HLC |
| `sync(device, cursor)` | Events since cursor, or a full snapshot when the cursor predates retained events (`mode: replay \| snapshot`) |
| `verify_claim(speaker, claim)` | Fact + source + validity window, or "unknown, ask" below threshold |
| `action_preflight(speaker, action)` | Checks action against memory, rules, quiet hours, order history; returns items to confirm or `blocked_by` |
| `undo(action_id)` | Reverses an action within its undo window (tombstone on the action event) |
| `session_history(session_id)` | Actual turn log for the active session |
| `device_state(device \| household)` | Live now-playing, timers/alarms, notification subscriptions, enabled features — the only source for state answers |
| `checkin(person, kind)` | Person-initiated check-in; logs event, sends household message; miner tracks usual time for absence detection |
| `set_rule(author, text, structured)` / `list_rules(scope)` / `remove_rule(rule_id)` | Stated hard constraints |

Also packaged as an **Agent Skill** so the same capability works in Claude / Kiro.

## 7. System architecture and latency design

```
Echo (sim) / Phone / Bee (real or replayed) / Ring & Fire TV (sim)
        │  ingest_events (HLC, device_id, person_id)
        ▼
  Append-only event log (Postgres)
        │  projections (rebuilt by workers, never hand-merged)
        ├── Persona memory  (facts, rules, pgvector, entity edges)
        ├── Routine miner   (clusters, sequences, decay, absence)
        ├── Context engine  (scores, thresholds, exits, quiet hours)
        ├── Session / state (turn log, device_state, repeat detector)
        └── Sync cursors    (per-device offset)
        ▲
  MCP server (NestJS, Streamable HTTP)  ◄──  Alexa+ (Preview) / Claude Desktop (dev) / simulated Alexa+ web app
        │
  LlmProvider (local → Bedrock) for extraction, consolidation, pre-flight, explainer  ·  AgentCore Runtime for hosting
        │
  Console (Next.js): memory browser, rules, routines, context dashboard, caregiver view, simulator
```

**Orchestration model:** one deterministic core owns state. LLM work runs as stateless workers (extractor, consolidator, pre-flight checker, explainer) behind a job queue — one orchestrator plus specialised workers, not peer agents. Workers never hold their own memory or talk to each other. Many personas is a data-partition problem (scope + tenant), not an agent-count problem.

### 7.1 Latency design

Most of the 10–15 s reviewers measured is inside Amazon (model routing, cloud round-trips, TTS) and out of our reach. Recall must add near-zero latency and give Alexa+ ways to skip its slow path. Hard requirement, not polish.

| Lever | Design |
|---|---|
| LLM out of the read path | `recall`, `get_context`, `list_rules`, `device_state`, `session_history` are DB/cache reads over precomputed projections; aim for < 100 ms server-side (enforced p95 budgets are in `techstack.md` §5, e.g. `recall` < 300 ms). LLM runs only on writes and on `action_preflight` / `propose_action` |
| Async writes | `remember` acks immediately and queues extraction; eventual consistency accepted; raw utterance is already in the event log and searchable |
| One round trip | `session_brief` bundles everything most requests need, so one tool call instead of four (each MCP call costs Alexa+ a full model turn — biggest lever we own) |
| Precompute + cache | Context scores and each person's hot facts kept as projections in memory; warm on `resolve_speaker`; prefetch likely-next facts from the active routine |
| Compact results | Ranked, minimal facts — fewer tokens for the model to read and respond to |
| Deterministic fast path | Rule hits, routine triggers and check-ins return ready-made action + phrase; no reasoning step |
| Streaming | Streamable HTTP sends deterministic parts first (state, rules, hot facts), enrichment after |
| Deployment | Same AWS region as the Alexa+ endpoint; warm instances; persistent DB pool; simulator and server co-located for the video |
| Measure and publish | p50/p95 per tool in README and console dashboard; budgets in `techstack.md` §5 |

Product feedback (Amazon's side): small-model routing for simple intents, local execution for device commands, streaming TTS; cite the late "Timer started" announce as latency becoming an honesty problem.

## 8. Evaluation

- Memory: LoCoMo / LongMemEval-style checks on a small custom multi-session set; track accuracy, tokens per query, p50/p95 latency together.
- Personalization: correct-attribution rate in multi-speaker scenarios; stale-fact error rate; forget-propagation latency across simulated devices.
- Rules: zero rule violations in replayed scenarios; `blocked_by` explanations readable.
- Routines/context: precision of routine offers; false-trigger rate for workout; time-to-exit accuracy; absence-detection latency for check-ins.
- Honesty: `session_history` / `device_state` consulted before every state claim (assert in tests); repeat-detector behaviour in normal vs care mode.
- Proactivity: offer acceptance rate; interruption complaints (self-report in demo).

## 9. Risks and open questions

- No real Alexa+ Preview MCP connection likely → simulated path from day one; Claude Desktop as stand-in early; make the simulator convincing (browser speech in/out).
- Keep the MCP server the star, not the web app — judges weigh required-tech use.
- Over-scoping: build the shared core (memory, event log/sync, context engine, `explain_memory`, `session_history`, `device_state`) before direction-specific polish.
- Vendor memory benchmarks are contested; treat numbers as directional.
- Bee data availability: confirm Apple Watch HR export via Bee CLI/MCP in week 1; fallback is a recorded stream.
- Open questions with due weeks are tracked in `design.md` §11; close each with a decision-log entry below.

## 10. Decision log

| Date | Decision |
|---|---|
| 2026-09-11 | Primary track: Alexa+ (MCP server + Agent Skill). Stack mini challenges: AWS Builder, Open Source. |
| 2026-09-11 | Core concept: user-owned persona memory server. Conflict resolver folded in; reliability guard parked. |
| 2026-09-11 | Event log is source of truth; HLC ordering; tombstoned forgetting; projections not merges. |
| 2026-09-11 | Context engine stores derived context + thresholds only; no raw biometrics. |
| 2026-09-11 | Music is the first routine to ship; workout and wind-down are the demo contexts. |
| 2026-09-11 | Added Tier A: confidence-gated answers, action pre-flight, undo log, tone dial. Tier B as time allows. Smart-home routing / app rebuild / pricing go to product feedback. |
| 2026-09-11 | Added community failures and responses: `session_history`, provenance-gated proactivity, never-initiate list, quiet hours, temporal stamp (Tier A); repeat detector, intent aliases (Tier B). |
| 2026-09-11 | Added state-of-record principle + `device_state`; response budget per intent class; caretaking check-in routine (`checkin`); Kindle Assistive Reader regression to friction log (high). |
| 2026-09-11 | Added care mode: caregiver-set flag that inverts repeat handling, makes provenance absolute, adds correction/redirect policy and orientation/safety routines; no diagnosis stored. |
| 2026-09-11 | Keep two demo directions (A: everyday routines + common issues; B: elderly / care mode). Build the shared core first; choose at week 5 after a dry run. |
| 2026-09-11 | Stated rules as a separate hard-constraint layer with fixed precedence over learned memory; `set_rule`/`list_rules`/`remove_rule` and `blocked_by` on action tools; conflict view in console. |
| 2026-09-11 | Latency design: LLM out of read path, async writes, single-call `session_brief`, cached projections, deterministic fast path, streaming, co-located deployment, published p50/p95. |
| 2026-09-11 | Local-first build: Docker Postgres, local LLM via `LlmProvider`, Claude Desktop as Alexa+ stand-in for weeks 1–3; AWS/Bedrock/AgentCore switch when credits arrive, final week + video on AWS. |
| 2026-09-11 | Web console user features and caregiver view defined; console is not a general chatbot. |
| 2026-09-11 | Product model: multi-tenant SaaS with household as tenant + self-hosted option; roles incl. cross-household caregiver; `household_id` and `region` on every table from day one; auth in week 2. |
| 2026-09-11 | Orchestration: one deterministic core + stateless LLM workers; no per-person agents, no agent-to-agent memory. |
| 2026-09-11 | Docs split into `design.md`, `architecture.md`, `techstack.md`. Decision log lives here. |
| 2026-09-11 | Q2 closed: person is a global account; `membership` per household with role (owner, adult, child, guest, caregiver, cared_for); forget-me cascades across memberships. |
| 2026-09-11 | Q3 closed: care mode is the membership role `cared_for`, granted per household by the owner; inversions key off the requesting household's membership. |
| 2026-09-11 | Q1 closed: caregiver permissions are scoped grants (care plan, daily view, enter facts, set rules on by default; full memory opt-in; never other members). Revocable by owner always and by the person unless a visible, logged capacity flag is set. Caregiver `safety` rules outrank the person's own rules; otherwise person first. |
| 2026-09-11 | Q4 closed: raw events 90 days (configurable 30–365; 7 in hackathon build); nightly projection snapshots; re-sync from snapshot when cursor predates retained events; tombstones kept retention+30d; sensitive raw events 7 days; zero-membership persons purged after 30 days. |
| 2026-09-11 | W1 build choices: TypeScript 5.9 (7.x not yet trusted with Nest decorators); NestJS 12 (ESM) with explicit `@Inject` tokens so esbuild-based tsx/vitest need no decorator metadata; plain SQL migrations on `pg`, no ORM; Docker Postgres on 5435. |
| 2026-09-11 | MCP transport is stateless Streamable HTTP (fresh server per request). Conversation handoff (§4) is a Recall domain session, not an MCP session, so stateless fits AgentCore and horizontal scaling. |
| 2026-09-11 | Until `resolve_speaker` (W3), the client names the speaker explicitly; unknown or ambiguous names resolve to nobody → household-scoped facts and "ask who is speaking". Q5 stays open for the simulator. |
| 2026-09-11 | Until the extractor lands (W2), `remember` stores the statement verbatim as an episodic fact at confidence 0.6 with `origin = user_statement`; the extractor will derive semantic facts from it. |
| 2026-09-11 | W2 identity and auth: `person.email`; caregiver grants as `membership.grants` (defaults: care plan, daily view, enter facts, set rules); access rules as pure functions in `@recall/core`. MCP bearer tokens per household (256-bit, only SHA-256 stored, 60 s lookup cache, revoke clears it). Console sign-in by single-use 15-minute magic link → 30-day session; links are logged in dev until an email provider (SES) is wired. Magic link is the workplan §2.2 default. |
| 2026-09-11 | Q5 closed: the device sends an explicit `speaker` plus optional `speaker_confidence`. Below 0.7 (`SPEAKER_CONFIDENCE_THRESHOLD`) the speaker is treated as unknown (household facts only) and `session_brief` returns `speaker_candidate` so the assistant can ask "Is this Aisyah?". |
| 2026-09-11 | Q6 closed: Bee's developer tools (CLI, MCP, Skill, local API) expose no heart rate or other biometrics — only transcripts, facts, todos, locations, journals and a live event stream. The workout signal is a replayed heart-rate stream; Bee `new-utterance` / `update-location` events (via `bee stream --webhook-endpoint`) may add a second, real signal. No "real Bee heart-rate" claim in the video. |
| 2026-09-11 | Job queue is Postgres-backed (`FOR UPDATE SKIP LOCKED`, LISTEN/NOTIFY with polling fallback, 3 attempts with backoff, stale locks reclaimed after 5 min) — the workplan §2.2 default. |
| 2026-09-11 | Write path: a deterministic screen runs first (Luhn-valid card numbers, credentials, account and national ID numbers, diagnoses and named conditions); clauses that hit it are dropped and never stored or sent to a model. The screened statement is stored as an `utterance` with a queued job, `remember` acks, and pending utterances are recallable at once. Supersedes the W1 entry where `remember` stored the verbatim statement as an episodic fact. |
| 2026-09-11 | Extraction: the LLM only drafts facts; deterministic rules decide the rest. Household scope only when both the fact and the statement are collective; firm statements 0.9, passing mentions 0.5; sensitivity can only escalate; a child's facts expire within 30 days. Dedupe: neighbours at cosine ≥ 0.72 go to an LLM judge (same / updates / new) → reinforce (+0.1, capped at 0.95), supersede (close + link, never delete) or insert. A temporary fact never supersedes a durable one. |
| 2026-09-11 | Dates: the model returns the speaker's own words for when something ends ("Wednesday", "this week") and `resolveEnd()` computes the date. qwen3:8b got weekday arithmetic wrong and copied dates from the worked example. Temporary facts with an unparseable end are kept 7 days. |
| 2026-09-11 | Embeddings: `qwen3-embedding:0.6b` locally and Titan Text Embeddings V2 on Bedrock, both at 1024 dims. Calibration: unrelated pairs ≤ 0.68, related ≥ 0.77; duplicates and real updates overlap (0.95–0.99), which is why a judge decides. |
| 2026-09-11 | Tests run against their own database (`<db>_test`, wiped at the start of each run), one file at a time, with a scripted LLM and a deterministic embedder so CI needs no model. Prompt-quality tests against the real model run with `RECALL_LIVE_LLM=1`. |
| 2026-09-11 | W3 event log: devices sync by the server's arrival sequence (`seq`), not by HLC, so a late upload from an offline device is never skipped; merging still follows HLC. Every event-writing transaction first takes a per-household advisory lock, so `seq` order equals commit order and a cursor can't step past an uncommitted event. |
| 2026-09-11 | Devices may write only device signals and conversation turns. Kinds under `fact.`, `rule.`, `utterance.`, `action.` and `memory.` are server-only; memory changes go through the tools. Device stamps more than 5 minutes ahead of the server are rejected, so a bad clock can't win every last-writer-wins merge. |
| 2026-09-11 | What syncs: fact changes (the canonical `fact_view` in `fact.created`, plus reinforced / superseded / forgotten) and `utterance.recorded` without the words; raw speech stays on the server. Raw health signals (`health.`, `hr.`, `biometric.`) are never synced and are deleted after 7 days. |
| 2026-09-11 | Device state and sessions are projections built on ingest: device state is last-writer-wins per key by HLC (a late cancel can't be undone by an older start), and `session_brief(device)` returns the speaker's active conversation even when it started on another device. |
| 2026-09-11 | Snapshots are built from the tables under the household lock and must equal a full replay (tested). Compaction runs as a daily `maintain` job: events past retention and covered by the snapshot are dropped, tombstones stay retention + 30 days, and `compacted_through` sends older cursors to the snapshot. Per-tool latency (last 1000 calls) is published on `/metrics/latency`. |
