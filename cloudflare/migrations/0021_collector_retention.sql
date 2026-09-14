-- No data is deleted by this migration. Runtime retention is archive-first.
CREATE TABLE IF NOT EXISTS collector_retention_state (
  id TEXT PRIMARY KEY CHECK (id='daily'),
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_run_at TEXT NOT NULL DEFAULT '',
  cursor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cursor_json)),
  last_report_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(last_report_json)),
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_collector_raw_retention_scan
  ON collector_raw(created_at,id) WHERE processing_state IN ('processed','duplicate');
CREATE INDEX IF NOT EXISTS idx_collector_sessions_retention_scan
  ON collector_sessions(updated_at,id)
  WHERE state IN ('completed','partial','failed','abandoned','cancelled');
CREATE INDEX IF NOT EXISTS idx_listing_sources_session_retention
  ON listing_sources(session_id);
CREATE INDEX IF NOT EXISTS idx_collector_raw_unresolved_canonical_retention
  ON collector_raw(json_extract(CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END,'$.canonicalReviewId'))
  WHERE processing_state NOT IN ('processed','duplicate');
