# Recall

A user-owned memory layer for Alexa+ and any other agent, served as an MCP server over Streamable HTTP.
Per-person, inspectable, editable, forgettable memory that stays consistent across every device in the house.

**Status:** week 2 of 6 — scoped memory with async extraction, per-household tokens, console sign-in. See [docs/workplan.md](docs/workplan.md).

## Quickstart

Requires Node 22+, pnpm 9, Docker, and [Ollama](https://ollama.com) with two models:
`ollama pull qwen3:8b` (extraction) and `ollama pull qwen3-embedding:0.6b` (embeddings).

```sh
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 16 + pgvector on localhost:5435
pnpm db:migrate
pnpm db:seed        # demo households, plus RECALL_DEV_TOKEN as an MCP token for the demo household
pnpm dev            # MCP server on http://127.0.0.1:3100/mcp, extraction worker in-process
pnpm smoke          # in another terminal: calls the tools the way an assistant would
pnpm test           # unit + end-to-end on a separate <db>_test database
```

`GET /health` reports database and LLM reachability.

The demo seed has one household with Aisyah (owner), Daniel (adult), Sofia (child), Mak Som (cared for), Ravi (guest)
and Farah (caregiver, who owns a separate household of her own).

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

Try: *"I'm Aisyah — what should we cook tonight?"*, then the same as Daniel, then without saying who you are.
Then *"I'm Daniel, remember I'm off coffee until Wednesday"* and ask again a few seconds later.

## Tools

| Tool | What it does |
|---|---|
| `session_brief` | The first call for any request: local date/time, who is speaking, the most relevant facts with provenance |
| `recall` | Ranked facts visible to the speaker (their own + household); household-only when the speaker is unknown or unconfirmed |
| `remember` | Screens, stores and acknowledges at once; facts are extracted in the background. Refuses for guests and unknown speakers |

Every tool takes `speaker` and an optional `speaker_confidence` (a voice-match score). Below 0.7 the speaker is treated
as unknown and `session_brief` returns `speaker_candidate`, so the assistant can ask "Is this Aisyah?".
The full planned tool surface is in [docs/architecture.md §6](docs/architecture.md).

## How memory is written

1. **Screen** — clauses with card numbers, passwords, account or ID numbers, or diagnoses are dropped. They are never stored and never sent to a model.
2. **Queue** — the screened statement is stored as an utterance with an extraction job, and `remember` returns. Until the job runs, the statement is recallable as `pending_extraction`.
3. **Extract** — the LLM drafts facts. Deterministic rules then set scope, confidence, sensitivity and expiry: a fact goes to household scope only when it was said collectively, and "until Wednesday" is resolved to a date by code.
4. **Dedupe** — similar existing facts go to an LLM judge. A restatement raises confidence, a change supersedes the old fact (closed and linked, never deleted), anything else is inserted.

LLM calls are metered per household per day (`llm_usage`).

## Console API (week 2)

| Endpoint | |
|---|---|
| `POST /auth/magic-link` `{email}` | Sends a single-use sign-in link (logged to the server console in dev) |
| `POST /auth/verify` `{token}` | Exchanges the link for a 30-day session token |
| `GET /me` | The signed-in person and their household memberships |
| `POST /households/:id/tokens` `{label}` | Owner only: mint an MCP token for a device or assistant (shown once) |
| `DELETE /households/:id/tokens/:tokenId` | Owner only: revoke it |

## Tests

- `pnpm test` runs everything against `<db>_test` (created, migrated and wiped automatically), using a scripted LLM and a deterministic embedder, so no model is needed.
- `RECALL_LIVE_LLM=1 pnpm --filter @recall/mcp-server exec vitest run extraction.live` checks the prompts against the real local model.

## Layout

```
apps/mcp-server/   NestJS MCP server: tools, memory, extraction worker, auth, migrations, Dockerfile
packages/core/     domain types, sensitivity screen, access rules, calendar helpers
packages/llm/      LlmProvider + Embedder: Ollama (local), Bedrock (switch via LLM_PROVIDER)
docker/            docker-compose: Postgres + pgvector; `--profile full` adds the server
docs/              design, architecture, tech stack, work plan, friction log, feedback
```

## Conventions

- **Explicit `@Inject(token)` on every Nest constructor dependency.** `tsx` and `vitest` compile with esbuild, which doesn't emit decorator metadata.
- Workspace packages export their TypeScript source under the `development` condition; `pnpm build` produces `dist/` for containers.
- Every household-owned table carries `household_id` and `region`; every query filters on `household_id`.
- The LLM never runs on the read path. It only drafts; deterministic code decides what is stored.
- SQL migrations live in `apps/mcp-server/migrations/` and run in filename order.

## Licence

[MIT](LICENSE)
