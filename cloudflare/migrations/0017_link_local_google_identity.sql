ALTER TABLE local_accounts ADD COLUMN linked_email TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_accounts_linked_email
ON local_accounts(lower(linked_email))
WHERE linked_email <> '';
