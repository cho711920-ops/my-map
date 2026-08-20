-- Daangn can return one article with both BUY and MONTH offers even when the
-- map filter is MONTH. Older collection code selected the provider-preferred
-- BUY offer. Repair only active Daangn representatives that are still shown
-- with zero monthly rent; already-correct monthly representatives stay intact.

INSERT INTO listing_history (
  listing_id, source_id, action, actor_email, before_json, after_json
)
SELECT
  l.id,
  s.id,
  'repairDaangnMonthlyTrade',
  'system-daangn-monthly-repair@js-map.com',
  json_object('deposit', l.deposit, 'monthly_rent', l.monthly_rent, 'trade_type', '매매'),
  json_object(
    'deposit', (
      SELECT CAST(json_extract(trade.value, '$.deposit') AS INTEGER)
      FROM json_each(s.raw_json, '$.trades') AS trade
      WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
      LIMIT 1
    ),
    'monthly_rent', (
      SELECT CAST(json_extract(trade.value, '$.monthlyPay') AS INTEGER)
      FROM json_each(s.raw_json, '$.trades') AS trade
      WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
      LIMIT 1
    ),
    'trade_type', '월세'
  )
FROM listings AS l
JOIN listing_sources AS s ON s.listing_id = l.id
WHERE l.status <> 'deleted'
  AND l.main_source = '당근'
  AND COALESCE(l.monthly_rent, 0) = 0
  AND s.source = '당근'
  AND s.active = 1
  AND upper(COALESCE(json_extract(s.raw_json, '$.trades[0].type'), '')) = 'BUY'
  AND EXISTS (
    SELECT 1 FROM json_each(s.raw_json, '$.trades') AS trade
    WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
  );

UPDATE listings
SET
  deposit = (
    SELECT CAST(json_extract(trade.value, '$.deposit') AS INTEGER)
    FROM listing_sources AS source,
      json_each(source.raw_json, '$.trades') AS trade
    WHERE source.listing_id = listings.id
      AND source.source = '당근'
      AND source.active = 1
      AND upper(COALESCE(json_extract(source.raw_json, '$.trades[0].type'), '')) = 'BUY'
      AND upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
    ORDER BY source.updated_at DESC
    LIMIT 1
  ),
  monthly_rent = (
    SELECT CAST(json_extract(trade.value, '$.monthlyPay') AS INTEGER)
    FROM listing_sources AS source,
      json_each(source.raw_json, '$.trades') AS trade
    WHERE source.listing_id = listings.id
      AND source.source = '당근'
      AND source.active = 1
      AND upper(COALESCE(json_extract(source.raw_json, '$.trades[0].type'), '')) = 'BUY'
      AND upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
    ORDER BY source.updated_at DESC
    LIMIT 1
  ),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status <> 'deleted'
  AND main_source = '당근'
  AND COALESCE(monthly_rent, 0) = 0
  AND EXISTS (
    SELECT 1
    FROM listing_sources AS source,
      json_each(source.raw_json, '$.trades') AS trade
    WHERE source.listing_id = listings.id
      AND source.source = '당근'
      AND source.active = 1
      AND upper(COALESCE(json_extract(source.raw_json, '$.trades[0].type'), '')) = 'BUY'
      AND upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
  );

UPDATE listing_sources AS source
SET
  list_snapshot_json = json_set(
    CASE WHEN json_valid(source.list_snapshot_json) THEN source.list_snapshot_json ELSE '{}' END,
    '$.deposit', (
      SELECT CAST(json_extract(trade.value, '$.deposit') AS INTEGER)
      FROM json_each(source.raw_json, '$.trades') AS trade
      WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
      LIMIT 1
    ),
    '$.rent', (
      SELECT CAST(json_extract(trade.value, '$.monthlyPay') AS INTEGER)
      FROM json_each(source.raw_json, '$.trades') AS trade
      WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
      LIMIT 1
    ),
    '$.tradeType', '월세'
  ),
  snapshot_hash = '',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source.source = '당근'
  AND source.active = 1
  AND upper(COALESCE(json_extract(source.raw_json, '$.trades[0].type'), '')) = 'BUY'
  AND EXISTS (
    SELECT 1 FROM json_each(source.raw_json, '$.trades') AS trade
    WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
  );

-- Pending reviews created by the older collector still carry the preferred
-- BUY terms in payload_json. Keep their candidate links, replace only the
-- rental terms, and reset the automatic-decision version so the normal review
-- repair job evaluates them again with the corrected values.
UPDATE collector_raw AS review
SET
  payload_json = json_set(
    CASE WHEN json_valid(review.payload_json) THEN review.payload_json ELSE '{}' END,
    '$.deposit', (
      SELECT CAST(json_extract(trade.value, '$.deposit') AS INTEGER)
      FROM json_each(review.payload_json, '$.raw.trades') AS trade
      WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
      LIMIT 1
    ),
    '$.rent', (
      SELECT CAST(json_extract(trade.value, '$.monthlyPay') AS INTEGER)
      FROM json_each(review.payload_json, '$.raw.trades') AS trade
      WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
      LIMIT 1
    ),
    '$.tradeType', '월세'
  ),
  snapshot_hash = '',
  result_json = json_set(
    CASE WHEN json_valid(review.result_json) THEN review.result_json ELSE '{}' END,
    '$.reason', '당근 복수 거래조건을 월세로 보정 · 재검증 필요',
    '$.autoDecisionVersion', 0
  ),
  error_text = ''
WHERE review.source = '당근'
  AND review.processing_state = 'review'
  AND upper(COALESCE(json_extract(review.payload_json, '$.raw.trades[0].type'), '')) = 'BUY'
  AND EXISTS (
    SELECT 1 FROM json_each(review.payload_json, '$.raw.trades') AS trade
    WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
  );

-- A pending Daangn record with an explicit BUY offer and no MONTH offer is a
-- pure sale. Preserve the collector_raw audit row but remove it from the
-- human review queue so it can never become a monthly-rent listing.
UPDATE collector_raw AS review
SET
  processing_state = 'processed',
  processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  result_json = json_object(
    'action', 'excludeNonMonthlyTrade',
    'reason', '월세 조건이 없는 당근 매매 원본',
    'autoDecisionVersion', 6
  ),
  error_text = ''
WHERE review.source = '당근'
  AND review.processing_state = 'review'
  AND EXISTS (
    SELECT 1 FROM json_each(review.payload_json, '$.raw.trades') AS trade
    WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) = 'BUY'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(review.payload_json, '$.raw.trades') AS trade
    WHERE upper(COALESCE(json_extract(trade.value, '$.type'), '')) LIKE '%MONTH%'
  );
