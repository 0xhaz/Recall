# Devpost — Project Story

Paste the section below into **About the project**. The "Built with" tags are at the bottom.

---

## Inspiration

We went looking for what people actually complain about, and r/alexa turned out to be a better brief
than any feature list.

One thread had Alexa+ telling someone *"I know your uncle died of TB last year"* — a person with no
such uncle, and nothing in the device history to explain it. Another had it waking a family at 2am
about a couch delivery they never ordered. A third had someone refused the time four times, then
told *"I just told you four times, it's 10:58."* And Amazon's own documentation says personal notes
are visible to anyone on the account.

Then there were the caregiver threads, and those changed the project. An 80-year-old who says
*"hello Alexa"* every morning, and a son in another state who wants to know when he **doesn't**. A
96-year-old whose family wants good-morning and good-night sent to a group chat. Families buying
third-party hardware because the assistant won't do it. One thread asking about fall detection has a
top reply saying, plainly, *"I wouldn't trust Alexa for this at all."*

That instinct is correct, and it's the problem. The highest-leverage fix isn't more personality. It's
a memory that can be trusted — which means one you can read, correct and delete, and which knows
what it doesn't know.

## What it does

Recall is a memory layer for Alexa+ that the **household** owns rather than the assistant. It's a
self-hosted MCP server with 27 tools; the assistant asks it for a session brief and gets back only
what the person in front of it is allowed to know.

- **It knows who's talking.** The same question gives two people different answers, and an unknown
  voice gets household facts only — never anyone's personal memory. That one behaviour is the whole
  design, and you can see it in 30 seconds by signing in as two different people.
- **Stated rules are law.** *"No music after 10pm on school nights"* blocks the action, and the
  refusal quotes the rule back in the words it was said in. Rules outrank anything learned.
- **Forgetting really forgets.** A tombstone every device picks up, the words erased where they were
  kept, snapshots rewritten — so a device that was offline can't resurrect it.
- **Nothing costing money happens without a check.** A venue never used before, an address that
  doesn't match what was actually said, a repeat within two hours, an unusual amount — each becomes
  a question asked before acting, not an apology after.
- **Care mode.** A caregiver writes how a hard topic should be handled, and those words are used
  verbatim — never improvised. Ask about a husband who died in 2019 and you get the family's own
  redirection, warmly, every time, without *"I already told you."* Miss a check-in and the person is
  asked first; the carers hear only if nobody answers.
- **It declines to guess.** Bought twice is not a pattern. A dose nobody confirmed is not a dose
  nobody took. "No record" is kept separate from "missed", because they mean different things.

Everything it holds is on a console: facts with their provenance, rules, mined routines, every
action taken on someone's behalf, and who can see what.

## How we built it

A pnpm monorepo, about 65 commits over six weeks.

**The memory server** is NestJS 12 exposing MCP over Streamable HTTP (spec `2025-11-25`, stateless —
a fresh server and transport per request, bound to the caller's household). Postgres 16 with
pgvector holds facts, embeddings, an append-only event log and the job queue, which meant one
database instead of four moving parts. Retrieval fuses vector and keyword search by reciprocal rank.

**Every decision that matters is a pure function** in `@recall/core` — 65 of them, covering access,
rules, context scoring, routine mining, action pre-flight. Nothing that decides what a person may
see is left to a prompt, so all of it is unit-tested rather than hoped for.

**Bedrock** does the model work: Nova Lite for fact extraction and the dedupe judge via the Converse
API, Titan v2 for embeddings. The model is only ever on the **write** path — extraction runs as a
background job — so reads stay in milliseconds.

**The simulated Alexa+** is a web app with a real agent loop, the five seeded devices, replayable
sensor streams, and Amazon Polly for the spoken reply. It talks to Recall only through MCP, and the
tool trace for every turn is on screen.

**The console** is Next.js 15 with server actions. It runs on AWS App Runner alongside the server,
with RDS behind a VPC connector and Bedrock, SES and Polly reached through interface endpoints.

## Challenges we ran into

**A measurement that was quietly wrong.** Semantic recall was dropping an obviously relevant fact.
We measured the similarity by embedding the bare query — but the server prepends an instruction
prefix before embedding. The real score was 0.3132, not the 0.3478 we'd been reasoning from, and it
sat just under the floor. Every conclusion built on that number had to be thrown away.

**Which led to the actual bug: a threshold is a property of the model, not the codebase.** Our
similarity floors were tuned for a local embedding model. Titan sits on a completely different
scale — a genuine match scores ~0.31 where the local model scores ~0.78 — so the same constant means
opposite things depending on which model made the vectors. Floors are now keyed by model id, and the
fallback is the stricter pair, because under-returning is recoverable and inventing matches is not.

**A dev server that lied.** `tsx watch` silently kept serving stale code four separate times, and
each time we drew conclusions from behaviour that no longer existed in the file we were reading. The
fix in the end was procedural: restart, and check the process start time is after the edit.

**n=1 against a non-deterministic model.** Several conclusions about prompt changes were drawn from a
single run and turned out to be noise. We moved to scored repeated sampling, which immediately
contradicted two things we thought we'd established.

**Deployment failures that are silent by design.** App Runner runs x86_64 only, and an arm64 image
deploys cleanly then dies at runtime with `exec format error`. A `docker buildx` image carrying the
default attestations produces manifest entries App Runner pulls, fails on, and logs *nothing* about.
`update-service` doesn't re-pull a moved `:latest` tag while the console reports the service as
updated. And a VPC connector with no NAT has no route to a public AWS API — the SDK's failure mode
is a 60-second hang, which we hit on SES and again on Polly.

**A seed that converged everything except the words.** The demo was built around Malaysian names and
places before we moved it to a US household. The repo said "Emma" and "Brooklyn"; the running demo
said "Aisyah" and a Kuala Lumpur address, because the seed inserted facts with `ON CONFLICT DO
NOTHING`. Fixing the row wasn't enough either — the `fact.created` event embeds the fact as it was,
snapshots are built from those, and 117 conversation turns still quoted the old wording because a
transcript records what was said and is never rewritten.

**Tests that passed every day except one.** Two assumed "today" is never a holiday; they broke on
Columbus Day because a new feature correctly adds a confirmation on dates that matter. Two others
computed "N days ago" in UTC while the code groups by local date — they passed all afternoon and
failed by exactly one day once UTC crossed midnight.

## Accomplishments that we're proud of

**The parts where it refuses to answer.** Two purchases of batteries is not a pattern, so no cycle is
claimed. A dose with no log is shown as *no record*, never folded into *missed*. Repurchase
suggestions say "you last ordered this on the 3rd, about weekly" and never "you've run out", because
Recall only sees what was bought through it. Restraint is harder to fake than recall, and it's the
part a demo can't bluff.

**The access model is demonstrable in thirty seconds.** Sign in as Emma, ask what it knows about you.
Sign in as Daniel, ask the same thing. The difference isn't described — it's visible.

**The honesty beat in care mode.** The dose log distinguishes *confirmed by voice*, *confirmed by a
carer*, *unanswered* and *no record*, and the UI says in as many words that unconfirmed is not the
same as not taken. For the people in those Reddit threads, that distinction is the entire product.

**322 tests, and a read path with no model in it.** A session brief comes back in about 10 ms server
side. Every access rule is a pure function with tests, not a prompt with a hope.

## What we learned

**Calibration constants belong to whatever produced the data, not to your code.** The embedding-floor
bug looked like a ranking bug for two days. Any threshold compared against a model's output has an
implicit dependency on that model, and ours was invisible until we swapped providers.

**Run the thing; don't trust a green suite.** Nearly every serious bug this project had was found by
opening the page or sending the sentence, not by testing. Four console pages had data only because
someone had been testing by hand — they'd have been empty on a fresh clone. The production simulator
was placing replays on the wrong day because an environment variable still said `Asia/Kuala_Lumpur`,
which no test could see. The US migration had changed the repo, not the things already deployed.

**Keep the model off the read path.** Extraction, judging and parsing are model work and run as
background jobs. Retrieval, scoping and rule enforcement are code. That one boundary is why reads are
fast and why access control is testable.

**Honesty is a feature you build, not a tone you prompt.** "Unconfirmed is not the same as not taken"
isn't a sentence in a system prompt — it's a column, a status, a UI distinction and a test.

## What's next for Recall

**OAuth 2.1 with PKCE and a Protected Resource Metadata document**, which is the only technical gap
between this and a real Alexa+ MCP Toolkit integration. We checked: the protocol side is already met
— 2025-11-25 negotiated, Streamable HTTP, public HTTPS, 10 ms server-side against a 500 ms budget.
Authentication is the whole remaining distance.

**Splitting local and remote memory**, so a device answers from what it already holds and the server
owns only what changes shared truth. Designed, deliberately not built — `sync` is scoped to the
household rather than the device, so every device currently holds every person's facts. That's
tolerable while the server answers and filters at read time; it stops being tolerable the moment a
personal device answers for itself.

**Deferred one-off actions** — *"turn the garage lights off in five minutes"*. We logged it from a
thread that is **eight years old** with the accepted answer still being a routine that pauses 300
seconds. Recall can act now or on a schedule, with nothing in between, and neither can Alexa.

**Per-device routines**, so "usual device" is an attribute of a routine rather than a separate one
per device.

---

## Built with

```
typescript · node.js · nestjs · next.js · react · tailwindcss · postgresql · pgvector ·
model-context-protocol · amazon-bedrock · amazon-nova · amazon-titan · amazon-polly · amazon-ses ·
aws-app-runner · amazon-rds · amazon-ecr · aws-iam · docker · zod · vitest · pnpm · biome · ollama
```

24 tags, under the 25 limit.
