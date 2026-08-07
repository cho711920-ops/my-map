-- Recover Gongsilbox photos that were previously stored as relative paths in raw_json.
-- The statements are repeatable: deterministic ids and URL existence checks prevent duplicates.

INSERT OR IGNORE INTO listing_media (
  id, listing_id, source_id, media_type, sort_order, external_url, status,
  checked_at, created_at, updated_at
)
SELECT
  'IMG-GS-' || replace(s.id, 'O-', '') || '-' || printf('%03d', CAST(photo.key AS INTEGER)),
  s.listing_id,
  s.id,
  'image',
  CAST(photo.key AS INTEGER),
  'https://file1.gongsilbox.com/file/land_photo/' || ltrim(json_extract(photo.value, '$.Photo'), '/'),
  'external',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM listing_sources AS s, json_each(s.raw_json, '$.list.Photos') AS photo
WHERE s.source = '공실박스'
  AND json_valid(s.raw_json)
  AND json_type(s.raw_json, '$.list.Photos') = 'array'
  AND trim(COALESCE(json_extract(photo.value, '$.Photo'), '')) <> ''
  AND instr(json_extract(photo.value, '$.Photo'), '..') = 0
  AND instr(json_extract(photo.value, '$.Photo'), char(92)) = 0
  AND (
    lower(json_extract(photo.value, '$.Photo')) LIKE '%.jpg'
    OR lower(json_extract(photo.value, '$.Photo')) LIKE '%.jpeg'
    OR lower(json_extract(photo.value, '$.Photo')) LIKE '%.png'
    OR lower(json_extract(photo.value, '$.Photo')) LIKE '%.webp'
    OR lower(json_extract(photo.value, '$.Photo')) LIKE '%.gif'
    OR lower(json_extract(photo.value, '$.Photo')) LIKE '%.avif'
  )
  AND NOT EXISTS (
    SELECT 1 FROM listing_media AS existing
    WHERE existing.source_id = s.id
      AND existing.external_url = 'https://file1.gongsilbox.com/file/land_photo/' || ltrim(json_extract(photo.value, '$.Photo'), '/')
  );

-- Xbfimg is the list representative image. Use it only when no detail photo exists.
INSERT OR IGNORE INTO listing_media (
  id, listing_id, source_id, media_type, sort_order, external_url, status,
  checked_at, created_at, updated_at
)
SELECT
  'IMG-GSX-' || replace(s.id, 'O-', ''),
  s.listing_id,
  s.id,
  'image',
  0,
  'https://file1.gongsilbox.com/file/land_photo/' || ltrim(json_extract(s.raw_json, '$.list.Xbfimg'), '/'),
  'external',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM listing_sources AS s
WHERE s.source = '공실박스'
  AND json_valid(s.raw_json)
  AND trim(COALESCE(json_extract(s.raw_json, '$.list.Xbfimg'), '')) <> ''
  AND (
    json_type(s.raw_json, '$.list.Photos') IS NULL
    OR json_array_length(json_extract(s.raw_json, '$.list.Photos')) = 0
  )
  AND instr(json_extract(s.raw_json, '$.list.Xbfimg'), '..') = 0
  AND instr(json_extract(s.raw_json, '$.list.Xbfimg'), char(92)) = 0
  AND (
    lower(json_extract(s.raw_json, '$.list.Xbfimg')) LIKE '%.jpg'
    OR lower(json_extract(s.raw_json, '$.list.Xbfimg')) LIKE '%.jpeg'
    OR lower(json_extract(s.raw_json, '$.list.Xbfimg')) LIKE '%.png'
    OR lower(json_extract(s.raw_json, '$.list.Xbfimg')) LIKE '%.webp'
    OR lower(json_extract(s.raw_json, '$.list.Xbfimg')) LIKE '%.gif'
    OR lower(json_extract(s.raw_json, '$.list.Xbfimg')) LIKE '%.avif'
  )
  AND NOT EXISTS (
    SELECT 1 FROM listing_media AS existing WHERE existing.source_id = s.id
  );

UPDATE listing_sources
SET list_snapshot_json = json_set(
      CASE WHEN json_valid(list_snapshot_json) THEN list_snapshot_json ELSE '{}' END,
      '$.thumbnail', 'https://file1.gongsilbox.com/file/land_photo/' || ltrim(json_extract(raw_json, '$.list.Photos[0].Photo'), '/'),
      '$.photoCount', json_array_length(json_extract(raw_json, '$.list.Photos')),
      '$.revision', COALESCE(CAST(json_extract(list_snapshot_json, '$.revision') AS INTEGER), 0) + 1
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source = '공실박스'
  AND json_valid(raw_json)
  AND json_type(raw_json, '$.list.Photos') = 'array'
  AND json_array_length(json_extract(raw_json, '$.list.Photos')) > 0
  AND COALESCE(CAST(json_extract(list_snapshot_json, '$.photoCount') AS INTEGER), 0) = 0;

UPDATE listing_sources
SET list_snapshot_json = json_set(
      CASE WHEN json_valid(list_snapshot_json) THEN list_snapshot_json ELSE '{}' END,
      '$.thumbnail', 'https://file1.gongsilbox.com/file/land_photo/' || ltrim(json_extract(raw_json, '$.list.Xbfimg'), '/'),
      '$.photoCount', 1,
      '$.revision', COALESCE(CAST(json_extract(list_snapshot_json, '$.revision') AS INTEGER), 0) + 1
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source = '공실박스'
  AND json_valid(raw_json)
  AND trim(COALESCE(json_extract(raw_json, '$.list.Xbfimg'), '')) <> ''
  AND (
    json_type(raw_json, '$.list.Photos') IS NULL
    OR json_array_length(json_extract(raw_json, '$.list.Photos')) = 0
  )
  AND COALESCE(CAST(json_extract(list_snapshot_json, '$.photoCount') AS INTEGER), 0) = 0;
