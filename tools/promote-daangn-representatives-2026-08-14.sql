WITH ranked_daangn AS (
  SELECT
    s.listing_id,
    s.source_url,
    s.list_snapshot_json,
    ROW_NUMBER() OVER (
      PARTITION BY s.listing_id
      ORDER BY
        CASE WHEN COALESCE(json_extract(s.list_snapshot_json, '$.photoCount'), 0) > 0 THEN 0 ELSE 1 END,
        s.rowid
    ) AS representative_rank
  FROM listing_sources s
  JOIN listings l ON l.id = s.listing_id
  WHERE s.active = 1
    AND s.source = '당근'
    AND l.status <> 'deleted'
    AND l.main_source <> '당근'
), selected_daangn AS (
  SELECT listing_id, source_url, list_snapshot_json
  FROM ranked_daangn
  WHERE representative_rank = 1
)
UPDATE listings
SET
  main_source = '당근',
  title = COALESCE(NULLIF(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.buildingName'), ''), title),
  building_name = COALESCE(NULLIF(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.buildingName'), ''), building_name),
  room = COALESCE(NULLIF(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.room'), ''), room),
  listing_type = COALESCE(NULLIF(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.type'), ''), listing_type),
  deposit = json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.deposit'),
  monthly_rent = json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.rent'),
  maintenance_fee = json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.fee'),
  premium = json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.premium'),
  area_m2 = json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.area'),
  operating_memo = COALESCE(NULLIF(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.memo'), ''), operating_memo),
  source_url = COALESCE(NULLIF((SELECT source_url FROM selected_daangn WHERE listing_id=listings.id), ''), source_url),
  latitude = COALESCE(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.latitude'), latitude),
  longitude = COALESCE(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.longitude'), longitude),
  road_address = COALESCE(NULLIF(json_extract((SELECT list_snapshot_json FROM selected_daangn WHERE listing_id=listings.id), '$.roadAddress'), ''), road_address),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT listing_id FROM selected_daangn);
