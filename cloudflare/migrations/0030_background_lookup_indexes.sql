-- Both arms of the elevator-location OR must be indexed. Without this
-- expression index each location update scans every listing, even when the
-- exact lot-address index can satisfy the other arm.
CREATE INDEX IF NOT EXISTS idx_listings_trimmed_road_address_v78
  ON listings (trim(COALESCE(road_address,'')));

CREATE INDEX IF NOT EXISTS idx_collector_sessions_active_updated_v78
  ON collector_sessions (state, julianday(updated_at));

-- No raw advertisement, phone, key or password is retained here. A receipt
-- is committed atomically with the exact source transaction it fences.
CREATE TABLE IF NOT EXISTS collector_source_write_receipts (
  id TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collector_source_write_receipts_expiry_v78
  ON collector_source_write_receipts (expires_at);
