-- Manifest comparisons must also find listings that are still waiting in the
-- review queue and therefore do not have a listing_sources row yet.
CREATE INDEX IF NOT EXISTS idx_collector_raw_source_listing_created
  ON collector_raw(source, source_listing_id, created_at DESC);
