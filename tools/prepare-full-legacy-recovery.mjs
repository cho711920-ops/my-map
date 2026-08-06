import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv } from "./prepare-d1-shadow-import.mjs";

const clean = (value) => String(value == null ? "" : value).trim();
const numeric = (value) => {
  const text = clean(value).replace(/,/g, "");
  const parsed = Number(text);
  return text && Number.isFinite(parsed) ? parsed : null;
};
const sql = (value) => value == null ? "NULL" : typeof value === "number"
  ? (Number.isFinite(value) ? String(value) : "NULL")
  : `'${String(value).replace(/'/g, "''")}'`;
const json = (value) => JSON.stringify(value == null ? null : value);
const parseJson = (value, fallback) => {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
};
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];

async function* streamCsvRows(path) {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 256 * 1024 });
  let row = [];
  let cell = "";
  let quoted = false;
  let pendingQuote = false;
  let skipLf = false;
  let firstCharacter = true;
  for await (const chunk of stream) {
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];
      if (firstCharacter) {
        firstCharacter = false;
        if (character === "\uFEFF") continue;
      }
      if (pendingQuote) {
        pendingQuote = false;
        if (character === '"') {
          cell += '"';
          continue;
        }
        quoted = false;
      }
      if (quoted) {
        if (character === '"') {
          if (index + 1 >= chunk.length) {
            pendingQuote = true;
          } else if (chunk[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += character;
        }
        continue;
      }
      if (skipLf) {
        skipLf = false;
        if (character === "\n") continue;
      }
      if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(cell);
        cell = "";
      } else if (character === "\r" || character === "\n") {
        row.push(cell);
        yield row;
        row = [];
        cell = "";
        skipLf = character === "\r";
      } else {
        cell += character;
      }
    }
  }
  if (pendingQuote) quoted = false;
  if (cell || row.length) {
    row.push(cell);
    yield row;
  }
}

function sourceKey(source, sourceId) {
  const provider = clean(source).replace(/\s+/g, "").toLowerCase();
  let id = clean(sourceId).replace(/\s+/g, "").toLowerCase();
  if (provider.includes("네이버") || provider.includes("naver")) id = id.replace(/^네이버/, "");
  return `${provider}::${id}`;
}

function objectFromRow(header, row) {
  return Object.fromEntries(header.map((name, index) => [clean(name) || `column_${index + 1}`, row[index] ?? ""]));
}

function valuesStatement(table, columns, rows, suffix = "") {
  if (!rows.length) return [];
  return [`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${rows.map((row) =>
    `  (${row.map(sql).join(", ")})`).join(",\n")}\n${suffix};`];
}

function batchedStatements(table, columns, rows, batchSize, suffix = "") {
  const result = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    result.push(...valuesStatement(table, columns, rows.slice(index, index + batchSize), suffix));
  }
  return result;
}

function byteBatchedStatements(table, columns, rows, maxStatementBytes, suffix = "") {
  const result = [];
  let batch = [];
  for (const row of rows) {
    const candidate = [...batch, row];
    const [statement] = valuesStatement(table, columns, candidate, suffix);
    if (batch.length && Buffer.byteLength(statement) > maxStatementBytes) {
      result.push(...valuesStatement(table, columns, batch, suffix));
      batch = [row];
    } else {
      batch = candidate;
    }
  }
  result.push(...valuesStatement(table, columns, batch, suffix));
  return result;
}

async function writeParts(directory, prefix, statements, maxBytes = 650_000) {
  const paths = [];
  let part = ["PRAGMA foreign_keys = ON;"];
  let bytes = Buffer.byteLength(part[0]);
  const flush = async () => {
    if (part.length === 1) return;
    const path = resolve(directory, `${prefix}-${String(paths.length + 1).padStart(3, "0")}.sql`);
    await writeFile(path, `${part.join("\n\n")}\n`, "utf8");
    paths.push(path);
    part = ["PRAGMA foreign_keys = ON;"];
    bytes = Buffer.byteLength(part[0]);
  };
  for (const statement of statements) {
    const size = Buffer.byteLength(statement) + 2;
    if (part.length > 1 && bytes + size > maxBytes) await flush();
    part.push(statement);
    bytes += size;
  }
  await flush();
  return paths;
}

function imagesFromOriginal(row) {
  const fromJson = parseJson(row?.[19], []);
  return unique([row?.[18], ...(Array.isArray(fromJson) ? fromJson : [])])
    .filter((url) => /^https:\/\//i.test(url));
}

function contactsFromRows(rows) {
  return rows.map((row) => ({
    id: clean(row[0]), role: clean(row[6]), name: "", phone: clean(row[7]),
    firstSeen: clean(row[8]), lastSeen: clean(row[9]), status: clean(row[10])
  })).filter((entry) => entry.phone);
}

function masterInsertRow(row) {
  const propertyId = clean(row[15]);
  return [
    propertyId, propertyId, clean(row[12]) || "active", clean(row[30] || row[14]), clean(row[0]),
    clean(row[1]), clean(row[0]), clean(row[2]), clean(row[3]), numeric(row[4]), numeric(row[5]),
    numeric(row[7]), numeric(row[6]), numeric(row[8]), clean(row[29] || row[11]), clean(row[21]),
    clean(row[20]), clean(row[19]), Math.max(1, Number(row[24]) || 1), clean(row[22] || row[13]),
    clean(row[23]), clean(row[13]), clean(row[25] || row[23]), clean(row[9]), clean(row[10]),
    clean(row[16]), clean(row[18]) || "[]", clean(row[13])
  ];
}

function originalRecord(row, contactRows = []) {
  const images = imagesFromOriginal(row);
  const contacts = contactsFromRows(contactRows);
  return {
    originalId: clean(row[0]), source: clean(row[1]), sourceId: clean(row[2]),
    buildingName: clean(row[5]), address: clean(row[6]), room: clean(row[7]),
    category: clean(row[8]), deposit: numeric(row[9]), rent: numeric(row[10]),
    fee: numeric(row[11]), premium: numeric(row[12]), area: numeric(row[13]),
    memo: clean(row[14]), link: clean(row[4]),
    listSnapshot: json({ address: clean(row[6]), room: clean(row[7]), deposit: numeric(row[9]),
      rent: numeric(row[10]), area: numeric(row[13]), photoCount: images.length, contactCount: contacts.length }),
    images, contacts, raw: parseJson(row[21], { legacyOriginalId: clean(row[0]) })
  };
}

function stateFromSession(value) {
  const text = clean(value);
  if (/완료/.test(text)) return "completed";
  if (/중단|일시|보류/.test(text)) return "paused";
  if (/부분/.test(text)) return "partial";
  return "completed";
}

export async function prepareFullLegacyRecovery(options) {
  const tabs = resolve(options.tabsDirectory);
  const output = resolve(options.outputDirectory);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  const readTab = async (name) => parseCsv(await readFile(resolve(tabs, `${name}.csv`), "utf8"));
  const [masterRows, connectionRows, contactRows, reviewRows, customerRows, matchRows,
    activityRows, sessionRows, cloudRows, announcementRows, buildingRows, historyRows,
    sourceHistoryRows, unifiedPayload] = await Promise.all([
    readTab("JS부동산 매물현황"), readTab("JS_통합매물연결"), readTab("JS_연락처원본"),
    readTab("매물검증"), readTab("고객문의"), readTab("고객매칭"), readTab("상담이력"),
    readTab("수집회차"), readTab("JS_클라우드상태"), readTab("공지사항"), readTab("JS_건물정보"),
    readTab("매물이력"), readTab("매물출처이력"),
    readFile(resolve(options.unifiedSnapshot), "utf8").then(JSON.parse)
  ]);

  const baselineMasterIds = new Set(Object.keys(unifiedPayload.groups || {}));
  const baselineSourceIds = new Set(Object.values(unifiedPayload.groups || {}).flat()
    .map((row) => clean(row[0])).filter(Boolean));
  const masters = new Map(masterRows.slice(1).filter((row) => clean(row[15])).map((row) => [clean(row[15]), row]));
  const missingMasters = [...masters.entries()].filter(([id]) => !baselineMasterIds.has(id));

  const contactsBySource = new Map();
  for (const row of contactRows.slice(1)) {
    if (!clean(row[0]) || !clean(row[7])) continue;
    const key = sourceKey(row[1], row[2]);
    if (!contactsBySource.has(key)) contactsBySource.set(key, []);
    contactsBySource.get(key).push(row);
  }

  const relationRows = connectionRows.slice(1).filter((row) => clean(row[0]));
  const linkedRelations = relationRows.filter((row) => clean(row[2]) === "연결" && clean(row[1]));
  const missingLinked = linkedRelations.filter((row) => !baselineSourceIds.has(clean(row[0])));
  const reviewRelations = relationRows.filter((row) => clean(row[2]) === "검증대기");
  const requiredOriginalIds = new Set([
    ...missingLinked.map((row) => clean(row[0])),
    ...reviewRelations.map((row) => clean(row[0]))
  ]);
  const requiredSourceKeys = new Set(reviewRows.slice(1)
    .filter((row) => row.some((value) => clean(value)))
    .map((row) => sourceKey(row[4], row[14])));

  console.log("Loading the large original-listing export...");
  const originalsById = new Map();
  const originalsBySource = new Map();
  const originalIdsBySource = new Map();
  let originalRowCount = 0;
  let originalHeaderSkipped = false;
  for await (const row of streamCsvRows(resolve(tabs, "JS_원본매물.csv"))) {
    if (!originalHeaderSkipped) {
      originalHeaderSkipped = true;
      continue;
    }
    originalRowCount += 1;
    const id = clean(row[0]);
    const key = sourceKey(row[1], row[2]);
    if (key !== "::") originalIdsBySource.set(key, id);
    if (requiredOriginalIds.has(id) || requiredSourceKeys.has(key)) {
      if (id) originalsById.set(id, row);
      if (key !== "::") originalsBySource.set(key, row);
    }
  }

  const coreStatements = [];
  coreStatements.push(...batchedStatements("listings", [
    "id", "property_id", "status", "main_source", "title", "address", "building_name", "room",
    "listing_type", "deposit", "monthly_rent", "premium", "maintenance_fee", "area_m2",
    "operating_memo", "search_tags", "condition_key", "physical_key", "version",
    "first_collected_at", "last_collected_at", "created_at", "updated_at", "landlord_phone",
    "tenant_phone", "source_url", "contacts_json", "registration_at"
  ], missingMasters.map(([, row]) => masterInsertRow(row)), 20, "ON CONFLICT(id) DO NOTHING"));

  const linkedSourceRows = [];
  const linkedMediaRows = [];
  const linkedContactRows = [];
  for (const relation of missingLinked) {
    const original = originalsById.get(clean(relation[0]));
    if (!original) continue;
    const key = sourceKey(original[1], original[2]);
    const record = originalRecord(original, contactsBySource.get(key) || []);
    const listingId = clean(relation[1] || original[3]);
    const snapshot = {
      originalId: record.originalId, source: record.source, sourceId: record.sourceId, propertyId: listingId,
      link: record.link, buildingName: record.buildingName, address: record.address, room: record.room,
      type: record.category, deposit: record.deposit, rent: record.rent, fee: record.fee,
      premium: record.premium, area: record.area, memo: record.memo, status: clean(original[15]) || "활성",
      firstSeen: clean(original[16]), lastSeen: clean(original[17]), thumbnail: record.images[0] || "",
      photoCount: record.images.length, contactCount: record.contacts.length, revision: Number(original[23]) || 1,
      images: record.images
    };
    linkedSourceRows.push([
      record.originalId, listingId, record.source, record.sourceId, record.link, "", "legacy-recovery",
      json(snapshot), json({ ...record.raw, images: record.images }), clean(original[22]), 1, 0,
      clean(original[16]), clean(original[17]), clean(original[16]), clean(relation[4] || original[17])
    ]);
    record.images.forEach((url, index) => linkedMediaRows.push([
      `legacy-image:${record.originalId}:${index}`, listingId, record.originalId, "image", index, url,
      "external", clean(original[17]), clean(original[17]), clean(original[17])
    ]));
    record.contacts.forEach((contact) => linkedContactRows.push([
      contact.id || `legacy-contact:${record.originalId}:${contact.phone}`, listingId, record.originalId,
      contact.role, contact.name, contact.phone, contact.phone.replace(/\D/g, ""),
      clean(contact.status).toUpperCase() === "N" ? "inactive" : "active",
      contact.firstSeen, contact.lastSeen, contact.firstSeen, contact.lastSeen
    ]));
  }
  coreStatements.push(...batchedStatements("listing_sources", [
    "id", "listing_id", "source", "source_listing_id", "source_url", "source_condition", "snapshot_hash",
    "list_snapshot_json", "raw_json", "session_id", "active", "missing_count", "first_collected_at",
    "last_collected_at", "created_at", "updated_at"
  ], linkedSourceRows, 3, "ON CONFLICT(id) DO NOTHING"));
  coreStatements.push(...batchedStatements("listing_media", [
    "id", "listing_id", "source_id", "media_type", "sort_order", "external_url", "status",
    "checked_at", "created_at", "updated_at"
  ], linkedMediaRows, 25, "ON CONFLICT(id) DO NOTHING"));
  coreStatements.push(...batchedStatements("listing_contacts", [
    "id", "listing_id", "source_id", "role", "name", "phone", "normalized_phone", "status",
    "first_seen_at", "last_seen_at", "created_at", "updated_at"
  ], linkedContactRows, 30, "ON CONFLICT(id) DO NOTHING"));

  const sessionHeader = sessionRows[0];
  const savedSessionIds = new Set();
  const collectorSessionRows = [];
  for (const row of sessionRows.slice(1).filter((entry) => clean(entry[0]))) {
    const id = clean(row[0]);
    savedSessionIds.add(id);
    collectorSessionRows.push([
      id, clean(row[1]), "legacy-sheet", stateFromSession(row[7]),
      json({ scope: clean(row[2]), received: numeric(row[5]) || 0, complete: clean(row[6]),
        created: numeric(row[8]) || 0, merged: numeric(row[9]) || 0, updated: numeric(row[10]) || 0,
        review: numeric(row[11]) || 0, duplicate: numeric(row[12]) || 0, failed: numeric(row[13]) || 0,
        note: clean(row[14]), legacy: objectFromRow(sessionHeader, row) }),
      "{}", clean(row[3]), clean(row[4]), clean(row[4] || row[3])
    ]);
  }

  const reviewHeader = reviewRows[0];
  const restoredReviewRows = [];
  const missingReviewOriginals = [];
  const seenReviewIds = new Set();
  const restoredReviewOriginalIds = new Set();
  for (let index = 0; index < reviewRows.length - 1; index += 1) {
    const row = reviewRows[index + 1];
    if (!row.some((value) => clean(value))) continue;
    const key = sourceKey(row[4], row[14]);
    const original = originalsBySource.get(key);
    if (!original) missingReviewOriginals.push({ source: clean(row[4]), sourceId: clean(row[14]), reviewId: clean(row[23]) });
    const contactSet = contactsBySource.get(key) || [];
    const record = original ? originalRecord(original, contactSet) : {
      originalId: "", source: clean(row[4]), sourceId: clean(row[14]), buildingName: "",
      address: clean(row[6]), room: clean(row[7]), category: clean(row[8]), deposit: numeric(row[9]),
      rent: numeric(row[10]), fee: numeric(row[11]), premium: numeric(row[12]), area: numeric(row[13]),
      memo: clean(row[16] || row[25]), link: clean(row[18]), images: [], contacts: contactsFromRows(contactSet),
      raw: { legacyReview: objectFromRow(reviewHeader, row) }, listSnapshot: ""
    };
    if (record.originalId) restoredReviewOriginalIds.add(record.originalId);
    const sessionId = clean(original?.[22]) || `legacy-review-${clean(record.source).replace(/\s+/g, "-")}`;
    if (!savedSessionIds.has(sessionId)) {
      savedSessionIds.add(sessionId);
      collectorSessionRows.push([
        sessionId, record.source, "legacy-sheet", "completed", json({ review: 0, legacyRecovery: true }),
        "{}", clean(row[22]), clean(row[22]), clean(row[22])
      ]);
    }
    let reviewId = clean(row[24] || row[23]) || `legacy-review-${index + 1}`;
    if (seenReviewIds.has(reviewId)) reviewId = `${reviewId}-${index + 1}`;
    seenReviewIds.add(reviewId);
    const candidateIds = unique(`${clean(row[20])} ${clean(row[21])}`.match(/M-[A-Za-z0-9-]+/g) || []);
    restoredReviewRows.push([
      reviewId, sessionId, record.source, clean(record.sourceId), "legacy-recovery", json(record), "review",
      json({ candidateIds, verificationId: clean(row[23]), reviewType: clean(row[1]),
        risk: clean(row[2]), recommendation: clean(row[3]), comparison: clean(row[15]),
        reviewerMemo: clean(row[19]) }), "", clean(row[22]), "", clean(record.originalId)
    ]);
  }
  for (const relation of reviewRelations) {
    const originalId = clean(relation[0]);
    if (!originalId || restoredReviewOriginalIds.has(originalId)) continue;
    const original = originalsById.get(originalId);
    if (!original) {
      missingReviewOriginals.push({ originalId, relation: objectFromRow(connectionRows[0], relation) });
      continue;
    }
    const key = sourceKey(original[1], original[2]);
    const record = originalRecord(original, contactsBySource.get(key) || []);
    const sessionId = clean(original[22]) || `legacy-review-${clean(record.source).replace(/\s+/g, "-")}`;
    if (!savedSessionIds.has(sessionId)) {
      savedSessionIds.add(sessionId);
      collectorSessionRows.push([
        sessionId, record.source, "legacy-sheet", "completed", json({ review: 0, legacyRecovery: true }),
        "{}", clean(relation[4]), clean(relation[4]), clean(relation[4])
      ]);
    }
    let reviewId = `legacy-review:${originalId}`;
    if (seenReviewIds.has(reviewId)) reviewId = `${reviewId}:${restoredReviewRows.length + 1}`;
    seenReviewIds.add(reviewId);
    restoredReviewOriginalIds.add(originalId);
    restoredReviewRows.push([
      reviewId, sessionId, record.source, record.sourceId, "legacy-recovery", json(record), "review",
      json({ candidateIds: [], reviewType: "층호실표기확인", risk: "중간",
        recommendation: "직접 확인", comparison: clean(relation[5]), relationOnlyRecovery: true }),
      "", clean(relation[4]), "", originalId
    ]);
  }

  const sessionStatements = batchedStatements("collector_sessions", [
    "id", "source", "owner_email", "state", "totals_json", "error_json", "started_at", "finished_at", "updated_at"
  ], collectorSessionRows, 20, "ON CONFLICT(id) DO NOTHING");
  const reviewStatements = batchedStatements("collector_raw", [
    "id", "session_id", "source", "source_listing_id", "snapshot_hash", "payload_json", "processing_state",
    "result_json", "error_text", "created_at", "processed_at", "legacy_original_id"
  ], restoredReviewRows, 2, "ON CONFLICT(id) DO NOTHING");

  const customerDataRows = customerRows.slice(1).filter((row) => clean(row[22]) && clean(row[0])).map((row) => [
    clean(row[22]), clean(row[0]), clean(row[1]), clean(row[2]) || "active",
    json({ regions: clean(row[3]), types: clean(row[4]), depositMin: clean(row[5]), depositMax: clean(row[6]),
      rentMin: clean(row[7]), rentMax: clean(row[8]), premiumMax: clean(row[9]), areaMin: clean(row[10]),
      areaMax: clean(row[11]), floorMin: clean(row[12]), floorMax: clean(row[13]), requiredTags: clean(row[14]),
      preferredTags: clean(row[15]), excludedTags: clean(row[16]), manager: clean(row[18]),
      conditionVersion: Number(row[19]) || 1 }), clean(row[17]), clean(row[20]), clean(row[21])
  ]);
  const matchHeader = matchRows[0];
  const customerMatchRows = matchRows.slice(1).filter((row) => clean(row[1]) && clean(row[2])).map((row) => [
    clean(row[1]), clean(row[2]), clean(row[8]) || "신규", numeric(row[4]) || 0, clean(row[12]),
    clean(row[9]), clean(row[10] || row[9]), clean(row[11]), json(objectFromRow(matchHeader, row))
  ]);
  const activityHeader = activityRows[0];
  const customerActivityRows = activityRows.slice(1).filter((row) => clean(row[0]) && clean(row[2])).map((row) => [
    clean(row[0]), clean(row[2]), clean(row[4]), "legacy-sheet", clean(row[5]), clean(row[6]),
    clean(row[7]), clean(row[1]), clean(row[3]), json(objectFromRow(activityHeader, row))
  ]);
  const customerStatements = [
    ...batchedStatements("customers", ["id", "name", "phone", "status", "requirements_json", "memo", "created_at", "updated_at"], customerDataRows, 20, "ON CONFLICT(id) DO NOTHING"),
    ...batchedStatements("customer_matches", ["customer_id", "listing_id", "state", "score", "memo", "created_at", "updated_at", "contacted_at", "legacy_json"], customerMatchRows, 30, "ON CONFLICT(customer_id, listing_id) DO NOTHING"),
    ...batchedStatements("customer_activities", ["id", "customer_id", "stage", "source", "memo", "next_contact_date", "actor_email", "created_at", "listing_id", "legacy_json"], customerActivityRows, 30, "ON CONFLICT(id) DO NOTHING")
  ];

  for (const row of cloudRows.slice(1).filter((entry) => clean(entry[0]) && clean(entry[1]))) {
    const payload = parseJson(row[3], row[3]);
    customerStatements.push(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at) VALUES (${[
      clean(row[0]).toLowerCase(), clean(row[1]), clean(row[2]) || "default", json(payload),
      Math.max(1, Number(row[5]) || 1), clean(row[4])
    ].map(sql).join(", ")}) ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
      value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at
      WHERE excluded.version > cloud_state.version;`);
  }

  const announcementDataRows = announcementRows.slice(1).filter((row) => clean(row[5])).map((row) => [
    clean(row[5]), clean(row[1]), clean(row[2]), /^(?:false|0|n|아니오)$/i.test(clean(row[0])) ? 0 : 1,
    clean(row[3]), clean(row[4]), "legacy-sheet", clean(row[6]), clean(row[6])
  ]);
  customerStatements.push(...batchedStatements("announcements", [
    "id", "title", "body", "active", "starts_at", "ends_at", "created_by", "created_at", "updated_at"
  ], announcementDataRows, 20, "ON CONFLICT(id) DO NOTHING"));

  const buildingHeader = buildingRows[0];
  const buildingDataRows = buildingRows.slice(1).filter((row) => clean(row[0])).map((row) => [
    clean(row[0]), json({ address: clean(row[1]), sigunguCode: clean(row[2]), legalDongCode: clean(row[3]),
      landType: clean(row[4]), mainNumber: clean(row[5]), subNumber: clean(row[6]) }),
    json(objectFromRow(buildingHeader, row)), "{}", clean(row[13]), ""
  ]);
  customerStatements.push(...batchedStatements("building_cache", [
    "cache_key", "parcel_json", "summary_json", "details_json", "checked_at", "expires_at"
  ], buildingDataRows, 30, "ON CONFLICT(cache_key) DO NOTHING"));

  const allKnownMasterIds = new Set([...baselineMasterIds, ...missingMasters.map(([id]) => id)]);
  const allLinkedOriginalIds = new Set([...baselineSourceIds, ...missingLinked.map((row) => clean(row[0]))]);
  const originalIdBySource = originalIdsBySource;
  const historyHeader = historyRows[0];
  const legacyHistoryRows = [];
  const archiveRows = [];
  let skippedHistory = 0;
  for (const row of historyRows.slice(1).filter((entry) => clean(entry[0]))) {
    const listingId = clean(row[2]);
    if (!allKnownMasterIds.has(listingId)) {
      skippedHistory += 1;
      archiveRows.push(["listing-history", clean(row[0]), json(objectFromRow(historyHeader, row)), clean(row[1])]);
      continue;
    }
    const originalId = originalIdBySource.get(sourceKey(row[5], row[6])) || "";
    legacyHistoryRows.push([
      listingId, allLinkedOriginalIds.has(originalId) ? originalId : null, clean(row[3]) || "legacyHistory",
      clean(row[10]) || "legacy-sheet", json({ legacyId: clean(row[0]), value: parseJson(row[8], row[8]) }),
      json({ legacyId: clean(row[0]), cause: clean(row[4]), verificationId: clean(row[7]),
        value: parseJson(row[9], row[9]), legacy: objectFromRow(historyHeader, row) }),
      clean(row[1]), `history:${clean(row[0])}`
    ]);
  }
  const historyStatements = byteBatchedStatements("listing_history", [
    "listing_id", "source_id", "action", "actor_email", "before_json", "after_json", "created_at", "legacy_id"
  // Keep generated statements below D1's per-statement size limit while still
  // grouping small history rows efficiently. The conflict target makes every
  // generated part safe to retry after a transient remote error.
  ], legacyHistoryRows, 60_000, "ON CONFLICT(legacy_id) WHERE legacy_id <> '' DO NOTHING");

  const sourceHistoryHeader = sourceHistoryRows[0];
  const legacySourceHistoryRows = [];
  let skippedSourceHistory = 0;
  for (const row of sourceHistoryRows.slice(1).filter((entry) => clean(entry[1]) && clean(entry[2]))) {
    const listingId = clean(row[0]);
    const originalId = originalIdBySource.get(sourceKey(row[1], row[2])) || "";
    if (!listingId || !allKnownMasterIds.has(listingId) || !allLinkedOriginalIds.has(originalId)) {
      skippedSourceHistory += 1;
      archiveRows.push([
        "source-history", originalId || `${sourceKey(row[1], row[2])}:${legacySourceHistoryRows.length + skippedSourceHistory}`,
        json(objectFromRow(sourceHistoryHeader, row)), clean(row[5] || row[4])
      ]);
      continue;
    }
    legacySourceHistoryRows.push([
      listingId, originalId, "legacySourceSnapshot", "legacy-sheet", "{}",
      json({ legacy: objectFromRow(sourceHistoryHeader, row) }), clean(row[5] || row[4]), `source:${originalId}`
    ]);
  }
  const sourceHistoryStatements = byteBatchedStatements("listing_history", [
    "listing_id", "source_id", "action", "actor_email", "before_json", "after_json", "created_at", "legacy_id"
  ], legacySourceHistoryRows, 60_000, "ON CONFLICT(legacy_id) WHERE legacy_id <> '' DO NOTHING");
  const archiveStatements = byteBatchedStatements("legacy_archive", [
    "category", "legacy_id", "payload_json", "created_at"
  ], archiveRows, 60_000, "ON CONFLICT(category, legacy_id) DO NOTHING");

  const parts = {
    core: await writeParts(output, "01-core", coreStatements),
    sessions: await writeParts(output, "02-sessions", sessionStatements),
    reviews: await writeParts(output, "03-reviews", reviewStatements),
    customer: await writeParts(output, "04-customer-state", customerStatements),
    // D1 limits each SQL statement independently. Larger upload parts avoid
    // paying Wrangler's remote-import startup cost hundreds of times.
    history: await writeParts(output, "05-listing-history", historyStatements, 5_000_000),
    sourceHistory: await writeParts(output, "06-source-history", sourceHistoryStatements, 5_000_000),
    archive: await writeParts(output, "07-legacy-archive", archiveStatements, 5_000_000)
  };
  const report = {
    generatedAt: new Date().toISOString(),
    baseline: { masters: baselineMasterIds.size, sources: baselineSourceIds.size },
    source: {
      masters: masters.size, originalRows: originalRowCount, relations: relationRows.length, linkedRelations: linkedRelations.length,
      reviewRelations: reviewRelations.length, reviews: restoredReviewRows.length,
      customers: customerDataRows.length, matches: customerMatchRows.length, activities: customerActivityRows.length,
      sessions: sessionRows.length - 1, cloudState: cloudRows.length - 1, announcements: announcementDataRows.length,
      buildings: buildingDataRows.length, listingHistory: historyRows.length - 1, sourceHistory: sourceHistoryRows.length - 1
    },
    recovery: {
      missingMasters: missingMasters.length, missingMasterIds: missingMasters.map(([id]) => id),
      missingLinkedSources: missingLinked.length, missingLinkedSourceIds: missingLinked.map((row) => clean(row[0])),
      linkedMedia: linkedMediaRows.length, linkedContacts: linkedContactRows.length,
      reviewRows: restoredReviewRows.length, reviewRowsWithoutOriginal: missingReviewOriginals.length,
      reviewRowsWithoutOriginalExamples: missingReviewOriginals.slice(0, 50),
      collectorSessions: collectorSessionRows.length, customerMatches: customerMatchRows.length,
      customerActivities: customerActivityRows.length, cloudState: cloudRows.length - 1,
      announcements: announcementDataRows.length, buildings: buildingDataRows.length,
      listingHistory: legacyHistoryRows.length, skippedListingHistory: skippedHistory,
      sourceHistory: legacySourceHistoryRows.length, skippedSourceHistory,
      archivedRows: archiveRows.length
    },
    parts: Object.fromEntries(Object.entries(parts).map(([key, paths]) => [key, paths.length]))
  };
  await writeFile(resolve(output, "recovery-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const [tabsDirectory, unifiedSnapshot, outputDirectory] = process.argv.slice(2);
  if (!tabsDirectory || !unifiedSnapshot || !outputDirectory) {
    console.error("Usage: node tools/prepare-full-legacy-recovery.mjs <tabs-dir> <unified.json> <output-dir>");
    process.exitCode = 1;
    return;
  }
  const report = await prepareFullLegacyRecovery({ tabsDirectory, unifiedSnapshot, outputDirectory });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
