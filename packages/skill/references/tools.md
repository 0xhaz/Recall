# The tool surface

Every tool about a person takes `speaker` and an optional `speaker_confidence` (a voice-match
score). Below 0.7 the speaker is treated as unknown: household memory only, and ask. Every read
carries the device-local date and time, so "tonight" means tonight where the person is.

## Start here

| Tool | Reach for it when |
|---|---|
| `session_brief` | First, for any request. Returns `temporal`, `speaker`, `ask_who_is_speaking`, `response_style`, `rules`, `facts` (ordered, the speaker's own first, each with `scope`, `source`, `confidence` and `why`), `active_session` when one is open, `device_state`, `contexts` and `quiet_hours` |

## Memory

| Tool | Reach for it when |
|---|---|
| `recall` | You need more than the brief returned — facts visible to this speaker, ranked by meaning and shared words |
| `remember` | Someone tells you something worth keeping. Acknowledges at once; extraction runs after |
| `forget` | Someone asks you to forget. By topic or id; asks when the match is unclear. Erases everywhere, for good |
| `explain_memory` | "What do you know about me?" — what is held, with sources, and "nothing stored about …" when there is nothing |
| `verify_claim` | Before asserting something you are not certain of. Returns the evidence on record and what changed, not a verdict |
| `set_communication_style` | Someone asks you to be briefer, drop the commentary, stop the jokes |

## Rules

| Tool | Reach for it when |
|---|---|
| `set_rule` | Someone states a rule. Stored word for word; conflicts are reported, never resolved for them |
| `list_rules` | You need the rules in force, in their author's own words |
| `remove_rule` | Only the author, or a caregiver, may remove one |

## Doing things

| Tool | Reach for it when |
|---|---|
| `action_preflight` | **Before** any order, booking, ride, call or device change. Rules, quiet hours, the address on record, venues used before, repeat orders, unusual amounts, routine clashes |
| `propose_action` | You may offer something: a routine that is due, the next step of a chain, music for the live context. One offer, with its source. Nothing during quiet hours |
| `decide_action` | The person answered. `confirm` carries it out with an undo window; `dismiss` teaches the offer to back off |
| `undo` | "Undo that" — reverses the last action while its window is open |

## Devices and context

| Tool | Reach for it when |
|---|---|
| `device_state` | **The only** source for what is playing, timers, alarms, subscriptions |
| `session_history` | Before any claim about what was said earlier |
| `get_context` | Whether a context is live (workout, wind-down, party, festive, focus) and why, plus quiet hours and routines due |
| `set_context` | "Workout mode" / "stop workout mode". Wins over the signals for a while, and calibrates that person's trigger |
| `suggest_music` | Music for the live context, ranked by what this person plays and skips in it. Returns nothing when a rule forbids it |
| `resolve_speaker` | The device handles this; you are given the result |
| `ingest_events`, `sync` | Device plumbing. Not yours to call |

## Care

| Tool | Reach for it when |
|---|---|
| `checkin` | "I'm up", "good morning" from someone being cared for. Their own words only — never check in on their behalf |
| `set_care_policy` | A caregiver says how a topic should be handled: corrected, or redirected in their words |
| `set_reminder` | A caregiver sets a medication or meal schedule for the person they look after |
| `confirm_reminder` | The person says they have taken it. Theirs to say; kept as screened text, never audio |

## What the honesty tools are for

`explain_memory`, `verify_claim`, `session_history` and `device_state` exist so that a claim can be
checked before it is made. Reaching for them is not caution to be skipped when you feel sure — being
sure is exactly when an invented memory is most convincing.
