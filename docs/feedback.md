# Product feedback and feature requests

Answers the five questions the submission form asks, in order, then the feature requests. Feature
requests carry urgency: critical / important / nice-to-have.

Everything here is from building Recall between September and October 2026: a user-owned memory
layer for Alexa+, served as an MCP server, deployed on AWS.

## 1. Which developer tools, APIs and SDKs did you use, and for what?

| Tool / API / SDK | Used for | Feedback |
|---|---|---|
| MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30) | Stateless Streamable HTTP server for all Recall tools; client in tests and the smoke script | The bundled stateless example got us running quickly. `registerTool` with zod shapes keeps schema and validation in one place. We build one `McpServer` per request to bind the caller's household; overhead is negligible (warm `session_brief` round trip 6–8 ms). |
| Ollama with `qwen3:8b` | Local fact extraction and the dedupe judge during development | Tool calling and JSON-schema `format` output were reliable. Weak at calendar maths: it computed "until Wednesday" wrongly and copied dates from the worked example, so dates are now resolved in code. Warm extraction about 4 s; cold model load about 17 s. |
| Ollama with `qwen3-embedding:0.6b` | 1024-dim embeddings for dedupe | Cleanly separates unrelated facts (cosine ≤ 0.68) from related ones (≥ 0.77), but duplicates and real updates overlap (0.95–0.99), so an LLM judge is still needed. |
| Bee developer tools (CLI, MCP, Skill) | Researched as a real heart-rate source for the workout context | No heart-rate or biometric data is exposed; transcripts, facts, todos, locations and a live event stream are. We replay a recorded heart-rate stream instead. |
| Amazon Bedrock (Nova Lite, Titan Text Embeddings V2) | Production extraction, dedupe judging and embeddings | Nova Lite via the Converse API replaced local `qwen3:8b` and beat it on our own extraction set (3/4 vs 0/4 on scoping, 3/4 vs 2/4 on dates, 4/4 vs 2/4 on action pre-flight), at roughly a tenth of the latency. JSON output needs a forced tool call — `responseFormat` is not on Converse — which is a fine workaround but an odd thing to have to discover. Converse also rejects consecutive same-role turns and an opening assistant turn, so a transcript that reads fine to a human needs reshaping before it is a valid request; the error says which turn but not which rule. Titan v2 embeddings sit on a very different similarity scale from qwen (a real match scores ~0.31 where qwen scores ~0.78), so every retrieval threshold had to be recalibrated per model rather than per codebase — worth a line in the docs, because a threshold that looks conservative for one model silently returns nothing for the other. |
| AWS App Runner | Hosting the MCP server and console containers | Container to public HTTPS with no load balancer or cluster to manage, which is the right shape for this. Three things cost us time and would be cheap to surface: it runs x86_64 only, and an arm64 image fails at runtime with `exec format error` rather than being rejected at deploy; a `docker buildx` image with the default attestations produces `unknown/unknown` manifest entries that App Runner pulls and then fails on with no log output at all (`--provenance=false --sbom=false` fixes it); and `update-service` does not re-pull a moved `:latest` tag — `start-deployment` is required, which is easy to miss when the console shows the service as updated. App Runner also injects `HOSTNAME` into the container, which silently breaks any server that reads it as a bind address (Next.js does). The 2-service quota on a new account is low enough that we had to co-locate the simulator inside the console container. |
| Amazon SES | Magic-link sign-in for the console | Straightforward to send, but from inside a VPC with no NAT there is no route to the SES endpoint and the SDK simply hangs for its full retry budget — about 60 s — rather than failing fast. An interface endpoint (`com.amazonaws.<region>.email`) fixes it; an unreachable-endpoint error instead of a hang would have saved an hour. Sandbox mode is the right default, but the per-identity verification requirement is easy to conflate with production access when debugging a non-delivery. |
| Amazon Polly | The simulated Alexa+ speaking its answers | Two engines were worth measuring rather than assuming: warm, `neural` Joanna averaged 1.8 s and `generative` Joanna 2.2 s for a one-sentence reply, so the quality difference costs about 400 ms rather than the 2× a cold first call suggests. The one thing worth documenting more loudly is that **Alexa's own voices are not available in Polly** — they were built for Alexa and are not in the catalogue. That is a reasonable decision, but every developer building an Alexa-adjacent demo will look for them first; a line in the Polly voice list saying so would save the search. |
| Amazon RDS for PostgreSQL (pgvector 0.8.2) | Facts, vectors and the job queue | pgvector at the current version on a managed instance with nothing to install was the single smoothest piece of the stack. |

## 2. What worked well?

**pgvector on managed Postgres was the single smoothest piece of the stack.** Current version, nothing
to install, and it meant one database for facts, vectors, the job queue and the event log instead of
four moving parts.

**The MCP TypeScript SDK's stateless Streamable HTTP example got us running in an afternoon.**
`registerTool` with zod shapes keeps the schema and its validation in one place, so the tool
description a model reads and the parsing it gets are never out of step. Building one `McpServer`
per request to bind the caller's household costs nothing measurable — a warm `session_brief` round
trip is 6–8 ms locally, 10 ms p50 deployed.

**App Runner is the right shape for this.** Container to public HTTPS with no load balancer, no
cluster, no YAML.

**Bedrock's model swap was genuinely a config change.** Moving extraction from a local `qwen3:8b` to
Nova Lite meant one provider class and an environment variable, and it beat the local model on our
own scoring set: 3/4 vs 0/4 on scoping, 3/4 vs 2/4 on dates, 4/4 vs 2/4 on action pre-flight.

## 3. What needs work?

The full list with reproduction steps is in [friction-log.md](friction-log.md). The five that cost
the most time:

1. **App Runner fails at runtime, not at deploy, for things it could check at deploy.** An arm64
   image deploys cleanly and then dies with `exec format error`. A `docker buildx` image carrying
   the default attestations produces `unknown/unknown` manifest entries that App Runner pulls, fails
   on, and logs *nothing* about — a blank log is the worst possible signal.
2. **`update-service` does not re-pull a moved `:latest` tag**, while the console reports the service
   as updated. `start-deployment` is required. Nothing says so at the point of use.
3. **A VPC connector with no NAT has no route to any public AWS API**, and the SDK's failure mode is
   a 60-second hang rather than an error. We hit this on SES and again on Polly. Each needs its own
   interface endpoint, and nothing in either service's own documentation mentions it.
4. **Converse has no `responseFormat`.** JSON-schema output requires forcing a tool call and reading
   its input — a reasonable workaround, but it is folklore rather than documentation. Converse also
   rejects consecutive same-role turns and an opening assistant turn, so a transcript that reads
   fine to a human is an invalid request; the error names the turn but not the rule.
5. **Alexa's own voices are not in Polly's catalogue.** Reasonable — they were built for Alexa — but
   every developer building an Alexa-adjacent demo looks for them first. One line in the voice list
   would save the search.

## 4. How was onboarding, from zero to hello world?

| | |
|---|---|
| **MCP SDK** | Best of the lot. Working stateless server inside an hour, straight from the spec's own example. |
| **Bedrock** | Blocked on a step nothing warned about: model access must be requested per model in the console before any call succeeds, and until you do, the failure reads like a credentials problem. Once granted, minutes. **Polly, by contrast, needed no activation at all** — a difference worth documenting on both pages, because having done Bedrock first we assumed Polly would be the same and went looking for a switch that does not exist. |
| **App Runner** | First deploy fast, first *working* deploy slow — the three traps in §3 cost about a day between them, and all three are silent. |
| **RDS + pgvector** | Zero friction, including the extension. |
| **SES** | Sandbox is the right default, but "verify this identity" and "request production access" are easy to conflate when a message does not arrive, and the console does not distinguish the two failures. |

## 5. Would you build with these services again?

**Yes** — for Bedrock, RDS with pgvector, Polly, and the MCP SDK. The memory layer is a database
problem with a model bolted to the side, and that combination fits it exactly: one Postgres for
facts, vectors, jobs and the event log; a model only on the write path, never on the read path, so
latency stays in milliseconds; and MCP meaning anything that speaks it can use the memory without a
bespoke integration.

**Yes, with a caveat, for App Runner.** It is the right shape, and we would reach for it again for
anything container-to-HTTPS. But its failure modes are silent at exactly the moments you most need a
signal, and a new account's two-service quota forced us to co-locate the simulator inside the
console container — not a decision we would otherwise have made.

**The honest gap is not a service.** It is that there is no way to test an MCP server against real
Alexa+ outside the Preview programme, so none of this has ever been spoken to by the thing it is
built for. That is the single change that would most improve building in this ecosystem.

## AWS services used, and how (AWS Builder mini challenge)

| Service | How Recall uses it |
|---|---|
| **Amazon Bedrock** — Nova Lite | Fact extraction and the dedupe judge, via the Converse API with JSON schema enforced by a forced tool call ([`packages/llm/src/bedrock.ts`](../packages/llm/src/bedrock.ts)). Also answers as the assistant in the simulated Alexa+. |
| **Amazon Bedrock** — Titan Text Embeddings V2 | 1024-dim embeddings for semantic recall and dedupe ([`bedrock-embedder.ts`](../packages/llm/src/bedrock-embedder.ts)). |
| **Amazon Polly** — generative, `Joanna` | The simulated Alexa+ speaking its answers ([`apps/simulator/src/voice.ts`](../apps/simulator/src/voice.ts)). |
| **Amazon SES v2** | Magic-link sign-in for the console ([`ses-email.ts`](../apps/mcp-server/src/auth/ses-email.ts)). |
| **AWS App Runner** | Two services: the MCP server and the console (with the simulator co-located). Migrations run on container boot. |
| **Amazon RDS for PostgreSQL 16** | pgvector 0.8.2. Facts, embeddings, the event log, and the job queue. |
| **Amazon ECR** | Both images, x86_64, built without attestations. |
| **VPC interface endpoints** | `bedrock-runtime`, `email`, `polly` — the connector has no NAT, so each API needs its own route. |
| **IAM** | A scoped deploy user and an instance role carrying only `bedrock-invoke`, `ses-send` and `polly-speak`. |

## Feature requests (Tier C and others)

| Request | Urgency | Evidence |
|---|---|---|
| A caregiving check-in primitive: an expected daily contact, and a named person told when it does not happen | critical | r/alexa, repeatedly and for years — an 80-year-old who says "hello Alexa" each morning whose son lives out of state (31 comments); a 96-year-old wanting good morning / good night sent to a family group; a 90-year-old with Echos in five rooms. Families are buying third-party hardware for this, and one thread's top advice is not to trust Alexa with it at all |
| Kindle Assistive Reader media controls by voice on Alexa+ | critical | Accessibility regression; works via app only (design.md §1.1) |
| Deferred one-off actions: "turn off the garage lights in 5 minutes" | important | r/alexa, 8 years old, 32 upvotes, still unsolved. The accepted answer is a routine that pauses 300 s, or IFTTT. Acting now and acting on a schedule are both supported; the gap is everything in between |
| Conditions that work with voice-triggered routines | important | r/alexa: "turn on my speakers" should differ at 2pm and at midnight. Conditions exist, but a commenter confirms voice triggers are not compatible with them — so the one trigger a person actually uses is the one that cannot be conditional |
| Custom actions that fire only on what they were defined for | important | r/alexa: a birthday routine triggering on unrelated requests. Same root as false wake — matching wide and acting, rather than matching narrowly and asking |
| Per-response opt-out, starting with the sung "you're welcome" | nice-to-have | r/alexa: "sounds 10x louder than any other response" at bedtime; users report searching for twenty minutes and finding no setting. It fires on politeness, which people are not willing to stop saying |
| Developer sandbox for Alexa+ MCP servers | critical | No path to test outside Preview |
| Deterministic smart-home routing for simple intents (small-model routing, local execution) | important | 10–15 s latency; late "Timer started" (architecture.md §7.1) |
| Streaming TTS | important | Latency becomes an honesty problem when acknowledgements arrive late |
| Honest answer on reverting to classic Alexa | important | Users told it isn't possible; "Alexa, cancel Alexa plus" works |
| False-wake / unprompted interjection fixes | important | Community reports (design.md §1.1) |
| Companion app quality | important | Consumer Reports review |
| Heart-rate / workout events from the Bee Apple Watch app in `bee stream` | important | Would let Recall's workout context use real signals instead of a replayed stream |
| Restore lost legacy features (breathing exercises, BBC radio phrasing) | nice-to-have | Community reports |
