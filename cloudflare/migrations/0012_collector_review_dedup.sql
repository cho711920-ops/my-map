-- Keep only one active review row for a provider listing. A later collection
-- refreshes that row instead of accumulating an identical review snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_collector_raw_active_review
  ON collector_raw(source, source_listing_id)
  WHERE processing_state = 'review';
