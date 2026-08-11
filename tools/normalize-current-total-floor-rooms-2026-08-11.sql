-- Provider room labels such as 1/3 mean current floor / total floors.
-- Preserve the original provider label in listings.floor for audit, while
-- normalizing listings.room to the actual floor used by cards and matching.
UPDATE listings
SET floor = CASE WHEN trim(COALESCE(floor, '')) = '' THEN room ELSE floor END,
    room = CASE
      WHEN CAST(substr(room, 1, instr(room, '/') - 1) AS REAL) < 0
        THEN '지하' || printf('%g', abs(CAST(substr(room, 1, instr(room, '/') - 1) AS REAL))) || '층'
      ELSE printf('%g', CAST(substr(room, 1, instr(room, '/') - 1) AS REAL)) || '층'
    END,
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'active'
  AND room LIKE '%/%'
  AND room NOT LIKE '%호%'
  AND room NOT LIKE '%층%'
  AND instr(substr(room, instr(room, '/') + 1), '/') = 0
  AND substr(room, 1, instr(room, '/') - 1) NOT GLOB '*[^0-9.-]*'
  AND substr(room, instr(room, '/') + 1) NOT GLOB '*[^0-9.]*'
  AND CAST(substr(room, 1, instr(room, '/') - 1) AS REAL) <> 0
  AND CAST(substr(room, instr(room, '/') + 1) AS REAL) > 0;

-- Keep pending verification cards consistent with the active listing cards.
UPDATE collector_raw
SET payload_json = json_set(
      payload_json,
      '$.room',
      CASE
        WHEN CAST(substr(json_extract(payload_json, '$.room'), 1,
          instr(json_extract(payload_json, '$.room'), '/') - 1) AS REAL) < 0
          THEN '지하' || printf('%g', abs(CAST(substr(json_extract(payload_json, '$.room'), 1,
            instr(json_extract(payload_json, '$.room'), '/') - 1) AS REAL))) || '층'
        ELSE printf('%g', CAST(substr(json_extract(payload_json, '$.room'), 1,
          instr(json_extract(payload_json, '$.room'), '/') - 1) AS REAL)) || '층'
      END
    )
WHERE processing_state = 'review'
  AND json_extract(payload_json, '$.room') LIKE '%/%'
  AND json_extract(payload_json, '$.room') NOT LIKE '%호%'
  AND json_extract(payload_json, '$.room') NOT LIKE '%층%'
  AND instr(substr(json_extract(payload_json, '$.room'),
    instr(json_extract(payload_json, '$.room'), '/') + 1), '/') = 0
  AND substr(json_extract(payload_json, '$.room'), 1,
    instr(json_extract(payload_json, '$.room'), '/') - 1) NOT GLOB '*[^0-9.-]*'
  AND substr(json_extract(payload_json, '$.room'),
    instr(json_extract(payload_json, '$.room'), '/') + 1) NOT GLOB '*[^0-9.]*'
  AND CAST(substr(json_extract(payload_json, '$.room'), 1,
    instr(json_extract(payload_json, '$.room'), '/') - 1) AS REAL) <> 0
  AND CAST(substr(json_extract(payload_json, '$.room'),
    instr(json_extract(payload_json, '$.room'), '/') + 1) AS REAL) > 0;
