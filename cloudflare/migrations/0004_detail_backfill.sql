ALTER TABLE listings ADD COLUMN detail_backfill_status TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN detail_backfilled_at TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN detail_backfill_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN detail_backfill_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_listings_detail_backfill
  ON listings(detail_backfill_status, detail_backfill_attempts, detail_backfilled_at);
