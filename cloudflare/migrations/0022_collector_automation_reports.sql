-- Minimal run-level telemetry. No collector keys, URLs, raw records or contacts.
CREATE TABLE IF NOT EXISTS collector_automation_runs (
  run_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  started_at TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json))
);
CREATE INDEX IF NOT EXISTS idx_collector_automation_runs_started
  ON collector_automation_runs(started_at DESC);
