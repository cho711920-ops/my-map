-- Read only the small set of user edits/separations when rebuilding snapshots.
-- The per-listing chronology is the same as ORDER BY id, without scanning all
-- collection history rows (including their large before/after JSON payloads).
CREATE INDEX IF NOT EXISTS idx_listing_history_manual_display_v57
ON listing_history(listing_id, id)
WHERE action='updateProperty' OR action='separateOriginalListing';
