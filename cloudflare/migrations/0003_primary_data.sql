ALTER TABLE listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN landlord_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN tenant_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN contacts_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN registration_at TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN building_year TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN building_elevators INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN building_approval_date TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN building_info_checked_at TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN building_info_status TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS customer_activities (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  next_contact_date TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_activities_customer
  ON customer_activities(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mutation_results (
  request_id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'completed',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_mutation_results_expires
  ON mutation_results(expires_at);
