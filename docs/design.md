# Recall — Design (problem, product, behaviour, demo)

**Status:** Draft v0.1 — working document until we lock scope for build
**Target:** Build, Ship, Shape: Amazon Developer Hackathon — Alexa+ track (primary), AWS Builder + Open Source mini challenges
**Deadline:** Oct 23, 2026, 12:00pm PDT (submit by Oct 20 to keep slack)
**Owner:** Haz

Companion documents: `architecture.md` (memory model, routines, context engine, sync, tools, latency, evaluation, decision log) · `techstack.md` (stack, local-first setup, AWS deployment, tooling).

---

## 1. Problem statement

Reviews of Alexa+ (Tom's Guide, Wirecutter, Consumer Reports, The Verge, The Street, Reddit) converge on the same set of flaws:

| Flaw | Evidence | Widely reported? |
|---|---|---|
| Unreliable agentic actions | "that action isn't supported yet", wrong Uber address, pilot-only integrations | Yes |
| Hallucinated facts | Wrong snowstorm date, Dollywood ticket priced at $42 vs real $122 | Yes |
| Latency | Up to ~15 s for some requests, >10 s for weather | Yes |
| Shallow, forgetful memory | Uploaded recipe forgotten after two weeks; no reliable voice "forget" | Yes |
| Personal notes not scoped | Amazon docs: notes visible to anyone on the account's devices | Structural |
| Legacy regressions | Timed fan control, playlist shuffle broke | Multiple |
| Buggy companion app | Consumer Reports: "hot garbage" | Multiple |
| Personality overreach | Wirecutter: sass feels "unsettling"; Reddit: "creepy" | Some |
| Privacy distrust | 2023 FTC/DOJ COPPA settlement, $25M penalty, indefinite retention of children's recordings | Structural |
| Value perception | $19.99/mo non-Prime; ads on paid devices | Some |

Strengths to preserve: natural multi-turn conversation, child speech comprehension, natural-language smart-home control and one-shot routine creation, Voice ID / Visual ID, Ring integration, document/PDF ingestion (which Gemini for Home lacks).

### 1.1 Community-reported failures (r/alexa, r/AlexaPlus, 2026)

| Failure | Example | Why it matters |
|---|---|---|
| False claims about its own history | Refused "what time is it" four times, then insisted "I just told you four times it's 10:58" | Hallucinating the conversation log; user called a liar |
| Fabricated / misattributed memory raised proactively | "I know your uncle died of TB last year" to a user with no such uncle; not in device history | Either cross-account leak or hallucinated memory — both fatal to trust; sensitive topic initiated unprompted |
| Proactivity with no sense of time or stakes | Woke user at 2am about a couch delivery they never ordered | No quiet hours; no check against order history |
| Temporal grounding + loops | "Tonight's kickoff" answered with yesterday's game; same wrong sentence repeated verbatim; "Timer started" announced seconds late | Missing local date/time context; no repeat detection |
| Phrasing regressions | "Play BBC radio" fails, "open BBC Sounds and play X" works; Apple Podcasts same; breathing exercises gone | Exact-invocation dependence; lost legacy features |
| Honesty about opting out | Told it couldn't revert to classic Alexa; "Alexa, cancel Alexa plus" works | Product feedback |
| False wake / interjecting | Activated without wake word, joined a conversation unprompted | Product feedback (hardware/wake model) |
| Tone when failing | "I get that you're frustrated, what can I help you with?" while still wrong | Emotion-labelling reads as condescending |
| Belief vs system state mismatch | "I'm not subscribed to those notifications" while they keep arriving; "I see something is playing but can't interact with it" while the app controls it; thumbs-down "acknowledged" with no effect | Assistant answers about state from model belief, not the system; general case of the session-history failure |
| Unnecessary commentary | Taco tips when adding canned corn to a list; "it's going to be a wonderful day" on a workday morning (61 upvotes) | Verbosity and cheer on transactional intents; no way to turn it off |
| Accessibility regression | Kindle Assistive Reader media controls fail by voice on Alexa+, work via app; workaround requires a second device | Accessibility regression; high-severity friction log item |
| Missing caretaking routine | 96-year-old mother wants "Good morning" / "Good night" → text to family group; no such routine | Real caretaking need (a hackathon priority category); absence of check-in is the important signal |

**Thesis:** the highest-leverage fix is not more personality but a trustworthy memory: per-person, inspectable, editable, forgettable, routine-aware, and consistent across every device in the house.

## 2. Competitive lessons

| From | Lesson |
|---|---|
| Google Gemini for Home | Free core tier; per-item and per-timeframe deletion with user-set retention window (18 mo default); plain disclosure that history trains models; response filtering scoped by identity (guests filtered by default, voice-matched kids always filtered); camera Home Brief. Its memory is *inconsistent* — our differentiator is reliability of recall. |
| Apple HomePod / Siri | Don't ship until reliability clears a bar; deterministic HomeKit/Matter execution; hub OS designed for a multi-person household; on-device-first privacy. (LLM Siri still unshipped as of Sept 2026.) |
| Home Assistant Voice PE | Sub-second local intents that never regress or round-trip to a data center; verifiable "nothing leaves the LAN" mode; hardware mic cut; LLM only for open-ended requests, deterministic path for device control. |

## 3. What we are building (hackathon scope)

**Recall** is a self-hosted MCP server (spec 2025-11-25+, Streamable HTTP) that gives Alexa+ — or any agent — a user-owned memory layer:

1. **Persona memory** — per-person facts with provenance, confidence and bi-temporal validity.
2. **Routine learning** — procedural memory mined from a cross-device event log.
3. **Context engine** — workout / wind-down / party / festive / focus scores driving routines (music first).
4. **Cross-device sync** — append-only event log with hybrid logical clocks; devices replay, never merge by hand.
5. **Privacy & control** — readable "what do you know about me", per-fact edit/delete, sensitivity filter, TTLs, tombstoned forgetting that propagates everywhere.
6. **Console** — Next.js web app to inspect and edit memory, and to simulate the Alexa+ experience for the demo.

Explicitly out of scope for the hackathon: real Voice ID integration, real Echo device access (we assume no Alexa+ Preview MCP connection is available to outside devs), production-grade multi-tenant billing, full smart-home command routing.

### 3.1 Alternatives considered

- *Household Conflict Resolver* (thermostat/music/meal preference conflicts only) — narrower, less impact. Folded in as a feature of persona memory.
- *Reliability Guard MCP* (deterministic intent→action validator with abstention) — strong technically, hard to demo without device access. Parked; noted in product feedback.

### 3.2 Additional improvements mapped to the problem statement

Beyond memory/scoping/forgetting/privacy, these address the remaining §1 flaws. Tier A is in the build; Tier B is instrumentation on things already being built; Tier C is outside our reach and goes into product feedback.

| # | Improvement | Flaw addressed | Tier | Where |
|---|---|---|---|---|
| 1 | **Confidence-gated answers** — `verify_claim` returns the fact with source + validity window, or "unknown, ask" when nothing clears threshold. Abstention is a first-class tool response. | Hallucination | A | MCP server |
| 2 | **Action pre-flight** — `action_preflight` checks an order/booking/ride against memory (known addresses, used venues, routine conflicts) and returns a structured "confirm these N things" payload before execution. | Agentic unreliability | A | MCP server |
| 3 | **Undo log** — every action taken through us gets an `undo` handle for a short window; same tombstone mechanism as facts, applied to actions. | Agentic unreliability, trust | A | MCP server |
| 6 | **Tone / personality dial** — per-person `communication_style` fact (terse / warm / no jokes / no emotional language) returned by `recall` and applied by the assistant. | Personality overreach | A | Memory + console |
| 4 | **Regression guard** — miner distinguishes "user stopped doing it" from "action started failing" and surfaces broken routines in the console and friction log. | Legacy regressions | B | Routine miner |
| 5 | **Latency budgets** — `recall` < 300 ms p95, `get_context` < 100 ms; precomputed context scores; early partial results; numbers published in README. | Latency | B | MCP server |
| 7 | **Household transparency view** — "who can see what" screen over person/household/device scopes. | Notes leak, app quality | B | Console |
| 8 | **Retention window + export** — user-set retention, delete by item/day/range, JSON export (Google-style controls). | Privacy distrust | B | Console |
| — | Deterministic smart-home routing, companion app rebuild, pricing and ads on paid devices | Regressions, app, value | C | Product feedback / feature requests with severity |

Demo framing that follows: memory that makes Alexa+ *safer to trust*, not just smarter.

### 3.3 Responses to community-reported failures (§1.1)

| Response | Addresses | Tier |
|---|---|---|
| `session_history` tool — the assistant must read the actual session turn log before asserting anything about what it said or did; never from model memory | False claims about own history | A |
| Provenance-gated proactivity — no proactive utterance may reference a fact without a source record visible in the console | Fabricated / misattributed memory | A |
| Never-initiate list — the assistant never *starts* a topic tagged health, bereavement, financial, third-party, or child; these are answer-only | Creepy personal questions | A |
| Quiet hours — wind-down/sleep context hard-suppresses all proactive output; unsolicited purchase/delivery notices must pass `action_preflight` against order history | 2am couch wake-up | A |
| Temporal stamp — every `session_brief` / `recall` / `get_context` / `propose_action` response carries device local date, time and timezone; timer/alarm acknowledgements include the actual start timestamp | "Tonight" answered with yesterday; late timer announce | A |
| Repeat detector — session projection flags the same answer N times in a row → abstain, say so plainly, offer an alternative path (inverted in care mode, see §5) | Verbatim loops | B |
| Intent aliases — per-person facts mapping the phrasing they use to the invocation that worked ("BBC radio" → open BBC Sounds and play); learned from what eventually succeeded | Phrasing regressions | B |
| Tone rule — no emotion-labelling of the user ("I get that you're frustrated") unless `communication_style` allows it; on failure, state the failure and one next step | Condescending tone | A (extends tone dial) |
| **State-of-record principle** — the assistant never answers a question about state from model belief; `device_state` returns live now-playing, active timers/alarms, notification subscriptions and enabled features; every "turn X off" is re-read from state after the change and confirmed from that | Belief vs system mismatch, late timer, phantom notifications | A |
| Response budget per intent class — transactional intents (list, timer, light, volume, media control) return a confirmation word only; commentary/tips/cheer are opt-in via `communication_style`, never default | Unnecessary commentary | A (extends tone dial) |
| Check-in routine — person-initiated "Good morning / Good night" sends a family-group message; the miner's usual-time is the baseline; *absence* by usual time → gentle prompt to the person first, then escalation to the household. Never auto-sends "I'm OK". | Caretaking | A — candidate demo beat |
| Kindle Assistive Reader voice controls | Accessibility regression | C — friction log, severity high |
| Reversion honesty, false wake, lost legacy features (breathing exercises) | — | C — product feedback with severity |

## 4. Behaviour principles

### 4.1 Proactivity

- Tiered actions: **inform → suggest → draft → act**; only high-confidence, low-risk actions run autonomously.
- Every nudge has an interruption cost; suppress low-value signals.
- Everything autonomous is reversible (undo).
- Accept/dismiss per person tunes thresholds (research: users judge *initiation legitimacy* before usefulness).
- Quiet hours (wind-down/sleep context) suppress all proactive output.

### 4.2 Privacy and control (policy)

- User-visible, editable, deletable memory: console lists every fact with source, confidence, validity; "what do you know about me?" returns a readable answer by voice or text.
- Never stored by default: passwords, card/account numbers, precise health data (raw HR, diagnoses), details about non-consenting third parties. Sensitivity classifier at write time (see `architecture.md` §1).
- Consent: memory opt-in; "temporary chat" mode that neither reads nor writes; per-person retention window; export endpoint.
- Regulatory posture: COPPA (child profiles), GDPR access/erasure/portability (per-fact provenance and TTL make this tractable), CCPA/CPRA, Malaysia PDPA.
- Commercial hazard to disclose: whether memory feeds commerce/ads must be explicit. Recall's default: it does not.

### 4.3 Stated rules vs learned memory (user-facing)

Users (and caregivers) can author hard rules ("never suggest peanut recipes", "no music after 10pm on school nights", "always confirm before ordering"). Rules are law, learned memory is evidence. Precedence: caregiver `safety` rule (for a `cared_for` member) → the person's own stated rule → other caregiver rule → learned preference → default. A blocked action is explained in the rule's own words. Conflicts are surfaced in the console, never silently resolved. Mechanics in `architecture.md` §1.5.

## 5. Care mode (seniors with dementia, Alzheimer's or similar)

A membership role (`cared_for`) granted per household by the household owner; a designated caregiver then configures the care plan. It inverts several default rules; the inversions are the design, not exceptions.

| Default rule | Care-mode behaviour | Why |
|---|---|---|
| Memory personalises the assistant | Memory *is* the person's external memory: who visited, whether they ate, who is coming, where things usually are; `explain_memory` becomes a primary spoken feature | The person's own memory is failing |
| Repeat detector → abstain / offer alternative | Answer the same question consistently and warmly every time; never "I already told you"; minimal variation | Repetition is expected; variation confuses |
| Provenance-gated proactivity | Absolute: only caregiver-entered or caregiver-confirmed facts may be stated; no inference about people or events, ever | Fabricated memories can implant false ones or cause distress |
| Be factually correct | Caregiver-set correction policy: correct for safety (stove, door, medication); redirect and reassure on reality-orientation topics (deceased spouse, "going home") | Standard dementia-care guidance: don't argue or re-inflict grief |
| Routines = convenience | Routines = orientation and safety: morning date/time/weather/plan/visitors; medication and meal reminders with spoken confirmation logged to caregiver; sundowning → wind-down context (dim, calm, fewer prompts) | Support daily functioning |
| Absence-of-check-in escalation | Extends to presence: door/motion at unusual hours (Ring/motion events) → caregiver alert | Wandering risk |
| Never-initiate on health | Unchanged in spirit: caregiver-authored reminders are explicit routines, not assistant-chosen topics. Document this so it isn't "fixed" later | Keeps the safety rule intact |
| Self-managed consent | Designated caregiver configures; the person is told plainly what is shared ("your daughter can see your reminders"); no covert-surveillance framing | Dignity and consent when capacity is limited |

Boundaries: not a medical device; no diagnosis; no inference of decline from behaviour; **no diagnosis stored** — only a caregiver-authored care plan (consistent with §4.2). Consider clinician/caregiver review of default phrasing before any real deployment. Post-hackathon direction: care-mode assistants for multigenerational households (strong fit for Malaysia/SEA).

## 6. Web console — what users can do once it's live

Purpose: make memory legible and controllable. Not a general-purpose chatbot.

**Every user (hackathon scope unless noted):**
- Memory browser — every fact with source, date, confidence, scope; edit / delete / mark wrong; filter by person, topic, time
- "What do you know about me" — plain-language summary page linked to underlying facts (same content as the voice answer)
- Rules manager — add, edit, expire, remove; conflicts explained; log of actions blocked by a rule
- Routines review — candidate routines with accept/dismiss; active and retired; broken-routine flags with reason
- Household transparency — members, scopes (person / household / device), guest and child settings (basic)
- Retention and export — retention window, delete by item/day/range, JSON export, temporary-mode toggle
- Action history and undo — everything done on the user's behalf, pre-flight confirmations, undo while window open (basic)
- Chat with your memory — text conversation over the same memory; handoff target for cross-device sessions (the simulator doubles as this)
- Context dashboard — live context scores, contributing signals, adjustable thresholds (demo-driven)
- Sources and devices — connect/disconnect event sources (Bee, phone, simulated Echo), last sync per device (basic)

**Caregiver view (care mode):**
- Care plan editor — orientation routine, medication/meal reminders, correction/redirect policy, escalation contacts
- Daily view — check-ins received, reminders confirmed/missed, unusual-hour door/motion events
- Alerts — missed confirmation/check-in notifications with adjustable delay
- Shared-view statement — what the person has been told is visible to the caregiver (explicit consent)

**Post-hackathon:** memory import/export between assistants; family shared-facts editor; per-topic notification preferences enforced via `device_state`; accessibility mode for the console; mobile-first caregiver view.

## 7. Demo script (≤3 min, lead with the best material)

Baseline (Direction A):
- 0:00–0:30 Problem: forgotten recipe, notes leaking to anyone on the account.
- 0:30–1:30 Two family members ask "what should we cook tonight?" in the simulated Alexa+; answers differ correctly via scoped recall. A guest gets household-only info.
- 1:30–2:15 "Forget that I'm on a diet" → console shows `valid_to` set; second simulated device replays the log and excludes it too.
- 2:15–2:45 Replay a Bee/Apple Watch HR stream → workout score crosses threshold → running-mix offer; fast-forward to 11pm → wind-down playlist proposed instead.
- 2:45–3:00 "Order dinner from the usual place" → `action_preflight` flags the address mismatch and asks to confirm; one-tap undo shown. Close on architecture slide with Bedrock/AgentCore.

(If the video runs long, cut the wind-down beat before the pre-flight beat — pre-flight answers the loudest complaint.)

Candidate beats: (a) open with `explain_memory` returning "no fact about your uncle — here is everything I hold, with sources" and `session_history` correcting a false "I already told you"; (b) caretaking check-in: mother says "Good morning" → family text; next day nothing by usual time → gentle prompt, then escalation; (c) care mode: orientation routine + medication reminder, same calm answer to a repeated question, missed confirmation → caregiver alert; (d) a stated rule ("no music after 10pm") blocking the wind-down offer — learning and hard rules working against each other correctly.

**Decision (2026-09-11):** keep two demo directions in parallel and choose at week 5 by which is more polished and lands better in a dry run:
- **Direction A — everyday routines and common issues:** scoped recall for two family members, forget that propagates, workout/wind-down music, pre-flight + undo, optionally beat (a) as the opener.
- **Direction B — elderly / care mode:** caregiver setup, orientation routine, consistent answers to repeated questions, medication confirmation, missed check-in escalation (beats b + c).

Shared core for both: persona memory, event log/sync, context engine, `explain_memory`, `session_history`, `device_state`. Build the shared core first; direction-specific polish (music policy vs. care-mode phrasing and caregiver view) happens in weeks 4–5 so neither is starved.

Console moments worth showing: fixing a wrong fact; a rule blocking an action; a caregiver catching a missed reminder.

## 8. Judging alignment

| Criterion | How we answer it |
|---|---|
| Tech implementation | Real MCP server on spec 2025-11-25 Streamable HTTP; Agent Skill; documented Bedrock/AgentCore use |
| Design | Offer-first proactivity, scoped answers, readable memory, forget that propagates |
| Potential impact | Directly addresses the most-cited Alexa+ flaws with evidence from reviews and competitors |
| Quality of idea | Memory + routines + sync as one user-owned layer, not a feature bolt-on |
| Bonus | Friction log kept from day one (up to 10% bonus); product feedback and feature requests |

## 9. Product and business model

Recall is a hosted, multi-tenant service (SaaS) with a self-hosted option, plugging into Alexa+ and later other assistants over MCP.

**Tenancy:** the **household** is the tenant (billing, data partition, device connections). A **person is a global account** with a `membership` row per household carrying a role: owner, adult, child, guest, caregiver, cared_for. Caregiver and cared_for are relationships to a specific household, so a person can be `cared_for` at home and an ordinary `adult` elsewhere. "Forget me" cascades across all memberships. Every household-owned table carries `household_id` from day one; every query filters on it. Region column for data residency (PDPA / GDPR / CCPA) from day one, even if unused.

**Caregiver permissions (decided 2026-09-11):** scoped grants, not blanket access — edit care plan, see daily view and alerts, enter/confirm facts tagged `source = caregiver`, set caregiver rules: yes by default. See the cared-for person's full memory: opt-in grant only. Read other members' memory: never. Revocation: household owner always; the cared-for person too, unless the owner has recorded a lack-of-capacity flag, which is itself visible to the person and logged. Caregiver rules with `severity = safety` outrank the person's own stated rules; all other precedence keeps the person first.

**Distribution:**
1. Hosted — free personal tier (one person, basic memory + rules); household tier (multi-person scoping, routines, devices, sync); care tier (caregiver view, alerts, care plan) — highest willingness to pay and clearest value.
2. Self-hosted — same container, run at home; required by the Open Source mini challenge; differentiator vs Amazon/Google ("your memory on your box, still works with Alexa+"); community-driven distribution.

**Build implications:** auth + per-household isolation in week 2 (magic link or passkeys); per-household bearer token on the MCP endpoint for the demo, OAuth later; usage metering on LLM calls to protect the free tier.

**Risks:** Amazon may build core memory in — defence is portability across assistants/devices and the care niche. No Alexa+ MCP access outside Preview yet — the product is portable memory with an Alexa+ integration ready; the hackathon is partly a bid for program access. Care tier carries duty-of-care, uptime and possible regulatory expectations — launch as "support tool, not medical device", one market first, with caregiver advisory input.

## 10. Six-week plan

| Week | Deliverable |
|---|---|
| 1 (–Sep 18) | Register; request $150 AWS credits; read MCP transport + Agent Skills docs; Docker Postgres+pgvector; NestJS MCP skeleton with `session_brief`/`remember`/`recall`; `LlmProvider` with local model; connect Claude Desktop as Alexa+ stand-in; start friction log |
| 2 | Data model with `household_id`/roles/region; auth (magic link) + per-household bearer token; pgvector; bi-temporal supersession; extraction via local LLM |
| 3 | Event log + HLC + cursors; speaker scoping; sensitivity filter; `forget` / `explain_memory`; `verify_claim` (confidence-gated answers); `communication_style` fact |
| 4 | Routine miner + context engine (workout, wind-down) with regression-guard signal; `action_preflight` + `undo`; simulated Alexa+ web app; AgentCore deployment |
| 5 | Console UI incl. household transparency view and retention/export controls; latency budgets + published numbers; Agent Skill packaging; license/README; optional Bee bridge; music policy; demo dry run and direction decision |
| 6 | Video (add pre-flight/undo beat); product feedback + Tier C feature requests with severity; submit by Oct 20 |

Scope discipline: before build starts, mark ~6 Tier A items as "must ship for the demo" and the rest as "ship if green by week 4", so the memory core is not starved by the long tail of fixes.

## 11. Open questions

Each question gets closed with an entry in the decision log (`architecture.md` §10).

| # | Question | Due | Status |
|---|---|---|---|
| 1 | Cross-household caregiver permissions — full memory or only care plan + daily view? Who can revoke (the person, another adult in that household)? | Week 1 (before DDL) | Closed 2026-09-11 — scoped grants; full memory opt-in; owner and person can revoke (capacity flag visible + logged) |
| 2 | Person identity — one global account with memberships per household, or a separate record per household? (Global fits caregivers; "forget me" must then cascade.) | Week 1 | Closed 2026-09-11 — global person + membership per household; forget-me cascades |
| 3 | Where care mode lives — flag on the person, or a role granted by the household owner? Can a person be in care mode in one household but not another? | Week 1 | Closed 2026-09-11 — membership role `cared_for`, granted per household |
| 4 | Event log retention — compaction policy (snapshot projections, drop raw events after N days) so the HLC/cursor design accounts for it | Week 1 | Closed 2026-09-11 — 90-day raw (configurable), nightly snapshots, re-sync from snapshot, tombstones retention+30d, sensitive raw 7d |
| 5 | Speaker resolution in the simulator — explicit `speaker_id` from the simulated device, or faked confidence from a hint string? | Week 3 | Open |
| 6 | Bee data reality check — can Bee CLI/MCP export Apple Watch heart-rate at useful granularity? If not, recorded stream only and no "real Bee data" claim in the video | Week 1–3 | Open |
| 7 | Routines write-back — offers only, or also create real Alexa+ Routines? | Week 3 | Open |
| 8 | Music metadata source — real provider (auth, quota) or mocked catalogue labelled honestly for the demo? | Week 3 | Open |
| 9 | Demo direction — A (everyday routines) vs B (care mode) after the dry run | Week 5 | Scheduled |
| 10 | Opener — forgotten-recipe problem beat vs `explain_memory` "no fact about your uncle" beat | Week 5 | Scheduled |
| 11 | Graph DB vs edge table | Post-hackathon | Deferred |
| 12 | OAuth for real Alexa+ integrations vs bearer token | Post-hackathon | Deferred |
| 13 | Pricing tiers; whether self-hosted lags hosted | Post-hackathon | Deferred |
| 14 | Clinical / caregiver review of care-mode phrasing | Before any real deployment | Deferred |

---

*Sources behind §1–2: Tom's Guide (Caswell, 3-month review; Gemini vs Alexa+ prompts test; Google Home Speaker review), Wirecutter, Consumer Reports (Wroclawski), The Verge (Tuohy), The Street (Kline), The Ambient (Alexa+ vs Gemini; Google Home Speaker review), Trusted Reviews, T3, Engadget, Automated Home, Google Home/Nest help pages, Home Assistant Voice PE reviews (Botmonster, Smart Home Solver), MacRumors/Macworld on Apple's 2026 home plans, FTC/DOJ 2023 Amazon COPPA settlement, r/alexa and r/AlexaPlus threads (2026), Mem0 (arXiv:2504.19413), Zep/Graphiti, MemGPT/Letta, Generative Agents, LoCoMo, LongMemEval, CHI 2024/2026 proactivity studies.*
