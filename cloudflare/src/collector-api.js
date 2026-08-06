const COLLECTOR_ORIGINS = [
  /(^|\.)realty\.daangn\.com$/i,
  /(^|\.)fin\.land\.naver\.com$/i,
  /(^|\.)land\.naver\.com$/i,
  /(^|\.)gongsilbox\.com$/i
];

const ADMIN_GET_ACTIONS = new Set([
  "collectionStatus", "reviewWorkspace", "propertyTimeline"
]);

const ADMIN_POST_ACTIONS = new Set([
  "applyReviewBatch", "consolidateExistingMasters", "repairRoomlessExactReviews"
]);

const EXTERNAL_ACTIONS = new Set([
  "classifySourceManifest", "saveNaverBatch", "finalizeNaverSession", "getNaverSessionResult",
  "gongsilImportBatch", "finalizeCollectionSession", "mutationStatus",
  "danggeunStartJob", "danggeunResumeJob", "danggeunRunJobChunk", "danggeunPauseJob", "danggeunJobStatus"
]);

const DAANGN_GRAPHQL_URL = "https://realty.kr.karrotmarket.com/graphql";
const DAANGN_LIST_FIRST_HASH = "e0cdf7eab9f342cf735fb8951d9dc0b771418964e241bd59ed4bec84d43e019a";
const DAANGN_LIST_NEXT_HASH = "c0cf343435add09c37d248748eb3762cc86e4be4b5349ae60b2e080cccc4d3c5";
const DAANGN_DETAIL_HASH = "d374a65ffef31da412d7233ee4740a5379554196b1adf1a08d861048c952d108";
const DAANGN_JOB_ID = "collector-daangn-active";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinate(value, minimum, maximum) {
  const parsed = number(value);
  return parsed != null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sourceName(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("naver") || text.includes("네이버")) return "네이버";
  if (text.includes("gongsil") || text.includes("공실")) return "공실박스";
  if (text.includes("daangn") || text.includes("danggeun") || text.includes("당근")) return "당근";
  return clean(value).slice(0, 40);
}

function normalizedAddress(value) {
  return clean(value)
    .replace(/^대한민국\s+/, "")
    .replace(/^(?:대전광역시|대전시)\s+/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedRoom(value) {
  return clean(value).replace(/\s+/g, "").replace(/(층|호실)$/g, (match) => match === "호실" ? "호" : match);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value == null ? null : value);
}

function snapshotKey(value) {
  const text = typeof value === "string" ? value : stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sourceIdFor(source, value) {
  let id = clean(value).slice(0, 160);
  if (source === "네이버" && id && !id.startsWith("네이버-")) id = `네이버-${id}`;
  return id;
}

function uniqueUrls(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const url = clean(raw && typeof raw === "object" ? raw.url || raw.watermark || raw.thumbnail : raw);
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    output.push(url);
    if (output.length >= 40) break;
  }
  return output;
}

function memoWithVisit(value) {
  const memo = clean(value).replace(/^@?\s*\(임장가자\)\s*/i, "").replace(/\s+/g, " ");
  return `(임장가자)${memo ? ` ${memo}` : ""}`.slice(0, 1500);
}

function gongsilRecord(record) {
  const values = Array.isArray(record?.values) ? record.values : [];
  const sourceId = clean(record?.externalId || record?.sourceId || record?.id);
  const contacts = Array.isArray(record?.contactList) ? record.contactList.map((entry) => ({
    role: clean(entry?.role || entry?.type),
    name: clean(entry?.name),
    phone: clean(entry?.phone || entry?.tel || entry?.number)
  })).filter((entry) => entry.phone) : [];
  if (clean(values[9])) contacts.push({ role: "임대인", name: "", phone: clean(values[9]) });
  if (clean(values[10])) contacts.push({ role: "임차인", name: "", phone: clean(values[10]) });
  const images = uniqueUrls(record?.imageUrls || []);
  if (clean(record?.primaryImage) && !images.includes(clean(record.primaryImage))) images.unshift(clean(record.primaryImage));
  return {
    source: "공실박스", sourceId, buildingName: clean(values[0]) || clean(record?.buildingName),
    address: normalizedAddress(values[1] || record?.address), room: clean(values[2] || record?.room),
    category: clean(values[3] || record?.category) || "상가점포", deposit: number(values[4] ?? record?.deposit),
    rent: number(values[5] ?? record?.rent), fee: number(values[6] ?? record?.fee),
    premium: number(values[7] ?? record?.premium), area: number(values[8] ?? record?.area),
    memo: memoWithVisit(values[11] || record?.memo), link: clean(record?.url || record?.sourceUrl),
    listSnapshot: clean(record?.listSnapshot), images, contacts, raw: record?.raw || record
  };
}

function naverRecord(item) {
  const sourceId = sourceIdFor("네이버", item?.articleNo || item?.articleNumber || item?.sourceId);
  const images = uniqueUrls(item?.imageUrls || item?.images || []);
  if (clean(item?.primaryImage) && !images.includes(clean(item.primaryImage))) images.unshift(clean(item.primaryImage));
  const squareMeters = number(item?.areaSquareMeter);
  return {
    source: "네이버", sourceId, buildingName: clean(item?.buildingName) || "일반상가",
    address: normalizedAddress(item?.jibunAddress || item?.address),
    room: clean(item?.roomInfo || item?.floorInfo), category: clean(item?.category) || "상가점포",
    deposit: number(item?.deposit), rent: number(item?.monthly), fee: number(item?.managementFee || item?.fee),
    premium: number(item?.premium), area: squareMeters && squareMeters > 0
      ? Math.round((squareMeters / 3.305785) * 10) / 10 : number(item?.area),
    memo: memoWithVisit(item?.description),
    link: clean(item?.sourceLink || item?.providerUrl || item?.currentUrl) ||
      (sourceId ? `https://fin.land.naver.com/articles/${sourceId.replace(/^네이버-/, "")}` : ""),
    listSnapshot: clean(item?.listSnapshot), images, contacts: [], raw: item,
    latitude: coordinate(item?.latitude ?? item?.lat ?? item?.mapY, -90, 90),
    longitude: coordinate(item?.longitude ?? item?.lng ?? item?.lon ?? item?.mapX, -180, 180)
  };
}

function daangnFloor(value) {
  const text = clean(value);
  if (!text) return "";
  if (/층$|호$|^전체$/.test(text)) return text;
  if (/^B\d+$/i.test(text) || /^-?\d+(?:\.\d+)?$/.test(text) || /^(저|중|고)$/.test(text)) return `${text}층`;
  return text;
}

function daangnAddress(article) {
  const candidates = [article?.publicJibunAddress];
  const edges = article?.complex?.buildingsForAddress?.edges || [];
  for (const edge of edges) candidates.push(edge?.node?.jibunAddress);
  for (const candidate of candidates) {
    const text = normalizedAddress(candidate);
    const match = text.match(/((?:[가-힣]+(?:시|군|구)\s+)?[가-힣0-9·.]+(?:읍|면|동|가)\s+(?:산\s*)?\d+(?:-\d+)?)/);
    if (match) return normalizedAddress(match[1]);
  }
  return "";
}

function daangnRecord(article, listSnapshot = "") {
  const trade = (Array.isArray(article?.trades) ? article.trades : []).find((entry) => entry?.preferred) || article?.trades?.[0] || {};
  const tradeType = clean(trade.type || trade.__typename).toUpperCase();
  const salesType = clean(article?.salesTypeV3?.type || article?.salesTypeV3?.__typename).toUpperCase();
  const areaM2 = number(article?.area);
  const images = uniqueUrls([...(article?.images || []), ...(article?.floorPlanImages || [])]);
  const sourceId = clean(article?.originalId);
  const optionText = (article?.options || []).some((option) => option?.name === "PARKING" && clean(option?.value).toUpperCase() === "YES")
    ? "주차가능 · " : "";
  const description = [article?.addressInfo, article?.content].filter(Boolean).join(" ").replace(/\s+/g, " ");
  return {
    source: "당근", sourceId,
    buildingName: clean(article?.buildingName || article?.complex?.name) || "일반상가",
    address: daangnAddress(article),
    room: article?.isEntireBuilding ? "전체" : daangnFloor(article?.isAmbiguousFloor ? article?.ambiguousFloor : article?.floor),
    category: /OFFICE/.test(salesType) ? "사무실" : /FACTORY/.test(salesType) ? "공장/창고" : "상가점포",
    deposit: number(trade?.deposit ?? trade?.price), rent: number(trade?.monthlyPay ?? trade?.yearlyPay) || 0,
    fee: number(article?.totalManageCost) || 0, premium: number(article?.premiumMoney) || 0,
    area: areaM2 && areaM2 > 0 ? Math.floor((areaM2 / 3.305785) * 10 + 0.0000001) / 10 : null,
    memo: memoWithVisit(`${optionText}${description}`.slice(0, 1200)),
    link: sourceId ? `https://realty.daangn.com/?article_id=%22${encodeURIComponent(sourceId)}%22&panel_stack=article` : "",
    listSnapshot: clean(listSnapshot), images, contacts: [], raw: article,
    tradeType: /MONTH/.test(tradeType) ? "월세" : /YEAR|BORROW/.test(tradeType) ? "전세" : /BUY/.test(tradeType) ? "매매" : "월세"
  };
}

function normalizedRecord(source, value) {
  if (source === "네이버") return naverRecord(value);
  if (source === "공실박스") return gongsilRecord(value);
  if (source === "당근") return value?.source === "당근" ? value : daangnRecord(value, value?.listSnapshot);
  return null;
}

function unifiedSnapshot(record, originalId, propertyId, now) {
  return {
    originalId, source: record.source, sourceId: record.sourceId, propertyId,
    link: record.link, buildingName: record.buildingName, address: record.address, room: record.room,
    type: record.category, deposit: record.deposit, rent: record.rent, fee: record.fee,
    premium: record.premium, area: record.area, latitude: record.latitude, longitude: record.longitude,
    memo: record.memo, status: "활성",
    firstSeen: now, lastSeen: now, thumbnail: record.images[0] || "",
    photoCount: record.images.length, contactCount: record.contacts.length, revision: 1
  };
}

function sameNumber(left, right, tolerance = 0) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function sameManifestEntry(entry, row) {
  if (!row) return false;
  const saved = parseJson(row.list_snapshot_json, {});
  if (row.snapshot_hash && row.snapshot_hash === snapshotKey(entry.listSnapshot || entry)) return true;
  return sameNumber(number(entry.deposit), number(saved.deposit)) &&
    sameNumber(number(entry.rent), number(saved.rent)) &&
    sameNumber(number(entry.area), number(saved.area), 0.15) &&
    normalizedRoom(entry.room) === normalizedRoom(saved.room) &&
    (!clean(entry.address) || normalizedAddress(entry.address) === normalizedAddress(saved.address));
}

async function ensureSession(env, sessionId, source, owner = "collector") {
  const id = clean(sessionId) || `${source}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO collector_sessions (id, source, owner_email, state, totals_json, started_at, updated_at)
    VALUES (?1, ?2, ?3, 'running', '{}', ?4, ?4)
    ON CONFLICT(id) DO UPDATE SET source=excluded.source, state=CASE WHEN collector_sessions.state='completed' THEN collector_sessions.state ELSE 'running' END,
      updated_at=excluded.updated_at`).bind(id, source, owner, now).run();
  return id;
}

async function saveMutationResult(env, requestId, action, result, owner = "collector") {
  const id = clean(requestId).slice(0, 160);
  if (!id) return;
  await env.DB.prepare(`INSERT INTO mutation_results (request_id, owner_email, action, state, result_json, created_at, expires_at)
    VALUES (?1, ?2, ?3, 'completed', ?4, ?5, datetime('now','+7 days'))
    ON CONFLICT(request_id) DO UPDATE SET state='completed', result_json=excluded.result_json`)
    .bind(id, owner, action, JSON.stringify(result || {}), nowIso()).run();
}

async function mutationStatus(env, requestId) {
  const row = await env.DB.prepare("SELECT state, result_json FROM mutation_results WHERE request_id=?1")
    .bind(clean(requestId).slice(0, 160)).first();
  if (!row) return { ok: true, ready: false, requestId: clean(requestId) };
  return { ok: true, ready: row.state === "completed", requestId: clean(requestId), result: parseJson(row.result_json, {}) };
}

async function classifyManifest(env, body) {
  const source = sourceName(body.source);
  const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 3_000).map((entry) => ({
    ...entry, sourceId: sourceIdFor(source, entry?.sourceId)
  })).filter((entry) => entry.sourceId);
  const sessionId = await ensureSession(env, body.sessionId, source);
  const rows = new Map();
  for (let offset = 0; offset < entries.length; offset += 80) {
    const ids = entries.slice(offset, offset + 80).map((entry) => entry.sourceId);
    const placeholders = ids.map((_, index) => `?${index + 2}`).join(",");
    const result = await env.DB.prepare(`SELECT s.source_listing_id, s.snapshot_hash, s.list_snapshot_json,
        s.listing_id, l.latitude AS listing_latitude, l.longitude AS listing_longitude
      FROM listing_sources s LEFT JOIN listings l ON l.id=s.listing_id
      WHERE s.source=?1 AND s.source_listing_id IN (${placeholders})`).bind(source, ...ids).all();
    for (const row of result?.results || []) rows.set(clean(row.source_listing_id), row);
  }
  const needsDetail = [];
  const coordinateRepairs = new Map();
  const cacheRepairs = new Map();
  let unchanged = 0;
  let changed = 0;
  let unknown = 0;
  for (const entry of entries) {
    const row = rows.get(entry.sourceId);
    const latitude = coordinate(entry.latitude, -90, 90);
    const longitude = coordinate(entry.longitude, -180, 180);
    if (row?.listing_id && latitude != null && longitude != null &&
        (number(row.listing_latitude) == null || number(row.listing_longitude) == null)) {
      coordinateRepairs.set(clean(row.listing_id), { latitude, longitude });
      const address = normalizedAddress(entry.address);
      if (address) cacheRepairs.set(address, { latitude, longitude, sourceId: entry.sourceId });
    }
    if (!row) {
      unknown += 1;
      needsDetail.push(entry.sourceId);
    } else if (sameManifestEntry(entry, row)) {
      unchanged += 1;
    } else {
      changed += 1;
      needsDetail.push(entry.sourceId);
    }
  }
  if (coordinateRepairs.size || cacheRepairs.size) {
    const repairedAt = nowIso();
    const statements = [];
    for (const [listingId, location] of coordinateRepairs) {
      statements.push(env.DB.prepare(`UPDATE listings SET latitude=?1, longitude=?2, updated_at=?3
        WHERE id=?4 AND (latitude IS NULL OR longitude IS NULL)`)
        .bind(location.latitude, location.longitude, repairedAt, listingId));
    }
    for (const [address, location] of cacheRepairs) {
      statements.push(env.DB.prepare(`INSERT INTO geocode_cache (
          cache_key, address, latitude, longitude, provider, payload_json, checked_at
        ) VALUES (?1, ?1, ?2, ?3, 'naver', ?4, ?5)
        ON CONFLICT(cache_key) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude,
          provider='naver', payload_json=excluded.payload_json, checked_at=excluded.checked_at`)
        .bind(address, location.latitude, location.longitude,
          JSON.stringify({ source: "naver-manifest", sourceId: location.sourceId }), repairedAt));
    }
    await env.DB.batch(statements);
  }
  const result = { ok: true, action: "classifySourceManifest", source, sessionId, received: entries.length,
    needsDetail, unchanged, changed, unknown, coordinatesRepaired: coordinateRepairs.size, sourceBackend: "D1" };
  await env.DB.prepare("UPDATE collector_sessions SET totals_json=?1, updated_at=?2 WHERE id=?3")
    .bind(JSON.stringify({ manifest: entries.length, unchanged, changed, unknown,
      coordinatesRepaired: coordinateRepairs.size }), nowIso(), sessionId).run();
  return result;
}

async function candidateListings(env, record) {
  if (!record.address) return [];
  const result = await env.DB.prepare(`SELECT id, property_id, title, address, room, listing_type,
      deposit, monthly_rent, maintenance_fee, premium, area_m2, operating_memo, main_source
    FROM listings WHERE status <> 'deleted' AND address=?1
    ORDER BY updated_at DESC LIMIT 20`).bind(record.address).all();
  return result?.results || [];
}

function exactCandidate(record, candidates) {
  const exact = candidates.filter((row) =>
    normalizedRoom(row.room) === normalizedRoom(record.room) &&
    sameNumber(number(row.deposit), record.deposit) &&
    sameNumber(number(row.monthly_rent), record.rent) &&
    sameNumber(number(row.area_m2), record.area, 0.8)
  );
  return exact.length === 1 ? exact[0] : null;
}

async function replaceMediaAndContacts(env, record, sourceRowId, listingId, now) {
  const statements = [
    env.DB.prepare("DELETE FROM listing_media WHERE source_id=?1").bind(sourceRowId),
    env.DB.prepare("DELETE FROM listing_contacts WHERE source_id=?1").bind(sourceRowId)
  ];
  record.images.forEach((url, index) => statements.push(env.DB.prepare(`INSERT INTO listing_media (
      id, listing_id, source_id, media_type, sort_order, external_url, status, checked_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 'image', ?4, ?5, 'external', ?6, ?6, ?6)`)
    .bind(`IMG-${crypto.randomUUID()}`, listingId, sourceRowId, index, url, now)));
  const seenPhones = new Set();
  record.contacts.forEach((contact) => {
    const normalizedPhone = clean(contact.phone).replace(/\D/g, "");
    if (!normalizedPhone || seenPhones.has(`${clean(contact.role)}:${normalizedPhone}`)) return;
    seenPhones.add(`${clean(contact.role)}:${normalizedPhone}`);
    statements.push(env.DB.prepare(`INSERT INTO listing_contacts (
        id, listing_id, source_id, role, name, phone, normalized_phone, status, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8, ?8, ?8)`)
      .bind(`C-${crypto.randomUUID()}`, listingId, sourceRowId, clean(contact.role), clean(contact.name), clean(contact.phone), normalizedPhone, now));
  });
  await env.DB.batch(statements);
}

async function attachSource(env, record, listingId, sessionId, existingSource = null, updateCondition = false, actor = "collector") {
  const now = nowIso();
  const restoredOriginalId = /^O-[A-Za-z0-9_-]{8,160}$/.test(clean(record?.originalId))
    ? clean(record.originalId)
    : "";
  const sourceRowId = clean(existingSource?.id) || restoredOriginalId || `O-${crypto.randomUUID()}`;
  const previous = existingSource ? parseJson(existingSource.list_snapshot_json, {}) : null;
  const snapshot = unifiedSnapshot(record, sourceRowId, listingId, now);
  const snapshotHash = snapshotKey(record.listSnapshot || snapshot);
  await env.DB.prepare(`INSERT INTO listing_sources (
      id, listing_id, source, source_listing_id, source_url, snapshot_hash, list_snapshot_json, raw_json,
      session_id, active, missing_count, first_collected_at, last_collected_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 0, ?10, ?10, ?10, ?10)
    ON CONFLICT(source, source_listing_id) DO UPDATE SET listing_id=excluded.listing_id,
      source_url=excluded.source_url, snapshot_hash=excluded.snapshot_hash,
      list_snapshot_json=excluded.list_snapshot_json, raw_json=excluded.raw_json,
      session_id=excluded.session_id, active=1, missing_count=0,
      last_collected_at=excluded.last_collected_at, updated_at=excluded.updated_at`)
    .bind(sourceRowId, listingId, record.source, record.sourceId, record.link, snapshotHash,
      JSON.stringify(snapshot), JSON.stringify(record.raw || {}), sessionId, now).run();
  await replaceMediaAndContacts(env, record, sourceRowId, listingId, now);
  const update = updateCondition
    ? env.DB.prepare(`UPDATE listings SET title=CASE WHEN ?1<>'' THEN ?1 ELSE title END,
        building_name=CASE WHEN ?1<>'' THEN ?1 ELSE building_name END, room=?2, listing_type=?3,
        deposit=?4, monthly_rent=?5, maintenance_fee=?6, premium=?7, area_m2=?8,
        operating_memo=CASE WHEN ?9<>'' THEN ?9 ELSE operating_memo END,
        source_url=CASE WHEN source_url='' THEN ?10 ELSE source_url END,
        latitude=CASE WHEN ?11 IS NOT NULL THEN ?11 ELSE latitude END,
        longitude=CASE WHEN ?12 IS NOT NULL THEN ?12 ELSE longitude END,
        version=version+1, last_collected_at=?13, updated_at=?13 WHERE id=?14`)
      .bind(record.buildingName, record.room, record.category, record.deposit, record.rent, record.fee,
        record.premium, record.area, record.memo, record.link, record.latitude, record.longitude, now, listingId)
    : env.DB.prepare(`UPDATE listings SET last_collected_at=?1, updated_at=?1,
        source_url=CASE WHEN source_url='' THEN ?2 ELSE source_url END,
        latitude=CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE latitude END,
        longitude=CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE longitude END WHERE id=?5`)
      .bind(now, record.link, record.latitude, record.longitude, listingId);
  await env.DB.batch([
    update,
    env.DB.prepare(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(listingId, sourceRowId,
        existingSource ? "sourceUpdated" : "sourceMerged", actor, JSON.stringify(previous || {}), JSON.stringify(snapshot))
  ]);
  return sourceRowId;
}

async function createListing(env, record, sessionId, actor = "collector") {
  const id = `M-${crypto.randomUUID()}`;
  const now = nowIso();
  const contacts = JSON.stringify(record.contacts);
  await env.DB.prepare(`INSERT INTO listings (
      id, property_id, status, main_source, title, address, building_name, room, listing_type,
      deposit, monthly_rent, maintenance_fee, premium, area_m2, latitude, longitude, operating_memo, source_url,
      contacts_json, first_collected_at, registration_at, last_collected_at, created_at, updated_at
    ) VALUES (?1, ?1, 'active', ?2, ?3, ?4, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
      ?16, ?17, ?17, ?17, ?17, ?17)`)
    .bind(id, record.source, record.buildingName || "일반상가", record.address, record.room, record.category,
      record.deposit, record.rent, record.fee, record.premium, record.area, record.latitude, record.longitude,
      record.memo, record.link, contacts, now).run();
  await attachSource(env, record, id, sessionId, null, false, actor);
  await env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
    VALUES (?1, 'collectorCreated', ?2, '{}', ?3)`).bind(id, actor, JSON.stringify(record)).run();
  return id;
}

async function queueReview(env, record, sessionId, candidates) {
  const reviewId = `R-${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json, processing_state, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'review', ?7, ?8)
    ON CONFLICT(session_id, source, source_listing_id) DO UPDATE SET
      snapshot_hash=excluded.snapshot_hash, payload_json=excluded.payload_json,
      processing_state='review', result_json=excluded.result_json, error_text=''`)
    .bind(reviewId, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(record), JSON.stringify({ candidateIds: candidates.map((row) => row.id) }), nowIso()).run();
  return reviewId;
}

async function ingestRecords(env, source, values, metadata = {}) {
  const sessionId = await ensureSession(env, metadata.sessionId, source);
  const totals = { received: 0, created: 0, merged: 0, updated: 0, review: 0, duplicate: 0, failed: 0 };
  for (const value of values) {
    totals.received += 1;
    try {
      const record = normalizedRecord(source, value);
      if (!record?.sourceId || !record.address) {
        totals.failed += 1;
        continue;
      }
      const existing = await env.DB.prepare(`SELECT id, listing_id, snapshot_hash, list_snapshot_json
        FROM listing_sources WHERE source=?1 AND source_listing_id=?2 LIMIT 1`)
        .bind(source, record.sourceId).first();
      if (existing?.listing_id) {
        const before = parseJson(existing.list_snapshot_json, {});
        const changed = !sameManifestEntry({
          listSnapshot: record.listSnapshot, deposit: record.deposit, rent: record.rent,
          area: record.area, room: record.room, address: record.address
        }, existing);
        await attachSource(env, record, existing.listing_id, sessionId, existing, false);
        if (changed) totals.updated += 1;
        else if (before.photoCount !== record.images.length || before.contactCount !== record.contacts.length) totals.updated += 1;
        else totals.duplicate += 1;
        continue;
      }
      const candidates = await candidateListings(env, record);
      const exact = exactCandidate(record, candidates);
      if (exact) {
        await attachSource(env, record, exact.id, sessionId);
        totals.merged += 1;
      } else if (!candidates.length) {
        await createListing(env, record, sessionId);
        totals.created += 1;
      } else {
        await queueReview(env, record, sessionId, candidates);
        totals.review += 1;
      }
    } catch (error) {
      totals.failed += 1;
    }
  }
  const previous = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const saved = parseJson(previous?.totals_json, {});
  for (const key of ["received", "created", "merged", "updated", "review", "duplicate", "failed"]) {
    saved[key] = Number(saved[key] || 0) + Number(totals[key] || 0);
  }
  await env.DB.prepare("UPDATE collector_sessions SET totals_json=?1, updated_at=?2 WHERE id=?3")
    .bind(JSON.stringify(saved), nowIso(), sessionId).run();
  return { ok: true, sessionId, ...totals,
    saved: totals.created + totals.merged + totals.updated,
    inserted: totals.created + totals.merged + totals.updated, sourceBackend: "D1" };
}

export function nextCollectorSourceVisibilityState(current, observed, countMissing) {
  const active = Number(current?.active) !== 0;
  const missingCount = Math.max(0, Number(current?.missingCount ?? current?.missing_count) || 0);
  if (observed) return { active: 1, missingCount: 0 };
  if (!countMissing || !active) return { active: active ? 1 : 0, missingCount };
  const nextMissingCount = missingCount + 1;
  return { active: nextMissingCount >= 3 ? 0 : 1, missingCount: nextMissingCount };
}

async function finalizeSession(env, body) {
  const source = sourceName(body.source);
  const sessionId = await ensureSession(env, body.sessionId, source);
  const complete = Boolean(body.complete) && !body.stopped;
  const state = body.stopped ? "paused" : complete ? "completed" : "partial";
  const observed = [...new Set((Array.isArray(body.observedSourceIds) ? body.observedSourceIds : [])
    .map((id) => sourceIdFor(source, id)).filter(Boolean))];
  let presenceReset = 0;
  let missingMarked = 0;
  let deactivated = 0;
  const scope = clean(body.scope);
  const districtMatch = scope.match(/(동구|중구|서구|유성구|대덕구)/);
  const tracksMissing = complete && observed.length >= 100 &&
    /전체|완전수집/.test(`${scope} ${clean(body.note)}`);
  if (tracksMissing) {
    const observedSet = new Set(observed);
    const rows = await env.DB.prepare(`SELECT s.id, s.source_listing_id, s.active, s.missing_count, l.address
      FROM listing_sources s LEFT JOIN listings l ON l.id=s.listing_id
      WHERE s.source=?1`).bind(source).all();
    const changes = [];
    const changedAt = nowIso();
    for (const row of rows?.results || []) {
      if (observedSet.has(clean(row.source_listing_id))) {
        if (Number(row.active) === 1 && Number(row.missing_count || 0) === 0) continue;
        changes.push(env.DB.prepare(`UPDATE listing_sources SET active=1, missing_count=0,
          last_collected_at=?1, updated_at=?1 WHERE id=?2`).bind(changedAt, row.id));
        presenceReset += 1;
        continue;
      }
      if (districtMatch && !clean(row.address).startsWith(districtMatch[1])) continue;
      if (Number(row.active) !== 1) continue;
      const nextState = nextCollectorSourceVisibilityState(row, false, true);
      const nextMissing = nextState.missingCount;
      changes.push(env.DB.prepare(`UPDATE listing_sources SET missing_count=?1,
        active=?2, updated_at=?3 WHERE id=?4`)
        .bind(nextMissing, nextState.active, changedAt, row.id));
      missingMarked += 1;
      if (!nextState.active) deactivated += 1;
    }
    for (let offset = 0; offset < changes.length; offset += 80) await env.DB.batch(changes.slice(offset, offset + 80));
  } else if (observed.length) {
    const seenAt = nowIso();
    for (let offset = 0; offset < observed.length; offset += 75) {
      const ids = observed.slice(offset, offset + 75);
      const placeholders = ids.map((_, index) => `?${index + 3}`).join(",");
      const result = await env.DB.prepare(`UPDATE listing_sources SET active=1, missing_count=0,
        last_collected_at=?1, updated_at=?1
        WHERE source=?2 AND source_listing_id IN (${placeholders})
          AND (active=0 OR missing_count<>0)`).bind(seenAt, source, ...ids).run();
      presenceReset += Number(result?.meta?.changes || 0);
    }
  }
  const row = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const totals = parseJson(row?.totals_json, {});
  totals.observed = observed.length;
  totals.presenceReset = presenceReset;
  totals.missingMarked = missingMarked;
  totals.deactivated = deactivated;
  totals.note = clean(body.note);
  await env.DB.prepare(`UPDATE collector_sessions SET state=?1, totals_json=?2,
    finished_at=CASE WHEN ?1 IN ('completed','partial') THEN ?3 ELSE finished_at END, updated_at=?3 WHERE id=?4`)
    .bind(state, JSON.stringify(totals), nowIso(), sessionId).run();
  return { ok: true, action: "finalizeCollectionSession", sessionId, state, complete,
    observed: observed.length, presenceReset, missingMarked, deactivated, ...totals, sourceBackend: "D1" };
}

function collectorHostAllowed(request) {
  const origin = clean(request.headers.get("origin"));
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return COLLECTOR_ORIGINS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

function collectorCors(request) {
  const origin = clean(request.headers.get("origin"));
  return collectorHostAllowed(request) && origin
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type", vary: "Origin" }
    : {};
}

function validCollectorKey(env, value) {
  const expected = clean(env.COLLECTOR_ACCESS_KEY);
  return Boolean(expected && clean(value) && expected === clean(value));
}

function jsonResponse(value, status, headers = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function jsonpResponse(callback, value, headers = {}) {
  const safe = clean(callback).replace(/[^A-Za-z0-9_$\.]/g, "").slice(0, 120);
  if (!safe) return jsonResponse(value, 200, headers);
  return new Response(`${safe}(${JSON.stringify(value)});`, {
    status: 200, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

async function daangnGraphql(hash, variables) {
  const response = await fetch(DAANGN_GRAPHQL_URL, {
    method: "POST",
    headers: {
      accept: "application/json", "content-type": "application/json",
      origin: "https://realty.daangn.com", referer: "https://realty.daangn.com/"
    },
    body: JSON.stringify({ variables: variables || {}, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`당근 API HTTP 오류: ${response.status}`);
  if (payload.errors?.length) throw new Error(`당근 API 오류: ${payload.errors.map((entry) => entry?.message || "알 수 없는 오류").join(" / ")}`);
  return payload;
}

function parseDaangnUrl(value) {
  const url = new URL(clean(value).replace(/&amp;/g, "&"));
  const clusterId = clean(url.searchParams.get("cluster_id")).replace(/^['"]|['"]$/g, "");
  if (!clusterId) throw new Error("URL에서 cluster_id를 찾지 못했습니다.");
  let propertyFilter = { salesTypes: ["STORE", "OFFICE", "FACTORY"] };
  try {
    const parsed = JSON.parse(url.searchParams.get("af") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) propertyFilter = parsed;
  } catch {}
  if (!Array.isArray(propertyFilter.salesTypes) || !propertyFilter.salesTypes.length) {
    propertyFilter.salesTypes = ["STORE", "OFFICE", "FACTORY"];
  }
  const district = ["동구", "중구", "서구", "유성구", "대덕구"].find((name) => decodeURIComponent(url.toString()).includes(name)) || "";
  return { url: url.toString(), clusterId, propertyFilter, district };
}

function daangnListEntry(article) {
  const record = daangnRecord(article, "");
  const projection = {};
  Object.keys(article || {}).sort().forEach((key) => {
    if (/(?:address|jibun|floor|trade|price|deposit|rent|manage|premium|area|sales|title|name|status|desc)/i.test(key)) {
      const value = article[key];
      if (value != null && typeof value !== "function") projection[key] = value;
    }
  });
  const listSnapshot = stableJson(projection);
  return { sourceId: record.sourceId, listSnapshot, deposit: record.deposit, rent: record.rent,
    area: record.area, address: record.address, room: record.room };
}

async function loadDaangnJob(env) {
  const row = await env.DB.prepare("SELECT state, payload_json, progress_json, updated_at FROM jobs WHERE id=?1")
    .bind(DAANGN_JOB_ID).first();
  if (!row) return null;
  const payload = parseJson(row.payload_json, {});
  const progress = parseJson(row.progress_json, {});
  return { ...payload, ...progress, status: row.state === "completed" ? "complete" : row.state, updatedAt: row.updated_at };
}

async function saveDaangnJob(env, job) {
  const state = job.status === "complete" ? "completed" : job.status;
  const payload = {
    url: job.url, clusterId: job.clusterId, propertyFilter: job.propertyFilter,
    district: job.district, sessionId: job.sessionId, ids: job.ids || [], entries: job.entries || [],
    detailIds: job.detailIds || [], cursor: job.cursor || "", hasNextPage: Boolean(job.hasNextPage)
  };
  const progress = { ...job };
  delete progress.ids;
  delete progress.entries;
  delete progress.detailIds;
  delete progress.propertyFilter;
  delete progress.clusterId;
  delete progress.cursor;
  delete progress.hasNextPage;
  await env.DB.prepare(`INSERT INTO jobs (
      id, job_type, owner_email, state, priority, payload_json, progress_json, attempts, available_at, created_at, updated_at
    ) VALUES (?1, 'daangn-collector', 'collector', ?2, 20, ?3, ?4, 0, ?5, ?5, ?5)
    ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload_json=excluded.payload_json,
      progress_json=excluded.progress_json, updated_at=excluded.updated_at`)
    .bind(DAANGN_JOB_ID, state, JSON.stringify(payload), JSON.stringify(progress), nowIso()).run();
}

function publicDaangnJob(job) {
  if (!job) return null;
  const output = { ...job };
  delete output.ids;
  delete output.entries;
  delete output.detailIds;
  delete output.propertyFilter;
  delete output.clusterId;
  delete output.cursor;
  delete output.hasNextPage;
  return output;
}

async function startDaangnJob(env, body) {
  const parsed = parseDaangnUrl(body.url);
  const sessionId = await ensureSession(env, `DAANGN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, "당근");
  const job = {
    ...parsed, sessionId, ids: [], entries: [], detailIds: [], cursor: "", hasNextPage: true,
    phase: "list", status: "running", page: 0, found: 0, total: 0, processed: 0, remaining: 0,
    created: 0, merged: 0, updated: 0, review: 0, detailedDuplicates: 0,
    skippedUnchanged: 0, addressMissing: 0, failed: 0, chunkSize: 20,
    message: "클러스터 목록을 확인하고 있습니다."
  };
  await saveDaangnJob(env, job);
  return { ok: true, job: publicDaangnJob(job), sourceBackend: "D1" };
}

async function runDaangnChunk(env) {
  const job = await loadDaangnJob(env);
  if (!job) throw new Error("이어갈 당근 수집 작업이 없습니다.");
  if (job.status !== "running") return { ok: true, job: publicDaangnJob(job) };
  const chunkStarted = Date.now();
  if (job.phase === "list") {
    const seen = new Set(job.ids || []);
    for (let step = 0; step < 4 && job.hasNextPage; step += 1) {
      const payload = await daangnGraphql(job.page === 0 ? DAANGN_LIST_FIRST_HASH : DAANGN_LIST_NEXT_HASH, {
        first: 100, after: job.cursor || null,
        input: { clusterId: job.clusterId, propertyFilter: job.propertyFilter }
      });
      const connection = payload?.data?.articleByClusterId;
      if (!connection) throw new Error("당근 클러스터 목록 응답 형식이 변경되었습니다.");
      for (const edge of connection.edges || []) {
        const article = edge?.node?.article;
        const id = clean(article?.originalId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        job.ids.push(id);
        job.entries.push(daangnListEntry(article));
      }
      job.page += 1;
      job.cursor = clean(connection.pageInfo?.endCursor);
      job.hasNextPage = Boolean(connection.pageInfo?.hasNextPage && job.cursor);
    }
    job.found = job.ids.length;
    job.remaining = job.ids.length;
    if (!job.hasNextPage) {
      const classification = await classifyManifest(env, {
        source: "당근", sessionId: job.sessionId, scope: job.district ? `대전 ${job.district} 완전수집` : "당근 선택클러스터",
        entries: job.entries
      });
      const needed = new Set(classification.needsDetail || []);
      job.detailIds = job.ids.filter((id) => needed.has(id));
      job.skippedUnchanged = Number(classification.unchanged || 0);
      job.total = job.detailIds.length;
      job.remaining = job.total;
      job.phase = job.total ? "details" : "complete";
      if (!job.total) job.status = "complete";
      job.message = job.total ? `전체 ${job.found}개 중 신규·변경 ${job.total}개를 상세 저장합니다.` : "변경된 매물이 없습니다.";
    } else {
      job.message = `${job.page}페이지 · ${job.found}개 목록 확인`;
    }
  } else if (job.phase === "details") {
    const ids = (job.detailIds || []).slice(job.processed, job.processed + 20);
    const fetchStarted = Date.now();
    const responses = await Promise.all(ids.map(async (id) => {
      try {
        const payload = await daangnGraphql(DAANGN_DETAIL_HASH, { articleId: String(id) });
        return payload?.data?.articleByOriginalArticleId || null;
      } catch {
        return null;
      }
    }));
    job.lastFetchMs = Date.now() - fetchStarted;
    const records = responses.map((article, index) => article
      ? { ...daangnRecord(article, job.entries.find((entry) => entry.sourceId === ids[index])?.listSnapshot || ""), source: "당근" }
      : null).filter(Boolean);
    job.failed += ids.length - records.length;
    job.addressMissing += records.filter((record) => !record.address).length;
    const writeStarted = Date.now();
    const result = await ingestRecords(env, "당근", records, { sessionId: job.sessionId });
    job.lastWriteMs = Date.now() - writeStarted;
    job.created += Number(result.created || 0);
    job.merged += Number(result.merged || 0);
    job.updated += Number(result.updated || 0);
    job.review += Number(result.review || 0);
    job.detailedDuplicates += Number(result.duplicate || 0);
    job.failed += Number(result.failed || 0);
    job.processed += ids.length;
    job.remaining = Math.max(0, job.total - job.processed);
    job.lastChunkSize = ids.length;
    if (job.processed >= job.total) {
      const observedSourceIds = job.ids || [];
      await finalizeSession(env, {
        source: "당근", sessionId: job.sessionId,
        scope: job.district ? `대전 ${job.district} 완전수집` : "당근 선택클러스터",
        complete: Boolean(job.district), observedSourceIds,
        note: job.district ? "구 완전수집 완료" : "선택클러스터 수집 완료"
      });
      job.phase = "complete";
      job.status = "complete";
      job.message = `전체 ${job.found}개 확인 · ${job.processed}개 상세 처리 완료`;
    } else {
      job.message = `${job.processed} / ${job.total}개 상세 처리`;
    }
  }
  job.lastChunkMs = Date.now() - chunkStarted;
  await saveDaangnJob(env, job);
  return { ok: true, job: publicDaangnJob(job), sourceBackend: "D1" };
}

async function executeExternalAction(env, body) {
  const action = clean(body.action);
  if (action === "classifySourceManifest") return classifyManifest(env, body);
  if (action === "saveNaverBatch") return ingestRecords(env, "네이버", Array.isArray(body.data) ? body.data.slice(0, 250) : [], body);
  if (action === "gongsilImportBatch") return ingestRecords(env, "공실박스", Array.isArray(body.records) ? body.records.slice(0, 400) : [], body);
  if (action === "finalizeNaverSession" || action === "finalizeCollectionSession") return finalizeSession(env, body);
  if (action === "getNaverSessionResult") {
    const row = await env.DB.prepare("SELECT state, totals_json, updated_at, finished_at FROM collector_sessions WHERE id=?1")
      .bind(clean(body.sessionId)).first();
    const totals = parseJson(row?.totals_json, {});
    return { ok: true, sessionId: clean(body.sessionId), finished: Boolean(row?.finished_at),
      state: row?.state || "missing", processed: Number(totals.received || 0), pending: 0, ...totals, sourceBackend: "D1" };
  }
  if (action === "danggeunStartJob") return startDaangnJob(env, body);
  if (action === "danggeunRunJobChunk") return runDaangnChunk(env);
  if (action === "danggeunJobStatus") return { ok: true, job: publicDaangnJob(await loadDaangnJob(env)), sourceBackend: "D1" };
  if (action === "danggeunPauseJob" || action === "danggeunResumeJob") {
    const job = await loadDaangnJob(env);
    if (!job) return { ok: true, job: null };
    job.status = action === "danggeunPauseJob" ? "paused" : "running";
    job.message = action === "danggeunPauseJob" ? "안전중단됨 · 저장 지점 보존" : "저장 지점부터 이어서 수집합니다.";
    await saveDaangnJob(env, job);
    return { ok: true, job: publicDaangnJob(job), sourceBackend: "D1" };
  }
  return null;
}

export async function handleCollectorApi(request, env) {
  const cors = collectorCors(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!collectorHostAllowed(request)) return jsonResponse({ ok: false, message: "허용되지 않은 수집기 출처입니다." }, 403, cors);
  if (request.method === "GET") {
    const query = Object.fromEntries(new URL(request.url).searchParams.entries());
    if (clean(query.action) !== "mutationStatus") return jsonResponse({ ok: false, message: "지원하지 않는 요청입니다." }, 404, cors);
    if (!validCollectorKey(env, query.collectorKey || query.accessKey)) {
      return jsonpResponse(query.callback, { ok: false, ready: true, result: { ok: false, message: "승인되지 않은 요청입니다." } }, cors);
    }
    return jsonpResponse(query.callback, await mutationStatus(env, query.requestId), cors);
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST, OPTIONS", ...cors } });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !EXTERNAL_ACTIONS.has(clean(body.action))) {
    return jsonResponse({ ok: false, message: "잘못된 수집 요청입니다." }, 400, cors);
  }
  if (!validCollectorKey(env, body.collectorKey || body.accessKey)) {
    return jsonResponse({ ok: false, message: "승인되지 않은 요청입니다." }, 403, cors);
  }
  const existing = clean(body.requestId) ? await mutationStatus(env, body.requestId) : null;
  if (existing?.ready) return jsonResponse(existing.result, 200, cors);
  try {
    const result = await executeExternalAction(env, body);
    if (!result) return jsonResponse({ ok: false, message: "지원하지 않는 수집 작업입니다." }, 404, cors);
    if (body.requestId) await saveMutationResult(env, body.requestId, body.action, result);
    return jsonResponse(result, 200, cors);
  } catch (error) {
    const result = { ok: false, message: clean(error?.message) || "수집 처리에 실패했습니다." };
    if (body.requestId) await saveMutationResult(env, body.requestId, body.action, result);
    return jsonResponse(result, 400, cors);
  }
}

function candidateJson(row) {
  return {
    propertyId: clean(row.property_id || row.id), buildingName: clean(row.title), address: clean(row.address),
    room: clean(row.room), category: clean(row.listing_type), deposit: row.deposit, rent: row.monthly_rent,
    fee: row.maintenance_fee, premium: row.premium, area: row.area_m2, memo: clean(row.operating_memo),
    source: clean(row.main_source)
  };
}

async function reviewWorkspace(env, query) {
  const search = clean(query.query).slice(0, 100);
  const pattern = `%${search}%`;
  const result = await env.DB.prepare(`SELECT id, source, source_listing_id, payload_json, result_json, created_at
    FROM collector_raw WHERE processing_state='review' AND (?1='' OR payload_json LIKE ?2)
    ORDER BY created_at DESC LIMIT 600`).bind(search, pattern).all();
  const groups = new Map();
  for (const row of result?.results || []) {
    const item = parseJson(row.payload_json, {});
    const key = `${normalizedAddress(item.address)}|${normalizedRoom(item.room)}`;
    if (!groups.has(key)) groups.set(key, { groupKey: key, address: item.address, room: item.room,
      risk: "중간", score: 60, recommendation: "직접 확인", items: [], candidates: [] });
    const group = groups.get(key);
    const stored = parseJson(row.result_json, {});
    group.items.push({
      reviewId: row.id, source: row.source, sourceId: row.source_listing_id,
      buildingName: item.buildingName, address: item.address, room: item.room, type: "신규·변경",
      category: item.category, deposit: item.deposit, rent: item.rent, fee: item.fee,
      premium: item.premium, area: item.area, memo: item.memo,
      safeCandidateIds: Array.isArray(stored.candidateIds) ? stored.candidateIds : []
    });
  }

  const candidatesByAddress = new Map();
  const addresses = [...new Set([...groups.values()]
    .map((group) => normalizedAddress(group.address)).filter(Boolean))];
  for (let offset = 0; offset < addresses.length; offset += 75) {
    const batch = addresses.slice(offset, offset + 75);
    const placeholders = batch.map((_, index) => `?${index + 1}`).join(",");
    const candidates = await env.DB.prepare(`SELECT id, property_id, title, address, room, listing_type,
        deposit, monthly_rent, maintenance_fee, premium, area_m2, operating_memo, main_source, updated_at
      FROM listings WHERE status <> 'deleted' AND address IN (${placeholders})
      ORDER BY updated_at DESC`).bind(...batch).all();
    for (const row of candidates?.results || []) {
      const address = normalizedAddress(row.address);
      if (!candidatesByAddress.has(address)) candidatesByAddress.set(address, []);
      const items = candidatesByAddress.get(address);
      if (items.length < 12) items.push(candidateJson(row));
    }
  }

  for (const group of groups.values()) {
    group.candidates = candidatesByAddress.get(normalizedAddress(group.address)) || [];
    const candidateIds = new Set(group.candidates.map((entry) => entry.propertyId));
    group.items.forEach((item) => {
      item.safeCandidateIds = item.safeCandidateIds.filter((id) => candidateIds.has(id));
      if (!item.safeCandidateIds.length) {
        const exact = group.candidates.filter((candidate) => normalizedRoom(candidate.room) === normalizedRoom(item.room) &&
          sameNumber(candidate.deposit, item.deposit) && sameNumber(candidate.rent, item.rent) && sameNumber(candidate.area, item.area, 0.8));
        item.safeCandidateIds = exact.map((entry) => entry.propertyId);
      }
    });
    group.count = group.items.length;
    group.score = group.items.some((item) => item.safeCandidateIds.length === 1) ? 85 : group.candidates.length > 1 ? 55 : 70;
    group.risk = group.score >= 80 ? "낮음" : group.score >= 60 ? "중간" : "높음";
    group.recommendation = group.risk === "낮음" ? "동일매물 후보" : group.candidates.length ? "직접 비교" : "신규등록 후보";
  }
  const ordered = [...groups.values()].sort((left, right) => right.score - left.score);
  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM collector_raw WHERE processing_state='review'").first();
  return { ok: true, action: "reviewWorkspace", total: (result?.results || []).length,
    allPendingTotal: Number(totalRow?.count || 0), groupCount: ordered.length,
    loadedGroupCount: ordered.length, groups: ordered, source: "D1" };
}

async function collectionStatus(env) {
  const sessions = await env.DB.prepare(`SELECT id, source, state, totals_json, started_at, finished_at, updated_at
    FROM collector_sessions ORDER BY updated_at DESC LIMIT 100`).all();
  const counts = await env.DB.prepare(`SELECT source, COUNT(*) AS total,
    SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN active=0 THEN 1 ELSE 0 END) AS inactive
    FROM listing_sources GROUP BY source ORDER BY source`).all();
  return {
    ok: true, action: "collectionStatus",
    sessions: (sessions?.results || []).map((row) => ({
      sessionId: row.id, source: row.source, state: row.state, ...parseJson(row.totals_json, {}),
      startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at
    })),
    sources: counts?.results || [], source: "D1"
  };
}

async function propertyTimeline(env, propertyId) {
  const result = await env.DB.prepare(`SELECT h.action, h.actor_email, h.before_json, h.after_json, h.created_at,
      s.source FROM listing_history h LEFT JOIN listing_sources s ON s.id=h.source_id
    WHERE h.listing_id=?1 ORDER BY h.id DESC LIMIT 200`).bind(clean(propertyId)).all();
  return { ok: true, action: "propertyTimeline", propertyId: clean(propertyId),
    items: (result?.results || []).map((row) => ({ action: row.action, reason: parseJson(row.after_json, {})?.reason || "",
      at: row.created_at, source: row.source || row.actor_email || "D1" })), source: "D1" };
}

export function isCollectorAdminGetAction(action) {
  return ADMIN_GET_ACTIONS.has(clean(action));
}

export function isCollectorAdminPostAction(action) {
  return ADMIN_POST_ACTIONS.has(clean(action));
}

export async function handleCollectorAdminGet(env, user, query) {
  const action = clean(query.action);
  if (!isCollectorAdminGetAction(action)) return null;
  if (action === "reviewWorkspace") return reviewWorkspace(env, query);
  if (action === "collectionStatus") return collectionStatus(env);
  if (action === "propertyTimeline") return propertyTimeline(env, query.propertyId);
  return null;
}

async function applyReviewBatch(env, user, body) {
  const ids = [...new Set((Array.isArray(body.reviewIds) ? body.reviewIds : []).map(clean).filter(Boolean))].slice(0, 100);
  const action = clean(body.reviewAction);
  const masterId = clean(body.masterId);
  let processed = 0;
  let failed = 0;
  const processedReviewIds = [];
  const started = Date.now();
  for (const id of ids) {
    try {
      const row = await env.DB.prepare(`SELECT id, session_id, payload_json FROM collector_raw
        WHERE id=?1 AND processing_state='review'`).bind(id).first();
      if (!row) continue;
      const record = parseJson(row.payload_json, null);
      if (!record) throw new Error("검토 원본이 없습니다.");
      if (action === "hold") {
        await env.DB.prepare("UPDATE collector_raw SET processing_state='held', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action, actor: clean(user?.email) }), id).run();
      } else if (action === "create") {
        const createdId = await createListing(env, record, row.session_id, clean(user?.email));
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action, listingId: createdId }), id).run();
      } else if (action === "merge" || action === "condition") {
        const listing = await env.DB.prepare("SELECT id FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1").bind(masterId).first();
        if (!listing) throw new Error("통합할 기존 매물을 찾지 못했습니다.");
        await attachSource(env, record, listing.id, row.session_id, null, action === "condition", clean(user?.email));
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action, listingId: listing.id, manual: Boolean(body.manualMergeConfirmed) }), id).run();
      } else {
        throw new Error("검토 처리 방식을 확인해 주세요.");
      }
      processed += 1;
      processedReviewIds.push(id);
    } catch {
      failed += 1;
    }
  }
  const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM collector_raw WHERE processing_state='review'").first();
  return { ok: true, action: "applyReviewBatch", processed, failed, processedReviewIds,
    remaining: Number(remaining?.count || 0), actionWritesVerified: processed,
    reviewRowsRemovedVerified: processed, elapsedMs: Date.now() - started, source: "D1" };
}

async function consolidateExisting(env, user, body) {
  const primaryId = clean(body.primaryMasterId);
  const duplicates = [...new Set((Array.isArray(body.duplicateMasterIds) ? body.duplicateMasterIds : []).map(clean).filter((id) => id && id !== primaryId))].slice(0, 50);
  const primary = await env.DB.prepare("SELECT id FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1").bind(primaryId).first();
  if (!primary) throw new Error("대표매물을 찾지 못했습니다.");
  let consolidated = 0;
  for (const duplicateId of duplicates) {
    const duplicate = await env.DB.prepare("SELECT id FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1").bind(duplicateId).first();
    if (!duplicate || duplicate.id === primary.id) continue;
    await env.DB.batch([
      env.DB.prepare("UPDATE listing_sources SET listing_id=?1, updated_at=?2 WHERE listing_id=?3").bind(primary.id, nowIso(), duplicate.id),
      env.DB.prepare("UPDATE listing_media SET listing_id=?1, updated_at=?2 WHERE listing_id=?3").bind(primary.id, nowIso(), duplicate.id),
      env.DB.prepare("UPDATE listing_contacts SET listing_id=?1, updated_at=?2 WHERE listing_id=?3").bind(primary.id, nowIso(), duplicate.id),
      env.DB.prepare("UPDATE listings SET status='deleted', updated_at=?1 WHERE id=?2").bind(nowIso(), duplicate.id),
      env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
        VALUES (?1, 'consolidateExistingMasters', ?2, ?3, ?4)`)
        .bind(primary.id, clean(user?.email), JSON.stringify({ duplicateId: duplicate.id }), JSON.stringify({ primaryId: primary.id }))
    ]);
    consolidated += 1;
  }
  return { ok: true, action: "consolidateExistingMasters", consolidated, primaryMasterId: primary.id, source: "D1" };
}

async function repairExactReviews(env, user) {
  const rows = await env.DB.prepare(`SELECT id, session_id, payload_json FROM collector_raw
    WHERE processing_state='review' ORDER BY created_at LIMIT 500`).all();
  let merged = 0;
  for (const row of rows?.results || []) {
    const record = parseJson(row.payload_json, null);
    if (!record) continue;
    const exact = exactCandidate(record, await candidateListings(env, record));
    if (!exact) continue;
    await attachSource(env, record, exact.id, row.session_id, null, false, clean(user?.email));
    await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2 WHERE id=?3")
      .bind(nowIso(), JSON.stringify({ action: "autoMerge", listingId: exact.id }), row.id).run();
    merged += 1;
  }
  return { ok: true, action: "repairRoomlessExactReviews", merged, source: "D1" };
}

export async function handleCollectorAdminPost(env, user, body) {
  const action = clean(body.action);
  if (!isCollectorAdminPostAction(action)) return null;
  if (action === "applyReviewBatch") return applyReviewBatch(env, user, body);
  if (action === "consolidateExistingMasters") return consolidateExisting(env, user, body);
  if (action === "repairRoomlessExactReviews") return repairExactReviews(env, user);
  return null;
}
