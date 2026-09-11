# Recall — Tech stack, environments and tooling

**Status:** Draft v0.1 — working document until we lock scope for build
**Owner:** Haz

Companion documents: `design.md` (problem, product, behaviour, demo, plan) · `architecture.md` (memory model, routines, context engine, sync, tools, latency, evaluation, decision log).

---

## 1. Stack summary

| Layer | Choice | Notes |
|---|---|---|
| MCP server | NestJS + TypeScript, MCP spec 2025-11-25+, Streamable HTTP transport | The required tech for the Alexa+ track; must be called in code, not just mentioned |
| Agent Skill | Same capability packaged as an Agent Skill | Works in Claude / Kiro; second qualifying path |
| Database | Postgres 16 + pgvector | Facts, events, routines, rules, entity edges, sync cursors; `household_id` + `region` on every table |
| Cache | In-process first; Redis if the multi-device sync demo needs it | Hot facts, context scores, per-device cursors |
| Job queue | BullMQ (Redis) or a lightweight Postgres-backed queue | Async extraction, consolidation, routine mining, context recompute |
| LLM | `LlmProvider` interface → local (Ollama / MLX), Anthropic API, Bedrock | Bedrock (Nova Lite) for the final week + video; local for iteration |
| Hosting (AWS) | AgentCore Runtime (container) | AWS Builder qualifier; document the integration |
| Console / simulator | Next.js (React) | Memory browser, rules, routines, context dashboard, caregiver view, simulated Alexa+ |
| Event producers | Node scripts replaying JSON event streams into `ingest_events` | Fake device ids + HLC; optional real Bee data via Bee CLI/MCP |
| Auth | Magic link (or passkeys); per-household bearer token on the MCP endpoint | OAuth later for real Alexa+ integrations |
| Licence | MIT | Open Source mini challenge; licence visible in repo About |
| Language/runtime | Node 22, TypeScript strict | pnpm workspaces monorepo |

## 2. Repository layout (proposed)

```
recall/
  apps/
    mcp-server/        NestJS — MCP tools, projections, workers
    console/           Next.js — memory browser, rules, routines, caregiver view, simulator
  packages/
    core/              domain types, fact/rule/routine models, HLC, projections
    llm/               LlmProvider + adapters (ollama, anthropic, bedrock)
    miner/             routine mining (clustering, sequence mining, decay)
    context/           context engine (scores, thresholds, exits)
    skill/             Agent Skill packaging
  scripts/
    replay/            event stream replay (heart rate, door, check-in, playback)
    seed/              demo household seed data
  docker/
    docker-compose.yml postgres+pgvector, redis (optional), server, console
  docs/
    design.md, architecture.md, techstack.md, friction-log.md, feedback.md
```

## 3. Local-first development (before AWS credits)

Build and test entirely local; AWS is a deployment step, not an architecture change.

| Component | Local | AWS (later) |
|---|---|---|
| Database | Postgres + pgvector in Docker (`pgvector/pgvector:pg16`) | RDS or container |
| Cache / queue | In-process; Redis only if needed | ElastiCache or same |
| MCP server | NestJS on localhost, Streamable HTTP | AgentCore Runtime (container) |
| LLM (extraction / consolidation / reasoning tools) | `LlmProvider` → Ollama or MLX on Apple Silicon (Qwen3 8B / Gemma 4; must support tool calling; avoid think-mode models for latency) or Anthropic API | Bedrock (Nova Lite for extraction) via env var switch |
| Alexa+ stand-in (weeks 1–3) | Claude Desktop / Claude Code connected to the MCP server — real tool-calling behaviour; validates the `session_brief` single-call design and tool descriptions | Simulated Alexa+ web app (weeks 4–5) |
| Devices | Replay scripts feeding JSON event streams into `ingest_events` | Same scripts, optional real Bee data |

Keep AWS-shaped from day one:
1. Dockerfile for the server — AgentCore deploys a container; if it runs in Docker locally it runs there.
2. `LlmProvider` abstraction — Bedrock is a config switch, not a refactor.
3. 12-factor env config (`DATABASE_URL`, `LLM_PROVIDER`, `AWS_REGION`, `HOUSEHOLD_TOKEN_SECRET`) — no localhost assumptions in code.
4. Bedrock adapter written and documented early (free import) so the switch is one line; the mini challenge wants documented integrations.

Keep development iteration on the local model; switch to Bedrock for the final week and the video. Don't burn the $150 credit / free tier on dev iteration.

## 4. AWS deployment (when credits land)

- Deploy the server container to **AgentCore Runtime**; keep instances warm (cold starts are the silent demo killer).
- `LLM_PROVIDER=bedrock`, model Nova Lite for extraction; Claude on Bedrock for `action_preflight` / `propose_action` if budget allows.
- Postgres: RDS or keep it containerised; persistent connection pool.
- Region: same as the Alexa+ endpoint (us-east-1 for US); co-locate simulator and server for the video.
- Optional: Strands SDK for the orchestrator + worker pattern (extractor, consolidator, pre-flight checker, explainer) — one orchestrator, stateless workers; agents never hold their own memory or talk to each other.
- Re-run the same replay scripts on AWS; log any p95 regression in the friction log.
- Request the $150 credits via the hackathon form; AWS free tier covers demo-volume Bedrock usage.

## 5. Latency budgets (enforced in CI where possible)

| Tool | Budget |
|---|---|
| `session_brief` | < 400 ms p95 |
| `recall` | < 300 ms p95 |
| `get_context`, `device_state`, `list_rules`, `session_history` | < 100 ms p95 |
| `remember` (ack) | < 100 ms; extraction async |

Publish p50/p95 per tool in the README and on the console dashboard. Design levers are in `architecture.md` §7.

## 6. Tooling and references

- MCP: Streamable HTTP transport — https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http
- Agent Skills — https://apps.extensions.modelcontextprotocol.io/api/#build-with-agent-skills
- Amazon Devices Builder Tools (MCP server + Agent Skills for coding assistants) — linked from the hackathon Resources page
- Bee developer docs (CLI, MCP, Skill) — https://docs.bee.computer/ ; `bee-cli`, `bee-skill` on GitHub
- AWS Builder Center — https://builder.aws.com/ (Bedrock, AgentCore, Strands, Kiro tutorials)
- Hackathon — https://amazonappdev2026.devpost.com/ (Rules, Resources, office hours)
- Local LLM: Ollama or MLX; community-tested models for tool calling: Qwen3 family, Gemma 4, GPT-OSS 20B

## 7. Submission checklist (technical)

- Public GitHub repo, MIT licence visible in About, full source + run instructions
- Repo actually calls MCP (Streamable HTTP) in code — entry point and loaded MCP config, not just README mentions
- Agent Skill present and shown in the video
- Simulated Alexa+ source included if that path is used
- Demo video < 3 min, public, English, no third-party trademarks/music
- Product feedback for every tool/API/SDK used (incl. which AWS services and how)
- Open Source mini challenge fields: contribution URL, repo URL, GitHub username, description
- Friction log entries (task, steps, expected vs actual, severity, workaround, suggestion) — up to 10% bonus
- Feature requests with urgency (critical / important / nice-to-have)
