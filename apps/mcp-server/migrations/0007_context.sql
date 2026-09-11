-- Week 4b: the context engine (architecture.md §3) and the music policy (§3.1).
-- Only derived values are stored here — scores, thresholds, affinities — never raw heart rate.

-- When an event happened, from its HLC: replayed and late events are placed by when they occurred.
ALTER TABLE event ADD COLUMN occurred_at timestamptz
  GENERATED ALWAYS AS (to_timestamp(substring(hlc, 1, 13)::bigint / 1000.0)) STORED;
CREATE INDEX event_occurred_idx ON event (household_id, occurred_at);

-- Current context per person (workout) or for the household (person_key = ''), with its debounce state.
CREATE TABLE context_state (
  household_id  uuid NOT NULL REFERENCES household(id),
  region        text NOT NULL,
  person_key    text NOT NULL,
  person_id     uuid REFERENCES person(id),
  context       text NOT NULL,
  score         real NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT false,
  since         timestamptz,
  above_since   timestamptz,
  below_since   timestamptz,
  manual_until  timestamptz,
  reasons       text[] NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, person_key, context)
);

-- Per-person thresholds: resting heart rate, and the workout trigger learned from manual overrides.
CREATE TABLE context_baseline (
  household_id    uuid NOT NULL REFERENCES household(id),
  region          text NOT NULL,
  person_id       uuid NOT NULL REFERENCES person(id),
  resting_hr      real,
  workout_ratio   real,
  manual_samples  int NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, person_id)
);

-- What each person plays or skips, per context: a skip during a workout says nothing about wind-down.
CREATE TABLE track_affinity (
  household_id    uuid NOT NULL REFERENCES household(id),
  region          text NOT NULL,
  person_id       uuid NOT NULL REFERENCES person(id),
  context         text NOT NULL,
  track_id        text NOT NULL,
  plays           int NOT NULL DEFAULT 0,
  skips           int NOT NULL DEFAULT 0,
  completes       int NOT NULL DEFAULT 0,
  last_played_at  timestamptz,
  PRIMARY KEY (household_id, person_id, context, track_id)
);
