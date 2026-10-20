# Product feedback — the five fields, ready to paste

Each block below is standalone and plain text: these are separate textareas, so nothing refers to
"above", and there are no tables or links that would not survive the paste.

The longer version with reproduction steps is in [feedback.md](feedback.md) and
[friction-log.md](friction-log.md).

---

## Q1 — Which developer tools, APIs and SDKs did you use and for what?

```text
MCP TypeScript SDK (@modelcontextprotocol/sdk 1.30) — the whole product surface. A stateless
Streamable HTTP server (spec 2025-11-25) exposing 27 tools, and the client our simulated Alexa+ uses
to call them.

Amazon Bedrock, Nova Lite (amazon.nova-lite-v1:0) — extracting durable facts from what people say,
judging whether a new fact duplicates or updates an existing one, and answering as the assistant in
our simulated Alexa+. Called through the Converse API.

Amazon Bedrock, Titan Text Embeddings V2 — 1024-dimension embeddings for semantic recall and
duplicate detection.

Amazon Polly (generative engine, voice Joanna) — the simulated Alexa+ speaking its replies aloud.

Amazon SES v2 — magic-link sign-in for the household console.

AWS App Runner — hosting both containers: the MCP server, and the console with the simulator
co-located inside it.

Amazon RDS for PostgreSQL 16 with pgvector 0.8.2 — facts, embeddings, the append-only event log,
device sync cursors and the job queue, all in one database.

Amazon ECR, Amazon VPC interface endpoints (bedrock-runtime, email, polly), AWS IAM — images,
network routes for a VPC connector with no NAT, and a scoped instance role.

Ollama with qwen3:8b and qwen3-embedding:0.6b — the same extraction and embedding work run locally
during development, so iterating cost nothing and worked offline.

Bee developer tools (CLI, MCP, Agent Skill) — evaluated as a real heart-rate source for workout
context.

NestJS 12, Next.js 15, React 19, Postgres, Zod, Vitest, Biome, Docker, pnpm workspaces.
```

---

## Q2 — What worked well?

```text
pgvector on managed RDS was the smoothest piece of the whole stack. Current version, nothing to
install, and it let one database hold facts, vectors, the event log and the job queue — so vector
search and relational constraints share a transaction boundary instead of being four systems to keep
consistent.

The MCP TypeScript SDK had us serving in an afternoon from its own stateless example. registerTool
with Zod shapes keeps a tool's schema and its validation in one place, so the description a model
reads can never drift from the parsing it gets. We build a fresh McpServer per request to bind the
caller's household, and the overhead is not measurable: a warm session_brief round trip is 6–8 ms
locally and 10 ms p50 deployed.

App Runner is the right shape for this kind of service. Container to public HTTPS with no load
balancer, no cluster, no YAML.

Bedrock made swapping models genuinely a config change. Moving extraction from a local qwen3:8b to
Nova Lite was one provider class and an environment variable, and Nova Lite beat the local model on
our own scoring set: 3/4 vs 0/4 on fact scoping, 3/4 vs 2/4 on dates, 4/4 vs 2/4 on action
pre-flight.

Polly's generative voices are good enough that we stopped noticing them, which is the compliment.
```

---

## Q3 — What needs work?

```text
App Runner fails at runtime for things it could catch at deploy, and the failures are silent. An
arm64 image deploys cleanly and then dies with "exec format error" — the service is x86_64 only and
never says so. Worse: a docker buildx image carrying the default attestations produces
unknown/unknown manifest entries that App Runner pulls, fails on, and logs absolutely nothing about.
A blank log is the worst possible signal. Both would be a one-line check at deploy time.
(--provenance=false --sbom=false fixes the second.)

update-service does not re-pull a moved :latest tag, while the console reports the service as
updated. start-deployment is required, and nothing says so at the point of use. We deployed the same
stale image twice before noticing.

A VPC connector with no NAT has no route to any public AWS API, and the SDK's failure mode is a
60-second hang rather than an error. We lost an hour to this on SES, then hit it again on Polly.
Each service needs its own interface endpoint, and neither service's documentation mentions the
requirement. An "endpoint unreachable" error instead of a hang would have made it obvious.

App Runner also injects HOSTNAME into the container, which silently breaks any server that reads it
as a bind address — Next.js does.

Bedrock Converse has no responseFormat field. Getting JSON-schema output means forcing a single tool
call and reading its input, which works well but is folklore rather than documentation. Converse
also rejects consecutive same-role turns and an opening assistant turn, so a conversation that reads
perfectly fine to a human is an invalid request; the error names the offending turn but not the rule
it broke.

Bedrock requires model access to be requested per model in the console before any call succeeds, and
until it is granted the failure reads like a credentials problem. Polly, by contrast, needs no
activation at all. Having done Bedrock first, we went looking for a Polly switch that does not
exist. One line on either page would resolve this.

Alexa's own voices are not in Polly's catalogue. That is a reasonable decision, but every developer
building an Alexa-adjacent demo will look for them first.

SES sandbox is the right default, but "verify this identity" and "request production access" are
easy to conflate when a message does not arrive, and the console does not distinguish the two
failures.

The Bee developer tools expose transcripts, facts, todos, locations and a live event stream, but no
heart rate or biometric data — so the workout-context use case we wanted was not reachable. We used
a recorded stream instead.
```

---

## Q4 — How was your onboarding experience, from zero to hello world?

```text
MCP TypeScript SDK — the best of the lot. A working stateless Streamable HTTP server inside an hour,
straight from the spec's own example, with no guesswork about the transport.

Amazon RDS with pgvector — zero friction, extension included. Minutes.

Amazon Polly — minutes, and notably no activation step.

Amazon Bedrock — blocked on a step nothing warned us about. Model access has to be requested per
model in the console first, and until then the failure looks like a credentials problem rather than
a permissions one. Once granted, minutes.

AWS App Runner — first deploy fast, first *working* deploy slow. The three silent failures in our
Q3 answer cost about a day between them, and all three happen after a deployment the console reports
as successful.

Amazon SES — easy to send, slower to understand why a message did not arrive, because sandbox
verification and production access present similarly.

Ollama — a single pull and it ran. The reason we could iterate on prompts and retrieval for three
weeks without spending anything.
```

---

## Q5 — Would you build with these devices and services again?

```text
Yes — for Amazon Bedrock, RDS with pgvector, Polly and the MCP SDK.

A memory layer is a database problem with a model attached, and that combination fits it exactly.
One Postgres holds facts, vectors, the event log and the job queue. The model stays on the write
path only — extraction and judging run as background jobs — so reads stay in milliseconds and access
control is a tested pure function rather than a prompt. And because the interface is MCP, anything
that speaks it can use the memory without a bespoke integration: the same tools are packaged as an
Agent Skill with no changes.

Yes with a caveat for App Runner. It is the right shape and we would reach for it again for anything
container-to-HTTPS. But its failure modes are silent at exactly the moments you most need a signal,
and a new account's two-service quota forced us to co-locate our simulator inside the console
container — not a decision we would otherwise have made.

The honest gap is not a service. It is that there is no way to test an MCP server against real
Alexa+ outside the Preview programme, so everything we built has been exercised against Claude and
against our own simulated Alexa+, never against the assistant it is actually for. A developer
sandbox — even a rate-limited one, with a latency trace per tool call — is the single change that
would most improve building in this ecosystem, and it is the one thing we could not work around.
```
