-- Week 3: the append-only event log (architecture.md §4), devices and their reported state,
-- conversation sessions, projection snapshots, and the retention settings compaction needs.

-- Raw events are kept `retention_days` (A§4.1: 90 by default; the hackathon seed uses 7).
-- Devices whose cursor is at or below `compacted_through` re-sync from a snapshot.
ALTER TABLE household
  ADD COLUMN retention_days int NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 365),
  ADD COLUMN compacted_through bigint NOT NULL DEFAULT 0;

-- seq is the server's arrival order and the sync cursor; hlc is the causal order used for merging.
CREATE TABLE event (
  seq                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id           uuid NOT NULL UNIQUE,
  household_id       uuid NOT NULL REFERENCES household(id),
  region             text NOT NULL,
  hlc                text NOT NULL,
  device_id          text,
  person_id          uuid REFERENCES person(id),
  person_confidence  real,
  location           text,
  kind               text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}',
  sensitive          boolean NOT NULL DEFAULT false,  -- raw health signals: 7-day retention, never synced
  tombstone          boolean NOT NULL DEFAULT false,  -- kept retention + 30 days
  received_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_sync_idx ON event (household_id, seq);
CREATE INDEX event_hlc_idx ON event (household_id, hlc);

ALTER TABLE fact
  ADD COLUMN hlc text,
  ADD COLUMN forgotten_at timestamptz;

ALTER TABLE utterance
  ADD COLUMN hlc text,
  ADD COLUMN device_id text;
ALTER TABLE utterance DROP CONSTRAINT utterance_status_check;
ALTER TABLE utterance ADD CONSTRAINT utterance_status_check
  CHECK (status IN ('pending', 'done', 'failed', 'forgotten'));

-- The one definition of what a fact looks like to a device: used for fact.created events and snapshots.
CREATE VIEW fact_view AS
SELECT f.id, f.household_id, f.region, f.valid_to, f.forgotten_at, f.hlc,
       jsonb_build_object(
         'id', f.id, 'scope_type', f.scope_type, 'scope_id', f.scope_id, 'type', f.type,
         'content', f.content, 'confidence', f.confidence, 'sensitivity', f.sensitivity_tag,
         'valid_from', f.valid_from, 'expires_at', f.valid_from + f.ttl, 'hlc', f.hlc
       ) AS view
  FROM fact f;

CREATE TABLE device (
  household_id       uuid NOT NULL REFERENCES household(id),
  device_id          text NOT NULL,
  region             text NOT NULL,
  name               text,
  location           text,
  primary_person_id  uuid REFERENCES person(id),
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_cursor        bigint NOT NULL DEFAULT 0,
  state              jsonb NOT NULL DEFAULT '{}',  -- device_state projection (LWW per key by HLC)
  PRIMARY KEY (household_id, device_id)
);

-- Short-lived conversations, projected from session.* events; the turn log is what session_history returns.
CREATE TABLE session (
  id            uuid PRIMARY KEY,
  household_id  uuid NOT NULL REFERENCES household(id),
  region        text NOT NULL,
  device_id     text NOT NULL,
  person_id     uuid REFERENCES person(id),
  opened_at     timestamptz NOT NULL,
  last_turn_at  timestamptz NOT NULL,
  closed_at     timestamptz
);
CREATE INDEX session_recent_idx ON session (household_id, last_turn_at DESC);

CREATE TABLE session_turn (
  event_id      uuid PRIMARY KEY,
  session_id    uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  household_id  uuid NOT NULL REFERENCES household(id),
  role          text NOT NULL CHECK (role IN ('user', 'assistant')),
  text          text NOT NULL,
  hlc           text NOT NULL,
  at            timestamptz NOT NULL
);
CREATE INDEX session_turn_order_idx ON session_turn (session_id, hlc);

-- Nightly copies of every projection; `seq` is the last event they reflect.
CREATE TABLE snapshot (
  household_id  uuid NOT NULL REFERENCES household(id),
  seq           bigint NOT NULL,
  data          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, seq)
);

-- Facts written before the event log existed get a fact.created event, so a device syncing from
-- zero sees them. Deterministic ids make it safe to repeat; the seed calls it too.
CREATE FUNCTION recall_backfill_fact_events() RETURNS void LANGUAGE sql AS $$
  UPDATE fact
     SET hlc = lpad((extract(epoch FROM created_at) * 1000)::bigint::text, 13, '0') || '-00000-backfill'
   WHERE hlc IS NULL;
  INSERT INTO event (event_id, household_id, region, hlc, kind, payload)
  SELECT md5('fact.created:' || v.id)::uuid, v.household_id, v.region, v.hlc, 'fact.created',
         jsonb_build_object('fact', v.view)
    FROM fact_view v
   WHERE v.valid_to IS NULL
   ORDER BY v.hlc
  ON CONFLICT (event_id) DO NOTHING;
$$;

SELECT recall_backfill_fact_events();
