CREATE TABLE IF NOT EXISTS operations_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL DEFAULT '{}',
  calculated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_listing_history_created
ON listing_history(id DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_allowed_users_active_role
ON allowed_users(active, role, email);
