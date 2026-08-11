-- 탄방동 81-25에서 원본 1개만 이동되어 남은 대표카드를 전체 통합합니다.
-- 유지: 비송시티빌 101호 / 제거: 일반상가(호실 공란)

INSERT OR IGNORE INTO customer_matches (
  customer_id, listing_id, state, score, memo, created_at, updated_at, contacted_at
)
SELECT customer_id, 'M-96711e1a-d481-4f73-b91d-fccfd5f0463c', state, score, memo,
       created_at, updated_at, contacted_at
FROM customer_matches
WHERE listing_id='M-289ff55f-51d0-4c09-8e39-365bce5b4b66';

DELETE FROM customer_matches
WHERE listing_id='M-289ff55f-51d0-4c09-8e39-365bce5b4b66';

UPDATE listing_sources
SET listing_id='M-96711e1a-d481-4f73-b91d-fccfd5f0463c',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE listing_id='M-289ff55f-51d0-4c09-8e39-365bce5b4b66';

UPDATE listing_media
SET listing_id='M-96711e1a-d481-4f73-b91d-fccfd5f0463c',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE listing_id='M-289ff55f-51d0-4c09-8e39-365bce5b4b66';

UPDATE listing_contacts
SET listing_id='M-96711e1a-d481-4f73-b91d-fccfd5f0463c',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE listing_id='M-289ff55f-51d0-4c09-8e39-365bce5b4b66';

UPDATE listings
SET status='deleted', version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id='M-289ff55f-51d0-4c09-8e39-365bce5b4b66'
  AND status<>'deleted';

UPDATE listings
SET version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id='M-96711e1a-d481-4f73-b91d-fccfd5f0463c';

INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
VALUES (
  'M-96711e1a-d481-4f73-b91d-fccfd5f0463c',
  'consolidateExistingMasters',
  'codex-repair@js-map.com',
  json_object('duplicateId', 'M-289ff55f-51d0-4c09-8e39-365bce5b4b66'),
  json_object('primaryId', 'M-96711e1a-d481-4f73-b91d-fccfd5f0463c', 'reason', 'complete partially moved master')
);

UPDATE operations_snapshots
SET payload_json=json_set(
      payload_json,
      '$.activeMaster', MAX(0, COALESCE(json_extract(payload_json, '$.activeMaster'), 0) - 1),
      '$.master', MAX(0, COALESCE(json_extract(payload_json, '$.master'), 0) - 1),
      '$.history', COALESCE(json_extract(payload_json, '$.history'), 0) + 1
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE snapshot_key='main';
