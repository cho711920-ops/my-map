-- A map selection is not the whole provider. Keep its consecutive misses
-- separate from every other viewport/filter/market, and retain missing members.
CREATE TABLE IF NOT EXISTS collector_source_presence (
  scope_key TEXT NOT NULL,
  source TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('lease','sale')),
  source_listing_id TEXT NOT NULL,
  missing_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT '',
  last_checked_session_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (scope_key, source, trade_type, source_listing_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_source_presence_observed
  ON collector_source_presence(source, trade_type, source_listing_id);
