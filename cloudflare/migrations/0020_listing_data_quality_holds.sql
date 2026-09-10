-- Records suspicious listing classifications without deleting or repurposing
-- the listing itself.  A repair tool may resolve a hold after writing the
-- corresponding before/after entry to listing_history.

CREATE TABLE IF NOT EXISTS listing_data_quality_holds (
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  issue_code TEXT NOT NULL,
  source_id TEXT REFERENCES listing_sources(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'resolved', 'dismissed')),
  blocks_publication INTEGER NOT NULL DEFAULT 1
    CHECK (blocks_publication IN (0, 1)),
  evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(evidence_json)),
  resolution_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(resolution_json)),
  detected_by TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (listing_id, issue_code)
);

CREATE INDEX IF NOT EXISTS idx_listing_data_quality_holds_open
  ON listing_data_quality_holds(state, blocks_publication, listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_data_quality_holds_source
  ON listing_data_quality_holds(source_id, state);
