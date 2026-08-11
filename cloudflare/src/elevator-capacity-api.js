import { parseXmlRows } from "../../api/_lib/permit-open-data.js";

const API_URL = "https://apis.data.go.kr/B553664/ElevatorOperationService/getOperationInfoListV1";
const CACHE_DAYS = 45;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function xmlValue(xml, tag) {
  const matched = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(matched?.[1])
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function number(value) {
  const matched = clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!matched) return 0;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function completeDaejeonAddress(value) {
  const address = clean(value).replace(/\s+/g, " ");
  if (!address) return "";
  if (/^(?:대전광역시|대전시)\s/.test(address)) return address.replace(/^대전시\s/, "대전광역시 ");
  if (/^(?:동구|중구|서구|유성구|대덕구)\s/.test(address)) return `대전광역시 ${address}`;
  return address;
}

function parcelAddressKey(value) {
  const address = completeDaejeonAddress(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/(?:지하|지상)?\s*\d+(?:\.0)?\s*층.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = address.match(/([가-힣]+구)\s+([가-힣0-9]+(?:동|가|읍|면|리))\s+(산\s*)?(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return "";
  return [match[1], match[2], match[3] ? "산" : "", String(Number(match[4])), String(Number(match[5] || 0))].join("|");
}

function compactRow(row) {
  return {
    elevatorNo: clean(row?.elevatorNo || row?.elvtrUniqueNo),
    buildingName: clean(row?.buldNm),
    address: clean(row?.address1),
    roadAddress: clean(row?.address2),
    elevatorType: clean(row?.elvtrKindNm || row?.elvtrDiv),
    status: clean(row?.elvtrSttsNm || row?.elvtrStts),
    maxCapacity: number(row?.ratedCap),
    loadKg: number(row?.liveLoad)
  };
}

async function fetchPage(env, address, pageNo) {
  const serviceKey = clean(env.DATA_GO_KR_SERVICE_KEY);
  if (!serviceKey) throw new Error("공공데이터 인증키가 설정되지 않았습니다.");
  const url = new URL(API_URL);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "500");
  url.searchParams.set("elevator_no", "");
  url.searchParams.set("buld_address", address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/xml,text/xml" }
    });
  } finally {
    clearTimeout(timer);
  }
  const xml = await response.text();
  if (!response.ok) throw new Error(`승강기 제원 조회 실패 (HTTP ${response.status})`);
  const resultCode = xmlValue(xml, "resultCode");
  if (resultCode && !["00", "0", "NORMAL_SERVICE"].includes(resultCode)) {
    const error = new Error(xmlValue(xml, "resultMsg") || resultCode);
    error.apiResultCode = resultCode;
    throw error;
  }
  return {
    rows: parseXmlRows(xml),
    totalCount: Number(xmlValue(xml, "totalCount")) || 0
  };
}

async function fetchRows(env, address) {
  const first = await fetchPage(env, address, 1);
  const pages = Math.min(10, Math.max(1, Math.ceil((first.totalCount || first.rows.length) / 500)));
  const rest = pages > 1
    ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => fetchPage(env, address, index + 2)))
    : [];
  return first.rows.concat(...rest.map((page) => page.rows));
}

async function readCache(env, key) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT details_json FROM building_cache
    WHERE cache_key=?1 AND (expires_at='' OR datetime(expires_at)>datetime('now'))`).bind(key).first();
  if (!row?.details_json) return null;
  try {
    const parsed = JSON.parse(row.details_json);
    return parsed?.ok ? { ...parsed, cached: true } : null;
  } catch (_) {
    return null;
  }
}

async function writeCache(env, key, address, result, expiry = `+${CACHE_DAYS} days`) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO building_cache
    (cache_key, parcel_json, summary_json, details_json, checked_at, expires_at)
    VALUES (?1, ?2, '', ?3, ?4, datetime('now', ?5))
    ON CONFLICT(cache_key) DO UPDATE SET parcel_json=excluded.parcel_json,
      details_json=excluded.details_json, checked_at=excluded.checked_at, expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify({ address }), JSON.stringify(result), new Date().toISOString(), expiry).run();
}

export async function getElevatorCapacity(env, { address, cacheKey, expectedCount = 0, force = false } = {}) {
  const fullAddress = completeDaejeonAddress(address);
  const targetKey = parcelAddressKey(fullAddress);
  if (!fullAddress || !targetKey || Number(expectedCount || 0) <= 0) {
    return { ok: true, available: true, matched: false, maxCapacity: 0, capacities: [], elevators: [] };
  }
  const key = `elevator-capacity-v1-${clean(cacheKey) || targetKey}`;
  if (!force) {
    const cached = await readCache(env, key);
    if (cached) return cached;
    const servicePause = await readCache(env, "elevator-capacity-service-pause-v1");
    if (servicePause?.available === false) return servicePause;
  }
  try {
    const rows = await fetchRows(env, fullAddress);
    const elevators = rows.map(compactRow).filter((row) =>
      row.elevatorNo && [row.address, row.roadAddress].some((candidate) => parcelAddressKey(candidate) === targetKey)
    );
    const capacities = [...new Set(elevators.map((row) => row.maxCapacity).filter((value) => value > 0))]
      .sort((a, b) => a - b);
    const result = {
      ok: true,
      available: true,
      matched: elevators.length > 0,
      maxCapacity: capacities.length ? capacities[capacities.length - 1] : 0,
      capacities,
      elevators,
      address: fullAddress,
      source: "한국승강기안전공단 건물별승강기운행정보",
      sourcePage: "https://www.data.go.kr/data/15151292/openapi.do",
      queriedAt: new Date().toISOString(),
      cached: false
    };
    await writeCache(env, key, fullAddress, result);
    return result;
  } catch (error) {
    const result = {
      ok: true,
      available: false,
      matched: false,
      maxCapacity: 0,
      capacities: [],
      elevators: [],
      address: fullAddress,
      message: clean(error?.message) || "승강기 제원 조회를 완료하지 못했습니다.",
      resultCode: clean(error?.apiResultCode),
      cached: false
    };
    await writeCache(env, key, fullAddress, result, "+1 day");
    if (/access|denied|not registered|등록|인증|service key/i.test(`${result.resultCode} ${result.message}`)) {
      await writeCache(env, "elevator-capacity-service-pause-v1", "", result, "+6 hours");
    }
    return result;
  }
}
