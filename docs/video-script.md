# Demo video script — 3:00

A shot-by-shot script for the submission video. Narration is written to be read aloud to judges;
everything in **bold** is what's on screen.

**Total narration: 367 words** — about 2:27 read at a normal pace. The remaining 33 seconds are not
spare: they are the assistant thinking (roughly four seconds a turn, five turns) and the tab
switches. Do not fill them with more words.

The rules say judges need not watch past three minutes, so the two beats that matter most — Emma,
then the caregiver — start at 0:55 and run to the end.

---

## Before you record

Three rules from the submission page, and what each one means here:

| Rule | What to do |
|---|---|
| Under 3 minutes, public, English | Hard cut at 3:00. Upload unlisted first and watch it once end to end. |
| No copyrighted music or footage | **No soundtrack.** Do not demo `suggest_music` — the track names are real. Do not say *"play The Secret Life of Walter Mitty"*; say **"play something"**. |
| No third-party trademarks | Alexa+ is the track's own technology, so naming it is expected. Everything else on screen is ours. |

Prep, in order:

```bash
pnpm db:up && pnpm db:seed          # resets the demo to a known state
pnpm dev                            # Recall on :3100
pnpm sim                            # the simulated Alexa+ on :3200
pnpm console                        # the console on :3000
```

Then **make the medication dose filmable**. The seed confirms every dose that has already passed,
and a spoken confirmation only lands within 60 minutes before or 240 after one — so without this,
Ruth says she has taken her tablets and Recall correctly answers that nothing is due. This moves
the evening dose to right now and leaves it waiting:

```bash
docker exec recall-postgres-1 psql -U recall -d recall -c "
WITH n AS (SELECT timezone('America/New_York', now()) AS t),
     m AS (UPDATE care_reminder SET times = ARRAY[(extract(hour from (SELECT t FROM n))*60
                                                 + extract(minute from (SELECT t FROM n)))::smallint]
            WHERE label = 'Evening tablets' RETURNING id, household_id, person_id, times[1] AS minute)
INSERT INTO care_reminder_log (household_id, region, reminder_id, person_id, local_date,
                               local_minute, due_at, status, prompted_at)
SELECT m.household_id, 'us', m.id, m.person_id, (SELECT t FROM n)::date, m.minute, now(), 'pending', now()
  FROM m ON CONFLICT (reminder_id, due_at) DO NOTHING;"
```

Open four tabs: **Simulator**, **Memory**, **Care**, **Overview**. Sign in with the one-click demo
buttons — Emma for the first half, Nina for the second.

---

## 0:00 – 0:20 · What it is

> **Screen:** the console Overview, counts visible.

“Alexa+ forgets. Ask it something personal twice and you can get two different answers — and what it
does remember, everyone in the house can see.

Recall is a memory layer the household owns instead. Per-person, inspectable, and anything in it can
be corrected or erased. It plugs into Alexa+ over MCP.”

---

## 0:20 – 0:40 · How it is built

> **Screen:** Overview → Devices, then a two-second cut to `packages/skill/SKILL.md` open in an
> editor. That shot is the submission checklist's *“Agent Skill shown in the video”* — it costs
> five seconds and nothing else in the cut proves it.

“It is an MCP server on spec 2025-11-25 over streamable HTTP, on App Runner. Nova Lite answers,
Titan embeds, Postgres with pgvector stores. The same tools also ship as an Agent Skill.

The assistant never touches the database. It asks for a session brief and gets back only what this
speaker is allowed to know — which is why the same question gives two people different answers.”

---

## 0:40 – 0:55 · What it holds

> **Screen:** click through Memory → Rules → Routines → Actions. **Four clicks, no lingering.**

“Everything it knows is on one screen. Facts, with where each came from. Rules it has to obey.
Routines it mined from what actually happened. Every action taken on someone's behalf.

Nothing is inferred quietly.”

---

## 0:55 – 1:35 · Emma teaches it something ★

> **Screen:** Simulator. Speaker **Emma**, device **Kitchen Echo Show**.
> **Type:** `Remember I am off coffee until Wednesday`

“Emma tells it something new.”

> *It answers aloud — Amazon Polly — and the tool trace shows `session_brief`, then `remember`.*

“Stored immediately — the trace shows what each call cost — and she could ask about it in the next
breath.

In the background it extracts the fact and resolves ‘Wednesday’ to a real date — in code, not by the
model, because models get calendar arithmetic wrong.”

> **Screen:** switch to **Memory**. The new fact is there: *Emma is off coffee*, expiring Wednesday.
> **Back to Simulator. Type:** `am I drinking coffee this week?`

“And it answers from what it stored.”

> *“No, you are not drinking coffee this week.”*

---

## 1:35 – 2:35 · The caregiver ★★

> **Screen:** Simulator. Speaker **Ruth**, device **Ruth's Echo**.
> **Type:** `where is Arthur?`

“Ruth is eighty-one and lives with the family. Her husband Arthur died in 2019.”

> *“Arthur isn't here right now. Would you like to talk about the garden we used to keep?”*

“That is not the model being tactful. It is Nina's own wording, from the care plan.”

> **Screen:** **Care** page, Arthur policy visible. Then back. **Send the same question again.**

“Ask again and she gets the same warm answer. Never ‘I already told you’.”

> **Type:** `I have taken my tablets`
> *“Thank you, Ruth. I've let the carers know.”*

“Confirming is hers to do. Recall records that she said so — and nothing more.”

> **Screen:** **Care** page. Point at today's doses, then scroll to the seven-day view.

“Nina sees her day, and the week behind it. Taken, missed, and — kept separate — no record at all.
Unconfirmed is not the same as not taken, and Recall will not guess the difference.”

---

## 2:35 – 3:00 · Close

> **Screen:** Simulator with the tool trace open.

“Three hundred and twenty-two tests. A session brief comes back in ten milliseconds.

The hardest part was not what it remembers. It was what it refuses to say: bought twice is not a
pattern, and nobody answering is not the same as nobody taking their tablets.

A memory worth trusting is one that knows what it does not know.”

> **Cut.**

---

## If something goes wrong on camera

| Problem | Why | What to do |
|---|---|---|
| *“Nothing is waiting to be confirmed”* | The dose is outside the window, or already confirmed | Re-run the prep block above |
| The new fact is not in Memory yet | Extraction is a background job | Wait a second and refresh; it lands in about one |
| The assistant says it knows nothing about Emma | Facts unembedded on a fresh database | `pnpm db:seed` queues the re-embed; give it a few seconds |
| Simulator page says it is offline | `pnpm sim` is a separate process | Start it, reload |

## Cutting room

If the first take runs long, cut in this order — each is the least load-bearing thing left:

1. **0:40–0:55** down to two clicks (Memory, Rules). Saves ~7s.
2. The second *“where is Arthur?”* — keep the first. Saves ~8s.
3. *“am I drinking coffee this week?”* — the fact appearing in Memory already made the point. Saves ~10s.

Never cut: the care plan in Nina's words, or the last line.
