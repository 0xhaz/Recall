# Demo video script — 3:00

A shot-by-shot script for the submission video. Narration is written to be read aloud to judges;
everything in **bold** is what's on screen.

**Total narration: 379 words** — about 2:32 read at a normal pace. The remaining 28 seconds are not
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

Everything is recorded against the **hosted stack** — nothing runs on this machine, so there is no
local server to fall over mid-take:

- Console: **https://6gpwq7kegp.us-east-1.awsapprunner.com**
- Sign in with the one-click demo buttons. Emma for the first half, Nina for the second.

Then **make the medication dose filmable**. The seed confirms every dose that has already passed,
and a spoken confirmation only lands within 60 minutes before or 240 after one — so filming at an
arbitrary hour gets Ruth correctly told that nothing is due.

Do it as Nina, in the UI, a few minutes before you record:

1. **Care** page → *Add to the schedule*
2. What to take: `Evening tablets` · How much: `2 tablets` · When: **two minutes from now**, in the
   household's own clock (shown top right of that page) · Every day
3. **Save reminder**, then wait. Within about two minutes the dose turns from *later today* to
   **not confirmed** — that is the watcher prompting Ruth on her own device, which is what makes the
   spoken confirmation land.

Delete that reminder afterwards so the demo resets clean. *(Measured against production: pending
105 seconds after saving.)*

Open four tabs on the hosted console: **Simulator**, **Memory**, **Care**, **Overview**.

---

## 0:00 – 0:20 · What it is

> **Screen:** the console Overview, counts visible.

“Alexa+ forgets. Ask it something personal twice and you can get two different answers — and what it
does remember, everyone in the house can see.

Recall is a memory layer that can record and learn each family members daily routine for every household. Each family members will have their own routines that can be add, remove or even modified and it plugs into Alexa+ over MCP.”

---

## 0:20 – 0:40 · One memory, every device

> **Screen, in order:** the **Devices** page — five devices, each *synced to the same number*. Then
> the architecture diagram from the README. Then two seconds on `packages/skill/SKILL.md`, which is
> the checklist's *“Agent Skill shown in the video”* and the only shot that proves it.
>
> Let the diagram sit while you say the middle paragraph. Do not read the boxes out — the picture is
> doing that job, and the words are for the part a picture cannot carry.

“Five devices here. Two Echos, a TV, and two things people wear. None of them keeps its own notes.

They reach one memory, through MCP. The assistant holds nothing: it asks, and gets only what the
person in front of it may know.

What's kept is plain sentences — who said it, and when. Not recordings, and no raw heart rate.
Forget it here, it's gone from all five.”

---

## 0:40 – 0:55 · What it holds

> **Screen:** click through Memory → Rules → Routines → Actions. **Four clicks, no lingering.**

“Everything it knows is on one screen. Facts, with where each came from. Rules it must obey.
Routines it mined. Every action taken on someone's behalf.

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
| *“Nothing is waiting to be confirmed”* | The dose is outside the window, or already confirmed | Re-do the two-minute reminder above and wait for *not confirmed* |
| The new fact is not in Memory yet | Extraction is a background job | Refresh; it lands in about a second |
| The assistant says it knows nothing about Emma | Facts unembedded after a reseed | Give it a few seconds — the seed queues the re-embed itself |
| Simulator page says it is offline | The hosted container is restarting | Wait ~30 s and reload; `curl .../health` confirms it is back |

## Cutting room

If the first take runs long, cut in this order — each is the least load-bearing thing left:

1. **0:40–0:55** down to two clicks (Memory, Rules). Saves ~7s.
2. The second *“where is Arthur?”* — keep the first. Saves ~8s.
3. *“am I drinking coffee this week?”* — the fact appearing in Memory already made the point. Saves ~10s.

Never cut: the care plan in Nina's words, or the last line.
