-- Preserve Gongsilbox's original role label for building-level contacts on collective buildings.
-- These contacts were intentionally excluded by the old collector; unit-level primary contacts remain unchanged.

INSERT OR IGNORE INTO listing_contacts (
  id, listing_id, source_id, role, name, phone, normalized_phone, status,
  first_seen_at, last_seen_at, created_at, updated_at
)
SELECT
  'C-GSB-' || replace(s.id, 'O-', '') || '-' || printf('%02d', CAST(contact.key AS INTEGER)),
  s.listing_id,
  s.id,
  COALESCE(
    NULLIF(trim(json_extract(contact.value, '$.Type2')), ''),
    NULLIF(trim(json_extract(contact.value, '$.Type')), ''),
    '기타'
  ),
  '',
  trim(json_extract(contact.value, '$.Tel')),
  replace(replace(replace(replace(replace(trim(json_extract(contact.value, '$.Tel')), '-', ''), ' ', ''), '(', ''), ')', ''), '.', ''),
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM listing_sources AS s, json_each(s.raw_json, '$.detail.bilinfo.tels') AS contact
WHERE s.source = '공실박스'
  AND json_valid(s.raw_json)
  AND COALESCE(CAST(json_extract(s.raw_json, '$.list.Ckhus') AS INTEGER), 0) = 1
  AND trim(COALESCE(json_extract(contact.value, '$.Tel'), '')) <> ''
  AND length(replace(replace(replace(replace(replace(trim(json_extract(contact.value, '$.Tel')), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '')) BETWEEN 9 AND 11
  AND replace(replace(replace(replace(replace(trim(json_extract(contact.value, '$.Tel')), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') GLOB '[0-9]*'
  AND NOT EXISTS (
    SELECT 1 FROM listing_contacts AS existing
    WHERE existing.source_id = s.id
      AND existing.status <> 'deleted'
      AND existing.normalized_phone = replace(replace(replace(replace(replace(trim(json_extract(contact.value, '$.Tel')), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '')
  );

UPDATE listing_sources
SET list_snapshot_json = json_set(
      CASE WHEN json_valid(list_snapshot_json) THEN list_snapshot_json ELSE '{}' END,
      '$.contactCount', (
        SELECT COUNT(*) FROM listing_contacts AS contact
        WHERE contact.source_id = listing_sources.id AND contact.status <> 'deleted'
      ),
      '$.revision', COALESCE(CAST(json_extract(list_snapshot_json, '$.revision') AS INTEGER), 0) + 1
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source = '공실박스'
  AND id IN (SELECT DISTINCT source_id FROM listing_contacts WHERE id LIKE 'C-GSB-%');
