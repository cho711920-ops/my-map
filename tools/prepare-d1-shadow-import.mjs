import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseCsv(source) {
  const text = String(source == null ? "" : source).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function finiteNumber(value) {
  const normalized = clean(value).replace(/,/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function sqlValue(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function prepareShadowImport(csvText, options = {}) {
  const rows = parseCsv(csvText);
  const seen = new Set();
  const listings = [];
  const skipped = { empty: 0, missingPropertyId: 0, duplicatePropertyId: 0 };

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.some((value) => clean(value))) {
      skipped.empty += 1;
      continue;
    }
    const propertyId = clean(row[15]);
    if (!propertyId) {
      skipped.missingPropertyId += 1;
      continue;
    }
    const key = propertyId.toLowerCase();
    if (seen.has(key)) {
      skipped.duplicatePropertyId += 1;
      continue;
    }
    seen.add(key);
    listings.push({
      id: propertyId,
      propertyId,
      status: clean(row[12]) || "active",
      mainSource: clean(row[14]),
      title: clean(row[0]),
      address: clean(row[1]),
      buildingName: clean(row[0]),
      room: clean(row[2]),
      deposit: finiteNumber(row[4]),
      monthlyRent: finiteNumber(row[5]),
      maintenanceFee: finiteNumber(row[6]),
      premium: finiteNumber(row[7]),
      areaM2: finiteNumber(row[8]),
      operatingMemo: clean(row[11]),
      firstCollectedAt: clean(row[23]) || clean(row[13]),
      lastCollectedAt: clean(row[24]),
      updatedAt: clean(row[24]) || clean(row[23]) || clean(row[13]) || new Date(0).toISOString()
    });
  }

  const columns = [
    "id", "property_id", "status", "main_source", "title", "address", "building_name", "room",
    "deposit", "monthly_rent", "maintenance_fee", "premium", "area_m2", "operating_memo",
    "first_collected_at", "last_collected_at", "updated_at"
  ];
  const values = (listing) => [
    listing.id, listing.propertyId, listing.status, listing.mainSource, listing.title, listing.address,
    listing.buildingName, listing.room, listing.deposit, listing.monthlyRent, listing.maintenanceFee,
    listing.premium, listing.areaM2, listing.operatingMemo, listing.firstCollectedAt,
    listing.lastCollectedAt, listing.updatedAt
  ].map(sqlValue).join(", ");

  const batchSize = Math.max(1, Math.min(Number(options.batchSize) || 50, 100));
  const statements = ["PRAGMA foreign_keys = ON;"];
  if (options.transaction === true) statements.push("BEGIN TRANSACTION;");
  for (let index = 0; index < listings.length; index += batchSize) {
    const batch = listings.slice(index, index + batchSize);
    statements.push(
      `INSERT OR IGNORE INTO listings (${columns.join(", ")}) VALUES\n${batch.map((item) => `  (${values(item)})`).join(",\n")};`
    );
  }
  if (options.transaction === true) statements.push("COMMIT;");
  statements.push("SELECT COUNT(*) AS shadow_listing_count FROM listings;");

  return {
    sql: `${statements.join("\n\n")}\n`,
    report: {
      sourceRows: Math.max(0, rows.length - 1),
      preparedListings: listings.length,
      skipped,
      propertyIds: listings.map((listing) => listing.propertyId)
    }
  };
}

async function main() {
  const [inputArgument, outputArgument, reportArgument] = process.argv.slice(2);
  if (!inputArgument || !outputArgument) {
    console.error("Usage: node tools/prepare-d1-shadow-import.mjs <sheet.csv> <shadow-import.sql> [report.json]");
    process.exitCode = 1;
    return;
  }
  const input = resolve(inputArgument);
  const output = resolve(outputArgument);
  const reportPath = resolve(reportArgument || `${outputArgument}.report.json`);
  const result = prepareShadowImport(await readFile(input, "utf8"));
  await writeFile(output, result.sql, "utf8");
  await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  console.log(`Prepared ${result.report.preparedListings} listings without overwrite statements.`);
  console.log(`SQL: ${output}`);
  console.log(`Report: ${reportPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
