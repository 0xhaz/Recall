# Product feedback and feature requests

Every tool, API and SDK used, what we used it for, and what would have helped. Feature requests carry urgency: critical / important / nice-to-have.

## Tools and SDKs used

| Tool / API / SDK | Used for | Feedback |
|---|---|---|
| MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30) | Stateless Streamable HTTP server for all Recall tools; client in tests and the smoke script | The bundled stateless example got us running quickly. `registerTool` with zod shapes keeps schema and validation in one place. We build one `McpServer` per request to bind the caller's household; overhead is negligible (warm `session_brief` round trip 6–8 ms). |
| Ollama with `qwen3:8b` | Local fact extraction and the dedupe judge during development | Tool calling and JSON-schema `format` output were reliable. Weak at calendar maths: it computed "until Wednesday" wrongly and copied dates from the worked example, so dates are now resolved in code. Warm extraction about 4 s; cold model load about 17 s. |
| Ollama with `qwen3-embedding:0.6b` | 1024-dim embeddings for dedupe | Cleanly separates unrelated facts (cosine ≤ 0.68) from related ones (≥ 0.77), but duplicates and real updates overlap (0.95–0.99), so an LLM judge is still needed. |
| Bee developer tools (CLI, MCP, Skill) | Researched as a real heart-rate source for the workout context | No heart-rate or biometric data is exposed; transcripts, facts, todos, locations and a live event stream are. We replay a recorded heart-rate stream instead. |
| Amazon Bedrock (Nova Lite, Titan Text Embeddings V2) | Production extraction and embeddings | _(week 6)_ |
| Amazon Bedrock AgentCore Runtime | Hosting the MCP server container | _(weeks 4–6)_ |

## Feature requests (Tier C and others)

| Request | Urgency | Evidence |
|---|---|---|
| Kindle Assistive Reader media controls by voice on Alexa+ | critical | Accessibility regression; works via app only (design.md §1.1) |
| Developer sandbox for Alexa+ MCP servers | critical | No path to test outside Preview |
| Deterministic smart-home routing for simple intents (small-model routing, local execution) | important | 10–15 s latency; late "Timer started" (architecture.md §7.1) |
| Streaming TTS | important | Latency becomes an honesty problem when acknowledgements arrive late |
| Honest answer on reverting to classic Alexa | important | Users told it isn't possible; "Alexa, cancel Alexa plus" works |
| False-wake / unprompted interjection fixes | important | Community reports (design.md §1.1) |
| Companion app quality | important | Consumer Reports review |
| Heart-rate / workout events from the Bee Apple Watch app in `bee stream` | important | Would let Recall's workout context use real signals instead of a replayed stream |
| Restore lost legacy features (breathing exercises, BBC radio phrasing) | nice-to-have | Community reports |
