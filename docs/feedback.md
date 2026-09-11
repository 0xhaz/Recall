# Product feedback and feature requests

Every tool, API and SDK used, what we used it for, and what would have helped. Feature requests carry urgency: critical / important / nice-to-have.

## Tools and SDKs used

| Tool / API / SDK | Used for | Feedback |
|---|---|---|
| MCP TypeScript SDK (`@modelcontextprotocol/sdk`) | Streamable HTTP server for all Recall tools | _(fill in as we go)_ |
| Ollama (`qwen3:8b`) | Local LLM for extraction during development | _(fill in as we go)_ |
| Amazon Bedrock (Nova Lite) | Production extraction / consolidation | _(week 6)_ |
| Amazon Bedrock AgentCore Runtime | Hosting the MCP server container | _(week 4–6)_ |

## Feature requests (Tier C and others)

| Request | Urgency | Evidence |
|---|---|---|
| Kindle Assistive Reader media controls by voice on Alexa+ | critical | Accessibility regression; works via app only (design.md §1.1) |
| Deterministic smart-home routing for simple intents (small-model routing, local execution) | important | 10–15 s latency; late "Timer started" (architecture.md §7.1) |
| Streaming TTS | important | Latency becomes an honesty problem when acknowledgements arrive late |
| Honest answer on reverting to classic Alexa | important | Users told it isn't possible; "Alexa, cancel Alexa plus" works |
| False-wake / unprompted interjection fixes | important | Community reports (design.md §1.1) |
| Restore lost legacy features (breathing exercises, BBC radio phrasing) | nice-to-have | Community reports |
| Companion app quality | important | Consumer Reports review |
| Developer sandbox for Alexa+ MCP servers | critical | No path to test outside Preview |
