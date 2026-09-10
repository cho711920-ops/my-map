-- READ ONLY.  This file intentionally contains SELECT statements only.
-- It audits active lease masters whose stored monthly rent is zero.  Raw
-- provider copy, contact values, memos, and customer data are never returned.

WITH zero_lease AS (
  SELECT l.*
  FROM listings AS l
  WHERE l.status <> 'deleted'
    AND l.trade_type = 'lease'
    AND COALESCE(l.monthly_rent, 0) = 0
), evidence AS (
  SELECT
    l.id,
    l.main_source,
    (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id = l.id) AS source_count,
    (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id = l.id AND s.active = 1) AS active_source_count,
    EXISTS (
      SELECT 1
      FROM listing_sources s,
        json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근'
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%BUY%'
    ) AS has_daangn_buy,
    EXISTS (
      SELECT 1
      FROM listing_sources s,
        json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근'
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%MONTH%'
    ) AS has_daangn_month,
    EXISTS (
      SELECT 1 FROM listing_sources s
      WHERE s.listing_id = l.id
        AND json_valid(s.list_snapshot_json)
        AND lower(CAST(json_extract(s.list_snapshot_json, '$.preserveRepresentative') AS TEXT)) IN ('1', 'true')
    ) AS preserve_representative
  FROM zero_lease l
), classified AS (
  SELECT *, CASE
    WHEN source_count = 0 THEN 'orphan_without_source'
    WHEN main_source = '당근' AND has_daangn_buy = 1 AND has_daangn_month = 1 THEN 'daangn_buy_and_month'
    WHEN main_source = '당근' AND has_daangn_buy = 1 AND has_daangn_month = 0 THEN 'daangn_buy_only'
    WHEN main_source = '공실박스' THEN 'gongsil_legacy_zero_rent'
    ELSE 'zero_rent_needs_review'
  END AS classification
  FROM evidence
)
SELECT
  classification,
  main_source,
  preserve_representative,
  CASE WHEN active_source_count > 0 THEN 1 ELSE 0 END AS has_active_source,
  COUNT(*) AS listing_count
FROM classified
GROUP BY classification, main_source, preserve_representative,
  CASE WHEN active_source_count > 0 THEN 1 ELSE 0 END
ORDER BY classification, main_source, preserve_representative, has_active_source;

-- Candidate-level preflight.  `sale_collision_count`, `manual_history_count`,
-- or `preserve_representative` greater than zero means automatic repair must
-- not run for that master.
WITH zero_lease AS (
  SELECT l.*
  FROM listings l
  WHERE l.status <> 'deleted'
    AND l.trade_type = 'lease'
    AND COALESCE(l.monthly_rent, 0) = 0
), candidate AS (
  SELECT
    l.id,
    l.property_id,
    l.main_source,
    l.status,
    l.deposit,
    l.monthly_rent,
    l.version,
    l.updated_at,
    l.address,
    l.building_name,
    l.room,
    l.physical_key,
    (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id = l.id) AS source_count,
    (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id = l.id AND s.active = 1) AS active_source_count,
    (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id = l.id AND s.active = 1 AND s.source <> '당근') AS active_non_daangn_count,
    EXISTS (
      SELECT 1 FROM listing_sources s
      WHERE s.listing_id = l.id AND json_valid(s.list_snapshot_json)
        AND lower(CAST(json_extract(s.list_snapshot_json, '$.preserveRepresentative') AS TEXT)) IN ('1', 'true')
    ) AS preserve_representative,
    EXISTS (
      SELECT 1 FROM listing_sources s,
        json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근'
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%BUY%'
    ) AS has_daangn_buy,
    EXISTS (
      SELECT 1 FROM listing_sources s,
        json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근'
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%MONTH%'
    ) AS has_daangn_month,
    (SELECT CAST(json_extract(trade.value, '$.price') AS INTEGER)
       FROM listing_sources s,
         json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근'
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%BUY%'
      ORDER BY s.active DESC, s.updated_at DESC LIMIT 1) AS evidenced_sale_price,
    (SELECT CAST(json_extract(trade.value, '$.deposit') AS INTEGER)
       FROM listing_sources s,
         json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근' AND s.active = 1
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%MONTH%'
      ORDER BY s.updated_at DESC LIMIT 1) AS evidenced_deposit,
    (SELECT CAST(COALESCE(json_extract(trade.value, '$.monthlyPay'), json_extract(trade.value, '$.yearlyPay')) AS INTEGER)
       FROM listing_sources s,
         json_each(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.trades') trade
      WHERE s.listing_id = l.id AND s.source = '당근' AND s.active = 1
        AND upper(COALESCE(json_extract(trade.value, '$.type'), json_extract(trade.value, '$.__typename'), '')) LIKE '%MONTH%'
      ORDER BY s.updated_at DESC LIMIT 1) AS evidenced_monthly_rent,
    (SELECT COUNT(*) FROM customer_matches cm WHERE cm.listing_id = l.id) AS customer_match_count,
    (SELECT COUNT(*) FROM cloud_state cs WHERE instr(cs.value_json, l.id) > 0) AS cloud_reference_count,
    (SELECT COUNT(*) FROM listing_history h WHERE h.listing_id = l.id) AS history_count,
    (SELECT COUNT(*) FROM listing_history h
      WHERE h.listing_id = l.id
        AND h.action IN ('updateProperty', 'updatePropertyMemo', 'toggleDone', 'deleteProperty',
          'restoreListingHistory', 'quickAdd', 'moveOriginalListing')) AS manual_history_count
  FROM zero_lease l
)
SELECT
  c.id,
  c.property_id,
  c.main_source,
  c.status,
  c.deposit,
  c.monthly_rent,
  c.version,
  c.updated_at,
  c.source_count,
  c.active_source_count,
  c.active_non_daangn_count,
  c.preserve_representative,
  c.has_daangn_buy,
  c.has_daangn_month,
  c.evidenced_sale_price,
  c.evidenced_deposit,
  c.evidenced_monthly_rent,
  c.customer_match_count,
  c.cloud_reference_count,
  c.history_count,
  c.manual_history_count,
  (SELECT COUNT(*) FROM listings sale
    WHERE sale.id <> c.id AND sale.status <> 'deleted' AND sale.trade_type = 'sale'
      AND (
        (c.physical_key <> '' AND sale.physical_key = c.physical_key)
        OR (c.address <> '' AND sale.address = c.address
          AND COALESCE(sale.room, '') = COALESCE(c.room, '')
          AND (c.building_name = '' OR sale.building_name = '' OR sale.building_name = c.building_name))
      )) AS sale_collision_count
FROM candidate c
ORDER BY c.main_source, c.id;

-- Structured, non-PII evidence for the legacy Gongsil zero-rent group.  The
-- admin repair tool interprets these fields through the production parser;
-- this result is for a human preflight only.
SELECT
  l.id,
  l.property_id,
  s.id AS source_id,
  s.source_listing_id,
  s.active,
  s.trade_type AS source_trade_type,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.TypeView') AS type_view,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Subtype') AS subtype,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Me') AS sale_price,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Bo') AS deposit,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Mm') AS monthly_rent,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Jun') AS jeonse_deposit,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Jmm') AS semi_jeonse_rent,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Bjbo') AS half_jeonse_deposit,
  json_extract(CASE WHEN json_valid(s.raw_json) THEN s.raw_json ELSE '{}' END, '$.list.Bjmm') AS half_jeonse_rent
FROM listings l
LEFT JOIN listing_sources s ON s.listing_id = l.id AND s.source = '공실박스'
WHERE l.status <> 'deleted'
  AND l.trade_type = 'lease'
  AND COALESCE(l.monthly_rent, 0) = 0
  AND l.main_source = '공실박스'
ORDER BY l.id, s.updated_at DESC;

-- Preservation invariant counts.  The repair plan must never delete or move
-- any of these relations; it only corrects fields on the same master ID.
SELECT
  COUNT(*) AS zero_rent_lease_masters,
  (SELECT COUNT(*) FROM customer_matches cm
    JOIN listings l ON l.id = cm.listing_id
    WHERE l.status <> 'deleted' AND l.trade_type = 'lease' AND COALESCE(l.monthly_rent, 0) = 0) AS customer_matches,
  (SELECT COUNT(*) FROM listing_contacts lc
    JOIN listings l ON l.id = lc.listing_id
    WHERE l.status <> 'deleted' AND l.trade_type = 'lease' AND COALESCE(l.monthly_rent, 0) = 0) AS contacts,
  (SELECT COUNT(*) FROM listing_media lm
    JOIN listings l ON l.id = lm.listing_id
    WHERE l.status <> 'deleted' AND l.trade_type = 'lease' AND COALESCE(l.monthly_rent, 0) = 0) AS media,
  (SELECT COUNT(*) FROM listing_history h
    JOIN listings l ON l.id = h.listing_id
    WHERE l.status <> 'deleted' AND l.trade_type = 'lease' AND COALESCE(l.monthly_rent, 0) = 0) AS history_rows
FROM listings
WHERE status <> 'deleted' AND trade_type = 'lease' AND COALESCE(monthly_rent, 0) = 0;
