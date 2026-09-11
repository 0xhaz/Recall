# Friction log

Format per entry (hackathon bonus, up to 10%): task · steps · expected vs actual · severity (critical / high / medium / low) · workaround · suggestion.

---

## 2026-09-11 — Connecting a local MCP server to Claude Desktop over Streamable HTTP

- **Task:** Use Claude Desktop as the Alexa+ stand-in against a localhost Streamable HTTP MCP server.
- **Steps:** Looked for a way to point `claude_desktop_config.json` at `http://localhost:3100/mcp`.
- **Expected:** A native `url` entry for Streamable HTTP servers in the desktop config.
- **Actual:** The desktop config launches stdio servers; remote connectors expect a publicly reachable URL.
- **Severity:** low
- **Workaround:** Bridge with `npx mcp-remote http://localhost:3100/mcp`, or use Claude Code (`claude mcp add --transport http ...`), which supports HTTP directly.
- **Suggestion:** Allow local Streamable HTTP URLs (with headers) in the desktop config.

## 2026-09-11 — No Alexa+ MCP connection outside the Preview program

- **Task:** Test Recall against real Alexa+ tool calling.
- **Steps:** Read the hackathon resources for a developer path to connect a custom MCP server to Alexa+.
- **Expected:** A sandbox or test account where Alexa+ calls a registered MCP endpoint.
- **Actual:** No public path; we build against Claude as a stand-in and a simulated Alexa+ web app.
- **Severity:** high
- **Workaround:** Claude Desktop/Code in weeks 1–3; simulated Alexa+ (browser speech in/out) from week 4.
- **Suggestion:** A developer sandbox for Alexa+ MCP integrations with a latency trace per tool call.
