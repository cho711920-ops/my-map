-- Retire the old Google Apps Script synchronization queue while preserving its audit trail.
UPDATE jobs
SET state = 'completed',
    last_error = 'Retired during Cloudflare D1 standalone cutover',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE job_type = 'apps-script-sync'
  AND state IN ('pending', 'running', 'paused');

CREATE INDEX IF NOT EXISTS idx_collector_raw_review
ON collector_raw(processing_state, source, created_at);
