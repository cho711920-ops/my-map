import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv } from "./prepare-d1-shadow-import.mjs";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function finiteNumber(value) {
  const normalized = clean(value).replace(/,/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function sql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function writeSqlParts(directory, prefix, statements, maxBytes = 700_000) {
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

function expandUnified(payload) {
  const groups = payload?.groups || {};
  if (!Array.isArray(payload?.fields)) return groups;
  const fields = payload.fields;
  return Object.fromEntries(Object.entries(groups).map(([propertyId, originals]) => [
    propertyId,
    (Array.isArray(originals) ? originals : []).map((values) => {
      const original = { propertyId };
      fields.forEach((field, index) => { original[field] = values[index]; });
      return original;
    })
  ]));
}

export async function preparePrimaryImport(csvText, unifiedText, outputDirectory) {
  const rows = parseCsv(csvText);
  const unified = JSON.parse(unifiedText);
  const groups = expandUnified(unified);
  const listings = [];
  const listingIds = new Set();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const propertyId = clean(row[15]);
    if (!propertyId || listingIds.has(propertyId)) continue;
    listingIds.add(propertyId);
    listings.push({
      id: propertyId,
      propertyId,
      status: clean(row[12]) || "active",
      mainSource: clean(row[14]),
      title: clean(row[0]),
      address: clean(row[1]),
      buildingName: clean(row[0]),
      room: clean(row[2]),
      listingType: clean(row[3]),
      deposit: finiteNumber(row[4]),
      rent: finiteNumber(row[5]),
      fee: finiteNumber(row[6]),
      premium: finiteNumber(row[7]),
      area: finiteNumber(row[8]),
      landlordPhone: clean(row[9]),
      tenantPhone: clean(row[10]),
      memo: clean(row[11]),
      regDate: clean(row[13]),
      sourceUrl: clean(row[16]),
      contactsJson: clean(row[17]) || "[]",
      buildingYear: clean(row[18]),
      buildingElevators: finiteNumber(row[19]) || 0,
      buildingApprovalDate: clean(row[20]),
      buildingInfoCheckedAt: clean(row[21]),
      buildingInfoStatus: clean(row[22]),
      registrationAt: clean(row[23]),
      lastCollectedAt: clean(row[24]),
      updatedAt: clean(row[24]) || clean(row[23]) || clean(row[13]) || new Date(0).toISOString()
    });
  }

  const listingColumns = [
    "id", "property_id", "status", "main_source", "title", "address", "building_name", "room",
    "listing_type", "deposit", "monthly_rent", "maintenance_fee", "premium", "area_m2",
    "landlord_phone", "tenant_phone", "operating_memo", "first_collected_at", "last_collected_at",
    "source_url", "contacts_json", "registration_at", "building_year", "building_elevators",
    "building_approval_date", "building_info_checked_at", "building_info_status", "updated_at"
  ];
  const listingStatements = chunks(listings, 35).map((batch) => {
    const values = batch.map((item) => [
      item.id, item.propertyId, item.status, item.mainSource, item.title, item.address, item.buildingName,
      item.room, item.listingType, item.deposit, item.rent, item.fee, item.premium, item.area,
      item.landlordPhone, item.tenantPhone, item.memo, item.registrationAt || item.regDate,
      item.lastCollectedAt, item.sourceUrl, item.contactsJson, item.registrationAt, item.buildingYear,
      item.buildingElevators, item.buildingApprovalDate, item.buildingInfoCheckedAt,
      item.buildingInfoStatus, item.updatedAt
    ].map(sql).join(", "));
    const updates = listingColumns.slice(1).map((column) => `${column}=excluded.${column}`).join(", ");
    return `INSERT INTO listings (${listingColumns.join(", ")}) VALUES\n${values.map((value) => `  (${value})`).join(",\n")}\nON CONFLICT(id) DO UPDATE SET ${updates};`;
  });

  const sources = [];
  const media = [];
  for (const [propertyId, originals] of Object.entries(groups)) {
    if (!listingIds.has(propertyId)) continue;
    for (const original of Array.isArray(originals) ? originals : []) {
      const originalId = clean(original.originalId) || `source-${crypto.randomUUID()}`;
      const sourceId = clean(original.sourceId) || originalId;
      const snapshot = {
        originalId,
        source: clean(original.source),
        sourceId,
        propertyId,
        link: clean(original.link),
        buildingName: clean(original.buildingName),
        address: clean(original.address),
        room: clean(original.room),
        type: clean(original.type),
        deposit: finiteNumber(original.deposit),
        rent: finiteNumber(original.rent),
        fee: finiteNumber(original.fee),
        premium: finiteNumber(original.premium),
        area: finiteNumber(original.area),
        memo: clean(original.memo),
        status: clean(original.status),
        firstSeen: clean(original.firstSeen),
        lastSeen: clean(original.lastSeen),
        thumbnail: clean(original.thumbnail),
        photoCount: Math.max(0, Number(original.photoCount) || 0),
        contactCount: Math.max(0, Number(original.contactCount) || 0),
        revision: Math.max(1, Number(original.revision) || 1)
      };
      sources.push({
        id: originalId,
        listingId: propertyId,
        source: snapshot.source,
        sourceListingId: sourceId,
        sourceUrl: snapshot.link,
        snapshot: JSON.stringify(snapshot),
        active: /삭제|종료|inactive/i.test(snapshot.status) ? 0 : 1,
        firstSeen: snapshot.firstSeen,
        lastSeen: snapshot.lastSeen
      });
      if (snapshot.thumbnail) {
        media.push({
          id: `thumb-${originalId}`,
          listingId: propertyId,
          sourceId: originalId,
          externalUrl: snapshot.thumbnail
        });
      }
    }
  }

  const sourceStatements = chunks(sources, 25).map((batch) => {
    const values = batch.map((item) => [
      item.id, item.listingId, item.source, item.sourceListingId, item.sourceUrl, item.snapshot,
      item.snapshot, item.active, item.firstSeen, item.lastSeen, item.lastSeen || item.firstSeen
    ].map(sql).join(", "));
    return `INSERT INTO listing_sources (
      id, listing_id, source, source_listing_id, source_url, list_snapshot_json, raw_json,
      active, first_collected_at, last_collected_at, updated_at
    ) VALUES\n${values.map((value) => `  (${value})`).join(",\n")}
    ON CONFLICT(id) DO UPDATE SET
      listing_id=excluded.listing_id, source=excluded.source, source_listing_id=excluded.source_listing_id,
      source_url=excluded.source_url, list_snapshot_json=excluded.list_snapshot_json,
      active=excluded.active, first_collected_at=excluded.first_collected_at,
      last_collected_at=excluded.last_collected_at, updated_at=excluded.updated_at;`;
  });

  const mediaStatements = chunks(media, 40).map((batch) => {
    const values = batch.map((item) => [
      item.id, item.listingId, item.sourceId, 0, item.externalUrl, "external"
    ].map(sql).join(", "));
    return `INSERT INTO listing_media (id, listing_id, source_id, sort_order, external_url, status)
      VALUES\n${values.map((value) => `  (${value})`).join(",\n")}
      ON CONFLICT(id) DO UPDATE SET external_url=excluded.external_url, updated_at=CURRENT_TIMESTAMP;`;
  });

  const directory = resolve(outputDirectory);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const paths = [
    ...await writeSqlParts(directory, "listings", listingStatements),
    ...await writeSqlParts(directory, "sources", sourceStatements),
    ...await writeSqlParts(directory, "media", mediaStatements)
  ];
  const report = {
    sourceRows: Math.max(0, rows.length - 1),
    listings: listings.length,
    sources: sources.length,
    thumbnails: media.length,
    files: paths.map((path) => basename(path))
  };
  await writeFile(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const [csvArgument, unifiedArgument, outputArgument] = process.argv.slice(2);
  if (!csvArgument || !unifiedArgument || !outputArgument) {
    console.error("Usage: node tools/prepare-d1-primary-import.mjs <sheet.csv> <unified.json> <output-directory>");
    process.exitCode = 1;
    return;
  }
  const report = await preparePrimaryImport(
    await readFile(resolve(csvArgument), "utf8"),
    await readFile(resolve(unifiedArgument), "utf8"),
    resolve(outputArgument)
  );
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
