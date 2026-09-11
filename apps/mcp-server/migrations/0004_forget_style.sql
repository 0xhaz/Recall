-- Week 3b: per-person communication style (tone dial, design.md §3.2 #6), and lookups for
-- tombstones (stale-statement check) and facts still waiting for an embedding.

ALTER TABLE person ADD COLUMN communication_style jsonb NOT NULL DEFAULT '{}';

CREATE INDEX fact_tombstone_idx ON fact (household_id, scope_type, scope_id) WHERE forgotten_at IS NOT NULL;
CREATE INDEX fact_unembedded_idx ON fact (household_id) WHERE embedding IS NULL AND forgotten_at IS NULL;
