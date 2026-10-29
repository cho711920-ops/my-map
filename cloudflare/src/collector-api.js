import { canonicalListingRoom, normalizedRoomKey, parseListingFloor } from "./floor.js";
import { requireRole } from "./security.js";
import { collectorDiagnostics } from "./collector-diagnostics.js";
import { normalizeCollectionCounts, normalizeNewSourceAdCounts, collectionDateRange, summarizeCollectionDay, collectorActionGuidance } from "./collection-status-summary.js";
import { saveAutomationRunReport, readAutomationRunReports } from "./automation-run-reports.js";
import { carryConfirmedVisitMemo, preserveConfirmedVisitMemo } from "./visit-status.js";
import { gongsilSaleFields, naverSaleFields, daangnSaleFields, saleCategoryFromLabel, SALE_CATEGORY_LABELS } from "./sale-fields.js";
import { normalizeNaverPropertyType, resolveNaverSaleCategory } from "./naver-property-types.js";
import { gongsilAdvertisedOffers, hasGongsilOfferEvidence, resolveGongsilOfferIds } from "./gongsil-offers.js";
import { collectorProviderSourceId, resolveCollectorOfferIds } from "./collector-offer-identity.js";
import { advertisementCensusAudit, trackAdvertisementPresence } from "./advertisement-presence.js";
import { gongsilCensusV95 } from "./gongsil-census-v95.js";
import { advertisementObservationKey, firstObservedAdvertisement, loadFirstObservedAdvertisements } from "./collector-first-observed.js";
import { refreshListingRepresentativesFromActiveSources } from "./source-representative-selection.js";
import { exactCollectorRoadAddress } from "./collector-address.js";
import { commitCollectorSourceTransaction, isTransientCollectorDatabaseError } from "./collector-source-transaction.js";
import { DAANGN_GRAPHQL_URL, DAANGN_LIST_FIRST_HASH, DAANGN_LIST_NEXT_HASH, DAANGN_DETAIL_HASH } from "./daangn-provider-contract.js";
import {
  LISTING_TRADE_TYPES,
  listingTradeTypesCanMerge,
  normalizeListingSaleCategory,
  normalizeListingTradeType
} from "./listing-trade.js";

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
  "applyReviewBatch", "consolidateExistingMasters", "repairRoomlessExactReviews",
  "mergeSingleCandidateReviews"
]);
const REVIEW_CLASSIFICATION_VERSION = 15;

const EXTERNAL_ACTIONS = new Set([
  "classifySourceManifest", "saveNaverBatch", "finalizeNaverSession", "getNaverSessionResult",
  "gongsilImportBatch", "finalizeCollectionSession", "mutationStatus",
  "danggeunStartJob", "danggeunResumeJob", "danggeunRunJobChunk", "danggeunPauseJob", "danggeunJobStatus"
  , "saveAutomationRunReport"
]);

const DAANGN_JOB_PREFIX = "collector-daangn-";
const DAANGN_DETAIL_MAX_ATTEMPTS = 8;
const DAANGN_DETAIL_ERROR_LIMIT = 60;
const DAANGN_REQUEST_TIMEOUT_MS = 10_000;
const GONGSIL_PHOTO_ROOT = "https://file1.gongsilbox.com/file/land_photo/";
const GONGSIL_DETAIL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const COLLECTOR_MAX_BODY_BYTES = 4 * 1024 * 1024;
const COLLECTOR_STALE_SESSION_MINUTES = 120;
const COLLECTOR_MAINTENANCE_DELETE_LIMIT = 1_000;

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

const REPRESENTATIVE_SOURCE_PRIORITY = { "당근": 0, "네이버": 1, "공실박스": 2, "직접등록": 3 };

export function shouldPromoteListingRepresentative(incomingSource, currentSource) {
  const incoming = sourceName(incomingSource);
  const current = sourceName(currentSource);
  const incomingPriority = REPRESENTATIVE_SOURCE_PRIORITY[incoming] ?? 9;
  const currentPriority = REPRESENTATIVE_SOURCE_PRIORITY[current] ?? 9;
  return Boolean(incoming) && incomingPriority < currentPriority;
}

function normalizedAddress(value) {
  return clean(value)
    .replace(/^대한민국\s+/, "")
    .replace(/^(?:대전광역시|대전시)\s+/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasExactLotAddress(value) {
  const address = normalizedAddress(value);
  return /(?:^|\s)[가-힣0-9·.]+(?:읍|면|동|가)\s+(?:산\s*)?\d+(?:-\d+)?(?:번지)?(?:\s|$)/.test(address);
}

export function hasPublishableCollectorAddress(source, address) {
  return hasExactLotAddress(address) || ["네이버", "당근"].includes(source) && Boolean(exactCollectorRoadAddress(address));
}

export function existingSourceNeedsAddressReclassification(record, existingSource) {
  const incomingAddress = normalizedAddress(record?.address);
  const assignedAddress = normalizedAddress(existingSource?.listing_address);
  if (["네이버", "당근"].includes(record?.source) && hasExactLotAddress(incomingAddress) !== hasExactLotAddress(assignedAddress)) {
    const previous = parseJson(existingSource?.list_snapshot_json, {});
    const incomingRoad = exactCollectorRoadAddress(record?.roadAddress || incomingAddress);
    const assignedRoad = exactCollectorRoadAddress(previous.roadAddress || assignedAddress);
    // A proven road/parcel representation change of the same ad must not
    // detach the original master and strand its favorites or field notes.
    if (incomingRoad && incomingRoad === assignedRoad) return false;
  }
  return Boolean(
    clean(existingSource?.listing_id) &&
    hasPublishableCollectorAddress(record?.source, incomingAddress) &&
    incomingAddress !== assignedAddress
  );
}

function existingSourceNeedsTradeReclassification(record, existingSource) {
  if (!clean(existingSource?.listing_id)) return false;
  return !listingTradeTypesCanMerge(
    existingSource?.listing_trade_type || existingSource?.trade_type,
    record?.tradeType
  );
}

function normalizedRoom(value) {
  return normalizedRoomKey(value);
}

function collectorTradeType(value, legacyDefault = true) {
  const raw = clean(value);
  if (/^(?:A1|BUY)$/i.test(raw)) return LISTING_TRADE_TYPES.SALE;
  if (/^(?:B2|MONTH|MONTHLY_RENT)$/i.test(raw)) return LISTING_TRADE_TYPES.LEASE;
  return normalizeListingTradeType(raw, { legacyDefault });
}

function collectorSaleCategory(value, fallback = "") {
  const explicit = normalizeListingSaleCategory(value);
  if (explicit) return explicit;
  return saleCategoryFromLabel(fallback || value);
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
  // Photos/photos is the provider's actual listing-photo collection. Xbfimg,
  // bfxphoto and profile paths such as avatars/1.png are representative or
  // broker images and must never fill an otherwise photo-less listing.
  return uniqueUrls(photoRows.map(gongsilPhotoUrl).filter((url) => !/\/avatars\//i.test(url)));
}

function memoWithVisit(value) {
  const memo = clean(value).replace(/^@?\s*\(임장가자\)\s*/i, "").replace(/\s+/g, " ");
  return `(임장가자)${memo ? ` ${memo}` : ""}`.slice(0, 1500);
}

function gongsilRecord(record, advertisedOffer = null) {
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
  const providerSale = gongsilSaleFields(record?.raw || {});
  const rawList = record?.raw?.list || record?.raw || {};
  const explicitSale = /매매|sale|buy/i.test(clean(rawList.TradeType || rawList.DealType || rawList.SaleType || rawList.TransactionType));
  // Recheck provider Me at the server boundary, including old bookmarklets.
  const tradeType = advertisedOffer?.tradeType || (providerSale.salePrice > 0 || explicitSale ? LISTING_TRADE_TYPES.SALE
    : collectorTradeType(record?.tradeType || record?.trade_type || record?.transactionType, true));
  const category = clean(values[3] || record?.category) || "상가점포";
  const salePrice = tradeType === LISTING_TRADE_TYPES.SALE
    ? advertisedOffer?.salePrice ?? providerSale.salePrice ?? number(record?.salePrice ?? record?.sale_price)
    : null;
  const saleCategory = providerSale.saleCategory !== "other" ? providerSale.saleCategory
    : collectorSaleCategory(record?.saleCategory || record?.sale_category, category);
  return {
    source: "공실박스", sourceId, buildingName: clean(values[0]) || clean(record?.buildingName),
    address: normalizedAddress(values[1] || record?.address),
    room: tradeType === "sale" && providerSale.wholeBuilding ? "전체"
      : tradeType === "sale" && providerSale.saleCategory === "land" ? ""
        : canonicalListingRoom(advertisedOffer?.tradeType === "lease"
          ? gongsilLeaseRoom(rawList, values[2] || record?.room) : values[2] || record?.room,
          record?.sourceFloor ?? rawList.Ff ?? rawList.BfFloor ?? rawList.Floor),
    sourceFloor: record?.sourceFloor ?? rawList.Ff ?? rawList.BfFloor ?? rawList.Floor ?? "",
    sourceRoom: clean(record?.sourceRoom ?? rawList.Ho ?? rawList.BfHo ?? rawList.Room ?? rawList.Honame),
    roadAddress: clean(record?.roadAddress || record?.road_address || record?.raw?.detail?.roadAddress),
    category: tradeType === "sale" ? SALE_CATEGORY_LABELS[saleCategory] || category : category, tradeType,
    saleCategory: tradeType === LISTING_TRADE_TYPES.SALE
      ? saleCategory
      : "",
    salePrice, saleDetails: tradeType === "sale" ? providerSale.saleDetails : undefined,
    deposit: tradeType === LISTING_TRADE_TYPES.SALE ? 0 : advertisedOffer?.deposit ?? number(values[4] ?? record?.deposit),
    rent: tradeType === LISTING_TRADE_TYPES.SALE ? 0 : advertisedOffer?.rent ?? number(values[5] ?? record?.rent),
    fee: number(values[6] ?? record?.fee),
    premium: number(values[7] ?? record?.premium),
    area: tradeType === "sale" && (providerSale.wholeBuilding || providerSale.saleCategory === "land")
      ? providerSale.area : number(values[8] ?? record?.area),
    memo: memoWithVisit(values[11] || record?.memo), link: clean(record?.url || record?.sourceUrl),
    listSnapshot: clean(record?.listSnapshot), images, contacts, raw: record?.raw || record,
    preserveContacts: Boolean(record?.preserveContacts) && contacts.length === 0,
    contactCaptureStatus: clean(record?.contactCaptureStatus),
    collectionWarnings: Array.isArray(record?.collectionWarnings)
      ? record.collectionWarnings.map(clean).filter(Boolean).slice(0, 10)
      : [],
    latitude: coordinate(record?.latitude ?? record?.lat ?? record?.mapY, -90, 90),
    longitude: coordinate(record?.longitude ?? record?.lng ?? record?.lon ?? record?.mapX, -180, 180)
  };
}

function gongsilLeaseRoom(list, fallback) {
  const room = clean(list.Ho || list.BfHo || list.Room || list.Honame);
  if (room && room !== "0") return /(?:층|호)$|^전체$/.test(room) ? room : `${room}호`;
  const floor = number(list.Ff ?? list.BfFloor ?? list.Floor ?? list.floor);
  return floor ? floor < 0 ? `지하${Math.abs(floor)}층` : `${floor}층` : fallback;
}

function gongsilCollectionTradeType(value) {
  if (value == null || value === "") return "";
  if (value !== "lease" && value !== "sale") throw new Error("공실박스 수집 거래유형을 확인해 주세요.");
  return value;
}

export function gongsilOfferRecords(value, requestedTradeType = "") {
  const collectionTradeType = gongsilCollectionTradeType(requestedTradeType);
  const list = value?.raw?.list || value?.raw || {};
  const detail = value?.raw?.detail || {};
  const offers = gongsilAdvertisedOffers(list, detail);
  if (!offers.length && hasGongsilOfferEvidence(list, detail)) return [];
  if (collectionTradeType) {
    // Preserve the complete provider evidence, but publish only the market the
    // operator explicitly requested. Never synthesize a price from old values.
    return offers.filter(offer => offer.tradeType === collectionTradeType)
      .map(offer => ({ ...gongsilRecord(value, offer), collectionTradeType }));
  }
  // Old payloads without a structured list retain their normal validation.
  return offers.length ? offers.map((offer) => gongsilRecord(value, offer)) : [gongsilRecord(value)];
}

function naverRecord(item) {
  const sourceId = sourceIdFor("네이버", collectorProviderSourceId(
    item?.articleNo || item?.articleNumber || item?.providerSourceId || item?.sourceId));
  const images = uniqueUrls(item?.imageUrls || item?.images || []);
  if (clean(item?.primaryImage) && !images.includes(clean(item.primaryImage))) images.unshift(clean(item.primaryImage));
  const saleDetails = scrubExternalContactData(naverSaleFields(item));
  const tradeType = collectorTradeType(item?.tradeType || item?.tradeTypeCode || item?.trade_type, true);
  const squareMeters = tradeType === "sale" && saleDetails.scope === "land" ? saleDetails.landAreaM2
    : tradeType === "sale" && saleDetails.scope === "whole_building" ? saleDetails.grossAreaM2
      : number(item?.areaSquareMeter);
  const category = normalizeNaverPropertyType(item?.category, item?.realEstateTypeCode).label;
  const salePrice = tradeType === LISTING_TRADE_TYPES.SALE
    ? number(item?.salePrice ?? item?.sale_price ?? item?.dealPrice)
    : null;
  const suppliedAddress = normalizedAddress(item?.jibunAddress || item?.address);
  const roadAddress = exactCollectorRoadAddress(item?.roadAddress || item?.road_address || item?.roadAddressName)
    || exactCollectorRoadAddress(suppliedAddress);
  return {
    source: "네이버", sourceId, buildingName: clean(item?.buildingName) || "일반상가",
    address: hasExactLotAddress(suppliedAddress) ? suppliedAddress : roadAddress,
    roadAddress,
    room: tradeType === "sale" && saleDetails.scope === "whole_building" ? "전체"
      : tradeType === "sale" && saleDetails.scope === "land" ? "" : canonicalListingRoom(item?.roomInfo || item?.floorInfo), category, tradeType,
    saleCategory: tradeType === LISTING_TRADE_TYPES.SALE
      ? resolveNaverSaleCategory(item?.category, item?.saleCategory || item?.sale_category, item?.realEstateTypeCode)
      : "",
    salePrice, saleDetails: tradeType === "sale" ? saleDetails : undefined,
    deposit: tradeType === LISTING_TRADE_TYPES.SALE ? 0 : number(item?.deposit),
    rent: tradeType === LISTING_TRADE_TYPES.SALE ? 0 : number(item?.monthly),
    fee: number(item?.managementFee || item?.fee),
    premium: number(item?.premium), area: squareMeters && squareMeters > 0
      ? Math.round((squareMeters / 3.305785) * 10) / 10 : tradeType === "sale" && saleDetails.scope !== "unit" ? null : number(item?.area),
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

function daangnAddressCandidates(article) {
  return [
    article?.publicJibunAddress,
    article?.jibunAddress,
    article?.address,
    article?.location?.jibunAddress,
    article?.location?.address,
    article?.complex?.jibunAddress,
    ...(article?.complex?.buildingsForAddress?.edges || []).map((edge) => edge?.node?.jibunAddress)
  ];
}

function daangnRoadAddress(article, preserveText = false) {
  const values = [article?.roadAddress, article?.location?.roadAddress, article?.complex?.roadAddress,
    ...(article?.complex?.buildingsForAddress?.edges || []).map(edge => edge?.node?.roadAddress),
    article?.publicAddress, ...daangnAddressCandidates(article)];
  const value = values.find(value => exactCollectorRoadAddress(value));
  if (value) return preserveText ? clean(value) : exactCollectorRoadAddress(value);
  const fallback = exactCollectorRoadAddress(article?.addressInfo, true);
  return fallback && preserveText ? clean(article.addressInfo) : fallback;
}

function daangnLotAddress(value, wholeValue = false) {
  const originalText = clean(value);
  // Normalization removes building-name parentheses. Reject number units first
  // so "1(층)" and "12 (㎡)" cannot become apparently valid parcel numbers.
  if (/\d\s*\(\s*(?:층|평(?:형)?|㎡|m[²2]|제곱(?:미터)?|호(?:실)?|만원|원)\s*\)/i.test(originalText)) return "";
  const text = normalizedAddress(originalText);
  // Do not cut a floor/area unit off a number, or treat "소형상가" as a
  // legal dong name merely because it ends in 가. Legal 가 names use a number.
  const match = text.match(/((?:[가-힣]+(?:시|군|구)\s+)?(?:[가-힣0-9·.]+(?:읍|면|동)|[가-힣0-9·.]*\d+가)\s+(?:산\s*)?\d+(?:-\d+)?)(?:번지)?(?=\s|$|,(?!\d))(?!\s*(?:층|평|㎡|m[²2]|제곱(?:미터)?|호(?:실)?|만원|원)(?:\s|$|,))/i);
  if (!match) return "";
  if (wholeValue && (text.slice(match.index) !== match[0] ||
      !/^(?:[가-힣]+(?:도|시|군|구)\s+)*$/.test(text.slice(0, match.index)))) return "";
  return normalizedAddress(match[1]);
}

function daangnHasAddressEvidence(article) {
  return Boolean(article?.isHideAddress) || [
    ...daangnAddressCandidates(article), article?.addressInfo,
    article?.roadAddress, article?.publicAddress, article?.location?.roadAddress,
    article?.complex?.roadAddress,
    ...(article?.complex?.buildingsForAddress?.edges || []).map((edge) => edge?.node?.roadAddress)
  ].some((value) => Boolean(clean(value)));
}

function daangnFallbackAddress(article, fallback) {
  // Current raw address evidence overrides an older guessed/normalized value.
  // Legacy details with no address fields may retain a complete saved parcel.
  return !daangnHasAddressEvidence(article) && (daangnLotAddress(fallback, true) || exactCollectorRoadAddress(fallback, true))
    ? clean(fallback) : "";
}

function daangnAddress(article) {
  for (const candidate of daangnAddressCandidates(article)) {
    const address = daangnLotAddress(candidate);
    if (address) return address;
  }
  // Descriptive copy is usable only when the entire value is an exact address.
  return daangnLotAddress(article?.addressInfo, true) || daangnRoadAddress(article);
}

function daangnRecord(article, listSnapshot = "", requestedTradeType = "") {
  const trades = Array.isArray(article?.trades) ? article.trades : [];
  // The Daangn MONTH filter can return an article whose preferred offer is a
  // sale when the same article also contains a monthly-rent offer. JS부동산 is
  // a monthly-rent map, so choose the MONTH offer before provider preference.
  const requested = collectorTradeType(requestedTradeType, false);
  const trade = (requested === LISTING_TRADE_TYPES.SALE
    ? trades.find((entry) => /BUY/.test(clean(entry?.type || entry?.__typename).toUpperCase()))
    : trades.find((entry) => /MONTH/.test(clean(entry?.type || entry?.__typename).toUpperCase()))) ||
    trades.find((entry) => entry?.preferred) || trades[0] || {};
  const tradeType = clean(trade.type || trade.__typename).toUpperCase();
  const salesType = clean(article?.salesTypeV3?.type || article?.salesTypeV3?.__typename).toUpperCase();
  const typedCategory = saleCategoryFromLabel(salesType);
  let category = /BUY/.test(tradeType) ? SALE_CATEGORY_LABELS[typedCategory]
    : /OFFICE/.test(salesType) ? "사무실" : /FACTORY|WAREHOUSE/.test(salesType) ? "공장/창고" : "상가점포";
  const providerBuildingName = clean(article?.buildingName || article?.complex?.name);
  const addressLikeBuildingName = /(?:로|길)\s*\d+(?:-\d+)?(?:\s|$)/.test(providerBuildingName);
  const areaM2 = number(article?.area);
  const images = uniqueUrls([...(article?.images || []), ...(article?.floorPlanImages || [])]);
  const sourceId = clean(article?.originalId);
  const roadAddress = daangnRoadAddress(article, true);
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
  let canonicalTradeType = /BUY/.test(tradeType) ? LISTING_TRADE_TYPES.SALE
    : /MONTH/.test(tradeType) ? LISTING_TRADE_TYPES.LEASE : "";
  if (requested && canonicalTradeType !== requested) canonicalTradeType = "";
  let saleCategory = canonicalTradeType === LISTING_TRADE_TYPES.SALE
    ? collectorSaleCategory(article?.saleCategory, salesType)
    : "";
  const saleDetails = canonicalTradeType === "sale" ? scrubExternalContactData(daangnSaleFields(article, saleCategory)) : undefined;
  if (saleDetails?.descriptionCategory) {
    saleCategory = saleDetails.descriptionCategory;
    category = SALE_CATEGORY_LABELS[saleCategory];
  }
  return {
    source: "당근", sourceId,
    buildingName: providerBuildingName && !addressLikeBuildingName
      ? providerBuildingName
      : category === "상가점포" ? "일반상가" : category,
    address: daangnAddress(article),
    roadAddress,
    room: saleCategory === "land" ? "" : saleDetails?.scope === "whole_building" ? "전체" : daangnRoom(article),
    category, tradeType: canonicalTradeType, saleCategory,
    salePrice: canonicalTradeType === LISTING_TRADE_TYPES.SALE ? number(trade?.price) : null,
    saleDetails,
    deposit: canonicalTradeType === LISTING_TRADE_TYPES.SALE ? 0 : number(trade?.deposit ?? trade?.price),
    rent: canonicalTradeType === LISTING_TRADE_TYPES.SALE ? 0 : number(trade?.monthlyPay ?? trade?.yearlyPay) || 0,
    fee: canonicalTradeType === "sale" ? number(article?.totalManageCost) : number(article?.totalManageCost) || 0,
    premium: number(article?.premiumMoney) || 0,
    area: saleDetails?.scope === "whole_building" ? (saleDetails.grossAreaM2 > 0 ? Math.round(saleDetails.grossAreaM2 / 3.305785 * 10) / 10 : null)
      : areaM2 && areaM2 > 0 ? Math.floor((areaM2 / 3.305785) * 10 + 0.0000001) / 10 : null,
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
    )
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
      const canonical = daangnRecord(value.raw, value.listSnapshot, value.tradeType || value.trade_type);
      const canonicalHasTrade = Boolean(canonical.tradeType);
      return {
        ...value,
        source: "당근",
        sourceId: canonical.sourceId || value.sourceId,
        buildingName: canonical.buildingName || value.buildingName,
        address: canonical.address || daangnFallbackAddress(value.raw, value.address),
        roadAddress: canonical.roadAddress || value.roadAddress,
        room: canonical.tradeType === "sale" && canonical.saleCategory === "land" ? "" : canonical.room || value.room,
        category: canonical.category || value.category,
        deposit: canonicalHasTrade ? canonical.deposit : value.deposit,
        rent: canonicalHasTrade ? canonical.rent : value.rent,
        fee: canonicalHasTrade ? canonical.fee : value.fee,
        premium: canonicalHasTrade ? canonical.premium : value.premium,
        area: canonicalHasTrade ? canonical.area : value.area,
        tradeType: Array.isArray(value.raw.trades) ? canonical.tradeType : value.tradeType || "",
        saleDetails: canonical.saleDetails,
        saleCategory: canonical.saleCategory || value.saleCategory || value.sale_category || "",
        salePrice: canonicalHasTrade ? canonical.salePrice : value.salePrice ?? value.sale_price ?? null,
        memo: canonical.memo,
        images: Array.isArray(value.images) ? value.images : canonical.images,
        contacts: [],
        latitude: value.raw.isHideAddress ? canonical.latitude : canonical.latitude ?? value.latitude,
        longitude: value.raw.isHideAddress ? canonical.longitude : canonical.longitude ?? value.longitude,
        raw: canonical.raw
      };
    }
    return daangnRecord(value, value?.listSnapshot, value?.tradeType || value?.trade_type);
  }
  return null;
}

export function isMonthlyCollectorRecord(source, record) {
  const type = collectorTradeType(record?.tradeType, false);
  if (type === "sale" && ["네이버", "당근"].includes(source) && record?.saleCategory === "apartment") return false;
  return type === LISTING_TRADE_TYPES.LEASE || type === LISTING_TRADE_TYPES.SALE;
}

function unifiedSnapshot(record, originalId, propertyId, now, preserveRepresentative = false) {
  return {
    originalId, source: record.source, sourceId: record.sourceId, propertyId,
    providerSourceId: record.providerSourceId || record.sourceId,
    link: record.link, buildingName: record.buildingName, address: record.address,
    roadAddress: record.roadAddress, room: record.room,
    sourceFloor: record.sourceFloor, sourceRoom: record.sourceRoom,
    type: record.category, tradeType: record.tradeType,
    saleCategory: record.saleCategory, salePrice: record.salePrice, saleDetails: record.saleDetails,
    deposit: record.deposit, rent: record.rent, fee: record.fee,
    premium: record.premium, area: record.area, latitude: record.latitude, longitude: record.longitude,
    memo: record.memo, status: "활성",
    firstSeen: now, lastSeen: now, thumbnail: record.images[0] || "",
    photoCount: record.images.length, contactCount: record.contacts.length, revision: 1,
    preserveRepresentative: Boolean(preserveRepresentative)
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
  const entryTradeType = collectorTradeType(entry.tradeType || entry.trade_type, true);
  const savedTradeType = collectorTradeType(saved.tradeType || row.trade_type, true);
  if (!listingTradeTypesCanMerge(entryTradeType, savedTradeType)) return false;
  if (entryTradeType === LISTING_TRADE_TYPES.SALE) {
    const entrySalePrice = number(entry.salePrice ?? entry.sale_price ?? entry.deposit);
    const savedSalePrice = number(saved.salePrice ?? row.sale_price ?? saved.deposit);
    if (entrySalePrice == null || savedSalePrice == null || !sameNumber(entrySalePrice, savedSalePrice)) return false;
  }
  const entryDeposit = number(entry.deposit);
  const savedDeposit = number(saved.deposit) ?? number(row.saved_deposit);
  const entryRent = number(entry.rent);
  const savedRent = number(saved.rent) ?? number(row.saved_rent);
  if (entryTradeType !== LISTING_TRADE_TYPES.SALE) {
    if (entryDeposit == null || savedDeposit == null || entryRent == null || savedRent == null) return false;
    if (!sameNumber(entryDeposit, savedDeposit) || !sameNumber(entryRent, savedRent)) return false;
  }

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

export function manifestEntryMatch(entry, row, source = "") {
  if (!row) return "";
  const incomingTrade = collectorTradeType(entry.tradeType || entry.trade_type, true);
  const savedTrade = collectorTradeType(row.trade_type || parseJson(row.list_snapshot_json, {}).tradeType, true);
  if (!incomingTrade || !savedTrade || incomingTrade !== savedTrade) return "";
  const incomingHash = snapshotKey(entry.listSnapshot || entry);
  const savedHash = clean(row.snapshot_hash).toLowerCase();
  // Sale metadata (land/gross areas, total tenancy income, type) is material.
  // The old lease-only fuzzy shortcut must not discard a changed sale snapshot.
  if (collectorTradeType(entry.tradeType || entry.trade_type, true) === "sale") {
    if (source === "공실박스" && Number(row.sale_metadata_version ||
        parseJson(row.list_snapshot_json, {}).saleDetails?.metadataVersion || 0) < 2) return "";
    // Refresh existing sale details once after the description parser upgrade.
    // Rental schedules and Gongsil contact refresh rules are unchanged.
    if (["네이버", "당근"].includes(source) &&
        Number(row.sale_description_version || parseJson(row.list_snapshot_json, {}).saleDetails?.descriptionVersion || 0) < 1) return "";
    return savedHash === incomingHash && collectorTradeType(row.trade_type || parseJson(row.list_snapshot_json, {}).tradeType, true) === "sale"
      ? "hash" : "";
  }
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
    tradeType: collectorTradeType(value.tradeType || value.trade_type, true),
    saleCategory: clean(value.saleCategory || value.sale_category),
    salePrice: number(value.salePrice ?? value.sale_price),
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
    VALUES (?1, ?2, ?3, 'running', '{"newSourceAds":0,"newSourceAdsReported":true}', ?4, ?4)
    ON CONFLICT(id) DO UPDATE SET source=CASE WHEN excluded.source<>'' THEN excluded.source ELSE collector_sessions.source END,
      state=CASE WHEN collector_sessions.state IN ('completed','partial','finalizing')
        THEN collector_sessions.state ELSE 'running' END,
      finished_at=CASE WHEN collector_sessions.state IN ('completed','partial','finalizing')
        THEN collector_sessions.finished_at ELSE '' END,
      updated_at=CASE WHEN collector_sessions.state IN ('completed','partial','finalizing')
        THEN collector_sessions.updated_at ELSE excluded.updated_at END`).bind(id, source, owner, now).run();
  return id;
}

function preserveNewSourceAdsCounters(jsonParameter) {
  // Source insertion and this counter are committed together. Other session
  // checkpoints must not overwrite a concurrent insert with an earlier read.
  // A pre-upgrade session stays unreported rather than inventing its past total.
  return `json_set(${jsonParameter}, '$.newSourceAds',
    COALESCE(json_extract(totals_json, '$.newSourceAds'), 0),
    '$.newSourceAdsReported', json(CASE WHEN json_extract(totals_json, '$.newSourceAdsReported')=1
      THEN 'true' ELSE 'false' END))`;
}

const NAVER_DURABLE_RESULT_V56 = Symbol("naver-durable-result");
const COLLECTOR_SOURCE_REQUEST_V78 = Symbol("collector-source-request");
function mutationResultStatementV56(env, requestId, action, result, owner = "collector") {
  const id = clean(requestId).slice(0, 160);
  if (!id) return;
  return env.DB.prepare(`INSERT INTO mutation_results (request_id, owner_email, action, state, result_json, created_at, expires_at)
    VALUES (?1, ?2, ?3, 'completed', ?4, ?5, datetime('now','+7 days'))
    ON CONFLICT(request_id) DO UPDATE SET state='completed', result_json=excluded.result_json,
      created_at=excluded.created_at, expires_at=excluded.expires_at
    WHERE mutation_results.owner_email=excluded.owner_email AND mutation_results.action=excluded.action`)
    .bind(id, owner, action, JSON.stringify(result || {}), nowIso());
}

async function saveMutationResult(env, requestId, action, result, owner = "collector") {
  const statement = mutationResultStatementV56(env, requestId, action, result, owner);
  if (statement) {
    // This writes the same exact receipt, never replays source writes/counters.
    for (let attempt = 0; ; attempt += 1) {
      try { await statement.run(); break; }
      catch (error) {
        if (attempt >= 2 || !isTransientCollectorDatabaseError(error)) throw error;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
}

async function mutationScope(env, requestId) {
  const id = clean(requestId).slice(0, 160);
  if (!id) return null;
  return env.DB.prepare(`SELECT owner_email, action FROM mutation_results WHERE request_id=?1`)
    .bind(id).first();
}

async function claimNaverBatchRequest(env, requestId, sessionId = "") {
  const id = clean(requestId).slice(0, 160);
  if (!id) return false;
  // A client deadline does not cancel D1 writes. Keep an unfinished claim
  // until its owner records the result; maintenance must not expire it.
  const claimed = await env.DB.prepare(`INSERT INTO mutation_results (
      request_id, owner_email, action, state, result_json, created_at, expires_at
    ) VALUES (?1, 'collector', 'saveNaverBatch', 'running', ?3, ?2, '')
    ON CONFLICT(request_id) DO UPDATE SET state='running', result_json=excluded.result_json,
      created_at=excluded.created_at, expires_at=''
    WHERE mutation_results.owner_email='collector' AND mutation_results.action='saveNaverBatch'
      AND mutation_results.state='completed' AND mutation_results.expires_at<>''
      AND julianday(mutation_results.expires_at)<=julianday('now')`)
    .bind(id, nowIso(), JSON.stringify({sessionId: clean(sessionId).slice(0,160)})).run();
  return Number(claimed?.meta?.changes || 0) === 1;
}

async function fenceUnacceptedNaverBatch(env, requestId) {
  const id = clean(requestId);
  const match = id.match(/^(S-NAVER-\d{13}-[a-z0-9]{1,16})-batch-\d+-[a-f0-9]{64}$/);
  if (!match || id.length > 160) return;
  const result = {ok:false,code:"naver_request_not_accepted",requiresFreshManifest:true,
    writeNotAcceptedV66:true,sessionId:match[1],
    message:"이전 저장 요청이 서버에 접수되지 않았습니다. 해당 요청의 뒤늦은 실행을 차단했고 최신 전체목록부터 다시 확인합니다."};
  // Compete atomically with the normal write claim. If that claim exists, do
  // nothing: even an old running claim may have committed source writes.
  // If this fence wins, a delayed original POST can only return this failure,
  // so 'missing' never authorizes replay or indefinite local receipt waiting.
  await env.DB.prepare(`INSERT INTO mutation_results
    (request_id,owner_email,action,state,result_json,created_at,expires_at)
    SELECT ?1,'collector','saveNaverBatch','completed',?2,?3,datetime('now','+7 days')
    FROM collector_sessions WHERE id=?4 AND source='네이버' AND state='running'
    ON CONFLICT(request_id) DO NOTHING`)
    .bind(id,JSON.stringify(result),nowIso(),match[1]).run();
}

async function claimGongsilBatchRequestV63(env, body) {
  const id = clean(body.requestId).slice(0, 160);
  if (!id) return false;
  const claimed = await env.DB.prepare(`INSERT INTO mutation_results
    (request_id,owner_email,action,state,result_json,created_at,expires_at)
    VALUES (?1,'collector','gongsilImportBatch','running',?2,?3,'')
    ON CONFLICT(request_id) DO NOTHING`).bind(id,
    JSON.stringify({sessionId: clean(body.sessionId).slice(0,160),requestHashV63: body.requestHashV63}), nowIso()).run();
  return Number(claimed?.meta?.changes || 0) === 1;
}

const NAVER_RESCAN_CODE = "naver_closed_session_rescan";
function naverRescanResult() {
  return {ok:false,code:NAVER_RESCAN_CODE,requiresFreshManifest:true,
    message:"이전 수집 회차가 응답 없음으로 종료됐습니다. 미확인 저장을 재전송하지 않고 최신 전체목록을 다시 대조합니다."};
}
async function closedNaverRequestRecovery(env,id,row) {
  const gongsil = row.action === "gongsilImportBatch";
  if(row.state!=="running"||row.action!=="saveNaverBatch"&&!gongsil)return null;
  const descriptor=parseJson(row.result_json,{});
  const legacy=id.match(/^(S-NAVER-\d{13}-[a-z0-9]{1,16})-/);
  const sessionId=clean(descriptor.sessionId)||(legacy?legacy[1]:"");
  if(!sessionId||!id.startsWith(gongsil ? "gongsil-"+sessionId+"-batch-" : sessionId+"-"))return null;
  const session=await env.DB.prepare(`SELECT source,owner_email,state,started_at,updated_at,finished_at,error_json
    FROM collector_sessions WHERE id=?1`).bind(sessionId).first();
  if(!session||session.source!==(gongsil?"공실박스":"네이버")||session.owner_email!=="collector"||session.state!=="abandoned")return null;
  const failure=parseJson(session.error_json,{}).lastFailure;
  const claimAt=Date.parse(row.created_at),startedAt=Date.parse(session.started_at),closedAt=Date.parse(session.finished_at),updatedAt=Date.parse(session.updated_at),now=Date.now();
  // Age alone never releases a claim. Require the exact owning session's
  // maintenance closure, no later heartbeat, and a settling interval. The
  // original claim stays reserved forever; this is a rescan requirement,
  // never a fabricated result or permission to replay that write.
  if(failure?.type!=="stale-session"||Date.parse(failure.at)!==closedAt||
      !Number.isFinite(claimAt)||!Number.isFinite(startedAt)||!Number.isFinite(closedAt)||updatedAt!==closedAt||
      startedAt>claimAt||closedAt<claimAt||now-claimAt<120*60_000||now-closedAt<5*60_000)return null;
  return gongsil ? {ok:false,code:"gongsil_closed_session_rescan",requiresFreshManifest:true,
    message:"이전 공실박스 회차가 응답 없음으로 종료됐습니다. 미확인 묶음을 재전송하지 않고 최신 전체목록을 다시 확인해야 합니다."} : naverRescanResult();
}

async function mutationStatus(env, requestId, owner = "collector", expectedAction = "") {
  const id = clean(requestId).slice(0, 160);
  const scopedOwner = clean(owner).slice(0, 320);
  const scopedAction = clean(expectedAction).slice(0, 120);
  if (!id || !scopedOwner) return { ok: true, ready: false, requestId: id };
  const row = scopedAction
    ? await env.DB.prepare(`SELECT state, result_json, action, created_at FROM mutation_results
        WHERE request_id=?1 AND owner_email=?2 AND action=?3
          AND (expires_at='' OR julianday(expires_at)>julianday('now'))`)
      .bind(id, scopedOwner, scopedAction).first()
    : await env.DB.prepare(`SELECT state, result_json, action, created_at FROM mutation_results
        WHERE request_id=?1 AND owner_email=?2
          AND (expires_at='' OR julianday(expires_at)>julianday('now'))`)
      .bind(id, scopedOwner).first();
  if (!row) return { ok: true, ready: false, requestId: id, requestState: "missing" };
  const rescan=scopedOwner==="collector"?await closedNaverRequestRecovery(env,id,row):null;
  if(rescan)return {ok:true,ready:true,requestId:id,mutationAction:row.action,result:rescan};
  if (scopedOwner === "collector" && row.state === "running" && row.action === "saveNaverBatch") {
    // An uncertain write is neither a confirmed failure nor safe to replay.
    return {ok: true, ready: false, requestId: id, mutationAction: row.action,
      recoveryWaitV56: {code: "naver_save_result_pending", retryAt: Date.now() + 15 * 60_000,
        message: "이전 저장 결과 확인 대기 · 중복 전송 없이 자동으로 다시 확인합니다."}};
  }
  return { ok: true, ready: row.state === "completed", requestId: id, requestState: row.state,
    mutationAction: clean(row.action), result: parseJson(row.result_json, {}) };
}

function configuredCollectorBodyLimit(env) {
  const configured = Number(env?.COLLECTOR_MAX_BODY_BYTES);
  return Number.isFinite(configured) && configured >= 64 * 1024
    ? Math.min(16 * 1024 * 1024, Math.floor(configured))
    : COLLECTOR_MAX_BODY_BYTES;
}

async function readBoundedRequestText(request, limit) {
  if (!request.body || typeof request.body.getReader !== "function") {
    const text = await request.text();
    return { text, tooLarge: new TextEncoder().encode(text).byteLength > limit };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += Number(value?.byteLength || 0);
    if (bytes > limit) {
      await reader.cancel().catch(() => null);
      return { text: "", tooLarge: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, tooLarge: false };
}

async function readCollectorBody(request, env, responseHeaders = {}) {
  const limit = configuredCollectorBodyLimit(env);
  const declaredHeader = clean(request.headers.get("content-length"));
  const declared = declaredHeader ? Number(declaredHeader) : 0;
  if (declaredHeader && (!Number.isFinite(declared) || declared < 0)) {
    return { error: jsonResponse({ ok: false, message: "잘못된 Content-Length입니다." }, 400, responseHeaders) };
  }
  if (declared > limit) {
    return { error: jsonResponse({ ok: false, message: "한 번에 보낼 수 있는 수집 요청 크기를 초과했습니다." }, 413, responseHeaders) };
  }
  const bounded = await readBoundedRequestText(request, limit);
  if (bounded.tooLarge) {
    return { error: jsonResponse({ ok: false, message: "한 번에 보낼 수 있는 수집 요청 크기를 초과했습니다." }, 413, responseHeaders) };
  }
  try {
    return { body: JSON.parse(bounded.text) };
  } catch {
    return { body: null };
  }
}

export async function runCollectorMaintenance(env, options = {}) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return { ok: true, abandonedSessions: 0, failedJobs: 0, expiredMutationsDeleted: 0 };
  }
  const configuredMinutes = Number(options.staleMinutes ?? env.COLLECTOR_STALE_SESSION_MINUTES);
  const staleMinutes = Number.isFinite(configuredMinutes)
    ? Math.max(30, Math.min(24 * 60, Math.floor(configuredMinutes)))
    : COLLECTOR_STALE_SESSION_MINUTES;
  const now = clean(options.now) || nowIso();
  const cutoff = new Date(Date.parse(now) - staleMinutes * 60_000).toISOString();
  const reason = `heartbeat ${staleMinutes}분 초과로 자동 종료`;
  const sessions = await env.DB.prepare(`UPDATE collector_sessions
    SET state='abandoned', finished_at=?1, updated_at=?1,
      error_json=json_set(CASE WHEN json_valid(error_json) THEN error_json ELSE '{}' END,
        '$.lastFailure', json_object('type','stale-session','message',?2,'at',?1))
    WHERE state IN ('running','finalizing') AND julianday(updated_at)<julianday(?3)`)
    .bind(now, reason, cutoff).run();
  const jobs = await env.DB.prepare(`UPDATE jobs
    SET state='failed', leased_until='', last_error=?2, updated_at=?1,
      progress_json=json_set(CASE WHEN json_valid(progress_json) THEN progress_json ELSE '{}' END,
        '$.lastError', ?2, '$.failedAt', ?1)
    WHERE job_type='daangn-collector' AND state='running' AND julianday(updated_at)<julianday(?3)`)
    .bind(now, reason, cutoff).run();
  const expired = await env.DB.prepare(`DELETE FROM mutation_results WHERE request_id IN (
      SELECT request_id FROM mutation_results
      WHERE expires_at<>'' AND julianday(expires_at)<=julianday(?1)
      ORDER BY expires_at LIMIT ?2
    )`).bind(now, COLLECTOR_MAINTENANCE_DELETE_LIMIT).run();
  await env.DB.prepare(`DELETE FROM collector_source_write_receipts WHERE id IN (
    SELECT id FROM collector_source_write_receipts WHERE expires_at<=datetime(?1)
    ORDER BY expires_at LIMIT ?2
  )`).bind(now, COLLECTOR_MAINTENANCE_DELETE_LIMIT).run();
  return {
    ok: true,
    staleMinutes,
    abandonedSessions: Number(sessions?.meta?.changes || 0),
    failedJobs: Number(jobs?.meta?.changes || 0),
    expiredMutationsDeleted: Number(expired?.meta?.changes || 0)
  };
}

async function classifyManifest(env, body) {
  const source = sourceName(body.source);
  const collectionTradeType = source === "공실박스" ? gongsilCollectionTradeType(body.collectionTradeType) : "";
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (rawEntries.length > 10_000) throw new Error("목록 비교는 한 번에 최대 10,000건까지 가능합니다.");
  let entries = rawEntries.map((entry) => ({
    ...entry, sourceId: sourceIdFor(source, entry?.sourceId)
  })).filter((entry) => entry.sourceId);
  const originalCount = entries.length;
  if (source === "공실박스") {
    entries = await resolveGongsilOfferIds(env, entries.flatMap((entry) => {
      const offers = gongsilAdvertisedOffers(parseJson(entry.listSnapshot, {}));
      if (!offers.length && hasGongsilOfferEvidence(parseJson(entry.listSnapshot, {}))) return [];
      if (collectionTradeType) return offers.filter(offer => offer.tradeType === collectionTradeType)
        .map(offer => ({ ...entry, ...offer, collectionTradeType }));
      return offers.length ? offers.map((offer) => ({ ...entry, ...offer }))
        : [{ ...entry, tradeType: collectorTradeType(entry.tradeType, true) }];
    }));
  } else {
    entries = await resolveCollectorOfferIds(env, source, entries.map((entry) => {
      const tradeType = collectorTradeType(entry.tradeType || entry.trade_type, true);
      if (!tradeType) throw new Error("목록 비교의 거래유형을 확인해 주세요.");
      return { ...entry, tradeType };
    }));
  }
  const sessionId = await ensureSession(env, body.sessionId, source);
  const rows = new Map();
  for (let offset = 0; offset < entries.length; offset += 80) {
    const ids = entries.slice(offset, offset + 80).map((entry) => entry.sourceId);
    const placeholders = ids.map((_, index) => `?${index + 2}`).join(",");
    const result = await env.DB.prepare(`SELECT s.id, s.source_listing_id, s.snapshot_hash, s.list_snapshot_json,
        s.trade_type, s.sale_category, s.sale_price,
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
          SELECT source_listing_id, snapshot_hash, trade_type, sale_category, sale_price,
            json_extract(payload_json, '$.listSnapshot') AS list_snapshot_json,
            COALESCE(json_extract(payload_json, '$.saleDetails.descriptionVersion'),
              json_extract(payload_json, '$.record.saleDetails.descriptionVersion'),
              json_extract(payload_json, '$.saleDescriptionVersion'), 0) AS sale_description_version,
            COALESCE(json_extract(payload_json, '$.saleDetails.metadataVersion'),
              json_extract(payload_json, '$.record.saleDetails.metadataVersion'),
              json_extract(payload_json, '$.saleMetadataVersion'), 0) AS sale_metadata_version,
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
        SELECT source_listing_id, snapshot_hash, list_snapshot_json, trade_type, sale_category, sale_price, last_collected_at,
          '' AS listing_id, NULL AS listing_latitude, NULL AS listing_longitude,
          saved_deposit, saved_rent, saved_area, saved_room, saved_address, sale_description_version, sale_metadata_version
        FROM ranked WHERE row_number=1`).bind(source, ...unresolvedIds).all();
      for (const row of rawResult?.results || []) {
        const id = clean(row.source_listing_id);
        if (id && !rows.has(id)) rows.set(id, row);
      }
    }
  }
  const needsDetail = [];
  const refreshDetail = [];
  const refreshReasons = {expired: 0, contactDeferred: 0, intervalDays: 7};
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
      entry.manifestStatus = "unknown";
      unknown += 1;
      needsDetail.push(entry.sourceId);
    } else if (clean(row.listing_id) && manifestEntryMatch(entry, row, source)) {
      entry.manifestStatus = "unchanged";
      unchanged += 1;
      if (!/^fnv1a-[0-9a-f]{8}$/i.test(clean(row.snapshot_hash)) &&
          clean(entry.listSnapshot) && clean(row.id)) {
        legacyBackfills.push({ id: clean(row.id), hash: snapshotKey(entry.listSnapshot) });
        legacyBootstrapped += 1;
      }
      if (source === "공실박스") {
        const previousSnapshot = parseJson(row.list_snapshot_json, {});
        if (clean(previousSnapshot?.contactCaptureStatus) === "deferred" ||
            shouldRefreshGongsilDetail(row.last_collected_at)) {
          refreshDetail.push(entry.sourceId);
          entry.refreshReasonV63 = clean(previousSnapshot?.contactCaptureStatus) === "deferred" ? "contactDeferred" : "expired";
        }
      }
    } else {
      entry.manifestStatus = "changed";
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
    // A fingerprint-only repair is not a new source observation. Updating its
    // availability clocks after list capture would make the finalization CAS
    // reject this same run's genuine reappearance as an older positive result.
    const statements = legacyBackfills.map((item) => env.DB.prepare(`UPDATE listing_sources
      SET snapshot_hash=?1 WHERE id=?2 AND snapshot_hash=''`).bind(item.hash, item.id));
    for (let offset = 0; offset < statements.length; offset += 80) {
      await env.DB.batch(statements.slice(offset, offset + 80));
    }
  }
  let originalNeeds = needsDetail;
  let originalRefresh = refreshDetail;
  if (entries.some((entry) => entry.providerSourceId)) {
    // Storage is market-qualified; browser detail requests always use the
    // provider's original ID. This applies to every provider, not just Gongsil.
    const states = new Map();
    const refreshIds = new Set(refreshDetail);
    const refresh = new Set();
    for (const entry of entries) {
      const id = entry.providerSourceId;
      const previous = states.get(id);
      if (!previous || entry.manifestStatus === "unknown" ||
          previous !== "unknown" && entry.manifestStatus === "changed") states.set(id, entry.manifestStatus);
      if (refreshIds.has(entry.sourceId)) refresh.add(id);
    }
    unchanged = [...states.values()].filter((state) => state === "unchanged").length;
    unknown = [...states.values()].filter((state) => state === "unknown").length;
    changed = states.size - unchanged - unknown;
    originalNeeds = [...states].filter(([, state]) => state !== "unchanged").map(([id]) => id);
    originalRefresh = [...refresh].filter((id) => states.get(id) === "unchanged");
  }
  if (source === "공실박스") {
    const reasons = new Map();
    for (const entry of entries) {
      const id = entry.providerSourceId || entry.sourceId;
      if (entry.refreshReasonV63 && reasons.get(id) !== "contactDeferred") reasons.set(id, entry.refreshReasonV63);
    }
    for (const id of originalRefresh) {
      if (reasons.has(id)) refreshReasons[reasons.get(id)] += 1;
    }
  }
  const result = { ok: true, action: "classifySourceManifest", source, sessionId, received: originalCount,
    needsDetail: originalNeeds, refreshDetail: originalRefresh, unchanged, changed, unknown, legacyBootstrapped,
    coordinatesRepaired: coordinateRepairs.size, sourceBackend: "D1",
    ...(source === "공실박스" ? {refreshReasons} : {}) };
  const previous = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const totals = parseJson(previous?.totals_json, {});
  totals.manifest = Number(totals.manifest || 0) + originalCount;
  totals.unchanged = Number(totals.unchanged || 0) + unchanged;
  totals.changed = Number(totals.changed || 0) + changed;
  totals.unknown = Number(totals.unknown || 0) + unknown;
  totals.legacyBootstrapped = Number(totals.legacyBootstrapped || 0) + legacyBootstrapped;
  totals.coordinatesRepaired = Number(totals.coordinatesRepaired || 0) + coordinateRepairs.size;
  if (clean(body.collectorVersion)) totals.collectorVersion = clean(body.collectorVersion).slice(0, 30);
  if (clean(body.scope)) totals.scope = clean(body.scope).slice(0, 200);
  await env.DB.prepare(`UPDATE collector_sessions SET totals_json=${preserveNewSourceAdsCounters("?1")}, updated_at=?2 WHERE id=?3`)
    .bind(JSON.stringify(totals), nowIso(), sessionId).run();
  return result;
}

async function loadCandidateListings(env, records, existingSources) {
  const addresses = [...new Set(records.filter((record) => {
    if (!record?.address) return false;
    const existingSource = existingSources.get(record.sourceId);
    return !existingSource?.listing_id || existingSourceNeedsAddressReclassification(record, existingSource) ||
      existingSourceNeedsTradeReclassification(record, existingSource);
  })
    .map((record) => record.address))];
  const byAddress = new Map(addresses.map((address) => [address, []]));
  const byListingId = new Map();
  for (let offset = 0; offset < addresses.length; offset += 60) {
    const chunk = addresses.slice(offset, offset + 60);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const result = await env.DB.prepare(`SELECT id, property_id, title, address, room, listing_type,
        deposit, monthly_rent, maintenance_fee, premium, area_m2, operating_memo, main_source,
        trade_type, sale_category, sale_price, created_at, updated_at,
        (SELECT COUNT(*) FROM listing_sources source_count
          WHERE source_count.listing_id=listings.id AND source_count.active=1) AS active_source_count
      FROM listings WHERE status <> 'deleted' AND address IN (${placeholders})
      ORDER BY active_source_count DESC, created_at, id`).bind(...chunk).all();
    for (const row of result?.results || []) {
      const rows = byAddress.get(clean(row.address));
      if (rows) {
        row.active_source_snapshots = [];
        rows.push(row);
        byListingId.set(clean(row.id), row);
      }
    }
  }
  const listingIds = [...byListingId.keys()].filter(Boolean);
  for (let offset = 0; offset < listingIds.length; offset += 60) {
    const chunk = listingIds.slice(offset, offset + 60);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const result = await env.DB.prepare(`SELECT listing_id, source, source_listing_id, list_snapshot_json
      FROM listing_sources
      WHERE active=1 AND listing_id IN (${placeholders})
      ORDER BY updated_at DESC`).bind(...chunk).all();
    for (const sourceRow of result?.results || []) {
      const listing = byListingId.get(clean(sourceRow.listing_id));
      if (!listing) continue;
      const snapshot = parseJson(sourceRow.list_snapshot_json, {});
      if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") continue;
      listing.active_source_snapshots.push({
        id: `${clean(sourceRow.listing_id)}:${clean(sourceRow.source)}:${clean(sourceRow.source_listing_id)}`,
        property_id: clean(sourceRow.listing_id),
        source: clean(sourceRow.source), source_listing_id: clean(sourceRow.source_listing_id),
        room: canonicalListingRoom(snapshot.room), deposit: number(snapshot.deposit),
        monthly_rent: number(snapshot.rent), area_m2: number(snapshot.area)
      });
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
    const result = await env.DB.prepare(`SELECT id, source, source_listing_id, payload_json,
        trade_type, sale_category, sale_price, created_at
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
        area_m2: record.area, trade_type: clean(row.trade_type) || record.tradeType,
        sale_category: clean(row.sale_category) || record.saleCategory,
        sale_price: row.sale_price ?? record.salePrice, record
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
    const result = await env.DB.prepare(`SELECT s.id, s.listing_id, s.source, s.source_listing_id, s.source_url,
        s.snapshot_hash, s.list_snapshot_json, s.raw_json, s.active, s.missing_count, s.first_collected_at, s.created_at, s.last_collected_at, s.updated_at,
        s.trade_type, s.sale_category, s.sale_price,
        l.address AS listing_address, l.room AS listing_room, l.trade_type AS listing_trade_type
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
    ? [...withoutDongs.matchAll(/(?:^|[^0-9A-Z])([A-Z]?\d{1,4})(?=호|[,/·]|$)/g)].map((match) => {
      const token = match[1];
      const prefix = token.match(/^[A-Z]/)?.[0] || "";
      const digits = token.slice(prefix.length).replace(/^0+/, "") || "0";
      return `${prefix}${digits}`;
    })
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
  const tradeType = collectorTradeType(record?.tradeType || record?.trade_type, true);
  if (tradeType === LISTING_TRADE_TYPES.SALE) {
    const leftPrice = number(row.sale_price ?? row.salePrice);
    const rightPrice = number(record.salePrice ?? record.sale_price);
    const leftArea = number(row.area_m2 ?? row.area);
    const rightArea = number(record.area);
    return leftPrice != null && rightPrice != null && leftArea != null && rightArea != null &&
      sameNumber(leftPrice, rightPrice) && Math.abs(leftArea - rightArea) < 1;
  }
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  const areaMatches = leftArea == null && rightArea == null ||
    leftArea != null && rightArea != null && Math.abs(leftArea - rightArea) < 1;
  return leftDeposit != null && rightDeposit != null && leftRent != null && rightRent != null &&
    areaMatches && sameNumber(leftDeposit, rightDeposit) && sameNumber(leftRent, rightRent);
}

function directlyAlignedSpaceIdentity(record, row) {
  const incoming = roomIdentity(record?.room);
  const existing = roomIdentity(row?.room);
  if (incoming.wholeBuilding || existing.wholeBuilding) {
    return incoming.wholeBuilding && existing.wholeBuilding;
  }
  if (incoming.units.length || existing.units.length) {
    return incoming.units.length > 0 && existing.units.length > 0 && sameSet(incoming.units, existing.units) &&
      (!incoming.dongs.length || !existing.dongs.length || sameSet(incoming.dongs, existing.dongs));
  }
  return incoming.floor != null && existing.floor != null && incoming.floor === existing.floor &&
    incoming.wholeFloor === existing.wholeFloor;
}

function exactOfferTerms(record, row) {
  const tradeType = collectorTradeType(record?.tradeType || record?.trade_type, true);
  if (tradeType === LISTING_TRADE_TYPES.SALE) {
    const leftPrice = number(row.sale_price ?? row.salePrice);
    const rightPrice = number(record.salePrice ?? record.sale_price);
    return leftPrice != null && rightPrice != null && sameNumber(leftPrice, rightPrice);
  }
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  return leftDeposit != null && rightDeposit != null && leftRent != null && rightRent != null &&
    sameNumber(leftDeposit, rightDeposit) && sameNumber(leftRent, rightRent);
}

function compatibleAreaEvidence(record, row) {
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  if (leftArea == null || rightArea == null) return true;
  const areaGap = Math.abs(leftArea - rightArea);
  const relativeGap = relativeNumberGap(leftArea, rightArea);
  if (areaGap > 3.3) return false;
  if (relativeGap <= 0.15) return true;
  return relativeGap <= 0.2 && hasExactLotAddress(record?.address) && hasExactLotAddress(row?.address);
}

function sameOfferWithCompatibleArea(record, row) {
  return exactOfferTerms(record, row) && compatibleAreaEvidence(record, row);
}

function reliableOfferMismatch(record, row) {
  const tradeType = collectorTradeType(record?.tradeType || record?.trade_type, true);
  if (tradeType === LISTING_TRADE_TYPES.SALE) {
    const leftPrice = number(row.sale_price ?? row.salePrice);
    const rightPrice = number(record.salePrice ?? record.sale_price);
    const leftArea = number(row.area_m2 ?? row.area);
    const rightArea = number(record.area);
    if (leftPrice == null || rightPrice == null || leftArea == null || rightArea == null) return false;
    return !sameNumber(leftPrice, rightPrice) && Math.abs(leftArea - rightArea) >= 1;
  }
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

function relativeNumberGap(left, right) {
  const difference = Math.abs(left - right);
  const baseline = Math.min(Math.abs(left), Math.abs(right));
  if (!difference) return 0;
  return baseline > 0 ? difference / baseline : Number.POSITIVE_INFINITY;
}

function stronglyDifferentRentalTerms(record, row, stricter = false) {
  if (collectorTradeType(record?.tradeType || record?.trade_type, true) === LISTING_TRADE_TYPES.SALE) {
    const leftPrice = number(row.sale_price ?? row.salePrice);
    const rightPrice = number(record.salePrice ?? record.sale_price);
    if (leftPrice == null || rightPrice == null) return false;
    return relativeNumberGap(leftPrice, rightPrice) >= (stricter ? 0.35 : 0.2);
  }
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  if (leftDeposit == null || rightDeposit == null || leftRent == null || rightRent == null) return false;

  const depositGap = Math.abs(leftDeposit - rightDeposit);
  const rentGap = Math.abs(leftRent - rightRent);
  if (stricter) {
    return depositGap >= 500 && relativeNumberGap(leftDeposit, rightDeposit) >= 0.35 &&
      rentGap >= 20 && relativeNumberGap(leftRent, rightRent) >= 0.25;
  }
  return depositGap >= 200 && relativeNumberGap(leftDeposit, rightDeposit) >= 0.25 &&
    rentGap >= 10 && relativeNumberGap(leftRent, rightRent) >= 0.15;
}

function clearlyDifferentSameFloorRentalOffer(record, row) {
  if (collectorTradeType(record?.tradeType || record?.trade_type, true) === LISTING_TRADE_TYPES.SALE) return false;
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  if (leftArea == null || rightArea == null) return false;

  const areaGap = Math.abs(leftArea - rightArea);
  const areaClearlyDifferent = areaGap >= 5 && relativeNumberGap(leftArea, rightArea) >= 0.35;
  if (!areaClearlyDifferent) return false;

  const rentClearlyDifferent = leftRent != null && rightRent != null &&
    Math.abs(leftRent - rightRent) >= 20 && relativeNumberGap(leftRent, rightRent) >= 0.3;
  const depositClearlyDifferent = leftDeposit != null && rightDeposit != null &&
    Math.abs(leftDeposit - rightDeposit) >= 500 && relativeNumberGap(leftDeposit, rightDeposit) >= 0.5;
  return rentClearlyDifferent || depositClearlyDifferent;
}

function likelySameFloorPriceAdjustment(record, row) {
  if (collectorTradeType(record?.tradeType || record?.trade_type, true) === LISTING_TRADE_TYPES.SALE) return false;
  const leftDeposit = number(row.deposit);
  const rightDeposit = number(record.deposit);
  const leftRent = number(row.monthly_rent ?? row.rent);
  const rightRent = number(record.rent);
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  if (leftDeposit == null || rightDeposit == null || leftRent == null || rightRent == null ||
      leftArea == null || rightArea == null || Math.abs(leftArea - rightArea) >= 1) return false;
  const rentAdjustment = sameNumber(leftDeposit, rightDeposit) && Math.abs(leftRent - rightRent) <= 20 &&
    relativeNumberGap(leftRent, rightRent) <= 0.2;
  const depositAdjustment = sameNumber(leftRent, rightRent) && Math.abs(leftDeposit - rightDeposit) <= 500 &&
    relativeNumberGap(leftDeposit, rightDeposit) <= 0.2;
  return rentAdjustment || depositAdjustment;
}

function clearlyDifferentSameFloorArea(record, row) {
  if (collectorTradeType(record?.tradeType || record?.trade_type, true) === LISTING_TRADE_TYPES.SALE) return false;
  const leftArea = number(row.area_m2 ?? row.area);
  const rightArea = number(record.area);
  if (leftArea == null || rightArea == null) return false;
  return Math.abs(leftArea - rightArea) >= 5 && relativeNumberGap(leftArea, rightArea) >= 0.3;
}

function compareSingleListingSpace(record, row) {
  if (record?.tradeType === "sale") {
    const incomingCategory = collectorSaleCategory(record.saleCategory, record.category);
    const existingCategory = collectorSaleCategory(row.sale_category || row.saleCategory, row.category);
    if (incomingCategory !== "other" && existingCategory !== "other" && incomingCategory !== existingCategory) {
      return { decision: "different", reason: "매매 물건 종류가 다름" };
    }
    if (incomingCategory === "other" || existingCategory === "other") {
      return { decision: "review", reason: "매매 물건 종류 확인 필요" };
    }
  }
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
  if (sameKnownFloor && !genericSpecific && !incoming.units.length && !existing.units.length &&
      !incoming.wholeFloor && !existing.wholeFloor &&
      sameOfferWithCompatibleArea(record || {}, row || {})) {
    return { decision: "same", reason: "같은 층·거래조건, 면적 표기 호환" };
  }
  if (genericSpecific && offerMatch && !incoming.wholeFloor && !existing.wholeFloor) {
    return { decision: "same", reason: "같은 층·임대조건·평수" };
  }
  if (genericSpecific && reliableOfferMismatch(record || {}, row || {})) {
    return { decision: "different", reason: "같은 층이지만 호실 표기와 임대조건·평수가 모두 다름" };
  }
  if (genericSpecific && stronglyDifferentRentalTerms(record || {}, row || {})) {
    return { decision: "different", reason: "같은 층의 호실 표기와 임대조건이 모두 크게 다름" };
  }
  if (sameKnownFloor && !incoming.units.length && !existing.units.length && offerMatch) {
    return { decision: "same", reason: "같은 층·임대조건·평수" };
  }
  if (sameKnownFloor && !incoming.units.length && !existing.units.length &&
      likelySameFloorPriceAdjustment(record || {}, row || {})) {
    return { decision: "same", reason: "같은 층·평수의 소폭 임대조건 변경" };
  }
  if (sameKnownFloor && !incoming.units.length && !existing.units.length &&
      stronglyDifferentRentalTerms(record || {}, row || {}, true)) {
    return { decision: "different", reason: "같은 층이지만 보증금·월세가 모두 크게 다름" };
  }
  if (sameKnownFloor && !incoming.units.length && !existing.units.length &&
      clearlyDifferentSameFloorRentalOffer(record || {}, row || {})) {
    return { decision: "different", reason: "같은 층이지만 임대조건과 평수가 모두 크게 다름" };
  }
  if (sameKnownFloor && !incoming.units.length && !existing.units.length &&
      clearlyDifferentSameFloorArea(record || {}, row || {})) {
    return { decision: "different", reason: "같은 층이지만 평수가 명확히 다름" };
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

function activeSourceSnapshots(row) {
  return Array.isArray(row?.active_source_snapshots)
    ? row.active_source_snapshots.filter((snapshot) => snapshot && typeof snapshot === "object")
    : [];
}

export function compareListingSpace(record, row) {
  const representative = compareSingleListingSpace(record, row);
  const snapshots = activeSourceSnapshots(row);
  if (!snapshots.length) return representative;

  const incomingIdentity = roomIdentity(record?.room);
  const identities = [row, ...snapshots].map((candidate) => roomIdentity(candidate?.room));
  const explicitUnits = identities.filter((identity) => identity.units.length > 0);
  if (incomingIdentity.units.length && explicitUnits.length &&
      !explicitUnits.some((identity) => sameSet(incomingIdentity.units, identity.units))) {
    return { decision: "different", reason: "연결 원본의 호실이 다름" };
  }

  const sourceComparisons = snapshots.map((snapshot) => ({
    snapshot, ...compareSingleListingSpace(record, snapshot)
  }));
  const sourceMatch = sourceComparisons.find((item) => item.decision === "same");
  if (sourceMatch) {
    return { decision: "same", reason: `연결 원본과 ${sourceMatch.reason}` };
  }
  if (representative.decision === "different") return representative;
  if (sourceComparisons.every((item) => item.decision === "different")) {
    return { decision: "different", reason: sourceComparisons[0]?.reason || "연결 원본과 다른 공간" };
  }
  return representative;
}

function candidateAsIncomingRecord(row) {
  return {
    address: clean(row?.address),
    room: clean(row?.room),
    tradeType: collectorTradeType(row?.trade_type || row?.tradeType, true),
    saleCategory: clean(row?.sale_category || row?.saleCategory),
    salePrice: number(row?.sale_price ?? row?.salePrice),
    deposit: number(row?.deposit),
    rent: number(row?.monthly_rent ?? row?.rent),
    area: number(row?.area_m2 ?? row?.area)
  };
}

function mutuallyEquivalentSameCandidates(items) {
  if (!Array.isArray(items) || items.length < 2) return false;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex]?.item?.row || items[leftIndex]?.row || items[leftIndex];
      const right = items[rightIndex]?.item?.row || items[rightIndex]?.row || items[rightIndex];
      if (!directlyAlignedSpaceIdentity(candidateAsIncomingRecord(left), right)) return false;
      if (compareSingleListingSpace(candidateAsIncomingRecord(left), right).decision !== "same") return false;
      if (compareSingleListingSpace(candidateAsIncomingRecord(right), left).decision !== "same") return false;
    }
  }
  return true;
}

function canonicalSameCandidate(items) {
  return [...items].sort((leftEntry, rightEntry) => {
    const left = leftEntry?.item?.row || leftEntry?.row || leftEntry;
    const right = rightEntry?.item?.row || rightEntry?.row || rightEntry;
    const sourceGap = (REPRESENTATIVE_SOURCE_PRIORITY[sourceName(left?.main_source)] ?? 9) -
      (REPRESENTATIVE_SOURCE_PRIORITY[sourceName(right?.main_source)] ?? 9);
    if (sourceGap) return sourceGap;
    const originalGap = Number(right?.active_source_count || 0) - Number(left?.active_source_count || 0);
    if (originalGap) return originalGap;
    const createdGap = clean(left?.created_at).localeCompare(clean(right?.created_at));
    if (createdGap) return createdGap;
    return clean(left?.id || left?.property_id).localeCompare(clean(right?.id || right?.property_id));
  })[0];
}

export function classifyListingCandidates(record, candidates = []) {
  const comparisons = candidates.map((row) => ({ row, ...compareListingSpace(record, row) }));
  const same = comparisons.filter((item) => item.decision === "same");
  const review = comparisons.filter((item) => item.decision === "review");
  if (same.length === 1) return { decision: "merge", candidate: same[0].row, reason: same[0].reason, comparisons };
  if (same.length > 1) {
    const directSame = same.map((item) => ({ item, direct: compareSingleListingSpace(record, item.row) }))
      .filter(({ direct }) => direct.decision === "same");
    if (!review.length && directSame.length === same.length && mutuallyEquivalentSameCandidates(directSame)) {
      const canonical = canonicalSameCandidate(directSame);
      const duplicateCandidateIds = directSame
        .map(({ item }) => clean(item.row?.id || item.row?.property_id))
        .filter((id) => id && id !== clean(canonical?.item?.row?.id || canonical?.item?.row?.property_id));
      return { decision: "merge", candidate: canonical.item.row, duplicateCandidateIds,
        reason: `${canonical.direct.reason}·중복 대표매물 자동정리`, comparisons };
    }
    const identityAlignedSame = directSame.filter(({ item }) => directlyAlignedSpaceIdentity(record, item.row));
    if (identityAlignedSame.length === 1) {
      return { decision: "merge", candidate: identityAlignedSame[0].item.row,
        reason: `${identityAlignedSame[0].direct.reason}·층호실 표기 우선`, comparisons };
    }
    const exactDirectSame = directSame.filter(({ item }) => reliableOfferMatch(record, item.row));
    if (exactDirectSame.length === 1) {
      return { decision: "merge", candidate: exactDirectSame[0].item.row,
        reason: exactDirectSame[0].direct.reason, comparisons };
    }
    if (directSame.length === 1) {
      return { decision: "merge", candidate: directSame[0].item.row,
        reason: directSame[0].direct.reason, comparisons };
    }
    return { decision: "review", reason: "같은 조건의 기존 매물이 여러 개", comparisons };
  }
  if (review.length) return { decision: "review", reason: review[0].reason, comparisons };
  return { decision: "create", reason: candidates.length
    ? (comparisons[0]?.reason || "기존 매물과 층·호실이 다름")
    : "같은 주소의 기존 매물 없음", comparisons };
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
  const rawTradeType = clean(value.tradeType || value.trade_type);
  const tradeType = collectorTradeType(rawTradeType, true) || rawTradeType;
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
    tradeType,
    saleCategory: tradeType === LISTING_TRADE_TYPES.SALE
      ? collectorSaleCategory(value.saleCategory || value.sale_category, value.category)
      : "",
    salePrice: tradeType === LISTING_TRADE_TYPES.SALE
      ? number(value.salePrice ?? value.sale_price)
      : null,
    memo: clean(value.memo),
    link: clean(value.link),
    listSnapshot: clean(value.listSnapshot),
    images: Array.isArray(value.images) ? value.images.filter(Boolean) : [],
    contacts: Array.isArray(value.contacts) ? value.contacts.filter((contact) => contact && typeof contact === "object") : [],
    preserveContacts: value.preserveContacts === true,
    contactCaptureStatus: clean(value.contactCaptureStatus),
    collectionWarnings: Array.isArray(value.collectionWarnings)
      ? value.collectionWarnings.map(clean).filter(Boolean).slice(0, 10)
      : [],
    raw: value.raw && typeof value.raw === "object" ? value.raw : {},
    latitude: coordinate(value.latitude ?? value.lat ?? value.mapY, -90, 90),
    longitude: coordinate(value.longitude ?? value.lng ?? value.lon ?? value.mapX, -180, 180)
  };
}

function exactCandidate(record, candidates) {
  const classified = classifyListingCandidates(record, candidates);
  return classified.decision === "merge" ? classified.candidate : null;
}

async function replaceMediaAndContacts(env, record, sourceRowId, listingId, now, existingAssets = null, pendingStatements = null) {
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

  if (!record.preserveContacts) {
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
  }
  if (pendingStatements) pendingStatements.push(...statements);
  else if (statements.length) {
    for (let offset = 0; offset < statements.length; offset += 80) await env.DB.batch(statements.slice(offset, offset + 80));
  }
  return { changed: mediaChanged > 0 || contactsChanged > 0, mediaChanged, contactsChanged };
}

function assertSourceTradeBoundary(record, listingTradeType, existingSource = null) {
  // Only an absent legacy trade defaults to lease. Keep explicit unknowns out
  // of both existing representatives and newly created listings.
  const incomingTrade = collectorTradeType(record?.tradeType || record?.trade_type, true);
  const listingTrade = collectorTradeType(listingTradeType, true);
  if (!incomingTrade || !listingTrade) throw new Error("원본과 대표매물의 거래유형을 확인해 주세요.");
  if (incomingTrade !== listingTrade) {
    throw new Error("임대와 매매는 같은 대표매물에 연결할 수 없습니다.");
  }
  if (existingSource && collectorTradeType(existingSource.trade_type, true) !== incomingTrade) {
    throw new Error("다른 거래유형의 수집 원본은 이동할 수 없습니다.");
  }
  return incomingTrade;
}

async function attachSource(env, record, listingId, sessionId, existingSource = null, updateCondition = false,
  actor = "collector", existingAssets = null, preserveListing = false, onNewSource = null, creation = null) {
  const now = nowIso();
  const restoredOriginalId = /^O-[A-Za-z0-9_-]{8,160}$/.test(clean(record?.originalId))
    ? clean(record.originalId)
    : "";
  const sourceRowId = clean(existingSource?.id) || restoredOriginalId || `O-${crypto.randomUUID()}`;
  const sourceStatements = creation ? creation.statements.slice() : [];
  const previous = existingSource ? parseJson(existingSource.list_snapshot_json, {}) : null;
  const observed = record.firstObservedAdvertisementV1 || firstObservedAdvertisement({ source: record.source,
    sourceId: record.sourceId, tradeType: record.tradeType, sourceRows: existingSource ? [existingSource] : [], now });
  const currentListing = creation ? creation.listing : await env.DB.prepare("SELECT main_source, operating_memo, status, trade_type, listing_type FROM listings WHERE id=?1")
    .bind(listingId).first();
  if (!currentListing) throw new Error("연결할 대표매물을 찾지 못했습니다.");
  assertSourceTradeBoundary(record, currentListing.trade_type, existingSource);
  const promoteRepresentative = shouldPromoteListingRepresentative(record.source, currentListing?.main_source);
  const preserveRepresentative = Boolean(preserveListing || previous?.preserveRepresentative);
  const protectListing = preserveRepresentative && !updateCondition && !promoteRepresentative;
  const snapshot = unifiedSnapshot(record, sourceRowId, listingId, now, preserveRepresentative);
  snapshot.firstSeen = observed.firstObservedAt;
  if (record.preserveContacts) {
    snapshot.contactCount = Math.max(
      Number(previous?.contactCount || 0),
      Array.isArray(existingAssets?.contacts) ? existingAssets.contacts.length : 0
    );
    snapshot.contactCaptureStatus = "deferred";
    snapshot.collectionWarnings = record.collectionWarnings;
  }
  const snapshotHash = snapshotKey(record.listSnapshot || snapshot);
  const snapshotJson = JSON.stringify(snapshot);
  const rawJson = JSON.stringify(record.raw || {});
  const conditionChanged = Boolean(existingSource) && sourceConditionChanged(previous, snapshot);
  const sourceIsNewToListing = !existingSource || clean(existingSource?.listing_id) !== clean(listingId);
  const reactivated = shouldReactivateCompletedListing(
    currentListing?.status, existingSource, true, sourceIsNewToListing
  );
  const reactivatedMemo = removeCompletedListingMemo(currentListing?.operating_memo);
  let sourceChanged = !existingSource || clean(existingSource.snapshot_hash) !== snapshotHash ||
    clean(existingSource.source_url) !== clean(record.link) || Number(existingSource.active) !== 1 ||
    Number(existingSource.missing_count || 0) !== 0 ||
    clean(previous?.contactCaptureStatus) !== clean(snapshot.contactCaptureStatus) ||
    clean(previous?.firstSeen) !== observed.firstObservedAt;
  if (!existingSource) {
    sourceStatements.push(env.DB.prepare(`INSERT INTO listing_sources (
        id, listing_id, source, source_listing_id, source_url, snapshot_hash, list_snapshot_json, raw_json,
        trade_type, sale_category, sale_price,
        session_id, active, missing_count, first_collected_at, last_collected_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, 0, ?13, ?14, ?14, ?14)`)
      .bind(sourceRowId, listingId, record.source, record.sourceId, record.link, snapshotHash,
        snapshotJson, rawJson, collectorTradeType(record.tradeType, true), clean(record.saleCategory),
        record.salePrice, sessionId, observed.firstObservedAt, now),
      env.DB.prepare(`UPDATE collector_sessions SET totals_json=json_set(totals_json,
          '$.newSourceAds', COALESCE(json_extract(totals_json, '$.newSourceAds'), 0)+?1),
          updated_at=?2 WHERE id=?3`).bind(observed.previouslyObserved ? 0 : 1, now, sessionId));
  }
  const assets = await replaceMediaAndContacts(env, record, sourceRowId, listingId, now, existingAssets, sourceStatements);
  if (existingSource) {
    if (sourceChanged || assets.changed) {
      sourceStatements.push(env.DB.prepare(`UPDATE listing_sources SET listing_id=?1, source_url=?2, snapshot_hash=?3,
          list_snapshot_json=?4, raw_json=?5, trade_type=?6, sale_category=?7, sale_price=?8,
          session_id=?9, active=1, missing_count=0,
          last_collected_at=?10, updated_at=?10,
          first_collected_at=CASE WHEN first_collected_at=?12 THEN ?13 ELSE first_collected_at END WHERE id=?11`)
        .bind(listingId, record.link, snapshotHash, snapshotJson, rawJson,
          collectorTradeType(record.tradeType, true), clean(record.saleCategory), record.salePrice,
          sessionId, now, sourceRowId, existingSource.first_collected_at || "", observed.firstObservedAt));
    } else {
      sourceStatements.push(env.DB.prepare(`UPDATE listing_sources SET session_id=?1, last_collected_at=?2
        WHERE id=?3 AND (session_id<>?1 OR last_collected_at<>?2)`).bind(sessionId, now, sourceRowId));
    }
  }
  const listingNeedsTouch = !protectListing && (!existingSource || sourceChanged || assets.changed || updateCondition || promoteRepresentative);
  // Source snapshots always refresh; master fields are updated in one bulk,
  // manual-edit-aware representative pass after this ingest batch.
  const update = updateCondition ? env.DB.prepare(`UPDATE listings SET
      deposit=?1,monthly_rent=?2,maintenance_fee=?3,premium=?4,area_m2=?5,sale_price=?6,
      source_url=?7,version=version+1,last_collected_at=?8,updated_at=?8 WHERE id=?9`)
    .bind(record.deposit, record.rent, record.fee, record.premium, record.area, record.salePrice,
      record.link, now, listingId)
    : listingNeedsTouch ? env.DB.prepare(`UPDATE listings SET
      last_collected_at=?1,updated_at=?1,
      source_url=CASE WHEN source_url='' THEN ?2 ELSE source_url END,
      latitude=CASE WHEN latitude IS NULL THEN ?3 ELSE latitude END,
      longitude=CASE WHEN longitude IS NULL THEN ?4 ELSE longitude END,
      road_address=CASE WHEN road_address='' THEN ?5 ELSE road_address END WHERE id=?6`)
    .bind(now, record.link,
      record.latitude, record.longitude, clean(record.roadAddress), listingId) : null;
  const historyNeeded = !existingSource || sourceChanged || assets.changed || updateCondition;
  const finalStatements = sourceStatements;
  if (update) finalStatements.push(update);
  if (reactivated) {
    finalStatements.push(env.DB.prepare(`UPDATE listings SET status='active', operating_memo=?1,
      version=version+1, last_collected_at=?2, updated_at=?2 WHERE id=?3 AND status='계약완료'`)
      .bind(reactivatedMemo, now, listingId));
    finalStatements.push(env.DB.prepare(`INSERT INTO listing_history (
        listing_id, source_id, action, actor_email, before_json, after_json
      ) VALUES (?1, ?2, 'sourceReappeared', ?3, ?4, ?5)`)
      .bind(listingId, sourceRowId, actor, JSON.stringify({ status: "계약완료" }),
        JSON.stringify({ status: "active", reason: sourceIsNewToListing ? "새 원본 광고 확인" : "미노출 원본 재노출" })));
  }
  if (historyNeeded) finalStatements.push(env.DB.prepare(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(listingId, sourceRowId,
        existingSource ? "sourceUpdated" : "sourceMerged", actor, JSON.stringify(previous || {}), snapshotJson));
  if (creation) finalStatements.push(creation.history);
  // Keep each advertisement's source, assets and history in one bounded D1
  // transaction instead of separate network calls. Large legacy galleries
  // retain the 80-statement bound and the original source-before-assets order.
  for (let offset = 0; offset < finalStatements.length; offset += 80) {
    await commitCollectorSourceTransaction(env, finalStatements.slice(offset, offset + 80), {
      requestId: record[COLLECTOR_SOURCE_REQUEST_V78], source: record.source, sourceId: record.sourceId, offset
    });
    // Count publication only after the source insert/counter has committed.
    if (offset === 0 && !existingSource && onNewSource && !observed.previouslyObserved) onNewSource();
  }
  return { sourceRowId, changed: sourceChanged || assets.changed || updateCondition || promoteRepresentative,
    conditionChanged: conditionChanged || updateCondition || promoteRepresentative,
    representativePromoted: promoteRepresentative,
    reactivated,
    sourceChanged, mediaChanged: assets.mediaChanged, contactsChanged: assets.contactsChanged };
}

async function createListing(env, record, sessionId, actor = "collector", existingSource = null, existingAssets = null,
  onNewSource = null) {
  const tradeType = assertSourceTradeBoundary(record, record?.tradeType || record?.trade_type, existingSource);
  const id = `M-${crypto.randomUUID()}`;
  const now = nowIso();
  const observed = record.firstObservedAdvertisementV1 || firstObservedAdvertisement({ source: record.source,
    sourceId: record.sourceId, tradeType: record.tradeType, sourceRows: existingSource ? [existingSource] : [], now });
  const contacts = JSON.stringify(Array.isArray(record.contacts) ? record.contacts : []);
  const insert = env.DB.prepare(`INSERT INTO listings (
      id, property_id, status, main_source, title, address, road_address, building_name, room, listing_type,
      trade_type, sale_category, sale_price,
      deposit, monthly_rent, maintenance_fee, premium, area_m2, latitude, longitude, operating_memo, source_url,
      contacts_json, first_collected_at, registration_at, last_collected_at, created_at, updated_at
    ) VALUES (?1, ?1, 'active', ?2, ?3, ?4, ?5, ?3, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
      ?16, ?17, ?18, ?19, ?20, ?21, ?21, ?22, ?22, ?22)`)
    .bind(id, record.source, record.buildingName || "일반상가", record.address, clean(record.roadAddress),
      record.room, record.category, tradeType, clean(record.saleCategory), record.salePrice,
      record.deposit, record.rent, record.fee, record.premium, record.area,
      record.latitude, record.longitude, record.memo, record.link, contacts, observed.firstObservedAt, now);
  const history = env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
    VALUES (?1, 'collectorCreated', ?2, '{}', ?3)`).bind(id, actor, JSON.stringify(record));
  // A new master is private to this transaction. Stage it with the source,
  // assets and creation history instead of leaving an orphan after a disconnect.
  await attachSource(env, record, id, sessionId, existingSource, false, actor, existingAssets, false, onNewSource, {
    statements: [insert], history,
    listing: {main_source: record.source, operating_memo: record.memo, status: "active", trade_type: tradeType, listing_type: record.category}
  });
  return id;
}

async function detachSourceForAddressReview(env, record, existingSource, actor = "collector") {
  const listingId = clean(existingSource?.listing_id);
  const sourceRowId = clean(existingSource?.id);
  if (!listingId || !sourceRowId) return false;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE listing_sources SET listing_id=NULL, updated_at=?1 WHERE id=?2 AND listing_id=?3")
      .bind(now, sourceRowId, listingId),
    env.DB.prepare("UPDATE listing_media SET listing_id=NULL, updated_at=?1 WHERE source_id=?2")
      .bind(now, sourceRowId),
    env.DB.prepare("UPDATE listing_contacts SET listing_id=NULL, updated_at=?1 WHERE source_id=?2")
      .bind(now, sourceRowId),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
      VALUES (?1, ?2, 'sourceAddressReclassification', ?3, ?4, ?5)`)
      .bind(listingId, sourceRowId, clean(actor), JSON.stringify({
        listingId,
        address: normalizedAddress(existingSource?.listing_address)
      }), JSON.stringify({
        listingId: null,
        address: normalizedAddress(record?.address),
        reason: "원본의 정확한 지번이 기존 대표매물과 달라 재분류"
      }))
  ]);
  existingSource.listing_id = null;
  return true;
}

async function queueReview(env, record, sessionId, candidates, reason = "") {
  const reviewId = `R-${crypto.randomUUID()}`;
  const saved = await env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json,
      trade_type, sale_category, sale_price, processing_state, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'review', ?10, ?11)
    ON CONFLICT(source, source_listing_id) WHERE processing_state='review' DO UPDATE SET
      session_id=excluded.session_id, snapshot_hash=excluded.snapshot_hash,
      payload_json=excluded.payload_json, result_json=excluded.result_json,
      trade_type=excluded.trade_type, sale_category=excluded.sale_category, sale_price=excluded.sale_price,
      error_text='', processed_at='', created_at=excluded.created_at
    RETURNING id`)
    .bind(reviewId, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(record), collectorTradeType(record.tradeType, true), clean(record.saleCategory), record.salePrice,
      JSON.stringify({ candidateIds: candidates.map((row) => row.id), reason: clean(reason) }), nowIso()).first();
  return clean(saved?.id) || reviewId;
}

async function currentSingleAddressCandidate(env, record, candidates) {
  if (!record?.address || candidates.length !== 1) return null;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM listings
    WHERE status <> 'deleted' AND address=?1 AND trade_type=?2`)
    .bind(record.address, collectorTradeType(record.tradeType, true)).first();
  return Number(row?.count || 0) === 1 ? candidates[0] : null;
}

async function savePendingReviewAlias(env, record, sessionId, pendingReview) {
  const id = `R-${crypto.randomUUID()}`;
  const compactPayload = {
    source: record.source, sourceId: record.sourceId, buildingName: record.buildingName,
    address: record.address, room: record.room, category: record.category,
    deposit: record.deposit, rent: record.rent, fee: record.fee, premium: record.premium,
    area: record.area, link: record.link, listSnapshot: record.listSnapshot,
    latitude: record.latitude, longitude: record.longitude,
    tradeType: record.tradeType, saleCategory: record.saleCategory, salePrice: record.salePrice,
    saleDescriptionVersion: Number(record.saleDetails?.descriptionVersion || 0),
    saleMetadataVersion: Number(record.saleDetails?.metadataVersion || 0)
  };
  await env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json,
      trade_type, sale_category, sale_price, processing_state, processed_at, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'duplicate', ?10, ?11, ?10)`)
    .bind(id, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(compactPayload), collectorTradeType(record.tradeType, true), clean(record.saleCategory),
      record.salePrice, nowIso(), JSON.stringify({
        action: "sameAsPendingReview", canonicalReviewId: clean(pendingReview?.reviewId),
        reason: "이미 검증대기 중인 동일 매물"
      })).run();
  return id;
}

async function saveCollectorError(env, record, sessionId, message, pendingStatements = null) {
  const id = `E-${snapshotKey(`${record.source}:${record.sourceId}:${collectorTradeType(record.tradeType, true)}`)}`;
  const at = nowIso();
  const statement = env.DB.prepare(`INSERT INTO collector_raw (
      id, session_id, source, source_listing_id, snapshot_hash, payload_json,
      trade_type, sale_category, sale_price, processing_state, processed_at, result_json, error_text, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'error', ?10, ?11, ?12, ?10)
    ON CONFLICT(id) DO UPDATE SET
      session_id=excluded.session_id, snapshot_hash=excluded.snapshot_hash,
      payload_json=excluded.payload_json, processing_state='error',
      trade_type=excluded.trade_type, sale_category=excluded.sale_category, sale_price=excluded.sale_price,
      processed_at=excluded.processed_at, result_json=excluded.result_json,
      error_text=excluded.error_text, created_at=excluded.created_at`)
    .bind(id, sessionId, record.source, record.sourceId, snapshotKey(record.listSnapshot || record),
      JSON.stringify(record), collectorTradeType(record.tradeType, true), clean(record.saleCategory), record.salePrice,
      at, JSON.stringify({ action: "collectorError", reason: clean(message) }), clean(message));
  if (pendingStatements) pendingStatements.push(statement);
  else await statement.run();
  return id;
}

async function completePublishedSaleReviews(env, publications) {
  // Old sale reviews are retried by the manifest path. Close only this
  // successfully published offer; never consume an opposite-market review.
  const statements = publications.map(({ record, listingId }) => env.DB.prepare(`UPDATE collector_raw SET processing_state='processed', processed_at=?1,
      result_json=?2, error_text=''
    WHERE source=?3 AND source_listing_id IN (?4, ?5) AND trade_type=?6
      AND (processing_state IN ('review','awaiting_source_refresh')
        OR (processing_state='error' AND source IN ('네이버','당근')) OR (processing_state='duplicate'
        AND json_extract(result_json, '$.action')='sameAsPendingReview'))`)
    .bind(nowIso(), JSON.stringify({ action: record.tradeType === "sale" ? "directSalePublish" : "directAdvertisementPublish", listingId }), record.source,
      record.sourceId, record.providerSourceId || record.sourceId, collectorTradeType(record.tradeType, true)));
  // Keep a large sale import from adding one extra network round trip per ad.
  for (let offset = 0; offset < statements.length; offset += 80) {
    await env.DB.batch(statements.slice(offset, offset + 80));
  }
}

export function staleAdvertisementSave(existing, metadata = {}) {
  if (!existing) return false;
  const captured = Date.parse(metadata.completionProof?.capturedAt);
  const current = Date.parse(existing.updated_at || existing.last_collected_at);
  // An old, pre-proof client must not resurrect an ad ended by the new policy.
  if (!Number.isFinite(captured)) return Number(existing.active) === 0 && Number(existing.missing_count) >= 1;
  return captured > Date.now() + 60_000 || Number.isFinite(current) && current > captured;
}

async function ingestRecords(env, source, values, metadata = {}) {
  const ingestStarted = Date.now();
  const preparationErrors = [];
  const collectionTradeType = source === "공실박스" ? gongsilCollectionTradeType(metadata.collectionTradeType) : "";
  const sessionId = await ensureSession(env, metadata.sessionId, source);
  const totals = { received: 0, created: 0, merged: 0, updated: 0, conditionUpdated: 0,
    newSourceAds: 0, newSourceAdsReported: true,
    refreshed: 0, review: 0, duplicate: 0, failed: 0, addressMissing: 0,
    contactDeferred: 0, tradeTypeExcluded: 0, reactivated: 0, adsReappeared: 0, staleEvidenceSkipped: 0, offerReceived: 0 };
  let normalizedRecords = [];
  const errors = [];
  const affectedListingIds = new Set();
  const salePublications = [];
  for (const value of values) {
    totals.received += 1;
    try {
      const offers = source === "공실박스" ? gongsilOfferRecords(value, collectionTradeType) : [normalizedRecord(source, value)];
      if (!offers.length) totals.tradeTypeExcluded += 1;
      for (const record of offers) {
        totals.offerReceived += 1;
        if (!record?.sourceId) {
          totals.failed += 1;
          if (errors.length < 20) errors.push({ sourceId: "", message: "원본 ID 없음" });
          continue;
        }
        if (!isMonthlyCollectorRecord(source, record)) {
          totals.tradeTypeExcluded += 1;
          continue;
        }
        if (record.tradeType === "sale" && !(record.salePrice > 0)) {
          totals.failed += 1;
          await saveCollectorError(env, record, sessionId, "매매가 확인 필요: 임대보증금으로 대체하지 않음", preparationErrors);
          if (errors.length < 20) errors.push({ sourceId: record.sourceId, message: "매매가 확인 필요" });
          continue;
        }
        if (record.preserveContacts) totals.contactDeferred += 1;
        normalizedRecords.push(record);
      }
    } catch (error) {
      totals.failed += 1;
      if (errors.length < 20) errors.push({ sourceId: "", message: clean(error?.message) || "원본 변환 실패" });
    }
  }
  if (source === "공실박스") normalizedRecords = await resolveGongsilOfferIds(env, normalizedRecords);
  else normalizedRecords = await resolveCollectorOfferIds(env, source, normalizedRecords);
  if (clean(metadata.requestId) && (source === "네이버" || source === "공실박스" && metadata.requestPolicyVersion === 63)) {
    for (const record of normalizedRecords) Object.defineProperty(record, COLLECTOR_SOURCE_REQUEST_V78, {value: clean(metadata.requestId)});
  }
  const uniqueSources = new Set();
  normalizedRecords = normalizedRecords.filter(record => {
    if (uniqueSources.has(record.sourceId)) { totals.duplicate += 1; return false; }
    uniqueSources.add(record.sourceId);
    return true;
  });
  const existingSources = await loadExistingSources(env, source, normalizedRecords);
  const records = [];
  for (const record of normalizedRecords) {
    const existing = existingSources.get(record.sourceId);
    if (!record.address && existing) {
      const previous = parseJson(existing.list_snapshot_json, {});
      const previousAddress = existing.listing_address || previous.address;
      record.address = source === "당근"
        ? normalizedAddress(daangnFallbackAddress(record.raw, previousAddress))
        : normalizedAddress(previousAddress);
      if (!record.room) record.room = canonicalListingRoom(existing.listing_room || previous.room);
    }
    if (!hasPublishableCollectorAddress(source, record.address)) {
      totals.failed += 1;
      totals.addressMissing += 1;
      const message = source === "공실박스" ? "정확한 지번주소 없음" : "건물번호가 있는 지번·도로명주소 없음";
      await saveCollectorError(env, record, sessionId, message, preparationErrors);
      if (errors.length < 20) errors.push({ sourceId: record.sourceId, message });
      continue;
    }
    records.push(record);
  }
  for (let offset = 0; offset < preparationErrors.length; offset += 80) {
    await env.DB.batch(preparationErrors.slice(offset, offset + 80));
  }
  const [sourceAssets, observedIndex, candidatesByAddress] = await Promise.all([
    loadSourceAssets(env, existingSources),
    records.length ? loadFirstObservedAdvertisements(env, source, records, existingSources, nowIso()) : new Map(),
    loadCandidateListings(env, records, existingSources)
  ]);
  for (const record of records) Object.defineProperty(record, "firstObservedAdvertisementV1", {
    value: observedIndex.get(advertisementObservationKey(source, record.sourceId, record.tradeType)), configurable: true
  });
  const preparedAt = Date.now();
  for (const record of records) {
    try {
      const existing = existingSources.get(record.sourceId);
      if (staleAdvertisementSave(existing, metadata)) {
        totals.duplicate += 1;
        totals.staleEvidenceSkipped += 1;
        continue;
      }
      const addressReclassification = existingSourceNeedsAddressReclassification(record, existing);
      const tradeReclassification = existingSourceNeedsTradeReclassification(record, existing);
      const sourceReclassification = addressReclassification || tradeReclassification;
      if (existing?.listing_id && !sourceReclassification) {
        const result = await attachSource(env, record, existing.listing_id, sessionId, existing, false,
          "collector", sourceAssets.get(clean(existing.id)));
        if (result.reactivated) {
          affectedListingIds.add(existing.listing_id);
          totals.reactivated += 1;
        }
        if (result.changed) {
          totals.updated += 1;
          if (result.conditionChanged) totals.conditionUpdated += 1;
          else totals.refreshed += 1;
        }
        else totals.duplicate += 1;
        if (Number(existing.active) === 0) totals.adsReappeared += 1;
        salePublications.push({ record, listingId: existing.listing_id });
        continue;
      }
      if (sourceReclassification) {
        await detachSourceForAddressReview(env, record, existing, "collector-address-reclassification@js-map.com");
      }
      const candidates = (candidatesByAddress.get(record.address) || []).filter((candidate) =>
        listingTradeTypesCanMerge(candidate.trade_type, record.tradeType));
      const identity = roomIdentity(record.room);
      const unitUnspecified = ["네이버", "당근"].includes(source) && record.tradeType === "lease"
        && identity.floor == null && !identity.units.length && !identity.wholeBuilding;
      // An address identifies the building, not a unit. Publish an addressed
      // floorless ad separately even if another unit has identical prices.
      const classified = classifyListingCandidates(record, unitUnspecified ? [] : candidates);
      // Uncertain identity is published separately, never forced into another unit.
      let publishedListingId = "";
      if (classified.decision === "merge") {
        const consolidated = await consolidateClassifiedCandidateDuplicates(env, {
          email: "collector-duplicate-master-repair@js-map.com"
        }, classified);
        if (consolidated > 0) {
          const removedIds = new Set(classified.duplicateCandidateIds || []);
          candidatesByAddress.set(record.address, (candidatesByAddress.get(record.address) || [])
            .filter((candidate) => !removedIds.has(clean(candidate.id || candidate.property_id))));
          affectedListingIds.add(classified.candidate.id);
        }
        const result = await attachSource(env, record, classified.candidate.id, sessionId, existing, false,
          "collector", existing ? sourceAssets.get(clean(existing.id)) : null, sourceReclassification,
          () => { totals.newSourceAds += 1; });
        if (result.reactivated) {
          affectedListingIds.add(classified.candidate.id);
          totals.reactivated += 1;
        }
        totals.merged += 1;
        publishedListingId = classified.candidate.id;
      } else {
        const listingId = await createListing(env, record, sessionId, "collector", existing,
          existing ? sourceAssets.get(clean(existing.id)) : null, () => { totals.newSourceAds += 1; });
        candidates.push({ id: listingId, property_id: listingId, title: record.buildingName,
          address: record.address, room: record.room, listing_type: record.category,
          trade_type: collectorTradeType(record.tradeType, true), sale_category: record.saleCategory,
          sale_price: record.salePrice,
          deposit: record.deposit, monthly_rent: record.rent, maintenance_fee: record.fee,
          premium: record.premium, area_m2: record.area, operating_memo: record.memo, main_source: record.source });
        // Keep candidates of the opposite market for the next source in this
        // same batch, but never use them as a merge target.
        candidatesByAddress.set(record.address, [
          ...(candidatesByAddress.get(record.address) || []).filter((candidate) =>
            !listingTradeTypesCanMerge(candidate.trade_type, record.tradeType)), ...candidates
        ]);
        affectedListingIds.add(listingId);
        totals.created += 1;
        publishedListingId = listingId;
      }
      if (publishedListingId) salePublications.push({ record, listingId: publishedListingId });
    } catch (error) {
      totals.failed += 1;
      if (errors.length < 20) errors.push({ sourceId: record.sourceId, message: clean(error?.message) || "D1 저장 실패" });
    }
  }
  const sourcesSavedAt = Date.now();
  if (salePublications.length) await completePublishedSaleReviews(env, salePublications);
  const representatives = await refreshListingRepresentativesFromActiveSources(env,
    salePublications.map(entry => entry.listingId));
  for (const id of representatives.changedListingIds) affectedListingIds.add(id);
  // Durations contain no ad payload or credentials. Separate DB preparation,
  // source writes and representative work from provider/browser waiting.
  const writeTimingV64 = { prepareMs: preparedAt - ingestStarted,
    sourcesMs: sourcesSavedAt - preparedAt, representativesMs: Date.now() - sourcesSavedAt,
    totalMs: Date.now() - ingestStarted, records: records.length };
  const previous = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const saved = parseJson(previous?.totals_json, {});
  for (const key of ["received", "offerReceived", "created", "merged", "updated", "conditionUpdated", "refreshed",
    "review", "duplicate", "failed", "contactDeferred", "tradeTypeExcluded", "reactivated", "adsReappeared", "staleEvidenceSkipped"]) {
    saved[key] = Number(saved[key] || 0) + Number(totals[key] || 0);
  }
  if (clean(metadata.collectorVersion)) saved.collectorVersion = clean(metadata.collectorVersion).slice(0, 30);
  if (clean(metadata.scope)) saved.scope = clean(metadata.scope).slice(0, 200);
  const priorTiming = saved.writeTimingV64 || {};
  saved.writeTimingV64 = Object.fromEntries(Object.entries(writeTimingV64)
    .map(([key, value]) => [key, Math.max(0, Number(priorTiming[key]) || 0) + value]));
  saved.writeTimingV64.batches = Math.max(0, Number(priorTiming.batches) || 0) + 1;
  const durableReceipt = clean(metadata.requestId) && (source === "네이버" && metadata.action === "saveNaverBatch" ||
    source === "공실박스" && metadata.action === "gongsilImportBatch");
  const guardedReceipt = durableReceipt && (source === "네이버" || metadata.requestPolicyVersion === 63);
  const summaryStatement = env.DB.prepare(`UPDATE collector_sessions SET totals_json=${preserveNewSourceAdsCounters("?1")}, updated_at=?2 WHERE id=?3` +
    (guardedReceipt ? " AND EXISTS (SELECT 1 FROM mutation_results WHERE request_id=?4 AND owner_email='collector' AND action=?5 AND state='running')" : ""));
  const boundSummary = guardedReceipt
    ? summaryStatement.bind(JSON.stringify(saved), nowIso(), sessionId, metadata.requestId, metadata.action)
    : summaryStatement.bind(JSON.stringify(saved), nowIso(), sessionId);
  const result = { ok: true, sessionId, ...totals, errors,
    saved: totals.created + totals.merged + totals.updated,
    inserted: totals.created + totals.merged + totals.updated, sourceBackend: "D1", writeTimingV64 };
  if (source === "공실박스" && metadata.requestPolicyVersion === 63) result.requestHashV63 = metadata.requestHashV63;
  if (durableReceipt) {
    // Census counters and the exact response commit in one D1 transaction.
    // A disconnect after these counters commit cannot strand the receipt.
    const transaction = [boundSummary, mutationResultStatementV56(env, metadata.requestId, metadata.action, result)];
    for (let attempt = 0; ; attempt += 1) {
      try { await env.DB.batch(transaction); break; }
      catch (error) {
        // Guarded summary + exact receipt are safe even if COMMIT succeeded but
        // its response was lost. Never retry the preceding source transactions.
        if (!guardedReceipt || attempt >= 2 || !isTransientCollectorDatabaseError(error)) throw error;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    Object.defineProperty(result, NAVER_DURABLE_RESULT_V56, {value: true});
  } else await boundSummary.run();
  return result;
}

export function nextCollectorSourceVisibilityState(current, observed, countMissing) {
  const active = Number(current?.active) !== 0;
  const missingCount = Math.max(0, Number(current?.missingCount ?? current?.missing_count) || 0);
  if (observed) return { active: 1, missingCount: 0 };
  if (!countMissing || !active) return { active: active ? 1 : 0, missingCount };
  const nextMissingCount = missingCount + 1;
  return { active: 0, missingCount: nextMissingCount };
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
  const requiredFieldRejected = countValue(body?.requiredFieldRejected);
  const contactDeferred = countValue(body?.contactDeferred);
  const census = validationVersion >= 3 ? advertisementCensusAudit(source, body, observed) : null;

  const block = (message) => { issues.push(message); blockingIssues.push(message); };
  if (!requested) block(body?.stopped ? "안전중단" : "부분수집 요청");
  if (requested && validationVersion < 2) block("최신 수집기 검증정보 없음");
  if (requested && census) census.issues.forEach(block);
  if (requested && !census && !/전체|완전수집/.test(`${scope} ${clean(body?.note)}`)) block("전체수집 범위 아님");
  if (requested && !census && observed < 100) block("관찰 원본 100건 미만");
  if (requested && !census && expected <= 0) block("예상 매물 수 없음");
  if (requested && !census && expected > observed) block(`예상 ${expected}건 중 ${observed}건만 확인`);
  if (requested && manifest !== observed) block(`목록 ${manifest}건·원본 ${observed}건 불일치`);
  if (requested && processed < observed) block(`처리 ${processed}건·원본 ${observed}건 불일치`);
  if (requested && failed > 0) {
    issues.push(`실패 ${failed}건`);
    // Naver reports detail/save failures separately from address exclusions.
    // Daangn/Gongsil's legacy failed counter includes address exclusions.
    const operationalFailures = source === "네이버" ? failed : Math.max(0, failed - addressMissing);
    if (operationalFailures > 0) blockingIssues.push(`주소 외 실패 ${operationalFailures}건`);
  }
  if (requested && addressMissing > 0) issues.push(`주소 미확인 ${addressMissing}건`);
  if (requested && requiredFieldRejected > addressMissing) {
    issues.push(`임대조건 등 필수정보 오류 ${requiredFieldRejected - addressMissing}건`);
  }
  if (contactDeferred > 0) issues.push(`연락처 보류 ${contactDeferred}건(매물 저장 완료)`);
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
    requiredFieldRejected,
    contactDeferred,
    collectorVersion: clean(body?.collectorVersion).slice(0, 30)
  };
}

export function gongsilPresenceMarkets(body) {
  const requested = clean(body?.collectionTradeType);
  if (requested && !["lease", "sale"].includes(requested)) return [];
  return requested ? [requested] : ["lease", "sale"];
}

export function validatedGongsilPresenceScope(value) {
  const bounds = value?.bounds;
  if (value?.version !== 1 || value?.selectionKind !== "full-map-result" ||
      !Array.isArray(bounds) || bounds.length !== 4 ||
      bounds.some(n => typeof n !== "number" || !Number.isFinite(n)) ||
      !(bounds[0] < bounds[2] && bounds[1] < bounds[3]) ||
      bounds[0] < -90 || bounds[2] > 90 || bounds[1] < -180 || bounds[3] > 180 ||
      !Number.isInteger(value?.level) || value.level < 1 || value.level > 22 ||
      !/^[a-f0-9]{64}$/.test(clean(value?.filtersHash)) ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(clean(value?.btype))) return null;
  // No IDs, counts or moving cluster centroids enter this stable identity.
  return { version: 1, selectionKind: "full-map-result", bounds,
    level: value.level, btype: value.btype, filtersHash: value.filtersHash };
}


export function shouldReactivateCompletedListing(status, sourceState, observed, sourceIsNew = false) {
  if (clean(status) !== "계약완료" || !observed) return false;
  if (sourceIsNew) return true;
  const active = Number(sourceState?.active) !== 0;
  const missingCount = Math.max(0, Number(sourceState?.missingCount ?? sourceState?.missing_count) || 0);
  return !active || missingCount >= 3;
}

export function removeCompletedListingMemo(value) {
  return clean(value)
    .replace(/(?:\s*\/\s*)?\[거래완료\s+\d{4}-\d{2}-\d{2}\]/g, "")
    .replace(/\s*\/\s*$/, "")
    .trim();
}

function replayFinalizedSession(row, sessionId) {
  const totals = parseJson(row?.totals_json, {});
  const saved = totals?.finalizationResult;
  const replayTotals = { ...totals };
  delete replayTotals.finalizationResult;
  if (saved && typeof saved === "object" && saved.ok === true) {
    return { ...saved, ...replayTotals, replayed: true, sourceBackend: "D1" };
  }
  return {
    ok: true,
    action: "finalizeCollectionSession",
    sessionId,
    state: clean(row?.state) || "completed",
    complete: clean(row?.state) === "completed",
    completeRequested: Boolean(totals.completeRequested),
    completionValidated: Boolean(totals.completionValidated),
    completionIssues: Array.isArray(totals.completionIssues) ? totals.completionIssues : [],
    observed: Number(totals.observed || 0),
    ...replayTotals,
    replayed: true,
    sourceBackend: "D1"
  };
}

function finalizedSessionIsReplayable(row) {
  const state = clean(row?.state);
  if (!clean(row?.finished_at)) return false;
  if (["completed", "partial"].includes(state)) return true;
  return state === "paused" && Boolean(parseJson(row?.totals_json, {})?.finalizationResult);
}

async function failCollectorSession(env, sessionId, error, type = "collector-error") {
  const id = clean(sessionId);
  if (!id) return;
  const now = nowIso();
  const row = await env.DB.prepare("SELECT error_json FROM collector_sessions WHERE id=?1").bind(id).first();
  const errors = parseJson(row?.error_json, {});
  errors.lastFailure = {
    type: clean(type).slice(0, 80),
    message: (clean(error?.message || error) || "수집 처리 실패").slice(0, 500),
    at: now
  };
  await env.DB.prepare(`UPDATE collector_sessions SET state='failed', error_json=?1,
    finished_at=?2, updated_at=?2 WHERE id=?3 AND state NOT IN ('completed','partial')`)
    .bind(JSON.stringify(errors), now, id).run();
}

async function finalizeSession(env, body) {
  const source = sourceName(body.source);
  const requestedSessionId = clean(body.sessionId);
  if (requestedSessionId) {
    const previous = await env.DB.prepare(`SELECT state, totals_json, finished_at
      FROM collector_sessions WHERE id=?1`).bind(requestedSessionId).first();
    if (finalizedSessionIsReplayable(previous)) return replayFinalizedSession(previous, requestedSessionId);
  }
  const sessionId = await ensureSession(env, body.sessionId, source);
  let row = await env.DB.prepare(`SELECT state, totals_json, finished_at
    FROM collector_sessions WHERE id=?1`).bind(sessionId).first();
  if (finalizedSessionIsReplayable(row)) {
    return replayFinalizedSession(row, sessionId);
  }
  const claimedAt = nowIso();
  const claimed = await env.DB.prepare(`UPDATE collector_sessions SET state='finalizing', updated_at=?1
    WHERE id=?2 AND state NOT IN ('completed','partial','finalizing')`)
    .bind(claimedAt, sessionId).run();
  if (Number(claimed?.meta?.changes || 0) !== 1) {
    row = await env.DB.prepare(`SELECT state, totals_json, finished_at
      FROM collector_sessions WHERE id=?1`).bind(sessionId).first();
    if (finalizedSessionIsReplayable(row)) {
      return replayFinalizedSession(row, sessionId);
    }
    throw Object.assign(new Error("수집 완료 처리가 이미 진행 중입니다."), { statusCode: 409 });
  }
  try {
    return await finalizeSessionWork(env, body);
  } catch (error) {
    await failCollectorSession(env, sessionId, error, "finalize-error").catch(() => null);
    throw error;
  }
}

async function finalizeSessionWork(env, body) {
  const source = sourceName(body.source);
  const tradeType = collectorTradeType(body.tradeType, true);
  if (!tradeType) throw new Error("수집 완료 처리의 거래유형을 확인해 주세요.");
  const sessionId = await ensureSession(env, body.sessionId, source);
  const observed = [...new Set((Array.isArray(body.observedSourceIds) ? body.observedSourceIds : [])
    .map((id) => sourceIdFor(source, id)).filter(Boolean))];
  const providerObserved = ((source === "공실박스" && Number(body.presenceVersion) === 1) ||
      (source === "당근" && Number(body.validationVersion) >= 3)) &&
      Array.isArray(body.providerObservedSourceIds)
    ? [...new Set(body.providerObservedSourceIds.map(id => sourceIdFor(source, id)).filter(Boolean))] : null;
  const providerObservedSet = providerObserved ? new Set(providerObserved) : null;
  // A chosen market can shrink below 100 (or to zero) while the full provider
  // map remains proven. Opposite-market rows count as inspected list entries,
  // never as saved/failed offers of this run or as candidates of that market.
  const audit = collectorCompletionAudit(providerObserved ? {
    ...body, source, expectedCount: body.providerExpectedCount, manifestCount: providerObserved.length,
    processedCount: countValue(body.processedCount) + Math.max(0, providerObserved.length - observed.length)
  } : { ...body, source }, providerObserved ? providerObserved.length : observed.length);
  if (providerObserved && (observed.some(id => !providerObservedSet.has(id)) ||
      countValue(body.manifestCount) !== observed.length || countValue(body.processedCount) < observed.length)) {
    audit.complete = false;
    audit.issues.push("원본 전체목록·거래별 처리목록 불일치");
    audit.blockingIssues.push(audit.issues.at(-1));
  }
  let presenceObserved = observed;
  let gongsilOffers = [];
  if (source === "공실박스") {
    const observedSet = new Set(observed);
    const offers = Array.isArray(body.observedOffers) ? body.observedOffers.filter((entry) =>
      observedSet.has(clean(entry?.sourceId)) && ["sale", "lease"].includes(entry?.tradeType)) : [];
    const covered = new Set(offers.map((entry) => entry.sourceId));
    const markets = Number(body.presenceVersion) === 1 ? gongsilPresenceMarkets(body) : [tradeType];
    if (audit.complete && (covered.size !== observed.length || !markets.length ||
        offers.some((entry) => !markets.includes(entry.tradeType)))) {
      audit.complete = false;
      audit.issues.push("공실박스 거래별 전체목록 미확인 또는 임대·매매 혼합수집");
      audit.blockingIssues.push(audit.issues.at(-1));
    }
    const rows = await resolveGongsilOfferIds(env, offers.length ? offers
      : observed.map((sourceId) => ({ sourceId, tradeType })));
    gongsilOffers = rows;
    presenceObserved = [...new Set(rows.map((entry) => entry.sourceId))];
  } else {
    const rows = await resolveCollectorOfferIds(env, source, observed.map((sourceId) => ({ sourceId, tradeType })));
    presenceObserved = [...new Set(rows.map((entry) => entry.sourceId))];
  }
  const complete = audit.complete;
  const state = body.stopped ? "paused" : complete ? "completed" : "partial";
  let presenceReset = 0;
  let missingMarked = 0;
  let deactivated = 0;
  let reactivated = 0;
  const markets = source === "공실박스" && Number(body.presenceVersion) === 1
    ? gongsilPresenceMarkets(body) : [tradeType];
  const scopeOffers = source === "공실박스" ? gongsilOffers
    : presenceObserved.map(sourceId => ({ sourceId, tradeType }));
  const censusV95 = source === "공실박스" ? await gongsilCensusV95(env,body,markets) : null;
  const scopedPresence = censusV95 && !censusV95.valid
    ? {presenceReset:0,missingMarked:0,deactivated:0,adsReappeared:0,presenceTracking:false,
      presenceScopeEstablished:false,presenceTrackingIssue:censusV95.issue,affectedListingIds:[]}
    : await trackAdvertisementPresence(env, {
      source, body: censusV95 ? censusV95.body : body, sessionId,
      offers: censusV95 ? censusV95.offers : scopeOffers, markets,
      complete: censusV95 ? true : complete,
      providerCount: censusV95 ? censusV95.providerCount : providerObserved ? providerObserved.length : observed.length
    });
  if (source === "공실박스" && !censusV95 && clean(body.censusIssueV95)) {
    scopedPresence.presenceTrackingIssue = clean(body.censusIssueV95).slice(0,300);
  }
  presenceReset = scopedPresence.presenceReset;
  missingMarked = scopedPresence.missingMarked;
  deactivated = scopedPresence.deactivated;
  const representatives = await refreshListingRepresentativesFromActiveSources(env, scopedPresence.affectedListingIds);
  scopedPresence.representativesUpdated = representatives.changedListingIds.length;
  delete scopedPresence.affectedListingIds;
  if (scopedPresence.presenceTrackingIssue) audit.issues.push(scopedPresence.presenceTrackingIssue);
  const row = await env.DB.prepare("SELECT totals_json FROM collector_sessions WHERE id=?1").bind(sessionId).first();
  const totals = parseJson(row?.totals_json, {});
  totals.observed = observed.length;
  totals.tradeType = tradeType;
  totals.presenceReset = presenceReset;
  totals.reactivated = Number(totals.reactivated || 0) + reactivated;
  totals.missingMarked = missingMarked;
  totals.deactivated = deactivated;
  const reappeared = Number(totals.adsReappeared || 0) + scopedPresence.adsReappeared;
  Object.assign(totals, scopedPresence, { adsReappeared: reappeared });
  if (censusV95) Object.assign(totals,{censusValidatedV95:censusV95.valid,censusObservedV95:censusV95.providerCount || 0});
  totals.presenceReported = true;
  totals.presenceScopeKind = clean(censusV95?.valid ? censusV95.body.presenceScope?.selectionKind : body.presenceScope?.selectionKind);
  totals.note = clean(body.note);
  totals.completeRequested = audit.requested;
  totals.completionValidated = audit.complete;
  totals.completionIssues = audit.issues;
  totals.expectedCount = providerObserved ? countValue(body.expectedCount) : audit.expected;
  totals.manifestCount = providerObserved ? countValue(body.manifestCount) : audit.manifest;
  totals.processedCount = providerObserved ? countValue(body.processedCount) : audit.processed;
  if (providerObserved) Object.assign(totals, { providerExpectedCount: audit.expected,
    providerManifestCount: audit.manifest, providerProcessedCount: audit.processed });
  totals.failed = Math.max(Number(totals.failed || 0), audit.failed);
  totals.addressMissing = Math.max(Number(totals.addressMissing || 0), audit.addressMissing);
  totals.requiredFieldRejected = Math.max(
    Number(totals.requiredFieldRejected || 0),
    audit.requiredFieldRejected
  );
  totals.contactDeferred = Math.max(Number(totals.contactDeferred || 0), audit.contactDeferred);
  if (Array.isArray(body.diagnostics)) {
    totals.diagnostics = collectorDiagnostics(body.diagnostics);
    totals.diagnosticsVersion = 1;
  }
  totals.warningCounts = Object.fromEntries(
    Object.entries(body?.warningCounts && typeof body.warningCounts === "object" ? body.warningCounts : {})
      .slice(0, 20)
      .map(([key, value]) => [clean(key).slice(0, 160), countValue(value)])
      .filter(([key, value]) => key && value > 0)
  );
  if (clean(body?.detailAuthWarning)) {
    totals.detailAuthWarning = clean(body.detailAuthWarning).slice(0, 500);
  }
  if (audit.collectorVersion) totals.collectorVersion = audit.collectorVersion;
  const finalizedAt = nowIso();
  const result = { ok: true, action: "finalizeCollectionSession", sessionId, state, complete,
    completeRequested: audit.requested, completionValidated: audit.complete, completionIssues: audit.issues,
    observed: observed.length, presenceReset, reactivated, missingMarked, deactivated, ...totals, sourceBackend: "D1" };
  totals.finalizationResult = {
    ok: true,
    action: result.action,
    sessionId,
    state,
    complete,
    completeRequested: audit.requested,
    completionValidated: audit.complete,
    completionIssues: audit.issues,
    observed: observed.length,
    presenceReset,
    reactivated,
    missingMarked,
    deactivated
  };
  totals.finalizedAt = finalizedAt;
  await env.DB.prepare(`UPDATE collector_sessions SET state=?1, totals_json=${preserveNewSourceAdsCounters("?2")},
    finished_at=?3, updated_at=?3 WHERE id=?4 AND state='finalizing'`)
    .bind(state, JSON.stringify(totals), finalizedAt, sessionId).run();
  return result;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DAANGN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DAANGN_GRAPHQL_URL, {
      method: "POST",
      headers: {
        accept: "application/json", "content-type": "application/json",
        origin: "https://realty.daangn.com", referer: "https://realty.daangn.com/",
        "x-realty-platform": "realty-web"
      },
      signal: controller.signal,
      body: JSON.stringify({ variables: variables || {}, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } })
    });
    if (!response.ok) {
      const error = new Error(`당근 API HTTP 오류: ${response.status}`);
      error.stopCollection = [401, 403].includes(response.status);
      throw error;
    }
    // The deadline also covers a provider that sends headers but stalls its body.
    const payload = await response.json();
    if (payload.errors?.length) {
      const message = payload.errors.map((entry) => [entry?.message || "알 수 없는 오류", entry?.extensions?.code]
        .filter(Boolean).join(" ")).join(" / ");
      const error = new Error(`당근 API 오류: ${message}`);
      error.stopCollection = /UNAUTHENTICATED|UNAUTHORIZED|FORBIDDEN|PersistedQueryNotFound|PERSISTED_QUERY_NOT_(?:FOUND|IN_LIST)|GRAPHQL_VALIDATION_FAILED|Cannot query field|Unknown (?:argument|field|type|operation)|Expected type|Variable [^\n]* got invalid value|Field [^\n]*(?:is not defined|does not exist)/i.test(message);
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`당근 API 응답 시간 초과 (${DAANGN_REQUEST_TIMEOUT_MS / 1000}초)`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseDaangnUrl(value, requestedTradeType = "") {
  const url = new URL(clean(value).replace(/&amp;/g, "&"));
  const clusterId = clean(url.searchParams.get("cluster_id")).replace(/^['"]|['"]$/g, "");
  if (!clusterId) throw new Error("URL에서 cluster_id를 찾지 못했습니다.");
  let propertyFilter = { salesTypes: ["STORE", "OFFICE", "FACTORY"] };
  try {
    const parsed = JSON.parse(url.searchParams.get("af") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    propertyFilter = parsed;
  } catch { throw new Error("당근 거래유형 설정 오류: 수집 대상을 다시 등록해 주세요."); }
  const requested = collectorTradeType(requestedTradeType, false);
  let tradeType = requested || "lease";
  if (Object.prototype.hasOwnProperty.call(propertyFilter, "tradeTypes")) {
    const types = propertyFilter.tradeTypes;
    const type = Array.isArray(types) && types.length === 1 ? clean(types[0]).toUpperCase() : "";
    const detected = type === "BUY" ? "sale" : type === "MONTH" ? "lease" : "";
    if (!detected || (requested && requested !== detected)) {
      throw new Error("당근 거래유형 설정 불일치: 월세 또는 매매 하나로 수집 대상을 다시 등록해 주세요.");
    }
    tradeType = detected;
  }
  propertyFilter.tradeTypes = [tradeType === "sale" ? "BUY" : "MONTH"];
  if (!Array.isArray(propertyFilter.salesTypes) || !propertyFilter.salesTypes.length) {
    propertyFilter.salesTypes = ["STORE", "OFFICE", "FACTORY"];
  }
  const district = ["동구", "중구", "서구", "유성구", "대덕구"].find((name) => decodeURIComponent(url.toString()).includes(name)) || "";
  if (tradeType === "sale") {
    propertyFilter.salesTypes = propertyFilter.salesTypes.filter((type) => !/^APARTMENT$|^APT$/i.test(type));
    if (!propertyFilter.salesTypes.length) throw new Error("당근 아파트 매매는 수집 대상이 아닙니다.");
  }
  return { url: url.toString(), clusterId, propertyFilter, district,
    tradeType };
}

export function validateDaangnJobTrade(job, requestedTradeType = "") {
  const parsed = parseDaangnUrl(job.url, job.tradeType || "lease");
  const requested = collectorTradeType(requestedTradeType, false);
  if (requested && parsed.tradeType !== requested) {
    throw new Error("당근 거래유형 설정 불일치: 새 수집기로 다시 시작해 주세요.");
  }
  // Re-check the persisted checkpoint too; it must not widen the URL filter.
  const checkpointUrl = new URL(job.url);
  checkpointUrl.searchParams.set("af", JSON.stringify(job.propertyFilter || parsed.propertyFilter));
  return parseDaangnUrl(checkpointUrl.toString(), parsed.tradeType);
}

function daangnListEntry(article, requestedTradeType = "") {
  const record = daangnRecord(article, "", requestedTradeType);
  const listSnapshot = stableJson({
    sourceId: record.sourceId,
    address: record.address,
    room: record.room,
    category: record.category,
    tradeType: record.tradeType,
    salePrice: record.salePrice, saleCategory: record.saleCategory,
    saleDetails: record.saleDetails,
    deposit: record.deposit,
    rent: record.rent,
    area: record.area
  });
  return { sourceId: record.sourceId, listSnapshot, tradeType: record.tradeType,
    salePrice: record.salePrice, saleCategory: record.saleCategory,
    deposit: record.deposit, rent: record.rent,
    area: record.area, address: record.address, room: record.room };
}

export function mergeDaangnDetailWithList(article, entry = {}, requestedTradeType = "") {
  const record = daangnRecord(article, entry.listSnapshot || "", requestedTradeType || entry.tradeType);
  const trades = Array.isArray(article?.trades) ? article.trades : [];
  const trade = trades.find((candidate) => (record.tradeType === "sale" ? /BUY/ : /MONTH/)
    .test(clean(candidate?.type || candidate?.__typename).toUpperCase())) ||
    trades.find((candidate) => candidate?.preferred) || trades[0] || {};
  const hasDetailRent = trade.monthlyPay != null || trade.yearlyPay != null;
  return {
    ...record,
    sourceId: record.sourceId || clean(entry.sourceId),
    address: record.address || daangnFallbackAddress(article, entry.address),
    room: record.tradeType === "sale" && record.saleCategory === "land" ? "" : record.room || clean(entry.room),
    deposit: record.deposit == null ? number(entry.deposit) : record.deposit,
    rent: record.tradeType === "sale" ? 0 : !hasDetailRent && number(entry.rent) != null ? number(entry.rent) : record.rent,
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
  const lastError = clean(job.lastError || job.lastFailure?.message).slice(0, 500);
  const payload = {
    url: job.url, clusterId: job.clusterId, propertyFilter: job.propertyFilter,
    automationRunId: job.automationRunId || "",
    district: job.district, tradeType: job.tradeType, sessionId: job.sessionId,
    ids: job.ids || [], entries: job.entries || [],
    providerIds: job.providerIds || [], listPageSignatures: job.listPageSignatures || [],
    detailIds: job.detailIds || [], pendingDetailIds: job.pendingDetailIds || [],
    detailAttempts: job.detailAttempts || {}, terminalFailedIds: job.terminalFailedIds || [],
    cursor: job.cursor || "", hasNextPage: Boolean(job.hasNextPage)
  };
  const progress = { ...job };
  delete progress.ids;
  delete progress.entries;
  delete progress.providerIds;
  delete progress.listPageSignatures;
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
      id, job_type, owner_email, state, priority, payload_json, progress_json, attempts,
      available_at, last_error, created_at, updated_at
    ) VALUES (?1, 'daangn-collector', 'collector', ?2, 20, ?3, ?4, 0, ?6, ?5, ?6, ?6)
    ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload_json=excluded.payload_json,
      progress_json=excluded.progress_json, last_error=excluded.last_error, updated_at=excluded.updated_at`)
    .bind(job._jobId || `${DAANGN_JOB_PREFIX}active`, state, JSON.stringify(payload), JSON.stringify(progress),
      lastError, nowIso()).run();
}

async function failDaangnJob(env, body, error) {
  let job = null;
  try {
    job = await loadDaangnJob(env, daangnJobId(body));
  } catch {}
  if (!job) return;
  const message = (clean(error?.message || error) || "당근 수집 처리 실패").slice(0, 500);
  job.status = "failed";
  job.failureCount = Number(job.failureCount || 0) + 1;
  job.lastError = message;
  job.failedAt = nowIso();
  job.message = `수집 중단 · ${message}`;
  await saveDaangnJob(env, job);
  await failCollectorSession(env, job.sessionId, error, "daangn-job-error");
}

async function setDaangnSessionState(env, job, state) {
  const sessionId = clean(job?.sessionId);
  if (!sessionId) return;
  const now = nowIso();
  if (state === "running") {
    await env.DB.prepare(`UPDATE collector_sessions SET state='running', finished_at='', updated_at=?1
      WHERE id=?2 AND state NOT IN ('completed','partial')`).bind(now, sessionId).run();
    return;
  }
  await env.DB.prepare(`UPDATE collector_sessions SET state=?1, finished_at=?2, updated_at=?2
    WHERE id=?3 AND state NOT IN ('completed','partial')`).bind(state, now, sessionId).run();
}

function publicDaangnJob(job) {
  if (!job) return null;
  const output = { ...job };
  delete output.ids;
  delete output.entries;
  delete output.providerIds;
  delete output.listPageSignatures;
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
  const parsed = parseDaangnUrl(body.url, body.tradeType);
  const automationRunId = /^run-\d{10,16}-[a-z0-9]{1,20}$/.test(clean(body.automationRunId)) ? clean(body.automationRunId) : "";
  if (automationRunId) {
    const previous = await loadDaangnJob(env, daangnJobId(body));
    if (completedDaangnRunReusableV76(previous, automationRunId, parsed)) {
      return {ok: true, job: publicDaangnJob(previous), sourceBackend: "D1", recoveredCompletion: true};
    }
    if (sameDaangnRunScopeV76(previous, automationRunId, parsed) && ["running", "paused"].includes(previous.status)) {
      return {ok: true, job: publicDaangnJob(previous), sourceBackend: "D1", resumedCheckpoint: true};
    }
  }
  const sessionId = await ensureSession(env, `DAANGN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, "당근");
  const job = {
    ...parsed, _jobId: daangnJobId(body), collectorVersion: clean(body.collectorVersion).slice(0, 30), automationRunId,
    sessionId, ids: [], entries: [], providerIds: [], listPageSignatures: [],
    expectedCountKnown: false, providerExpectedCount: null, listTerminalReached: false, listCapturedAt: "",
    detailIds: [], pendingDetailIds: [],
    detailAttempts: {}, terminalFailedIds: [], detailErrors: [], cursor: "", hasNextPage: true,
    phase: "list", status: "running", page: 0, found: 0, total: 0, processed: 0, remaining: 0,
    created: 0, merged: 0, updated: 0, review: 0, detailedDuplicates: 0,
    newSourceAds: 0, newSourceAdsReported: true,
    skippedUnchanged: 0, addressMissing: 0, failed: 0, tradeTypeExcluded: 0, chunkSize: 8,
    detailFetchFailures: 0, detailRetryCount: 0,
    message: "클러스터 목록을 확인하고 있습니다."
  };
  await saveDaangnJob(env, job);
  return { ok: true, job: publicDaangnJob(job), sourceBackend: "D1" };
}

function sameDaangnRunScopeV76(job, automationRunId, parsed) {
  return Boolean(job && automationRunId && job.automationRunId === automationRunId &&
    job.url === parsed.url && job.tradeType === parsed.tradeType &&
    stableJson(job.propertyFilter) === stableJson(parsed.propertyFilter));
}

function completedDaangnRunReusableV76(job, automationRunId, parsed) {
  if (!sameDaangnRunScopeV76(job, automationRunId, parsed) ||
      job.status !== "complete" || job.phase !== "complete" || job.completeCollection !== true ||
      Number(job.failed || 0) > Number(job.addressMissing || 0) ||
      Number(job.processed || 0) + Number(job.skippedUnchanged || 0) !== Number(job.found || 0)) return false;
  const proof = job.completionProof;
  return proof?.version === 1 && proof.terminalReached === true && proof.listComplete === true &&
    proof.scopeVerified === true && Number.isFinite(Date.parse(proof.capturedAt)) &&
    Array.isArray(proof.issueCodes) && proof.issueCodes.length === 0 &&
    Number.isInteger(proof.observedUniqueCount) && proof.observedUniqueCount === Number(job.found) &&
    (proof.observedUniqueCount > 0 || proof.emptyConfirmed === true) &&
    (proof.expectedCountKnown === false || proof.expectedCountKnown === true && proof.providerExpectedCount === proof.observedUniqueCount);
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
      if (error?.stopCollection) throw error;
      lastError = clean(error?.message || error) || "당근 상세조회 오류";
    }
    if (attempt < 2) await sleep(450 * (attempt + 1) * (attempt + 1));
  }
  return { article: null, error: lastError, attempts: 3 };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await mapper(values[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
      if (cursor < values.length) await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

export function observeDaangnListPage(job, connection) {
  if (!connection || !Array.isArray(connection.edges) || !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== "boolean") {
    throw new Error("당근 클러스터 목록·페이지 응답 형식이 변경되었습니다.");
  }
  const hasNext = connection.pageInfo.hasNextPage;
  const nextCursor = clean(connection.pageInfo.endCursor);
  if (hasNext && (!nextCursor || nextCursor === clean(job.cursor))) {
    throw new Error("당근 다음 페이지가 있으나 이어읽기 정보가 없거나 반복되었습니다.");
  }
  if (!connection.edges.length && hasNext) throw new Error("당근 마지막 페이지 확인 전에 빈 목록을 받았습니다.");
  const articles = connection.edges.map(edge => edge?.node?.article);
  if (articles.some(article => !article || !clean(article.originalId))) {
    throw new Error("당근 목록에 원본 광고번호가 없는 항목이 있어 전체목록 판정을 중단했습니다.");
  }
  const pageIds = [...new Set(articles.map(article => clean(article.originalId)))];
  const signature = pageIds.length ? snapshotKey(pageIds.slice().sort()) : "";
  const signatures = Array.isArray(job.listPageSignatures) ? job.listPageSignatures : [];
  if (signature && signatures.includes(signature)) throw new Error("당근 목록 페이지가 반복되어 전체목록 확인을 중단했습니다.");
  const legacy = !Array.isArray(job.providerIds) && Number(job.page || 0) > 0;
  const previous = new Set(Array.isArray(job.providerIds) ? job.providerIds : job.ids || []);
  const fresh = pageIds.filter(id => !previous.has(id));
  if (pageIds.length && !fresh.length) throw new Error("당근 목록 페이지에서 새 원본번호를 확인하지 못했습니다.");
  const rawTotal = connection.totalCount ?? connection.pageInfo.totalCount;
  const total = rawTotal !== null && rawTotal !== undefined && rawTotal !== "" && typeof rawTotal !== "boolean"
    ? Number(rawTotal) : null;
  const totalKnown = Number.isInteger(total) && total >= 0;
  if (rawTotal !== null && rawTotal !== undefined && !totalKnown) throw new Error("당근 원본 전체 건수 형식이 올바르지 않습니다.");
  if (job.expectedCountKnown && totalKnown && Number(job.providerExpectedCount) !== total) {
    throw new Error("당근 목록 조회 중 원본 전체 건수가 변경되었습니다. 같은 범위를 다시 수집해 주세요.");
  }
  const providerTotal = job.expectedCountKnown ? Number(job.providerExpectedCount) : totalKnown ? total : null;
  pageIds.forEach(id => previous.add(id));
  if (providerTotal !== null && (previous.size > providerTotal || !hasNext && previous.size !== providerTotal)) {
    throw new Error("당근 전체목록 원본 예상 건수와 고유 광고번호 수가 일치하지 않습니다.");
  }
  if (legacy) job.listProofIssueCodes = [...new Set([...(job.listProofIssueCodes || []), "legacy-list-checkpoint"])];
  job.providerIds = [...previous];
  job.listPageSignatures = signature ? signatures.concat(signature) : signatures;
  job.expectedCountKnown = providerTotal !== null;
  job.providerExpectedCount = providerTotal;
  job.page = Number(job.page || 0) + 1;
  job.cursor = nextCursor;
  job.hasNextPage = hasNext;
  job.listTerminalReached = !hasNext;
  if (!hasNext) job.listCapturedAt = nowIso();
  const added = new Set(fresh);
  const emitted = new Set();
  return articles.filter(article => {
    const id = clean(article.originalId);
    if (!added.has(id) || emitted.has(id)) return false;
    emitted.add(id);
    return true;
  });
}

export function daangnPresenceProof(job) {
  const known = job.expectedCountKnown === true;
  const providerCount = Array.isArray(job.providerIds) ? job.providerIds.length : 0;
  const terminal = job.listTerminalReached === true && job.hasNextPage === false;
  const scope = {version: 1, selectionKind: "provider-cluster", regionCode: clean(job.clusterId), filters: job.propertyFilter};
  const issues = [...(Array.isArray(job.listProofIssueCodes) ? job.listProofIssueCodes : [])];
  if (!terminal) issues.push("terminal-page-unverified");
  if (!Array.isArray(job.providerIds)) issues.push("provider-ids-unverified");
  if (known && Number(job.providerExpectedCount) !== providerCount) issues.push("provider-total-mismatch");
  if (!Number.isFinite(Date.parse(job.listCapturedAt))) issues.push("capture-time-missing");
  const scopeVerified = Boolean(scope.regionCode && scope.filters && typeof scope.filters === "object");
  if (!scopeVerified) issues.push("scope-unverified");
  return {presenceScope: scope, completionProof: {
    version: 1, expectedCountKnown: known, providerExpectedCount: known ? Number(job.providerExpectedCount) : null,
    observedUniqueCount: providerCount, terminalReached: terminal, listComplete: !issues.length,
    scopeVerified, emptyConfirmed: terminal && Array.isArray(job.providerIds) && providerCount === 0 && !issues.length,
    pagesFetched: Number(job.page || 0), capturedAt: job.listCapturedAt || null, issueCodes: [...new Set(issues)],
    listExhausted: terminal, expected: Number(job.found || 0), observed: (job.ids || []).length,
    processed: Number(job.skippedUnchanged || 0) + Number(job.processed || 0)
  }};
}

async function finalizeDaangnJob(env, job) {
  const proof = daangnPresenceProof(job);
  const result = await finalizeSession(env, {
    source: "당근", sessionId: job.sessionId,
    tradeType: job.tradeType,
    scope: job.district ? `당근 ${job.district} 선택클러스터 전체목록` : "당근 선택클러스터 전체목록",
    complete: proof.completionProof.listComplete, observedSourceIds: job.ids || [],
    providerObservedSourceIds: job.providerIds || [],
    providerExpectedCount: job.providerExpectedCount,
    presenceScope: proof.presenceScope, completionProof: proof.completionProof,
    validationVersion: 3, collectorVersion: job.collectorVersion,
    expectedCount: Number(job.found || 0), manifestCount: (job.ids || []).length,
    processedCount: Number(job.skippedUnchanged || 0) + Number(job.processed || 0),
    failed: Number(job.failed || 0), addressMissing: Number(job.addressMissing || 0),
    truncated: Boolean(job.hasNextPage),
    note: "선택클러스터 전체목록 확인"
  });
  job.completeCollection = Boolean(result.complete);
  job.completionIssues = Array.isArray(result.completionIssues) ? result.completionIssues : [];
  Object.assign(job, normalizeNewSourceAdCounts(result));
  for (const key of ["missingMarked", "deactivated", "adsReappeared"]) job[key] = countValue(result[key]);
  job.presenceTracking = result.presenceTracking === true;
  job.presenceScopeEstablished = result.presenceScopeEstablished === true;
  job.presenceTrackingIssue = clean(result.presenceTrackingIssue).slice(0, 500);
  job.presenceReported = Object.prototype.hasOwnProperty.call(result, "presenceTracking");
  job.completionProof = proof.completionProof;
  job.presenceScope = proof.presenceScope;
  job.phase = "complete";
  job.status = "complete";
  job.message = result.complete
    ? `전체 ${job.found}개 확인 · 완전수집 검증 완료`
    : `전체 ${job.found}개 확인 · 부분수집 보존${job.completionIssues.length ? ` · ${job.completionIssues.join(", ")}` : ""}`;
  // Keep legacy failed/addressMissing counters and completion issues for installed
  // collectors. A complete census is not a promise that every ad was map-registered.
  if (result.complete && Number(job.addressMissing || 0) > 0) {
    job.message = `전체 ${job.found}개 목록 확인 완료 · 지번·도로명주소 미확인 ${job.addressMissing}건 지도 등록 보류`;
  }
  const presenceNotice = job.presenceTrackingIssue ? "종료판정보류" : job.presenceScopeEstablished
    ? "비교기준저장" : job.presenceTracking ? `원본광고 미노출 ${job.deactivated}건` : "";
  if (presenceNotice) job.message += ` · ${presenceNotice}`;
  if (job.adsReappeared) job.message += ` · 원본광고 재등장 ${job.adsReappeared}건`;
  return result;
}

async function runDaangnChunk(env, body = {}) {
  const job = await loadDaangnJob(env, daangnJobId(body));
  if (!job) throw new Error("이어갈 당근 수집 작업이 없습니다.");
  if (job.status !== "running") return { ok: true, job: publicDaangnJob(job) };
  const validated = validateDaangnJobTrade(job, body.tradeType);
  job.tradeType = validated.tradeType;
  job.propertyFilter = validated.propertyFilter;
  const chunkStarted = Date.now();
  if (job.phase === "list") {
    const seen = new Set(job.ids || []);
    for (let step = 0; step < 4 && job.hasNextPage; step += 1) {
      const payload = await daangnGraphql(job.page === 0 ? DAANGN_LIST_FIRST_HASH : DAANGN_LIST_NEXT_HASH, {
        first: 100, after: job.cursor || null,
        input: { clusterId: job.clusterId, propertyFilter: job.propertyFilter }
      });
      const connection = payload?.data?.articleByClusterId;
      const pageArticles = observeDaangnListPage(job, connection);
      for (const article of pageArticles) {
        const id = clean(article?.originalId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const entry = daangnListEntry(article, job.tradeType);
        if (!isMonthlyCollectorRecord("당근", entry)) {
          job.tradeTypeExcluded = Number(job.tradeTypeExcluded || 0) + 1;
          continue;
        }
        job.ids.push(id);
        job.entries.push(entry);
      }
    }
    job.found = job.ids.length;
    job.remaining = job.ids.length;
    if (!job.hasNextPage) {
      const proof = daangnPresenceProof(job);
      const classification = await classifyManifest(env, {
        source: "당근", sessionId: job.sessionId, scope: job.district ? `대전 ${job.district} 완전수집` : "당근 선택클러스터",
        collectorVersion: job.collectorVersion,
        validationVersion: 3,
        presenceScope: proof.presenceScope, completionProof: proof.completionProof,
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
          ...mergeDaangnDetailWithList(response.article, entry, job.tradeType),
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
      ? await ingestRecords(env, "당근", records, { sessionId: job.sessionId, validationVersion: 3,
        ...daangnPresenceProof(job) })
      : { created: 0, merged: 0, updated: 0, review: 0, duplicate: 0, failed: 0, errors: [],
        newSourceAds: 0, newSourceAdsReported: true };
    job.lastWriteMs = Date.now() - writeStarted;
    job.created += Number(result.created || 0);
    job.merged += Number(result.merged || 0);
    job.updated += Number(result.updated || 0);
    const previousNewAds = normalizeNewSourceAdCounts(job);
    const chunkNewAds = normalizeNewSourceAdCounts(result);
    job.newSourceAdsReported = previousNewAds.newSourceAdsReported && chunkNewAds.newSourceAdsReported;
    job.newSourceAds = job.newSourceAdsReported ? previousNewAds.newSourceAds + chunkNewAds.newSourceAds : null;
    job.review += Number(result.review || 0);
    job.detailedDuplicates += Number(result.duplicate || 0);
    job.failed += Number(result.failed || 0);
    job.tradeTypeExcluded = Number(job.tradeTypeExcluded || 0) + Number(result.tradeTypeExcluded || 0);
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
  if((action==="saveNaverBatch"||action==="classifySourceManifest"&&sourceName(body.source)==="네이버")&&clean(body.sessionId)){
    const closed=await env.DB.prepare("SELECT state,source FROM collector_sessions WHERE id=?1").bind(clean(body.sessionId)).first();
    if(closed?.state==="abandoned"&&closed.source==="네이버")throw Object.assign(new Error(naverRescanResult().message),{code:NAVER_RESCAN_CODE,requiresFreshManifest:true,statusCode:409});
  }
  if (action === "saveAutomationRunReport") return saveAutomationRunReport(env, body.report);
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
  if (action === "danggeunRunJobChunk") {
    try {
      return await runDaangnChunk(env, body);
    } catch (error) {
      await failDaangnJob(env, body, error).catch(() => null);
      throw error;
    }
  }
  if (action === "danggeunJobStatus") return { ok: true,
    job: publicDaangnJob(await loadDaangnJob(env, daangnJobId(body))), sourceBackend: "D1" };
  if (action === "danggeunPauseJob" || action === "danggeunResumeJob") {
    const job = await loadDaangnJob(env, daangnJobId(body));
    if (!job) return { ok: true, job: null };
    if (action === "danggeunResumeJob") {
      validateDaangnJobTrade(job, body.tradeType);
      if (/^run-\d{10,16}-[a-z0-9]{1,20}$/.test(clean(body.automationRunId)) && job.status !== "complete") {
        job.automationRunId = clean(body.automationRunId);
      }
    }
    if (action === "danggeunResumeJob" && clean(job.lastError)) {
      job.lastFailure = { message: clean(job.lastError), at: clean(job.failedAt) };
      delete job.lastError;
      delete job.failedAt;
    }
    job.status = action === "danggeunPauseJob" ? "paused" : "running";
    job.message = action === "danggeunPauseJob" ? "안전중단됨 · 저장 지점 보존" : "저장 지점부터 이어서 수집합니다.";
    await saveDaangnJob(env, job);
    await setDaangnSessionState(env, job, job.status);
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
    const targetAction = clean(query.targetAction || query.mutationAction);
    if (targetAction && (!EXTERNAL_ACTIONS.has(targetAction) || targetAction === "mutationStatus")) {
      return jsonpResponse(query.callback, { ok: false, ready: true,
        result: { ok: false, message: "잘못된 상태 조회 범위입니다." } }, cors);
    }
    const status = await mutationStatus(env, query.requestId, "collector", targetAction);
    if (!targetAction) status.legacyActionScope = true;
    return jsonpResponse(query.callback, status, cors);
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST, OPTIONS", ...cors } });
  const parsed = await readCollectorBody(request, env, cors);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (!body || typeof body !== "object" || !EXTERNAL_ACTIONS.has(clean(body.action))) {
    return jsonResponse({ ok: false, message: "잘못된 수집 요청입니다." }, 400, cors);
  }
  if (!validCollectorKey(env, body.collectorKey || body.accessKey)) {
    return jsonResponse({ ok: false, message: "승인되지 않은 요청입니다." }, 403, cors);
  }
  const action = clean(body.action);
  if (action === "mutationStatus") {
    const targetAction = clean(body.targetAction || body.mutationAction);
    if (!targetAction || !EXTERNAL_ACTIONS.has(targetAction) || targetAction === "mutationStatus") {
      return jsonResponse({ ok: false, message: "상태 조회에는 targetAction이 필요합니다." }, 400, cors);
    }
    let status = await mutationStatus(env, body.requestId, "collector", targetAction);
    if (targetAction === "saveNaverBatch" && status.requestState === "missing") {
      await fenceUnacceptedNaverBatch(env, body.requestId);
      status = await mutationStatus(env, body.requestId, "collector", targetAction);
    }
    return jsonResponse(status, 200, cors);
  }
  if (clean(body.requestId)) {
    const scope = await mutationScope(env, body.requestId);
    if (scope && (clean(scope.owner_email) !== "collector" || clean(scope.action) !== action)) {
      return jsonResponse({ ok: false, message: "요청번호가 다른 작업 범위에서 이미 사용되었습니다." }, 409, cors);
    }
  }
  const existing = clean(body.requestId)
    ? await mutationStatus(env, body.requestId, "collector", action)
    : null;
  if (action === "gongsilImportBatch" && existing?.result?.code === "gongsil_closed_session_rescan") {
    return jsonResponse(existing.result,409,cors);
  }
  if (action === "gongsilImportBatch" && body.requestPolicyVersion === 63) {
    const id = clean(body.requestId), sessionId = clean(body.sessionId);
    if (!sessionId || id.length > 160 || !/^gongsil-[A-Za-z0-9_-]+-batch-\d+$/.test(id) ||
        !id.startsWith("gongsil-" + sessionId + "-batch-")) {
      return jsonResponse({ok:false,message:"공실박스 저장 요청번호와 수집 회차를 확인해 주세요."},400,cors);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(body, (key,value) =>
      key === "collectorKey" || key === "requestHashV63" ? undefined : value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,"0")).join("");
    if (hash !== body.requestHashV63 || existing && (existing.ready || existing.requestState === "running") && existing.result?.requestHashV63 !== hash) {
      return jsonResponse({ok:false,message:"같은 요청번호의 매물 내용이 다릅니다. 기존 저장 결과를 덮어쓰지 않았습니다."},409,cors);
    }
  }
  if (existing?.ready) {
    const response = jsonResponse(existing.result, 200, cors);
    response.headers.set("x-js-collector-action", action);
    return response;
  }
  if (action === "saveNaverBatch" && clean(body.requestId) &&
      !await claimNaverBatchRequest(env, body.requestId, body.sessionId)) {
    // Another request may have claimed or completed the ID after the reads
    // above. Recheck its scope/result without executing or replacing it.
    const scope = await mutationScope(env, body.requestId);
    if (scope && (clean(scope.owner_email) !== "collector" || clean(scope.action) !== action)) {
      return jsonResponse({ ok: false, message: "요청번호가 다른 작업 범위에서 이미 사용되었습니다." }, 409, cors);
    }
    const completed = await mutationStatus(env, body.requestId, "collector", action);
    if (completed.ready) {
      const response = jsonResponse(completed.result, 200, cors);
      response.headers.set("x-js-collector-action", action);
      return response;
    }
    return jsonResponse({ ok: false, requestPending: true,
      message: "같은 저장 요청이 처리 중입니다. 결과를 확인한 뒤 이어갑니다." }, 409, cors);
  }
  // New clients persist uncertain requests and can reconnect to the same ID.
  // Old clients in a live collection keep their existing execution contract.
  if (action === "gongsilImportBatch" && body.requestPolicyVersion === 63 && clean(body.requestId) &&
      !await claimGongsilBatchRequestV63(env, body)) {
    const completed = await mutationStatus(env, body.requestId, "collector", action);
    if (completed.result?.requestHashV63 && completed.result.requestHashV63 !== body.requestHashV63) {
      return jsonResponse({ok:false,message:"같은 요청번호의 매물 내용이 다릅니다."},409,cors);
    }
    if (completed.ready) return jsonResponse(completed.result, 200, cors);
    return jsonResponse({ok:false, requestPending:true, message:"같은 공실박스 저장 결과를 확인 중입니다. 중복 저장하지 않습니다."},409,cors);
  }
  try {
    const result = await executeExternalAction(env, body);
    if (!result) return jsonResponse({ ok: false, message: "지원하지 않는 수집 작업입니다." }, 404, cors);
    if (body.requestId && !result[NAVER_DURABLE_RESULT_V56]) await saveMutationResult(env, body.requestId, action, result);
    const response = jsonResponse(result, 200, cors);
    response.headers.set("x-js-collector-action", action);
    return response;
  } catch (error) {
    const result = { ok: false, message: clean(error?.message) || "수집 처리에 실패했습니다." };
    if (action === "gongsilImportBatch" && body.requestPolicyVersion === 63) result.requestHashV63 = body.requestHashV63;
    if(error?.code===NAVER_RESCAN_CODE)Object.assign(result,{code:NAVER_RESCAN_CODE,requiresFreshManifest:true});
    if (body.requestId) await saveMutationResult(env, body.requestId, action, result);
    const status = Math.max(400, Math.min(599, Number(error?.statusCode) || 400));
    return jsonResponse(result, status, cors);
  }
}

function candidateJson(row) {
  return {
    propertyId: clean(row.property_id || row.id), buildingName: clean(row.title), address: clean(row.address),
    room: clean(row.room), category: clean(row.listing_type), deposit: row.deposit, rent: row.monthly_rent,
    fee: row.maintenance_fee, premium: row.premium, area: row.area_m2, memo: clean(row.operating_memo),
    source: clean(row.main_source), tradeType: collectorTradeType(row.trade_type, true),
    saleCategory: clean(row.sale_category), salePrice: row.sale_price
  };
}

export function relevantReviewCandidates(group, candidates = []) {
  const reviewItems = Array.isArray(group?.items) ? group.items : [];
  const reviewFloors = [...new Set(reviewItems
    .map((item) => parseListingFloor(item?.room, true))
    .filter((floor) => floor != null && Number.isFinite(Number(floor)))
    .map(Number))];
  const floorCandidates = reviewFloors.length ? candidates.filter((candidate) => {
    const candidateFloor = parseListingFloor(candidate?.room, true);
    return candidateFloor == null || reviewFloors.includes(Number(candidateFloor));
  }) : candidates;
  if (!reviewItems.length) return floorCandidates;
  return floorCandidates.filter((candidate) => reviewItems.some((item) =>
    compareListingSpace(item, {
      ...candidate,
      id: candidate.propertyId || candidate.id,
      monthly_rent: candidate.rent ?? candidate.monthly_rent,
      area_m2: candidate.area ?? candidate.area_m2,
      trade_type: candidate.tradeType || candidate.trade_type,
      sale_category: candidate.saleCategory || candidate.sale_category,
      sale_price: candidate.salePrice ?? candidate.sale_price
    }).decision !== "different"));
}

async function reviewWorkspace(env, query) {
  const search = clean(query.query).slice(0, 100);
  const pattern = `%${search}%`;
  const result = await env.DB.prepare(`SELECT id, source, source_listing_id, trade_type, sale_category, sale_price,
      payload_json, result_json, created_at
    FROM collector_raw WHERE processing_state='review' AND (?1='' OR payload_json LIKE ?2)
    ORDER BY created_at DESC LIMIT 600`).bind(search, pattern).all();
  const groups = new Map();
  for (const row of result?.results || []) {
    const item = parseJson(row.payload_json, {});
    const tradeType = collectorTradeType(row.trade_type || item.tradeType, true);
    const saleCategory = tradeType === LISTING_TRADE_TYPES.SALE
      ? collectorSaleCategory(row.sale_category || item.saleCategory, item.category)
      : "";
    const key = `${tradeType}|${saleCategory}|${normalizedAddress(item.address)}|${normalizedRoom(item.room)}`;
    if (!groups.has(key)) groups.set(key, { groupKey: key, address: item.address, room: item.room,
      tradeType, saleCategory, risk: "중간", score: 60, recommendation: "직접 확인", items: [], candidates: [] });
    const group = groups.get(key);
    const stored = parseJson(row.result_json, {});
    group.items.push({
      reviewId: row.id, source: row.source, sourceId: row.source_listing_id,
      buildingName: item.buildingName, address: item.address, room: item.room, type: "신규·변경",
      category: item.category, deposit: item.deposit, rent: item.rent, fee: item.fee,
      premium: item.premium, area: item.area, memo: item.memo, tradeType,
      saleCategory, salePrice: row.sale_price ?? item.salePrice,
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
        deposit, monthly_rent, maintenance_fee, premium, area_m2, operating_memo, main_source,
        trade_type, sale_category, sale_price, updated_at
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
    group.candidates = relevantReviewCandidates(group,
      (candidatesByAddress.get(normalizedAddress(group.address)) || []).filter((candidate) =>
        listingTradeTypesCanMerge(candidate.tradeType, group.tradeType)));
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

function collectorSessionStatusLabel(state) {
  if (state === "completed") return "완전수집 완료";
  if (state === "partial") return "수집 종료 · 부분결과 확인";
  if (state === "paused") return "안전중단";
  if (state === "failed") return "수집 실패 · 재시작 가능";
  if (state === "abandoned") return "응답 없음 · 자동 종료";
  if (state === "finalizing") return "완료 처리 중";
  return state ? "수집 중" : "수집 전";
}

async function collectionStatus(env, query = {}) {
  const range = collectionDateRange(query.date);
  const sessions = await env.DB.prepare(`SELECT id, source, state, totals_json, error_json,
      started_at, finished_at, updated_at
    FROM collector_sessions WHERE started_at>=?1 AND started_at<?2
    ORDER BY started_at DESC, updated_at DESC LIMIT 1000`).bind(range.baselineStart, range.end).all();
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
    const totals = normalizeCollectionCounts(parseJson(row?.totals_json, {}));
    const failure = parseJson(row?.error_json, {})?.lastFailure || {};
    const count = sourceCounts.get(name) || {};
    return {
      source: name, total: Number(count.total || 0), active: Number(count.active || 0), inactive: Number(count.inactive || 0),
      lastStatus: collectorSessionStatusLabel(row?.state),
      lastAt: row?.finished_at || row?.updated_at || "", lastScope: clean(totals.note) || clean(totals.scope),
      failure: clean(failure.message).slice(0, 500), failureAt: clean(failure.at),
      guidance: collectorActionGuidance(failure.message || totals.completionIssues?.join(" · ")),
      complete: row?.state === "completed" && totals.completionValidated !== false,
      collectorVersion: clean(totals.collectorVersion),
      completionIssues: [...(Array.isArray(totals.completionIssues) ? totals.completionIssues : []),
        ...(clean(failure.message) ? [clean(failure.message).slice(0, 500)] : [])],
      lastResult: totals
    };
  });
  const recent = sessionRows.map((row) => {
    const totals = normalizeCollectionCounts(parseJson(row.totals_json, {}));
    const failure = parseJson(row.error_json, {})?.lastFailure || {};
    return {
      sessionId: row.id, source: sourceName(row.source), state: row.state,
      status: collectorSessionStatusLabel(row.state), scope: clean(totals.note) || clean(totals.scope),
      complete: row.state === "completed" && totals.completionValidated !== false,
      startedAt: row.started_at, endedAt: row.finished_at || row.updated_at,
      failure: clean(failure.message).slice(0, 500), failureAt: clean(failure.at), ...totals
    };
  });
  return {
    ok: true, action: "collectionStatus",
    sessions: sessionRows.map((row) => ({
      sessionId: row.id, source: row.source, state: row.state, ...parseJson(row.totals_json, {}),
      failure: clean(parseJson(row.error_json, {})?.lastFailure?.message).slice(0, 500),
      startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at
    })),
    sources: sourceCards, recent: recent.filter(row => row.startedAt >= range.start && row.startedAt < range.end),
    daySummary: summarizeCollectionDay(recent, range.date, {source: clean(query.source), tradeType: clean(query.tradeType)}),
    historyTruncated: sessionRows.length === 1000,
    automation: await readAutomationRunReports(env),
    raw: { total: Number(raw?.total || 0), pending: Number(raw?.pending || 0), error: Number(raw?.error || 0) },
    pendingReview: Number(raw?.review || 0), sourceCounts: counts?.results || [], source: "D1"
  };
}

async function propertyTimeline(env, propertyId) {
  const result = await env.DB.prepare(`SELECT h.action, h.actor_email, h.before_json, h.after_json, h.created_at,
      s.source FROM listing_history h LEFT JOIN listing_sources s ON s.id=h.source_id
    WHERE h.listing_id=?1 ORDER BY h.id DESC LIMIT 200`).bind(clean(propertyId)).all();
  return { ok: true, action: "propertyTimeline", propertyId: clean(propertyId),
    items: (result?.results || []).map((row) => {
      const before = parseJson(row.before_json, {});
      const after = parseJson(row.after_json, {});
      const fields = ["deposit", "monthly_rent", "rent", "maintenance_fee", "fee", "premium", "area_m2", "area", "room", "trade_type", "sale_price", "status"];
      return { action: row.action, reason: after.reason || "", at: row.created_at, source: row.source || row.actor_email || "D1",
        changes: fields.filter(key => Object.hasOwn(before, key) && Object.hasOwn(after, key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
          .map(key => ({field: key, before: before[key], after: after[key]})) };
    }), source: "D1" };
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
  if (action === "collectionStatus") return collectionStatus(env, query);
  if (action === "propertyTimeline") return propertyTimeline(env, query.propertyId);
  return null;
}

// Manual/legacy review entry points can publish without passing through ingest.
// Batch their evidence too: resolving a queued advertisement is not discovering
// a new one, and must not replace its original observed day with today's date.
async function preserveReviewFirstObservations(env, records) {
  const bySource = new Map();
  for (const record of records) {
    if (!record) continue;
    const tradeType = collectorTradeType(record.tradeType || record.trade_type, true);
    if (!advertisementObservationKey(record.source, record.sourceId, tradeType)) continue;
    if (!bySource.has(record.source)) bySource.set(record.source, []);
    bySource.get(record.source).push({ record, lookup: { ...record, tradeType } });
  }
  const now = nowIso();
  for (const [source, sourceRecords] of bySource) {
    const index = await loadFirstObservedAdvertisements(env, source, sourceRecords.map(item => item.lookup), new Map(), now);
    for (const { record, lookup } of sourceRecords) Object.defineProperty(record, "firstObservedAdvertisementV1", {
      value: index.get(advertisementObservationKey(source, lookup.sourceId, lookup.tradeType)), configurable: true
    });
  }
}

function pendingAliasRecord(alias, fallbackRecord) {
  const record = normalizeReviewRecord(parseJson(alias.payload_json, {}));
  if (!record.sourceId) record.sourceId = clean(alias.source_listing_id);
  if (!record.source) record.source = clean(alias.source);
  if (!record.address) record.address = clean(fallbackRecord?.address);
  return record;
}

async function attachPendingReviewAliases(env, reviewId, listingId, fallbackRecord, actor,
  resultAction = "manualMergeAlias", decisionVersion = null) {
  const aliasResult = await env.DB.prepare(`SELECT id, session_id, source, source_listing_id, payload_json
    FROM collector_raw
    WHERE processing_state='duplicate'
      AND json_extract(result_json, '$.action')='sameAsPendingReview'
      AND json_extract(result_json, '$.canonicalReviewId')=?1
    ORDER BY created_at, id`).bind(reviewId).all();
  let merged = 0;
  let failed = 0;
  const aliases = (aliasResult?.results || []).map(alias => ({ alias, record: pendingAliasRecord(alias, fallbackRecord) }));
  await preserveReviewFirstObservations(env, aliases.map(item => item.record));
  for (const { alias, record: aliasRecord } of aliases) {
    try {
      const aliasSourceMap = await loadExistingSources(env, aliasRecord.source, [aliasRecord]);
      const aliasSource = aliasSourceMap.get(aliasRecord.sourceId) || null;
      const aliasAssetsMap = aliasSource ? await loadSourceAssets(env, aliasSourceMap) : new Map();
      await attachSource(env, aliasRecord, listingId, alias.session_id, aliasSource, false, actor,
        aliasSource ? aliasAssetsMap.get(clean(aliasSource.id)) : null, true);
      const aliasResultJson = { action: resultAction, listingId, canonicalReviewId: reviewId,
        preserveRepresentative: true };
      if (decisionVersion != null) aliasResultJson.autoDecisionVersion = decisionVersion;
      await env.DB.prepare(`UPDATE collector_raw SET processing_state='processed', processed_at=?1,
          result_json=?2, error_text='' WHERE id=?3`)
        .bind(nowIso(), JSON.stringify(aliasResultJson), alias.id).run();
      merged += 1;
    } catch (error) {
      failed += 1;
      await env.DB.prepare("UPDATE collector_raw SET error_text=?1 WHERE id=?2")
        .bind(clean(error?.message || error).slice(0, 500), alias.id).run();
    }
  }
  return { merged, failed };
}

async function applyReviewBatch(env, user, body) {
  const ids = [...new Set((Array.isArray(body.reviewIds) ? body.reviewIds : []).map(clean).filter(Boolean))].slice(0, 100);
  const action = clean(body.reviewAction);
  const masterId = clean(body.masterId);
  let processed = 0;
  let failed = 0;
  let aliasesMerged = 0;
  let aliasesFailed = 0;
  const processedReviewIds = [];
  const affectedListingIds = new Set();
  const started = Date.now();
  const reviewRows = ids.length ? await env.DB.prepare(`SELECT id, session_id, payload_json FROM collector_raw
    WHERE id IN (${ids.map((_, i) => "?" + (i + 1)).join(",")}) AND processing_state='review'`).bind(...ids).all() : { results: [] };
  const rowsById = new Map((reviewRows?.results || []).map(row => [row.id, row]));
  const recordsById = new Map((reviewRows?.results || []).map(row => [row.id, parseJson(row.payload_json, null)]));
  if (action !== "hold") await preserveReviewFirstObservations(env, [...recordsById.values()]);
  for (const id of ids) {
    try {
      const row = rowsById.get(id);
      if (!row) continue;
      const record = recordsById.get(id);
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
        affectedListingIds.add(listing.id);
        const aliases = await attachPendingReviewAliases(env, row.id, listing.id, record, clean(user?.email));
        aliasesMerged += aliases.merged;
        aliasesFailed += aliases.failed;
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2, error_text='' WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action, listingId: listing.id,
            aliasesMerged: aliases.merged, manual: Boolean(body.manualMergeConfirmed) }), id).run();
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
  return { ok: true, action: "applyReviewBatch", processed, failed, aliasesMerged, aliasesFailed, processedReviewIds,
    affectedListingIds: [...affectedListingIds],
    remaining: Number(remaining?.count || 0), actionWritesVerified: processed,
    reviewRowsRemovedVerified: processed, elapsedMs: Date.now() - started,
    operationAdjustments: { pendingReview: -processed },
    operationRefresh: Number(remaining?.count || 0) === 0, source: "D1" };
}

async function consolidateExisting(env, user, body) {
  const primaryId = clean(body.primaryMasterId);
  const duplicates = [...new Set((Array.isArray(body.duplicateMasterIds) ? body.duplicateMasterIds : []).map(clean).filter((id) => id && id !== primaryId))].slice(0, 50);
  const primary = await env.DB.prepare("SELECT id, operating_memo, trade_type FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1")
    .bind(primaryId).first();
  if (!primary) throw new Error("대표매물을 찾지 못했습니다.");
  let primaryMemo = clean(primary.operating_memo);
  let consolidated = 0;
  for (const duplicateId of duplicates) {
    const duplicate = await env.DB.prepare("SELECT id, operating_memo, trade_type FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1")
      .bind(duplicateId).first();
    if (!duplicate || duplicate.id === primary.id) continue;
    if (!listingTradeTypesCanMerge(primary.trade_type, duplicate.trade_type)) {
      throw new Error("상가임대 대표매물과 매매 대표매물은 서로 합칠 수 없습니다.");
    }
    const mergedMemo = carryConfirmedVisitMemo(primaryMemo, duplicate.operating_memo);
    const confirmationTransferred = mergedMemo !== primaryMemo;
    const statements = [
      env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,
        list_snapshot_json=json_set(list_snapshot_json, '$.propertyId', ?1), updated_at=?2
        WHERE listing_id=?3`).bind(primary.id, nowIso(), duplicate.id),
      env.DB.prepare("UPDATE listing_media SET listing_id=?1, updated_at=?2 WHERE listing_id=?3").bind(primary.id, nowIso(), duplicate.id),
      env.DB.prepare("UPDATE listing_contacts SET listing_id=?1, updated_at=?2 WHERE listing_id=?3").bind(primary.id, nowIso(), duplicate.id),
      env.DB.prepare("UPDATE listings SET status='deleted', updated_at=?1 WHERE id=?2").bind(nowIso(), duplicate.id),
      env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
        VALUES (?1, 'consolidateExistingMasters', ?2, ?3, ?4)`)
        .bind(primary.id, clean(user?.email),
          JSON.stringify({ duplicateId: duplicate.id, primaryMemo, duplicateMemo: clean(duplicate.operating_memo) }),
          JSON.stringify({ primaryId: primary.id, operatingMemo: mergedMemo, confirmationTransferred }))
    ];
    if (confirmationTransferred) {
      statements.unshift(env.DB.prepare(`UPDATE listings SET operating_memo=?1,
        version=version+1, updated_at=?2 WHERE id=?3`).bind(mergedMemo, nowIso(), primary.id));
    }
    await env.DB.batch(statements);
    primaryMemo = mergedMemo;
    consolidated += 1;
  }
  return { ok: true, action: "consolidateExistingMasters", consolidated, primaryMasterId: primary.id,
    operationAdjustments: { activeMaster: -consolidated, history: consolidated }, source: "D1" };
}

async function consolidateClassifiedCandidateDuplicates(env, user, classified) {
  const primaryMasterId = clean(classified?.candidate?.id || classified?.candidate?.property_id);
  const duplicateMasterIds = [...new Set((classified?.duplicateCandidateIds || [])
    .map(clean).filter((id) => id && id !== primaryMasterId))];
  if (!primaryMasterId || !duplicateMasterIds.length) return 0;
  const result = await consolidateExisting(env, user, {
    primaryMasterId,
    duplicateMasterIds
  });
  return Number(result?.consolidated || 0);
}

async function mergeSingleCandidateReviews(env, user, options = {}) {
  const requestedLimit = Math.floor(Number(options.limit) || 20);
  const limit = Math.max(1, Math.min(requestedLimit, 20));
  const shardCount = Math.max(1, Math.min(Math.floor(Number(options.shardCount) || 1), 16));
  const requestedShard = Math.floor(Number(options.shard));
  const shard = Number.isFinite(requestedShard) && requestedShard >= 0 && requestedShard < shardCount
    ? requestedShard : -1;
  const shardClause = shard >= 0
    ? ` AND ((instr('0123456789abcdef', lower(substr(cr.id, -1))) - 1) % ?2)=?3`
    : "";
  const remainingShardClause = shard >= 0
    ? ` AND ((instr('0123456789abcdef', lower(substr(cr.id, -1))) - 1) % ?1)=?2`
    : "";
  const rowsStatement = env.DB.prepare(`SELECT cr.id, cr.session_id, cr.source, cr.source_listing_id,
      cr.payload_json, json_extract(cr.result_json, '$.candidateIds[0]') AS candidate_id
    FROM collector_raw cr
    JOIN listings l ON l.id=json_extract(cr.result_json, '$.candidateIds[0]')
    WHERE cr.processing_state='review'
      AND json_array_length(json_extract(cr.result_json, '$.candidateIds'))=1
      AND l.status <> 'deleted'
      AND l.address=json_extract(cr.payload_json, '$.address')
      AND NOT EXISTS (SELECT 1 FROM listings other
        WHERE other.status <> 'deleted' AND other.address=l.address AND other.id<>l.id)
      ${shardClause}
    ORDER BY cr.created_at, cr.id LIMIT ?1`);
  const rows = await (shard >= 0
    ? rowsStatement.bind(limit, shardCount, shard).all()
    : rowsStatement.bind(limit).all());
  const reviewRows = rows?.results || [];
  const reviewRecords = new Map(reviewRows.map(row => [row.id, normalizeReviewRecord(parseJson(row.payload_json, {}))]));
  await preserveReviewFirstObservations(env, [...reviewRecords.values()]);
  let merged = 0;
  let aliasesMerged = 0;
  let aliasesFailed = 0;
  let failed = 0;
  const affectedListingIds = new Set();
  const actor = clean(user?.email) || "system-single-candidate-merge@js-map.com";
  for (const row of reviewRows) {
    try {
      const record = reviewRecords.get(row.id);
      const listingId = clean(row.candidate_id);
      if (!record.sourceId || !record.address || !listingId) throw new Error("검증 원본 또는 대표매물 확인 필요");
      const existingSourceMap = await loadExistingSources(env, record.source, [record]);
      const existingSource = existingSourceMap.get(record.sourceId) || null;
      const existingAssetsMap = existingSource ? await loadSourceAssets(env, existingSourceMap) : new Map();
      await attachSource(env, record, listingId, row.session_id, existingSource, false, actor,
        existingSource ? existingAssetsMap.get(clean(existingSource.id)) : null, true);

      const aliasResult = await env.DB.prepare(`SELECT id, session_id, source, source_listing_id, payload_json
        FROM collector_raw
        WHERE processing_state='duplicate'
          AND json_extract(result_json, '$.action')='sameAsPendingReview'
          AND json_extract(result_json, '$.canonicalReviewId')=?1
        ORDER BY created_at, id`).bind(row.id).all();
      const aliases = (aliasResult?.results || []).map(alias => ({ alias, record: pendingAliasRecord(alias, record) }));
      await preserveReviewFirstObservations(env, aliases.map(item => item.record));
      for (const { alias, record: aliasRecord } of aliases) {
        try {
          const aliasSourceMap = await loadExistingSources(env, aliasRecord.source, [aliasRecord]);
          const aliasSource = aliasSourceMap.get(aliasRecord.sourceId) || null;
          const aliasAssetsMap = aliasSource ? await loadSourceAssets(env, aliasSourceMap) : new Map();
          await attachSource(env, aliasRecord, listingId, alias.session_id, aliasSource, false, actor,
            aliasSource ? aliasAssetsMap.get(clean(aliasSource.id)) : null, true);
          await env.DB.prepare(`UPDATE collector_raw SET processing_state='processed', processed_at=?1,
              result_json=?2, error_text='' WHERE id=?3`)
            .bind(nowIso(), JSON.stringify({ action: "autoMergeSingleCandidateAlias", listingId,
              canonicalReviewId: row.id, preserveRepresentative: true }), alias.id).run();
          aliasesMerged += 1;
        } catch (error) {
          aliasesFailed += 1;
          await env.DB.prepare("UPDATE collector_raw SET error_text=?1 WHERE id=?2")
            .bind(clean(error?.message || error).slice(0, 500), alias.id).run();
        }
      }
      await env.DB.prepare(`UPDATE collector_raw SET processing_state='processed', processed_at=?1,
          result_json=?2, error_text='' WHERE id=?3`)
        .bind(nowIso(), JSON.stringify({ action: "autoMergeSingleCandidate", listingId,
          preserveRepresentative: true, aliasesMerged: Number(aliasResult?.results?.length || 0) }), row.id).run();
      affectedListingIds.add(listingId);
      merged += 1;
    } catch (error) {
      failed += 1;
      await env.DB.prepare("UPDATE collector_raw SET error_text=?1 WHERE id=?2")
        .bind(clean(error?.message || error).slice(0, 500), row.id).run();
    }
  }
  const remainingStatement = env.DB.prepare(`SELECT COUNT(*) AS count
    FROM collector_raw cr JOIN listings l ON l.id=json_extract(cr.result_json, '$.candidateIds[0]')
    WHERE cr.processing_state='review'
      AND json_array_length(json_extract(cr.result_json, '$.candidateIds'))=1
      AND l.status <> 'deleted'
      AND l.address=json_extract(cr.payload_json, '$.address')
      AND NOT EXISTS (SELECT 1 FROM listings other
        WHERE other.status <> 'deleted' AND other.address=l.address AND other.id<>l.id)
      ${remainingShardClause}`);
  const remaining = await (shard >= 0
    ? remainingStatement.bind(shardCount, shard).first()
    : remainingStatement.first());
  const remainingSingleCandidate = Number(remaining?.count || 0);
  return { ok: true, action: "mergeSingleCandidateReviews", scanned: reviewRows.length,
    merged, aliasesMerged, aliasesFailed, failed, affectedListingIds: [...affectedListingIds],
    remainingSingleCandidate, hasMore: remainingSingleCandidate > 0, shard, shardCount,
    operationAdjustments: { pendingReview: -merged }, source: "D1" };
}

async function repairExactReviews(env, user, options = {}) {
  const decisionVersion = REVIEW_CLASSIFICATION_VERSION;
  const sourceFilter = clean(options.source);
  const scanLimit = Math.max(1, Math.min(50, Number(options.limit) || 50));
  const rows = await env.DB.prepare(`SELECT id, session_id, payload_json, result_json, created_at FROM collector_raw
    WHERE processing_state='review'
      AND COALESCE(json_extract(result_json, '$.autoDecisionVersion'), 0) < ?1
      AND (?2='' OR source=?2)
    ORDER BY CASE WHEN EXISTS (
      SELECT 1
      FROM json_each(collector_raw.result_json, '$.candidateIds') candidate_id
      JOIN listings exact ON exact.id=candidate_id.value
      WHERE exact.status<>'deleted'
        AND COALESCE(NULLIF(exact.trade_type, ''), 'lease')=
          COALESCE(NULLIF(collector_raw.trade_type, ''), 'lease')
        AND exact.room=COALESCE(json_extract(collector_raw.payload_json, '$.room'), '')
        AND (
          (
            COALESCE(NULLIF(collector_raw.trade_type, ''), 'lease')='lease'
            AND (
              (
                exact.area_m2 IS NULL
                AND json_extract(collector_raw.payload_json, '$.area') IS NULL
                AND exact.deposit=CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL)
                AND exact.monthly_rent=CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL)
              )
              OR (
                exact.area_m2 IS NOT NULL
                AND json_extract(collector_raw.payload_json, '$.area') IS NOT NULL
                AND ABS(exact.area_m2-CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL))<1
                AND (
                  (
                    exact.deposit=CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL)
                    AND ABS(exact.monthly_rent-CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL))<=20
                    AND ABS(exact.monthly_rent-CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL))<=
                      0.2*MIN(ABS(exact.monthly_rent), ABS(CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL)))
                  )
                  OR (
                    exact.monthly_rent=CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL)
                    AND ABS(exact.deposit-CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL))<=500
                    AND ABS(exact.deposit-CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL))<=
                      0.2*MIN(ABS(exact.deposit), ABS(CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL)))
                  )
                )
              )
            )
          )
          OR (
            collector_raw.trade_type='sale'
            AND exact.sale_category=COALESCE(collector_raw.sale_category, '')
            AND exact.sale_price=collector_raw.sale_price
            AND exact.area_m2 IS NOT NULL
            AND json_extract(collector_raw.payload_json, '$.area') IS NOT NULL
            AND ABS(exact.area_m2-CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL))<1
          )
        )
    ) THEN 0 WHEN EXISTS (
      SELECT 1
      FROM json_each(collector_raw.result_json, '$.candidateIds') candidate_id
      JOIN listings different ON different.id=candidate_id.value
      WHERE different.status<>'deleted'
        AND COALESCE(NULLIF(different.trade_type, ''), 'lease')='lease'
        AND COALESCE(NULLIF(collector_raw.trade_type, ''), 'lease')='lease'
        AND different.room=COALESCE(json_extract(collector_raw.payload_json, '$.room'), '')
        AND different.area_m2 IS NOT NULL
        AND json_extract(collector_raw.payload_json, '$.area') IS NOT NULL
        AND ABS(different.area_m2-CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL))>=5
        AND (ABS(different.area_m2-CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL))>=10 OR
          (
          MIN(ABS(different.area_m2), ABS(CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL)))=0
          OR ABS(different.area_m2-CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL))>=
            0.35*MIN(ABS(different.area_m2), ABS(CAST(json_extract(collector_raw.payload_json, '$.area') AS REAL)))
          )
        )
        AND (
          (
            different.deposit IS NOT NULL
            AND json_extract(collector_raw.payload_json, '$.deposit') IS NOT NULL
            AND ABS(different.deposit-CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL))>=500
            AND (
              MIN(ABS(different.deposit), ABS(CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL)))=0
              OR ABS(different.deposit-CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL))>=
                0.5*MIN(ABS(different.deposit), ABS(CAST(json_extract(collector_raw.payload_json, '$.deposit') AS REAL)))
            )
          )
          OR (
            different.monthly_rent IS NOT NULL
            AND json_extract(collector_raw.payload_json, '$.rent') IS NOT NULL
            AND ABS(different.monthly_rent-CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL))>=20
            AND (
              MIN(ABS(different.monthly_rent), ABS(CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL)))=0
              OR ABS(different.monthly_rent-CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL))>=
                0.3*MIN(ABS(different.monthly_rent), ABS(CAST(json_extract(collector_raw.payload_json, '$.rent') AS REAL)))
            )
          )
        )
    ) THEN 0 ELSE 1 END, created_at DESC LIMIT ?3`).bind(decisionVersion, sourceFilter, scanLimit).all();
  const reviewRows = rows?.results || [];
  const parsedRows = reviewRows.map((row) => {
    const parsed = parseJson(row.payload_json, null);
    return { row, record: parsed ? normalizeReviewRecord(parsed) : null };
  })
    .filter((item) => item.record?.address && item.record?.sourceId);
  const validIds = new Set(parsedRows.map((item) => item.row.id));
  const invalidRows = reviewRows.filter((row) => !validIds.has(row.id));
  const records = parsedRows.map((item) => item.record);
  await preserveReviewFirstObservations(env, records);
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
  let consolidated = 0;
  let aliasesMerged = 0;
  let aliasesFailed = 0;
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
      const pendingCandidates = (pendingReviewsByAddress.get(record.address) || []).filter((candidate) =>
        listingTradeTypesCanMerge(candidate.record?.tradeType || candidate.trade_type, record.tradeType));
      const pendingMatch = choosePendingReviewMatch(record, pendingCandidates, {
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
      const allCandidates = candidatesByAddress.get(record.address) || [];
      const candidates = allCandidates.filter((candidate) =>
        listingTradeTypesCanMerge(candidate.trade_type, record.tradeType));
      const classified = classifyListingCandidates(record, candidates);
      const existingSource = existingSourcesByKey.get(`${clean(record.source)}:${clean(record.sourceId)}`) || null;
      const existingAssets = existingSource ? existingAssetsBySource.get(clean(existingSource.id)) : null;
      if (classified.decision === "merge") {
        const consolidatedNow = await consolidateClassifiedCandidateDuplicates(env, user, classified);
        if (consolidatedNow > 0) {
          consolidated += consolidatedNow;
          const removedIds = new Set(classified.duplicateCandidateIds || []);
          candidatesByAddress.set(record.address, allCandidates
            .filter((candidate) => !removedIds.has(clean(candidate.id || candidate.property_id))));
          affectedListingIds.add(classified.candidate.id);
        }
        await attachSource(env, record, classified.candidate.id, row.session_id, existingSource, false,
          clean(user?.email), existingAssets);
        affectedListingIds.add(classified.candidate.id);
        const aliasResult = await env.DB.prepare(`SELECT id, session_id, source, source_listing_id, payload_json
          FROM collector_raw
          WHERE processing_state='duplicate'
            AND json_extract(result_json, '$.action')='sameAsPendingReview'
            AND json_extract(result_json, '$.canonicalReviewId')=?1
          ORDER BY created_at, id`).bind(row.id).all();
        let mergedAliasCount = 0;
        const aliases = (aliasResult?.results || []).map(alias => ({ alias, record: pendingAliasRecord(alias, record) }));
        await preserveReviewFirstObservations(env, aliases.map(item => item.record));
        for (const { alias, record: aliasRecord } of aliases) {
          try {
            const aliasSourceMap = await loadExistingSources(env, aliasRecord.source, [aliasRecord]);
            const aliasSource = aliasSourceMap.get(aliasRecord.sourceId) || null;
            const aliasAssetsMap = aliasSource ? await loadSourceAssets(env, aliasSourceMap) : new Map();
            await attachSource(env, aliasRecord, classified.candidate.id, alias.session_id, aliasSource, false,
              clean(user?.email), aliasSource ? aliasAssetsMap.get(clean(aliasSource.id)) : null, true);
            await env.DB.prepare(`UPDATE collector_raw SET processing_state='processed', processed_at=?1,
                result_json=?2, error_text='' WHERE id=?3`)
              .bind(nowIso(), JSON.stringify({ action: "autoMergeExactAlias",
                listingId: classified.candidate.id, canonicalReviewId: row.id,
                preserveRepresentative: true, autoDecisionVersion: decisionVersion }), alias.id).run();
            aliasesMerged += 1;
            mergedAliasCount += 1;
          } catch (error) {
            aliasesFailed += 1;
            await env.DB.prepare("UPDATE collector_raw SET error_text=?1 WHERE id=?2")
              .bind(clean(error?.message || error).slice(0, 500), alias.id).run();
          }
        }
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2, error_text='' WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action: "autoMerge", listingId: classified.candidate.id,
            reason: classified.reason, aliasesMerged: mergedAliasCount,
            autoDecisionVersion: decisionVersion }), row.id).run();
        merged += 1;
      } else if (classified.decision === "create") {
        const listingId = await createListing(env, record, row.session_id, clean(user?.email), existingSource, existingAssets);
        candidates.push({ id: listingId, property_id: listingId, title: record.buildingName,
          address: record.address, room: record.room, listing_type: record.category,
          trade_type: collectorTradeType(record.tradeType, true), sale_category: record.saleCategory,
          sale_price: record.salePrice,
          deposit: record.deposit, monthly_rent: record.rent, maintenance_fee: record.fee,
          premium: record.premium, area_m2: record.area, operating_memo: record.memo, main_source: record.source });
        candidatesByAddress.set(record.address, [
          ...allCandidates.filter((candidate) =>
            !listingTradeTypesCanMerge(candidate.trade_type, record.tradeType)), ...candidates
        ]);
        affectedListingIds.add(listingId);
        await env.DB.prepare("UPDATE collector_raw SET processing_state='processed', processed_at=?1, result_json=?2, error_text='' WHERE id=?3")
          .bind(nowIso(), JSON.stringify({ action: "autoCreate", listingId,
            reason: classified.reason, autoDecisionVersion: decisionVersion }), row.id).run();
        created += 1;
      } else {
        await env.DB.prepare("UPDATE collector_raw SET result_json=?1, error_text='' WHERE id=?2")
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
  const includeRemaining = options.includeRemaining !== false;
  const pending = includeRemaining
    ? await env.DB.prepare(`SELECT COUNT(*) AS count FROM collector_raw
      WHERE processing_state='review' AND COALESCE(json_extract(result_json, '$.autoDecisionVersion'), 0) < ?1
        AND (?2='' OR source=?2)`)
      .bind(decisionVersion, sourceFilter).first()
    : null;
  const remainingToScan = includeRemaining ? Number(pending?.count || 0) : null;
  return { ok: true, action: "repairRoomlessExactReviews", scanned: reviewRows.length,
    merged, created, duplicate, consolidated, aliasesMerged, aliasesFailed, ambiguous, failed,
    hasMore: includeRemaining ? remainingToScan > 0 : reviewRows.length >= scanLimit,
    remainingToScan, sourceFilter,
    operationAdjustments: {
      pendingReview: -(merged + created + duplicate),
      activeMaster: -consolidated,
      history: consolidated
    }, source: "D1" };
}

export async function runScheduledReviewRepair() {
  // Matching ambiguity no longer blocks publication. Historic unresolved rows
  // await a fresh provider observation; do not force-merge them in the cron.
  return { ok: true, policy: "source-advertisement-v1", scanned: 0,
    merged: 0, created: 0, duplicate: 0, skipped: true };
}

export async function handleCollectorAdminPost(env, user, body) {
  const action = clean(body.action);
  if (!isCollectorAdminPostAction(action)) return null;
  requireRole(user, ["owner", "admin", "member"]);
  if (action === "applyReviewBatch") return applyReviewBatch(env, user, body);
  if (action === "consolidateExistingMasters") return consolidateExisting(env, user, body);
  if (action === "repairRoomlessExactReviews") return repairExactReviews(env, user);
  if (action === "mergeSingleCandidateReviews") return mergeSingleCandidateReviews(env, user, body);
  return null;
}
