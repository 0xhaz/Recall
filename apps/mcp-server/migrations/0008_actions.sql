-- Week 4c: actions (architecture.md §5, design.md §3.2–3.3): what was checked, offered, done and undone.
-- Order history is simply the executed order.food / purchase actions.

CREATE TABLE action (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES household(id),
  region       text NOT NULL,
  person_id    uuid REFERENCES person(id),           -- who it is for
  device_id    text,
  intent       text NOT NULL,
  summary      text NOT NULL,
  topics       text[] NOT NULL DEFAULT '{}',
  details      jsonb NOT NULL DEFAULT '{}',           -- venue, address, amount, when, items
  command      jsonb,                                 -- the device command, for device actions
  proactive    boolean NOT NULL DEFAULT false,
  source       jsonb,                                 -- provenance of an offer (routine or context)
  offer_key    text,                                  -- 'routine:<id>' / 'music:<context>': answers per offer
  routine_id   uuid REFERENCES routine(id) ON DELETE SET NULL,
  tier         text NOT NULL DEFAULT 'suggest' CHECK (tier IN ('inform', 'suggest', 'draft', 'act')),
  status       text NOT NULL CHECK (status IN ('checked', 'offered', 'executed', 'dismissed', 'blocked', 'undone')),
  preflight    jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  undo_until   timestamptz,
  undone_at    timestamptz
);
CREATE INDEX action_history_idx ON action (household_id, intent, status, decided_at DESC);
CREATE INDEX action_offer_idx ON action (household_id, offer_key, created_at DESC) WHERE offer_key IS NOT NULL;
CREATE INDEX action_person_idx ON action (household_id, person_id, decided_at DESC);
