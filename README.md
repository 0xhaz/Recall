# Recall

A user-owned memory layer for Alexa+ and any other agent, served as an MCP server over Streamable HTTP.
Per-person, inspectable, editable, forgettable memory that stays consistent across every device in the house.

**Status:** week 1 of 6 — skeleton MCP server with `session_brief`, `recall`, `remember`. See [docs/workplan.md](docs/workplan.md).

## Quickstart

Requires Node 22+, pnpm 9, Docker, and [Ollama](https://ollama.com) with `qwen3:8b` (`ollama pull qwen3:8b`).

```sh
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 16 + pgvector on localhost:5435
pnpm db:migrate
pnpm db:seed        # demo household: Aisyah (owner), Daniel (adult), Sofia (child)
pnpm dev            # MCP server on http://127.0.0.1:3100/mcp
pnpm smoke          # in another terminal: calls the tools the way an assistant would
pnpm test           # unit + end-to-end (needs the database up)
```

`GET /health` reports database and LLM reachability.

## Connect an assistant

Weeks 1–3 use Claude as the Alexa+ stand-in. The endpoint expects `Authorization: Bearer $RECALL_DEV_TOKEN`.

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

## Tools (week 1)

| Tool | What it does |
|---|---|
| `session_brief` | The first call for any request: local date/time, who is speaking, the most relevant facts with provenance |
| `recall` | Ranked facts visible to the speaker (their own + household); household-only when the speaker is unknown |
| `remember` | Stores what the speaker said, scoped to them or the household; refuses for guests and unknown speakers |

The full tool surface is in [docs/architecture.md §6](docs/architecture.md).

## Layout

```
apps/mcp-server/   NestJS MCP server (Streamable HTTP), migrations, Dockerfile
packages/core/     domain types, temporal stamp
packages/llm/      LlmProvider: Ollama (local), Bedrock (switch via LLM_PROVIDER)
docker/            docker-compose: Postgres + pgvector; `--profile full` adds the server
docs/              design, architecture, tech stack, work plan, friction log, feedback
```

## Conventions

- **Explicit `@Inject(token)` on every Nest constructor dependency.** `tsx` and `vitest` compile with esbuild, which doesn't emit decorator metadata.
- Workspace packages export their TypeScript source under the `development` condition; `pnpm build` produces `dist/` for containers.
- Every household-owned table carries `household_id` and `region`; every query filters on `household_id`.
- SQL migrations live in `apps/mcp-server/migrations/` and run in filename order.

## Licence

[MIT](LICENSE)
