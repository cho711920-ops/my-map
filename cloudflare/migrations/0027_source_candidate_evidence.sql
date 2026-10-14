-- This is a compatibility classification, NOT a confirmation that a provider
-- deleted these advertisements or that the real property was contracted.
CREATE TABLE IF NOT EXISTS listing_source_availability (
  source_id TEXT PRIMARY KEY REFERENCES listing_sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('legacy_candidate','legacy_unverified','census_missing')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_listing_source_availability_kind
  ON listing_source_availability(kind, source_id);

-- Freeze the cutover classification. A later active source disappearing must
-- never promote all of its old, unchecked siblings. Re-running is idempotent.
INSERT OR IGNORE INTO listing_source_availability(source_id,kind,evidence_json)
SELECT s.id,
  CASE WHEN s.listing_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM listings parent WHERE parent.id=s.listing_id)
      AND NOT EXISTS (SELECT 1 FROM listing_sources live WHERE live.listing_id=s.listing_id AND live.active=1)
    THEN 'legacy_candidate' ELSE 'legacy_unverified' END,
  '{"version":1,"reason":"legacy-cutover","providerEndVerified":false}'
FROM listing_sources s WHERE s.active=0;

-- The old dashboard counted all inactive advertisements. Force its first read
-- to use the new evidence-aware/distinct-master policy without changing data.
UPDATE operations_snapshots SET calculated_at='' WHERE snapshot_key='main';
