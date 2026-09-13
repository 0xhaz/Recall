-- Week 5b: medication and meal reminders (design.md §5). Caregiver-authored and never mined: the
-- assistant does not decide to raise health topics, it only carries a schedule someone entered.
-- Each due dose gets its own row, so "did she take it" is answered from record, never inferred.

CREATE TABLE care_reminder (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid NOT NULL REFERENCES household(id),
  region                 text NOT NULL,
  person_id              uuid NOT NULL REFERENCES person(id),   -- the person being cared for
  kind                   text NOT NULL DEFAULT 'medication' CHECK (kind IN ('medication', 'meal', 'other')),
  label                  text NOT NULL,                          -- the caregiver's own words
  dose                   text,
  times                  smallint[] NOT NULL,                    -- local minutes past midnight, one per dose
  days                   text NOT NULL DEFAULT 'daily' CHECK (days IN ('daily', 'weekdays', 'weekends')),
  device_id              text,                                   -- where to ask; their usual device otherwise
  grace_minutes          int NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 240),
  escalate_after_minutes int NOT NULL DEFAULT 30 CHECK (escalate_after_minutes BETWEEN 5 AND 480),
  author_id              uuid REFERENCES person(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz
);
CREATE INDEX care_reminder_person_idx ON care_reminder (household_id, person_id) WHERE removed_at IS NULL;

CREATE TABLE care_reminder_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id),
  region        text NOT NULL,
  reminder_id   uuid NOT NULL REFERENCES care_reminder(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES person(id),
  local_date    date NOT NULL,
  local_minute  smallint NOT NULL CHECK (local_minute BETWEEN 0 AND 1439),
  due_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'missed', 'skipped')),
  prompted_at   timestamptz,
  escalated_at  timestamptz,
  confirmed_at  timestamptz,
  confirmed_by  uuid REFERENCES person(id),
  -- How the confirmation arrived. Spoken confirmations are kept as screened text: no audio is stored.
  how           text CHECK (how IN ('voice', 'console')),
  note          text,
  UNIQUE (reminder_id, due_at)
);
CREATE INDEX care_reminder_log_day_idx ON care_reminder_log (household_id, person_id, local_date);
