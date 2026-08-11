import { canonicalListingRoom, normalizedRoomKey, parseListingFloor } from "./floor.js";
import { refreshCustomerMatchesForListings } from "./d1-api.js";
import { requireRole } from "./security.js";

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
const DAANGN_JOB_PREFIX = "collector-daangn-";
const DAANGN_DETAIL_MAX_ATTEMPTS = 8;
const DAANGN_DETAIL_ERROR_LIMIT = 60;
const GONGSIL_PHOTO_ROOT = "https://file1.gongsilbox.com/file/land_photo/";
const GONGSIL_DETAIL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function daangnJobId(body = {}) {
  const clientId = clean(body.clientId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `${DAANGN_JOB_PREFIX}${clientId || "active"}`;
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

const EXTERNAL_PHONE_PATTERN = /(?<!\d)(?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|02[-.\s]?\d{3,4}[-.\s]?\d{4}|0[3-6][1-5][-.\s]?\d{3,4}[-.\s]?\d{4}|070[-.\s]?\d{3,4}[-.\s]?\d{4}|050\d[-.\s]?\d{4}[-.\s]?\d{4})(?!\d)/g;
const EXTERNAL_CONTACT_KEY = /^(?:.*(?:phone|telephone|mobile|cellphone|tel)(?:number|no)?|contact(?:number)?|cpno)$/i;

export function stripExternalPhoneNumbers(value) {
  return clean(value)
    .replace(EXTERNAL_PHONE_PATTERN, " ")
    .replace(/(?:☎️?\s*)?(?:상담\s*전화|문의\s*전화|전화\s*문의|연락처)\s*[:：]?\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function scrubExternalContactData(value, key = "") {
  if (EXTERNAL_CONTACT_KEY.test(clean(key))) {
    if (Array.isArray(value)) return [];
    if (value && typeof value === "object") return {};
    return "";
  }
  if (Array.isArray(value)) return value.map((item) => scrubExternalContactData(item));
  if (value && typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = scrubExternalContactData(childValue, childKey);
    }
    return output;
  }
  return typeof value === "string" ? stripExternalPhoneNumbers(value) : value;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  return normalizedRoomKey(value);
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

export function gongsilPhotoUrl(value) {
  let path = clean(value && typeof value === "object"
    ? value.Photo || value.photo || value.url || value.Xbfimg || value.xbfimg
    : value);
  if (!path) return "";
  if (/^https:\/\//i.test(path)) return /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(path) ? path : "";
  path = path.replace(/^\/+/, "")
    .replace(/^(?:https?:\/\/)?(?:file1\.)?gongsilbox\.com\/file\/land_photo\//i, "");
  if (!path || /(?:^|\/)\.\.(?:\/|$)/.test(path) || /\\/.test(path)) return "";
  if (!/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(path)) return "";
  return `${GONGSIL_PHOTO_ROOT}${path}`;
}

export function gongsilImageUrls(record) {
  const raw = record?.raw || record || {};
  const list = raw?.list || raw;
  const detail = raw?.detail || {};
  const photoRows = [list?.Photos, list?.photos, detail?.Photos, detail?.photos]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const rawPhotos = photoRows.map(gongsilPhotoUrl).filter(Boolean);
  const fallback = rawPhotos.length ? [] : [list?.Xbfimg, list?.xbfimg, detail?.Xbfimg, detail?.xbfimg]
    .map(gongsilPhotoUrl).filter(Boolean);
  return uniqueUrls([
    record?.primaryImage,
    ...(Array.isArray(record?.imageUrls) ? record.imageUrls : []),
    ...rawPhotos,
    ...fallback
  ]);
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
  const images = gongsilImageUrls(record);
  return {
    source: "공실박스", sourceId, buildingName: clean(values[0]) || clean(record?.buildingName),
    address: normalizedAddress(values[1] || record?.address), room: canonicalListingRoom(values[2] || record?.room),
    category: clean(values[3] || record?.category) || "상가점포", deposit: number(values[4] ?? record?.deposit),
    rent: number(values[5] ?? record?.rent), fee: number(values[6] ?? record?.fee),
    premium: number(values[7] ?? record?.premium), area: number(values[8] ?? record?.area),
    memo: memoWithVisit(values[11] || record?.memo), link: clean(record?.url || record?.sourceUrl),
    listSnapshot: clean(record?.listSnapshot), images, contacts, raw: record?.raw || record,
    latitude: coordinate(record?.latitude ?? record?.lat ?? record?.mapY, -90, 90),
    longitude: coordinate(record?.longitude ?? record?.lng ?? record?.lon ?? record?.mapX, -180, 180)
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
    room: canonicalListingRoom(item?.roomInfo || item?.floorInfo), category: clean(item?.category) || "상가점포",
    deposit: number(item?.deposit), rent: number(item?.monthly), fee: number(item?.managementFee || item?.fee),
    premium: number(item?.premium), area: squareMeters && squareMeters > 0
      ? Math.round((squareMeters / 3.305785) * 10) / 10 : number(item?.area),
    memo: memoWithVisit(stripExternalPhoneNumbers(item?.description)),
    link: clean(item?.sourceLink || item?.providerUrl || item?.currentUrl) ||
      (sourceId ? `https://fin.land.naver.com/articles/${sourceId.replace(/^네이버-/, "")}` : ""),
    listSnapshot: stripExternalPhoneNumbers(item?.listSnapshot), images, contacts: [],
    raw: scrubExternalContactData(item),
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

function daangnRoom(article) {
  if (article?.isEntireBuilding) return "전체";
  const currentText = daangnFloor(article?.isAmbiguousFloor ? article?.ambiguousFloor : article?.floor);
  const currentFloor = parseListingFloor(currentText, false);
  const totalFloor = parseListingFloor(article?.topFloor, false);
  if (currentFloor != null && totalFloor != null && totalFloor > 0) {
    return canonicalListingRoom(`${currentFloor}/${totalFloor}`);
  }
  return canonicalListingRoom(currentText);
}

function daangnAddress(article) {
  const candidates = [
    article?.publicJibunAddress,
    article?.jibunAddress,
    article?.address,
    article?.location?.jibunAddress,
    article?.location?.address,
    article?.complex?.jibunAddress
  ];
  const edges = article?.complex?.buildingsForAddress?.edges || [];
  for (const edge of edges) candidates.push(edge?.node?.jibunAddress);
  // addressInfo is descriptive copy such as "봉명동 1층 코너상가".  If it
  // is checked before the provider's building address, the floor number can
  // be mistaken for a lot number ("봉명동 1").  Use it only as the last
  // fallback after every structured address field has been exhausted.
  candidates.push(article?.addressInfo);
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
  const category = /OFFICE/.test(salesType) ? "사무실" : /FACTORY|WAREHOUSE/.test(salesType) ? "공장/창고" : "상가점포";
  const providerBuildingName = clean(article?.buildingName || article?.complex?.name);
  const addressLikeBuildingName = /(?:로|길)\s*\d+(?:-\d+)?(?:\s|$)/.test(providerBuildingName);
  const areaM2 = number(article?.area);
  const images = uniqueUrls([...(article?.images || []), ...(article?.floorPlanImages || [])]);
  const sourceId = clean(article?.originalId);
  const optionText = (article?.options || []).some((option) => option?.name === "PARKING" && clean(option?.value).toUpperCase() === "YES")
    ? "주차가능 · " : "";
  const description = stripExternalPhoneNumbers(
    [article?.addressInfo, article?.content].filter(Boolean).join(" ").replace(/\s+/g, " ")
  );
  /*
   * Daangn deliberately blurs `publicCoordinate` when `isHideAddress` is true.
   * The detail response can still contain the exact lot address through
   * complex.buildingsForAddress, so persisting that blurred coordinate would
   * place navigation/roadview at an unrelated neighborhood landmark.  Leave
   * coordinates empty in that case; the map's address geocoder (and its shared
   * cache) will resolve the exact lot instead.
   */
  const hasDirectCoordinate = [
    article?.latitude,
    article?.lat,
    article?.location?.latitude
  ].some((value) => coordinate(value, -90, 90) != null) && [
    article?.longitude,
    article?.lng,
    article?.lon,
    article?.location?.longitude
  ].some((value) => coordinate(value, -180, 180) != null);
  const blurredPublicCoordinate = Boolean(article?.isHideAddress) && !hasDirectCoordinate;
  return {
    source: "당근", sourceId,
    buildingName: providerBuildingName && !addressLikeBuildingName
      ? providerBuildingName
      : category === "상가점포" ? "일반상가" : category,
    address: daangnAddress(article),
    room: daangnRoom(article),
    category,
    deposit: number(trade?.deposit ?? trade?.price), rent: number(trade?.monthlyPay ?? trade?.yearlyPay) || 0,
    fee: number(article?.totalManageCost) || 0, premium: number(article?.premiumMoney) || 0,
    area: areaM2 && areaM2 > 0 ? Math.floor((areaM2 / 3.305785) * 10 + 0.0000001) / 10 : null,
    memo: memoWithVisit(`${optionText}${description}`.slice(0, 1200)),
    link: sourceId ? `https://realty.daangn.com/?article_id=%22${encodeURIComponent(sourceId)}%22&panel_stack=article` : "",
    listSnapshot: stripExternalPhoneNumbers(listSnapshot), images, contacts: [],
    raw: scrubExternalContactData(article),
    latitude: blurredPublicCoordinate ? null : coordinate(
      article?.latitude ?? article?.lat ?? article?.location?.latitude ?? article?.publicCoordinate?.lat,
      -90,
      90
    ),
    longitude: blurredPublicCoordinate ? null : coordinate(
      article?.longitude ?? article?.lng ?? article?.lon ?? article?.location?.longitude ?? article?.publicCoordinate?.lon,
      -180,
      180
    ),
    tradeType: /MONTH/.test(tradeType) ? "월세" : /YEAR|BORROW/.test(tradeType) ? "전세" : /BUY/.test(tradeType) ? "매매" : "월세"
  };
}

export function normalizedRecord(source, value) {
  if (source === "네이버") return naverRecord(value);
  if (source === "공실박스") return gongsilRecord(value);
  if (source === "당근") {
    // Automatic collection already produces a normalized record, but keep the
    // provider detail in `raw`.  Re-normalize that detail once more at the D1
    // boundary so an older collector (or a resumed pre-fix job) cannot persist
    // descriptive text such as "봉명동 1층" as the lot address "봉명동 1".
    if (value?.source === "당근" && value?.raw && typeof value.raw === "object") {
      const canonical = daangnRecord(value.raw, value.listSnapshot);
      return {
        ...value,
        source: "당근",
        sourceId: canonical.sourceId || value.sourceId,
        buildingName: canonical.buildingName || value.buildingName,
        address: canonical.address || value.address,
        room: canonical.room || value.room,
        memo: canonical.memo,
        contacts: [],
        latitude: canonical.latitude ?? value.latitude,
        longitude: canonical.longitude ?? value.longitude,
        raw: canonical.raw
      };
    }
    return daangnRecord(value, value?.listSnapshot);
  }
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

function legacyAddressConflicts(left, right) {
  const first = normalizedAddress(left);
  const second = normalizedAddress(right);
  if (!first || !second) return false;
  const firstDistrict = first.match(/^(동구|중구|서구|유성구|대덕구)\b/);
  const secondDistrict = second.match(/^(동구|중구|서구|유성구|대덕구)\b/);
  if (firstDistrict && secondDistrict && firstDistrict[1] !== secondDistrict[1]) return true;
  const firstLot = first.match(/\b(\d+(?:-\d+)?)$/);
  const secondLot = second.match(/\b(\d+(?:-\d+)?)$/);
  return Boolean(firstLot && secondLot && firstLot[1] !== secondLot[1]);
}

function manifestMaterialMatches(entry, row) {
  const parsedSnapshot = parseJson(row.list_snapshot_json, {});
  const saved = parsedSnapshot && !Array.isArray(parsedSnapshot) && typeof parsedSnapshot === "object"
    ? parsedSnapshot : {};
  const entryDeposit = number(entry.deposit);
  const savedDeposit = number(saved.deposit) ?? number(row.saved_deposit);
  const entryRent = number(entry.rent);
  const savedRent = number(saved.rent) ?? number(row.saved_rent);
  if (entryDeposit == null || savedDeposit == null || entryRent == null || savedRent == null) return false;
  if (!sameNumber(entryDeposit, savedDeposit) || !sameNumber(entryRent, savedRent)) return false;

  const entryArea = number(entry.area);
  const savedArea = number(saved.area) ?? number(row.saved_area);
  if (entryArea != null && savedArea != null) {
    const tolerance = Math.max(1, Math.abs(savedArea) * 0.03);
    if (!sameNumber(entryArea, savedArea, tolerance)) return false;
  }

  const entryFloor = parseListingFloor(entry.room, true);
  const savedFloor = parseListingFloor(clean(saved.room) || row.saved_room, true);
  if (entryFloor != null && savedFloor != null && entryFloor !== savedFloor) return false;
  if (legacyAddressConflicts(entry.address, clean(saved.address) || row.saved_address)) return false;
  return true;
}

export function manifestEntryMatch(entry, row) {
  if (!row) return "";
  const incomingHash = snapshotKey(entry.listSnapshot || entry);
  const savedHash = clean(row.snapshot_hash).toLowerCase();
  // Recovery imports used marker values such as `legacy-recovery`, not an
  // actual list fingerprint. Compare their material rental terms instead of
  // treating every scheduled collection as a changed listing.
  if (/^fnv1a-[0-9a-f]{8}$/.test(savedHash)) {
    if (savedHash === incomingHash) return "hash";
    // Provider titles, descriptions, tags and representative images may
    // change without changing the rental offer. Those presentation-only
    // differences must not cause a full detail re-collection.
    return manifestMaterialMatches(entry, row) ? "material" : "";
  }
  return manifestMaterialMatches(entry, row) ? "legacy" : "";
}

export function shouldRefreshGongsilDetail(lastCollectedAt, currentTime = Date.now()) {
  const checkedAt = Date.parse(clean(lastCollectedAt));
  return !Number.isFinite(checkedAt) || Number(currentTime) - checkedAt >= GONGSIL_DETAIL_REFRESH_MS;
}

function conditionSnapshot(value = {}) {
  return stableJson({
    room: normalizedRoom(value.room),
    type: clean(value.type || value.category),
    deposit: number(value.deposit),
    rent: number(value.rent),
    fee: number(value.fee),
    premium: number(value.premium),
    area: number(value.area)
  });
}

export function sourceConditionChanged(previous, current) {
  if (!previous || !current) return false;
  return conditionSnapshot(previous) !== conditionSnapshot(current);
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
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (rawEntries.length > 10_000) throw new Error("목록 비교는 한 번에 최대 10,000건까지 가능합니다.");
  const entries = rawEntries.map((entry) => ({
    ...entry, sourceId: sourceIdFor(source, entry?.sourceId)
  })).filter((entry) => entry.sourceId);
  const sessionId = await ensureSession(env, body.sessionId, source);
  const rows = new Map();
  for (let offset = 0; offset < entries.length; offset += 80) {
    const ids = entries.slice(offset, offset + 80).map((entry) => entry.sourceId);
    const placeholders = ids.map((_, index) => `?${index + 2}`).join(",");
    const result = await env.DB.prepare(`SELECT s.id, s.source_listing_id, s.snapshot_hash, s.list_snapshot_json,
        s.listing_id, s.last_collected_at, l.latitude AS listing_latitude, l.longitude AS listing_longitude,
        l.deposit AS saved_deposit, l.monthly_rent AS saved_rent, l.area_m2 AS saved_area,
        l.room AS saved_room, l.address AS saved_address
      FROM listing_sources s LEFT JOIN listings l ON l.id=s.listing_id
      WHERE s.source=?1 AND s.source_listing_id IN (${placeholders})`).bind(source, ...ids).all();
    for (const row of result?.results || []) rows.set(clean(row.source_listing_id), row);

    // A collected source is not attached to listing_sources until it is either
    // auto-merged or approved in the review workspace. Include the newest raw
    // review/pending snapshot as a manifest source as well, otherwise every
    // scheduled run downloads and queues the same unreviewed listing again.
    const unresolvedIds = ids.filter((id) => !rows.has(id));
    if (unresolvedIds.length) {
      const rawPlaceholders = unresolvedIds.map((_, index) => `?${index + 2}`).join(",");
      const rawResult = await env.DB.prepare(`WITH ranked AS (
          SELECT source_listing_id, snapshot_hash,
            json_extract(payload_json, '$.listSnapshot') AS list_snapshot_json,
            COALESCE(json_extract(payload_json, '$.record.deposit'), json_extract(payload_json, '$.deposit')) AS saved_deposit,
            COALESCE(json_extract(payload_json, '$.record.rent'), json_extract(payload_json, '$.rent')) AS saved_rent,
            COALESCE(json_extract(payload_json, '$.record.area'), json_extract(payload_json, '$.area')) AS saved_area,
            COALESCE(json_extract(payload_json, '$.record.room'), json_extract(payload_json, '$.room')) AS saved_room,
            COALESCE(json_extract(payload_json, '$.record.address'), json_extract(payload_json, '$.address')) AS saved_address,
            created_at AS last_collected_at,
            ROW_NUMBER() OVER (PARTITION BY source_listing_id ORDER BY created_at DESC) AS row_number
          FROM collector_raw
          WHERE source=?1 AND processing_state <> 'error' AND source_listing_id IN (${rawPlaceholders})
        )
        SELECT source_listing_id, snapshot_hash, list_snapshot_json, last_collected_at,
          '' AS listing_id, NULL AS listing_latitude, NULL AS listing_longitude,
          saved_deposit, saved_rent, saved_area, saved_room, saved_address
        FROM ranked WHERE row_number=1`).bind(source, ...unresolvedIds).all();
      for (const row of rawResult?.results || []) {
        const id = clean(row.source_listing_id);
        if (id && !rows.has(id)) rows.set(id, row);
      }
    }
  }
  const needsDetail = [];
  const refreshDetail = [];
  const coordinateRepairs = new Map();
  const cacheRepairs = new Map();
  const legacyBackfills = [];
  let unchanged = 0;
  let changed = 0;
  let unknown = 0;
  let legacyBootstrapped = 0;
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
    } else if (manifestEntryMatch(entry, row)) {
      unchanged += 1;
      if (!/^fnv1a-[0-9a-f]{8}$/i.test(clean(row.snapshot_hash)) &&
          clean(entry.listSnapshot) && clean(row.id)) {
        legacyBackfills.push({ id: clean(row.id), hash: snapshotKey(entry.listSnapshot) });
        legacyBootstrapped += 1;
      }
      if (source === "공실박스") {
        if (shouldRefreshGongsilDetail(row.last_collected_at)) {
          refreshDetail.push(entry.sourceId);
        }
      }
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
  if (legacyBackfills.length) {
    const backfilledAt = nowIso();
    const statements = legacyBackfills.map((item) => env.DB.prepare(`UPDATE listing_sources
      SET snapshot_hash=?1, session_id=?2, last_collected_at=?3, updated_at=?3
      WHERE id=?4 AND snapshot_hash=''`).bind(item.hash, sessionId, backfilledAt, item.id));
    for (let offset = 0; offset < statements.length; offset += 80) {
      await env.DB.batch(statements.slice(offset, offset + 80));
    }
  }
  const result = { ok: true, action: "classifySourceManifest", source, sessionId, received: entries.length,
    needsDetail, refreshDetail, unchanged, changed, unknown, legacyBootstrapped,
    coordinatesRepaired: coordinateRepairs.size, sourceBackend: "D1" };
  const previous = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const totals = parseJson(previous?.totals_json, {});
  totals.manifest = Number(totals.manifest || 0) + entries.length;
  totals.unchanged = Number(totals.unchanged || 0) + unchanged;
  totals.changed = Number(totals.changed || 0) + changed;
  totals.unknown = Number(totals.unknown || 0) + unknown;
  totals.legacyBootstrapped = Number(totals.legacyBootstrapped || 0) + legacyBootstrapped;
  totals.coordinatesRepaired = Number(totals.coordinatesRepaired || 0) + coordinateRepairs.size;
  if (clean(body.collectorVersion)) totals.collectorVersion = clean(body.collectorVersion).slice(0, 30);
  if (clean(body.scope)) totals.scope = clean(body.scope).slice(0, 200);
  await env.DB.prepare("UPDATE collector_sessions SET totals_json=?1, updated_at=?2 WHERE id=?3")
    .bind(JSON.stringify(totals), nowIso(), sessionId).run();
  return result;
}

async function loadCandidateListings(env, records, existingSources) {
  const addresses = [...new Set(records.filter((record) => record?.address && !existingSources.has(record.sourceId))
    .map((record) => record.address))];
  const byAddress = new Map(addresses.map((address) => [address, []]));
  for (let offset = 0; offset < addresses.length; offset += 60) {
    const chunk = addresses.slice(offset, offset + 60);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const result = await env.DB.prepare(`SELECT id, property_id, title, address, room, listing_type,
        deposit, monthly_rent, maintenance_fee, premium, area_m2, operating_memo, main_source
      FROM listings WHERE status <> 'deleted' AND address IN (${placeholders})
      ORDER BY updated_at DESC`).bind(...chunk).all();
    for (const row of result?.results || []) {
      const rows = byAddress.get(clean(row.address));
      if (rows) rows.push(row);
    }
  }
  return byAddress;
}

async function loadPendingReviewsByAddress(env, records) {
  const addresses = [...new Set(records.map((record) => clean(record?.address)).filter(Boolean))];
  const byAddress = new Map(addresses.map((address) => [address, []]));
  for (let offset = 0; offset < addresses.length; offset += 40) {
    const chunk = addresses.slice(offset, offset + 40);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const result = await env.DB.prepare(`SELECT id, source, source_listing_id, payload_json, created_at
      FROM collector_raw
      WHERE processing_state='review' AND json_extract(payload_json, '$.address') IN (${placeholders})
      ORDER BY created_at, id`).bind(...chunk).all();
    for (const row of result?.results || []) {
      const record = normalizeReviewRecord(parseJson(row.payload_json, {}));
      const address = clean(record?.address);
      if (!address || !byAddress.has(address)) continue;
      byAddress.get(address).push({
        id: clean(row.id), reviewId: clean(row.id), source: clean(row.source),
        sourceId: clean(row.source_listing_id), createdAt: clean(row.created_at),
        room: record.room, deposit: record.deposit, monthly_rent: record.rent,
        area_m2: record.area, record
      });
    }
  }
  return byAddress;
}

async function candidateListings(env, record) {
  if (!record?.address) return [];
  const result = await loadCandidateListings(env, [record], new Map());
  return result.get(record.address) || [];
}

async function loadExistingSources(env, source, records) {
  const bySourceId = new Map();
  const ids = [...new Set(records.map((record) => record?.sourceId).filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(",");
    const result = await env.DB.prepare(`SELECT s.id, s.listing_id, s.source_listing_id, s.source_url,
        s.snapshot_hash, s.list_snapshot_json, s.raw_json, s.active, s.missing_count, s.last_collected_at,
        l.address AS listing_address, l.room AS listing_room
      FROM listing_sources s LEFT JOIN listings l ON l.id=s.listing_id
      WHERE s.source=?1 AND s.source_listing_id IN (${placeholders})`)
      .bind(source, ...chunk).all();
    for (const row of result?.results || []) bySourceId.set(clean(row.source_listing_id), row);
  }
  return bySourceId;
}

async function loadSourceAssets(env, existingSources) {
  const sourceIds = [...new Set([...existingSources.values()].map((row) => clean(row.id)).filter(Boolean))];
  const assets = new Map(sourceIds.map((id) => [id, { media: [], contacts: [] }]));
  for (let offset = 0; offset < sourceIds.length; offset += 60) {
    const chunk = sourceIds.slice(offset, offset + 60);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const [media, contacts] = await Promise.all([
      env.DB.prepare(`SELECT id, listing_id, source_id, sort_order, external_url, status FROM listing_media
        WHERE source_id IN (${placeholders})`).bind(...chunk).all(),
      env.DB.prepare(`SELECT id, listing_id, source_id, role, name, phone, normalized_phone, status FROM listing_contacts
        WHERE source_id IN (${placeholders})`).bind(...chunk).all()
    ]);
    for (const row of media?.results || []) assets.get(clean(row.source_id))?.media.push(row);
    for (const row of contacts?.results || []) assets.get(clean(row.source_id))?.contacts.push(row);
  }
  return assets;
}

function compactRoom(value) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

function roomIdentity(value) {
  const text = compactRoom(value);
  const floor = parseListingFloor(value, true);
  const dongs = [...text.matchAll(/(?:^|[^0-9A-Z])([0-9]{1,4}|[A-Z])동/g)].map((match) => match[1]);
  const withoutDongs = text.replace(/(?:^|[^0-9A-Z])(?:[0-9]{1,4}|[A-Z])동/g, " ");
  const units = /호/.test(withoutDongs)
    ? [...withoutDongs.matchAll(/(?:^|[^0-9])(\d{3,4})(?=호|[,/·]|$)/g)].map((match) => match[1].replace(/^0+/, "") || "0")
    : [];
  return {
    key: normalizedRoom(value),
    floor,
    units: [...new Set(units)],
    dongs: [...new Set(dongs)],
    wholeBuilding: /(?:건물전체|전체건물|통건물|전층)/.test(text),
    wholeFloor: /(?:층전체|전체층)/.test(text)
  };
}

function setsDisjoint(left, right) {
  return left.length > 0 && right.length > 0 && !left.some((value) => right.includes(value));
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function reliableOfferMatch(record, row) {
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  return leftDeposit != null && rightDeposit != null && leftRent != null && rightRent != null &&
    leftArea != null && rightArea != null && sameNumber(leftDeposit, rightDeposit) &&
    sameNumber(leftRent, rightRent) && Math.abs(leftArea - rightArea) < 1;
}

function reliableOfferMismatch(record, row) {
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  if (leftDeposit == null || rightDeposit == null || leftRent == null || rightRent == null ||
      leftArea == null || rightArea == null) return false;
  const termsDiffer = !sameNumber(leftDeposit, rightDeposit) || !sameNumber(leftRent, rightRent);
  return termsDiffer && Math.abs(leftArea - rightArea) >= 1;
}

export function compareListingSpace(record, row) {
  const incoming = roomIdentity(record?.room);
  const existing = roomIdentity(row?.room);
  const offerMatch = reliableOfferMatch(record || {}, row || {});

  if (incoming.wholeBuilding !== existing.wholeBuilding && (incoming.wholeBuilding || existing.wholeBuilding)) {
    return { decision: "different", reason: "건물전체와 개별공간 구분" };
  }
  if (incoming.dongs.length && existing.dongs.length && setsDisjoint(incoming.dongs, existing.dongs)) {
    return { decision: "different", reason: "동이 다름" };
  }
  if (incoming.floor != null && existing.floor != null && incoming.floor !== existing.floor) {
    return { decision: "different", reason: "층이 다름" };
  }
  if (incoming.units.length && existing.units.length && setsDisjoint(incoming.units, existing.units)) {
    return { decision: "different", reason: "호실이 다름" };
  }
  if (incoming.units.length && existing.units.length && sameSet(incoming.units, existing.units)) {
    return { decision: "same", reason: "같은 동·층·호실" };
  }

  const sameKnownFloor = incoming.floor != null && existing.floor != null && incoming.floor === existing.floor;
  const genericSpecific = sameKnownFloor && (incoming.units.length > 0) !== (existing.units.length > 0);
  if (genericSpecific && offerMatch && !incoming.wholeFloor && !existing.wholeFloor) {
    return { decision: "same", reason: "같은 층·임대조건·평수" };
  }
  if (sameKnownFloor && !incoming.units.length && !existing.units.length && offerMatch) {
    return { decision: "same", reason: "같은 층·임대조건·평수" };
  }
  if (incoming.floor == null && existing.floor == null && offerMatch) {
    return { decision: "same", reason: "층 미상·임대조건·평수 일치" };
  }
  if (incoming.key && incoming.key === existing.key && offerMatch) {
    return { decision: "same", reason: "같은 층호실·임대조건·평수" };
  }
  if ((incoming.floor == null || existing.floor == null) && reliableOfferMismatch(record || {}, row || {})) {
    return { decision: "different", reason: "층 미확인이지만 임대조건과 평수가 모두 다름" };
  }
  return { decision: "review", reason: genericSpecific ? "층 표기와 호실 표기 비교 필요" : "공간 식별정보가 부족함" };
}

export function classifyListingCandidates(record, candidates = []) {
  const comparisons = candidates.map((row) => ({ row, ...compareListingSpace(record, row) }));
  const same = comparisons.filter((item) => item.decision === "same");
  const review = comparisons.filter((item) => item.decision === "review");
  if (same.length === 1) return { decision: "merge", candidate: same[0].row, reason: same[0].reason, comparisons };
  if (same.length > 1) return { decision: "review", reason: "같은 조건의 기존 매물이 여러 개", comparisons };
  if (review.length) return { decision: "review", reason: review[0].reason, comparisons };
  return { decision: "create", reason: candidates.length ? "기존 매물과 층·호실이 다름" : "같은 주소의 기존 매물 없음", comparisons };
}

export function choosePendingReviewMatch(record, candidates = [], currentReview = null) {
  const currentCreatedAt = clean(currentReview?.createdAt);
  const currentId = clean(currentReview?.reviewId);
  return candidates
    .filter((candidate) => clean(candidate?.reviewId) !== currentId)
    .filter((candidate) => !(clean(candidate?.source) === clean(record?.source) &&
      clean(candidate?.sourceId) === clean(record?.sourceId)))
    .filter((candidate) => {
      if (!currentCreatedAt) return true;
      const candidateCreatedAt = clean(candidate?.createdAt);
      return candidateCreatedAt < currentCreatedAt ||
        (candidateCreatedAt === currentCreatedAt && clean(candidate?.reviewId) < currentId);
    })
    .map((candidate) => ({ candidate, ...compareListingSpace(record, candidate) }))
    .filter((item) => item.decision === "same")
    .sort((left, right) => clean(left.candidate?.createdAt).localeCompare(clean(right.candidate?.createdAt)) ||
      clean(left.candidate?.reviewId).localeCompare(clean(right.candidate?.reviewId)))[0]?.candidate || null;
}

export function normalizeReviewRecord(value = {}) {
  return {
    ...value,
    originalId: clean(value.originalId),
    source: clean(value.source),
    sourceId: clean(value.sourceId),
    buildingName: clean(value.buildingName) || "일반상가",
    address: normalizedAddress(value.address),
    room: canonicalListingRoom(value.room),
    category: clean(value.category) || "상가점포",
    deposit: number(value.deposit),
    rent: number(value.rent),
    fee: number(value.fee),
    premium: number(value.premium),
    area: number(value.area),
    memo: clean(value.memo),
    link: clean(value.link),
    listSnapshot: clean(value.listSnapshot),
    images: Array.isArray(value.images) ? value.images.filter(Boolean) : [],
    contacts: Array.isArray(value.contacts) ? value.contacts.filter((contact) => contact && typeof contact === "object") : [],
    raw: value.raw && typeof value.raw === "object" ? value.raw : {},
    latitude: coordinate(value.latitude ?? value.lat ?? value.mapY, -90, 90),
    longitude: coordinate(value.longitude ?? value.lng ?? value.lon ?? value.mapX, -180, 180)
  };
}

function exactCandidate(record, candidates) {
  const classified = classifyListingCandidates(record, candidates);
  return classified.decision === "merge" ? classified.candidate : null;
}

async function replaceMediaAndContacts(env, record, sourceRowId, listingId, now, existingAssets = null) {
  const current = existingAssets || { media: [], contacts: [] };
  const statements = [];
  let mediaChanged = 0;
  let contactsChanged = 0;

  const desiredMedia = new Map(record.images.map((url, index) => [url, index]));
  const currentMedia = new Map();
  for (const row of current.media || []) {
    const url = clean(row.external_url);
    if (!url || currentMedia.has(url) || !desiredMedia.has(url)) {
      statements.push(env.DB.prepare("DELETE FROM listing_media WHERE id=?1").bind(row.id));
      mediaChanged += 1;
      continue;
    }
    currentMedia.set(url, row);
    const order = desiredMedia.get(url);
    if (clean(row.listing_id) !== clean(listingId) || Number(row.sort_order) !== order || clean(row.status) !== "external") {
      statements.push(env.DB.prepare(`UPDATE listing_media SET listing_id=?1, sort_order=?2,
        status='external', updated_at=?3 WHERE id=?4`).bind(listingId, order, now, row.id));
      mediaChanged += 1;
    }
  }
  for (const [url, order] of desiredMedia) {
    if (currentMedia.has(url)) continue;
    statements.push(env.DB.prepare(`INSERT INTO listing_media (
        id, listing_id, source_id, media_type, sort_order, external_url, status, checked_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'image', ?4, ?5, 'external', ?6, ?6, ?6)`)
      .bind(`IMG-${crypto.randomUUID()}`, listingId, sourceRowId, order, url, now));
    mediaChanged += 1;
  }

  const desiredContacts = new Map();
  for (const contact of record.contacts) {
    const normalizedPhone = clean(contact.phone).replace(/\D/g, "");
    const key = `${clean(contact.role)}:${normalizedPhone}`;
    if (!normalizedPhone || desiredContacts.has(key)) continue;
    desiredContacts.set(key, { ...contact, normalizedPhone });
  }
  const currentContacts = new Map();
  for (const row of current.contacts || []) {
    const normalizedPhone = clean(row.normalized_phone || row.phone).replace(/\D/g, "");
    const key = `${clean(row.role)}:${normalizedPhone}`;
    if (!normalizedPhone || currentContacts.has(key) || !desiredContacts.has(key)) {
      statements.push(env.DB.prepare("DELETE FROM listing_contacts WHERE id=?1").bind(row.id));
      contactsChanged += 1;
      continue;
    }
    currentContacts.set(key, row);
    const desired = desiredContacts.get(key);
    if (clean(row.listing_id) !== clean(listingId) || clean(row.name) !== clean(desired.name) ||
        clean(row.phone) !== clean(desired.phone) || clean(row.status) !== "active") {
      statements.push(env.DB.prepare(`UPDATE listing_contacts SET listing_id=?1, name=?2, phone=?3, normalized_phone=?4,
        status='active', last_seen_at=?5, updated_at=?5 WHERE id=?6`)
        .bind(listingId, clean(desired.name), clean(desired.phone), desired.normalizedPhone, now, row.id));
      contactsChanged += 1;
    }
  }
  for (const [key, contact] of desiredContacts) {
    if (currentContacts.has(key)) continue;
    statements.push(env.DB.prepare(`INSERT INTO listing_contacts (
        id, listing_id, source_id, role, name, phone, normalized_phone, status, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8, ?8, ?8)`)
      .bind(`C-${crypto.randomUUID()}`, listingId, sourceRowId, clean(contact.role), clean(contact.name),
        clean(contact.phone), contact.normalizedPhone, now));
    contactsChanged += 1;
  }
  if (statements.length) {
    for (let offset = 0; offset < statements.length; offset += 80) await env.DB.batch(statements.slice(offset, offset + 80));
  }
  return { changed: mediaChanged > 0 || contactsChanged > 0, mediaChanged, contactsChanged };
}

async function attachSource(env, record, listingId, sessionId, existingSource = null, updateCondition = false,
  actor = "collector", existingAssets = null) {
  const now = nowIso();
  const restoredOriginalId = /^O-[A-Za-z0-9_-]{8,160}$/.test(clean(record?.originalId))
    ? clean(record.originalId)
    : "";
  const sourceRowId = clean(existingSource?.id) || restoredOriginalId || `O-${crypto.randomUUID()}`;
  const previous = existingSource ? parseJson(existingSource.list_snapshot_json, {}) : null;
  const snapshot = unifiedSnapshot(record, sourceRowId, listingId, now);
  const snapshotHash = snapshotKey(record.listSnapshot || snapshot);
  const snapshotJson = JSON.stringify(snapshot);
  const rawJson = JSON.stringify(record.raw || {});
  const conditionChanged = Boolean(existingSource) && sourceConditionChanged(previous, snapshot);
  let sourceChanged = !existingSource || clean(existingSource.snapshot_hash) !== snapshotHash ||
    clean(existingSource.source_url) !== clean(record.link) || Number(existingSource.active) !== 1 ||
    Number(existingSource.missing_count || 0) !== 0;
  if (!existingSource) {
    await env.DB.prepare(`INSERT INTO listing_sources (
        id, listing_id, source, source_listing_id, source_url, snapshot_hash, list_snapshot_json, raw_json,
        session_id, active, missing_count, first_collected_at, last_collected_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 0, ?10, ?10, ?10, ?10)`)
      .bind(sourceRowId, listingId, record.source, record.sourceId, record.link, snapshotHash,
        snapshotJson, rawJson, sessionId, now).run();
  }
  const assets = await replaceMediaAndContacts(env, record, sourceRowId, listingId, now, existingAssets);
  if (existingSource) {
    if (sourceChanged || assets.changed) {
      await env.DB.prepare(`UPDATE listing_sources SET listing_id=?1, source_url=?2, snapshot_hash=?3,
          list_snapshot_json=?4, raw_json=?5, session_id=?6, active=1, missing_count=0,
          last_collected_at=?7, updated_at=?7 WHERE id=?8`)
        .bind(listingId, record.link, snapshotHash, snapshotJson, rawJson, sessionId, now, sourceRowId).run();
    } else {
      await env.DB.prepare(`UPDATE listing_sources SET session_id=?1, last_collected_at=?2
        WHERE id=?3 AND (session_id<>?1 OR last_collected_at<>?2)`).bind(sessionId, now, sourceRowId).run();
    }
  }
  const listingNeedsTouch = !existingSource || sourceChanged || assets.changed || updateCondition;
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
    : listingNeedsTouch ? env.DB.prepare(`UPDATE listings SET last_collected_at=?1, updated_at=?1,
        source_url=CASE WHEN source_url='' THEN ?2 ELSE source_url END,
        latitude=CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE latitude END,
        longitude=CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE longitude END WHERE id=?5`)
      .bind(now, record.link, record.latitude, record.longitude, listingId) : null;
  const historyNeeded = !existingSource || sourceChanged || assets.changed || updateCondition;
  const finalStatements = [];
  if (update) finalStatements.push(update);
  if (historyNeeded) finalStatements.push(env.DB.prepare(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(listingId, sourceRowId,
        existingSource ? "sourceUpdated" : "sourceMerged", actor, JSON.stringify(previous || {}), snapshotJson));
  if (finalStatements.length) await env.DB.batch(finalStatements);
  return { sourceRowId, changed: sourceChanged || assets.changed || updateCondition,
    conditionChanged: conditionChanged || updateCondition,
    sourceChanged, mediaChanged: assets.mediaChanged, contactsChanged: assets.contactsChanged };
}

async function createListing(env, record, sessionId, actor = "collector", existingSource = null, existingAssets = null) {
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
  await attachSource(env, record, id, sessionId, existingSource, false, actor, existingAssets);
  await env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
    VALUES (?1, 'collectorCreated', ?2, '{}', ?3)`).bind(id, actor, JSON.stringify(record)).run();
  return id;
}

async function queueReview(env, record, sessionId, candidates, reason = "") {
  const reviewId = `R-${crypto.randomUUID()}`;
  const saved = await env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json, processing_state, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'review', ?7, ?8)
    ON CONFLICT(source, source_listing_id) WHERE processing_state='review' DO UPDATE SET
      session_id=excluded.session_id, snapshot_hash=excluded.snapshot_hash,
      payload_json=excluded.payload_json, result_json=excluded.result_json,
      error_text='', processed_at='', created_at=excluded.created_at
    RETURNING id`)
    .bind(reviewId, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(record), JSON.stringify({ candidateIds: candidates.map((row) => row.id), reason: clean(reason) }), nowIso()).first();
  return clean(saved?.id) || reviewId;
}

async function savePendingReviewAlias(env, record, sessionId, pendingReview) {
  const id = `R-${crypto.randomUUID()}`;
  const compactPayload = {
    source: record.source, sourceId: record.sourceId, buildingName: record.buildingName,
    address: record.address, room: record.room, category: record.category,
    deposit: record.deposit, rent: record.rent, fee: record.fee, premium: record.premium,
    area: record.area, link: record.link, listSnapshot: record.listSnapshot,
    latitude: record.latitude, longitude: record.longitude
  };
  await env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json,
      processing_state, processed_at, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'duplicate', ?7, ?8, ?7)`)
    .bind(id, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(compactPayload), nowIso(), JSON.stringify({
        action: "sameAsPendingReview", canonicalReviewId: clean(pendingReview?.reviewId),
        reason: "이미 검증대기 중인 동일 매물"
      })).run();
  return id;
}

async function saveCollectorError(env, record, sessionId, message) {
  const id = `E-${snapshotKey(`${record.source}:${record.sourceId}`)}`;
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json,
      processing_state, processed_at, result_json, error_text, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'error', ?7, ?8, ?9, ?7)
    ON CONFLICT(id) DO UPDATE SET
      session_id=excluded.session_id, snapshot_hash=excluded.snapshot_hash,
      payload_json=excluded.payload_json, processing_state='error',
      processed_at=excluded.processed_at, result_json=excluded.result_json,
      error_text=excluded.error_text, created_at=excluded.created_at`)
    .bind(id, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(record), at, JSON.stringify({ action: "collectorError", reason: clean(message) }), clean(message)).run();
  return id;
}

async function ingestRecords(env, source, values, metadata = {}) {
  const sessionId = await ensureSession(env, metadata.sessionId, source);
  const totals = { received: 0, created: 0, merged: 0, updated: 0, conditionUpdated: 0,
    refreshed: 0, review: 0, duplicate: 0, failed: 0, addressMissing: 0 };
  const normalizedRecords = [];
  const errors = [];
  const affectedListingIds = new Set();
  for (const value of values) {
    totals.received += 1;
    try {
      const record = normalizedRecord(source, value);
      if (!record?.sourceId) {
        totals.failed += 1;
        if (errors.length < 20) errors.push({ sourceId: "", message: "원본 ID 없음" });
        continue;
      }
      normalizedRecords.push(record);
    } catch (error) {
      totals.failed += 1;
      if (errors.length < 20) errors.push({ sourceId: "", message: clean(error?.message) || "원본 변환 실패" });
    }
  }
  const existingSources = await loadExistingSources(env, source, normalizedRecords);
  const records = [];
  for (const record of normalizedRecords) {
    const existing = existingSources.get(record.sourceId);
    if (!record.address && existing) {
      const previous = parseJson(existing.list_snapshot_json, {});
      record.address = normalizedAddress(existing.listing_address || previous.address);
      if (!record.room) record.room = canonicalListingRoom(existing.listing_room || previous.room);
    }
    if (!record.address) {
      totals.failed += 1;
      totals.addressMissing += 1;
      await saveCollectorError(env, record, sessionId, "지번주소 없음");
      if (errors.length < 20) errors.push({ sourceId: record.sourceId, message: "지번주소 없음" });
      continue;
    }
    records.push(record);
  }
  const sourceAssets = await loadSourceAssets(env, existingSources);
  const candidatesByAddress = await loadCandidateListings(env, records, existingSources);
  const pendingReviewsByAddress = await loadPendingReviewsByAddress(env, records);
  for (const record of records) {
    try {
      const existing = existingSources.get(record.sourceId);
      if (existing?.listing_id) {
        const result = await attachSource(env, record, existing.listing_id, sessionId, existing, false,
          "collector", sourceAssets.get(clean(existing.id)));
        if (result.changed) {
          totals.updated += 1;
          if (result.conditionChanged) totals.conditionUpdated += 1;
          else totals.refreshed += 1;
        }
        else totals.duplicate += 1;
        continue;
      }
      const candidates = candidatesByAddress.get(record.address) || [];
      const classified = classifyListingCandidates(record, candidates);
      const pendingCandidates = pendingReviewsByAddress.get(record.address) || [];
      const pendingMatch = choosePendingReviewMatch(record, pendingCandidates);
      if (classified.decision === "merge") {
        await attachSource(env, record, classified.candidate.id, sessionId);
        totals.merged += 1;
      } else if (pendingMatch) {
        await savePendingReviewAlias(env, record, sessionId, pendingMatch);
        totals.duplicate += 1;
      } else if (classified.decision === "create") {
        const listingId = await createListing(env, record, sessionId);
        candidates.push({ id: listingId, property_id: listingId, title: record.buildingName,
          address: record.address, room: record.room, listing_type: record.category,
          deposit: record.deposit, monthly_rent: record.rent, maintenance_fee: record.fee,
          premium: record.premium, area_m2: record.area, operating_memo: record.memo, main_source: record.source });
        candidatesByAddress.set(record.address, candidates);
        affectedListingIds.add(listingId);
        totals.created += 1;
      } else {
        const reviewId = await queueReview(env, record, sessionId, candidates, classified.reason);
        pendingCandidates.push({
          id: reviewId, reviewId, source: record.source, sourceId: record.sourceId,
          createdAt: nowIso(), room: record.room, deposit: record.deposit,
          monthly_rent: record.rent, area_m2: record.area, record
        });
        pendingReviewsByAddress.set(record.address, pendingCandidates);
        totals.review += 1;
      }
    } catch (error) {
      totals.failed += 1;
      if (errors.length < 20) errors.push({ sourceId: record.sourceId, message: clean(error?.message) || "D1 저장 실패" });
    }
  }
  const previous = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const saved = parseJson(previous?.totals_json, {});
  for (const key of ["received", "created", "merged", "updated", "conditionUpdated", "refreshed",
    "review", "duplicate", "failed"]) {
    saved[key] = Number(saved[key] || 0) + Number(totals[key] || 0);
  }
  if (clean(metadata.collectorVersion)) saved.collectorVersion = clean(metadata.collectorVersion).slice(0, 30);
  if (clean(metadata.scope)) saved.scope = clean(metadata.scope).slice(0, 200);
  await env.DB.prepare("UPDATE collector_sessions SET totals_json=?1, updated_at=?2 WHERE id=?3")
    .bind(JSON.stringify(saved), nowIso(), sessionId).run();
  const customerMatches = await refreshCustomerMatchesForListings(env, [...affectedListingIds]);
  return { ok: true, sessionId, ...totals, errors,
    saved: totals.created + totals.merged + totals.updated,
    inserted: totals.created + totals.merged + totals.updated, customerMatches, sourceBackend: "D1" };
}

export function nextCollectorSourceVisibilityState(current, observed, countMissing) {
  const active = Number(current?.active) !== 0;
  const missingCount = Math.max(0, Number(current?.missingCount ?? current?.missing_count) || 0);
  if (observed) return { active: 1, missingCount: 0 };
  if (!countMissing || !active) return { active: active ? 1 : 0, missingCount };
  const nextMissingCount = missingCount + 1;
  return { active: nextMissingCount >= 3 ? 0 : 1, missingCount: nextMissingCount };
}

function countValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function collectorCompletionAudit(body, observedCount) {
  const requested = Boolean(body?.complete) && !body?.stopped;
  const issues = [];
  const blockingIssues = [];
  const source = sourceName(body?.source);
  const scope = clean(body?.scope);
  const validationVersion = countValue(body?.validationVersion);
  const observed = countValue(observedCount);
  const expected = countValue(body?.expectedCount);
  const manifest = countValue(body?.manifestCount);
  const processed = countValue(body?.processedCount);
  const failed = countValue(body?.failed);
  const addressMissing = countValue(body?.addressMissing);

  const block = (message) => { issues.push(message); blockingIssues.push(message); };
  if (!requested) block(body?.stopped ? "안전중단" : "부분수집 요청");
  if (requested && validationVersion < 2) block("최신 수집기 검증정보 없음");
  if (requested && !/전체|완전수집/.test(`${scope} ${clean(body?.note)}`)) block("전체수집 범위 아님");
  if (requested && observed < 100) block("관찰 원본 100건 미만");
  if (requested && expected <= 0) block("예상 매물 수 없음");
  if (requested && expected > observed) block(`예상 ${expected}건 중 ${observed}건만 확인`);
  if (requested && manifest !== observed) block(`목록 ${manifest}건·원본 ${observed}건 불일치`);
  if (requested && processed < observed) block(`처리 ${processed}건·원본 ${observed}건 불일치`);
  if (requested && failed > 0) {
    issues.push(`실패 ${failed}건`);
    if (failed > addressMissing) blockingIssues.push(`주소 외 실패 ${failed - addressMissing}건`);
  }
  if (requested && addressMissing > 0) issues.push(`주소·층 오류 ${addressMissing}건`);
  if (requested && Boolean(body?.truncated)) block("목록 페이지 잘림");
  if (requested && !clean(body?.collectorVersion)) block("수집기 버전 없음");

  return {
    requested,
    complete: requested && blockingIssues.length === 0,
    issues,
    blockingIssues,
    source,
    validationVersion,
    expected,
    manifest,
    processed,
    observed,
    failed,
    addressMissing,
    collectorVersion: clean(body?.collectorVersion).slice(0, 30)
  };
}

async function finalizeSession(env, body) {
  const source = sourceName(body.source);
  const sessionId = await ensureSession(env, body.sessionId, source);
  const observed = [...new Set((Array.isArray(body.observedSourceIds) ? body.observedSourceIds : [])
    .map((id) => sourceIdFor(source, id)).filter(Boolean))];
  const audit = collectorCompletionAudit({ ...body, source }, observed.length);
  const complete = audit.complete;
  const state = body.stopped ? "paused" : complete ? "completed" : "partial";
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
  totals.completeRequested = audit.requested;
  totals.completionValidated = audit.complete;
  totals.completionIssues = audit.issues;
  totals.expectedCount = audit.expected;
  totals.manifestCount = audit.manifest;
  totals.processedCount = audit.processed;
  totals.failed = Math.max(Number(totals.failed || 0), audit.failed);
  totals.addressMissing = Math.max(Number(totals.addressMissing || 0), audit.addressMissing);
  if (audit.collectorVersion) totals.collectorVersion = audit.collectorVersion;
  await env.DB.prepare(`UPDATE collector_sessions SET state=?1, totals_json=?2,
    finished_at=CASE WHEN ?1 IN ('completed','partial') THEN ?3 ELSE finished_at END, updated_at=?3 WHERE id=?4`)
    .bind(state, JSON.stringify(totals), nowIso(), sessionId).run();
  return { ok: true, action: "finalizeCollectionSession", sessionId, state, complete,
    completeRequested: audit.requested, completionValidated: audit.complete, completionIssues: audit.issues,
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
  const listSnapshot = stableJson({
    sourceId: record.sourceId,
    address: record.address,
    room: record.room,
    category: record.category,
    tradeType: record.tradeType,
    deposit: record.deposit,
    rent: record.rent,
    area: record.area
  });
  return { sourceId: record.sourceId, listSnapshot, deposit: record.deposit, rent: record.rent,
    area: record.area, address: record.address, room: record.room };
}

export function mergeDaangnDetailWithList(article, entry = {}) {
  const record = daangnRecord(article, entry.listSnapshot || "");
  const trade = (Array.isArray(article?.trades) ? article.trades : []).find((candidate) => candidate?.preferred) ||
    article?.trades?.[0] || {};
  const hasDetailRent = trade.monthlyPay != null || trade.yearlyPay != null;
  return {
    ...record,
    sourceId: record.sourceId || clean(entry.sourceId),
    address: record.address || clean(entry.address),
    room: record.room || clean(entry.room),
    deposit: record.deposit == null ? number(entry.deposit) : record.deposit,
    rent: !hasDetailRent && number(entry.rent) != null ? number(entry.rent) : record.rent,
    area: record.area == null ? number(entry.area) : record.area
  };
}

async function loadDaangnJob(env, jobId = `${DAANGN_JOB_PREFIX}active`) {
  const row = await env.DB.prepare("SELECT state, payload_json, progress_json, updated_at FROM jobs WHERE id=?1")
    .bind(jobId).first();
  if (!row) return null;
  const payload = parseJson(row.payload_json, {});
  const progress = parseJson(row.progress_json, {});
  const job = { ...payload, ...progress, _jobId: jobId,
    status: row.state === "completed" ? "complete" : row.state, updatedAt: row.updated_at };
  if (job.phase === "details" && !Array.isArray(job.pendingDetailIds)) {
    job.pendingDetailIds = (job.detailIds || []).slice(Math.max(0, Number(job.processed || 0)));
  }
  if (!job.detailAttempts || typeof job.detailAttempts !== "object" || Array.isArray(job.detailAttempts)) {
    job.detailAttempts = {};
  }
  if (!Array.isArray(job.terminalFailedIds)) job.terminalFailedIds = [];
  if (!Array.isArray(job.detailErrors)) job.detailErrors = [];
  return job;
}

async function saveDaangnJob(env, job) {
  const state = job.status === "complete" ? "completed" : job.status;
  const payload = {
    url: job.url, clusterId: job.clusterId, propertyFilter: job.propertyFilter,
    district: job.district, sessionId: job.sessionId, ids: job.ids || [], entries: job.entries || [],
    detailIds: job.detailIds || [], pendingDetailIds: job.pendingDetailIds || [],
    detailAttempts: job.detailAttempts || {}, terminalFailedIds: job.terminalFailedIds || [],
    cursor: job.cursor || "", hasNextPage: Boolean(job.hasNextPage)
  };
  const progress = { ...job };
  delete progress.ids;
  delete progress.entries;
  delete progress.detailIds;
  delete progress.pendingDetailIds;
  delete progress.detailAttempts;
  delete progress.terminalFailedIds;
  delete progress.propertyFilter;
  delete progress.clusterId;
  delete progress.cursor;
  delete progress.hasNextPage;
  delete progress._jobId;
  await env.DB.prepare(`INSERT INTO jobs (
      id, job_type, owner_email, state, priority, payload_json, progress_json, attempts, available_at, created_at, updated_at
    ) VALUES (?1, 'daangn-collector', 'collector', ?2, 20, ?3, ?4, 0, ?5, ?5, ?5)
    ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload_json=excluded.payload_json,
      progress_json=excluded.progress_json, updated_at=excluded.updated_at`)
    .bind(job._jobId || `${DAANGN_JOB_PREFIX}active`, state, JSON.stringify(payload), JSON.stringify(progress), nowIso()).run();
}

function publicDaangnJob(job) {
  if (!job) return null;
  const output = { ...job };
  delete output.ids;
  delete output.entries;
  delete output.detailIds;
  delete output.pendingDetailIds;
  delete output.detailAttempts;
  delete output.terminalFailedIds;
  delete output.propertyFilter;
  delete output.clusterId;
  delete output.cursor;
  delete output.hasNextPage;
  delete output._jobId;
  return output;
}

async function startDaangnJob(env, body) {
  const parsed = parseDaangnUrl(body.url);
  const sessionId = await ensureSession(env, `DAANGN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, "당근");
  const job = {
    ...parsed, _jobId: daangnJobId(body), collectorVersion: clean(body.collectorVersion).slice(0, 30),
    sessionId, ids: [], entries: [], detailIds: [], pendingDetailIds: [],
    detailAttempts: {}, terminalFailedIds: [], detailErrors: [], cursor: "", hasNextPage: true,
    phase: "list", status: "running", page: 0, found: 0, total: 0, processed: 0, remaining: 0,
    created: 0, merged: 0, updated: 0, review: 0, detailedDuplicates: 0,
    skippedUnchanged: 0, addressMissing: 0, failed: 0, chunkSize: 8,
    detailFetchFailures: 0, detailRetryCount: 0,
    message: "클러스터 목록을 확인하고 있습니다."
  };
  await saveDaangnJob(env, job);
  return { ok: true, job: publicDaangnJob(job), sourceBackend: "D1" };
}

async function fetchDaangnDetail(articleId) {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const payload = await daangnGraphql(DAANGN_DETAIL_HASH, { articleId: String(articleId) });
      const article = payload?.data?.articleByOriginalArticleId;
      if (article) return { article, error: "", attempts: attempt + 1 };
      lastError = "상세 매물 응답이 비어 있습니다.";
    } catch (error) {
      lastError = clean(error?.message || error) || "당근 상세조회 오류";
    }
    if (attempt < 2) await sleep(450 * (attempt + 1) * (attempt + 1));
  }
  return { article: null, error: lastError, attempts: 3 };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
      if (cursor < values.length) await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

async function finalizeDaangnJob(env, job) {
  const result = await finalizeSession(env, {
    source: "당근", sessionId: job.sessionId,
    scope: job.district ? `대전 ${job.district} 완전수집` : "당근 선택클러스터",
    complete: Boolean(job.district), observedSourceIds: job.ids || [],
    validationVersion: 2, collectorVersion: job.collectorVersion,
    expectedCount: Number(job.found || 0), manifestCount: (job.ids || []).length,
    processedCount: Number(job.skippedUnchanged || 0) + Number(job.processed || 0),
    failed: Number(job.failed || 0), addressMissing: Number(job.addressMissing || 0),
    truncated: Boolean(job.hasNextPage),
    note: job.district ? "구 완전수집 완료" : "선택클러스터 수집 완료"
  });
  job.completeCollection = Boolean(result.complete);
  job.completionIssues = Array.isArray(result.completionIssues) ? result.completionIssues : [];
  job.phase = "complete";
  job.status = "complete";
  job.message = result.complete
    ? `전체 ${job.found}개 확인 · 완전수집 검증 완료`
    : `전체 ${job.found}개 확인 · 부분수집 보존${job.completionIssues.length ? ` · ${job.completionIssues.join(", ")}` : ""}`;
  return result;
}

async function runDaangnChunk(env, body = {}) {
  const job = await loadDaangnJob(env, daangnJobId(body));
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
        collectorVersion: job.collectorVersion,
        entries: job.entries
      });
      const needed = new Set(classification.needsDetail || []);
      job.detailIds = job.ids.filter((id) => needed.has(id));
      job.pendingDetailIds = job.detailIds.slice();
      job.detailAttempts = {};
      job.terminalFailedIds = [];
      job.detailErrors = [];
      job.detailFetchFailures = 0;
      job.detailRetryCount = 0;
      job.skippedUnchanged = Number(classification.unchanged || 0);
      job.total = job.detailIds.length;
      job.processed = 0;
      job.remaining = job.pendingDetailIds.length;
      job.phase = job.total ? "details" : "complete";
      if (!job.total) await finalizeDaangnJob(env, job);
      else job.message = `전체 ${job.found}개 중 신규·변경 ${job.total}개를 상세 저장합니다.`;
    } else {
      job.message = `${job.page}페이지 · ${job.found}개 목록 확인`;
    }
  } else if (job.phase === "details") {
    const pending = Array.isArray(job.pendingDetailIds)
      ? job.pendingDetailIds.slice()
      : (job.detailIds || []).slice(Math.max(0, Number(job.processed || 0)));
    const activeChunkSize = Math.max(3, Math.min(8, Number(job.chunkSize || 8)));
    const ids = pending.splice(0, activeChunkSize);
    job.detailAttempts = job.detailAttempts && typeof job.detailAttempts === "object"
      ? job.detailAttempts : {};
    job.terminalFailedIds = Array.isArray(job.terminalFailedIds) ? job.terminalFailedIds : [];
    job.detailErrors = Array.isArray(job.detailErrors) ? job.detailErrors : [];
    const fetchStarted = Date.now();
    const retrying = ids.some((id) => Number(job.detailAttempts[id] || 0) > 0);
    const responses = await mapWithConcurrency(ids, retrying ? 1 : 2, (id) => fetchDaangnDetail(id));
    job.lastFetchMs = Date.now() - fetchStarted;
    const records = [];
    responses.forEach((response, index) => {
      const id = ids[index];
      if (response?.article) {
        const entry = job.entries.find((candidate) => candidate.sourceId === id) || { sourceId: id };
        records.push({
          ...mergeDaangnDetailWithList(response.article, entry),
          source: "당근"
        });
        return;
      }
      const attempts = Number(job.detailAttempts[id] || 0) + 1;
      const message = clean(response?.error) || "당근 상세조회 응답 없음";
      job.detailAttempts[id] = attempts;
      job.detailFetchFailures = Number(job.detailFetchFailures || 0) + 1;
      job.detailErrors.push({ sourceId: id, attempts, message: message.slice(0, 300), at: nowIso() });
      job.detailErrors = job.detailErrors.slice(-DAANGN_DETAIL_ERROR_LIMIT);
      if (attempts < DAANGN_DETAIL_MAX_ATTEMPTS) {
        pending.push(id);
        job.detailRetryCount = Number(job.detailRetryCount || 0) + 1;
      } else {
        job.terminalFailedIds.push(id);
        job.failed = Number(job.failed || 0) + 1;
        job.processed = Number(job.processed || 0) + 1;
      }
    });
    job.pendingDetailIds = pending;
    const writeStarted = Date.now();
    const result = records.length
      ? await ingestRecords(env, "당근", records, { sessionId: job.sessionId })
      : { created: 0, merged: 0, updated: 0, review: 0, duplicate: 0, failed: 0, errors: [] };
    job.lastWriteMs = Date.now() - writeStarted;
    job.created += Number(result.created || 0);
    job.merged += Number(result.merged || 0);
    job.updated += Number(result.updated || 0);
    job.review += Number(result.review || 0);
    job.detailedDuplicates += Number(result.duplicate || 0);
    job.failed += Number(result.failed || 0);
    job.addressMissing += Number(result.addressMissing || 0);
    for (const error of result.errors || []) {
      const sourceId = clean(error?.sourceId);
      job.detailErrors.push({ sourceId, attempts: Number(job.detailAttempts[sourceId] || 1),
        message: clean(error?.message).slice(0, 300), at: nowIso() });
    }
    job.detailErrors = job.detailErrors.slice(-DAANGN_DETAIL_ERROR_LIMIT);
    job.processed = Number(job.processed || 0) + records.length;
    job.remaining = pending.length;
    job.lastChunkSize = ids.length;
    const chunkElapsed = Date.now() - chunkStarted;
    if (ids.length - records.length > 0 || chunkElapsed > 20_000) job.chunkSize = Math.max(3, activeChunkSize - 1);
    else if (chunkElapsed < 6_000) job.chunkSize = Math.min(8, activeChunkSize + 1);
    if (!pending.length) {
      await finalizeDaangnJob(env, job);
    } else {
      job.message = `${job.processed} / ${job.total}개 상세 처리`;
    }
    if (job.phase === "details") {
      job.message = `${job.processed} / ${job.total}개 상세 처리 · 남은 ${pending.length}개 · 자동 재시도 ${job.detailRetryCount || 0}회`;
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
  if (action === "danggeunRunJobChunk") return runDaangnChunk(env, body);
  if (action === "danggeunJobStatus") return { ok: true,
    job: publicDaangnJob(await loadDaangnJob(env, daangnJobId(body))), sourceBackend: "D1" };
  if (action === "danggeunPauseJob" || action === "danggeunResumeJob") {
    const job = await loadDaangnJob(env, daangnJobId(body));
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
      items.push(candidateJson(row));
    }
  }

  for (const group of groups.values()) {
    group.candidates = candidatesByAddress.get(normalizedAddress(group.address)) || [];
    group.items.forEach((item) => {
      const classified = classifyListingCandidates(item, group.candidates.map((candidate) => ({
        ...candidate, id: candidate.propertyId, monthly_rent: candidate.rent, area_m2: candidate.area
      })));
      item.autoDecision = classified.decision;
      item.matchReason = classified.reason;
      item.safeCandidateIds = classified.decision === "merge" && classified.candidate
        ? [clean(classified.candidate.propertyId || classified.candidate.id)]
        : [];
    });
    group.count = group.items.length;
    const decisions = new Set(group.items.map((item) => item.autoDecision));
    group.score = decisions.size === 1 && decisions.has("merge") ? 95
      : decisions.size === 1 && decisions.has("create") ? 90 : 55;
    group.risk = group.score >= 80 ? "낮음" : group.score >= 60 ? "중간" : "높음";
    group.recommendation = decisions.size === 1 && decisions.has("merge") ? "자동통합 가능"
      : decisions.size === 1 && decisions.has("create") ? "별도 신규등록 가능" : "직접 비교";
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
  const raw = await env.DB.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN processing_state='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN processing_state='review' THEN 1 ELSE 0 END) AS review,
      SUM(CASE WHEN processing_state='error' THEN 1 ELSE 0 END) AS error
    FROM collector_raw`).first();
  const sessionRows = sessions?.results || [];
  const sourceCounts = new Map((counts?.results || []).map((row) => [sourceName(row.source), row]));
  const latestBySource = new Map();
  for (const row of sessionRows) {
    const name = sourceName(row.source);
    if (!latestBySource.has(name)) latestBySource.set(name, row);
  }
  const sourceCards = ["네이버", "당근", "공실박스"].map((name) => {
    const row = latestBySource.get(name);
    const totals = parseJson(row?.totals_json, {});
    const count = sourceCounts.get(name) || {};
    return {
      source: name, total: Number(count.total || 0), active: Number(count.active || 0), inactive: Number(count.inactive || 0),
      lastStatus: row?.state === "completed" ? "완전수집 완료" : row?.state === "paused" ? "안전중단" : row?.state === "partial" ? "부분수집" : row ? "수집 중" : "수집 전",
      lastAt: row?.finished_at || row?.updated_at || "", lastScope: clean(totals.note) || clean(totals.scope),
      complete: row?.state === "completed" && totals.completionValidated !== false,
      collectorVersion: clean(totals.collectorVersion), completionIssues: Array.isArray(totals.completionIssues) ? totals.completionIssues : [],
      lastResult: totals
    };
  });
  const recent = sessionRows.map((row) => {
    const totals = parseJson(row.totals_json, {});
    return {
      sessionId: row.id, source: sourceName(row.source), status: row.state, scope: clean(totals.note) || clean(totals.scope),
      complete: row.state === "completed" && totals.completionValidated !== false,
      startedAt: row.started_at, endedAt: row.finished_at || row.updated_at, ...totals
    };
  });
  return {
    ok: true, action: "collectionStatus",
    sessions: sessionRows.map((row) => ({
      sessionId: row.id, source: row.source, state: row.state, ...parseJson(row.totals_json, {}),
      startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at
    })),
    sources: sourceCards, recent,
    raw: { total: Number(raw?.total || 0), pending: Number(raw?.pending || 0), error: Number(raw?.error || 0) },
    pendingReview: Number(raw?.review || 0), sourceCounts: counts?.results || [], source: "D1"
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
  const affectedListingIds = new Set();
  const started = Date.now();
  for (const id of ids) {
    try {
      const row = await env.DB.prepare(`SELECT id, session_id, payload_json FROM collector_raw
        WHERE id=?1 AND processing_state='review'`).bind(id).first();
      if (!row) continue;
      const record = parseJson(row.payload_json, null);
      if (!record) throw new Error("검토 원본이 없습니다.");
      const existingSourceMap = await loadExistingSources(env, record.source, [record]);
      const existingSource = existingSourceMap.get(clean(record.sourceId)) || null;
      const existingAssetsMap = existingSource ? await loadSourceAssets(env, existingSourceMap) : new Map();
      const existingAssets = existingSource ? existingAssetsMap.get(clean(existingSource.id)) : null;
      if (action === "hold") {
        await env.DB.prepare("UPDATE collector_raw SET processing_state='held', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action, actor: clean(user?.email) }), id).run();
      } else if (action === "create") {
        const createdId = await createListing(env, record, row.session_id, clean(user?.email), existingSource, existingAssets);
        affectedListingIds.add(createdId);
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action, listingId: createdId }), id).run();
      } else if (action === "merge" || action === "condition") {
        const listing = await env.DB.prepare("SELECT id FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1").bind(masterId).first();
        if (!listing) throw new Error("통합할 기존 매물을 찾지 못했습니다.");
        await attachSource(env, record, listing.id, row.session_id, existingSource, action === "condition",
          clean(user?.email), existingAssets);
        if (action === "condition") affectedListingIds.add(listing.id);
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
  const customerMatches = await refreshCustomerMatchesForListings(env, [...affectedListingIds]);
  const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM collector_raw WHERE processing_state='review'").first();
  return { ok: true, action: "applyReviewBatch", processed, failed, processedReviewIds,
    remaining: Number(remaining?.count || 0), actionWritesVerified: processed,
    reviewRowsRemovedVerified: processed, elapsedMs: Date.now() - started,
    operationAdjustments: { pendingReview: -processed },
    operationRefresh: Number(remaining?.count || 0) === 0, customerMatches, source: "D1" };
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
      env.DB.prepare(`INSERT OR IGNORE INTO customer_matches (
          customer_id, listing_id, state, score, memo, created_at, updated_at, contacted_at
        ) SELECT customer_id, ?1, state, score, memo, created_at, updated_at, contacted_at
          FROM customer_matches WHERE listing_id=?2`).bind(primary.id, duplicate.id),
      env.DB.prepare("DELETE FROM customer_matches WHERE listing_id=?1").bind(duplicate.id),
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
  const customerMatches = await refreshCustomerMatchesForListings(env, [primary.id]);
  return { ok: true, action: "consolidateExistingMasters", consolidated, primaryMasterId: primary.id,
    operationAdjustments: { activeMaster: -consolidated, history: consolidated }, customerMatches, source: "D1" };
}

async function repairExactReviews(env, user, options = {}) {
  const decisionVersion = 4;
  const rows = await env.DB.prepare(`SELECT id, session_id, payload_json, result_json, created_at FROM collector_raw
    WHERE processing_state='review'
      AND COALESCE(json_extract(result_json, '$.autoDecisionVersion'), 0) < ?1
    ORDER BY created_at LIMIT 20`).bind(decisionVersion).all();
  const reviewRows = rows?.results || [];
  const parsedRows = reviewRows.map((row) => {
    const parsed = parseJson(row.payload_json, null);
    return { row, record: parsed ? normalizeReviewRecord(parsed) : null };
  })
    .filter((item) => item.record?.address && item.record?.sourceId);
  const validIds = new Set(parsedRows.map((item) => item.row.id));
  const invalidRows = reviewRows.filter((row) => !validIds.has(row.id));
  const records = parsedRows.map((item) => item.record);
  const candidatesByAddress = await loadCandidateListings(env, records, new Map());
  const existingSourcesByKey = new Map();
  for (const source of [...new Set(records.map((record) => clean(record.source)).filter(Boolean))]) {
    const sourceRows = await loadExistingSources(env, source,
      records.filter((record) => clean(record.source) === source));
    for (const [sourceId, sourceRow] of sourceRows) {
      existingSourcesByKey.set(`${source}:${sourceId}`, sourceRow);
    }
  }
  const existingAssetsBySource = await loadSourceAssets(env, existingSourcesByKey);
  const pendingReviewsByAddress = await loadPendingReviewsByAddress(env, records);
  let merged = 0;
  let created = 0;
  let duplicate = 0;
  let ambiguous = 0;
  let failed = reviewRows.length - parsedRows.length;
  const affectedListingIds = new Set();
  for (const row of invalidRows) {
    await env.DB.prepare("UPDATE collector_raw SET result_json=?1, error_text=?2 WHERE id=?3")
      .bind(JSON.stringify({ autoDecision: "review", autoDecisionVersion: decisionVersion,
        reason: "주소 또는 원본 ID 확인 필요" }), "주소 또는 원본 ID 확인 필요", row.id).run();
  }
  for (const { row, record } of parsedRows) {
    try {
      const pendingMatch = choosePendingReviewMatch(record, pendingReviewsByAddress.get(record.address) || [], {
        reviewId: row.id, createdAt: row.created_at
      });
      if (pendingMatch) {
        await env.DB.prepare("UPDATE collector_raw SET processing_state='duplicate', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action: "sameAsPendingReview",
            canonicalReviewId: pendingMatch.reviewId, reason: "이미 검증대기 중인 동일 매물",
            autoDecisionVersion: decisionVersion }), row.id).run();
        duplicate += 1;
        continue;
      }
      const candidates = candidatesByAddress.get(record.address) || [];
      const classified = classifyListingCandidates(record, candidates);
      const existingSource = existingSourcesByKey.get(`${clean(record.source)}:${clean(record.sourceId)}`) || null;
      const existingAssets = existingSource ? existingAssetsBySource.get(clean(existingSource.id)) : null;
      if (classified.decision === "merge") {
        await attachSource(env, record, classified.candidate.id, row.session_id, existingSource, false,
          clean(user?.email), existingAssets);
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action: "autoMerge", listingId: classified.candidate.id,
            reason: classified.reason, autoDecisionVersion: decisionVersion }), row.id).run();
        merged += 1;
      } else if (classified.decision === "create") {
        const listingId = await createListing(env, record, row.session_id, clean(user?.email), existingSource, existingAssets);
        candidates.push({ id: listingId, property_id: listingId, title: record.buildingName,
          address: record.address, room: record.room, listing_type: record.category,
          deposit: record.deposit, monthly_rent: record.rent, maintenance_fee: record.fee,
          premium: record.premium, area_m2: record.area, operating_memo: record.memo, main_source: record.source });
        candidatesByAddress.set(record.address, candidates);
        affectedListingIds.add(listingId);
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2 WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action: "autoCreate", listingId,
            reason: classified.reason, autoDecisionVersion: decisionVersion }), row.id).run();
        created += 1;
      } else {
        await env.DB.prepare("UPDATE collector_raw SET result_json=?1 WHERE id=?2")
          .bind(JSON.stringify({ candidateIds: candidates.map((candidate) => candidate.id), reason: classified.reason,
            autoDecision: "review", autoDecisionVersion: decisionVersion }), row.id).run();
        ambiguous += 1;
      }
    } catch (error) {
      await env.DB.prepare("UPDATE collector_raw SET error_text=?1 WHERE id=?2")
        .bind(clean(error?.message || error).slice(0, 500), row.id).run();
      failed += 1;
    }
  }
  const customerMatches = await refreshCustomerMatchesForListings(env, [...affectedListingIds]);
  const includeRemaining = options.includeRemaining !== false;
  const pending = includeRemaining
    ? await env.DB.prepare(`SELECT COUNT(*) AS count FROM collector_raw
      WHERE processing_state='review' AND COALESCE(json_extract(result_json, '$.autoDecisionVersion'), 0) < ?1`)
      .bind(decisionVersion).first()
    : null;
  const remainingToScan = includeRemaining ? Number(pending?.count || 0) : null;
  return { ok: true, action: "repairRoomlessExactReviews", scanned: reviewRows.length,
    merged, created, duplicate, ambiguous, failed,
    hasMore: includeRemaining ? remainingToScan > 0 : reviewRows.length >= 20,
    remainingToScan, customerMatches,
    operationAdjustments: { pendingReview: -(merged + created + duplicate) }, source: "D1" };
}

export async function runScheduledReviewRepair(env) {
  return repairExactReviews(env, {
    email: "system-review-repair@js-map.com",
    role: "owner"
  }, { includeRemaining: false });
}

export async function handleCollectorAdminPost(env, user, body) {
  const action = clean(body.action);
  if (!isCollectorAdminPostAction(action)) return null;
  requireRole(user, ["owner", "admin", "member"]);
  if (action === "applyReviewBatch") return applyReviewBatch(env, user, body);
  if (action === "consolidateExistingMasters") return consolidateExisting(env, user, body);
  if (action === "repairRoomlessExactReviews") return repairExactReviews(env, user);
  return null;
}
