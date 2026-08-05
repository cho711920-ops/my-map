import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function sql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tsvRows(text) {
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.split("\t"));
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function writeParts(directory, prefix, statements, maxBytes = 700_000) {
  const parts = [];
  let current = ["PRAGMA foreign_keys = ON;"];
  let bytes = Buffer.byteLength(current[0]);
  for (const statement of statements) {
    const size = Buffer.byteLength(statement) + 2;
    if (current.length > 1 && bytes + size > maxBytes) {
      parts.push(`${current.join("\n\n")}\n`);
      current = ["PRAGMA foreign_keys = ON;"];
      bytes = Buffer.byteLength(current[0]);
    }
    current.push(statement);
    bytes += size;
  }
  if (current.length > 1) parts.push(`${current.join("\n\n")}\n`);
  const paths = [];
  for (let index = 0; index < parts.length; index += 1) {
    const path = resolve(directory, `${prefix}-${String(index + 1).padStart(3, "0")}.sql`);
    await writeFile(path, parts[index], "utf8");
    paths.push(path);
  }
  return paths;
}

function mediaRows(text) {
  return tsvRows(text).slice(1).map((row) => {
    const originalId = clean(row[0]);
    if (!originalId) return null;
    const images = parseJson(row[4], []);
    const cleanImages = (Array.isArray(images) ? images : []).map(clean)
      .filter((url, index, all) => /^https:\/\//i.test(url) && all.indexOf(url) === index);
    const thumbnail = clean(row[3]);
    if (thumbnail && !cleanImages.includes(thumbnail)) cleanImages.unshift(thumbnail);
    return {
      originalId,
      source: clean(row[1]),
      sourceListingId: clean(row[2]),
      thumbnail,
      imagesJson: JSON.stringify(cleanImages),
      photoCount: Math.max(cleanImages.length, Number(row[5]) || 0),
      checkedAt: clean(row[6])
    };
  }).filter(Boolean);
}

function contactRows(text) {
  return tsvRows(text).slice(1).map((row) => {
    const id = clean(row[0]);
    const phone = clean(row[7]);
    if (!id || !phone) return null;
    return {
      id,
      source: clean(row[1]),
      sourceListingId: clean(row[2]),
      address: clean(row[3]),
      buildingName: clean(row[4]),
      room: clean(row[5]),
      role: clean(row[6]),
      phone,
      normalizedPhone: phone.replace(/\D/g, ""),
      firstSeen: clean(row[8]),
      lastSeen: clean(row[9]),
      status: clean(row[10]).toUpperCase() === "Y" ? "active" : "inactive"
    };
  }).filter(Boolean);
}

function customerRows(text) {
  return tsvRows(text).slice(1).map((row) => {
    const id = clean(row[22]);
    const name = clean(row[0]);
    if (!id || !name) return null;
    const requirements = {
      regions: clean(row[3]),
      types: clean(row[4]),
      depositMin: clean(row[5]),
      depositMax: clean(row[6]),
      rentMin: clean(row[7]),
      rentMax: clean(row[8]),
      premiumMax: clean(row[9]),
      areaMin: clean(row[10]),
      areaMax: clean(row[11]),
      floorMin: clean(row[12]),
      floorMax: clean(row[13]),
      requiredTags: clean(row[14]),
      preferredTags: clean(row[15]),
      excludedTags: clean(row[16]),
      manager: clean(row[18]),
      conditionVersion: Number(row[19]) || 1
    };
    return {
      id,
      name,
      phone: clean(row[1]),
      status: clean(row[2]) || "active",
      requirementsJson: JSON.stringify(requirements),
      memo: clean(row[17]),
      createdAt: clean(row[20]),
      updatedAt: clean(row[21])
    };
  }).filter(Boolean);
}

export async function prepareSheetDataImport(mediaText, contactsText, customersText, outputDirectory) {
  const media = mediaRows(mediaText);
  const contacts = contactRows(contactsText);
  const customers = customerRows(customersText);
  const directory = resolve(outputDirectory);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const mediaStatements = [
    `CREATE TABLE IF NOT EXISTS detail_media_import_staging (
      original_id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT '', source_listing_id TEXT NOT NULL DEFAULT '',
      thumbnail TEXT NOT NULL DEFAULT '', images_json TEXT NOT NULL DEFAULT '[]', photo_count INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT NOT NULL DEFAULT ''
    );`,
    "DELETE FROM detail_media_import_staging;",
    ...chunks(media, 4).map((batch) => `INSERT INTO detail_media_import_staging (
      original_id, source, source_listing_id, thumbnail, images_json, photo_count, checked_at
    ) VALUES\n${batch.map((item) => `  (${[
      item.originalId, item.source, item.sourceListingId, item.thumbnail, item.imagesJson,
      item.photoCount, item.checkedAt
    ].map(sql).join(", ")})`).join(",\n")}\nON CONFLICT(original_id) DO UPDATE SET
      thumbnail=excluded.thumbnail, images_json=excluded.images_json,
      photo_count=excluded.photo_count, checked_at=excluded.checked_at;`)
  ];
  const mediaInsertStatements = [];
  for (let start = 1; start <= media.length; start += 1_000) {
    const end = Math.min(media.length, start + 999);
    mediaInsertStatements.push(`INSERT INTO listing_media (
  id, listing_id, source_id, media_type, sort_order, external_url, status, checked_at, updated_at
)
SELECT 'image:' || s.id || ':' || CAST(j.key AS TEXT), s.listing_id, s.id, 'image',
  CAST(j.key AS INTEGER), CAST(j.value AS TEXT), 'external', m.checked_at, CURRENT_TIMESTAMP
FROM detail_media_import_staging m
JOIN listing_sources s ON s.id=m.original_id
JOIN json_each(m.images_json) j
WHERE m.rowid BETWEEN ${start} AND ${end} AND CAST(j.value AS TEXT) <> ''
ON CONFLICT(id) DO UPDATE SET external_url=excluded.external_url, sort_order=excluded.sort_order,
  status='external', checked_at=excluded.checked_at, updated_at=excluded.updated_at;`);
  }
  const mediaTransform = `PRAGMA foreign_keys = ON;

DELETE FROM listing_media
WHERE id NOT LIKE 'thumb-%' AND source_id IN (SELECT original_id FROM detail_media_import_staging);

UPDATE listing_sources
SET raw_json = json_patch(raw_json, json_object(
  'thumbnail', COALESCE((SELECT thumbnail FROM detail_media_import_staging m WHERE m.original_id=listing_sources.id), ''),
  'images', json(COALESCE((SELECT images_json FROM detail_media_import_staging m WHERE m.original_id=listing_sources.id), '[]')),
  'photoCount', COALESCE((SELECT photo_count FROM detail_media_import_staging m WHERE m.original_id=listing_sources.id), 0)
)), updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT original_id FROM detail_media_import_staging);

${mediaInsertStatements.join("\n\n")}

UPDATE listings SET detail_backfill_status='completed', detail_backfilled_at=CURRENT_TIMESTAMP,
  detail_backfill_error=''
WHERE id IN (
  SELECT DISTINCT s.listing_id FROM listing_sources s
  JOIN detail_media_import_staging m ON m.original_id=s.id
);

DROP TABLE detail_media_import_staging;
`;

  const contactStatements = [
    `CREATE TABLE IF NOT EXISTS detail_contact_import_staging (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_listing_id TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '', building_name TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', normalized_phone TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active'
    );`,
    "DELETE FROM detail_contact_import_staging;",
    ...chunks(contacts, 80).map((batch) => `INSERT INTO detail_contact_import_staging (
      id, source, source_listing_id, address, building_name, room, role, phone,
      normalized_phone, first_seen, last_seen, status
    ) VALUES\n${batch.map((item) => `  (${[
      item.id, item.source, item.sourceListingId, item.address, item.buildingName, item.room, item.role,
      item.phone, item.normalizedPhone, item.firstSeen, item.lastSeen, item.status
    ].map(sql).join(", ")})`).join(",\n")}\nON CONFLICT(id) DO UPDATE SET phone=excluded.phone, role=excluded.role,
      last_seen=excluded.last_seen, status=excluded.status;`)
  ];
  const contactTransform = `PRAGMA foreign_keys = ON;

INSERT INTO listing_contacts (
  id, listing_id, source_id, role, name, phone, normalized_phone, status,
  first_seen_at, last_seen_at, updated_at
)
SELECT c.id, s.listing_id, s.id, c.role, '', c.phone, c.normalized_phone, c.status,
  c.first_seen, c.last_seen, CURRENT_TIMESTAMP
FROM detail_contact_import_staging c
JOIN listing_sources s ON s.source=c.source AND s.source_listing_id=c.source_listing_id
WHERE c.phone <> ''
ON CONFLICT(id) DO UPDATE SET listing_id=excluded.listing_id, source_id=excluded.source_id,
  role=excluded.role, phone=excluded.phone, normalized_phone=excluded.normalized_phone,
  status=excluded.status, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at;

DROP TABLE detail_contact_import_staging;
`;

  const customerStatements = chunks(customers, 80).map((batch) => `INSERT INTO customers (
    id, name, phone, status, requirements_json, memo, created_at, updated_at
  ) VALUES\n${batch.map((item) => `  (${[
    item.id, item.name, item.phone, item.status, item.requirementsJson, item.memo,
    item.createdAt, item.updatedAt
  ].map(sql).join(", ")})`).join(",\n")}
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, status=excluded.status,
    requirements_json=excluded.requirements_json, memo=excluded.memo, updated_at=excluded.updated_at;`);

  const paths = [
    ...await writeParts(directory, "media-stage", mediaStatements),
    resolve(directory, "media-transform.sql"),
    ...await writeParts(directory, "contacts-stage", contactStatements),
    resolve(directory, "contacts-transform.sql"),
    ...await writeParts(directory, "customers", customerStatements)
  ];
  await writeFile(resolve(directory, "media-transform.sql"), mediaTransform, "utf8");
  await writeFile(resolve(directory, "contacts-transform.sql"), contactTransform, "utf8");
  const report = {
    mediaRows: media.length,
    imageUrls: media.reduce((total, item) => total + parseJson(item.imagesJson, []).length, 0),
    contactRows: contacts.length,
    customerRows: customers.length,
    files: paths.map((path) => basename(path))
  };
  await writeFile(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const [mediaPath, contactsPath, customersPath, outputPath] = process.argv.slice(2);
  if (!mediaPath || !contactsPath || !customersPath || !outputPath) {
    console.error("Usage: node tools/prepare-d1-sheet-data-import.mjs <media.tsv> <contacts.tsv> <customers.tsv> <output-directory>");
    process.exitCode = 1;
    return;
  }
  const report = await prepareSheetDataImport(
    await readFile(resolve(mediaPath), "utf8"),
    await readFile(resolve(contactsPath), "utf8"),
    await readFile(resolve(customersPath), "utf8"),
    resolve(outputPath)
  );
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
