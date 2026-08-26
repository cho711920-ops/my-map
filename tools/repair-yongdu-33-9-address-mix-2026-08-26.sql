-- 용두동 33-9 대표매물에 2026-08-13 잘못 연결된 번지 미확인 네이버 원본 복구.
-- 원본은 삭제하지 않는다. 좌표로 번지가 확인된 원본은 정확한 번지의 기존 대표로 이동하거나
-- 별도 대표로 복구하고, 번지를 확정할 수 없는 2건은 매물검증으로 되돌린다.
-- 모든 변경은 원래 대표 ID와 원본 ID를 함께 조건으로 사용해 재실행 시 중복 변경되지 않는다.

CREATE TABLE IF NOT EXISTS repair_yongdu_33_9 (
  source_row_id TEXT PRIMARY KEY,
  source_listing_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_listing_id TEXT NOT NULL DEFAULT '',
  exact_address TEXT NOT NULL DEFAULT ''
);

INSERT OR REPLACE INTO repair_yongdu_33_9 VALUES
  ('O-a07dc5e8-979c-4f3f-9bda-8f03343ba93a','네이버-2641659223','review','',''),
  ('O-c4959ae9-d2d1-4842-9afc-f5bd69e91aee','네이버-2641659982','create','M-repair-nav-2641659982','중구 용두동 111-30'),
  ('O-a2506823-aa2f-4a80-84fc-100a42dbac04','네이버-2641688634','move','M-475491a5-c7a0-4d56-8538-493bf1c0b9d8','중구 용두동 113-10'),
  ('O-657b4455-4ed7-48fe-8d92-eb86dba855ab','네이버-2641810295','keep','M-b421c174-81f1-4359-855e-f8a5628a9f84','중구 용두동 33-9'),
  ('O-1c948a3e-74ae-4933-920c-cba056717bac','네이버-2641842400','create','M-repair-nav-2641842400','중구 용두동 29-11'),
  ('O-0077c156-145e-4f1c-aae7-573496093551','네이버-2641843297','move','M-475491a5-c7a0-4d56-8538-493bf1c0b9d8','중구 용두동 113-10'),
  ('O-3467525d-da94-4030-813d-35ea7935e5ed','네이버-2641863459','create','M-repair-nav-2641863459','중구 용두동 23-9'),
  ('O-a1dfca6e-2da6-4496-818d-fe7d97a25159','네이버-2641980674','create','M-repair-nav-2641980674','중구 용두동 39'),
  ('O-f8a19ab6-f93a-4870-9c84-533a0cf4c1d8','네이버-2641981331','move','M-475491a5-c7a0-4d56-8538-493bf1c0b9d8','중구 용두동 113-10'),
  ('O-7150c2b8-0b96-4bbe-865b-f9e70769ef4e','네이버-2642033949','move','M-bd010d43-5541-4e8a-b1ed-497542946894','중구 용두동 19-4'),
  ('O-2798bf59-c323-4b68-9ae3-06e1da16f39a','네이버-2642129065','move','M-3d85ee1e-2436-4b8a-8858-4de53b7e4083','중구 용두동 34-33'),
  ('O-fd2c1599-9a24-43c4-bfee-3540ddc2cb2d','네이버-2642130344','create','M-repair-nav-2642130344','중구 용두동 39'),
  ('O-4a0c99fa-3192-4524-8795-222e4dfdd34c','네이버-2642133575','create','M-repair-nav-2642133575','중구 용두동 111-30'),
  ('O-caaca976-7b3c-4509-bb4c-11986bb2b3d6','네이버-2642140775','move','M-ea288411-16b2-43d2-ab1d-806918d7a2d4','중구 용두동 119-7'),
  ('O-46061d2f-f1bf-4670-8657-86dfc815f8a7','네이버-2642209069','create','M-repair-nav-2642209069','중구 용두동 33-15'),
  ('O-9bc16650-7f40-4f59-9586-04860facb73a','네이버-2642465903','move','M-878dbe43-cfd5-4c2f-9b32-ce202b03e8e5','중구 용두동 145-3'),
  ('O-a9377977-9c61-4b74-9863-87deb5d6e1b6','네이버-2642506316','create','M-repair-nav-2642506316','중구 용두동 29-10'),
  ('O-9cc26495-6adc-4a3c-bdb2-1b492e9e926b','네이버-2642600950','keep','M-b421c174-81f1-4359-855e-f8a5628a9f84','중구 용두동 33-9'),
  ('O-324883a8-5d43-40ae-8b3a-518eea923107','네이버-2642625289','review','','');

-- 복구 전 연결 상태를 기존 대표매물 이력에 남긴다.
INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json)
SELECT s.listing_id,s.id,'addressMixRepairDetached','codex-address-repair@js-map.com',
  json_object('listingId',s.listing_id,'address',json_extract(s.list_snapshot_json,'$.address')),
  json_object('action',r.action,'targetListingId',r.target_listing_id,'address',r.exact_address,
    'reason','번지 미확인 원본의 잘못된 대표 연결 복구')
FROM listing_sources s JOIN repair_yongdu_33_9 r ON r.source_row_id=s.id
WHERE s.listing_id='M-b421c174-81f1-4359-855e-f8a5628a9f84' AND r.action<>'keep';

-- 정확한 번지는 확인됐지만 기존 대표와 동일 공간임이 확실하지 않은 원본은 각각 별도 대표로 복구한다.
INSERT OR IGNORE INTO listings(
  id,property_id,status,main_source,title,address,road_address,building_name,dong,floor,room,
  deposit,monthly_rent,premium,maintenance_fee,area_m2,latitude,longitude,operating_memo,
  search_tags,condition_key,physical_key,version,first_collected_at,last_collected_at,
  created_at,updated_at,listing_type,landlord_phone,tenant_phone,source_url,contacts_json,
  registration_at,trade_type,sale_category,sale_price
)
SELECT r.target_listing_id,r.target_listing_id,'active',s.source,
  COALESCE(NULLIF(json_extract(s.list_snapshot_json,'$.buildingName'),''),'일반상가'),r.exact_address,'',
  COALESCE(NULLIF(json_extract(s.list_snapshot_json,'$.buildingName'),''),'일반상가'),'용두동','',
  COALESCE(json_extract(s.list_snapshot_json,'$.room'),''),
  json_extract(s.list_snapshot_json,'$.deposit'),json_extract(s.list_snapshot_json,'$.rent'),
  json_extract(s.list_snapshot_json,'$.premium'),json_extract(s.list_snapshot_json,'$.fee'),
  json_extract(s.list_snapshot_json,'$.area'),json_extract(s.list_snapshot_json,'$.latitude'),
  json_extract(s.list_snapshot_json,'$.longitude'),COALESCE(json_extract(s.list_snapshot_json,'$.memo'),''),
  '','','',1,s.first_collected_at,s.last_collected_at,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  COALESCE(NULLIF(json_extract(s.list_snapshot_json,'$.type'),''),'상가점포'),'','',s.source_url,'[]',
  COALESCE(NULLIF(s.first_collected_at,''),strftime('%Y-%m-%dT%H:%M:%fZ','now')),'lease','',NULL
FROM listing_sources s JOIN repair_yongdu_33_9 r ON r.source_row_id=s.id
WHERE s.listing_id='M-b421c174-81f1-4359-855e-f8a5628a9f84' AND r.action='create';

-- 이동·신규복구 대상의 원본 주소와 소속, 사진, 연락처를 함께 옮긴다.
UPDATE listing_media
SET listing_id=(SELECT r.target_listing_id FROM repair_yongdu_33_9 r WHERE r.source_row_id=listing_media.source_id),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action IN ('move','create'));

UPDATE listing_contacts
SET listing_id=(SELECT r.target_listing_id FROM repair_yongdu_33_9 r WHERE r.source_row_id=listing_contacts.source_id),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action IN ('move','create'));

UPDATE listing_sources
SET listing_id=(SELECT r.target_listing_id FROM repair_yongdu_33_9 r WHERE r.source_row_id=listing_sources.id),
    list_snapshot_json=json_set(list_snapshot_json,'$.address',
      (SELECT r.exact_address FROM repair_yongdu_33_9 r WHERE r.source_row_id=listing_sources.id)),
    raw_json=json_set(raw_json,'$.jibunAddress',
      '대전시 ' || (SELECT r.exact_address FROM repair_yongdu_33_9 r WHERE r.source_row_id=listing_sources.id)),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE listing_id='M-b421c174-81f1-4359-855e-f8a5628a9f84'
  AND id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action IN ('move','create'));

-- 같은 좌표·같은 조건으로 33-9가 확인된 과거 원본은 주소만 보정해 그대로 유지한다.
UPDATE listing_sources
SET list_snapshot_json=json_set(list_snapshot_json,'$.address','중구 용두동 33-9'),
    raw_json=json_set(raw_json,'$.jibunAddress','대전시 중구 용두동 33-9'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE listing_id='M-b421c174-81f1-4359-855e-f8a5628a9f84'
  AND id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action='keep');

-- 지번을 확정할 수 없는 원본은 삭제하지 않고 사진·연락처와 함께 대표에서 분리해 검증 대기로 되돌린다.
INSERT OR IGNORE INTO collector_sessions(
  id,source,owner_email,state,totals_json,error_json,started_at,finished_at,updated_at
) VALUES (
  'repair-2026-08-26','네이버','codex-address-repair@js-map.com','completed',
  '{"review":2}','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT OR IGNORE INTO collector_raw(
  id,session_id,source,source_listing_id,snapshot_hash,payload_json,processing_state,
  result_json,error_text,created_at,processed_at,legacy_original_id,trade_type,sale_category,sale_price
)
SELECT 'R-address-repair-' || replace(s.source_listing_id,'네이버-',''),'repair-2026-08-26',s.source,s.source_listing_id,
  'address-repair-' || replace(s.source_listing_id,'네이버-',''),
  json_object('originalId',s.id,'source',s.source,'sourceId',s.source_listing_id,
    'buildingName',COALESCE(json_extract(s.list_snapshot_json,'$.buildingName'),'일반상가'),
    'address',COALESCE(json_extract(s.list_snapshot_json,'$.address'),'중구 용두동'),
    'room',COALESCE(json_extract(s.list_snapshot_json,'$.room'),''),
    'category',COALESCE(json_extract(s.list_snapshot_json,'$.type'),'상가점포'),
    'deposit',json_extract(s.list_snapshot_json,'$.deposit'),'rent',json_extract(s.list_snapshot_json,'$.rent'),
    'fee',json_extract(s.list_snapshot_json,'$.fee'),'premium',json_extract(s.list_snapshot_json,'$.premium'),
    'area',json_extract(s.list_snapshot_json,'$.area'),'memo',COALESCE(json_extract(s.list_snapshot_json,'$.memo'),''),
    'link',s.source_url,'latitude',json_extract(s.list_snapshot_json,'$.latitude'),
    'longitude',json_extract(s.list_snapshot_json,'$.longitude')),
  'review',json_object('candidateIds',json_array(),'reason','정확한 지번 재확인 필요','autoDecision','review',
    'autoDecisionVersion',7),
  '',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'','',COALESCE(s.trade_type,'lease'),COALESCE(s.sale_category,''),s.sale_price
FROM listing_sources s JOIN repair_yongdu_33_9 r ON r.source_row_id=s.id
WHERE s.listing_id='M-b421c174-81f1-4359-855e-f8a5628a9f84' AND r.action='review';

UPDATE listing_media SET listing_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action='review');
UPDATE listing_contacts SET listing_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action='review');
UPDATE listing_sources SET listing_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE listing_id='M-b421c174-81f1-4359-855e-f8a5628a9f84'
  AND id IN (SELECT source_row_id FROM repair_yongdu_33_9 WHERE action='review');

-- 복구된 대표에도 출처와 근거를 이력으로 남긴다.
INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json)
SELECT s.listing_id,s.id,'addressMixRepairAttached','codex-address-repair@js-map.com','{}',
  json_object('sourceListingId',s.source_listing_id,'address',json_extract(s.list_snapshot_json,'$.address'),
    'reason','좌표와 기존 정확지번을 대조해 원본 소속 복구')
FROM listing_sources s JOIN repair_yongdu_33_9 r ON r.source_row_id=s.id
WHERE r.action IN ('move','create') AND s.listing_id=r.target_listing_id;

DROP TABLE repair_yongdu_33_9;
