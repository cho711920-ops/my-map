-- New direct-sale registrations preserve optional terms without making unknown income zero.
ALTER TABLE listings ADD COLUMN sale_details_json TEXT NOT NULL DEFAULT '{}';
