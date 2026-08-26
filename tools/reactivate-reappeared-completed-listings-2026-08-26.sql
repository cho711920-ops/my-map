-- Restore only the five completed listings whose source had been deactivated
-- after three complete-collection misses and was later observed again.
-- Every mutation is guarded by the exact source row and observed timestamp so
-- an ordinary still-live ad cannot undo a user's completed decision.

INSERT INTO listing_history(listing_id, source_id, action, actor_email, before_json, after_json)
SELECT l.id, s.id, 'sourceReappeared', 'codex-source-reappeared-repair@js-map.com',
  json_object('status', l.status),
  json_object('status', 'active', 'reason', '미노출 원본 재노출 복구', 'observedAt', s.last_collected_at)
FROM listings l JOIN listing_sources s ON s.listing_id=l.id
WHERE l.id='M-0047ce05-19e0-4b18-b501-ec9f2b8881c5'
  AND l.status='계약완료' AND s.id='O-c266654a-4607-4ab9-9f68-fdc006f165a0'
  AND s.active=1 AND s.missing_count=0 AND s.last_collected_at='2026-08-26T02:16:36.240Z'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='toggleDone'
    AND h.created_at < s.last_collected_at)
  AND NOT EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='sourceReappeared');

UPDATE listings SET status='active',
  operating_memo=CASE WHEN instr(operating_memo, '[거래완료 ')>0
    THEN rtrim(rtrim(substr(operating_memo, 1, instr(operating_memo, '[거래완료 ')-1)), ' /')
    ELSE operating_memo END,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-0047ce05-19e0-4b18-b501-ec9f2b8881c5' AND status='계약완료'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=listings.id
    AND h.action='sourceReappeared' AND h.actor_email='codex-source-reappeared-repair@js-map.com');

INSERT INTO listing_history(listing_id, source_id, action, actor_email, before_json, after_json)
SELECT l.id, s.id, 'sourceReappeared', 'codex-source-reappeared-repair@js-map.com',
  json_object('status', l.status),
  json_object('status', 'active', 'reason', '미노출 원본 재노출 복구', 'observedAt', s.last_collected_at)
FROM listings l JOIN listing_sources s ON s.listing_id=l.id
WHERE l.id='M-517e28e5-6c1f-47f5-9a92-b5517c50cf86'
  AND l.status='계약완료' AND s.id='O-fdd88901-84c4-4c53-81ae-47b2c0f554d3'
  AND s.active=1 AND s.missing_count=0 AND s.last_collected_at='2026-08-24T09:35:13.794Z'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='toggleDone'
    AND h.created_at < s.last_collected_at)
  AND NOT EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='sourceReappeared');

UPDATE listings SET status='active',
  operating_memo=CASE WHEN instr(operating_memo, '[거래완료 ')>0
    THEN rtrim(rtrim(substr(operating_memo, 1, instr(operating_memo, '[거래완료 ')-1)), ' /')
    ELSE operating_memo END,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-517e28e5-6c1f-47f5-9a92-b5517c50cf86' AND status='계약완료'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=listings.id
    AND h.action='sourceReappeared' AND h.actor_email='codex-source-reappeared-repair@js-map.com');

INSERT INTO listing_history(listing_id, source_id, action, actor_email, before_json, after_json)
SELECT l.id, s.id, 'sourceReappeared', 'codex-source-reappeared-repair@js-map.com',
  json_object('status', l.status),
  json_object('status', 'active', 'reason', '미노출 원본 재노출 복구', 'observedAt', s.last_collected_at)
FROM listings l JOIN listing_sources s ON s.listing_id=l.id
WHERE l.id='M-a90ff894-27aa-430f-ad6c-d7e375be7739'
  AND l.status='계약완료' AND s.id='O-e8e6668b-34ab-40a6-83b8-099874a7f348'
  AND s.active=1 AND s.missing_count=0 AND s.last_collected_at='2026-08-24T09:18:31.565Z'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='toggleDone'
    AND h.created_at < s.last_collected_at)
  AND NOT EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='sourceReappeared');

UPDATE listings SET status='active',
  operating_memo=CASE WHEN instr(operating_memo, '[거래완료 ')>0
    THEN rtrim(rtrim(substr(operating_memo, 1, instr(operating_memo, '[거래완료 ')-1)), ' /')
    ELSE operating_memo END,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-a90ff894-27aa-430f-ad6c-d7e375be7739' AND status='계약완료'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=listings.id
    AND h.action='sourceReappeared' AND h.actor_email='codex-source-reappeared-repair@js-map.com');

INSERT INTO listing_history(listing_id, source_id, action, actor_email, before_json, after_json)
SELECT l.id, s.id, 'sourceReappeared', 'codex-source-reappeared-repair@js-map.com',
  json_object('status', l.status),
  json_object('status', 'active', 'reason', '미노출 원본 재노출 복구', 'observedAt', s.last_collected_at)
FROM listings l JOIN listing_sources s ON s.listing_id=l.id
WHERE l.id='M-bf849f30-3916-4413-9f87-282ef4cd3e8a'
  AND l.status='계약완료' AND s.id='O-d4d3ea64-bec8-48b1-bb76-09ed5211d0f5'
  AND s.active=1 AND s.missing_count=0 AND s.last_collected_at='2026-08-24T08:57:41.364Z'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='toggleDone'
    AND h.created_at < s.last_collected_at)
  AND NOT EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='sourceReappeared');

UPDATE listings SET status='active',
  operating_memo=CASE WHEN instr(operating_memo, '[거래완료 ')>0
    THEN rtrim(rtrim(substr(operating_memo, 1, instr(operating_memo, '[거래완료 ')-1)), ' /')
    ELSE operating_memo END,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-bf849f30-3916-4413-9f87-282ef4cd3e8a' AND status='계약완료'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=listings.id
    AND h.action='sourceReappeared' AND h.actor_email='codex-source-reappeared-repair@js-map.com');

INSERT INTO listing_history(listing_id, source_id, action, actor_email, before_json, after_json)
SELECT l.id, s.id, 'sourceReappeared', 'codex-source-reappeared-repair@js-map.com',
  json_object('status', l.status),
  json_object('status', 'active', 'reason', '미노출 원본 재노출 복구', 'observedAt', s.last_collected_at)
FROM listings l JOIN listing_sources s ON s.listing_id=l.id
WHERE l.id='M-b0bf60de-5fb6-447c-a95d-cabdca9fa90f'
  AND l.status='계약완료' AND s.id='O-cae9931d-08fd-40ac-9cd9-844bec68c4bd'
  AND s.active=1 AND s.missing_count=0 AND s.last_collected_at='2026-08-19T07:13:24.165Z'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='toggleDone'
    AND h.created_at < s.last_collected_at)
  AND NOT EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=l.id AND h.action='sourceReappeared');

UPDATE listings SET status='active',
  operating_memo=CASE WHEN instr(operating_memo, '[거래완료 ')>0
    THEN rtrim(rtrim(substr(operating_memo, 1, instr(operating_memo, '[거래완료 ')-1)), ' /')
    ELSE operating_memo END,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-b0bf60de-5fb6-447c-a95d-cabdca9fa90f' AND status='계약완료'
  AND EXISTS (SELECT 1 FROM listing_history h WHERE h.listing_id=listings.id
    AND h.action='sourceReappeared' AND h.actor_email='codex-source-reappeared-repair@js-map.com');
