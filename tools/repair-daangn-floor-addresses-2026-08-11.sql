-- Restore exact provider addresses for legacy Daangn rows where descriptive
-- copy such as "봉명동 1층" was once mistaken for the lot address "봉명동 1".

UPDATE listings
SET address = CASE id
      WHEN 'M-c58e6a85-c463-4898-b812-8cda0ae39c08' THEN '유성구 봉명동 469-18'
      WHEN 'M-1a7d531f-39a9-429a-b1ac-27f2a6e65357' THEN '동구 원동 48-1'
      WHEN 'M-75591705-8211-4c5a-9096-6be9fe8db577' THEN '동구 가양동 320-1'
      WHEN 'M-f07a3eb9-70f7-4a24-abef-8bd71552b9aa' THEN '동구 대동 180-7'
      WHEN 'M-a4087aa0-0fa9-4cff-b6e3-53e991d10614' THEN '유성구 학하동 719-6'
      WHEN 'M-381efcd3-6c4a-4170-96a1-2bce57968824' THEN '동구 용전동 130-2'
    END,
    road_address = CASE id
      WHEN 'M-c58e6a85-c463-4898-b812-8cda0ae39c08' THEN '유성구 계룡로59번길 25'
      WHEN 'M-1a7d531f-39a9-429a-b1ac-27f2a6e65357' THEN '동구 대전로 771'
      WHEN 'M-75591705-8211-4c5a-9096-6be9fe8db577' THEN '동구 가양남로13번길 28'
      WHEN 'M-f07a3eb9-70f7-4a24-abef-8bd71552b9aa' THEN '동구 백룡로6번길 160'
      WHEN 'M-a4087aa0-0fa9-4cff-b6e3-53e991d10614' THEN '유성구 학하중앙로128번길 28'
      WHEN 'M-381efcd3-6c4a-4170-96a1-2bce57968824' THEN '동구 동서대로1653번길 96-38'
    END,
    latitude = CASE id
      WHEN 'M-c58e6a85-c463-4898-b812-8cda0ae39c08' THEN 36.35613117
      WHEN 'M-1a7d531f-39a9-429a-b1ac-27f2a6e65357' THEN 36.32854288
      WHEN 'M-75591705-8211-4c5a-9096-6be9fe8db577' THEN 36.3409741305967
      WHEN 'M-f07a3eb9-70f7-4a24-abef-8bd71552b9aa' THEN 36.32967614
      WHEN 'M-a4087aa0-0fa9-4cff-b6e3-53e991d10614' THEN 36.34017903
      WHEN 'M-381efcd3-6c4a-4170-96a1-2bce57968824' THEN 36.35227838
    END,
    longitude = CASE id
      WHEN 'M-c58e6a85-c463-4898-b812-8cda0ae39c08' THEN 127.3378582
      WHEN 'M-1a7d531f-39a9-429a-b1ac-27f2a6e65357' THEN 127.4337604
      WHEN 'M-75591705-8211-4c5a-9096-6be9fe8db577' THEN 127.443852667541
      WHEN 'M-f07a3eb9-70f7-4a24-abef-8bd71552b9aa' THEN 127.4439873
      WHEN 'M-a4087aa0-0fa9-4cff-b6e3-53e991d10614' THEN 127.3055751
      WHEN 'M-381efcd3-6c4a-4170-96a1-2bce57968824' THEN 127.4346295
    END,
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (
  'M-c58e6a85-c463-4898-b812-8cda0ae39c08',
  'M-1a7d531f-39a9-429a-b1ac-27f2a6e65357',
  'M-75591705-8211-4c5a-9096-6be9fe8db577',
  'M-f07a3eb9-70f7-4a24-abef-8bd71552b9aa',
  'M-a4087aa0-0fa9-4cff-b6e3-53e991d10614',
  'M-381efcd3-6c4a-4170-96a1-2bce57968824'
);

UPDATE listing_sources
SET list_snapshot_json = json_set(
      list_snapshot_json,
      '$.address', CASE source_listing_id
        WHEN '4157102' THEN '유성구 봉명동 469-18'
        WHEN '4201235' THEN '동구 원동 48-1'
        WHEN '4201176' THEN '동구 가양동 320-1'
        WHEN '3402928' THEN '동구 대동 180-7'
        WHEN '3678987' THEN '유성구 학하동 719-6'
        WHEN '4180783' THEN '동구 용전동 130-2'
      END,
      '$.latitude', CASE source_listing_id
        WHEN '4157102' THEN 36.35613117
        WHEN '4201235' THEN 36.32854288
        WHEN '4201176' THEN 36.3409741305967
        WHEN '3402928' THEN 36.32967614
        WHEN '3678987' THEN 36.34017903
        WHEN '4180783' THEN 36.35227838
      END,
      '$.longitude', CASE source_listing_id
        WHEN '4157102' THEN 127.3378582
        WHEN '4201235' THEN 127.4337604
        WHEN '4201176' THEN 127.443852667541
        WHEN '3402928' THEN 127.4439873
        WHEN '3678987' THEN 127.3055751
        WHEN '4180783' THEN 127.4346295
      END
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source = '당근'
  AND source_listing_id IN ('4157102','4201235','4201176','3402928','3678987','4180783');

UPDATE collector_raw
SET payload_json = json_set(
      payload_json,
      '$.address', CASE source_listing_id
        WHEN '4157102' THEN '유성구 봉명동 469-18'
        WHEN '4201235' THEN '동구 원동 48-1'
        WHEN '4201176' THEN '동구 가양동 320-1'
        WHEN '3402928' THEN '동구 대동 180-7'
        WHEN '3678987' THEN '유성구 학하동 719-6'
        WHEN '4180783' THEN '동구 용전동 130-2'
      END,
      '$.latitude', CASE source_listing_id
        WHEN '4157102' THEN 36.35613117
        WHEN '4201235' THEN 36.32854288
        WHEN '4201176' THEN 36.3409741305967
        WHEN '3402928' THEN 36.32967614
        WHEN '3678987' THEN 36.34017903
        WHEN '4180783' THEN 36.35227838
      END,
      '$.longitude', CASE source_listing_id
        WHEN '4157102' THEN 127.3378582
        WHEN '4201235' THEN 127.4337604
        WHEN '4201176' THEN 127.443852667541
        WHEN '3402928' THEN 127.4439873
        WHEN '3678987' THEN 127.3055751
        WHEN '4180783' THEN 127.4346295
      END
    ),
    error_text = '',
    processed_at = CASE WHEN processed_at = '' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE processed_at END
WHERE source = '당근'
  AND source_listing_id IN ('4157102','4201235','4201176','3402928','3678987','4180783');
