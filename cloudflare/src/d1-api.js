import { canonicalListingRoom } from "./floor.js";
import {
  accessProfile,
  bootstrapOwnerEmail,
  createLocalPassword,
  normalizeLocalUsername,
  requireRole
} from "./security.js";
import { carryConfirmedVisitMemo } from "./visit-status.js";
import { listingTradeTypesCanMerge, normalizeListingTradeType } from "./listing-trade.js";
import { saveSaleWorksheet } from "./sale-worksheet.js";
import { getSaleAskingHistory } from "./sale-asking-history.js";
import { validateQuickAddTrade } from "./quick-add-trade.js";
import { previewListingHistoryRestore, restoreSelectedListingHistory } from "./listing-history-restore.js";
import { saleExtentProvider, withSaleExtentDisplay } from "./sale-extent-display.js";
import { withDaangnLandUse } from "./land-use-display.js";
import { withSaleAreaDisplay } from "./sale-area-display.js";
import { withSaleFinancialDisplay } from "./sale-financial-display.js";
import { salePropertyEditPatch } from "./sale-property-edit.js";
import { newListingPeriod } from "./new-listing-period.js";
import { loadManualRoomOverrides, loadManualRepresentativeFields, withSourceOriginalMetadata } from "./source-original-display.js";
import { sourceSnapshotParentSql, sourceSnapshotProofSql, hashSourceSnapshotRows, sourceSnapshotKeysFromReadRows } from "./source-snapshot-proof.js";
import {
  SOURCE_CANDIDATE_POLICY_VERSION, availabilityKindSql, absenceMetadataSql, candidateSourceWhereSql,
  publicSourceWhereSql, publicMasterWhereSql, publicMasterSourcesWhereSql, candidateMasterWhereSql, candidateAdCountSql
} from "./source-availability.js";

const UNIFIED_FIELDS = [
  "originalId", "source", "link", "room", "deposit", "rent", "fee", "premium", "area",
  "latitude", "longitude", "thumbnail", "photoCount", "contactCount", "revision", "preserveRepresentative",
  "masterFallback", "sourceUnavailable", "missingCount", "tradeType", "saleCategory", "salePrice", "saleSummary",
  "sourceListingId", "providerSourceId", "active", "floor", "literalRoom", "sourceFloor", "sourceRoom",
  "hasManualRoomOverride", "roomManuallyEditedV1", "lastCheckedAt", "endedAt", "candidateEligible", "availabilityKind", "manualDisplayFields", "type", "absenceConfirmedAt"
];

const D1_GET_ACTIONS = new Set([
  "announcement", "checkDuplicate", "geocodeCache", "loadCloudState", "mutationStatus",
  "tellContacts", "unifiedListingContacts", "unifiedListingDetail", "unifiedListings", "saleAskingHistory",
  "workQueueStatus", "operationsDashboard",
  "transactionCandidates", "listingChanges", "listingOriginals", "newListingPeriod", "listingHistory", "listingHistoryRestorePreview", "userManagement", "userProfile"
]);

const D1_POST_ACTIONS = new Set([
  "deleteProperty", "enqueueMutation", "moveOriginalListing", "quickAdd", "saveCloudState",
  "saveGeocodeCache", "toggleDone", "updateProperty", "updatePropertyMemo", "restoreListingHistory", "saveAllowedUser", "saveLocalAccount"
]);


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

async function allPages(env, sql, pageSize = 4_000, bindings = []) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await env.DB.prepare(`${sql} LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`)
      .bind(...bindings, pageSize, offset).all();
    const page = result?.results || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function allRowidPages(env, selectSql, tableSql, whereSql = "1 = 1", pageSize = 4_000, bindings = []) {
  const rows = [];
  let cursor = 0;
  for (;;) {
    const result = await env.DB.prepare(`SELECT rowid AS __page_cursor, ${selectSql}
      FROM ${tableSql} WHERE (${whereSql}) AND rowid > ?${bindings.length + 1} ORDER BY rowid LIMIT ?${bindings.length + 2}`)
      .bind(...bindings, cursor, pageSize).all();
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
    last_collected_at, latitude, longitude, building_elevator_capacity,
    trade_type, sale_category, sale_price, sale_details_json,
    ${sourceSnapshotProofSql()} AS source_snapshot_proof`, "listings", `status <> 'deleted'
      AND ${publicMasterSourcesWhereSql("listings")}
      AND NOT EXISTS (
        SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id = listings.id
          AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
      )`, 3_000);
  await hashSourceSnapshotRows(rows);
  const header = [
    "건물명", "주소", "호실", "구분", "보증금", "월세", "관리비", "권리금", "평수",
    "임대인연락처", "임차인연락처", "메모", "상태", "등록일", "출처", "매물ID", "원본링크",
    "연락처목록", "준공연도", "승강기", "사용승인일", "건축물확인일", "건축물상태", "등록시각",
    "최종수집시각", "위도", "경도"
  ];
  header.push("엘리베이터최대정원", "거래유형", "매매구분", "매매가", "매매상세", "원본연결키");
  const body = [header, ...rows.map((row) => [
    row.title, row.address, row.room, row.listing_type, row.deposit, row.monthly_rent,
    row.maintenance_fee, row.premium, row.area_m2, row.landlord_phone, row.tenant_phone,
    row.operating_memo, row.status, row.first_collected_at, row.main_source, row.property_id,
    row.source_url, row.contacts_json, row.building_year, row.building_elevators,
    row.building_approval_date, row.building_info_checked_at, row.building_info_status,
    row.registration_at, row.last_collected_at, row.latitude, row.longitude, row.building_elevator_capacity,
    row.trade_type, row.sale_category, row.sale_price, row.sale_details_json, row.source_snapshot_key
  ])].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `${body}\r\n`;
}

async function listingChanges(env, query) {
  const ids = [...new Set(clean(query.ids).split(",").map((value) => clean(value).slice(0, 100)).filter(Boolean))]
    .slice(0, 50);
  if (!ids.length) return { ok: true, action: "listingChanges", items: [], source: "D1" };
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(",");
  const result = await env.DB.prepare(`SELECT
      id, title, address, room, listing_type, deposit, monthly_rent, maintenance_fee, premium, area_m2,
      landlord_phone, tenant_phone, operating_memo, status, first_collected_at, main_source,
      property_id, source_url, contacts_json, building_year, building_elevators,
      building_approval_date, building_info_checked_at, building_info_status, registration_at,
      last_collected_at, latitude, longitude, building_elevator_capacity,
      trade_type, sale_category, sale_price, sale_details_json,
      ${sourceSnapshotProofSql()} AS source_snapshot_proof
    FROM listings WHERE property_id IN (${placeholders}) AND status<>'deleted'
      AND ${publicMasterSourcesWhereSql("listings")}
      AND NOT EXISTS (
        SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id = listings.id
          AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
      )`).bind(...ids).all();
  const items = result?.results || [];
  await hashSourceSnapshotRows(items);
  return { ok: true, action: "listingChanges", items, requestedIds: ids, source: "D1" };
}

async function listingOriginals(env, query) {
  const raw = clean(query.ids).split(",");
  if (!clean(query.ids) || raw.length > 50 || raw.some(id => !clean(id) || clean(id).length > 100)) {
    throw Object.assign(new Error("원본 연결 조회는 올바른 매물ID 1~50개만 지원합니다."), { statusCode: 400 });
  }
  const ids = [...new Set(raw.map(clean))];
  const changes = await listingChanges(env, { ids: ids.join(",") });
  const items = changes.items;
  const unified = await unifiedListings(env, items.map(row => row.id));
  const groups = {}, sourceSearchIds = {}, sourceSnapshotKeys = {}, sourceSnapshotPropertyIds = {};
  for (const row of items) {
    const id = clean(row.id), publicId = clean(row.property_id) || id;
    groups[publicId] = unified.groups[id] || [];
    sourceSearchIds[publicId] = unified.sourceSearchIds[id] || [];
    if (unified.sourceSnapshotKeys[id]) sourceSnapshotKeys[publicId] = unified.sourceSnapshotKeys[id];
    sourceSnapshotPropertyIds[publicId] = publicId;
  }
  const returnedIds = new Set(items.map(row => clean(row.property_id) || clean(row.id)));
  return { ok: true, action: "listingOriginals", requestedIds: ids, missingIds: ids.filter(id => !returnedIds.has(id)), items,
    unified: { ...unified, groups, sourceSearchIds, sourceSnapshotKeys, sourceSnapshotPropertyIds }, source: "D1" };
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
    const sourceId = clean(row?.source_listing_id).replace(/::(?:lease|sale)$/, "").replace(/^네이버-/i, "");
    const sourceCode = ({ "네이버": "n", "당근": "d", "공실박스": "g", "직접등록": "m", "직접확인": "m" })[clean(row?.source)] || "";
    if (!propertyId || !sourceCode || !/^\d+$/.test(sourceId)) continue;
    if (!sourceSearchIds[propertyId]) sourceSearchIds[propertyId] = [];
    const key = `${sourceCode}:${sourceId}`;
    if (!sourceSearchIds[propertyId].includes(key)) sourceSearchIds[propertyId].push(key);
  }
  return sourceSearchIds;
}

// Keep initial list payload small: no full descriptions, contacts or raw data.
export function compactSaleSummary(original) {
  if (original?.tradeType !== "sale" || !original.saleDetails) return "";
  const detail = original.saleDetails;
  const summary = {};
  if (["land", "whole_building", "unit"].includes(detail.scope)) summary.scope = detail.scope;
  for (const key of ["landAreaM2", "grossAreaM2", "exclusiveAreaM2", "buildingAreaM2", "totalDeposit", "monthlyIncome", "monthlyNetIncome", "statedMonthlyIncome", "loanAmount", "investmentAmount", "advertisedYield"]) {
    if (key === "buildingAreaM2" && (detail.scope === "land" || original.saleCategory === "land")) continue;
    const value = detail[key];
    if (!["number", "string"].includes(typeof value) || clean(value) === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) summary[key] = parsed;
  }
  if (detail.scope === "land" || original.saleCategory === "land") {
    for (const key of ["landUse", "zoning", "roadAccess", "parcelShape"]) {
      if (typeof detail[key] !== "string") continue;
      const value = detail[key].trim().replace(/\s+/g, " ").slice(0, 160);
      if (value) summary[key] = value;
    }
  } else {
    if (typeof detail.buildingUse === "string" && detail.buildingUse.trim()) summary.buildingUse = detail.buildingUse.trim().replace(/\s+/g, " ").slice(0, 160);
    summary.saleExtent = ["whole_building", "unit"].includes(detail.saleExtent) ? detail.saleExtent : "unknown";
    summary.saleExtentEvidence = typeof detail.saleExtentEvidence === "string"
      ? detail.saleExtentEvidence.trim().slice(0, 100) : "원본 매매범위 근거 부족";
    if (typeof detail.saleSourceFloorText === "string" && detail.saleSourceFloorText.trim()) summary.saleSourceFloorText = detail.saleSourceFloorText.trim().slice(0, 60);
    if (summary.saleExtent === "unit") {
      for (const key of ["saleTargetFloor", "saleTargetRoom"]) {
        if (typeof detail[key] === "string" && detail[key].trim()) summary[key] = detail[key].trim().slice(0, 60);
      }
    }
    if (["whole_building", "unit"].includes(detail.floorScope)) summary.floorScope = detail.floorScope;
    // A confirmed zero basement count means no basement; absent data does not.
    for (const key of ["aboveGroundFloors", "belowGroundFloors", "totalFloors"]) {
      const value = detail[key];
      if (!["number", "string"].includes(typeof value) || clean(value) === "") continue;
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= (key === "belowGroundFloors" ? 0 : 1)) summary[key] = parsed;
    }
  }
  return summary;
}

// These paths are fixed provider schema fields, never user-supplied SQL.
// Match JavaScript String.trim(), including tabs/newlines and Unicode spaces.
const SQL_TRIM_SPACES = "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";

function sourceJsonScalar(...paths) {
  const values = paths.map(path => `CASE WHEN json_type(raw_json, '$.${path}') IN ('text','integer','real')
    THEN NULLIF(trim(json_extract(raw_json, '$.${path}'), ${SQL_TRIM_SPACES}), '') END`);
  return values.length === 1 ? values[0] : `COALESCE(${values.join(", ")})`;
}

function gongsilJsonScalar(...names) {
  return `CASE WHEN json_type(raw_json, '$.list')='object' THEN ${sourceJsonScalar(...names.map(name => `list.${name}`))}
    ELSE ${sourceJsonScalar(...names)} END`;
}

function originalFloorMetadataSql() {
  return `CASE WHEN source='공실박스' THEN json_object(
      'floor', ${gongsilJsonScalar("Ff", "BfFloor", "Floor", "floor")},
      'room', ${gongsilJsonScalar("Ho", "BfHo", "Room", "Honame")})
    WHEN source='네이버' THEN json_object(
      'floor', ${sourceJsonScalar("floorInfo.targetFloor", "saleRaw.detailInfo.spaceInfo.floorInfo.targetFloor",
        "saleRaw.spaceInfo.floorInfo.targetFloor", "floorInfo", "detailRaw.detailInfo.articleDetailInfo.floorDetailInfo.currentFloor",
        "detailRaw.detailInfo.floorDetailInfo.currentFloor", "roomInfo")},
      'room', ${sourceJsonScalar("roomInfo", "detailRaw.detailInfo.articleDetailInfo.hoNumber", "detailRaw.detailInfo.hoNumber")})
    WHEN source='당근' THEN json_object('floor', ${sourceJsonScalar("floor")},
      'ambiguous', CASE WHEN json_type(raw_json,'$.isAmbiguousFloor')='true' THEN 1 ELSE 0 END,
      'room', ${sourceJsonScalar("room", "hoNumber")}) ELSE '{}' END`;
}

async function unifiedListings(env, listingIds = null) {
  const scopedIds = Array.isArray(listingIds) ? [...new Set(listingIds)] : null;
  if (scopedIds && !scopedIds.length) return { ok: true, version: 2, format: "compact-v2", fields: UNIFIED_FIELDS,
    groups: {}, sourceSearchIds: {}, sourceSnapshotKeys: {}, sourceSnapshotPropertyIds: {}, originalCount: 0, unavailableCount: 0, source: "D1" };
  if (scopedIds && scopedIds.length > 75) throw new Error("한 번에 조회할 신규매물 범위를 초과했습니다.");
  const bindings = scopedIds || [];
  const scopeSql = column => scopedIds ? ` AND ${column} IN (${scopedIds.map((_, i) => `?${i + 1}`).join(",")})` : "";
  const rows = await allRowidPages(
    env,
    `id, listing_id, source, source_listing_id, source_url, snapshot_hash, active, missing_count, updated_at, last_collected_at, list_snapshot_json,
      (SELECT ${sourceSnapshotParentSql("proof_parent")} FROM listings proof_parent WHERE proof_parent.id=listing_sources.listing_id) AS source_snapshot_parent_json,
      COALESCE((SELECT proof_availability.updated_at FROM listing_source_availability proof_availability WHERE proof_availability.source_id=listing_sources.id),'') AS availability_updated_at,
      ${availabilityKindSql("listing_sources")} AS availability_kind,
      ${absenceMetadataSql("listing_sources")} AS absence_metadata_json,
      ${originalFloorMetadataSql()} AS floor_metadata_json,
      CASE WHEN source='공실박스' THEN json_extract(raw_json, '$.list.Photos') END AS gongsil_photos_json,
      CASE WHEN json_extract(list_snapshot_json, '$.tradeType')='sale' THEN
        COALESCE(json_extract(raw_json, '$.saleRaw.detailInfo.spaceInfo.floorInfo'), json_extract(raw_json, '$.saleRaw.spaceInfo.floorInfo')) END AS naver_floor_info_json,
      CASE WHEN json_extract(list_snapshot_json, '$.tradeType')='sale' THEN ${sourceJsonScalar("realEstateTypeCode", "category")} END AS naver_property_type,
      CASE WHEN source='네이버' AND json_extract(list_snapshot_json, '$.tradeType')='sale'
        AND length(json_extract(raw_json, '$.roomInfo'))<=60 THEN json_extract(raw_json, '$.roomInfo') END AS naver_sale_room,
      CASE WHEN source='공실박스' AND json_extract(list_snapshot_json, '$.tradeType')='sale' THEN json_object(
        'typeView', ${gongsilJsonScalar("TypeView", "ViewType", "LndType", "BuildingType")},
        'ho', ${gongsilJsonScalar("Ho", "BfHo", "Room", "Honame")},
        'floor', ${gongsilJsonScalar("Ff", "BfFloor", "Floor", "floor")}
      ) END AS gongsil_sale_extent_json,
      CASE WHEN source='당근' AND json_extract(list_snapshot_json, '$.tradeType')='sale' THEN json_object(
        'entireBuildingType', json_type(raw_json, '$.isEntireBuilding'),
        'salesType', ${sourceJsonScalar("salesTypeV3.type", "salesTypeV3.__typename")},
        'floor', CASE WHEN json_type(raw_json, '$.isAmbiguousFloor')<>'true' OR json_type(raw_json, '$.isAmbiguousFloor') IS NULL
          THEN CASE WHEN json_type(raw_json, '$.floor') IN ('text','integer','real') THEN json_extract(raw_json, '$.floor') END END,
        'topFloor', CASE WHEN json_type(raw_json, '$.topFloor') IN ('text','integer','real') THEN json_extract(raw_json, '$.topFloor') END,
        'tagline', CASE WHEN json_type(raw_json, '$.addressInfo')='text' THEN substr(json_extract(raw_json, '$.addressInfo'), 1, 500) ELSE '' END,
        'description', CASE WHEN trim(COALESCE(json_extract(list_snapshot_json, '$.saleDetails.descriptionText'), ''), ${SQL_TRIM_SPACES})=''
          AND json_type(raw_json, '$.content')='text' THEN substr(json_extract(raw_json, '$.content'), 1, 12000) ELSE '' END
      ) END AS daangn_sale_extent_json,
      CASE WHEN source='네이버' AND json_extract(list_snapshot_json, '$.tradeType')='sale' THEN
        COALESCE(json_extract(raw_json, '$.saleRaw.detailInfo.priceInfo'), json_extract(raw_json, '$.saleRaw.priceInfo')) END AS naver_sale_price_info_json,
      CASE WHEN source='당근' THEN json_extract(raw_json, '$.landType') END AS daangn_land_type`,
    "listing_sources",
    `${publicSourceWhereSql("listing_sources")} AND EXISTS (SELECT 1 FROM listings parent WHERE parent.id=listing_sources.listing_id AND parent.status<>'deleted')
      AND NOT EXISTS (
        SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id = listing_sources.listing_id
          AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
      )${scopeSql("listing_id")}`,
    4_000, bindings
  );
  const groups = {};
  const manualRooms = await loadManualRoomOverrides(env, scopedIds);
  const manualFields = await loadManualRepresentativeFields(env, scopedIds);
  // Read parent tokens/counts last. They may reject a source group changed
  // between rowid pages; they must never replace the actual read-row proof.
  const parents = await allRowidPages(env, `id, property_id, version, updated_at, status,
    (SELECT COUNT(*) FROM listing_sources proof_source WHERE proof_source.listing_id=listings.id
      AND ${publicSourceWhereSql("proof_source")}) AS source_snapshot_source_count`, "listings",
    `${publicMasterWhereSql("listings")} AND ${publicMasterSourcesWhereSql("listings")}${scopeSql("id")}`, 3_000, bindings);
  const sourceProof = await sourceSnapshotKeysFromReadRows(rows, parents);
  // Parent rows have already been reduced to proof keys. Release the inventory
  // before building another large representation of all source advertisements.
  parents.length = 0;
  let unavailableCount = 0;
  // These rows already have the same public-parent, hold and scope guards as
  // the original-number index. Reuse their rowid order instead of rescanning
  // every source with OFFSET; the index keeps its own provider/number filter.
  const sourceSearchIds = sourceListingSearchIndex(rows);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    // The snapshot JSON is only an input. Keeping every input row alive while
    // the compact groups grow doubles peak memory on a cold full-cache build.
    rows[index] = null;
    const daangn = parseJson(row.daangn_sale_extent_json, {});
    const displayed = withSaleExtentDisplay(parseJson(row.list_snapshot_json, {}), {
      source: row.source,
      floorInfo: parseJson(row.naver_floor_info_json, null),
      propertyType: row.naver_property_type,
      room: row.naver_sale_room,
      gongsil: parseJson(row.gongsil_sale_extent_json, {}),
      daangn: { ...daangn, isEntireBuilding: daangn.entireBuildingType === "true" ? true : daangn.entireBuildingType === "false" ? false : undefined }
    });
    const original = withSourceOriginalMetadata(
      withDaangnLandUse(withSaleFinancialDisplay(withSaleAreaDisplay(displayed, { source: row.source, daangn }),
        { source: row.source, daangn, naverPriceInfo: parseJson(row.naver_sale_price_info_json, null) }), row.daangn_land_type, row.source), row, manualRooms, manualFields);
    if (original.sourceUnavailable) unavailableCount += 1;
    original.saleSummary = compactSaleSummary(original);
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
  for (const id of Object.keys(sourceProof.keys)) {
    if (!groups[id]) groups[id] = [];
    if (!sourceSearchIds[id]) sourceSearchIds[id] = [];
  }
  return {
    ok: true,
    version: 2,
    format: "compact-v2",
    fields: UNIFIED_FIELDS,
    groups,
    sourceSearchIds,
    sourceSnapshotKeys: sourceProof.keys,
    sourceSnapshotPropertyIds: sourceProof.propertyIds,
    originalCount: rows.length,
    unavailableCount,
    source: "D1"
  };
}

export function masterFallbackOriginal(row, images = []) {
  const id = clean(row?.id || row?.property_id);
  const contacts = parseJson(row?.contacts_json, []);
  const uniqueImages = [...new Set((Array.isArray(images) ? images : []).map(clean).filter(Boolean))];
  const original = {
    originalId: `master:${id}`,
    source: clean(row?.main_source) || "직접등록",
    link: clean(row?.source_url),
    buildingName: clean(row?.building_name || row?.title),
    address: clean(row?.address),
    room: clean(row?.room),
    tradeType: clean(row?.trade_type) || "lease",
    saleCategory: clean(row?.sale_category),
    salePrice: number(row?.sale_price),
    saleDetails: parseJson(row?.sale_details_json, {}),
    saleSummary: parseJson(row?.sale_details_json, {}),
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
    masterFallback: true,
    absenceConfirmedAt: "", endedAt: "",
    sourceUnavailable: Number(row?.source_count || 0) > 0 && Number(row?.active_source_count || 0) === 0,
    missingCount: Math.max(0, Number(row?.missing_count) || 0)
  };
  const displayed = withSaleAreaDisplay(withSaleExtentDisplay(original));
  if (displayed.tradeType === "sale") displayed.saleSummary = compactSaleSummary(displayed);
  return displayed;
}

async function unifiedDetail(env, propertyId) {
  const parent = await env.DB.prepare("SELECT id, property_id FROM listings WHERE (property_id=?1 OR id=?1) AND status<>'deleted' LIMIT 1")
    .bind(propertyId).first();
  if (!parent) return { ok: true, action: "unifiedListingDetail", propertyId, originals: [], source: "D1" };
  const listingId = clean(parent.id);
  const sourceResult = await env.DB.prepare(`SELECT id, listing_id, source, source_listing_id, source_url,
      active, missing_count, updated_at, last_collected_at, list_snapshot_json, raw_json,
      ${availabilityKindSql("listing_sources")} AS availability_kind,
      ${absenceMetadataSql("listing_sources")} AS absence_metadata_json,
      ${originalFloorMetadataSql()} AS floor_metadata_json
    FROM listing_sources WHERE listing_id = ?1 AND ${publicSourceWhereSql("listing_sources")}
      AND EXISTS (SELECT 1 FROM listings parent WHERE parent.id=listing_sources.listing_id AND parent.status<>'deleted')
      AND NOT EXISTS (
        SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id = listing_sources.listing_id
          AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
      )
    ORDER BY rowid`).bind(listingId).all();
  const mediaResult = await env.DB.prepare(`SELECT source_id, external_url, r2_key, thumbnail_r2_key, sort_order
    FROM listing_media WHERE listing_id = ?1 AND status <> 'deleted' ORDER BY source_id, sort_order, rowid`)
    .bind(listingId).all();
  const mediaBySource = {};
  for (const media of mediaResult?.results || []) {
    const sourceId = clean(media.source_id);
    if (!mediaBySource[sourceId]) mediaBySource[sourceId] = [];
    const url = clean(media.external_url);
    if (url && !mediaBySource[sourceId].includes(url)) mediaBySource[sourceId].push(url);
  }
  const manualRooms = await loadManualRoomOverrides(env, [listingId]);
  const manualFields = await loadManualRepresentativeFields(env, [listingId]);
  const originals = (sourceResult?.results || []).map((row) => {
    const raw = parseJson(row.raw_json, {});
    // The raw provider payload stays on the server. Photos, sale display and
    // explicit floor/room metadata are projected separately below.
    const snapshot = { ...parseJson(row.list_snapshot_json, {}) };
    const isGongsil = clean(row.source || snapshot.source) === "공실박스";
    const images = isGongsil ? actualGongsilImages(raw) : (mediaBySource[clean(row.id)] || []);
    snapshot.images = images;
    snapshot.thumbnail = images[0] || "";
    snapshot.photoCount = isGongsil
      ? images.length
      : Math.max(images.length, Number(snapshot.photoCount) || 0);
    const provider = saleExtentProvider(raw, row.source);
    return { ...withSourceOriginalMetadata(withDaangnLandUse(
      withSaleFinancialDisplay(withSaleAreaDisplay(withSaleExtentDisplay(snapshot, provider), provider),
        { ...provider, source: row.source, naverPriceInfo: row.source === "네이버" ? raw.saleRaw?.detailInfo?.priceInfo || raw.saleRaw?.priceInfo : undefined }), raw.landType, row.source
    ), row, manualRooms, manualFields), propertyId: clean(parent.property_id || parent.id) };
  });
  if (!originals.length) {
    const master = await env.DB.prepare(`SELECT id, property_id, main_source, title, building_name, status,
        address, room, deposit, monthly_rent, maintenance_fee, premium, area_m2,
        trade_type, sale_category, sale_price, sale_details_json,
        latitude, longitude, operating_memo, source_url, contacts_json, version,
        registration_at, first_collected_at,
        (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id=listings.id) AS source_count,
        (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id=listings.id AND s.active=1) AS active_source_count,
        (SELECT MAX(s.missing_count) FROM listing_sources s WHERE s.listing_id=listings.id) AS missing_count
      FROM listings WHERE property_id = ?1 AND status <> 'deleted'
        AND NOT EXISTS (
          SELECT 1 FROM listing_data_quality_holds quality_hold
          WHERE quality_hold.listing_id = listings.id
            AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
        )
      LIMIT 1`).bind(propertyId).first();
    if (master && (Number(master.source_count) === 0 || master.status === "계약완료")) {
      const fallbackImages = (mediaResult?.results || []).map((media) => clean(media.external_url)).filter(Boolean);
      const fallback = masterFallbackOriginal(master, fallbackImages);
      if (master.status === "계약완료") Object.assign(fallback, {
        sourceUnavailable: false, candidateEligible: false, availabilityKind: "manual_completed", missingCount: 0
      });
      originals.push(fallback);
    }
  }
  return { ok: true, action: "unifiedListingDetail", propertyId, originals, source: "D1" };
}

async function listingContacts(env, propertyId) {
  const result = await env.DB.prepare(`SELECT c.id, c.role, c.name, c.phone, c.normalized_phone, c.status,
    c.first_seen_at, c.last_seen_at FROM listing_contacts c
    JOIN listing_sources s ON s.id = c.source_id
    WHERE c.listing_id = ?1 AND c.status <> 'deleted' AND s.source = '공실박스'
      AND NOT EXISTS (
        SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id = c.listing_id
          AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
      )
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
    ) AND NOT EXISTS (
      SELECT 1 FROM listing_data_quality_holds quality_hold
      WHERE quality_hold.listing_id = c.listing_id
        AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
    ) ORDER BY c.last_seen_at DESC LIMIT 100`).bind(search.pattern, search.compactPattern).all();
  const memoResult = await env.DB.prepare(`SELECT l.id AS listing_id, l.title, l.address, l.room, l.operating_memo
    FROM listings l WHERE (
      l.title LIKE ?1 OR l.address LIKE ?1 OR l.room LIKE ?1 OR l.operating_memo LIKE ?1 OR
      REPLACE(l.address, ' ', '') LIKE ?2 OR REPLACE(l.operating_memo, ' ', '') LIKE ?2
    ) AND NOT EXISTS (
      SELECT 1 FROM listing_data_quality_holds quality_hold
      WHERE quality_hold.listing_id = l.id
        AND quality_hold.state = 'open' AND quality_hold.blocks_publication = 1
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

function requireActiveCloudScope(value) {
  if (clean(value) === "permitDiagnosis") {
    throw Object.assign(new Error("업종분석 기능이 종료되었습니다. 기존 저장 자료는 보존됩니다."), { statusCode: 410 });
  }
}

async function cloudState(env, user, query) {
  const scope = clean(query.scope).slice(0, 100);
  const recordKey = clean(query.recordKey || "default").slice(0, 100);
  const owner = clean(user?.email).toLowerCase();
  if (!owner) throw Object.assign(new Error("로그인 계정을 확인해 주세요."), { statusCode: 401 });
  requireActiveCloudScope(scope);
  if (!scope || !recordKey) {
    throw Object.assign(new Error("클라우드 저장 범위를 확인해 주세요."), { statusCode: 400 });
  }
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

async function duplicateCheck(env, values, trade = { tradeType: "lease", salePrice: null }) {
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
      AND trade_type = ?6 AND (?6 <> 'sale' OR (sale_price = ?7 AND sale_category = ?8
        AND json_extract(sale_details_json, '$.landAreaM2') IS ?9
        AND json_extract(sale_details_json, '$.grossAreaM2') IS ?10))
    LIMIT 1`).bind(address, room, deposit, rent, area, trade.tradeType, trade.salePrice,
      trade.saleCategory || "", trade.saleDetails?.landAreaM2 ?? null, trade.saleDetails?.grossAreaM2 ?? null).first();
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

async function mutationStatus(env, user, requestId) {
  const id = clean(requestId).slice(0, 160);
  const owner = clean(user?.email).toLowerCase();
  const row = await env.DB.prepare(`SELECT state, result_json FROM mutation_results
    WHERE request_id = ?1 AND owner_email = ?2`)
    .bind(id, owner).first();
  if (!row) return { ok: true, ready: false, requestId: clean(requestId) };
  return {
    ok: true,
    ready: ["completed", "failed"].includes(clean(row.state)),
    state: clean(row.state),
    requestId: id,
    result: parseJson(row.result_json, {})
  };
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

async function computeOperationsDashboard(env) {
  const result = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM listings WHERE status <> 'deleted') AS active_master,
      (SELECT COUNT(*) FROM listing_sources WHERE active=1) AS raw_count,
      (SELECT COUNT(*) FROM collector_raw WHERE processing_state IN ('pending','review')) AS pending_review,
      (SELECT COUNT(*) FROM listings l WHERE ${candidateMasterWhereSql()}) AS transaction_candidates,
      ${candidateAdCountSql()} AS candidate_ad_count,
      (SELECT COUNT(*) FROM listings l WHERE ${publicMasterWhereSql()} AND l.status='계약완료') AS manual_completed,
      (SELECT COUNT(*) FROM listing_history) AS history_count`).first();
  return {
    ok: true,
    action: "operationsDashboard",
    advertisementPolicyVersion: SOURCE_CANDIDATE_POLICY_VERSION,
    activeMaster: Number(result?.active_master) || 0,
    master: Number(result?.active_master) || 0,
    raw: Number(result?.raw_count) || 0,
    pendingReview: Number(result?.pending_review) || 0,
    review: Number(result?.pending_review) || 0,
    transactionCheckCandidates: Number(result?.transaction_candidates) || 0,
    candidateAdCount: Number(result?.candidate_ad_count) || 0,
    totalUnavailable: Number(result?.transaction_candidates) || 0,
    manualCompleted: Number(result?.manual_completed) || 0,
    completedOnlyTotal: (Number(result?.transaction_candidates) || 0) + (Number(result?.manual_completed) || 0),
    history: Number(result?.history_count) || 0,
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
  if (payload.advertisementPolicyVersion !== SOURCE_CANDIDATE_POLICY_VERSION) return refreshOperationsDashboard(env);
  const pairs = [
    ["activeMaster", "activeMaster"], ["master", "activeMaster"],
    ["raw", "raw"], ["pendingReview", "pendingReview"], ["review", "pendingReview"],
    ["history", "history"]
  ];
  for (const [target, source] of pairs) {
    const delta = Number(adjustments[source] || 0);
    if (delta) payload[target] = Math.max(0, Number(payload[target] || 0) + delta);
  }
  // A manual completion, original move or deletion can change this boundary
  // without changing the source-row total. Recount only these indexed master
  // predicates; do not repeat the full operations/history aggregation.
  const availability = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM listings l WHERE ${candidateMasterWhereSql()}) AS unavailable,
    ${candidateAdCountSql()} AS candidate_ad_count,
    (SELECT COUNT(*) FROM listings l WHERE ${publicMasterWhereSql()} AND l.status='계약완료') AS manual_completed`).first();
  payload.transactionCheckCandidates = Number(availability?.unavailable) || 0;
  payload.totalUnavailable = payload.transactionCheckCandidates;
  payload.candidateAdCount = Number(availability?.candidate_ad_count) || 0;
  payload.manualCompleted = Number(availability?.manual_completed) || 0;
  payload.completedOnlyTotal = payload.totalUnavailable + payload.manualCompleted;
  payload.advertisementPolicyVersion = SOURCE_CANDIDATE_POLICY_VERSION;
  return saveOperationsSnapshot(env, payload);
}

async function operationsDashboard(env) {
  try {
    const row = await env.DB.prepare(`SELECT payload_json, calculated_at
      FROM operations_snapshots WHERE snapshot_key='main' LIMIT 1`).first();
    if (!row) return refreshOperationsDashboard(env);
    const payload = parseJson(row.payload_json, {});
    const calculatedAt = Date.parse(row.calculated_at || "");
    // Snapshot adjustments keep the common write path fast, while this bound
    // repairs drift from maintenance jobs or interrupted background refreshes.
    if (payload.advertisementPolicyVersion !== SOURCE_CANDIDATE_POLICY_VERSION || !Number.isFinite(calculatedAt) || Date.now() - calculatedAt > 5 * 60_000) {
      return refreshOperationsDashboard(env);
    }
    return {
      ...payload,
      calculatedAt: row.calculated_at || "",
      source: "D1-SNAPSHOT"
    };
  } catch {
    return computeOperationsDashboard(env);
  }
}

async function transactionCandidates(env) {
  const where = candidateMasterWhereSql();
  const total = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM listings l WHERE ${where}) AS count,
    ${candidateAdCountSql()} AS candidate_ad_count,
    (SELECT COUNT(*) FROM listings l WHERE ${publicMasterWhereSql()} AND l.status='계약완료') AS manual_completed`).first();
  const result = await env.DB.prepare(`SELECT
      l.id, l.property_id, l.title, l.address, l.room, l.listing_type, l.trade_type, l.sale_price,
      l.deposit, l.monthly_rent, l.maintenance_fee, l.premium, l.area_m2,
      l.main_source, l.operating_memo, l.source_url,
      COUNT(s.id) AS candidate_ad_count, MAX(s.missing_count) AS missing_count,
      (SELECT COUNT(*) FROM listing_sources member WHERE member.listing_id=l.id AND ${publicSourceWhereSql("member")}) AS source_count,
      (SELECT COUNT(*) FROM listing_sources live WHERE live.listing_id=l.id AND live.active=1) AS active_source_count,
      GROUP_CONCAT(DISTINCT s.source) AS sources, MAX(s.updated_at) AS last_checked_at,
      (SELECT lm.external_url FROM listing_media lm
        WHERE lm.listing_id=l.id AND lm.status<>'deleted' AND trim(COALESCE(lm.external_url,''))<>''
          AND lm.external_url NOT LIKE '%/avatars/%'
        ORDER BY lm.sort_order, lm.rowid LIMIT 1) AS thumbnail
    FROM listings l JOIN listing_sources s ON s.listing_id=l.id
    WHERE ${where} AND ${candidateSourceWhereSql()}
    GROUP BY l.id
    ORDER BY MAX(s.updated_at) DESC, l.address, l.room, l.id
    LIMIT 2000`).all();
  const rows = result?.results || [];
  const ids = rows.map(row => clean(row.id));
  const publicIds = new Map(rows.map(row => [clean(row.id), clean(row.property_id || row.id)]));
  const manualRooms = await loadManualRoomOverrides(env, ids);
  const manualFields = await loadManualRepresentativeFields(env, ids);
  // Bound the nested evidence too, without silently pretending every ad was
  // returned. Ranking gives every returned master its first candidate first.
  const originalsResult = ids.length ? await env.DB.prepare(`SELECT * FROM (
    SELECT s.id,s.listing_id,s.source,s.source_listing_id,s.source_url,s.active,s.missing_count,s.updated_at,s.last_collected_at,
      ${availabilityKindSql()} AS availability_kind, ${absenceMetadataSql()} AS absence_metadata_json,
      ${originalFloorMetadataSql()} AS floor_metadata_json,
      json_extract(s.list_snapshot_json,'$.room') AS advertised_room,
      json_extract(s.list_snapshot_json,'$.type') AS advertised_type,
      json_extract(s.list_snapshot_json,'$.deposit') AS deposit,json_extract(s.list_snapshot_json,'$.rent') AS rent,
      json_extract(s.list_snapshot_json,'$.fee') AS fee,json_extract(s.list_snapshot_json,'$.premium') AS premium,
      json_extract(s.list_snapshot_json,'$.area') AS area,json_extract(s.list_snapshot_json,'$.tradeType') AS trade_type,
      json_extract(s.list_snapshot_json,'$.salePrice') AS sale_price,
      json_extract(s.list_snapshot_json,'$.thumbnail') AS saved_thumbnail,
      json_extract(s.raw_json,'$.list.Photos') AS gongsil_photos_json,
      (SELECT lm.external_url FROM listing_media lm WHERE lm.source_id=s.id AND lm.status<>'deleted'
        AND trim(COALESCE(lm.external_url,''))<>'' AND lm.external_url NOT LIKE '%/avatars/%'
        ORDER BY lm.sort_order,lm.rowid LIMIT 1) AS media_thumbnail,
      ROW_NUMBER() OVER(PARTITION BY s.listing_id ORDER BY s.updated_at DESC,s.id) AS candidate_rank
    FROM listing_sources s WHERE s.listing_id IN (SELECT value FROM json_each(?1)) AND ${candidateSourceWhereSql()}
  ) WHERE candidate_rank<=100 ORDER BY candidate_rank,listing_id LIMIT 10000`).bind(JSON.stringify(ids)).all() : null;
  const byMaster = new Map();
  for (const row of originalsResult?.results || []) {
    const original = withSourceOriginalMetadata({ room: clean(row.advertised_room), type: clean(row.advertised_type), deposit: number(row.deposit), rent: number(row.rent),
      fee: number(row.fee), premium: number(row.premium), area: number(row.area), tradeType: clean(row.trade_type) || "lease",
      salePrice: number(row.sale_price), thumbnail: clean(row.media_thumbnail || row.saved_thumbnail)
    }, row, manualRooms, manualFields);
    if (original.source === "공실박스") original.thumbnail = actualGongsilImages({ list: { Photos: parseJson(row.gongsil_photos_json, []) } })[0] || "";
    const values = byMaster.get(row.listing_id) || [];
    values.push({ ...original, propertyId: publicIds.get(row.listing_id), sourceId: original.providerSourceId }); byMaster.set(row.listing_id, values);
  }
  const candidates = rows.map((row) => ({
    propertyId: clean(row.property_id || row.id), candidateKind: "master-source-candidates",
    title: clean(row.title), address: clean(row.address), room: clean(row.room), type: clean(row.listing_type),
    tradeType: clean(row.trade_type) || "lease", salePrice: number(row.sale_price),
    deposit: number(row.deposit), rent: number(row.monthly_rent), fee: number(row.maintenance_fee),
    premium: number(row.premium), area: number(row.area_m2), mainSource: clean(row.main_source),
    memo: clean(row.operating_memo), sourceUrl: clean(row.source_url), thumbnail: clean(row.thumbnail),
    sourceCount: Number(row.source_count) || 0, endedSourceCount: Number(row.candidate_ad_count) || 0,
    activeSourceCount: Number(row.active_source_count) || 0, candidateOriginalCount: Number(row.candidate_ad_count) || 0,
    candidateAdCount: Number(row.candidate_ad_count) || 0,
    candidateOriginals: byMaster.get(row.id) || [], returnedCandidateOriginalCount: (byMaster.get(row.id) || []).length,
    candidateOriginalsHasMore: (Number(row.candidate_ad_count) || 0) > (byMaster.get(row.id) || []).length,
    missingCount: Number(row.missing_count) || 0, sources: clean(row.sources).split(",").filter(Boolean),
    lastCheckedAt: clean(row.last_checked_at), sourceUnavailable: true,
    evidenceNotice: "과거 미노출 후보와 동일범위 전체목록 미노출 기록입니다. 실제 광고 삭제·거래완료 확인은 아닙니다."
  }));
  const count = Number(total?.count) || 0;
  const manualCompleted = Number(total?.manual_completed) || 0;
  return { ok: true, action: "transactionCandidates", count, returnedCount: candidates.length,
    hasMore: count > candidates.length, candidates, totalUnavailable: count, manualCompleted,
    candidateAdCount: Number(total?.candidate_ad_count) || 0,
    returnedCandidateAdCount: candidates.reduce((sum,row) => sum + row.returnedCandidateOriginalCount, 0),
    candidateOriginalsHasMore: candidates.some(row => row.candidateOriginalsHasMore),
    completedOnlyTotal: count + manualCompleted, advertisementPolicyVersion: SOURCE_CANDIDATE_POLICY_VERSION, source: "D1" };
}

const SALE_HISTORY_FIELDS = ["landAreaM2","grossAreaM2","exclusiveAreaM2","buildingAreaM2","totalDeposit","monthlyIncome","monthlyNetIncome","statedMonthlyIncome","loanAmount","investmentAmount","advertisedYield","buildingUse","landUse","zoning","roadAccess","parcelShape"];
const BUSINESS_HISTORY_FIELDS = [
  "title", "room", "deposit", "monthly_rent", "maintenance_fee", "premium", "area_m2",
  "landlord_phone", "tenant_phone", "operating_memo", "contacts_json", "status", "sale_price", ...SALE_HISTORY_FIELDS.map(k=>"saleDetails."+k)
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
  contacts_json: "contacts_json",
  state: "status",
  status: "status", salePrice: "sale_price", sale_price: "sale_price"
};

const BUSINESS_HISTORY_NUMBERS = new Set([
  "deposit", "monthly_rent", "maintenance_fee", "premium", "area_m2", "sale_price"
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
  if (Object.prototype.hasOwnProperty.call(input,"sale_details_json")) {
    const details = parseJson(input.sale_details_json,{});
    for (const field of SALE_HISTORY_FIELDS) result["saleDetails."+field] = details[field] ?? null;
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
      if (after[field] == null || after[field] === "" || after[field] === 0 || (Array.isArray(after[field]) && !after[field].length)) continue;
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
      AND h.action IN ('quickAdd', 'updateProperty', 'updatePropertyMemo', 'toggleDone', 'deleteProperty', 'restoreListingHistory')
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
    authType: clean(user?.authType) || "google",
    username: clean(user?.username),
    role: clean(user?.role) || "member",
    canManageUsers: ["owner", "admin"].includes(clean(user?.role)),
    canManageLocalAccounts: clean(user?.role) === "owner",
    canEdit: clean(user?.role) !== "viewer",
    source: "SESSION"
  };
}

async function userManagement(env, user) {
  requireRole(user, ["owner", "admin"]);
  const bootstrapOwner = bootstrapOwnerEmail(env);
  const result = await env.DB.prepare(`SELECT email, display_name, role, active, created_at, updated_at
    FROM allowed_users ORDER BY active DESC,
      CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
      email`).all();
  const users = (result?.results || []).map((row) => {
    const email = clean(row.email).toLowerCase();
    const isBootstrapOwner = Boolean(bootstrapOwner && email === bootstrapOwner);
    return {
      email,
      displayName: clean(row.display_name),
      role: isBootstrapOwner ? "owner" : clean(row.role) || "member",
      active: isBootstrapOwner || Number(row.active) === 1,
      createdAt: clean(row.created_at),
      updatedAt: clean(row.updated_at),
      source: isBootstrapOwner ? "ENV" : "D1"
    };
  });
  for (const [index, email] of String(env.ALLOWED_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).entries()) {
    if (!users.some((entry) => entry.email === email)) {
      users.push({ email, displayName: "", role: index === 0 ? "owner" : "member", active: true, source: "ENV" });
    }
  }
  const localResult = await env.DB.prepare(`SELECT username, linked_email, display_name, role, active, failed_attempts,
    locked_until, last_login_at, created_at, updated_at FROM local_accounts
    ORDER BY active DESC, username`).all();
  const localAccounts = (localResult?.results || []).map((row) => ({
    username: clean(row.username).toLowerCase(),
    linkedEmail: clean(row.linked_email).toLowerCase(),
    displayName: clean(row.display_name),
    role: clean(users.find((entry) => entry.email === clean(row.linked_email).toLowerCase())?.role || row.role) || "member",
    active: Number(row.active) === 1,
    failedAttempts: Number(row.failed_attempts || 0),
    lockedUntil: clean(row.locked_until),
    lastLoginAt: clean(row.last_login_at),
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
    source: "LOCAL"
  }));
  return { ok: true, action: "userManagement", users, localAccounts, source: "D1+ENV" };
}

export async function handleD1GetAction(env, user, query) {
  if (query.action === "listingHistoryRestorePreview") return previewListingHistoryRestore(env, user, query);
  const action = clean(query.action);
  if (!env.DB || !isD1GetAction(action)) return null;
  if (action === "unifiedListings") return unifiedListings(env);
  if (action === "newListingPeriod") return newListingPeriod(env, query, ids => unifiedListings(env, ids));
  if (action === "unifiedListingDetail") return unifiedDetail(env, clean(query.propertyId).slice(0, 100));
  if (action === "saleAskingHistory") return getSaleAskingHistory(env, query);
  if (action === "unifiedListingContacts") return listingContacts(env, clean(query.propertyId).slice(0, 100));
  if (action === "tellContacts") return tellContacts(env, query.query);
  if (action === "geocodeCache") return geocodeCache(env);
  if (action === "loadCloudState") return cloudState(env, user, query);
  if (action === "announcement") return announcement(env);
  if (action === "checkDuplicate") return duplicateCheck(env, parseJson(query.values, []));
  if (action === "mutationStatus") return mutationStatus(env, user, query.requestId);
  if (action === "workQueueStatus") return workQueueStatus(env, user);


  if (action === "operationsDashboard") return operationsDashboard(env);
  if (action === "transactionCandidates") return transactionCandidates(env);
  if (action === "listingChanges") return listingChanges(env, query);
  if (action === "listingOriginals") return listingOriginals(env, query);
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
    ON CONFLICT(request_id) DO UPDATE SET state=excluded.state, result_json=excluded.result_json,
      expires_at=excluded.expires_at
    WHERE mutation_results.owner_email=excluded.owner_email AND mutation_results.action=excluded.action`)
    .bind(id, clean(user?.email).toLowerCase(), action, state, JSON.stringify(result || {}), new Date().toISOString()).run();
  return id;
}

async function reserveMutation(env, user, action, requestId) {
  const id = clean(requestId).slice(0, 160);
  const owner = clean(user?.email).toLowerCase();
  const now = new Date().toISOString();
  const pending = { ok: true, ready: false, requestId: id };
  const inserted = await env.DB.prepare(`INSERT INTO mutation_results (
      request_id, owner_email, action, state, result_json, created_at, expires_at
    ) VALUES (?1, ?2, ?3, 'processing', ?4, ?5, datetime('now', '+7 days'))
    ON CONFLICT(request_id) DO NOTHING`)
    .bind(id, owner, action, JSON.stringify(pending), now).run();
  if (Number(inserted?.meta?.changes || 0) > 0 || (inserted?.meta?.changes == null && inserted?.success !== false)) {
    return { acquired: true, id };
  }

  const existing = await env.DB.prepare(`SELECT owner_email, action, state, result_json, created_at
    FROM mutation_results WHERE request_id=?1`).bind(id).first();
  if (!existing || clean(existing.owner_email).toLowerCase() !== owner || clean(existing.action) !== action) {
    throw Object.assign(new Error("동일한 요청번호를 사용할 수 없습니다."), { statusCode: 409 });
  }
  if (clean(existing.state) === "completed") {
    return { acquired: false, id, result: { ...parseJson(existing.result_json, {}), replayed: true } };
  }
  if (clean(existing.state) === "failed") {
    const failure = parseJson(existing.result_json, {});
    throw Object.assign(new Error(clean(failure.message) || "이 요청은 이전 처리에서 실패했습니다."), {
      statusCode: Math.max(400, Math.min(599, Number(failure.statusCode) || 409))
    });
  }

  // A Worker request cannot legitimately remain active for ten minutes. Taking
  // over only an expired processing reservation recovers safely from a runtime
  // termination without allowing concurrent duplicate writes.
  const takeover = await env.DB.prepare(`UPDATE mutation_results SET created_at=?1,
      result_json=?2, expires_at=datetime('now', '+7 days')
    WHERE request_id=?3 AND owner_email=?4 AND action=?5 AND state='processing'
      AND datetime(created_at) < datetime('now', '-10 minutes')`)
    .bind(now, JSON.stringify(pending), id, owner, action).run();
  if (Number(takeover?.meta?.changes || 0) > 0) return { acquired: true, id };
  throw Object.assign(new Error("동일한 요청을 처리 중입니다."), { statusCode: 409 });
}

function propertyEditFieldsV1() {
  return [
    ["name", "title", 0, clean], ["room", "room", 2, canonicalListingRoom],
    ["deposit", "deposit", 4, number], ["rent", "monthly_rent", 5, number],
    ["fee", "maintenance_fee", 6, number], ["premium", "premium", 7, number],
    ["area", "area_m2", 8, number], ["landlordPhone", "landlord_phone", 9, clean],
    ["tenantPhone", "tenant_phone", 10, clean], ["memo", "operating_memo", 11, clean],
    ["state", "status", 12, (value) => clean(value) || "active"]
  ];
}

function propertyEditConflictV1() {
  return Object.assign(new Error("다른 작업에서 매물이 변경되었습니다. 작성 내용은 유지됩니다. 최신 값과 비교한 뒤 다시 저장해 주세요."),
    { statusCode: 409, code: "PROPERTY_EDIT_CONFLICT" });
}

function propertyEditPatchV1(before, body) {
  const original = body.originalValues;
  if (!Array.isArray(original) || original.length < 13 || clean(before.status) === "deleted") {
    throw propertyEditConflictV1();
  }
  const submitted = body.updated && typeof body.updated === "object" ? body.updated : {};
  const current = {}, changes = [];
  for (const [key, column, index, normalize] of propertyEditFieldsV1()) {
    current[key] = normalize(before[column]);
    if (!Object.prototype.hasOwnProperty.call(submitted, key)) continue;
    const initial = normalize(original[index]), desired = normalize(submitted[key]);
    if (desired === initial) continue;
    if (current[key] !== initial && current[key] !== desired) throw propertyEditConflictV1();
    if (current[key] !== desired) changes.push({ key, column, value: desired });
    current[key] = desired;
  }
  return { value: current, changes };
}

function propertyEditRecoveryStatementsV1(env, listingId, recovered, now, historyJson) {
  // This exact, uniquely-tokened history row is inserted only after our CAS wins.
  // Guard every recovery statement: a failed CAS must not reconnect any source.
  const guard = `EXISTS (SELECT 1 FROM listing_history WHERE listing_id=?1
    AND action='updateProperty' AND after_json=?4)`;
  return recovered.flatMap((row) => [
    env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,
      list_snapshot_json=json_set(list_snapshot_json, '$.propertyId', ?1), updated_at=?2
      WHERE id=?3 AND (listing_id IS NULL OR trim(listing_id)='') AND ${guard}`)
      .bind(listingId, now, row.id, historyJson),
    ...["listing_media", "listing_contacts"].map((table) => env.DB.prepare(`UPDATE ${table}
      SET listing_id=?1, updated_at=?2 WHERE source_id=?3
      AND (listing_id IS NULL OR trim(listing_id)='') AND ${guard}
      AND EXISTS (SELECT 1 FROM listing_sources WHERE id=?3 AND listing_id=?1)`)
      .bind(listingId, now, row.id, historyJson))
  ]);
}

async function updateProperty(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare("SELECT * FROM listings WHERE property_id = ?1").bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const { value, changes } = propertyEditPatchV1(before, body);
  const saleEdit = body.saleEdit != null;
  if (before.trade_type === "sale" && changes.some(c => ["deposit","rent","fee","premium","area"].includes(c.key))) {
    throw Object.assign(new Error("매매 매물은 매매정보 수정창에서 금액·면적을 수정해 주세요."), { statusCode: 400 });
  }
  if (saleEdit) {
    const sale = salePropertyEditPatch(before, body.saleEdit);
    changes.push(...sale.changes); Object.assign(value, sale.value);
  }
  const memoChanged = changes.some((entry) => entry.key === "memo");
  const reconciledContacts = memoChanged
    ? reconcileMemoContacts(before.main_source, parseJson(before.contacts_json, []), value.memo)
    : parseJson(before.contacts_json, []);
  value.state = value.state === "active" ? "" : value.state;
  value.contacts = reconciledContacts;
  if (!changes.length) return { ok: true, persisted: true, queued: false, propertyId,
    updated: value, noChange: true, operationAdjustments: {}, source: "D1" };
  const beforeHistory = {
    title: before.title, room: before.room, deposit: before.deposit, monthly_rent: before.monthly_rent,
    maintenance_fee: before.maintenance_fee, premium: before.premium, area_m2: before.area_m2,
    landlord_phone: before.landlord_phone, tenant_phone: before.tenant_phone,
    operating_memo: before.operating_memo, contacts_json: before.contacts_json, status: before.status
  };
  if (saleEdit) Object.assign(beforeHistory, { sale_price: before.sale_price, sale_category: before.sale_category, sale_details_json: before.sale_details_json });
  const afterHistory = {
    ...beforeHistory,
    ...Object.fromEntries(changes.map((entry) => [entry.column, entry.value])),
    contacts_json: memoChanged ? JSON.stringify(reconciledContacts) : before.contacts_json,
    status: clean(value.state) || "active", editMutationToken: crypto.randomUUID()
  };
  const now = new Date().toISOString();
  const linkedSourcesBefore = await linkedSourceHistorySnapshot(env, before.id);
  const restoringCompleted = clean(before.status) === "계약완료" && afterHistory.status !== "계약완료";
  const completedSnapshot = restoringCompleted
    ? await latestCompletedSourceSnapshot(env, before.id)
    : [];
  const recovery = restoringCompleted
    ? await completionSourceRecoveryPlan(env, before.id, completedSnapshot, now)
    : { statements: [], recovered: [], conflicts: 0, missing: 0 };
  const recoveredById = new Map(recovery.recovered.map((row) => [row.id, row]));
  const linkedSourcesAfter = linkedSourcesBefore.concat(
    completedSnapshot.filter((row) => recoveredById.has(clean(row?.id))).map((row) => ({
      ...row,
      active: recoveredById.get(clean(row?.id))?.active || 0
    }))
  );
  beforeHistory.linkedSources = linkedSourcesBefore;
  afterHistory.linkedSources = linkedSourcesAfter;
  const bindings = [], assignments = [];
  const bind = (entry) => { bindings.push(entry ?? null); return `?${bindings.length}`; };
  for (const change of changes) {
    const parameter = bind(change.value);
    assignments.push(`${change.column}=${parameter}`);
    if (change.key === "name") assignments.push(`building_name=${parameter}`);
  }
  if (memoChanged) assignments.push(`contacts_json=${bind(JSON.stringify(reconciledContacts))}`);
  assignments.push(`version=version+1`, `updated_at=${bind(now)}`);
  const checks = [`property_id=${bind(propertyId)}`, `version IS ${bind(before.version)}`];
  // Some collection paths intentionally don't increment version. Compare the
  // values used for this decision as well, inside the same atomic UPDATE.
  for (const column of [...new Set(propertyEditFieldsV1().map((entry) => entry[1])
    .concat(["contacts_json", "main_source", "building_name", "trade_type"], saleEdit ? ["sale_price","sale_category","sale_details_json"] : []))]) {
    checks.push(`${column} IS ${bind(before[column])}`);
  }
  const afterJson = JSON.stringify(afterHistory);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET ${assignments.join(", ")} WHERE ${checks.join(" AND ")}`).bind(...bindings),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      SELECT ?1, 'updateProperty', ?2, ?3, ?4 WHERE changes()=1`)
      .bind(before.id || propertyId, clean(user?.email), JSON.stringify(beforeHistory), afterJson),
    ...propertyEditRecoveryStatementsV1(env, before.id || propertyId, recovery.recovered, now, afterJson)
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) throw propertyEditConflictV1();
  return { ok: true, persisted: true, queued: false, propertyId, updated: value,
    sourceCount: linkedSourcesAfter.length,
    activeSourceCount: linkedSourcesAfter.filter((row) => Number(row?.active) === 1).length,
    restoredSourceCount: recovery.recovered.length,
    sourceConflicts: recovery.conflicts, missingSources: recovery.missing,
    sourceLinksChanged: recovery.recovered.length > 0, fullReload: restoringCompleted,
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

async function linkedSourceHistorySnapshot(env, listingId) {
  const result = await env.DB.prepare(`SELECT id, source, source_listing_id, active
    FROM listing_sources WHERE listing_id=?1 ORDER BY rowid`).bind(listingId).all();
  return (result?.results || []).map((row) => ({
    id: clean(row.id),
    source: clean(row.source),
    sourceListingId: clean(row.source_listing_id),
    active: Number(row.active) === 1 ? 1 : 0
  })).filter((row) => row.id);
}

async function latestCompletedSourceSnapshot(env, listingId) {
  const result = await env.DB.prepare(`SELECT before_json, after_json
    FROM listing_history
    WHERE listing_id=?1 AND action IN ('toggleDone', 'updateProperty')
    ORDER BY id DESC LIMIT 20`).bind(listingId).all();
  for (const row of result?.results || []) {
    const after = parseJson(row.after_json, {});
    if (clean(after.status) !== "계약완료") continue;
    const before = parseJson(row.before_json, {});
    if (Array.isArray(before.linkedSources)) return before.linkedSources;
  }
  return [];
}

async function completionSourceRecoveryPlan(env, listingId, snapshot, now) {
  const sourceIds = [...new Set((Array.isArray(snapshot) ? snapshot : [])
    .map((row) => clean(row?.id)).filter(Boolean))];
  if (!sourceIds.length) return { statements: [], recovered: [], conflicts: 0, missing: 0 };
  const target = await env.DB.prepare("SELECT trade_type FROM listings WHERE id=?1 LIMIT 1").bind(listingId).first();
  const placeholders = sourceIds.map((_, index) => `?${index + 1}`).join(",");
  const result = await env.DB.prepare(`SELECT id, listing_id, active, trade_type FROM listing_sources
    WHERE id IN (${placeholders})`).bind(...sourceIds).all();
  const rows = result?.results || [];
  const found = new Set(rows.map((row) => clean(row.id)).filter(Boolean));
  const compatibleTrade = (row) => Boolean(target && listingTradeTypesCanMerge(row.trade_type, target.trade_type));
  const recoverable = rows.filter((row) => !clean(row.listing_id) && compatibleTrade(row));
  const conflicts = rows.filter((row) => clean(row.listing_id)
    ? clean(row.listing_id) !== listingId : !compatibleTrade(row)).length;
  const statements = [];
  for (const row of recoverable) {
    const sourceId = clean(row.id);
    statements.push(
      env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,
        list_snapshot_json=json_set(list_snapshot_json, '$.propertyId', ?1), updated_at=?2
        WHERE id=?3 AND (listing_id IS NULL OR trim(listing_id)='')`).bind(listingId, now, sourceId),
      env.DB.prepare(`UPDATE listing_media SET listing_id=?1, updated_at=?2
        WHERE source_id=?3 AND (listing_id IS NULL OR trim(listing_id)='')`).bind(listingId, now, sourceId),
      env.DB.prepare(`UPDATE listing_contacts SET listing_id=?1, updated_at=?2
        WHERE source_id=?3 AND (listing_id IS NULL OR trim(listing_id)='')`).bind(listingId, now, sourceId)
    );
  }
  return {
    statements,
    recovered: recoverable.map((row) => ({
      id: clean(row.id),
      active: Number(row.active) === 1 ? 1 : 0
    })),
    conflicts,
    missing: sourceIds.filter((id) => !found.has(id)).length
  };
}

async function toggleDone(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare(`SELECT id, property_id, status, operating_memo
    FROM listings WHERE property_id=?1 LIMIT 1`).bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const after = { status: clean(body.state) || "active", operating_memo: clean(body.memo) };
  const now = new Date().toISOString();
  const linkedSourcesBefore = await linkedSourceHistorySnapshot(env, before.id);
  const restoringCompleted = clean(before.status) === "계약완료" && after.status !== "계약완료";
  const completedSnapshot = restoringCompleted
    ? await latestCompletedSourceSnapshot(env, before.id)
    : [];
  const recovery = restoringCompleted
    ? await completionSourceRecoveryPlan(env, before.id, completedSnapshot, now)
    : { statements: [], recovered: [], conflicts: 0, missing: 0 };
  const recoveredById = new Map(recovery.recovered.map((row) => [row.id, row]));
  const linkedSourcesAfter = linkedSourcesBefore.concat(
    completedSnapshot.filter((row) => recoveredById.has(clean(row?.id))).map((row) => ({
      ...row,
      active: recoveredById.get(clean(row?.id))?.active || 0
    }))
  );
  const results = await env.DB.batch([
    ...recovery.statements,
    env.DB.prepare(`UPDATE listings SET status=?1, operating_memo=?2,
      version=version+1, updated_at=?3 WHERE property_id=?4`)
      .bind(after.status, after.operating_memo, now, propertyId),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      VALUES (?1, 'toggleDone', ?2, ?3, ?4)`)
      .bind(before.id || propertyId, clean(user?.email),
        JSON.stringify({ ...before, linkedSources: linkedSourcesBefore }),
        JSON.stringify({ ...after, linkedSources: linkedSourcesAfter }))
  ]);
  const result = results?.[recovery.statements.length];
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const sourceCount = linkedSourcesAfter.length;
  const activeSourceCount = linkedSourcesAfter.filter((row) => Number(row?.active) === 1).length;
  return { ok: true, persisted: true, queued: false, propertyId, state: after.status, memo: after.operating_memo,
    sourceCount, activeSourceCount, restoredSourceCount: recovery.recovered.length,
    sourceConflicts: recovery.conflicts, missingSources: recovery.missing,
    sourceLinksChanged: recovery.recovered.length > 0, fullReload: restoringCompleted,
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
  const trade = validateQuickAddTrade(body, values);
  const duplicate = await duplicateCheck(env, values, trade);
  /* 같은 주소라도 층·호실·조건·평수가 다른 별도 매물은 정상 등록합니다. */
  if (duplicate.duplicateType === "exact" && !body.forceDuplicate) {
    return { ...duplicate, persisted: false };
  }
  const propertyId = clean(values[15]) || `M-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO listings (
    id, property_id, status, main_source, title, address, building_name, room, listing_type,
    deposit, monthly_rent, maintenance_fee, premium, area_m2, landlord_phone, tenant_phone,
    operating_memo, first_collected_at, source_url, contacts_json, registration_at, last_collected_at, updated_at,
    trade_type, sale_category, sale_price, sale_details_json
  ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
    ?15, ?16, ?17, ?18, ?19, ?20, ?20, ?21, ?22, ?23, ?24)`)
    .bind(propertyId, clean(values[12]) || "active", clean(values[14]) || "직접등록", clean(values[0]),
      clean(values[1]), canonicalListingRoom(values[2]), clean(values[3]), number(values[4]), number(values[5]),
      number(values[6]), number(values[7]), number(values[8]), clean(values[9]), clean(values[10]),
      clean(values[11]), clean(values[13]) || now, clean(values[16]), clean(values[17]) || "[]",
      clean(values[23]) || now, clean(values[24]) || now,
      trade.tradeType, trade.saleCategory, trade.salePrice, JSON.stringify(trade.saleDetails)).run();
  await env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
    VALUES (?1, 'quickAdd', ?2, '{}', ?3)`)
    .bind(propertyId, clean(user?.email), JSON.stringify({
      title: clean(values[0]), room: canonicalListingRoom(values[2]), deposit: number(values[4]),
      monthly_rent: number(values[5]), maintenance_fee: number(values[6]), premium: number(values[7]),
      area_m2: number(values[8]), landlord_phone: clean(values[9]), tenant_phone: clean(values[10]),
      operating_memo: clean(values[11]), contacts_json: clean(values[17]) || "[]",
      trade_type: trade.tradeType, sale_category: trade.saleCategory, sale_price: trade.salePrice,
      sale_details_json: JSON.stringify(trade.saleDetails)
    })).run();
  return { ok: true, persisted: true, queued: false, propertyId,
    operationAdjustments: { activeMaster: 1, history: 1 }, source: "D1" };
}

async function saveCloudState(env, user, body) {
  const owner = clean(user?.email).toLowerCase();
  const scope = clean(body.scope).slice(0, 100);
  const recordKey = clean(body.recordKey || "default").slice(0, 100);
  if (scope === "saleWorksheetV1") return saveSaleWorksheet(env, owner, recordKey, body);
  if (!owner) throw Object.assign(new Error("로그인 계정을 확인해 주세요."), { statusCode: 401 });
  if (!scope || !recordKey) {
    throw Object.assign(new Error("클라우드 저장 범위를 확인해 주세요."), { statusCode: 400 });
  }
  const expectedVersion = body.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw Object.assign(new Error("최신 클라우드 자료를 먼저 불러온 뒤 다시 저장해 주세요."), { statusCode: 428 });
  }
  const version = expectedVersion + 1;
  const now = new Date().toISOString();
  if (ACCOUNT_LIST_SCOPES.has(scope) && !Array.isArray(body.data)) {
    throw Object.assign(new Error("목록 저장 형식을 확인해 주세요."), { statusCode: 400 });
  }
  if (ACCOUNT_LIST_SCOPES.has(scope) && Array.isArray(body.data)) {
    const deletionScope = cloudDeletionScope(scope);
    const existingDeletedRow = await env.DB.prepare(`SELECT value_json, version FROM cloud_state
      WHERE owner_email = ?1 AND scope = ?2 AND record_key = ?3`)
      .bind(owner, deletionScope, recordKey).first();
    const deletionVersion = Number.isSafeInteger(Number(existingDeletedRow?.version))
      ? Number(existingDeletedRow.version) : 0;
    const deletedIds = mergeCloudDeletionIds(
      parseJson(existingDeletedRow?.value_json, {}),
      body.deletedIds
    );
    const data = filterCloudDeletedLists(body.data, deletedIds);
    // The tombstone row and list row are changed as one D1 batch.  A unique
    // marker couples both conditional statements, so a concurrent loser cannot
    // update only one half after another device wins the compare-and-swap.
    const writeMarker = `cloud-list-save:${crypto.randomUUID()}`;
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE (
          (?7 = 0 AND NOT EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3
          )) OR EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3 AND version=?7
          )
        ) AND (
          (?9 = 0 AND NOT EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?8 AND record_key=?3
          )) OR EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?8 AND record_key=?3 AND version=?9
          )
        )
        ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
          value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at
        WHERE cloud_state.version=?7 AND (
          (?9 = 0 AND NOT EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?8 AND record_key=?3
          )) OR EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?8 AND record_key=?3 AND version=?9
          )
        )`)
        .bind(owner, deletionScope, recordKey, JSON.stringify(deletedIds), version, writeMarker,
          deletionVersion, scope, expectedVersion),
      env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE EXISTS (
          SELECT 1 FROM cloud_state
          WHERE owner_email=?1 AND scope=?8 AND record_key=?3 AND updated_at=?9
        ) AND (
          (?7 = 0 AND NOT EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3
          )) OR EXISTS (
            SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3 AND version=?7
          )
        )
        ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
          value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at
        WHERE cloud_state.version=?7 AND EXISTS (
          SELECT 1 FROM cloud_state
          WHERE owner_email=?1 AND scope=?8 AND record_key=?3 AND updated_at=?9
        )`)
        .bind(owner, scope, recordKey, JSON.stringify(data), version, now, expectedVersion,
          deletionScope, writeMarker)
    ]);
    if (results.some((result) => Number(result?.meta?.changes) !== 1)) {
      throw Object.assign(new Error("다른 창 또는 기기에서 목록이 변경되었습니다. 최신 목록과 합친 뒤 다시 저장해 주세요."), {
        statusCode: 409
      });
    }
    return { ok: true, persisted: true, queued: false, scope, recordKey,
      data, deletedIds, version, updatedAt: now, source: "D1" };
  }
  const result = await env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6
    WHERE ?7 = 0 OR EXISTS (
      SELECT 1 FROM cloud_state
      WHERE owner_email=?1 AND scope=?2 AND record_key=?3 AND version=?7
    )
    ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
      value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at
    WHERE cloud_state.version=?7`)
    .bind(owner, scope, recordKey, JSON.stringify(body.data ?? null), version, now, expectedVersion).run();
  if (Number(result?.meta?.changes) !== 1) {
    throw Object.assign(new Error("다른 창 또는 기기에서 자료가 변경되었습니다. 최신 자료를 확인한 뒤 다시 저장해 주세요."), {
      statusCode: 409
    });
  }
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
    tradeType: normalizeListingTradeType(original.tradeType || original.trade_type || sourceRow?.trade_type || parent?.trade_type,
      { legacyDefault: true }),
    saleCategory: clean(original.saleCategory || original.sale_category || sourceRow?.sale_category || parent?.sale_category),
    salePrice: numberOr(original.salePrice ?? original.sale_price ?? sourceRow?.sale_price, parent?.sale_price),
    deposit: numberOr(original.deposit, parent?.deposit),
    rent: numberOr(original.rent ?? original.monthly, parent?.monthly_rent),
    fee: numberOr(original.fee ?? original.managementFee, parent?.maintenance_fee),
    premium: numberOr(original.premium, parent?.premium),
    area: numberOr(original.area, parent?.area_m2),
    latitude: numberOr(original.latitude ?? original.lat, parent?.latitude),
    longitude: numberOr(original.longitude ?? original.lng, parent?.longitude),
    memo: carryConfirmedVisitMemo(original.memo, parent?.operating_memo),
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
    const signature = value.tradeType === "sale"
      ? `${value.tradeType}|${value.saleCategory}|${value.salePrice}`
      : `${value.tradeType}|${value.deposit}|${value.rent}`;
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
  return env.DB.prepare(`UPDATE listings SET trade_type=?1, sale_category=?2, sale_price=?3,
      deposit=?4, monthly_rent=?5, maintenance_fee=?6, premium=?7, area_m2=?8,
      version=version+1, updated_at=?9 WHERE id=?10 AND status<>'deleted'`)
    .bind(value.tradeType, value.saleCategory, value.salePrice, value.deposit, value.rent,
      value.fee, value.premium, value.area, now, masterId);
}

async function moveOriginal(env, user, body) {
  const originalId = clean(body.originalId).slice(0, 160);
  const targetMasterId = clean(body.targetMasterId).slice(0, 100);
  const source = await env.DB.prepare(`SELECT s.*, l.main_source, l.title, l.address, l.building_name,
      l.room, l.listing_type, l.deposit, l.monthly_rent, l.maintenance_fee, l.premium,
      l.trade_type AS master_trade_type, l.sale_category AS master_sale_category, l.sale_price AS master_sale_price,
      l.area_m2, l.latitude, l.longitude, l.operating_memo, l.source_url AS master_source_url,
      l.contacts_json, l.first_collected_at AS master_first_collected_at,
      l.registration_at, l.last_collected_at AS master_last_collected_at
    FROM listing_sources s JOIN listings l ON l.id=s.listing_id
    WHERE s.id=?1 AND s.active=1 AND l.status<>'deleted' LIMIT 1`).bind(originalId).first();
  if (!source) throw Object.assign(new Error("분리할 원본매물을 찾을 수 없습니다."), { statusCode: 404 });
  const sourceSnapshot = parseJson(source.list_snapshot_json, {});
  const sourceTrade = normalizeListingTradeType(source.trade_type, { legacyDefault: true });
  const snapshotTrade = normalizeListingTradeType(sourceSnapshot.tradeType || sourceSnapshot.trade_type || source.trade_type,
    { legacyDefault: true });
  const parentTrade = normalizeListingTradeType(source.master_trade_type, { legacyDefault: true });
  if (!sourceTrade || sourceTrade !== snapshotTrade || sourceTrade !== parentTrade) {
    throw Object.assign(new Error("원본과 대표매물의 거래유형이 일치하지 않습니다. 임대·매매 연결을 확인해 주세요."), { statusCode: 400 });
  }
  const expectedRevision = Math.max(0, Number(body.expectedRevision) || 0);
  const currentRevision = Math.max(1, Number(sourceSnapshot.revision) || 1);
  if (expectedRevision && expectedRevision !== currentRevision) {
    throw Object.assign(new Error("원본매물이 갱신되었습니다. 상세창을 다시 열고 시도해 주세요."), { statusCode: 409 });
  }
  const now = new Date().toISOString();
  const sourceParent = {
    ...source,
    trade_type: source.master_trade_type,
    sale_category: source.master_sale_category,
    sale_price: source.master_sale_price,
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
          trade_type, sale_category, sale_price,
          deposit, monthly_rent, maintenance_fee, premium, area_m2, latitude, longitude,
          operating_memo, source_url, contacts_json, first_collected_at, registration_at,
          last_collected_at, created_at, updated_at
        ) VALUES (?1, ?1, 'active', ?2, ?3, ?4, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
          ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?23)`)
        .bind(value.id, value.source, value.title, value.address, value.room, value.listingType,
          value.tradeType, value.saleCategory, value.salePrice,
          value.deposit, value.rent, value.fee, value.premium, value.area, value.latitude,
          value.longitude, value.memo, value.link, value.contactsJson, value.firstCollectedAt || now,
          value.registrationAt || now, value.lastCollectedAt || now, now),
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
  const target = await env.DB.prepare("SELECT id, operating_memo, trade_type FROM listings WHERE id=?1 AND status <> 'deleted'")
    .bind(targetMasterId).first();
  if (!target) throw Object.assign(new Error("통합할 대상매물을 찾을 수 없습니다."), { statusCode: 404 });
  if (!listingTradeTypesCanMerge(sourceTrade, target.trade_type)) {
    throw Object.assign(new Error("상가임대와 매매 원본은 서로 합칠 수 없습니다."), { statusCode: 400 });
  }
  const targetMemo = carryConfirmedVisitMemo(target.operating_memo, source.operating_memo);
  const confirmationTransferred = targetMemo !== clean(target.operating_memo);
  const statements = [
    env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,
        list_snapshot_json=json_set(list_snapshot_json, '$.propertyId', ?1), updated_at=?2 WHERE id=?3`)
      .bind(targetMasterId, now, originalId),
    env.DB.prepare("UPDATE listing_media SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
      .bind(targetMasterId, now, originalId),
    env.DB.prepare("UPDATE listing_contacts SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
      .bind(targetMasterId, now, originalId)
  ];
  if (confirmationTransferred) {
    statements.push(
      env.DB.prepare(`UPDATE listings SET operating_memo=?1, version=version+1, updated_at=?2 WHERE id=?3`)
        .bind(targetMemo, now, targetMasterId),
      env.DB.prepare(`INSERT INTO listing_history (
          listing_id, source_id, action, actor_email, before_json, after_json
        ) VALUES (?1, ?2, 'preserveConfirmedVisitOnMove', ?3, ?4, ?5)`)
        .bind(targetMasterId, originalId, clean(user?.email) || "web",
          JSON.stringify({ operatingMemo: clean(target.operating_memo), sourceMasterId: source.listing_id }),
          JSON.stringify({ operatingMemo: targetMemo, sourceMasterId: source.listing_id }))
    );
  }
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
    operationAdjustments: { activeMaster: sourceMasterRemoved ? -1 : 0,
      history: (sourceMasterRemoved ? 1 : 0) + (confirmationTransferred ? 1 : 0) }, source: "D1" };
}

async function saveAllowedUser(env, user, body) {
  requireRole(user, ["owner", "admin"]);
  const email = clean(body.email).toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("올바른 이메일 주소를 입력해 주세요."), { statusCode: 400 });
  }
  const actorRole = clean(user?.role) || "member";
  const actorEmail = clean(user?.email).toLowerCase();
  const bootstrapOwner = bootstrapOwnerEmail(env);
  const existing = await env.DB.prepare(`SELECT email, role, active FROM allowed_users
    WHERE lower(email)=lower(?1) LIMIT 1`).bind(email).first();
  const configuredRole = String(env.ALLOWED_EMAILS || "").split(",")
    .map((value) => value.trim().toLowerCase()).filter(Boolean).includes(email) ? "member" : "";
  const currentRole = email === bootstrapOwner ? "owner" : clean(existing?.role || configuredRole);
  const currentActive = email === bootstrapOwner || (existing
    ? Number(existing.active) === 1
    : Boolean(configuredRole));
  if (email === bootstrapOwner) {
    throw Object.assign(new Error("환경설정의 기본 소유자 계정은 변경할 수 없습니다."), { statusCode: 403 });
  }
  if (actorRole === "admin" && new Set(["owner", "admin"]).has(currentRole)) {
    throw Object.assign(new Error("관리자는 동급 또는 상위 권한 계정을 변경할 수 없습니다."), { statusCode: 403 });
  }
  const requestedRole = clean(body.role) || "member";
  const allowedRoles = actorRole === "owner"
    ? new Set(["admin", "member", "viewer"])
    : new Set(["member", "viewer"]);
  if (!allowedRoles.has(requestedRole)) {
    throw Object.assign(new Error("해당 권한을 지정할 수 없습니다."), { statusCode: 403 });
  }
  const active = body.active === false ? 0 : 1;
  if (email === actorEmail && !active) {
    throw Object.assign(new Error("현재 로그인한 계정은 비활성화할 수 없습니다."), { statusCode: 400 });
  }
  if (currentActive && currentRole === "owner" && (requestedRole !== "owner" || !active)) {
    const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM allowed_users
      WHERE active=1 AND role='owner' AND lower(email)<>lower(?1) AND lower(email)<>lower(?2)`)
      .bind(email, bootstrapOwner).first();
    const effectiveRemainingOwners = Number(remaining?.count || 0) +
      (bootstrapOwner && bootstrapOwner !== email ? 1 : 0);
    if (effectiveRemainingOwners < 1) {
      throw Object.assign(new Error("마지막 사용 가능한 소유자 계정은 강등하거나 비활성화할 수 없습니다."),
        { statusCode: 400 });
    }
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
      actorEmail, now).run();
  return { ok: true, action: "saveAllowedUser", persisted: true, email,
    displayName: clean(body.displayName), role: requestedRole, active: Boolean(active), source: "D1" };
}

async function saveLocalAccount(env, user, body) {
  requireRole(user, "owner");
  const username = normalizeLocalUsername(body.username);
  if (!username) {
    throw Object.assign(new Error("아이디는 영문 소문자·숫자·점·밑줄·하이픈으로 3~32자까지 입력해 주세요."),
      { statusCode: 400 });
  }
  const existing = await env.DB.prepare(`SELECT username, linked_email FROM local_accounts WHERE username=?1 LIMIT 1`)
    .bind(username).first();
  const linkedEmail = clean(body.linkedEmail || existing?.linked_email).toLowerCase();
  const linkedProfile = linkedEmail ? await accessProfile(linkedEmail, env) : null;
  const ownOwnerIdentity = clean(linkedProfile?.role) === "owner" &&
    linkedEmail === clean(user?.email).toLowerCase();
  if (!linkedProfile || !ownOwnerIdentity && !new Set(["admin", "member", "viewer"]).has(clean(linkedProfile.role))) {
    throw Object.assign(new Error("본인 소유자 계정 또는 사용 허용된 Google 계정을 선택해 주세요."), { statusCode: 400 });
  }
  const duplicateLink = await env.DB.prepare(`SELECT username FROM local_accounts
    WHERE lower(linked_email)=lower(?1) AND username<>?2 LIMIT 1`).bind(linkedEmail, username).first();
  if (duplicateLink) {
    throw Object.assign(new Error("이 Google 계정에는 이미 발급 아이디가 연결되어 있습니다."), { statusCode: 409 });
  }
  const effectiveRole = clean(linkedProfile.role);
  const storedRole = effectiveRole === "viewer" ? "viewer" : "member";
  const password = String(body.password || "");
  if (!existing && !password) {
    throw Object.assign(new Error("새 계정에 사용할 비밀번호를 입력해 주세요."), { statusCode: 400 });
  }
  const passwordRecord = password ? await createLocalPassword(password) : null;
  const active = body.active === false ? 0 : 1;
  const now = new Date().toISOString();
  if (existing) {
    if (passwordRecord) {
      await env.DB.prepare(`UPDATE local_accounts SET linked_email=?1, display_name=?2, role=?3, active=?4,
        password_salt=?5, password_hash=?6, password_iterations=?7,
        session_version=session_version+1, failed_attempts=0, locked_until='', updated_at=?8
        WHERE username=?9`).bind(linkedEmail, clean(body.displayName).slice(0, 100), storedRole, active,
          passwordRecord.salt, passwordRecord.hash, passwordRecord.iterations, now, username).run();
    } else {
      await env.DB.prepare(`UPDATE local_accounts SET linked_email=?1, display_name=?2, role=?3, active=?4,
        session_version=session_version+1, failed_attempts=0, locked_until='', updated_at=?5
        WHERE username=?6`).bind(linkedEmail, clean(body.displayName).slice(0, 100), storedRole, active, now, username).run();
    }
  } else {
    await env.DB.prepare(`INSERT INTO local_accounts (
      username, linked_email, display_name, role, active, password_salt, password_hash, password_iterations,
      session_version, created_by, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?10)`).bind(
      username, linkedEmail, clean(body.displayName).slice(0, 100), storedRole, active,
      passwordRecord.salt, passwordRecord.hash, passwordRecord.iterations,
      clean(user?.email).toLowerCase(), now
    ).run();
  }
  return { ok: true, action: "saveLocalAccount", persisted: true, username,
    linkedEmail, displayName: clean(body.displayName), role: effectiveRole, active: Boolean(active),
    passwordChanged: Boolean(passwordRecord), source: "D1" };
}

async function executePost(env, user, body) {
  const action = clean(body.action);
  if (action === "saveAllowedUser") return saveAllowedUser(env, user, body);
  if (action === "saveLocalAccount") return saveLocalAccount(env, user, body);
  if (action === "restoreListingHistory") return restoreSelectedListingHistory(env, user, body);
  if (action === "updatePropertyMemo") return updateMemo(env, user, body);
  if (action === "updateProperty") return updateProperty(env, user, body);
  if (action === "toggleDone") return toggleDone(env, user, body);
  if (action === "deleteProperty") return deleteProperty(env, user, body);
  if (action === "quickAdd") return quickAdd(env, user, body);
  if (action === "saveCloudState") return saveCloudState(env, user, body);
  if (action === "saveGeocodeCache") return saveGeocode(env, body);
  if (action === "moveOriginalListing") return moveOriginal(env, user, body);


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
  if (action === "enqueueMutation" && (!isD1PostAction(effectiveAction) || effectiveAction === "enqueueMutation")) return null;
  if (effectiveAction === "saveCloudState") {
    requireActiveCloudScope(action === "enqueueMutation" ? body.payload?.scope : body.scope);
  }
  if (effectiveAction !== "saveCloudState") requireRole(user, ["owner", "admin", "member"]);
  const requestId = clean(body.requestId || body?.payload?.requestId || `${action}-${crypto.randomUUID()}`).slice(0, 160);
  const mutationName = action === "enqueueMutation" ? clean(body.taskAction) : action;
  const reservation = await reserveMutation(env, user, mutationName, requestId);
  if (!reservation.acquired) return reservation.result;
  try {
    const result = await executePost(env, user, body);
    if (!result) return null;
    const finalResult = { ...result, requestId };
    await recordMutation(env, user, mutationName, requestId, finalResult);
    return finalResult;
  } catch (error) {
    await recordMutation(env, user, mutationName, requestId, {
      ok: false,
      requestId,
      message: clean(error?.message) || "저장 요청에 실패했습니다.",
      statusCode: Number(error?.statusCode) || 500
    }, "failed").catch(() => null);
    throw error;
  }
}
