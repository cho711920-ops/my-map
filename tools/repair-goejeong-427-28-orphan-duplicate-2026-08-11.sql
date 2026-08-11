INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
SELECT id,
       'repairOrphanDuplicate',
       'codex',
       json_object('status', status, 'address', address, 'room', room,
         'deposit', deposit, 'monthly_rent', monthly_rent, 'area_m2', area_m2,
         'source_url', source_url),
       json_object('status', 'deleted',
         'duplicate_of', 'M-821f87b5-c1c2-4b89-b46c-f18468b16fb9',
         'reason', '같은 당근 원본 URL을 가진 원본 미연결 중복 대표매물')
FROM listings
WHERE id = 'M-9651aef9-21c9-4abe-a631-29a2bc662856'
  AND status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM listing_sources
    WHERE listing_id = 'M-9651aef9-21c9-4abe-a631-29a2bc662856' AND active = 1
  );

UPDATE listings
SET status = 'deleted',
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'M-9651aef9-21c9-4abe-a631-29a2bc662856'
  AND status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM listing_sources
    WHERE listing_id = 'M-9651aef9-21c9-4abe-a631-29a2bc662856' AND active = 1
  );
