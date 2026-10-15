-- Today is defined by the advertisement's first local collection, not the
-- merged property's creation date or an advertisement's later reappearance.
CREATE INDEX IF NOT EXISTS idx_listing_sources_registration_day_trade_parent ON listing_sources (
  CASE
    WHEN substr(trim(first_collected_at), -1) IN ('Z','z')
      OR (length(trim(first_collected_at))>=25 AND substr(trim(first_collected_at), -6, 1) IN ('+','-'))
      THEN date(first_collected_at, '+9 hours')
    WHEN substr(trim(first_collected_at), 3, 1) IN ('-','.','/')
      THEN date('20' || replace(replace(substr(trim(first_collected_at), 1, 8), '.', '-'), '/', '-'))
    ELSE date(replace(replace(substr(trim(first_collected_at), 1, 10), '.', '-'), '/', '-')) END,
  trade_type, listing_id
) WHERE active=1;
