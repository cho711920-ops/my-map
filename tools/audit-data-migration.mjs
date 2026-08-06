import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv } from "./prepare-d1-shadow-import.mjs";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function tsvRows(text) {
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.split("\t"));
}

function countBy(values) {
  const result = {};
  for (const value of values) {
    const key = clean(value) || "(empty)";
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function safeName(value) {
  return String(value || "audit").replace(/[^A-Za-z0-9._-]+/g, "-");
}

function compactExamples(values, limit = 50) {
  return [...values].slice(0, limit);
}

async function discoverTabs(directory) {
  const result = {};
  for (const name of await readdir(directory)) {
    if (!name.toLowerCase().endsWith(".tsv")) continue;
    const path = resolve(directory, name);
    const text = await readFile(path, "utf8");
    const rows = tsvRows(text);
    const header = rows[0] || [];
    if (header.includes("연락처원본ID")) result.contacts = { path, rows };
    else if (header.includes("대표사진URL")) result.media = { path, rows };
    else if (header.includes("통합매물ID")) result.connections = { path, rows };
    else if (header.includes("고객ID")) result.customers = { path, rows };
  }
  return result;
}

function masterListings(csvText) {
  return parseCsv(csvText).slice(1).map((row) => ({
    propertyId: clean(row[15]),
    status: clean(row[12]),
    source: clean(row[14]),
    title: clean(row[0]),
    address: clean(row[1]),
    room: clean(row[2]),
    memo: clean(row[11])
  })).filter((row) => row.propertyId);
}

function unifiedRows(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const rows = [];
  for (const [masterId, compactRows] of Object.entries(payload?.groups || {})) {
    for (const compact of compactRows || []) {
      const row = { masterId };
      fields.forEach((field, index) => { row[field] = compact[index]; });
      rows.push(row);
    }
  }
  return rows;
}

function normalizeSourceKey(source, sourceId) {
  return `${clean(source).replace(/\s+/g, "").toLowerCase()}::${clean(sourceId).replace(/\s+/g, "").toLowerCase()}`;
}

export async function auditDataMigration(options) {
  const workDirectory = resolve(options.workDirectory);
  const outputPath = resolve(options.outputPath);
  const tabs = await discoverTabs(resolve(workDirectory, "sheet-tabs"));
  const requiredTabs = ["connections", "media", "contacts", "customers"];
  const missingTabs = requiredTabs.filter((key) => !tabs[key]);
  if (missingTabs.length) throw new Error(`Missing sheet tabs: ${missingTabs.join(", ")}`);

  const [csvText, unifiedText] = await Promise.all([
    readFile(resolve(workDirectory, "js-map-sheet-export.csv"), "utf8"),
    readFile(resolve(workDirectory, "unified-listings-compact-v2.json"), "utf8")
  ]);
  const listings = masterListings(csvText);
  const listingIds = new Set(listings.map((row) => row.propertyId));
  const unifiedPayload = JSON.parse(unifiedText);
  const sources = unifiedRows(unifiedPayload);
  const sourceIds = new Set(sources.map((row) => clean(row.originalId)).filter(Boolean));
  const sourceKeys = new Set(sources.map((row) => normalizeSourceKey(row.source, row.sourceId)));
  const unifiedMasterIds = new Set(sources.map((row) => row.masterId));

  const connectionRows = tabs.connections.rows.slice(1).map((row) => ({
    originalId: clean(row[0]),
    masterId: clean(row[1]),
    status: clean(row[2]),
    updatedAt: clean(row[4]),
    reason: clean(row[5])
  })).filter((row) => row.originalId || row.masterId);
  const connectionOriginalIds = new Set(connectionRows.map((row) => row.originalId).filter(Boolean));
  const connectionMasterIds = new Set(connectionRows.map((row) => row.masterId).filter(Boolean));
  const missingConnectionSources = connectionRows.filter((row) => row.originalId && !sourceIds.has(row.originalId));
  const missingConnectionMasters = connectionRows.filter((row) => row.masterId && !listingIds.has(row.masterId));
  const mappingByOriginal = new Map(sources.map((row) => [clean(row.originalId), row.masterId]));
  const mappingMismatches = connectionRows.filter((row) => row.originalId && row.masterId &&
    mappingByOriginal.has(row.originalId) && mappingByOriginal.get(row.originalId) !== row.masterId);

  const mediaRows = tabs.media.rows.slice(1).map((row) => {
    const images = parseJson(row[4], []);
    const urls = unique([row[3], ...(Array.isArray(images) ? images : [])].filter((url) => /^https:\/\//i.test(clean(url))));
    return {
      originalId: clean(row[0]), source: clean(row[1]), sourceId: clean(row[2]),
      photoCount: Math.max(Number(row[5]) || 0, urls.length), urls
    };
  }).filter((row) => row.originalId);
  const mediaUniqueIds = new Set(mediaRows.map((row) => row.originalId));
  const mediaForMissingSources = mediaRows.filter((row) => !sourceIds.has(row.originalId));

  const contactRows = tabs.contacts.rows.slice(1).map((row) => ({
    id: clean(row[0]), source: clean(row[1]), sourceId: clean(row[2]),
    phone: clean(row[7]), status: clean(row[10])
  })).filter((row) => row.id && row.phone);
  const unmatchedContacts = contactRows.filter((row) => !sourceKeys.has(normalizeSourceKey(row.source, row.sourceId)));

  const customerRows = tabs.customers.rows.slice(1).map((row) => ({
    id: clean(row[22]), name: clean(row[0]), phone: clean(row[1]), status: clean(row[2]),
    memo: clean(row[17]), updatedAt: clean(row[21])
  })).filter((row) => row.id && row.name);

  const masterOnly = listings.filter((row) => !unifiedMasterIds.has(row.propertyId));
  const unifiedMissingMaster = [...unifiedMasterIds].filter((id) => !listingIds.has(id));
  const sourceOnly = [...sourceIds].filter((id) => !connectionOriginalIds.has(id));

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      masterCsv: "js-map-sheet-export.csv",
      unifiedSnapshot: "unified-listings-compact-v2.json",
      tabs: Object.fromEntries(Object.entries(tabs).map(([key, value]) => [key, basename(value.path)]))
    },
    summary: {
      masterListings: listingIds.size,
      unifiedMasters: unifiedMasterIds.size,
      unifiedSources: sourceIds.size,
      connectionRows: connectionRows.length,
      connectionOriginalIds: connectionOriginalIds.size,
      connectionMasterIds: connectionMasterIds.size,
      connectionSourcesMissingFromUnified: missingConnectionSources.length,
      connectionMastersMissingFromMasterCsv: missingConnectionMasters.length,
      connectionMappingMismatches: mappingMismatches.length,
      unifiedSourcesMissingFromConnections: sourceOnly.length,
      masterListingsWithoutUnifiedSources: masterOnly.length,
      unifiedMastersMissingFromMasterCsv: unifiedMissingMaster.length,
      mediaOriginals: mediaUniqueIds.size,
      mediaUrls: mediaRows.reduce((sum, row) => sum + row.urls.length, 0),
      mediaOriginalsMissingFromUnified: mediaForMissingSources.length,
      mediaUrlsForMissingSources: mediaForMissingSources.reduce((sum, row) => sum + row.urls.length, 0),
      contacts: contactRows.length,
      contactsWithoutUnifiedSource: unmatchedContacts.length,
      customers: customerRows.length
    },
    classifications: {
      masterStatus: countBy(listings.map((row) => row.status)),
      masterSource: countBy(listings.map((row) => row.source)),
      connectionStatus: countBy(connectionRows.map((row) => row.status)),
      connectionReasonForMissingSources: countBy(missingConnectionSources.map((row) => row.reason)),
      mediaMissingSourceByProvider: countBy(mediaForMissingSources.map((row) => row.source)),
      unmatchedContactByProvider: countBy(unmatchedContacts.map((row) => row.source)),
      customerStatus: countBy(customerRows.map((row) => row.status))
    },
    recoverableCandidates: {
      missingConnectionSources,
      missingConnectionMasters,
      mappingMismatches,
      mediaForMissingSources: mediaForMissingSources.map((row) => ({
        originalId: row.originalId, source: row.source, sourceId: row.sourceId,
        photoCount: row.photoCount, urlCount: row.urls.length
      })),
      unmatchedContacts,
      masterOnly,
      unifiedMissingMaster,
      sourceOnly
    },
    examples: {
      missingConnectionSources: compactExamples(missingConnectionSources),
      missingConnectionMasters: compactExamples(missingConnectionMasters),
      mappingMismatches: compactExamples(mappingMismatches),
      mediaForMissingSources: compactExamples(mediaForMissingSources.map((row) => ({
        originalId: row.originalId, source: row.source, sourceId: row.sourceId,
        photoCount: row.photoCount, urlCount: row.urls.length
      }))),
      unmatchedContacts: compactExamples(unmatchedContacts),
      masterOnly: compactExamples(masterOnly)
    }
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const [workArgument, outputArgument] = process.argv.slice(2);
  if (!workArgument) {
    console.error("Usage: node tools/audit-data-migration.mjs <work-directory> [report.json]");
    process.exitCode = 1;
    return;
  }
  const workDirectory = resolve(workArgument);
  const outputPath = resolve(outputArgument || `${safeName(basename(workDirectory))}-data-audit.json`);
  const report = await auditDataMigration({ workDirectory, outputPath });
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
