# Recall

A user-owned memory layer for Alexa+ and any other agent, served as an MCP server over Streamable HTTP.
Per-person, inspectable, editable, forgettable memory that stays consistent across every device in the house.

**Status:** week 4 of 6 — memory, stated rules, forgetting that reaches every device, device sync, honesty tools, routines
with check-ins, and the context engine with music. See [docs/workplan.md](docs/workplan.md).

## Quickstart

Requires Node 22+, pnpm 9, Docker, and [Ollama](https://ollama.com) with two models:
`ollama pull qwen3:8b` (extraction and rule parsing) and `ollama pull qwen3-embedding:0.6b` (embeddings).

```sh
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 16 + pgvector on localhost:5435
pnpm db:migrate
pnpm db:seed        # demo households and devices, plus RECALL_DEV_TOKEN as an MCP token for the demo household
pnpm dev            # MCP server on http://127.0.0.1:3100/mcp, background jobs in-process
pnpm smoke          # in another terminal: calls the tools the way an assistant would
pnpm test           # unit + end-to-end on a separate <db>_test database
```

`GET /health` reports database and LLM reachability; `GET /metrics/latency` reports p50/p95 per tool against its budget.

The demo seed has one household with Emma (owner), Daniel (adult), Sofia (child), Ruth (cared for), Tom (guest)
and Nina (caregiver, who owns a separate household of her own), and three devices: `kitchen-echo`, `bedroom-echo`
(Ruth's) and `living-firetv`.

## Connect an assistant

Weeks 1–3 use Claude as the Alexa+ stand-in. The endpoint expects `Authorization: Bearer <household token>`;
after `pnpm db:seed`, `RECALL_DEV_TOKEN` is one for the demo household.

**Claude Code** — this repo ships a project [`.mcp.json`](.mcp.json); open the repo in Claude Code and approve the `recall` server. Or add it by hand:

```sh
claude mcp add --transport http recall http://localhost:3100/mcp --header "Authorization: Bearer dev-token-change-me"
```

**Claude Desktop** — bridge the HTTP endpoint with `mcp-remote` in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "recall": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3100/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer dev-token-change-me" }
    }
  }
}
```

Things to try, speaking as someone from the demo household:

- *"I'm Emma — what should we cook tonight?"*, then the same as Daniel, then without saying who you are.
- *"I'm Daniel, remember I'm off coffee until Wednesday"*, then ask again a few seconds later.
- *"Emma here. No music after 10pm on school nights."* Then, as Daniel: *"Always play music when I work out."*
- *"What do you know about me?"* and *"Do you know anything about my uncle?"*
- *"Forget that I'm off coffee."*

## Agent Skill

`packages/skill` packages the same capability as an Agent Skill: not a second implementation, but
instructions for an agent that already has the MCP tools — which to call first, what the brief's
ordering means, and what not to say. The rules that make Recall behave (answer from the speaker's
own facts, ask rather than guess an unrecognised voice, quote the rule that blocked something, never
claim an action is done unless `decide_action` returned `executed`) live there rather than in each
assistant's prompt.

```
packages/skill/
  SKILL.md               how to use Recall, and the mistakes worth avoiding
  references/tools.md    the full tool surface and which to reach for
  references/http.md     calling Recall over HTTP when no MCP client is connected
```

Point a Claude Code or Claude Desktop skills directory at it, or copy the folder in. The
`references/` files load on demand, so the instructions stay short until something needs the detail.

## Console

With the server running, `pnpm console` serves the console on http://localhost:3000: what Recall remembers, and the
controls over it.

- **Memory** — every fact with where it came from, how sure it is, and whose it is. Fix one and the old wording is kept
  as history; forget one and the tombstone reaches every device.
- **Rules** — your rules word for word, and the log of what each one blocked.
- **Routines** — what the miner noticed, waiting for a yes or no, plus the ones that have stopped working.
- **Actions** — everything done on your behalf, what pre-flight asked first, and undo while the window is open.
- **Context** — live scores with what raised them, quiet hours, and each person's learned thresholds.
- **People, devices, settings** — who can see what, what has synced, how long raw events are kept, and a JSON export.
- **Care** — for someone being cared for: the correct/redirect policies in the caregiver's own words, the day's
  check-ins, and the alerts that went out.

Sign in with a magic link. In development the mailer prints the link in the Recall server log; the demo owner is
`emma@demo.recall.local`.

## Simulated Alexa+

With the server running (`pnpm dev`), `pnpm sim` serves a stand-in for Alexa+ on http://127.0.0.1:3200. It has:

- two devices side by side, each keeping its own synced view of household memory
- a speaker picker and a voice-match slider, standing in for Voice ID
- browser speech in and out
- buttons for simulated device events: coffee machine, lights, phone, Ring, front door, sleep
- replays

The assistant is `qwen3:8b` with tool calling. Its only memory is Recall over MCP, and every reply shows the Recall
calls it made. Commands Recall sends (play this, undo that) are carried out by the simulated device, which reports
back what it did.

Replays are JSON streams in [`apps/simulator/replays`](apps/simulator/replays). They run from the page or the terminal:

- `pnpm replay mornings`: three weeks of routine history
- `pnpm replay heart-rate`: a 4-minute run, in real time
- `pnpm replay checkins`, `pnpm replay evening` and `pnpm replay door-night`

## Tools

Every tool that concerns a person takes `speaker` and an optional `speaker_confidence` (a voice-match score). Below
0.7 the speaker is treated as unknown: only household memory is used, and `session_brief` returns `speaker_candidate`
so the assistant can ask "Is this Emma?". Every read carries the device-local date and time.

| Tool | What it does |
|---|---|
| **Memory** | |
| `session_brief` | The first call for any request: local time, who is speaking and how they like to be spoken to, the rules that apply, relevant facts with provenance, the conversation in progress (even from another device), device state |
| `recall` | Facts visible to the speaker, ranked by meaning and shared words |
| `remember` | Screens, stores and acknowledges at once; facts are extracted in the background |
| `forget` | Forgets for good on every device, by topic or id; asks when the match is unclear |
| `explain_memory` | What is kept about the speaker and the household, with sources; "nothing stored about …" when there is nothing |
| `verify_claim` | Evidence on record for a claim (and what changed), for the assistant to compare before asserting anything |
| `set_communication_style` | The person's tone dial: brief, no commentary, humour or emotion-labelling unless they ask |
| **Rules** | |
| `set_rule` | Saves a stated rule verbatim with its structured form; reports conflicts, never resolves them |
| `list_rules` / `remove_rule` | Rules in force, word for word; only the author (or a caregiver) removes one |
| **Context and care** | |
| `get_context` | Context scores (workout, wind-down, party, festive, focus) with their reasons, quiet hours, and routines due soon or not working |
| `set_context` | "Workout mode" / "stop workout mode": wins over the signals for a while and calibrates the person's trigger |
| `suggest_music` | Picks for the live context from a mock catalogue, ranked by fit and what this person plays or skips in that context; nothing when a rule forbids music |
| `checkin` | "I'm up" / "good morning": recorded, and the carers are told; a missed usual check-in prompts the person, then the carers |
| `set_care_policy` | A caregiver's instruction for a topic with the person they care for: correct (safety) or redirect (reassure, turn to something familiar) |
| **Actions** | |
| `action_preflight` | Before any order, booking, ride, call or device change: rules (quoted), quiet hours, the address on record, venues used before, repeat orders, unusual amounts and routine clashes decide whether to allow it, confirm specific things first, or block it |
| `propose_action` | At most one offer, with its source: a routine that's due, the next step of a routine chain, or music for the live context. Nothing in quiet hours; after two accepts, low-risk ones just start |
| `decide_action` | The person's answer: confirm carries it out with an undo window, dismiss teaches the offer to back off |
| `undo` | Takes back the latest action while its window is open; device changes are reversed with the inverse command |
| **Devices** | |
| `resolve_speaker` | Simulated Voice ID: a confident match is the speaker; a weak match or the device's usual person is a candidate |
| `ingest_events` | Device reports (media, timers, alarms, subscriptions, conversation turns, sensors), idempotent and HLC-ordered |
| `sync` | Events since a cursor, or a snapshot once the log it needs has been compacted |
| `device_state` | The only source for what is playing, timers, alarms, subscriptions and features |
| `session_history` | The actual conversation log, before any claim about what was said |

The full planned tool surface is in [docs/architecture.md §6](docs/architecture.md).

## How it works

**Writing memory.** A deterministic screen drops card numbers, passwords, account or ID numbers and diagnoses before
anything is stored or sent to a model. The statement is stored and queued; until extraction runs it is recallable as
`pending_extraction`. The model drafts facts, and code decides scope, confidence, sensitivity and expiry ("until
Wednesday" is resolved to a date by code). Similar existing facts go to a model judge: a restatement raises confidence,
a change supersedes the old fact (closed and linked, never deleted).

**Forgetting.** A tombstone reaches every device, and the words are erased from the fact, the history it replaced, the
statement it came from, past events and snapshots. A statement recorded before the forget can't bring it back.

**Devices.** The event log is the source of truth. Devices sync by the server's sequence number, merge by hybrid logical
clock, and restart from a snapshot once old events are compacted (raw events are kept 7 days in this build). Raw health
signals never leave the server.

**Context.** Heart rate, motion, lights, charging, noise, voices, arrivals and sleep become scores for a few named
contexts, recomputed by a background job. A context switches on only after its score holds, and off only after it has
stayed low, so a flight of stairs isn't a workout. Thresholds are relative to the person's own resting rate. Only
scores and thresholds are kept; raw heart rate is deleted after 7 days. Wind-down or sleep sets quiet hours.

**Actions.** Anything done on someone's behalf is checked first, recorded, and can be undone for a while. Offers come
only from a routine or a live context, carry their source, never come during quiet hours, and never raise health,
money or loss. Anything that costs money is only ever drafted for the person to confirm.

**Care mode.** For someone being cared for, the defaults invert. They are told only what a caregiver entered. A
repeated question gets the same warm answer as earlier that day, never "I already told you". Safety topics are
corrected, and painful ones redirected the way the caregiver asked. A door or movement at night that isn't usual tells
the carers. `session_brief` also says plainly who can see what.

**Rules.** Rules are law, learned memory is evidence. Precedence: a caregiver's safety rule for a cared-for person, then
a parent's rule for a child, then the person's own and household rules (the most restrictive wins), then other
caregiver rules, then anything learned.

LLM calls are metered per household per day (`llm_usage`). The model never runs on the read path.

## Console API

| Endpoint | |
|---|---|
| `POST /auth/magic-link` `{email}` | Sends a single-use sign-in link (logged to the server console in dev) |
| `POST /auth/verify` `{token}` | Exchanges the link for a 30-day session token |
| `GET /me` | The signed-in person and their household memberships |
| `POST /me/forget` `{confirm: "forget me"}` | Erases the person's memory in every household and revokes their access |
| `POST /households/:id/tokens` `{label}` | Owner only: mint an MCP token for a device or assistant (shown once) |
| `DELETE /households/:id/tokens/:tokenId` | Owner only: revoke it |

## Tests

- `pnpm test` runs everything against `<db>_test` (created, migrated and wiped automatically) with a scripted LLM and a
  deterministic embedder, so no model is needed. It includes a latency check that fails if any read tool's server-side
  p95 exceeds its budget.
- `RECALL_LIVE_LLM=1 pnpm --filter @recall/mcp-server exec vitest run extraction.live rules.live` checks the extraction
  and rule-parsing prompts against the real local model.

## Layout

```
apps/mcp-server/   NestJS MCP server: tools, memory, rules, event log, sync, jobs, auth, migrations, Dockerfile
packages/core/     domain logic without I/O: clock, device projection, rules engine, sensitivity screen, access rules
packages/llm/      LlmProvider + Embedder: Ollama (local), Bedrock (switch via LLM_PROVIDER)
docker/            docker-compose: Postgres + pgvector; `--profile full` adds the server
docs/              design, architecture (with the decision log), tech stack, work plan, friction log, feedback
```

## Conventions

- **Explicit `@Inject(token)` on every Nest constructor dependency.** `tsx` and `vitest` compile with esbuild, which doesn't emit decorator metadata.
- Workspace packages export their TypeScript source under the `development` condition; `pnpm build` produces `dist/` for containers.
- Every household-owned table carries `household_id` and `region`; every query filters on `household_id`.
- Every transaction that writes events takes the household lock first (`lockHousehold`).
- The model only drafts; deterministic code decides what is stored.
- SQL migrations live in `apps/mcp-server/migrations/` and run in filename order.

If the dev server seems to be running old code after large changes, restart `pnpm dev`: `tsx watch` occasionally misses new files.

## Licence

[MIT](LICENSE)
