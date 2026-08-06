CREATE INDEX IF NOT EXISTS idx_listing_contacts_source
ON listing_contacts(source_id, status);
