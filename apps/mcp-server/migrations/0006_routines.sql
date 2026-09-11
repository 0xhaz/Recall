-- Week 4a: routines (architecture.md §2) and check-ins.
--  - activity: a compact projection of what happened when, kept 60 days so routines can be mined
--    long after raw events are compacted (only derived data outlives retention, A§4.1).
--  - routine: mined usual times, their day pattern, health and lifecycle.
--  - notice: check-in messages, prompts and alerts, each delivered once (dedupe_key).

CREATE TABLE activity (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id  uuid NOT NULL REFERENCES household(id),
  region        text NOT NULL,
  person_id     uuid REFERENCES person(id),
  kind          text NOT NULL,
  device_id     text,
  local_date    date NOT NULL,                 -- household-local
  local_minute  smallint NOT NULL CHECK (local_minute BETWEEN 0 AND 1439),
  ok            boolean NOT NULL DEFAULT true, -- false when the device reported the action failed
  at            timestamptz NOT NULL,
  event_id      uuid UNIQUE
);
CREATE INDEX activity_mine_idx ON activity (household_id, local_date);
CREATE INDEX activity_person_idx ON activity (household_id, person_id, kind, local_date);

CREATE TABLE routine (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES household(id),
  region         text NOT NULL,
  person_id      uuid REFERENCES person(id),   -- null: the household as a whole
  kind           text NOT NULL,
  days           text NOT NULL CHECK (days IN ('daily', 'weekdays', 'weekends')),
  center_minute  smallint NOT NULL,
  spread_minutes smallint NOT NULL,
  shifted_from   smallint,
  support        real NOT NULL,
  confidence     real NOT NULL,
  last_seen      date,
  sequence       text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'offered', 'active', 'retired')),
  health         text NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'fading', 'broken')),
  health_reason  text,
  accepted       int NOT NULL DEFAULT 0,
  dismissed      int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routine_household_idx ON routine (household_id, person_id);

CREATE TABLE notice (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES household(id),
  region           text NOT NULL,
  person_id        uuid REFERENCES person(id),  -- who it is about
  kind             text NOT NULL,               -- checkin | checkin_prompt | missed_checkin | checkin_followup | ...
  audience         text NOT NULL CHECK (audience IN ('person', 'household', 'carers')),
  text             text NOT NULL,
  device_id        text,                        -- where to say it, for prompts to the person
  dedupe_key       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES person(id),
  UNIQUE (household_id, dedupe_key)
);
