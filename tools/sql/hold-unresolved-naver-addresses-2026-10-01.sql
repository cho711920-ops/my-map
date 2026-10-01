-- User-approved publication hold for exactly two unlocatable Naver sale ads.
-- No listing/source/favorite values are changed or deleted. Run once as one batch.
-- Restore publication only after separately verifying and correcting the address,
-- then resolving these address_lookup_unresolved holds with an audit entry.
CREATE TABLE _address_hold_guard_20261001 (ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO _address_hold_guard_20261001
SELECT CASE WHEN COUNT(*) = 2 THEN 1 ELSE 0 END
FROM listings l JOIN listing_sources s ON s.listing_id = l.id
WHERE l.status = 'active' AND l.trade_type = 'sale' AND l.version = 1
  AND l.latitude IS NULL AND l.longitude IS NULL
  AND s.source = '네이버' AND s.active = 1
  AND json_extract(s.list_snapshot_json, '$.address') = l.address
  AND json_extract(s.list_snapshot_json, '$.latitude') IS NULL
  AND json_extract(s.list_snapshot_json, '$.longitude') IS NULL
  AND COALESCE(json_extract(s.raw_json, '$.latitude'), '') = ''
  AND COALESCE(json_extract(s.raw_json, '$.longitude'), '') = ''
  AND (
    (l.id = 'M-dc75b2e0-c663-495c-bb4e-293c3a53d099' AND l.address = '서구 탄방동 859-1'
      AND l.room = '지하1층' AND l.updated_at = '2026-09-30T09:12:46.096Z'
      AND s.id = 'O-02b0a8f5-5372-48a9-ad6f-18e38b01ac28'
      AND s.source_listing_id = '네이버-2652436190::sale'
      AND s.updated_at = '2026-09-30T09:12:46.096Z'
      AND json_extract(s.raw_json, '$.jibunAddress') = '대전시 서구 탄방동 859-1')
    OR
    (l.id = 'M-b2c9b156-4dd0-48a4-857f-68f22cc82fb5' AND l.address = '서구 내동 17-5'
      AND l.room = '3층' AND l.updated_at = '2026-09-30T09:17:35.128Z'
      AND s.id = 'O-2ed2b4e4-5861-4f0d-ad1b-ebdf24b8d688'
      AND s.source_listing_id = '네이버-2647850512::sale'
      AND s.updated_at = '2026-09-30T09:17:35.128Z'
      AND json_extract(s.raw_json, '$.jibunAddress') = '대전시 서구 내동 17-5')
  );

INSERT INTO _address_hold_guard_20261001
SELECT CASE WHEN COUNT(*) = 2 THEN 1 ELSE 0 END FROM listing_sources
WHERE listing_id IN ('M-dc75b2e0-c663-495c-bb4e-293c3a53d099', 'M-b2c9b156-4dd0-48a4-857f-68f22cc82fb5');

INSERT INTO _address_hold_guard_20261001
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM listing_data_quality_holds
WHERE listing_id IN ('M-dc75b2e0-c663-495c-bb4e-293c3a53d099', 'M-b2c9b156-4dd0-48a4-857f-68f22cc82fb5');

INSERT INTO listing_data_quality_holds
  (listing_id, issue_code, source_id, state, blocks_publication, evidence_json, detected_by)
SELECT l.id, 'address_lookup_unresolved', s.id, 'open', 1,
  json_object('reason', '원본 지번의 주소·장소 검색 결과 없음, 저장 좌표 없음. 사용자 요청으로 주소 확인 전 공개 보류.',
    'address', l.address, 'sourceIds', json_array(s.id), 'selectedSourceId', s.id,
    'sourceCount', 1, 'activeSourceCount', 1, 'coordinateMissing', json('true'),
    'geocodeProvider', 'kakao', 'geocodeStatus', 'ZERO_RESULT', 'userRequestedHold', json('true')),
  'codex:user-request:address-hold-2026-10-01'
FROM listings l JOIN listing_sources s ON s.listing_id = l.id
WHERE s.id IN ('O-02b0a8f5-5372-48a9-ad6f-18e38b01ac28', 'O-2ed2b4e4-5861-4f0d-ad1b-ebdf24b8d688');

INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
SELECT listing_id, source_id, 'dataQualityHoldOpened', detected_by,
  json_object('publicationHold', json('null')),
  json_object('issueCode', issue_code, 'decision', 'hold', 'blocksPublication', json('true'),
    'reason', '주소 검색 불가 · 원본 주소 확인 보류', 'fieldsChanged', json('false'))
FROM listing_data_quality_holds
WHERE issue_code = 'address_lookup_unresolved' AND detected_by = 'codex:user-request:address-hold-2026-10-01'
  AND listing_id IN ('M-dc75b2e0-c663-495c-bb4e-293c3a53d099', 'M-b2c9b156-4dd0-48a4-857f-68f22cc82fb5');

DROP TABLE _address_hold_guard_20261001;
