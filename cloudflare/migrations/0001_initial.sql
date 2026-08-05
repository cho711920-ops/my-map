PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS allowed_users (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  main_source TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  road_address TEXT NOT NULL DEFAULT '',
  building_name TEXT NOT NULL DEFAULT '',
  dong TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  deposit INTEGER,
  monthly_rent INTEGER,
  premium INTEGER,
  maintenance_fee INTEGER,
  area_m2 REAL,
  latitude REAL,
  longitude REAL,
  operating_memo TEXT NOT NULL DEFAULT '',
  search_tags TEXT NOT NULL DEFAULT '',
  condition_key TEXT NOT NULL DEFAULT '',
  physical_key TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  first_collected_at TEXT NOT NULL DEFAULT '',
  last_collected_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_property_id
ON listings(property_id) WHERE property_id <> '';
CREATE INDEX IF NOT EXISTS idx_listings_status_location ON listings(status, latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_listings_address ON listings(address, building_name, room);
CREATE INDEX IF NOT EXISTS idx_listings_updated ON listings(updated_at DESC);

CREATE TABLE IF NOT EXISTS listing_sources (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  source_condition TEXT NOT NULL DEFAULT '',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  list_snapshot_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL DEFAULT '{}',
  session_id TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  missing_count INTEGER NOT NULL DEFAULT 0,
  first_collected_at TEXT NOT NULL DEFAULT '',
  last_collected_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(source, source_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_sources_listing ON listing_sources(listing_id, active);
CREATE INDEX IF NOT EXISTS idx_listing_sources_session ON listing_sources(source, session_id);
CREATE INDEX IF NOT EXISTS idx_listing_sources_snapshot ON listing_sources(source, snapshot_hash);

CREATE TABLE IF NOT EXISTS listing_media (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES listing_sources(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'image',
  sort_order INTEGER NOT NULL DEFAULT 0,
  external_url TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  thumbnail_r2_key TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'external',
  checked_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_listing_media_listing ON listing_media(listing_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_listing_media_source ON listing_media(source_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_media_r2_key ON listing_media(r2_key) WHERE r2_key <> '';

CREATE TABLE IF NOT EXISTS listing_contacts (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES listing_sources(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  normalized_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_listing_contacts_listing ON listing_contacts(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_listing_contacts_phone ON listing_contacts(normalized_phone);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  requirements_json TEXT NOT NULL DEFAULT '{}',
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS customer_matches (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'candidate',
  score REAL,
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(customer_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_matches_listing ON customer_matches(listing_id, state);

CREATE TABLE IF NOT EXISTS listing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES listing_sources(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_listing_history_listing ON listing_history(listing_id, id DESC);

CREATE TABLE IF NOT EXISTS collector_sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'running',
  totals_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_collector_sessions_source ON collector_sessions(source, started_at DESC);

CREATE TABLE IF NOT EXISTS collector_raw (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES collector_sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  processing_state TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processed_at TEXT NOT NULL DEFAULT '',
  UNIQUE(session_id, source, source_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_collector_raw_queue ON collector_raw(processing_state, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  progress_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  leased_until TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(state, priority DESC, available_at);

CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key TEXT PRIMARY KEY,
  address TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  provider TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS building_cache (
  cache_key TEXT PRIMARY KEY,
  parcel_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  details_json TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cloud_state (
  owner_email TEXT NOT NULL COLLATE NOCASE,
  scope TEXT NOT NULL,
  record_key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(owner_email, scope, record_key)
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  starts_at TEXT NOT NULL DEFAULT '',
  ends_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

