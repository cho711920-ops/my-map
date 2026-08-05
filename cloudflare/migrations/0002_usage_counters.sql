CREATE TABLE IF NOT EXISTS usage_counters (
  counter_key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_updated
  ON usage_counters(updated_at DESC);
