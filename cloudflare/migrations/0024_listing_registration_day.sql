-- A small Today read must not scan every listing on each page. Offset-free
-- legacy/manual calendar dates are Korean dates, unlike UTC collector dates.
CREATE INDEX IF NOT EXISTS idx_listings_registration_day_market_id ON listings (
  CASE
    WHEN substr(trim(first_collected_at), -1) IN ('Z','z')
      OR (length(trim(first_collected_at))>=25 AND substr(trim(first_collected_at), -6, 1) IN ('+','-'))
      THEN date(first_collected_at, '+9 hours')
    WHEN substr(trim(first_collected_at), 3, 1) IN ('-','.','/')
      THEN date('20' || replace(replace(substr(trim(first_collected_at), 1, 8), '.', '-'), '/', '-'))
    ELSE date(replace(replace(substr(trim(first_collected_at), 1, 10), '.', '-'), '/', '-')) END,
  trade_type, id
) WHERE status<>'deleted';
