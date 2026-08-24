-- Foundation for the future lease/sale split.
-- Existing production rows remain commercial leases. Sale collection and UI
-- stay disabled until the later feature phases explicitly write these fields.

ALTER TABLE listings
  ADD COLUMN trade_type TEXT NOT NULL DEFAULT 'lease'
  CHECK (trade_type IN ('lease', 'sale'));
ALTER TABLE listings ADD COLUMN sale_category TEXT NOT NULL DEFAULT '';
ALTER TABLE listings
  ADD COLUMN sale_price INTEGER
  CHECK (sale_price IS NULL OR sale_price >= 0);

ALTER TABLE listing_sources
  ADD COLUMN trade_type TEXT NOT NULL DEFAULT 'lease'
  CHECK (trade_type IN ('lease', 'sale'));
ALTER TABLE listing_sources ADD COLUMN sale_category TEXT NOT NULL DEFAULT '';
ALTER TABLE listing_sources
  ADD COLUMN sale_price INTEGER
  CHECK (sale_price IS NULL OR sale_price >= 0);

ALTER TABLE collector_raw
  ADD COLUMN trade_type TEXT NOT NULL DEFAULT 'lease'
  CHECK (trade_type IN ('lease', 'sale'));
ALTER TABLE collector_raw ADD COLUMN sale_category TEXT NOT NULL DEFAULT '';
ALTER TABLE collector_raw
  ADD COLUMN sale_price INTEGER
  CHECK (sale_price IS NULL OR sale_price >= 0);

CREATE INDEX IF NOT EXISTS idx_listings_trade_status
  ON listings(trade_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_sources_trade_active
  ON listing_sources(trade_type, active, listing_id);
CREATE INDEX IF NOT EXISTS idx_collector_raw_trade_queue
  ON collector_raw(trade_type, processing_state, created_at);
