-- Week 2: grants + audit, per-household MCP tokens, console magic-link auth,
-- utterances + job queue for async extraction, fact embeddings, LLM usage metering.

-- Identity ----------------------------------------------------------------

ALTER TABLE person ADD COLUMN email text;
CREATE UNIQUE INDEX person_email_uq ON person (lower(email)) WHERE email IS NOT NULL;

-- Caregiver grants live on the caregiver's membership (architecture.md §1.3).
ALTER TABLE membership ADD COLUMN grants text[] NOT NULL DEFAULT '{}'
  CHECK (grants <@ ARRAY['edit_care_plan','view_daily','enter_facts','set_rules','view_full_memory']::text[]);

-- Every membership, role, grant and token change is logged.
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id  uuid REFERENCES household(id),  -- null for person-level actions such as forget-me
  region        text,
  actor_id      uuid REFERENCES person(id),
  action        text NOT NULL,
  target_type   text NOT NULL,
  target_id     text,
  detail        jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_household_idx ON audit_log (household_id, at DESC);

-- Auth ----------------------------------------------------------------------

-- MCP bearer tokens, one or more per household. Only the SHA-256 is stored.
CREATE TABLE household_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id),
  region        text NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  label         text NOT NULL,
  created_by    uuid REFERENCES person(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  last_used_at  timestamptz
);

-- Console sign-in. A person is global, so these carry no household_id.
CREATE TABLE login_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE console_session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Extraction ------------------------------------------------------------------

-- What someone asked us to remember, already screened (blocked clauses removed).
-- The extractor turns these into facts. Precursor of the week-3 event log.
CREATE TABLE utterance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id),
  region        text NOT NULL,
  person_id     uuid NOT NULL REFERENCES person(id),
  scope_type    text NOT NULL CHECK (scope_type IN ('person','household')),
  text          text NOT NULL,
  redactions    text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  fact_ids      uuid[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  content_tsv   tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX utterance_pending_idx ON utterance (household_id, person_id) WHERE status = 'pending';

-- Postgres-backed job queue (FOR UPDATE SKIP LOCKED + NOTIFY).
CREATE TABLE job (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id  uuid NOT NULL REFERENCES household(id),
  kind          text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts      int NOT NULL DEFAULT 0,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_ready_idx ON job (run_after) WHERE status = 'queued';

-- 1024 dims: qwen3-embedding:0.6b locally, Titan Text Embeddings V2 (1024) on Bedrock.
ALTER TABLE fact ADD COLUMN embedding vector(1024);
CREATE INDEX fact_embedding_idx ON fact USING hnsw (embedding vector_cosine_ops);

-- Usage metering on LLM calls, per household per day (design.md §9).
CREATE TABLE llm_usage (
  household_id   uuid NOT NULL REFERENCES household(id),
  region         text NOT NULL,
  day            date NOT NULL,
  purpose        text NOT NULL,
  calls          int NOT NULL DEFAULT 0,
  input_tokens   bigint NOT NULL DEFAULT 0,
  output_tokens  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, day, purpose)
);

-- Week 1 stored raw statements as episodic facts. Move them to utterances and queue extraction.
INSERT INTO utterance (household_id, region, person_id, scope_type, text, created_at)
SELECT household_id, region, (source->>'speaker_id')::uuid, scope_type, content, created_at
  FROM fact
 WHERE source->>'origin' = 'user_statement' AND valid_to IS NULL;

INSERT INTO job (household_id, kind, payload)
SELECT household_id, 'extract', jsonb_build_object('utterance_id', id) FROM utterance;

DELETE FROM fact WHERE source->>'origin' = 'user_statement';
