-- Week 1 schema: tenancy skeleton + the fact record from architecture.md §1.2.
-- Every household-owned table carries household_id and region from day one.
-- Week 2 extends this (grants, audit, embeddings, rules); week 3 adds the event log.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE household (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  region      text NOT NULL,
  timezone    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A person is a global account; everything they own is scoped through membership.
CREATE TABLE person (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE membership (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES household(id),
  person_id      uuid NOT NULL REFERENCES person(id),
  role           text NOT NULL CHECK (role IN ('owner','adult','child','guest','caregiver','cared_for')),
  granted_by     uuid REFERENCES person(id),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  capacity_flag  boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX membership_active_uq ON membership (household_id, person_id) WHERE revoked_at IS NULL;

CREATE TABLE fact (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES household(id),
  region           text NOT NULL,
  scope_type       text NOT NULL CHECK (scope_type IN ('person','household','device')),
  scope_id         uuid NOT NULL,
  type             text NOT NULL CHECK (type IN ('episodic','semantic','procedural')),
  content          text NOT NULL,
  entities         jsonb NOT NULL DEFAULT '[]',
  source           jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_to         timestamptz,
  confidence       real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  sensitivity_tag  text NOT NULL DEFAULT 'none'
                   CHECK (sensitivity_tag IN ('none','pii','health','financial','third_party','child')),
  ttl              interval,
  last_accessed    timestamptz,
  superseded_by    uuid REFERENCES fact(id),
  content_tsv      tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

-- "What's true now" is a filter, so index the current rows per scope.
CREATE INDEX fact_current_scope_idx ON fact (household_id, scope_type, scope_id) WHERE valid_to IS NULL;
CREATE INDEX fact_tsv_idx ON fact USING gin (content_tsv);
