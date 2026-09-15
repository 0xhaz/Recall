# Demo script

Every feature, in an order where each step leaves the state the next one needs. Two purposes:

1. **Shake-down** — walk the whole thing and find what's broken before it matters.
2. **Raw material** — each beat is marked with how long it takes and how well it demos, so a 3-minute
   cut can be assembled from the strongest ones. Suggested cuts are at the end.

Marks used throughout:

- ⏱ how long the beat takes to perform
- ★ demo strength (★★★ = show this, ★ = correctness only, not a story)
- ✅ what you should see — if you don't, the feature is broken, not the script

A beat that fails is worth more than a beat that passes. Note it and move on; don't fix mid-walk.

---

## 0. Setup

**Demo against the deployed stack.** Nova Lite answers there, and it does both of the beats that
fight each other on a local model — see "The model" at the end. Nothing needs to be running on your
laptop.

| | |
|---|---|
| Console | https://6gpwq7kegp.us-east-1.awsapprunner.com |
| MCP server | https://v9d346pzw7.us-east-1.awsapprunner.com/mcp |

✅ `curl -s https://v9d346pzw7.us-east-1.awsapprunner.com/health` reports `db: true` and Bedrock
reachable.

The simulated Alexa+ is a **page inside the console** now (Simulator, bottom of the nav), not a
separate site on :3200. It runs in the same container; if it is ever down the page says so and every
other page still works.

<details>
<summary>Running it locally instead</summary>

```sh
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev                      # terminal 1 — MCP server + background jobs, :3100
pnpm console                  # terminal 2 — console, :3000
pnpm sim                      # terminal 3 — simulated Alexa+, :3200
```

Locally the assistant is `qwen3:8b`, which is markedly worse at these beats. Use it for development,
not for recording.

**Never run `pnpm build` while `pnpm console` is up** — `next build` and `next dev` share `.next` and
the dev server starts serving corrupted chunks. If pages 500 across the board, that is why: stop the
dev server, `rm -rf apps/console/.next`, restart.

**If a new endpoint 404s but the server is healthy**, `tsx watch` has gone stale. Restart `pnpm dev`.
It is never a code problem.
</details>

### Seeded starting state

A household in Brooklyn, on `America/New_York`.

| Person | Role | Signs in as |
|---|---|---|
| Emma | owner | the address set in `DEMO_OWNER_EMAIL` |
| Daniel | adult | `daniel@demo.recall.local` |
| Sofia | child | — |
| Ruth | cared for | — |
| Nina | caregiver (own household too) | `nina@demo.recall.local` |
| Tom | guest | — |

Devices: `kitchen-echo`, `bedroom-echo` (Ruth's), `living-firetv`, `ruth-bee` (worn),
`emma-watch` (worn).

Seeded facts: Emma vegetarian · Daniel likes very spicy food · Sofia allergic to peanuts · household
takeaway is Napoli Pizza · family dinner ~19:30 weekdays · delivery address (tagged PII) · Ruth
takes tea with condensed milk (entered by Nina) · the fridge water filter is replaced every 3 months.

Seeded purchases (dated back from whenever the seed runs, so the cycles stay true): wet food from
Chewy five times at 7-day gaps · coffee beans from Blue Bottle three times at 14-day gaps, now a week
overdue · AA batteries twice, too few to be a cycle · a fridge water filter once, 100 days ago · and
protein powder that is **Daniel's own**, which Emma must never see.

⚠️ Only Emma's address receives mail while SES is in sandbox. The other demo addresses are on a
domain that cannot receive anything — a link requested for them is minted and goes nowhere, which is
correct behaviour and looks identical from the form.

### Signing in

Open the console, enter Emma's address, and **the link arrives by email** — from SES, single-use,
valid 15 minutes. Sessions last 30 days, so do it once.

⚠️ Sign in **before** you start recording. Waiting for an email is the least interesting thing in
this project.

---

## 1. Memory that knows who's talking ⏱ 90s ★★★

The core claim. Do this on the console's **Simulator** page, which has two devices side by side.

| Step | Say | ✅ Expect |
|---|---|---|
| 1.1 | Speaker **Emma** → *"What should we cook tonight?"* | Suggests something vegetarian. The Recall call panel shows `session_brief` and the fact it used. |
| 1.2 | Speaker **Daniel**, same question | Different answer — spicy. Same house, same question, different person. |
| 1.3 | Speaker **none** (or slide voice-match below 0.7) | Household facts only. It offers to confirm who's speaking rather than guessing. |

★★★ **1.1 → 1.2 back to back is the single strongest 20 seconds in the project.** Same question, two
people, two answers, and the panel proves it came from memory rather than the model.

The voice-match slider stands in for Voice ID — say so out loud. Below 0.7 the speaker is treated as
unknown by design, not by accident.

---

## 2. Remembering and forgetting ⏱ 90s ★★★

| Step | Say | ✅ Expect |
|---|---|---|
| 2.1 | *"I'm Daniel, remember I'm off coffee until Wednesday"* | Acknowledged immediately. |
| 2.2 | Ask again ~10s later: *"what do you know about me?"* | The fact is there. "Until Wednesday" has become a real date — resolved by code, not the model. |
| 2.3 | Console → **Memory** | The new fact with its source and confidence. Note it says where it came from. |
| 2.4 | Correct it in the console | Old wording is kept as history, not overwritten. |
| 2.5 | *"Forget that I'm off coffee"* | Gone. |
| 2.6 | Console → **Memory**, filter **forgotten** | The tombstone. Check the second device in the simulator — also gone there. |

★★★ **2.5 → 2.6 (forget reaches every device)** is the privacy beat. Forgetting that only works on one
device isn't forgetting.

⏱ Extraction runs in the background — 2.2 needs a few seconds' gap. Don't ask instantly on camera.

---

## 3. Rules are law ⏱ 60s ★★

| Step | Say | ✅ Expect |
|---|---|---|
| 3.1 | *"Emma here. No music after 10pm on school nights."* | Stored word for word, with a structured form beside it. |
| 3.2 | As Daniel: *"Always play music when I work out."* | Stored. Conflicts are **reported, never silently resolved**. |
| 3.3 | Console → **Rules** | Both rules in their author's own words, plus the log of what each blocked. |
| 3.4 | Ask for music after 10pm | Refused, quoting the rule. |

★★ The point to say aloud: **rules are law, learned memory is only evidence.** A learned preference
never overrides a stated rule.

---

## 4. Honesty ⏱ 60s ★★★

| Step | Say | ✅ Expect |
|---|---|---|
| 4.1 | *"Do you know anything about my uncle?"* | *"Nothing stored about your uncle"* — not a guess, not a confabulation. |
| 4.2 | *"What did I say earlier about dinner?"* | Answers from the actual conversation log, or says it can't. |
| 4.3 | Ask about something time-relative — *"what's on tonight?"* | Every response carries the device-local date and time. |

★★★ **4.1 is the anti-hallucination beat** and it's short. "Nothing stored about your uncle" is a
better line than any correct answer, because most assistants will happily invent an uncle.

---

## 5. Routines the house actually has ⏱ 75s ★★

```sh
# Replays run from your machine and drive whichever Recall they are pointed at.
export RECALL_URL=https://v9d346pzw7.us-east-1.awsapprunner.com/mcp
export RECALL_DEV_TOKEN=…            # the household token minted at deploy
pnpm replay mornings                 # three weeks of history, lands in seconds
```

| Step | Where | ✅ Expect |
|---|---|---|
| 5.1 | Console → **Routines** | Mined routines waiting for a yes or no. Emma's ~07:10 coffee, then the news on weekdays. |
| 5.2 | Accept one | It can be offered from then on. |
| 5.3 | Note the "stopped working" section | A routine that used to fire and no longer does is surfaced, not silently dropped. |

★★ **5.3 is the underrated one.** Noticing that a routine *stopped* is harder and more useful than
noticing it exists.

⚠️ `mornings` is history mode — it back-dates three weeks instantly. Run it **before** recording so
the console already has something to show.

---

## 6. Context and music ⏱ 90s ★★★

```sh
pnpm replay heart-rate               # 4 minutes real time — start it, then talk over it
```

| Step | Where | ✅ Expect |
|---|---|---|
| 6.1 | Console → **Context**, watch it climb | Workout score rising, **with its reasons listed** ("heart rate 34% above resting"). |
| 6.2 | Note the threshold | Relative to **Emma's own** resting rate, learned from her history — not a fixed 120bpm. |
| 6.3 | Ask for music mid-run | Picks for the live context, ranked by what she plays *and skips* in that context. |
| 6.4 | *"Stop workout mode"* | Manual override wins for a while, and calibrates her trigger for next time. |

★★★ **6.2 is the line that separates this from a step counter**: "a flight of stairs isn't a workout,
because the threshold is hers." The debounce (on only after the score holds, off only after it stays
low) is the reason that's true.

The music catalogue is **mocked** — say so. It's labelled as such in the UI.

⏱ Real-time replay is 4 minutes. For a short cut, `pnpm replay heart-rate --speed 4`.

---

## 7. Pre-flight and undo ⏱ 90s ★★★

| Step | Say | ✅ Expect |
|---|---|---|
| 7.1 | *"Order the usual from Napoli Pizza"* | Pre-flight runs first: checks rules, quiet hours, the address on record, venues used before, amount. |
| 7.2 | Try one with a substituted address | It catches that the details don't match what was asked for, and confirms rather than proceeding. |
| 7.3 | Confirm a low-risk action | Carried out, with an undo window open. |
| 7.4 | *"Undo that"* | Taken back. Device changes reverse with the inverse command. |
| 7.5 | Console → **Actions** | Everything done on your behalf, what pre-flight asked, and undo while the window is open. |

★★★ **7.2 is the strongest correctness beat in the project** — the agent tried to substitute a detail
and pre-flight caught it by comparing the request's own words against the details. That's a real class
of failure, caught deterministically.

Anything that costs money is only ever **drafted** for confirmation. Never spend money live on camera.

---

## 7b. Buying it again ⏱ 60s ★★

| Step | Say | ✅ Expect |
|---|---|---|
| 7b.1 | *"What did I buy last time?"* | The actual purchases, newest first, with the venue and what was in them — read off the record, not recalled from a model. |
| 7b.2 | *"What are we due for?"* | Wet food every 7 days, bought five times, due in three. Coffee every fortnight, a week overdue. AA batteries bought twice and therefore **not** claimed as a cycle. |
| 7b.3 | *"We replace the fridge water filter every 3 months"* → ask again | The filter is now overdue, and Recall **quotes the sentence back**. One purchase plus one sentence, where no amount of mining would have found a cycle. |
| 7b.4 | *"Order more wet food"* | Goes through pre-flight like any other spend. The items and venue come from the record; the money still waits for a confirmation. |

★★ **7b.2 is the restraint beat.** Two purchases is not a pattern, so nothing is claimed. And an item
Recall has never seen bought is listed but never called due — it only sees what was bought *through
Recall*, so it says "you last ordered this on the 3rd, about weekly", never "you have run out".

> Worth saying out loud: this needed no new table and no new way to spend money. The purchases were
> already there as executed actions; what was missing was a way to ask.

---

## 8. Care mode — the medication schedule ⏱ 2min ★★★

Sign in as **Nina** (caregiver) to show this properly; Emma as owner also works.

| Step | Where | ✅ Expect |
|---|---|---|
| 8.1 | Console → **Care** → Ruth | Her own page: how Recall speaks with her, her schedule, her day, the alerts. |
| 8.2 | Add a reminder: *Blood pressure tablet · one tablet · 08:00, 20:00* | Saved. The confirmation says she'll be asked on **her own device**, and nobody else is told unless she doesn't answer. |
| 8.3 | Set one for a few minutes ago, wait for the job cycle | She's prompted on `bedroom-echo`. |
| 8.4 | In the simulator as **Ruth**: *"I've taken my tablet"* | Confirmed. Recorded as `how: voice`. |
| 8.5 | Or press **Mark taken** in the console | Also confirmed — but recorded as `how: console`, with who said so. |
| 8.6 | Leave one unanswered past the escalation window | Status becomes **not confirmed**, and *only then* the carers are told. |

★★★ **8.4 vs 8.5 is the whole ethical argument in one screen.** The record keeps the difference
between *she said she took it* and *a carer recorded it*. Most systems collapse those into a checkbox.

★★★ **8.6 is the second half of it:** silence is never written as "taken" — and never as "not taken"
either. The row says *unconfirmed*, which is exactly what's known. Say that line out loud.

No audio is stored anywhere. A spoken confirmation is kept as screened text.

---

## 9. Care mode — how Recall speaks ⏱ 60s ★★★

| Step | Where | ✅ Expect |
|---|---|---|
| 9.1 | Care page → the correct/redirect policies | Safety topics **corrected**; painful ones **redirected** in the caregiver's own words. |
| 9.2 | Add a topic — *Ahmad → redirect → "Talk about his garden. Only say he has passed if she asks directly."* | Saved and used as written. |
| 9.3 | As Ruth, ask the same question twice | The same warm answer both times. **Never "I already told you."** |
| 9.4 | As Ruth: *"Who can see this?"* | Says plainly what's shared, and with whom. |

★★★ **9.3 is quietly the most human moment in the demo.** For someone with dementia, being told "I
already told you" is a small cruelty repeated all day. The repeat detector exists for that.

★★ **9.4 matters because the transparency runs toward the person being cared for**, not only toward
the carer. She is told what's shared about her.

---

## 10. The Bee as a tracker ⏱ 60s ★★

```sh
pnpm replay bee-night                # resting, stillness, then she gets up
```

| Step | Where | ✅ Expect |
|---|---|---|
| 10.1 | Care page → **Worn tracker** | Last heart rate, against **her own learned resting rate**. Whether she's moving. |
| 10.2 | Note what's *not* there | No diagnosis. Readings and times only. |
| 10.3 | `pnpm replay door-night` | A door at night that isn't usual for the hour tells the carers. Usual ones don't. |

★★ The honest framing, and worth stating: **this is a recorded stream, not live Apple Watch data.**
Bee doesn't expose heart rate at useful granularity (checked in week 1). Don't claim otherwise —
it's in the decision log as Q6.

Raw health signals never leave the server; raw heart rate is deleted after 7 days.

---

## 11. Check-ins and absence ⏱ 45s ★

```sh
pnpm replay checkins                 # two weeks of ~07:30 and ~21:30
```

| Step | Say | ✅ Expect |
|---|---|---|
| 11.1 | As Ruth: *"Good morning"* | Recorded; the carers are told. |
| 11.2 | Miss a usual check-in | She's prompted first, **then** the carers. The person is always asked before anyone is alerted. |

★ Correct and necessary, but it's the same shape as §8 and a 3-minute cut can only carry one. Prefer
the medication beat.

---

## 12. Cross-device sync ⏱ 60s ★★

| Step | Where | ✅ Expect |
|---|---|---|
| 12.1 | Two simulator devices side by side | Each keeps its own synced view of household memory. |
| 12.2 | Remember something on device A | It appears on device B. |
| 12.3 | Forget it on B | Gone on A. |
| 12.4 | Console → **Devices** | What has synced, and each device's cursor. |

★★ Pairs naturally with §2 — do the forget in §2.6 across two devices and you've demoed both at once.

---

## 13. Household transparency and control ⏱ 60s ★★

| Step | Where | ✅ Expect |
|---|---|---|
| 13.1 | Console → **People** | Who can see what. A guest sees household memory, not people's own. |
| 13.2 | Sign in as **Nina**, open Memory | A caregiver without `view_full_memory` sees household facts, **not** Ruth's own. Grants open doors, not the whole house. |
| 13.3 | Console → **Settings** | Retention (7–365 days). Tombstones outlive it by 30 days, so forgetting still sticks. |
| 13.4 | Export | Full JSON of everything held. |

★★ **13.2 is the access-control proof** and it's one screen. The permission model is real, not a
label — there's an e2e test for exactly this.

---

## 14. Correctness the audience can't see ⏱ 30s ★

Worth a single slide, not screen time:

```sh
pnpm test        # 257 tests across 4 packages, incl. a latency check that fails the build
curl -s https://v9d346pzw7.us-east-1.awsapprunner.com/metrics/latency
```

- 257 tests (7 llm · 112 core · 21 simulator · 117 server), scripted LLM + deterministic embedder — no
  model needed to run them.
- p95 per tool against a budget; the suite **fails** if a read tool exceeds it.
- The model never runs on the read path.

⚠️ **Quote the server-side number, and say which one it is.** Measured on the deployed stack:

| | p50 | p95 | budget |
|---|---|---|---|
| `session_brief` | 10 ms | 199 ms | 400 ms |
| `recall` | 143 ms | 143 ms | 300 ms |
| `device_state` | 53 ms | 83 ms | 100 ms |

A round trip from a laptop in Malaysia to us-east-1 is about **1.1 s** for the same calls — that is
distance, not Recall, and a viewer in the US sees a fraction of it. Both numbers are honest; saying
which one you mean is what keeps them honest. `/metrics/latency` is empty until tools have been
called, so warm it before showing the endpoint.

★ Not a story beat, but one line — *"the model never runs on the read path"* — earns more credibility
than a minute of demo.

---

## 15. What is actually running ⏱ 20s ★

Worth knowing before someone asks on camera, and worth saying plainly rather than being caught out.

```
Console + simulated Alexa+   App Runner (one container, two processes)
Recall MCP server            App Runner, VPC egress
Memory                       RDS Postgres 16 + pgvector 0.8.2, private to the VPC
Model                        Bedrock — Nova Lite for chat, Titan v2 for embeddings
Mail                         SES, for the sign-in link
```

Bedrock and SES are reached over **VPC interface endpoints** rather than a NAT gateway: the server
sends all its egress through the VPC to reach RDS privately, so those endpoints are what keep it
able to reach anything at all. That is a ~$7/month decision instead of ~$32.

Three things that are true and better said than discovered:

- **AgentCore Runtime is not used.** App Runner is, because the console and the simulator
  authenticate with a bearer token and AgentCore speaks only SigV4 or OAuth. The image already meets
  AgentCore's contract apart from the port, so this is a deviation rather than a dead end.
- **The simulator shares the console's container.** The account is capped at two App Runner services
  per region — an account restriction, not a quota — and the server and console hold both. Locally
  they are still two separate services.
- **SES is in sandbox.** Only verified addresses receive a sign-in link. Anyone else gets the same
  "if that belongs to someone here" answer and no mail, which is the correct behaviour for an
  account-enumeration question and indistinguishable from success at the form.

---

## Suggested 3-minute cuts

Three assemblies. All are ⏱ ~3:00 including talking.

### Cut A — "It knows who's talking" (the memory story)

| ⏱ | Beat | Why |
|---|---|---|
| 0:00–0:20 | §1.1 → §1.2 same question, two people | Strongest opener you have |
| 0:20–0:35 | §1.3 unknown speaker → asks | Shows it fails safe |
| 0:35–1:00 | §4.1 "nothing stored about your uncle" | Anti-hallucination, memorable line |
| 1:00–1:40 | §2.1 → §2.5 → §2.6 remember, forget, tombstone on both devices | The privacy claim, proven |
| 1:40–2:20 | §7.1 → §7.2 pre-flight catches the substitution | Real failure, caught deterministically |
| 2:20–2:50 | §7.4 undo | Closing beat |
| 2:50–3:00 | §14 one line on tests and read-path latency | Credibility |

**Best for:** a general audience. Leads with the clearest differentiator.

### Cut B — "Care mode" (the human story)

| ⏱ | Beat | Why |
|---|---|---|
| 0:00–0:20 | §1.1 → §1.2 | Still the best opener; establishes per-person memory fast |
| 0:20–1:00 | §8.2 → §8.3 schedule, prompted on her own device | Sets up the ethics |
| 1:00–1:40 | §8.4 vs §8.5 voice vs console, and the record keeps the difference | The argument |
| 1:40–2:05 | §8.6 unconfirmed ≠ not taken | The line that lands |
| 2:05–2:35 | §9.3 same warm answer, never "I already told you" | The human moment |
| 2:35–2:50 | §9.4 she's told what's shared | Transparency runs toward her |
| 2:50–3:00 | §10.2 readings, never a diagnosis | Honest close |

**Best for:** judges who've seen ten memory demos. This one is hard to copy and hard to forget.

### Cut C — "The system" (the engineering story)

| ⏱ | Beat | Why |
|---|---|---|
| 0:00–0:15 | §1.1 → §1.2 | Opener |
| 0:15–0:50 | §5.1 → §5.3 mined routines, incl. one that stopped working | Learning from the event log |
| 0:50–1:35 | §6.1 → §6.2 context with reasons, threshold learned per person | The engine |
| 1:35–2:05 | §3.1 → §3.4 rules as law, conflicts reported not resolved | Precedence |
| 2:05–2:35 | §12 sync: remember on A, forget on B, gone on both | Distributed correctness |
| 2:35–3:00 | §14 tests, latency budget, model never on the read path | Close on rigour |

**Best for:** a technical judging panel.

---

## Recommendation

**Cut B.** §1 gets you in the door, but every entrant will have a memory demo. The medication beat
(§8.4 vs §8.5 vs §8.6) is the one nobody else will have, and it's the one where the design position —
*record what is known, never what is assumed* — is visible on screen rather than asserted in voiceover.

If the audience skews technical, **Cut C**, but keep §8.6 in place of §12; it's the better 30 seconds.

---

## Shake-down checklist

Walk all fourteen and mark each. Anything that fails is worth more than anything that passes.

- [ ] §1 per-person memory, unknown speaker fails safe
- [ ] §2 remember, correct, forget, tombstone on every device
- [ ] §3 rules stored verbatim, conflicts reported, enforcement quotes the rule
- [ ] §4 "nothing stored about", session history, temporal stamp
- [ ] §5 routines mined, accepted, and "stopped working" surfaced
- [ ] §6 context with reasons, per-person threshold, override calibrates
- [ ] §7 pre-flight catches a substituted detail; undo reverses
- [ ] §8 schedule → prompt → voice confirm → console confirm → escalation
- [ ] §9 correct/redirect in the caregiver's words; repeat gets the same answer
- [ ] §10 worn tracker shows readings against her own resting rate; night door alerts
- [ ] §11 check-in recorded; absence prompts her before the carers
- [ ] §12 sync both directions across two devices
- [ ] §13 caregiver without the grant can't see her own memory; export works
- [ ] §14 `pnpm test` green; latency within budget

### The model: measured, not guessed

Deployed on Bedrock, Nova Lite does both of the beats that pull against each other locally. This is
the single biggest reason to demo against the deployed stack rather than your laptop.

| model | §1 the beat (Emma / Daniel) | §7 pre-flight fires | falsely claims done | latency |
|---|---|---|---|---|
| **amazon.nova-lite-v1:0** (deployed) | **3/4 · 3/4** | **4/4** | 0/4 | ~2.7s |
| `qwen3:8b` (local) | 0/4 · 2/4 | 2/4 | 0/4 | ~1.6s |

Measured 2026-09-15, 4 runs per cell, scoring the reply as spoken — after `clean()` strips the
model's reasoning. Nova wraps its reasoning in `<thinking>`, qwen in `<think>`; both are stripped,
and a tag left open discards everything after it.

So **record against the deployed stack**. Locally, §1 and §7 still pull apart and you will be
fighting the model rather than showing the product.

Three things that will waste your time if you don't know them:

- **Ask each question once, on a clean session.** Asking twice trips Recall's repeat detector, which
  is correct behaviour (it exists for §9.3) but makes the assistant answer "shall I order that
  *again*?" rather than from the facts. Between takes:
  against RDS — `psql "$DATABASE_URL" -c "DELETE FROM session_turn; DELETE FROM session;"`, or the
  same through the local Postgres container as a client:
  `docker exec -e PGPASSWORD=… recall-postgres-1 psql -h <rds-endpoint> -U recall -d recall -c "DELETE FROM session_turn; DELETE FROM session;"`
- **Sessions hand off between devices**, so switching device does not give you a fresh conversation.
- **Neither model is deterministic**, even at temperature 0.2. Rehearse each beat and keep the takes
  where it behaved. The server is deterministic and correct; the stand-in assistant is not.

