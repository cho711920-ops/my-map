UPDATE listings
SET address='동구 자양동 106-19', road_address='동구 백룡로 36-1',
  latitude=36.3307884, longitude=127.4610242,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-dbaf1918-8b06-4c70-9a6b-8efa3abcc8e4';

UPDATE listings
SET address='유성구 봉명동 1030-4', road_address='유성구 봉명서로 61-3',
  latitude=36.3578080, longitude=127.3272713,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-247e6ed0-ddb3-4ec6-8a08-7c74de3501e7';

UPDATE listings
SET address='중구 용두동 145-3', road_address='중구 어덕마을로10번길 11-18',
  latitude=36.3329473, longitude=127.3926041,
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='M-d8bcf8b0-bbb1-4756-abd3-9c201479cff8';

UPDATE listing_sources
SET list_snapshot_json=json_set(list_snapshot_json,
    '$.address','동구 자양동 106-19','$.latitude',36.3307884,'$.longitude',127.4610242),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='당근' AND source_listing_id='3642518';

UPDATE listing_sources
SET list_snapshot_json=json_set(list_snapshot_json,
    '$.address','유성구 봉명동 1030-4','$.latitude',36.3578080,'$.longitude',127.3272713),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='당근' AND source_listing_id='3851563';

UPDATE listing_sources
SET list_snapshot_json=json_set(list_snapshot_json,
    '$.address','중구 용두동 145-3','$.latitude',36.3329473,'$.longitude',127.3926041),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='당근' AND source_listing_id='3992550';

UPDATE collector_raw
SET processing_state='processed',
  result_json=json_object('listingId','M-dbaf1918-8b06-4c70-9a6b-8efa3abcc8e4',
    'decision','source-identity-repaired','reason','structured provider address restored'),
  processed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error_text=''
WHERE source='당근' AND source_listing_id='3642518' AND processing_state='review';

UPDATE collector_raw
SET processing_state='processed',
  result_json=json_object('listingId','M-247e6ed0-ddb3-4ec6-8a08-7c74de3501e7',
    'decision','source-identity-repaired','reason','structured provider address restored'),
  processed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error_text=''
WHERE source='당근' AND source_listing_id='3851563' AND processing_state='review';

UPDATE collector_raw
SET processing_state='processed',
  result_json=json_object('listingId','M-d8bcf8b0-bbb1-4756-abd3-9c201479cff8',
    'decision','source-identity-repaired','reason','structured provider address restored'),
  processed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error_text=''
WHERE source='당근' AND source_listing_id='3992550' AND processing_state='review';

INSERT INTO geocode_cache(cache_key,address,latitude,longitude,provider,payload_json,checked_at)
VALUES
  ('동구 자양동 106-19','동구 자양동 106-19',36.3307884,127.4610242,'daangn','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('유성구 봉명동 1030-4','유성구 봉명동 1030-4',36.3578080,127.3272713,'daangn','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('중구 용두동 145-3','중구 용두동 145-3',36.3329473,127.3926041,'daangn','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(cache_key) DO UPDATE SET address=excluded.address,
  latitude=excluded.latitude, longitude=excluded.longitude,
  provider=excluded.provider, checked_at=excluded.checked_at;
