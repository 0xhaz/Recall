-- Week 3c: stated rules (architecture.md §1.5) — user- or caregiver-authored constraints,
-- stored verbatim with a structured form, synced to devices as rule.set / rule.removed events.

CREATE TABLE rule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES household(id),
  region       text NOT NULL,
  author_id    uuid REFERENCES person(id),
  author_role  text NOT NULL,                    -- role at authoring time; drives precedence
  scope_type   text NOT NULL CHECK (scope_type IN ('person', 'household', 'device')),
  scope_id     text NOT NULL,                    -- person id, household id, or device id
  text         text NOT NULL,                    -- the rule in the author's own words
  effect       text NOT NULL CHECK (effect IN ('block', 'require_confirm', 'suppress_offer', 'prefer', 'allow')),
  severity     text NOT NULL DEFAULT 'hard' CHECK (severity IN ('safety', 'hard', 'soft')),
  subject      jsonb NOT NULL DEFAULT '{}',
  condition    jsonb NOT NULL DEFAULT '{}',
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,                      -- tombstone
  removed_by   uuid REFERENCES person(id),
  hlc          text
);
CREATE INDEX rule_active_idx ON rule (household_id) WHERE removed_at IS NULL;

-- The one definition of a rule as devices see it: used for rule.set events and snapshots.
CREATE VIEW rule_view AS
SELECT r.id, r.household_id, r.region, r.removed_at, r.hlc,
       jsonb_build_object(
         'id', r.id, 'text', r.text, 'author_id', r.author_id, 'author_role', r.author_role,
         'scope_type', r.scope_type, 'scope_id', r.scope_id, 'effect', r.effect, 'severity', r.severity,
         'subject', r.subject, 'condition', r.condition, 'expires_at', r.expires_at,
         'created_at', r.created_at, 'hlc', r.hlc
       ) AS view
  FROM rule r;
