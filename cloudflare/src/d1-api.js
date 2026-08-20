import { canonicalListingRoom, floorMatchesBounds, listingFloor } from "./floor.js";
import { requireRole } from "./security.js";

const UNIFIED_FIELDS = [
  "originalId", "source", "link", "room", "deposit", "rent", "fee", "premium", "area",
  "latitude", "longitude", "thumbnail", "photoCount", "contactCount", "revision", "preserveRepresentative"
];

const D1_GET_ACTIONS = new Set([
  "announcement", "checkDuplicate", "geocodeCache", "loadCloudState", "mutationStatus",
  "tellContacts", "unifiedListingContacts", "unifiedListingDetail", "unifiedListings",
  "workQueueStatus", "customerWorkspace", "customerMatches", "operationsDashboard",
  "transactionCandidates", "listingChanges", "listingHistory", "userManagement", "userProfile"
]);

const D1_POST_ACTIONS = new Set([
  "deleteCustomer", "deleteProperty", "enqueueMutation", "moveOriginalListing", "quickAdd", "saveCloudState",
  "saveGeocodeCache", "toggleDone", "updateProperty", "updatePropertyMemo", "saveCustomer",
  "updateCustomerMatch", "rebuildCustomerMatches", "addCustomerActivity",
  "restoreListingHistory", "saveAllowedUser"
]);

const CUSTOMER_HEADERS = [
  "고객명/상호", "연락처", "상태", "희망지역", "희망구분", "보증금최소", "보증금최대",
  "월세최소", "월세최대", "권리금최대", "평수최소", "평수최대", "최저층", "최고층",
  "필수태그", "선호태그", "제외태그", "요청사항", "담당자", "조건버전", "등록일시",
  "수정일시", "고객ID"
];

const MATCH_HEADERS = [
  "매칭ID", "고객ID", "대표매물ID", "점수", "진행상태", "최초매칭일시", "연락일시",
  "메모", "수정일시"
];

const ACTIVITY_HEADERS = [
  "상담ID", "고객ID", "일시", "단계", "출처", "상담내용", "다음연락일", "담당자"
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

const MEMO_CONTACT_ROLE_PRIORITY = {
  "주": 90, "남": 80, "여": 80, "관": 70, "세": 70, "가": 70, "임": 40, "기": 10
};

function memoContactRole(value) {
  const label = clean(value).replace(/\s+/g, "");
  if (/^(?:주인|건물주|소유자|주)$/.test(label)) return "주";
  if (/^(?:임대인|임)$/.test(label)) return "임";
  if (/^(?:사장|남성|남자|남)$/.test(label)) return "남";
  if (/^(?:사모|여성|여자|여)$/.test(label)) return "여";
  if (/^(?:관리소장|관리업체|관리인|관리|관)$/.test(label)) return "관";
  if (/^(?:세입자|임차인|임차|세)$/.test(label)) return "세";
  if (/^(?:가족|가)$/.test(label)) return "가";
  return "기";
}

function normalizeMemoContactPhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("010")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 9 && digits.startsWith("02")) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  if (digits.length === 10 && digits.startsWith("02")) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return "";
}

export function extractManualMemoContacts(memo) {
  const source = clean(memo);
  const contacts = [];
  const seen = new Map();
  const boundary = "(?:^|[\\s\\(\\[\\{,;:：·/\\.\\-!?。])";
  const modifier = "(?:(?:다른|기존|현재|새|전|현)\\s*)?";
  const role = "(주인|건물주|소유자|임대인|사장|남성|남자|사모|여성|여자|관리소장|관리업체|관리인|관리|세입자|임차인|임차|가족|주|임|남|여|관|세|가)";
  const bridge = "(?:[\\s\\)\\(\\]:：=.,·-]*(?:(?:추가\\s*)?(?:연락처|번호)|전화번호|전화)?[\\s\\)\\(\\]:：=.,·-]*)";
  const phone = "(0(?:10|11|16|17|18|19)[-\\s]?\\d{3,4}[-\\s]?\\d{4}|02[-\\s]?\\d{3,4}[-\\s]?\\d{4}|0(?:[3-6][1-5]|70)[-\\s]?\\d{3,4}[-\\s]?\\d{4})";
  const matcher = new RegExp(boundary + modifier + role + bridge + phone, "g");
  let match;
  while ((match = matcher.exec(source))) {
    const normalizedPhone = normalizeMemoContactPhone(match[2]);
    if (!normalizedPhone) continue;
    const key = normalizedPhone.replace(/\D/g, "");
    const next = { role: memoContactRole(match[1]), phone: normalizedPhone };
    const existingIndex = seen.get(key);
    if (existingIndex != null) {
      const existing = contacts[existingIndex];
      if ((MEMO_CONTACT_ROLE_PRIORITY[next.role] || 0) > (MEMO_CONTACT_ROLE_PRIORITY[existing.role] || 0)) {
        existing.role = next.role;
      }
      continue;
    }
    seen.set(key, contacts.length);
    contacts.push(next);
  }
  return contacts.slice(0, 12);
}

function isExternalListingSource(value) {
  return /(?:네이버|naver|당근|daangn|danggeun)/i.test(clean(value));
}

export function reconcileMemoContacts(source, storedContacts, memo) {
  const manualContacts = extractManualMemoContacts(memo);
  const contacts = [];
  const seen = new Map();
  const add = (contact) => {
    const phone = normalizeMemoContactPhone(contact?.phone || contact?.number);
    if (!phone) return;
    const key = phone.replace(/\D/g, "");
    const next = { role: memoContactRole(contact?.role), phone };
    const existingIndex = seen.get(key);
    if (existingIndex != null) {
      const existing = contacts[existingIndex];
      if ((MEMO_CONTACT_ROLE_PRIORITY[next.role] || 0) > (MEMO_CONTACT_ROLE_PRIORITY[existing.role] || 0)) {
        existing.role = next.role;
      }
      return;
    }
    seen.set(key, contacts.length);
    contacts.push(next);
  };
  // Naver/Daangn contacts are never trusted. Only explicitly role-labelled
  // numbers typed by the user in the memo are retained for those listings.
  if (!isExternalListingSource(source)) {
    (Array.isArray(storedContacts) ? storedContacts : []).forEach(add);
  }
  manualContacts.forEach(add);
  return contacts.slice(0, 12);
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

const ACCOUNT_LIST_SCOPES = new Set(["favorites", "visitLists"]);

export function normalizeCloudDeletionIds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [rawId, rawDeletedAt] of Object.entries(value).slice(0, 10_000)) {
    const id = clean(rawId).slice(0, 160);
    const deletedAt = Number(rawDeletedAt);
    if (id && Number.isFinite(deletedAt) && deletedAt > 0) normalized[id] = deletedAt;
  }
  return normalized;
}

export function mergeCloudDeletionIds(existing, incoming) {
  const merged = normalizeCloudDeletionIds(existing);
  for (const [id, deletedAt] of Object.entries(normalizeCloudDeletionIds(incoming))) {
    merged[id] = Math.max(Number(merged[id]) || 0, deletedAt);
  }
  return merged;
}

export function filterCloudDeletedLists(lists, deletedIds) {
  if (!Array.isArray(lists)) return lists;
  const deleted = normalizeCloudDeletionIds(deletedIds);
  return lists.filter((list) => {
    const id = clean(list?.id);
    return !id || !deleted[id];
  });
}

function cloudDeletionScope(scope) {
  return `${scope}Deleted`;
}

function propertyIdFrom(body) {
  return clean(body?.key?.propertyId || body?.propertyId || body?.listingId).slice(0, 100);
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function allPages(env, sql, pageSize = 4_000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await env.DB.prepare(`${sql} LIMIT ?1 OFFSET ?2`).bind(pageSize, offset).all();
    const page = result?.results || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function allRowidPages(env, selectSql, tableSql, whereSql = "1 = 1", pageSize = 4_000) {
  const rows = [];
  let cursor = 0;
  for (;;) {
    const result = await env.DB.prepare(`SELECT rowid AS __page_cursor, ${selectSql}
      FROM ${tableSql} WHERE (${whereSql}) AND rowid > ?1 ORDER BY rowid LIMIT ?2`)
      .bind(cursor, pageSize).all();
    const page = result?.results || [];
    for (const row of page) {
      const { __page_cursor: pageCursor, ...value } = row;
      cursor = Math.max(cursor, Number(pageCursor) || 0);
      rows.push(value);
    }
    if (page.length < pageSize) break;
  }
  return rows;
}

export function isD1GetAction(action) {
  return D1_GET_ACTIONS.has(clean(action));
}

export function isD1PostAction(action) {
  return D1_POST_ACTIONS.has(clean(action));
}

export async function buildD1SheetCsv(env) {
  const rows = await allRowidPages(env, `
    title, address, room, listing_type, deposit, monthly_rent, maintenance_fee, premium, area_m2,
    landlord_phone, tenant_phone, operating_memo, status, first_collected_at, main_source,
    property_id, source_url, contacts_json, building_year, building_elevators,
    building_approval_date, building_info_checked_at, building_info_status, registration_at,
    last_collected_at, latitude, longitude, building_elevator_capacity`, "listings", "status <> 'deleted'", 3_000);
  const header = [
    "건물명", "주소", "호실", "구분", "보증금", "월세", "관리비", "권리금", "평수",
    "임대인연락처", "임차인연락처", "메모", "상태", "등록일", "출처", "매물ID", "원본링크",
    "연락처목록", "준공연도", "승강기", "사용승인일", "건축물확인일", "건축물상태", "등록시각",
    "최종수집시각", "위도", "경도"
  ];
  header.push("엘리베이터최대정원");
  const body = [header, ...rows.map((row) => [
    row.title, row.address, row.room, row.listing_type, row.deposit, row.monthly_rent,
    row.maintenance_fee, row.premium, row.area_m2, row.landlord_phone, row.tenant_phone,
    row.operating_memo, row.status, row.first_collected_at, row.main_source, row.property_id,
    row.source_url, row.contacts_json, row.building_year, row.building_elevators,
    row.building_approval_date, row.building_info_checked_at, row.building_info_status,
    row.registration_at, row.last_collected_at, row.latitude, row.longitude, row.building_elevator_capacity
  ])].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `${body}\r\n`;
}

async function listingChanges(env, query) {
  const ids = [...new Set(clean(query.ids).split(",").map((value) => clean(value).slice(0, 100)).filter(Boolean))]
    .slice(0, 50);
  if (!ids.length) return { ok: true, action: "listingChanges", items: [], source: "D1" };
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(",");
  const result = await env.DB.prepare(`SELECT
      title, address, room, listing_type, deposit, monthly_rent, maintenance_fee, premium, area_m2,
      landlord_phone, tenant_phone, operating_memo, status, first_collected_at, main_source,
      property_id, source_url, contacts_json, building_year, building_elevators,
      building_approval_date, building_info_checked_at, building_info_status, registration_at,
      last_collected_at, latitude, longitude, building_elevator_capacity
    FROM listings WHERE property_id IN (${placeholders})`).bind(...ids).all();
  return { ok: true, action: "listingChanges", items: result?.results || [], requestedIds: ids, source: "D1" };
}

export function actualGongsilImages(raw = {}) {
  const list = raw?.list || raw || {};
  const detail = raw?.detail || {};
  const rows = [list?.Photos, list?.photos, detail?.Photos, detail?.photos]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const images = [];
  for (const row of rows) {
    let path = clean(row && typeof row === "object"
      ? row.Photo || row.photo || row.url || row.Xbfimg || row.xbfimg
      : row);
    if (!path || /(?:^|\/)avatars\//i.test(path)) continue;
    if (!/^https:\/\//i.test(path)) {
      path = path.replace(/^\/+/, "")
        .replace(/^(?:https?:\/\/)?(?:file1\.)?gongsilbox\.com\/file\/land_photo\//i, "");
      if (!path || /(?:^|\/)\.\.(?:\/|$)/.test(path) || /\\/.test(path)) continue;
      path = `https://file1.gongsilbox.com/file/land_photo/${path}`;
    }
    if (!/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(path) || images.includes(path)) continue;
    images.push(path);
    if (images.length >= 40) break;
  }
  return images;
}

export function sourceListingSearchIndex(rows = []) {
  const sourceSearchIds = {};
  for (const row of rows) {
    const propertyId = clean(row?.listing_id);
    const sourceId = clean(row?.source_listing_id).replace(/^네이버-/i, "");
    const sourceCode = clean(row?.source) === "네이버" ? "n" : (clean(row?.source) === "당근" ? "d" : "");
    if (!propertyId || !sourceCode || !/^\d+$/.test(sourceId)) continue;
    if (!sourceSearchIds[propertyId]) sourceSearchIds[propertyId] = [];
    const key = `${sourceCode}:${sourceId}`;
    if (!sourceSearchIds[propertyId].includes(key)) sourceSearchIds[propertyId].push(key);
  }
  return sourceSearchIds;
}

async function unifiedListings(env) {
  const rows = await allRowidPages(
    env,
    "listing_id, list_snapshot_json, json_extract(raw_json, '$.list.Photos') AS gongsil_photos_json",
    "listing_sources",
    "active = 1",
    4_000
  );
  const sourceSearchRows = await allPages(env, `SELECT s.listing_id, s.source, s.source_listing_id
    FROM listing_sources s JOIN listings l ON l.id=s.listing_id
    WHERE l.status<>'deleted' AND s.source IN ('네이버','당근') ORDER BY s.rowid`, 4_000);
  const groups = {};
  const sourceSearchIds = sourceListingSearchIndex(sourceSearchRows);
  for (const row of rows) {
    const original = parseJson(row.list_snapshot_json, {});
    if (clean(original.source) === "공실박스") {
      const actualImages = actualGongsilImages({
        list: { Photos: parseJson(row.gongsil_photos_json, []) }
      });
      original.thumbnail = actualImages[0] || "";
      original.photoCount = actualImages.length;
    }
    const propertyId = clean(row.listing_id || original.propertyId);
    if (!propertyId) continue;
    if (!groups[propertyId]) groups[propertyId] = [];
    const values = UNIFIED_FIELDS.map((field) => original[field] ?? "");
    while (values.length && values[values.length - 1] === "") values.pop();
    groups[propertyId].push(values);
  }
  return {
    ok: true,
    version: 2,
    format: "compact-v2",
    fields: UNIFIED_FIELDS,
    groups,
    sourceSearchIds,
    originalCount: rows.length,
    source: "D1"
  };
}

export function masterFallbackOriginal(row, images = []) {
  const id = clean(row?.id || row?.property_id);
  const contacts = parseJson(row?.contacts_json, []);
  const uniqueImages = [...new Set((Array.isArray(images) ? images : []).map(clean).filter(Boolean))];
  return {
    originalId: `master:${id}`,
    source: clean(row?.main_source) || "직접등록",
    link: clean(row?.source_url),
    buildingName: clean(row?.building_name || row?.title),
    address: clean(row?.address),
    room: clean(row?.room),
    deposit: number(row?.deposit),
    rent: number(row?.monthly_rent),
    fee: number(row?.maintenance_fee),
    premium: number(row?.premium),
    area: number(row?.area_m2),
    latitude: number(row?.latitude),
    longitude: number(row?.longitude),
    memo: clean(row?.operating_memo),
    images: uniqueImages,
    thumbnail: uniqueImages[0] || "",
    photoCount: uniqueImages.length,
    contactCount: Array.isArray(contacts) ? contacts.length : 0,
    revision: Math.max(1, Number(row?.version) || 1),
    registrationAt: clean(row?.registration_at || row?.first_collected_at),
    masterFallback: true
  };
}

async function unifiedDetail(env, propertyId) {
  const sourceResult = await env.DB.prepare(`SELECT id, source, list_snapshot_json, raw_json
    FROM listing_sources WHERE listing_id = ?1 AND active = 1 ORDER BY rowid`).bind(propertyId).all();
  const mediaResult = await env.DB.prepare(`SELECT source_id, external_url, r2_key, thumbnail_r2_key, sort_order
    FROM listing_media WHERE listing_id = ?1 AND status <> 'deleted' ORDER BY source_id, sort_order, rowid`)
    .bind(propertyId).all();
  const mediaBySource = {};
  for (const media of mediaResult?.results || []) {
    const sourceId = clean(media.source_id);
    if (!mediaBySource[sourceId]) mediaBySource[sourceId] = [];
    const url = clean(media.external_url);
    if (url && !mediaBySource[sourceId].includes(url)) mediaBySource[sourceId].push(url);
  }
  const originals = (sourceResult?.results || []).map((row) => {
    const raw = parseJson(row.raw_json, {});
    const snapshot = {
      ...raw,
      ...parseJson(row.list_snapshot_json, {})
    };
    const isGongsil = clean(row.source || snapshot.source) === "공실박스";
    const images = isGongsil ? actualGongsilImages(raw) : (mediaBySource[clean(row.id)] || []);
    snapshot.images = images;
    snapshot.thumbnail = images[0] || "";
    snapshot.photoCount = isGongsil
      ? images.length
      : Math.max(images.length, Number(snapshot.photoCount) || 0);
    return snapshot;
  });
  if (!originals.length) {
    const master = await env.DB.prepare(`SELECT id, property_id, main_source, title, building_name,
        address, room, deposit, monthly_rent, maintenance_fee, premium, area_m2,
        latitude, longitude, operating_memo, source_url, contacts_json, version,
        registration_at, first_collected_at
      FROM listings WHERE property_id = ?1 AND status <> 'deleted' LIMIT 1`).bind(propertyId).first();
    if (master) {
      const fallbackImages = (mediaResult?.results || []).map((media) => clean(media.external_url)).filter(Boolean);
      originals.push(masterFallbackOriginal(master, fallbackImages));
    }
  }
  return { ok: true, action: "unifiedListingDetail", propertyId, originals, source: "D1" };
}

async function listingContacts(env, propertyId) {
  const result = await env.DB.prepare(`SELECT c.id, c.role, c.name, c.phone, c.normalized_phone, c.status,
    c.first_seen_at, c.last_seen_at FROM listing_contacts c
    JOIN listing_sources s ON s.id = c.source_id
    WHERE c.listing_id = ?1 AND c.status <> 'deleted' AND s.source = '공실박스'
    ORDER BY c.rowid`).bind(propertyId).all();
  const contacts = (result?.results || []).map((row) => ({
    id: row.id,
    role: row.role,
    name: row.name,
    phone: row.phone,
    normalizedPhone: row.normalized_phone,
    status: row.status,
    firstSeen: row.first_seen_at,
    lastSeen: row.last_seen_at
  }));
  return { ok: true, action: "unifiedListingContacts", propertyId, contactCount: contacts.length, contacts };
}

export function tellContactSearchPatterns(query) {
  const normalized = clean(query).replace(/\s+/g, " ").slice(0, 100);
  return {
    query: normalized,
    pattern: `%${normalized}%`,
    compactPattern: `%${normalized.replace(/\s+/g, "")}%`
  };
}

async function tellContacts(env, query) {
  const search = tellContactSearchPatterns(query);
  const providerResult = await env.DB.prepare(`SELECT c.id, c.listing_id, c.role, c.name, c.phone,
      l.title, l.address, l.room
    FROM listing_contacts c JOIN listings l ON l.id = c.listing_id
    JOIN listing_sources s ON s.id = c.source_id
    WHERE c.status <> 'deleted' AND s.source = '공실박스' AND (
      c.phone LIKE ?1 OR c.normalized_phone LIKE ?1 OR c.name LIKE ?1 OR
      l.title LIKE ?1 OR l.address LIKE ?1 OR l.room LIKE ?1 OR
      REPLACE(l.address, ' ', '') LIKE ?2
    ) ORDER BY c.last_seen_at DESC LIMIT 100`).bind(search.pattern, search.compactPattern).all();
  const memoResult = await env.DB.prepare(`SELECT l.id AS listing_id, l.title, l.address, l.room, l.operating_memo
    FROM listings l WHERE (
      l.title LIKE ?1 OR l.address LIKE ?1 OR l.room LIKE ?1 OR l.operating_memo LIKE ?1 OR
      REPLACE(l.address, ' ', '') LIKE ?2 OR REPLACE(l.operating_memo, ' ', '') LIKE ?2
    ) ORDER BY l.updated_at DESC LIMIT 100`).bind(search.pattern, search.compactPattern).all();
  const contacts = (providerResult?.results || []).map((row) => ({
    id: row.id,
    propertyId: row.listing_id,
    role: row.role,
    name: row.name,
    phone: row.phone,
    buildingName: row.title,
    address: row.address,
    room: row.room,
    contactSource: "공실박스"
  }));
  const seen = new Set(contacts.map((contact) =>
    `${clean(contact.propertyId)}|${clean(contact.phone).replace(/\D/g, "")}`));
  for (const row of memoResult?.results || []) {
    for (const contact of extractManualMemoContacts(row.operating_memo)) {
      const digits = clean(contact.phone).replace(/\D/g, "");
      const key = `${clean(row.listing_id)}|${digits}`;
      if (!digits || seen.has(key)) continue;
      seen.add(key);
      contacts.push({
        id: `memo:${clean(row.listing_id)}:${digits}`,
        propertyId: row.listing_id,
        role: contact.role,
        name: "직접 메모",
        phone: contact.phone,
        buildingName: row.title,
        address: row.address,
        room: row.room,
        contactSource: "직접 메모"
      });
    }
  }
  return {
    ok: true,
    action: "tellContacts",
    query: search.query,
    contacts: contacts.slice(0, 100)
  };
}

async function geocodeCache(env) {
  const rows = await allRowidPages(env, "cache_key, address, latitude, longitude, checked_at", "geocode_cache", "1 = 1", 4_000);
  const entries = {};
  for (const row of rows) {
    const key = clean(row.address || row.cache_key);
    if (!key) continue;
    entries[key] = { lat: Number(row.latitude), lng: Number(row.longitude), savedAt: row.checked_at };
  }
  return { ok: true, action: "geocodeCache", count: rows.length, entries, source: "D1" };
}

async function cloudState(env, user, query) {
  const scope = clean(query.scope).slice(0, 100);
  const recordKey = clean(query.recordKey || "default").slice(0, 100);
  const owner = clean(user?.email).toLowerCase();
  const rowPromise = env.DB.prepare(`SELECT value_json, version, updated_at FROM cloud_state
    WHERE owner_email = ?1 AND scope = ?2 AND record_key = ?3`)
    .bind(owner, scope, recordKey).first();
  const deletedRowPromise = ACCOUNT_LIST_SCOPES.has(scope)
    ? env.DB.prepare(`SELECT value_json FROM cloud_state
      WHERE owner_email = ?1 AND scope = ?2 AND record_key = ?3`)
      .bind(owner, cloudDeletionScope(scope), recordKey).first()
    : Promise.resolve(null);
  const [row, deletedRow] = await Promise.all([rowPromise, deletedRowPromise]);
  const deletedIds = normalizeCloudDeletionIds(parseJson(deletedRow?.value_json, {}));
  const data = row ? filterCloudDeletedLists(parseJson(row.value_json, null), deletedIds) : null;
  return row
    ? { ok: true, action: "loadCloudState", found: true, scope, recordKey,
      data, deletedIds, version: row.version, updatedAt: row.updated_at }
    : { ok: true, action: "loadCloudState", found: false, scope, recordKey,
      data: null, deletedIds, version: 0 };
}

async function announcement(env) {
  const row = await env.DB.prepare(`SELECT id, title, body, starts_at, ends_at, updated_at
    FROM announcements WHERE active = 1
      AND (starts_at = '' OR datetime(starts_at) <= datetime('now'))
      AND (ends_at = '' OR datetime(ends_at) >= datetime('now'))
    ORDER BY updated_at DESC LIMIT 1`).first();
  return { ok: true, action: "announcement", announcement: row || null, source: "D1" };
}

async function duplicateCheck(env, values) {
  const row = Array.isArray(values) ? values : [];
  const address = clean(row[1]);
  const room = clean(row[2]);
  const deposit = number(row[4]);
  const rent = number(row[5]);
  const area = number(row[8]);
  const exact = await env.DB.prepare(`SELECT property_id, title, address, room, deposit, monthly_rent
    FROM listings WHERE status <> 'deleted' AND address = ?1 AND room = ?2
      AND COALESCE(deposit, 0) = COALESCE(?3, 0) AND COALESCE(monthly_rent, 0) = COALESCE(?4, 0)
      AND COALESCE(area_m2, 0) = COALESCE(?5, 0)
    LIMIT 1`).bind(address, room, deposit, rent, area).first();
  const similar = exact || await env.DB.prepare(`SELECT property_id, title, address, room, deposit, monthly_rent
    FROM listings WHERE status <> 'deleted' AND address = ?1 LIMIT 1`).bind(address).first();
  const existing = similar ? {
    propertyId: similar.property_id,
    name: similar.title,
    address: similar.address,
    room: similar.room,
    deposit: similar.deposit,
    rent: similar.monthly_rent
  } : null;
  return { ok: true, action: "checkDuplicate", duplicateType: exact ? "exact" : similar ? "similar" : "none", existing };
}

async function mutationStatus(env, requestId) {
  const row = await env.DB.prepare(`SELECT state, result_json FROM mutation_results WHERE request_id = ?1`)
    .bind(clean(requestId).slice(0, 160)).first();
  if (!row) return { ok: true, ready: false, requestId: clean(requestId) };
  return { ok: true, ready: row.state === "completed", requestId: clean(requestId), result: parseJson(row.result_json, {}) };
}

async function workQueueStatus(env, user) {
  const result = await env.DB.prepare(`SELECT request_id, action, state, result_json, created_at
    FROM mutation_results WHERE owner_email = ?1 ORDER BY created_at DESC LIMIT 30`)
    .bind(clean(user?.email).toLowerCase()).all();
  const jobs = (result?.results || []).map((row) => ({
    requestId: row.request_id,
    action: row.action,
    state: row.state,
    result: parseJson(row.result_json, {}),
    createdAt: row.created_at
  }));
  return {
    ok: true,
    action: "workQueueStatus",
    completed: jobs.filter((job) => job.state === "completed").length,
    processing: 0,
    pending: 0,
    failed: jobs.filter((job) => job.state === "failed").length,
    jobs,
    source: "D1"
  };
}

function requirementsFromCustomer(row) {
  return parseJson(row?.requirements_json, {});
}

function customerRow(row) {
  const requirements = requirementsFromCustomer(row);
  return [
    row.name || "", row.phone || "", row.status || "미팅전", requirements.regions || "",
    requirements.types || "", requirements.depositMin || "", requirements.depositMax || "",
    requirements.rentMin || "", requirements.rentMax || "", requirements.premiumMax || "",
    requirements.areaMin || "", requirements.areaMax || "", requirements.floorMin || "",
    requirements.floorMax || "", requirements.requiredTags || "", requirements.preferredTags || "",
    requirements.excludedTags || "", row.memo || "", requirements.manager || "",
    Number(requirements.conditionVersion) || 1, row.created_at || "", row.updated_at || "", row.id || ""
  ];
}

function displayMatchState(value) {
  const state = clean(value);
  if (state === "candidate") return "신규";
  if (state === "introduced") return "소개";
  if (state === "held") return "보류";
  return state || "신규";
}

function matchId(customerId, listingId) {
  return `CM-${clean(customerId)}-${clean(listingId)}`;
}

function matchRow(row) {
  return [
    matchId(row.customer_id, row.listing_id), row.customer_id || "", row.property_id || row.listing_id || "",
    Math.round(Number(row.score) || 0), displayMatchState(row.state), row.created_at || "",
    row.contacted_at || "", row.memo || "", row.updated_at || ""
  ];
}

function activityRow(row) {
  return [
    row.id || "", row.customer_id || "", row.created_at || "", row.stage || "", row.source || "",
    row.memo || "", row.next_contact_date || "", row.actor_email || ""
  ];
}

async function customerRecords(env) {
  return allPages(env, `SELECT id, name, phone, status, requirements_json, memo, created_at, updated_at
    FROM customers ORDER BY updated_at DESC, created_at DESC`, 1_000);
}

async function customerMatchRecords(env, customerId = "") {
  const id = clean(customerId);
  const result = id
    ? await env.DB.prepare(`SELECT m.customer_id, m.listing_id, m.state, m.score, m.memo,
        m.created_at, m.updated_at, m.contacted_at, l.property_id
      FROM customer_matches m JOIN listings l ON l.id=m.listing_id
      WHERE m.customer_id=?1 AND l.status <> 'deleted'
      ORDER BY m.score DESC, m.updated_at DESC LIMIT 800`).bind(id).all()
    : await env.DB.prepare(`SELECT m.customer_id, m.listing_id, m.state, m.score, m.memo,
        m.created_at, m.updated_at, m.contacted_at, l.property_id
      FROM customer_matches m JOIN listings l ON l.id=m.listing_id
      WHERE l.status <> 'deleted' ORDER BY m.updated_at DESC LIMIT 3000`).all();
  return result?.results || [];
}

async function activityRecords(env) {
  return allPages(env, `SELECT id, customer_id, stage, source, memo, next_contact_date, actor_email, created_at
    FROM customer_activities ORDER BY created_at ASC`, 1_000);
}

function summarizeMatches(rows) {
  const byCustomer = {};
  for (const row of rows) {
    const id = clean(row.customer_id);
    if (!byCustomer[id]) byCustomer[id] = { customerId: id, total: 0, fresh: 0, introduced: 0, held: 0, overdue: 0 };
    const item = byCustomer[id];
    const state = displayMatchState(row.state);
    item.total += 1;
    if (state === "신규") item.fresh += 1;
    if (state === "소개") item.introduced += 1;
    if (state === "보류") item.held += 1;
    if (state === "신규" && !row.contacted_at && Date.now() - Date.parse(row.created_at || 0) >= 3 * 86400000) {
      item.overdue += 1;
    }
  }
  return Object.values(byCustomer);
}

async function customerWorkspace(env, requestedCustomerId = "") {
  const customers = await customerRecords(env);
  const selectedCustomerId = clean(requestedCustomerId) || clean(customers[0]?.id);
  const [allMatches, activities] = await Promise.all([
    customerMatchRecords(env),
    activityRecords(env)
  ]);
  const selectedMatches = selectedCustomerId
    ? allMatches.filter((row) => clean(row.customer_id) === selectedCustomerId)
    : [];
  return {
    ok: true,
    action: "customerWorkspace",
    customerHeaders: CUSTOMER_HEADERS,
    customers: customers.map(customerRow),
    matchHeaders: MATCH_HEADERS,
    matches: selectedMatches.map(matchRow),
    matchSummary: summarizeMatches(allMatches),
    activityHeaders: ACTIVITY_HEADERS,
    activities: activities.map(activityRow),
    selectedCustomerId,
    contactReminderDays: 3,
    source: "D1"
  };
}

async function customerMatches(env, customerId) {
  const rows = await customerMatchRecords(env, customerId);
  return { ok: true, action: "customerMatches", headers: MATCH_HEADERS, rows: rows.map(matchRow), source: "D1" };
}

async function computeOperationsDashboard(env) {
  const result = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM listings WHERE status <> 'deleted') AS active_master,
      (SELECT COUNT(*) FROM listing_sources WHERE active=1) AS raw_count,
      (SELECT COUNT(*) FROM collector_raw WHERE processing_state IN ('pending','review')) AS pending_review,
      (SELECT COUNT(*) FROM customers WHERE status NOT IN ('계약완료','종료')) AS open_customers,
      (SELECT COUNT(*) FROM customer_matches WHERE state IN ('candidate','신규')) AS new_matches,
      (SELECT COUNT(*) FROM customer_matches WHERE state IN ('introduced','소개')) AS introduced_matches,
      (SELECT COUNT(*) FROM customer_matches WHERE state IN ('candidate','신규')
        AND datetime(created_at) <= datetime('now','-3 days')) AS overdue_matches,
      (SELECT COUNT(*) FROM customer_activities WHERE next_contact_date <> ''
        AND date(next_contact_date) <= date('now')) AS due_followups,
      (SELECT COUNT(*) FROM (
        SELECT s.listing_id FROM listing_sources s
        JOIN listings l ON l.id=s.listing_id
        WHERE l.status NOT IN ('deleted','계약완료')
        GROUP BY s.listing_id
        HAVING SUM(CASE WHEN active=1 THEN 1 ELSE 0 END)=0
          AND MAX(missing_count) >= 3
      )) AS transaction_candidates,
      (SELECT COUNT(*) FROM listing_history) AS history_count`).first();
  const customerSummary = await env.DB.prepare(`SELECT customer_id,
      SUM(CASE WHEN state IN ('candidate','신규') THEN 1 ELSE 0 END) AS fresh,
      SUM(CASE WHEN state IN ('candidate','신규') AND datetime(created_at) <= datetime('now','-3 days') THEN 1 ELSE 0 END) AS overdue
    FROM customer_matches GROUP BY customer_id`).all();
  return {
    ok: true,
    action: "operationsDashboard",
    activeMaster: Number(result?.active_master) || 0,
    master: Number(result?.active_master) || 0,
    raw: Number(result?.raw_count) || 0,
    pendingReview: Number(result?.pending_review) || 0,
    review: Number(result?.pending_review) || 0,
    openCustomers: Number(result?.open_customers) || 0,
    customers: Number(result?.open_customers) || 0,
    newMatches: Number(result?.new_matches) || 0,
    matches: Number(result?.new_matches) || 0,
    introducedMatches: Number(result?.introduced_matches) || 0,
    overdueMatches: Number(result?.overdue_matches) || 0,
    dueFollowups: Number(result?.due_followups) || 0,
    transactionCheckCandidates: Number(result?.transaction_candidates) || 0,
    history: Number(result?.history_count) || 0,
    newMatchCustomers: (customerSummary?.results || []).filter((row) => Number(row.fresh) > 0).length,
    overdueCustomers: (customerSummary?.results || []).filter((row) => Number(row.overdue) > 0).length,
    contactReminderDays: 3,
    calculatedAt: new Date().toISOString(),
    source: "D1-CALCULATED"
  };
}

async function saveOperationsSnapshot(env, payload) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO operations_snapshots (
      snapshot_key, payload_json, calculated_at, updated_at
    ) VALUES ('main', ?1, ?2, ?2)
    ON CONFLICT(snapshot_key) DO UPDATE SET
      payload_json=excluded.payload_json,
      calculated_at=excluded.calculated_at,
      updated_at=excluded.updated_at`)
    .bind(JSON.stringify(payload || {}), now).run();
  return { ...(payload || {}), calculatedAt: now, source: "D1-SNAPSHOT" };
}

export async function refreshOperationsDashboard(env) {
  const payload = await computeOperationsDashboard(env);
  try {
    return await saveOperationsSnapshot(env, payload);
  } catch {
    return payload;
  }
}

export async function adjustOperationsDashboard(env, adjustments = {}) {
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT payload_json FROM operations_snapshots WHERE snapshot_key='main' LIMIT 1"
    ).first();
  } catch {
    return refreshOperationsDashboard(env);
  }
  if (!row) return refreshOperationsDashboard(env);
  const payload = parseJson(row.payload_json, {});
  const pairs = [
    ["activeMaster", "activeMaster"], ["master", "activeMaster"],
    ["raw", "raw"], ["pendingReview", "pendingReview"], ["review", "pendingReview"],
    ["history", "history"]
  ];
  for (const [target, source] of pairs) {
    const delta = Number(adjustments[source] || 0);
    if (delta) payload[target] = Math.max(0, Number(payload[target] || 0) + delta);
  }
  return saveOperationsSnapshot(env, payload);
}

async function operationsDashboard(env) {
  try {
    const row = await env.DB.prepare(`SELECT payload_json, calculated_at
      FROM operations_snapshots WHERE snapshot_key='main' LIMIT 1`).first();
    if (!row) return refreshOperationsDashboard(env);
    return {
      ...parseJson(row.payload_json, {}),
      calculatedAt: row.calculated_at || "",
      source: "D1-SNAPSHOT"
    };
  } catch {
    return computeOperationsDashboard(env);
  }
}

async function transactionCandidates(env) {
  const result = await env.DB.prepare(`SELECT
      l.id AS property_id, l.title, l.address, l.room, l.listing_type,
      l.deposit, l.monthly_rent, l.area_m2, l.main_source,
      COUNT(s.id) AS source_count, MAX(s.missing_count) AS missing_count,
      GROUP_CONCAT(DISTINCT s.source) AS sources, MAX(s.updated_at) AS last_checked_at
    FROM listing_sources s
    JOIN listings l ON l.id=s.listing_id
    WHERE l.status NOT IN ('deleted','계약완료')
    GROUP BY l.id
    HAVING SUM(CASE WHEN s.active=1 THEN 1 ELSE 0 END)=0
      AND MAX(s.missing_count)>=3
    ORDER BY MAX(s.updated_at) DESC, l.address, l.room
    LIMIT 500`).all();
  const candidates = (result?.results || []).map((row) => ({
    propertyId: clean(row.property_id),
    title: clean(row.title),
    address: clean(row.address),
    room: clean(row.room),
    type: clean(row.listing_type),
    deposit: number(row.deposit),
    rent: number(row.monthly_rent),
    area: number(row.area_m2),
    mainSource: clean(row.main_source),
    sourceCount: Number(row.source_count) || 0,
    missingCount: Number(row.missing_count) || 0,
    sources: clean(row.sources).split(",").map((value) => value.trim()).filter(Boolean),
    lastCheckedAt: clean(row.last_checked_at)
  }));
  return { ok: true, action: "transactionCandidates", count: candidates.length, candidates, source: "D1" };
}

const BUSINESS_HISTORY_FIELDS = [
  "title", "room", "deposit", "monthly_rent", "maintenance_fee", "premium", "area_m2",
  "landlord_phone", "tenant_phone", "operating_memo", "contacts_json"
];

const BUSINESS_HISTORY_ALIASES = {
  name: "title",
  title: "title",
  building_name: "title",
  room: "room",
  deposit: "deposit",
  rent: "monthly_rent",
  monthly_rent: "monthly_rent",
  fee: "maintenance_fee",
  maintenance_fee: "maintenance_fee",
  premium: "premium",
  area: "area_m2",
  area_m2: "area_m2",
  landlordPhone: "landlord_phone",
  landlord_phone: "landlord_phone",
  tenantPhone: "tenant_phone",
  tenant_phone: "tenant_phone",
  memo: "operating_memo",
  operating_memo: "operating_memo",
  contacts: "contacts_json",
  contacts_json: "contacts_json"
};

const BUSINESS_HISTORY_NUMBERS = new Set([
  "deposit", "monthly_rent", "maintenance_fee", "premium", "area_m2"
]);

function historyPhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return clean(value);
}

function historyContacts(value) {
  let contacts = value;
  if (typeof contacts === "string") contacts = parseJson(contacts, contacts);
  if (!Array.isArray(contacts)) return clean(contacts);
  return contacts.map((contact) => ({
    role: clean(contact?.role || contact?.type || contact?.label || contact?.name),
    phone: historyPhone(contact?.phone || contact?.number || contact?.value)
  })).filter((contact) => contact.phone)
    .sort((left, right) => `${left.role}|${left.phone}`.localeCompare(`${right.role}|${right.phone}`, "ko"));
}

function businessHistoryValue(field, value) {
  if (field === "contacts_json") return historyContacts(value);
  if (field === "landlord_phone" || field === "tenant_phone") return historyPhone(value);
  if (BUSINESS_HISTORY_NUMBERS.has(field)) {
    if (value == null || value === "") return 0;
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : clean(value);
  }
  return clean(value);
}

export function businessHistorySnapshot(value) {
  const input = value && typeof value === "object" ? value : {};
  const result = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const field = BUSINESS_HISTORY_ALIASES[key];
    if (!field) continue;
    const normalized = businessHistoryValue(field, rawValue);
    if (field === "title" && Object.prototype.hasOwnProperty.call(result, field) && key === "building_name") continue;
    result[field] = normalized;
  }
  return result;
}

export function businessHistoryDiff(beforeValue, afterValue, includeCreatedFields = false) {
  const before = businessHistorySnapshot(beforeValue);
  const after = businessHistorySnapshot(afterValue);
  const changes = [];
  for (const field of BUSINESS_HISTORY_FIELDS) {
    const hasBefore = Object.prototype.hasOwnProperty.call(before, field);
    const hasAfter = Object.prototype.hasOwnProperty.call(after, field);
    if (!hasAfter || (!hasBefore && !includeCreatedFields)) continue;
    if (!hasBefore && includeCreatedFields) {
      if (after[field] === "" || after[field] === 0 || (Array.isArray(after[field]) && !after[field].length)) continue;
      changes.push({ field, before: "", after: after[field] });
      continue;
    }
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    changes.push({ field, before: before[field], after: after[field] });
  }
  return changes;
}

async function listingHistory(env, query) {
  const limit = Math.max(20, Math.min(100, Number(query.limit) || 60));
  const cursor = Math.max(0, Number(query.cursor) || 0);
  const propertyId = clean(query.propertyId).slice(0, 100);
  const result = await env.DB.prepare(`SELECT h.id, h.listing_id, h.action, h.actor_email,
      h.before_json, h.after_json, h.created_at,
      COALESCE(l.property_id, h.listing_id) AS property_id,
      COALESCE(l.title, '') AS title, COALESCE(l.address, '') AS address,
      COALESCE(l.room, '') AS room
    FROM listing_history h
    LEFT JOIN listings l ON l.id=h.listing_id
    WHERE (?1='' OR h.listing_id=?1 OR l.property_id=?1)
      AND h.action IN ('quickAdd', 'updateProperty', 'updatePropertyMemo', 'restoreListingHistory')
      AND (?2=0 OR h.id < ?2)
    ORDER BY h.id DESC LIMIT ?3`)
    .bind(propertyId, cursor, limit + 1).all();
  const rows = result?.results || [];
  const page = rows.slice(0, limit);
  return {
    ok: true,
    action: "listingHistory",
    items: page.map((row) => {
      const before = parseJson(row.before_json, {});
      const after = parseJson(row.after_json, {});
      return {
        id: Number(row.id) || 0,
        propertyId: clean(row.property_id || row.listing_id),
        title: clean(row.title),
        address: clean(row.address),
        room: clean(row.room),
        changeAction: clean(row.action),
        actorEmail: clean(row.actor_email),
        createdAt: clean(row.created_at),
        changes: businessHistoryDiff(before, after, clean(row.action) === "quickAdd"),
        restorable: ["updateProperty", "updatePropertyMemo", "toggleDone", "deleteProperty"].includes(clean(row.action))
      };
    }).filter((item) => item.changes.length),
    nextCursor: rows.length > limit ? Number(page[page.length - 1]?.id || 0) : 0,
    source: "D1"
  };
}

async function userProfile(user) {
  return {
    ok: true,
    action: "userProfile",
    email: clean(user?.email).toLowerCase(),
    displayName: clean(user?.displayName),
    role: clean(user?.role) || "member",
    canManageUsers: ["owner", "admin"].includes(clean(user?.role)),
    canEdit: clean(user?.role) !== "viewer",
    source: "SESSION"
  };
}

async function userManagement(env, user) {
  requireRole(user, ["owner", "admin"]);
  const result = await env.DB.prepare(`SELECT email, display_name, role, active, created_at, updated_at
    FROM allowed_users ORDER BY active DESC,
      CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
      email`).all();
  const users = (result?.results || []).map((row) => ({
    email: clean(row.email).toLowerCase(),
    displayName: clean(row.display_name),
    role: clean(row.role) || "member",
    active: Number(row.active) === 1,
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
    source: "D1"
  }));
  for (const [index, email] of String(env.ALLOWED_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).entries()) {
    if (!users.some((entry) => entry.email === email)) {
      users.push({ email, displayName: "", role: index === 0 ? "owner" : "member", active: true, source: "ENV" });
    }
  }
  return { ok: true, action: "userManagement", users, source: "D1+ENV" };
}

export async function handleD1GetAction(env, user, query) {
  const action = clean(query.action);
  if (!env.DB || !isD1GetAction(action)) return null;
  if (action === "unifiedListings") return unifiedListings(env);
  if (action === "unifiedListingDetail") return unifiedDetail(env, clean(query.propertyId).slice(0, 100));
  if (action === "unifiedListingContacts") return listingContacts(env, clean(query.propertyId).slice(0, 100));
  if (action === "tellContacts") return tellContacts(env, query.query);
  if (action === "geocodeCache") return geocodeCache(env);
  if (action === "loadCloudState") return cloudState(env, user, query);
  if (action === "announcement") return announcement(env);
  if (action === "checkDuplicate") return duplicateCheck(env, parseJson(query.values, []));
  if (action === "mutationStatus") return mutationStatus(env, query.requestId);
  if (action === "workQueueStatus") return workQueueStatus(env, user);
  if (action === "customerWorkspace") return customerWorkspace(env, query.customerId);
  if (action === "customerMatches") return customerMatches(env, query.customerId);
  if (action === "operationsDashboard") return operationsDashboard(env);
  if (action === "transactionCandidates") return transactionCandidates(env);
  if (action === "listingChanges") return listingChanges(env, query);
  if (action === "listingHistory") return listingHistory(env, query);
  if (action === "userProfile") return userProfile(user);
  if (action === "userManagement") return userManagement(env, user);
  return null;
}

async function recordMutation(env, user, action, requestId, result, state = "completed") {
  const id = clean(requestId || `${action}-${crypto.randomUUID()}`).slice(0, 160);
  await env.DB.prepare(`INSERT INTO mutation_results (
      request_id, owner_email, action, state, result_json, created_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now', '+7 days'))
    ON CONFLICT(request_id) DO UPDATE SET state=excluded.state, result_json=excluded.result_json`)
    .bind(id, clean(user?.email).toLowerCase(), action, state, JSON.stringify(result || {}), new Date().toISOString()).run();
  return id;
}

async function updateProperty(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare("SELECT * FROM listings WHERE property_id = ?1").bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const value = body.updated && typeof body.updated === "object" ? body.updated : {};
  const reconciledContacts = reconcileMemoContacts(before.main_source, value.contacts, value.memo);
  const beforeHistory = {
    title: before.title, room: before.room, deposit: before.deposit, monthly_rent: before.monthly_rent,
    maintenance_fee: before.maintenance_fee, premium: before.premium, area_m2: before.area_m2,
    landlord_phone: before.landlord_phone, tenant_phone: before.tenant_phone,
    operating_memo: before.operating_memo, contacts_json: before.contacts_json
  };
  const afterHistory = {
    title: clean(value.name), room: canonicalListingRoom(value.room), deposit: number(value.deposit),
    monthly_rent: number(value.rent), maintenance_fee: number(value.fee), premium: number(value.premium),
    area_m2: number(value.area), landlord_phone: clean(value.landlordPhone),
    tenant_phone: clean(value.tenantPhone), operating_memo: clean(value.memo),
    contacts_json: JSON.stringify(reconciledContacts)
  };
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET
      title=?1, building_name=?1, room=?2, deposit=?3, monthly_rent=?4, maintenance_fee=?5,
      premium=?6, area_m2=?7, landlord_phone=?8, tenant_phone=?9, operating_memo=?10,
      status=?11, contacts_json=?12, version=version+1, updated_at=?13 WHERE property_id=?14`)
      .bind(clean(value.name), canonicalListingRoom(value.room), number(value.deposit), number(value.rent), number(value.fee),
        number(value.premium), number(value.area), clean(value.landlordPhone), clean(value.tenantPhone),
        clean(value.memo), clean(value.state) || "active", JSON.stringify(reconciledContacts), now, propertyId),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      VALUES (?1, 'updateProperty', ?2, ?3, ?4)`)
      .bind(before.id || propertyId, clean(user?.email), JSON.stringify(beforeHistory), JSON.stringify(afterHistory))
  ]);
  return { ok: true, persisted: true, queued: false, propertyId, updated: value,
    operationAdjustments: { history: 1 }, source: "D1" };
}

async function updateMemo(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare(`SELECT id, main_source, contacts_json
    FROM listings WHERE property_id=?1 LIMIT 1`).bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const contacts = reconcileMemoContacts(before.main_source, body.contacts, body.memo);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
    SELECT id, 'updatePropertyMemo', ?1,
      json_object('operating_memo', operating_memo, 'contacts_json', contacts_json),
      json_object('operating_memo', ?2, 'contacts_json', ?3)
    FROM listings WHERE property_id=?4 LIMIT 1`)
    .bind(clean(user?.email), clean(body.memo), JSON.stringify(contacts), propertyId).run();
  const result = await env.DB.prepare(`UPDATE listings SET operating_memo=?1, contacts_json=?2,
    version=version+1, updated_at=?3 WHERE property_id=?4`)
    .bind(clean(body.memo), JSON.stringify(contacts), now, propertyId).run();
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  return { ok: true, persisted: true, queued: false, propertyId, memo: clean(body.memo), contacts,
    operationAdjustments: { history: 1 }, source: "D1" };
}

async function toggleDone(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare(`SELECT id, property_id, status, operating_memo
    FROM listings WHERE property_id=?1 LIMIT 1`).bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const after = { status: clean(body.state) || "active", operating_memo: clean(body.memo) };
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET status=?1, operating_memo=?2,
      version=version+1, updated_at=?3 WHERE property_id=?4`)
      .bind(after.status, after.operating_memo, now, propertyId),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      VALUES (?1, 'toggleDone', ?2, ?3, ?4)`)
      .bind(before.id || propertyId, clean(user?.email), JSON.stringify(before), JSON.stringify(after))
  ]);
  const result = results?.[0];
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  return { ok: true, persisted: true, queued: false, propertyId, state: after.status, memo: after.operating_memo,
    operationAdjustments: { history: 1 }, source: "D1" };
}

async function deleteProperty(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare(`SELECT id, property_id, status FROM listings
    WHERE property_id=?1 LIMIT 1`).bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET status='deleted', version=version+1, updated_at=?1
      WHERE property_id=?2`).bind(now, propertyId),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      VALUES (?1, 'deleteProperty', ?2, ?3, ?4)`)
      .bind(before.id || propertyId, clean(user?.email), JSON.stringify(before), JSON.stringify({ status: "deleted" }))
  ]);
  const result = results?.[0];
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  return { ok: true, persisted: true, queued: false, deleted: true, propertyId,
    operationAdjustments: { activeMaster: -1, history: 1 }, source: "D1" };
}

async function quickAdd(env, user, body) {
  const values = Array.isArray(body.values) ? body.values : [];
  const duplicate = await duplicateCheck(env, values);
  /* 같은 주소라도 층·호실·조건·평수가 다른 별도 매물은 정상 등록합니다. */
  if (duplicate.duplicateType === "exact" && !body.forceDuplicate) {
    return { ...duplicate, persisted: false };
  }
  const propertyId = clean(values[15]) || `M-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO listings (
    id, property_id, status, main_source, title, address, building_name, room, listing_type,
    deposit, monthly_rent, maintenance_fee, premium, area_m2, landlord_phone, tenant_phone,
    operating_memo, first_collected_at, source_url, contacts_json, registration_at, last_collected_at, updated_at
  ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
    ?15, ?16, ?17, ?18, ?19, ?20, ?20)`)
    .bind(propertyId, clean(values[12]) || "active", clean(values[14]) || "직접등록", clean(values[0]),
      clean(values[1]), canonicalListingRoom(values[2]), clean(values[3]), number(values[4]), number(values[5]),
      number(values[6]), number(values[7]), number(values[8]), clean(values[9]), clean(values[10]),
      clean(values[11]), clean(values[13]) || now, clean(values[16]), clean(values[17]) || "[]",
      clean(values[23]) || now, clean(values[24]) || now).run();
  await env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
    VALUES (?1, 'quickAdd', ?2, '{}', ?3)`)
    .bind(propertyId, clean(user?.email), JSON.stringify({
      title: clean(values[0]), room: canonicalListingRoom(values[2]), deposit: number(values[4]),
      monthly_rent: number(values[5]), maintenance_fee: number(values[6]), premium: number(values[7]),
      area_m2: number(values[8]), landlord_phone: clean(values[9]), tenant_phone: clean(values[10]),
      operating_memo: clean(values[11]), contacts_json: clean(values[17]) || "[]"
    })).run();
  return { ok: true, persisted: true, queued: false, propertyId,
    operationAdjustments: { activeMaster: 1, history: 1 }, source: "D1" };
}

async function saveCloudState(env, user, body) {
  const owner = clean(user?.email).toLowerCase();
  const scope = clean(body.scope).slice(0, 100);
  const recordKey = clean(body.recordKey || "default").slice(0, 100);
  const version = Math.max(1, Number(body.version) || Date.now());
  const now = new Date().toISOString();
  if (ACCOUNT_LIST_SCOPES.has(scope) && Array.isArray(body.data)) {
    const deletionScope = cloudDeletionScope(scope);
    const existingDeletedRow = await env.DB.prepare(`SELECT value_json FROM cloud_state
      WHERE owner_email = ?1 AND scope = ?2 AND record_key = ?3`)
      .bind(owner, deletionScope, recordKey).first();
    const deletedIds = mergeCloudDeletionIds(
      parseJson(existingDeletedRow?.value_json, {}),
      body.deletedIds
    );
    const data = filterCloudDeletedLists(body.data, deletedIds);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
          value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at`)
        .bind(owner, scope, recordKey, JSON.stringify(data), version, now),
      env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
          value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at`)
        .bind(owner, deletionScope, recordKey, JSON.stringify(deletedIds), version, now)
    ]);
    return { ok: true, persisted: true, queued: false, scope, recordKey,
      data, deletedIds, version, updatedAt: now, source: "D1" };
  }
  await env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
      value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at`)
    .bind(owner, scope, recordKey, JSON.stringify(body.data ?? null), version, now).run();
  return { ok: true, persisted: true, queued: false, scope, recordKey, version, updatedAt: now, source: "D1" };
}

async function saveGeocode(env, body) {
  const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 500);
  if (!entries.length) return { ok: true, persisted: true, saved: 0, source: "D1" };
  const now = new Date().toISOString();
  const statements = entries.map((entry) => {
    const address = clean(entry.address);
    return env.DB.prepare(`INSERT INTO geocode_cache (
      cache_key, address, latitude, longitude, provider, payload_json, checked_at
    ) VALUES (?1, ?1, ?2, ?3, 'kakao', ?4, ?5)
    ON CONFLICT(cache_key) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude,
      payload_json=excluded.payload_json, checked_at=excluded.checked_at`)
      .bind(address, number(entry.lat), number(entry.lng), JSON.stringify(entry), now);
  });
  await env.DB.batch(statements);
  return { ok: true, persisted: true, saved: statements.length, source: "D1" };
}

function numberOr(value, fallback) {
  return value == null || value === "" ? number(fallback) : number(value);
}

export function separatedMasterValues(sourceRow, parent, newId) {
  const raw = parseJson(sourceRow?.raw_json, {});
  const snapshot = parseJson(sourceRow?.list_snapshot_json, {});
  const original = { ...raw, ...snapshot };
  const contacts = Array.isArray(original.contacts) ? original.contacts : parseJson(parent?.contacts_json, []);
  const id = clean(newId) || `M-${crypto.randomUUID()}`;
  return {
    id,
    source: clean(sourceRow?.source || original.source || parent?.main_source) || "직접등록",
    title: clean(original.buildingName || original.name || parent?.building_name || parent?.title) || "일반상가",
    address: clean(original.address || parent?.address),
    room: canonicalListingRoom(original.room || parent?.room),
    listingType: clean(original.type || original.category || parent?.listing_type),
    deposit: numberOr(original.deposit, parent?.deposit),
    rent: numberOr(original.rent ?? original.monthly, parent?.monthly_rent),
    fee: numberOr(original.fee ?? original.managementFee, parent?.maintenance_fee),
    premium: numberOr(original.premium, parent?.premium),
    area: numberOr(original.area, parent?.area_m2),
    latitude: numberOr(original.latitude ?? original.lat, parent?.latitude),
    longitude: numberOr(original.longitude ?? original.lng, parent?.longitude),
    memo: clean(original.memo || parent?.operating_memo),
    link: clean(sourceRow?.source_url || original.link || parent?.source_url),
    contactsJson: JSON.stringify(Array.isArray(contacts) ? contacts : []),
    firstCollectedAt: clean(sourceRow?.first_collected_at || original.firstSeen || parent?.first_collected_at),
    registrationAt: clean(original.registrationAt || original.firstSeen || parent?.registration_at),
    lastCollectedAt: clean(sourceRow?.last_collected_at || original.lastSeen || parent?.last_collected_at),
    revision: Math.max(1, Number(original.revision) || 1)
  };
}

function remainingSourcePriority(source) {
  const value = clean(source);
  if (value === "당근") return 0;
  if (value === "네이버") return 1;
  if (value === "공실박스") return 2;
  return 3;
}

export function remainingMasterValues(sourceRows, parent, masterId) {
  const groups = new Map();
  for (const [index, sourceRow] of (Array.isArray(sourceRows) ? sourceRows : []).entries()) {
    const value = separatedMasterValues(sourceRow, parent, masterId);
    const signature = `${value.deposit}|${value.rent}`;
    const priority = remainingSourcePriority(value.source);
    const current = groups.get(signature);
    if (!current) {
      groups.set(signature, { count: 1, value, priority, index });
      continue;
    }
    current.count += 1;
    if (priority < current.priority) {
      current.value = value;
      current.priority = priority;
      current.index = index;
    }
  }
  const ranked = [...groups.values()].sort((left, right) =>
    right.count - left.count || left.priority - right.priority || left.index - right.index);
  return ranked[0]?.value || null;
}

function refreshMasterTermsStatement(env, value, masterId, now) {
  return env.DB.prepare(`UPDATE listings SET deposit=?1, monthly_rent=?2,
      maintenance_fee=?3, premium=?4, area_m2=?5, version=version+1, updated_at=?6
    WHERE id=?7 AND status<>'deleted'`)
    .bind(value.deposit, value.rent, value.fee, value.premium, value.area, now, masterId);
}

async function moveOriginal(env, user, body) {
  const originalId = clean(body.originalId).slice(0, 160);
  const targetMasterId = clean(body.targetMasterId).slice(0, 100);
  const source = await env.DB.prepare(`SELECT s.*, l.main_source, l.title, l.address, l.building_name,
      l.room, l.listing_type, l.deposit, l.monthly_rent, l.maintenance_fee, l.premium,
      l.area_m2, l.latitude, l.longitude, l.operating_memo, l.source_url AS master_source_url,
      l.contacts_json, l.first_collected_at AS master_first_collected_at,
      l.registration_at, l.last_collected_at AS master_last_collected_at
    FROM listing_sources s JOIN listings l ON l.id=s.listing_id
    WHERE s.id=?1 AND s.active=1 AND l.status<>'deleted' LIMIT 1`).bind(originalId).first();
  if (!source) throw Object.assign(new Error("분리할 원본매물을 찾을 수 없습니다."), { statusCode: 404 });
  const sourceSnapshot = parseJson(source.list_snapshot_json, {});
  const expectedRevision = Math.max(0, Number(body.expectedRevision) || 0);
  const currentRevision = Math.max(1, Number(sourceSnapshot.revision) || 1);
  if (expectedRevision && expectedRevision !== currentRevision) {
    throw Object.assign(new Error("원본매물이 갱신되었습니다. 상세창을 다시 열고 시도해 주세요."), { statusCode: 409 });
  }
  const now = new Date().toISOString();
  const sourceParent = {
    ...source,
    source_url: source.master_source_url,
    first_collected_at: source.master_first_collected_at,
    last_collected_at: source.master_last_collected_at
  };
  const remainingResult = await env.DB.prepare(`SELECT * FROM listing_sources
    WHERE listing_id=?1 AND id<>?2 AND active=1
    ORDER BY last_collected_at DESC, rowid DESC`).bind(source.listing_id, originalId).all();
  const remainingValue = remainingMasterValues(
    remainingResult?.results || [], sourceParent, source.listing_id);
  if (targetMasterId === "NEW") {
    const newMasterId = `M-${crypto.randomUUID()}`;
    const value = separatedMasterValues(source, sourceParent, newMasterId);
    const statements = [
      env.DB.prepare(`INSERT INTO listings (
          id, property_id, status, main_source, title, address, building_name, room, listing_type,
          deposit, monthly_rent, maintenance_fee, premium, area_m2, latitude, longitude,
          operating_memo, source_url, contacts_json, first_collected_at, registration_at,
          last_collected_at, created_at, updated_at
        ) VALUES (?1, ?1, 'active', ?2, ?3, ?4, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
          ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)`)
        .bind(value.id, value.source, value.title, value.address, value.room, value.listingType,
          value.deposit, value.rent, value.fee, value.premium, value.area, value.latitude,
          value.longitude, value.memo, value.link, value.contactsJson,
          value.firstCollectedAt || now, value.registrationAt || now, value.lastCollectedAt || now, now),
      env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,
          list_snapshot_json=json_set(list_snapshot_json, '$.propertyId', ?1), updated_at=?2 WHERE id=?3`)
        .bind(value.id, now, originalId),
      env.DB.prepare("UPDATE listing_media SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
        .bind(value.id, now, originalId),
      env.DB.prepare("UPDATE listing_contacts SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
        .bind(value.id, now, originalId),
      env.DB.prepare(`INSERT INTO listing_history (
          listing_id, source_id, action, actor_email, before_json, after_json
        ) VALUES (?1, ?2, 'separateOriginalListing', ?3, ?4, ?5)`)
        .bind(value.id, originalId, clean(user?.email) || "web",
          JSON.stringify({ sourceMasterId: source.listing_id }),
          JSON.stringify({ targetMasterId: value.id, separatedAt: now }))
    ];
    if (remainingValue) {
      statements.push(refreshMasterTermsStatement(env, remainingValue, source.listing_id, now));
    }
    statements.push(
      env.DB.prepare(`UPDATE listings SET status='deleted', version=version+1, updated_at=?1
        WHERE id=?2 AND NOT EXISTS (SELECT 1 FROM listing_sources WHERE listing_id=?2)`)
        .bind(now, source.listing_id)
    );
    const results = await env.DB.batch(statements);
    const sourceMasterRemoved = Number(results?.[results.length - 1]?.meta?.changes || 0) > 0;
    return { ok: true, persisted: true, queued: false, separated: true, originalId,
      propertyId: value.id, sourceMasterId: source.listing_id, targetMasterId: value.id,
      sourceMasterRemoved, sourceMasterRefreshed: !!remainingValue,
      operationAdjustments: { activeMaster: sourceMasterRemoved ? 0 : 1, history: 1 }, source: "D1" };
  }
  const target = await env.DB.prepare("SELECT id FROM listings WHERE id=?1 AND status <> 'deleted'")
    .bind(targetMasterId).first();
  if (!target) throw Object.assign(new Error("통합할 대상매물을 찾을 수 없습니다."), { statusCode: 404 });
  const statements = [
    env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,
        list_snapshot_json=json_set(list_snapshot_json, '$.propertyId', ?1), updated_at=?2 WHERE id=?3`)
      .bind(targetMasterId, now, originalId),
    env.DB.prepare("UPDATE listing_media SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
      .bind(targetMasterId, now, originalId),
    env.DB.prepare("UPDATE listing_contacts SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
      .bind(targetMasterId, now, originalId)
  ];
  if (remainingValue) {
    statements.push(refreshMasterTermsStatement(env, remainingValue, source.listing_id, now));
  }
  statements.push(
    env.DB.prepare(`UPDATE listings SET status='deleted', version=version+1, updated_at=?1
      WHERE id=?2 AND id<>?3
        AND NOT EXISTS (SELECT 1 FROM listing_sources WHERE listing_id=?2)`)
      .bind(now, source.listing_id, targetMasterId)
  );
  const results = await env.DB.batch(statements);
  const sourceMasterRemoved = Number(results?.[results.length - 1]?.meta?.changes || 0) > 0;
  if (sourceMasterRemoved) {
    await env.DB.prepare(`INSERT INTO listing_history (
        listing_id, source_id, action, actor_email, before_json, after_json
      ) VALUES (?1, ?2, 'emptyMasterRemovedAfterMove', ?3, ?4, ?5)`)
      .bind(source.listing_id, originalId, clean(user?.email) || "web",
        JSON.stringify({ sourceMasterId: source.listing_id }),
        JSON.stringify({ targetMasterId, removedAt: now })).run();
  }
  return { ok: true, persisted: true, queued: false, originalId, sourceMasterId: source.listing_id,
    targetMasterId, sourceMasterRemoved, sourceMasterRefreshed: !!remainingValue,
    operationAdjustments: { activeMaster: sourceMasterRemoved ? -1 : 0, history: sourceMasterRemoved ? 1 : 0 }, source: "D1" };
}

function splitRequirement(value) {
  return clean(value).split(/[,/|]/).map((item) => item.trim()).filter(Boolean);
}

function nullableRequirementNumber(value) {
  const valueText = clean(value);
  if (!valueText) return null;
  const parsed = Number(valueText.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateCustomerListing(requirements, row) {
  const regions = splitRequirement(requirements.regions);
  const types = splitRequirement(requirements.types);
  const requiredTags = splitRequirement(requirements.requiredTags);
  const preferredTags = splitRequirement(requirements.preferredTags);
  const excludedTags = splitRequirement(requirements.excludedTags);
  const searchable = [row.title, row.address, row.road_address, row.building_name, row.listing_type,
    row.operating_memo, row.search_tags].map(clean).join(" ").toLowerCase();
  if (regions.length && !regions.some((item) => searchable.includes(item.toLowerCase()))) return null;
  if (types.length && !types.some((item) => searchable.includes(item.toLowerCase()))) return null;
  if (requiredTags.some((item) => !searchable.includes(item.toLowerCase()))) return null;
  if (excludedTags.some((item) => searchable.includes(item.toLowerCase()))) return null;

  const deposit = Number(row.deposit) || 0;
  const rent = Number(row.monthly_rent) || 0;
  const premium = Number(row.premium) || 0;
  const area = Number(row.area_m2) || 0;
  const floor = listingFloor(row);
  const limits = {
    depositMin: nullableRequirementNumber(requirements.depositMin),
    depositMax: nullableRequirementNumber(requirements.depositMax),
    rentMin: nullableRequirementNumber(requirements.rentMin),
    rentMax: nullableRequirementNumber(requirements.rentMax),
    premiumMax: nullableRequirementNumber(requirements.premiumMax),
    areaMin: nullableRequirementNumber(requirements.areaMin),
    areaMax: nullableRequirementNumber(requirements.areaMax),
    floorMin: nullableRequirementNumber(requirements.floorMin),
    floorMax: nullableRequirementNumber(requirements.floorMax)
  };
  if (limits.depositMin != null && deposit < limits.depositMin) return null;
  if (limits.depositMax != null && deposit > limits.depositMax) return null;
  if (limits.rentMin != null && rent < limits.rentMin) return null;
  if (limits.rentMax != null && rent > limits.rentMax) return null;
  if (limits.premiumMax != null && premium > limits.premiumMax) return null;
  if (limits.areaMin != null && area < limits.areaMin) return null;
  if (limits.areaMax != null && area > limits.areaMax) return null;
  if (!floorMatchesBounds(floor, limits.floorMin, limits.floorMax)) return null;

  let score = 70;
  if (regions.length) score += 8;
  if (types.length) score += 7;
  if (requiredTags.length) score += Math.min(9, requiredTags.length * 3);
  score += Math.min(6, preferredTags.filter((item) => searchable.includes(item.toLowerCase())).length * 2);
  if (limits.depositMax != null && limits.depositMax > 0) score += Math.max(0, 3 - Math.round(deposit / limits.depositMax * 3));
  if (limits.rentMax != null && limits.rentMax > 0) score += Math.max(0, 3 - Math.round(rent / limits.rentMax * 3));
  return Math.min(100, score);
}

export async function refreshCustomerMatchesForListings(env, listingIds = []) {
  const ids = [...new Set((Array.isArray(listingIds) ? listingIds : [listingIds]).map(clean).filter(Boolean))].slice(0, 500);
  if (!ids.length) return { listings: 0, evaluated: 0, matched: 0, removed: 0 };
  const customers = await allPages(env, `SELECT id, requirements_json FROM customers
    WHERE status NOT IN ('계약완료','종료') ORDER BY updated_at DESC`, 500);
  const listings = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const page = await env.DB.prepare(`SELECT id, property_id, title, address, road_address, building_name,
        listing_type, floor, room, deposit, monthly_rent, premium, area_m2, operating_memo, search_tags, status
      FROM listings WHERE id IN (${placeholders})`).bind(...chunk).all();
    listings.push(...(page?.results || []));
  }
  const byId = new Map(listings.map((listing) => [clean(listing.id), listing]));
  const statements = [];
  const now = new Date().toISOString();
  let matched = 0;
  let removed = 0;
  for (const listingId of ids) {
    const listing = byId.get(listingId);
    for (const customer of customers) {
      const score = listing && clean(listing.status) !== "deleted"
        ? evaluateCustomerListing(requirementsFromCustomer(customer), listing)
        : null;
      if (score == null) {
        statements.push(env.DB.prepare(`DELETE FROM customer_matches
          WHERE customer_id=?1 AND listing_id=?2 AND state IN ('candidate','신규')`).bind(customer.id, listingId));
        removed += 1;
      } else {
        statements.push(env.DB.prepare(`INSERT INTO customer_matches (
            customer_id, listing_id, state, score, memo, created_at, updated_at
          ) VALUES (?1, ?2, '신규', ?3, '', ?4, ?4)
          ON CONFLICT(customer_id, listing_id) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at`)
          .bind(customer.id, listingId, score, now));
        matched += 1;
      }
    }
  }
  for (let offset = 0; offset < statements.length; offset += 80) await env.DB.batch(statements.slice(offset, offset + 80));
  return { listings: ids.length, evaluated: ids.length * customers.length, matched, removed };
}

async function rebuildCustomerMatches(env, customerId = "") {
  const requested = clean(customerId);
  const customers = requested
    ? (await env.DB.prepare(`SELECT id, requirements_json FROM customers WHERE id=?1`).bind(requested).all())?.results || []
    : await allPages(env, `SELECT id, requirements_json FROM customers
        WHERE status NOT IN ('계약완료','종료') ORDER BY updated_at DESC`, 500);
  const listings = await allPages(env, `SELECT id, property_id, title, address, road_address, building_name,
      listing_type, floor, room, deposit, monthly_rent, premium, area_m2, operating_memo, search_tags
    FROM listings WHERE status <> 'deleted'`, 3_000);
  let rebuilt = 0;
  let matchCount = 0;
  for (const customer of customers) {
    const requirements = requirementsFromCustomer(customer);
    const candidates = listings.map((listing) => ({ listing, score: evaluateCustomerListing(requirements, listing) }))
      .filter((item) => item.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 800);
    await env.DB.prepare(`DELETE FROM customer_matches
      WHERE customer_id=?1 AND state IN ('candidate','신규')`).bind(customer.id).run();
    const now = new Date().toISOString();
    for (let offset = 0; offset < candidates.length; offset += 50) {
      await env.DB.batch(candidates.slice(offset, offset + 50).map(({ listing, score }) => env.DB.prepare(`INSERT INTO customer_matches (
          customer_id, listing_id, state, score, memo, created_at, updated_at
        ) VALUES (?1, ?2, '신규', ?3, '', ?4, ?4)
        ON CONFLICT(customer_id, listing_id) DO UPDATE SET
          score=excluded.score, updated_at=excluded.updated_at`)
        .bind(customer.id, listing.id, score, now)));
    }
    rebuilt += 1;
    matchCount += candidates.length;
  }
  return { rebuilt, matchCount };
}

function customerRequirementsFromInput(input, previous = {}) {
  return {
    regions: clean(input["희망지역"] ?? previous.regions),
    types: clean(input["희망구분"] ?? previous.types),
    depositMin: clean(input["보증금최소"] ?? previous.depositMin),
    depositMax: clean(input["보증금최대"] ?? previous.depositMax),
    rentMin: clean(input["월세최소"] ?? previous.rentMin),
    rentMax: clean(input["월세최대"] ?? previous.rentMax),
    premiumMax: clean(input["권리금최대"] ?? previous.premiumMax),
    areaMin: clean(input["평수최소"] ?? previous.areaMin),
    areaMax: clean(input["평수최대"] ?? previous.areaMax),
    floorMin: clean(input["최저층"] ?? previous.floorMin),
    floorMax: clean(input["최고층"] ?? previous.floorMax),
    requiredTags: clean(input["필수태그"] ?? previous.requiredTags),
    preferredTags: clean(input["선호태그"] ?? previous.preferredTags),
    excludedTags: clean(input["제외태그"] ?? previous.excludedTags),
    manager: clean(input["담당자"] ?? previous.manager),
    conditionVersion: Math.max(1, Number(previous.conditionVersion) || 0) + 1
  };
}

async function insertCustomerActivity(env, user, values) {
  const id = `CA-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const stage = clean(values.stage) || "상담";
  await env.DB.prepare(`INSERT INTO customer_activities (
      id, customer_id, stage, source, memo, next_contact_date, actor_email, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, clean(values.customerId), stage, clean(values.source) || "web", clean(values.memo),
      clean(values.nextContactDate), clean(user?.email), now).run();
  if (["미팅완료", "임장"].includes(stage)) {
    await env.DB.prepare(`UPDATE customers SET status='미팅후', updated_at=?1 WHERE id=?2`)
      .bind(now, clean(values.customerId)).run();
  }
  return {
    id,
    customer_id: clean(values.customerId),
    stage,
    source: clean(values.source) || "web",
    memo: clean(values.memo),
    next_contact_date: clean(values.nextContactDate),
    actor_email: clean(user?.email),
    created_at: now
  };
}

async function saveCustomer(env, user, body) {
  const input = body.customer && typeof body.customer === "object" ? body.customer : {};
  const customerId = clean(body.customerId) || `C-${crypto.randomUUID()}`;
  const existing = await env.DB.prepare(`SELECT * FROM customers WHERE id=?1`).bind(customerId).first();
  const previousRequirements = requirementsFromCustomer(existing);
  const requirements = customerRequirementsFromInput(input, previousRequirements);
  if (!existing) requirements.conditionVersion = 1;
  const name = clean(input["고객명/상호"] ?? existing?.name);
  if (!name) throw Object.assign(new Error("고객명/상호를 입력해주세요."), { statusCode: 400 });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customers (id, name, phone, status, requirements_json, memo, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, status=excluded.status,
      requirements_json=excluded.requirements_json, memo=excluded.memo, updated_at=excluded.updated_at`)
    .bind(customerId, name, clean(input["연락처"] ?? existing?.phone),
      clean(input["상태"] ?? existing?.status) || "미팅전", JSON.stringify(requirements),
      clean(input["요청사항"] ?? existing?.memo), existing?.created_at || now).run();
  let savedActivity = null;
  if (clean(body.consultationMemo) || clean(body.nextContactDate)) {
    savedActivity = await insertCustomerActivity(env, user, {
      customerId,
      stage: "상담",
      source: "customerSave",
      memo: body.consultationMemo,
      nextContactDate: body.nextContactDate
    });
  }
  const rebuilt = await rebuildCustomerMatches(env, customerId);
  const updated = await env.DB.prepare(`SELECT * FROM customers WHERE id=?1`).bind(customerId).first();
  const matches = await customerMatchRecords(env, customerId);
  const allMatches = await customerMatchRecords(env);
  const result = {
    ok: true,
    action: "saveCustomer",
    persisted: true,
    queued: false,
    customerId,
    customerHeaders: CUSTOMER_HEADERS,
    customerRow: customerRow(updated),
    matchHeaders: MATCH_HEADERS,
    matches: matches.map(matchRow),
    matchSummary: summarizeMatches(allMatches),
    activityHeaders: ACTIVITY_HEADERS,
    activityRow: savedActivity ? activityRow(savedActivity) : null,
    rebuilt: rebuilt.rebuilt,
    matchCount: rebuilt.matchCount,
    source: "D1"
  };
  if (!body.compactResponse) result.workspace = await customerWorkspace(env, customerId);
  return result;
}

export async function deleteCustomer(env, body) {
  const customerId = clean(body.customerId).slice(0, 100);
  if (!customerId) throw Object.assign(new Error("삭제할 고객을 선택해 주세요."), { statusCode: 400 });
  const customer = await env.DB.prepare(`SELECT id, name FROM customers WHERE id=?1 LIMIT 1`)
    .bind(customerId).first();
  if (!customer) throw Object.assign(new Error("삭제할 고객을 찾을 수 없습니다."), { statusCode: 404 });
  const related = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM customer_matches WHERE customer_id=?1) AS match_count,
      (SELECT COUNT(*) FROM customer_activities WHERE customer_id=?1) AS activity_count`)
    .bind(customerId).first();
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_matches WHERE customer_id=?1").bind(customerId),
    env.DB.prepare("DELETE FROM customer_activities WHERE customer_id=?1").bind(customerId),
    env.DB.prepare("DELETE FROM customers WHERE id=?1").bind(customerId)
  ]);
  if (!Number(results?.[2]?.meta?.changes || 0)) {
    throw Object.assign(new Error("고객 삭제를 완료하지 못했습니다."), { statusCode: 409 });
  }
  return {
    ok: true,
    action: "deleteCustomer",
    persisted: true,
    queued: false,
    deleted: true,
    customerId,
    customerName: clean(customer.name),
    deletedMatches: Number(related?.match_count || 0),
    deletedActivities: Number(related?.activity_count || 0),
    source: "D1"
  };
}

async function updateCustomerMatch(env, body) {
  const customerId = clean(body.customerId);
  const propertyId = clean(body.masterId || body.propertyId);
  const listing = await env.DB.prepare(`SELECT id FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1`)
    .bind(propertyId).first();
  if (!customerId || !listing) throw Object.assign(new Error("고객 또는 매칭 매물을 찾을 수 없습니다."), { statusCode: 404 });
  const state = displayMatchState(body.status);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customer_matches (
      customer_id, listing_id, state, score, memo, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 0, '', ?4, ?4)
    ON CONFLICT(customer_id, listing_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`)
    .bind(customerId, listing.id, state, now).run();
  return {
    ok: true,
    action: "updateCustomerMatch",
    persisted: true,
    queued: false,
    customerId,
    propertyId,
    matchId: matchId(customerId, listing.id),
    status: state,
    source: "D1"
  };
}

async function addCustomerActivity(env, user, body) {
  const customerId = clean(body.customerId);
  const customer = await env.DB.prepare(`SELECT id FROM customers WHERE id=?1`).bind(customerId).first();
  if (!customer) throw Object.assign(new Error("고객을 찾을 수 없습니다."), { statusCode: 404 });
  const saved = await insertCustomerActivity(env, user, body);
  return {
    ok: true,
    action: "addCustomerActivity",
    persisted: true,
    queued: false,
    stage: saved.stage,
    activityHeaders: ACTIVITY_HEADERS,
    activityRow: activityRow(saved),
    source: "D1"
  };
}

async function saveAllowedUser(env, user, body) {
  requireRole(user, ["owner", "admin"]);
  const email = clean(body.email).toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("올바른 이메일 주소를 입력해 주세요."), { statusCode: 400 });
  }
  const requestedRole = clean(body.role) || "member";
  const allowedRoles = clean(user?.role) === "owner"
    ? new Set(["admin", "member", "viewer"])
    : new Set(["member", "viewer"]);
  if (!allowedRoles.has(requestedRole)) {
    throw Object.assign(new Error("해당 권한을 지정할 수 없습니다."), { statusCode: 403 });
  }
  const active = body.active === false ? 0 : 1;
  if (email === clean(user?.email).toLowerCase() && !active) {
    throw Object.assign(new Error("현재 로그인한 계정은 비활성화할 수 없습니다."), { statusCode: 400 });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO allowed_users (
      email, display_name, role, active, created_by, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(email) DO UPDATE SET
      display_name=excluded.display_name,
      role=excluded.role,
      active=excluded.active,
      updated_at=excluded.updated_at`)
    .bind(email, clean(body.displayName).slice(0, 100), requestedRole, active,
      clean(user?.email).toLowerCase(), now).run();
  return { ok: true, action: "saveAllowedUser", persisted: true, email,
    displayName: clean(body.displayName), role: requestedRole, active: Boolean(active), source: "D1" };
}

async function restoreListingHistory(env, user, body) {
  requireRole(user, ["owner", "admin"]);
  const historyId = Math.max(1, Number(body.historyId) || 0);
  const history = await env.DB.prepare(`SELECT id, listing_id, action, before_json
    FROM listing_history WHERE id=?1 LIMIT 1`).bind(historyId).first();
  if (!history || !["updateProperty", "updatePropertyMemo", "toggleDone", "deleteProperty"].includes(clean(history.action))) {
    throw Object.assign(new Error("복구할 수 있는 변경이력이 아닙니다."), { statusCode: 400 });
  }
  const target = parseJson(history.before_json, {});
  const listing = await env.DB.prepare(`SELECT * FROM listings
    WHERE id=?1 OR property_id=?1 LIMIT 1`).bind(clean(history.listing_id)).first();
  if (!listing) throw Object.assign(new Error("복구 대상 매물을 찾을 수 없습니다."), { statusCode: 404 });
  const fieldMap = {
    title: "title", building_name: "building_name", room: "room", deposit: "deposit",
    monthly_rent: "monthly_rent", maintenance_fee: "maintenance_fee", premium: "premium",
    area_m2: "area_m2", landlord_phone: "landlord_phone", tenant_phone: "tenant_phone",
    operating_memo: "operating_memo", contacts_json: "contacts_json", status: "status"
  };
  const assignments = [];
  const values = [];
  for (const [source, column] of Object.entries(fieldMap)) {
    if (!Object.prototype.hasOwnProperty.call(target, source)) continue;
    values.push(target[source]);
    assignments.push(`${column}=?${values.length}`);
  }
  if (!assignments.length) throw Object.assign(new Error("복구할 이전 값이 없습니다."), { statusCode: 400 });
  const now = new Date().toISOString();
  values.push(now, listing.id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET ${assignments.join(", ")}, version=version+1,
      updated_at=?${values.length - 1} WHERE id=?${values.length}`).bind(...values),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      VALUES (?1, 'restoreListingHistory', ?2, ?3, ?4)`)
      .bind(listing.id, clean(user?.email), JSON.stringify(listing), JSON.stringify(target))
  ]);
  const activeDelta = clean(listing.status) === "deleted" && clean(target.status) !== "deleted" ? 1
    : clean(listing.status) !== "deleted" && clean(target.status) === "deleted" ? -1 : 0;
  return { ok: true, action: "restoreListingHistory", persisted: true,
    propertyId: clean(listing.property_id || listing.id), historyId,
    operationAdjustments: { activeMaster: activeDelta, history: 1 }, source: "D1" };
}

async function executePost(env, user, body) {
  const action = clean(body.action);
  if (action === "saveAllowedUser") return saveAllowedUser(env, user, body);
  if (action === "restoreListingHistory") return restoreListingHistory(env, user, body);
  if (action === "updatePropertyMemo") return updateMemo(env, user, body);
  if (action === "updateProperty") return updateProperty(env, user, body);
  if (action === "toggleDone") return toggleDone(env, user, body);
  if (action === "deleteProperty") return deleteProperty(env, user, body);
  if (action === "quickAdd") return quickAdd(env, user, body);
  if (action === "saveCloudState") return saveCloudState(env, user, body);
  if (action === "saveGeocodeCache") return saveGeocode(env, body);
  if (action === "moveOriginalListing") return moveOriginal(env, user, body);
  if (action === "saveCustomer") return saveCustomer(env, user, body);
  if (action === "deleteCustomer") return deleteCustomer(env, body);
  if (action === "updateCustomerMatch") return updateCustomerMatch(env, body);
  if (action === "rebuildCustomerMatches") {
    const rebuilt = await rebuildCustomerMatches(env, body.customerId);
    return { ok: true, action, persisted: true, queued: false, ...rebuilt,
      workspace: await customerWorkspace(env, body.customerId), source: "D1" };
  }
  if (action === "addCustomerActivity") return addCustomerActivity(env, user, body);
  if (action === "enqueueMutation") {
    const nested = { ...(body.payload || {}), action: clean(body.taskAction), requestId: clean(body.requestId) };
    if (!isD1PostAction(nested.action) || nested.action === "enqueueMutation") return null;
    return executePost(env, user, nested);
  }
  return null;
}

export async function handleD1PostAction(env, user, body) {
  const action = clean(body?.action);
  if (!env.DB || !isD1PostAction(action)) return null;
  const effectiveAction = action === "enqueueMutation" ? clean(body.taskAction) : action;
  if (effectiveAction !== "saveCloudState") requireRole(user, ["owner", "admin", "member"]);
  const requestId = clean(body.requestId || body?.payload?.requestId || `${action}-${crypto.randomUUID()}`).slice(0, 160);
  const result = await executePost(env, user, body);
  if (!result) return null;
  const finalResult = { ...result, requestId };
  await recordMutation(env, user, action === "enqueueMutation" ? clean(body.taskAction) : action, requestId, finalResult);
  return finalResult;
}
