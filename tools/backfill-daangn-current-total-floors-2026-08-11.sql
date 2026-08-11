-- Normalize Daangn floor labels to "current floor / total building floors".
-- A small mapping table keeps this replayable without repeating the ranked
-- source scan for every updated listing. Explicit room numbers and whole-
-- building labels are intentionally preserved.

CREATE TABLE IF NOT EXISTS _floor_backfill_20260811 (
  listing_id TEXT PRIMARY KEY,
  normalized_room TEXT NOT NULL
);

DELETE FROM _floor_backfill_20260811;

INSERT INTO _floor_backfill_20260811(listing_id,normalized_room)
WITH ranked AS (
  SELECT listing_id, raw_json,
    ROW_NUMBER() OVER (
      PARTITION BY listing_id
      ORDER BY active DESC, last_collected_at DESC, updated_at DESC
    ) AS row_number
  FROM listing_sources
  WHERE source='당근'
)
SELECT l.id,
  printf('%d/%d',
    CAST(json_extract(r.raw_json,'$.floor') AS INTEGER),
    CAST(json_extract(r.raw_json,'$.topFloor') AS INTEGER)
  )
FROM listings l
JOIN ranked r ON r.listing_id=l.id AND r.row_number=1
WHERE l.status!='deleted'
  AND l.main_source='당근'
  AND COALESCE(json_extract(r.raw_json,'$.isEntireBuilding'),0)!=1
  AND json_extract(r.raw_json,'$.floor') IS NOT NULL
  AND json_extract(r.raw_json,'$.topFloor') IS NOT NULL
  AND CAST(json_extract(r.raw_json,'$.floor') AS REAL)!=0
  AND CAST(json_extract(r.raw_json,'$.topFloor') AS INTEGER)>0
  AND l.room NOT LIKE '%/%'
  AND (
    l.room=''
    OR l.room LIKE '지하%층'
    OR l.room IN (
      trim(json_extract(r.raw_json,'$.floor'))||'층',
      printf('%d층',CAST(json_extract(r.raw_json,'$.floor') AS INTEGER)),
      trim(json_extract(r.raw_json,'$.floor'))
    )
  );

UPDATE listings
SET room=(SELECT normalized_room FROM _floor_backfill_20260811 b WHERE b.listing_id=listings.id),
  version=version+1,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT listing_id FROM _floor_backfill_20260811);

UPDATE listing_sources
SET list_snapshot_json=json_set(
    list_snapshot_json,
    '$.room',(SELECT normalized_room FROM _floor_backfill_20260811 b
      WHERE b.listing_id=listing_sources.listing_id)
  ),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='당근'
  AND listing_id IN (SELECT listing_id FROM _floor_backfill_20260811);

UPDATE collector_raw
SET payload_json=json_set(
    payload_json,
    '$.room',printf('%d/%d',
      CAST(json_extract(payload_json,'$.raw.floor') AS INTEGER),
      CAST(json_extract(payload_json,'$.raw.topFloor') AS INTEGER)
    )
  )
WHERE source='당근'
  AND processing_state IN ('pending','review')
  AND COALESCE(json_extract(payload_json,'$.raw.isEntireBuilding'),0)!=1
  AND json_extract(payload_json,'$.raw.floor') IS NOT NULL
  AND json_extract(payload_json,'$.raw.topFloor') IS NOT NULL
  AND CAST(json_extract(payload_json,'$.raw.floor') AS REAL)!=0
  AND CAST(json_extract(payload_json,'$.raw.topFloor') AS INTEGER)>0;

DROP TABLE _floor_backfill_20260811;
