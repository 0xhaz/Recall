-- Week 4d: care mode (design.md §5). A caregiver's policy per topic for the person they care for:
-- correct (say plainly what is true, for safety) or redirect (reassure, turn to something familiar).
-- Built-in defaults (stove, doors, medication, "going home") live in code; rows here add or override.

CREATE TABLE care_policy (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES household(id),
  region       text NOT NULL,
  person_id    uuid NOT NULL REFERENCES person(id),   -- the person being cared for
  topic        text NOT NULL,
  keywords     text[] NOT NULL,
  policy       text NOT NULL CHECK (policy IN ('correct', 'redirect')),
  guidance     text,
  author_id    uuid REFERENCES person(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz
);
CREATE INDEX care_policy_person_idx ON care_policy (household_id, person_id) WHERE removed_at IS NULL;
