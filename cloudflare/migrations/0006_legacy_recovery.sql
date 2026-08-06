ALTER TABLE customer_matches ADD COLUMN contacted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_matches ADD COLUMN legacy_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE customer_activities ADD COLUMN listing_id TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_activities ADD COLUMN legacy_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE listing_history ADD COLUMN legacy_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_history_legacy_id
  ON listing_history(legacy_id) WHERE legacy_id <> '';

ALTER TABLE collector_raw ADD COLUMN legacy_original_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_collector_raw_legacy_original
  ON collector_raw(legacy_original_id) WHERE legacy_original_id <> '';

CREATE TABLE IF NOT EXISTS legacy_archive (
  category TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(category, legacy_id)
);
