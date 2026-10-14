-- Preserve old unresolved payloads for fresh source-ID reconciliation. Never
-- publish a historic advertisement solely because it was queued weeks ago.
-- The next observed source ID is fetched again and published without review.
UPDATE collector_raw SET processing_state='awaiting_source_refresh',
  result_json=json_set(CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END,
    '$.previousProcessingState','review','$.policy','source-advertisement-v1'),
  processed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE processing_state='review';

-- Both compact reads and representative refreshes consult only real user
-- edits, not the much larger stream of collector history records.
CREATE INDEX IF NOT EXISTS idx_listing_history_manual_property
  ON listing_history(listing_id) WHERE action='updateProperty';
