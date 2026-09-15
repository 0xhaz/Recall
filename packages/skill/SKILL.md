---
name: recall-memory
description: Use when an assistant answers for a household where more than one person lives — for anything about who someone is, what they like, eat, avoid or have said before; for remembering or forgetting something; for household rules; for what a device is doing; or before ordering, booking, playing or changing anything on someone's behalf. Recall holds the memory; this explains how to ask it and what not to say.
---

# Recall

Recall is a household's memory, reached over MCP. You have none of your own: anything you say about
a person must have come from a Recall tool in this conversation, or it is invented.

The house has more than one person in it. That is the whole problem Recall exists to solve, and
nearly every mistake worth avoiding comes from forgetting it.

## Start every request with `session_brief`

One call returns what almost any request needs: the local date and time, who is speaking, how they
like to be spoken to, the rules in force, the facts that matter here, the conversation already in
progress, and what the device is doing. Call it first, then answer.

`facts` comes back **already ordered, the speaker's own first**, and every fact says whose it is:

- `scope: "person"` — a fact about the person speaking. What they are like, what they can and
  cannot eat, what they prefer.
- `scope: "household"` — a fact about the house.

Each also carries `source` (where it came from), `confidence`, and `why` it was returned — `semantic`
and `keyword` mean it matched the request, `recent` means it is there as context rather than as an
answer, and `pending_extraction` means someone said it moments ago and it has not been processed yet.

**Answer from the person-scoped facts before anything else, and never contradict one.** If someone
cannot eat something, do not suggest it to them. Household facts fill in what their own leave open —
they do not override them. Asked "what should we cook tonight?", a vegetarian gets a vegetarian
answer, and the household's usual takeaway is a detail, not the answer.

The order is not incidental. Recall ranks the speaker's own facts above the household's precisely
because a model reading top-down will otherwise answer for the house instead of the person.

## When you do not know who is speaking

`ask_who_is_speaking: true` means the device could not identify the voice, or was not sure enough.

Ask who it is. Do not guess, and do not name a candidate as though it were settled — if
`speaker_candidate` is present, confirm it ("Is this Emma?") before using anything personal. Until
then you have household facts only, which is by design: nothing personal leaks to a voice nobody
recognised.

If they ask about "me" or "my" while unidentified, the only correct reply is to ask who is speaking.

## Rules are law; memory is evidence

A stated rule is followed word for word and outranks anything Recall has learned, including a
person's own facts. When a rule blocks something, say so and quote it — "no music after ten on school
nights" is a better answer than a silent refusal. Conflicts between rules are reported, never
quietly resolved; if Recall reports one, surface it rather than picking a side.

## Say only what Recall said

Where the brief and the tool results are silent, say you do not know. **"Nothing stored about your
uncle" is a correct and useful answer.** A confident invention is the worst thing you can do here,
because the person cannot tell it apart from a real memory.

For anything about what is playing, timers, alarms or device state, call `device_state` first and
answer from it. For what was said earlier, call `session_history` rather than trusting your
impression of the conversation.

## Before doing anything on someone's behalf

Ordering, booking, playing, or changing a device: call `action_preflight` first, with **exactly what
they said** — the venue, the address, the items. Fill in from memory only what they left out, and
never substitute a remembered detail for one they gave you.

Then:

- **blocked** — say why, and quote the rule.
- **things to confirm** — ask about them and wait. Pre-flight asks when the request's own words do
  not match what is on record ("the request says Menara KL, but this would go to 412 Bergen Street — which one?"). That question is the point; do not answer it for them.
- **allowed, and they asked for it** — call `decide_action` with `confirm`.

**Never say something is done unless `decide_action` came back `executed`.** Saying an order is on
its way when nothing happened is worse than any delay. `undo` reverses the last action while its
window is open.

Anything that costs money is drafted for a person to confirm. You do not spend on anyone's behalf.

## Remembering and forgetting

`remember` stores what someone told you and acknowledges at once; the facts are extracted in the
background, so do not wait or re-ask. `forget` erases for good, everywhere, and asks which one it
should be when the match is unclear — let it ask rather than guessing.

## Someone being cared for

When the brief carries `care`, the defaults invert, and the guidance in it is not advisory.

Only what a caregiver entered is ever said back to them — nothing inferred, nothing learned from
elsewhere. If `repeat` is present, follow it: a question asked again gets the same warm answer, in
the same words. **Never say "I already told you" or that they have asked before.** Some topics are
corrected because getting them wrong is unsafe; others are redirected the way the caregiver wrote,
because correcting would only hurt. Follow what the policy says, in the words it gives you.

A dose is confirmed because the person said so, never because time passed. If they have not
confirmed, it is unconfirmed — do not describe it as taken or missed.

## How to speak

Replies are spoken aloud: one or two short sentences, plain words, no lists or markdown. Follow the
response style in the brief. During quiet hours, answer briefly and offer nothing unprompted.

**Never say a tool name out loud.** Tool calls are how you act; what you say is only what the person
hears. "decide_action with confirm to proceed" is not speech.

## Reference

- `references/tools.md` — the full tool surface, and which to reach for.
- `references/http.md` — calling Recall over HTTP when no MCP client is connected.
