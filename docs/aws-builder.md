# AWS Builder mini challenge — which AWS services, and how

Paste the section below into *"Which AWS services did you incorporate and how?"*. Everything in it
is live at the URLs in the README; nothing is aspirational.

---

Recall runs entirely on AWS. Nine services, each doing a specific job:

**Amazon Bedrock — Nova Lite (`amazon.nova-lite-v1:0`).** Two uses. It extracts durable facts from
what someone said, and judges whether a new fact duplicates, updates or contradicts an existing one.
It also answers as the assistant in our simulated Alexa+. We call it through the **Converse API**,
with JSON-schema output enforced by forcing a single tool call and reading its input — Converse has
no `responseFormat`, so this is the way to get structured output from it. Converse also rejects
consecutive same-role turns and an opening assistant turn, so our adapter reshapes the message list
before every call ([`packages/llm/src/bedrock.ts`](../packages/llm/src/bedrock.ts)). Nova Lite
replaced a local model and measurably beat it on our own scoring set: 3/4 vs 0/4 on fact scoping,
3/4 vs 2/4 on dates, 4/4 vs 2/4 on action pre-flight.

**Amazon Bedrock — Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`).** 1024-dimension
embeddings for semantic recall and duplicate detection, eight at a time
([`bedrock-embedder.ts`](../packages/llm/src/bedrock-embedder.ts)). Worth noting because it bit us:
Titan's similarity scores sit on a very different scale from the local model we started with — a
genuine match scores ~0.31 where the other scored ~0.78 — so our retrieval thresholds are now keyed
by model id rather than being one global constant.

**Amazon Polly — generative engine, voice `Joanna`.** Gives the simulated Alexa+ a spoken voice
([`apps/simulator/src/voice.ts`](../apps/simulator/src/voice.ts)). Synthesis happens inside the same
request that produces the reply, so the voice and the text arrive together the way a real device
behaves, and it fails open: a Polly error is logged once and the turn continues in text. Measured
warm, generative averages 2.2 s per reply against 1.8 s for neural, so the better engine costs about
400 ms rather than the 2× a cold first call suggests.

**Amazon SES v2.** Magic-link sign-in for the household console
([`ses-email.ts`](../apps/mcp-server/src/auth/ses-email.ts)). The sender never logs the link, and a
delivery failure is swallowed deliberately so that a failed send cannot reveal whether an account
exists.

**AWS App Runner.** Two services — the MCP server and the console (with the simulated Alexa+
co-located inside it). Container to public HTTPS with no load balancer or cluster. Database
migrations run on container boot, and an opt-in `SEED_ON_BOOT` flag lets us reseed the demo from
*inside* the VPC rather than opening the database to a laptop's address.

**Amazon RDS for PostgreSQL 16.15** (`db.t4g.micro`) with **pgvector 0.8.2**. One database holds
facts, their embeddings, the append-only event log, device sync cursors and the job queue — so
vector search, relational constraints and the queue are all one transaction boundary instead of four
systems to keep consistent.

**Amazon ECR.** Both container images. They must be `linux/amd64` (App Runner is x86_64, and an
arm64 image deploys cleanly then dies at runtime), and built with `--provenance=false --sbom=false`
(buildx attestations produce manifest entries App Runner pulls, fails on, and logs nothing about).

**Amazon VPC — interface endpoints** for `bedrock-runtime`, `email` and `polly`. The App Runner VPC
connector has no NAT gateway, so there is no route to any public AWS API without one; the failure
mode is a 60-second hang rather than an error, which we hit twice before recognising the pattern.
Keeping it to endpoints rather than a NAT also keeps the database unreachable from the internet.

**AWS IAM.** A scoped deploy user instead of root credentials, and an App Runner instance role
carrying exactly three inline policies — `bedrock-invoke`, `ses-send`, `polly-speak` — so the running
container can do those three things and nothing else.

**The architectural point:** the model is only ever on the **write** path. Extraction, judging and
embedding run as background jobs against Bedrock; retrieval, per-person access control and rule
enforcement are pure functions in code with tests. That's why a `session_brief` returns in about
10 ms server-side, and why "can this person see this fact" is a tested function rather than a prompt.

---

*Also answered in full in [docs/feedback.md](feedback.md) under the product-feedback questions, as
the submission form asks.*
