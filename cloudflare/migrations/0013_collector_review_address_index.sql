-- Scheduled review deduplication compares only pending rows at the same
-- normalized address. Keep that lookup indexed so the repair job does not
-- scan the entire collector_raw table every minute.
CREATE INDEX IF NOT EXISTS idx_collector_raw_review_address
  ON collector_raw(processing_state, json_extract(payload_json, '$.address'), created_at, id);
