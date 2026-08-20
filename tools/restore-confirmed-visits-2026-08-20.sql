-- Restore only active listings that have an exact user-confirmation history
-- but were later overwritten with the collector's pending marker.
WITH candidates AS (
  SELECT l.id, l.status, l.operating_memo,
    CASE
      WHEN trim(replace(replace(l.operating_memo, '(임장가자)', ''), '(공실박스)', '')) = ''
        THEN '(확인매물)'
      ELSE '(확인매물) / ' || trim(replace(replace(l.operating_memo, '(임장가자)', ''), '(공실박스)', ''))
    END AS restored_memo
  FROM listings l
  WHERE l.status <> 'deleted'
    AND l.operating_memo LIKE '%(임장가자)%'
    AND l.operating_memo NOT LIKE '%(확인매물)%'
    AND EXISTS (
      SELECT 1 FROM listing_history h
      WHERE h.listing_id = l.id
        AND h.action IN ('toggleDone', 'updateProperty', 'updatePropertyMemo')
        AND h.after_json LIKE '%(확인매물)%'
    )
)
INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
SELECT id, 'restoreConfirmedVisitMarker', 'codex-system@js-map.com',
  json_object('status', status, 'operating_memo', operating_memo),
  json_object('status', status, 'operating_memo', restored_memo)
FROM candidates;

WITH candidates AS (
  SELECT l.id,
    CASE
      WHEN trim(replace(replace(l.operating_memo, '(임장가자)', ''), '(공실박스)', '')) = ''
        THEN '(확인매물)'
      ELSE '(확인매물) / ' || trim(replace(replace(l.operating_memo, '(임장가자)', ''), '(공실박스)', ''))
    END AS restored_memo
  FROM listings l
  WHERE l.status <> 'deleted'
    AND l.operating_memo LIKE '%(임장가자)%'
    AND l.operating_memo NOT LIKE '%(확인매물)%'
    AND EXISTS (
      SELECT 1 FROM listing_history h
      WHERE h.listing_id = l.id
        AND h.action IN ('toggleDone', 'updateProperty', 'updatePropertyMemo')
        AND h.after_json LIKE '%(확인매물)%'
    )
)
UPDATE listings
SET operating_memo = (SELECT restored_memo FROM candidates WHERE candidates.id = listings.id),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT id FROM candidates);
