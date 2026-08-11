ALTER TABLE listings ADD COLUMN building_register_elevators INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN elevator_registry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN elevator_registry_checked_at TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN elevator_registry_status TEXT NOT NULL DEFAULT '';

UPDATE listings
SET building_register_elevators = COALESCE(building_elevators, 0);
