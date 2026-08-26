-- One legacy master retained only the dong name even though its sole active
-- Naver source already contains a verified exact parcel address and matching
-- coordinates. This is deliberately separate from the bulk repair so the
-- applied production operation remains auditable and idempotent.
INSERT INTO listing_history(listing_id, source_id, action, actor_email, before_json, after_json)
SELECT l.id, s.id, 'legacyAddressMasterCompleted', 'codex-address-repair@js-map.com',
  json_object('address', l.address),
  json_object('address', '유성구 전민동 337-9', 'reason', 'sole source exact address')
FROM listings l
JOIN listing_sources s ON s.listing_id=l.id AND s.active=1
WHERE l.id='M-273a8ca5-248a-4186-9044-e7e312779ff0'
  AND l.status='active'
  AND l.address='유성구 전민동'
  AND json_extract(s.list_snapshot_json, '$.address')='유성구 전민동 337-9'
  AND (SELECT COUNT(*) FROM listing_sources x WHERE x.listing_id=l.id AND x.active=1)=1;

UPDATE listings
SET address='유성구 전민동 337-9',
    version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-273a8ca5-248a-4186-9044-e7e312779ff0'
  AND status='active'
  AND address='유성구 전민동'
  AND EXISTS (
    SELECT 1 FROM listing_sources s
    WHERE s.listing_id=listings.id AND s.active=1
      AND json_extract(s.list_snapshot_json, '$.address')='유성구 전민동 337-9'
  )
  AND (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id=listings.id AND s.active=1)=1;
