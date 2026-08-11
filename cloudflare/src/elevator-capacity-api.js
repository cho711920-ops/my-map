import { parseXmlRows } from "../../api/_lib/permit-open-data.js";

const OPERATION_API_URL = "https://apis.data.go.kr/B553664/ElevatorOperationService/getOperationInfoListV1";
const SOURCE_OPERATION_API_URL = "http://openapigw.elevator.go.kr/openapi/service/ElevatorOperationService/getOperationInfoListV1";
const BUILDING_ELEVATOR_API_URL = "https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList";
const CACHE_DAYS = 45;
const CACHE_VERSION = 4;
const SERVICE_PAUSE_KEY = `elevator-capacity-service-pause-v${CACHE_VERSION}`;
const DISTRICT_INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DISTRICT_INDEX_VERSION = 2;
const districtIndexLoads = new Map();

function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function normalizeDataGoKrServiceKey(value) {
  const key = clean(value);
  if (!/%[0-9a-f]{2}/i.test(key)) return key;
  try {
    // data.go.kr displays both encoded and decoded keys. URLSearchParams
    // performs its own encoding, so decode the displayed encoded key first
    // to prevent %3D becoming %253D and producing HTTP 403.
    return decodeURIComponent(key);
  } catch (_) {
    return key;
  }
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

export function elevatorAddressVariants(value) {
  const fullAddress = completeDaejeonAddress(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/(?:지하|지상)?\s*\d+(?:\.0)?\s*층.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = fullAddress.match(/(?:대전광역시|대전시)?\s*([가-힣]+구)\s+([가-힣0-9]+(?:동|가|읍|면|리))\s+(산\s*)?(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return fullAddress ? [fullAddress] : [];
  const district = match[1];
  const neighborhood = match[2];
  const lot = `${match[3] ? "산 " : ""}${Number(match[4])}${Number(match[5] || 0) ? `-${Number(match[5])}` : ""}`;
  return [...new Set([
    fullAddress,
    `대전광역시 ${district} ${neighborhood} ${lot}`,
    `대전 ${district} ${neighborhood} ${lot}`,
    `${district} ${neighborhood} ${lot}`,
    `${neighborhood} ${lot}`
  ])];
}

function roadAddressKey(value) {
  return completeDaejeonAddress(value)
    .replace(/^\s*\d{5}\s*/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/(?:지하|지상)?\s*\d+(?:\.0)?\s*층.*$/i, " ")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function elevatorRoadAddressVariants(value) {
  const fullAddress = completeDaejeonAddress(value)
    .replace(/^\s*\d{5}\s*/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!fullAddress) return [];
  return [...new Set([
    fullAddress,
    fullAddress.replace(/^대전광역시\s+/, ""),
    fullAddress.replace(/^대전광역시\s+[^\s]+구\s+/, "")
  ].filter(Boolean))];
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

async function fetchOperationPage(env, address, pageNo, apiUrl = OPERATION_API_URL) {
  // This approval belongs to the Korea Elevator Safety Agency operation API.
  // Keep it separate from the building-register/public-permit credential so
  // rotating either service never interrupts the other one.
  const serviceKey = normalizeDataGoKrServiceKey(env.ELEVATOR_OPERATION_SERVICE_KEY);
  const sourceGateway = apiUrl === SOURCE_OPERATION_API_URL;
  if (!serviceKey && !sourceGateway) throw new Error("공공데이터 인증키가 설정되지 않았습니다.");
  const url = new URL(apiUrl);
  if (serviceKey) url.searchParams.set("serviceKey", serviceKey);
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

async function fetchOperationRows(env, address, apiUrl = OPERATION_API_URL) {
  const first = await fetchOperationPage(env, address, 1, apiUrl);
  const pages = Math.min(20, Math.max(1, Math.ceil((first.totalCount || first.rows.length) / 500)));
  const rest = pages > 1
    ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => fetchOperationPage(env, address, index + 2, apiUrl)))
    : [];
  return first.rows.concat(...rest.map((page) => page.rows));
}

async function fetchOperationRowsWithFallback(env, address) {
  let primaryError = null;
  try {
    const rows = await fetchOperationRows(env, address, OPERATION_API_URL);
    if (rows.length) return { rows, sourceGateway: false };
  } catch (error) {
    primaryError = error;
  }
  try {
    const rows = await fetchOperationRows(env, address, SOURCE_OPERATION_API_URL);
    return { rows, sourceGateway: true };
  } catch (sourceError) {
    throw primaryError || sourceError;
  }
}

function districtFromAddress(value) {
  return completeDaejeonAddress(value).match(/([가-힣]+구)\s/)?.[1] || "";
}

async function readDistrictIndex(env, district) {
  if (!env.MEDIA || !district) return null;
  const object = await env.MEDIA.get(`api-cache/elevator-district-v${DISTRICT_INDEX_VERSION}/${district}.json`);
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text());
    const age = Date.now() - Date.parse(parsed?.checkedAt || "");
    return parsed?.groups && Number.isFinite(age) && age < DISTRICT_INDEX_MAX_AGE_MS ? parsed.groups : null;
  } catch (_) {
    return null;
  }
}

async function buildDistrictIndex(env, district) {
  const fetched = await fetchOperationRowsWithFallback(env, `대전광역시 ${district}`);
  const rows = fetched.rows.map(compactRow)
    .filter((row) => row.elevatorNo);
  const groups = {};
  rows.forEach((row) => {
    const keys = [...new Set([row.address, row.roadAddress].flatMap((candidate) => {
      const parcelKey = parcelAddressKey(candidate);
      const roadKey = roadAddressKey(candidate);
      return [parcelKey ? `parcel:${parcelKey}` : "", roadKey ? `road:${roadKey}` : ""].filter(Boolean);
    }))];
    keys.forEach((key) => {
      if (!groups[key]) groups[key] = [];
      if (!groups[key].some((entry) => entry.elevatorNo === row.elevatorNo)) groups[key].push(row);
    });
  });
  if (env.MEDIA) {
    await env.MEDIA.put(`api-cache/elevator-district-v${DISTRICT_INDEX_VERSION}/${district}.json`, JSON.stringify({
      checkedAt: new Date().toISOString(),
      district,
      groups
    }), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  }
  return groups;
}

async function districtElevators(env, district, targetKey, targetRoadKey) {
  if (!district) return [];
  const cached = await readDistrictIndex(env, district);
  const keys = [targetKey ? `parcel:${targetKey}` : "", targetRoadKey ? `road:${targetRoadKey}` : ""].filter(Boolean);
  if (cached) return keys.flatMap((key) => cached[key] || []);
  if (!districtIndexLoads.has(district)) {
    districtIndexLoads.set(district, buildDistrictIndex(env, district).finally(() => districtIndexLoads.delete(district)));
  }
  const groups = await districtIndexLoads.get(district);
  return keys.flatMap((key) => groups[key] || []);
}

function matchingOperationRows(rows, targetKey, targetRoadKey) {
  return rows.map(compactRow).filter((row) => row.elevatorNo && [row.address, row.roadAddress].some((candidate) =>
    (targetKey && parcelAddressKey(candidate) === targetKey) ||
    (targetRoadKey && roadAddressKey(candidate) === targetRoadKey)
  ));
}

async function discoverElevators(env, fullAddress, targetKey, roadAddress) {
  let serviceReached = false;
  const targetRoadKey = roadAddressKey(roadAddress);
  const variants = targetRoadKey
    ? elevatorRoadAddressVariants(roadAddress)
    : elevatorAddressVariants(fullAddress);
  for (const address of variants) {
    const fetched = await fetchOperationRowsWithFallback(env, address);
    serviceReached = true;
    const matched = matchingOperationRows(fetched.rows, targetKey, targetRoadKey);
    if (matched.length) return { rows: matched, queryAddress: address, serviceReached };
  }
  const district = districtFromAddress(fullAddress);
  const districtRows = await districtElevators(env, district, targetKey, targetRoadKey);
  if (districtRows.length) {
    return { rows: districtRows, queryAddress: `대전광역시 ${district}`, serviceReached: true };
  }
  return { rows: [], queryAddress: fullAddress, serviceReached };
}

async function fetchElevatorDetail(env, elevatorNo) {
  const serviceKey = normalizeDataGoKrServiceKey(env.ELEVATOR_OPERATION_SERVICE_KEY);
  if (!serviceKey) throw new Error("공공데이터 인증키가 설정되지 않았습니다.");
  const url = new URL(BUILDING_ELEVATOR_API_URL);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("elevator_no", elevatorNo);
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
  if (!response.ok) throw new Error(`건물별 승강기정보 조회 실패 (HTTP ${response.status})`);
  const resultCode = xmlValue(xml, "resultCode");
  if (resultCode && !["00", "0", "NORMAL_SERVICE"].includes(resultCode)) {
    const error = new Error(xmlValue(xml, "resultMsg") || resultCode);
    error.apiResultCode = resultCode;
    throw error;
  }
  return parseXmlRows(xml).map(compactRow).find((row) => row.elevatorNo === elevatorNo) || null;
}

async function enrichElevatorDetails(env, operationRows) {
  const unique = [...new Map(operationRows.map((row) => [row.elevatorNo, row])).values()];
  const details = await Promise.all(unique.slice(0, 20).map(async (row) => {
    if (row.maxCapacity > 0) return row;
    try {
      return (await fetchElevatorDetail(env, row.elevatorNo)) || row;
    } catch (_) {
      // The operation response already includes ratedCap/liveLoad. Preserve it
      // when the newly approved detail service is still propagating.
      return row;
    }
  }));
  return details.concat(unique.slice(20));
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

export async function getElevatorCapacity(env, {
  address, roadAddress = "", buildingName = "", cacheKey, force = false
} = {}) {
  const fullAddress = completeDaejeonAddress(address);
  const targetKey = parcelAddressKey(fullAddress);
  // Building-HUB occasionally reports zero elevators for a parcel even when
  // the Elevator Safety Agency has active operation records.  Address validity,
  // not the Building-HUB count, decides whether the independent registry runs.
  if (!fullAddress || !targetKey) {
    return { ok: true, available: true, matched: false, maxCapacity: 0, capacities: [], elevators: [] };
  }
  const key = `elevator-capacity-v${CACHE_VERSION}-${clean(cacheKey) || targetKey}`;
  if (!force) {
    const cached = await readCache(env, key);
    if (cached) return cached;
    const servicePause = await readCache(env, SERVICE_PAUSE_KEY);
    if (servicePause?.available === false) return servicePause;
  }
  try {
    const discovered = await discoverElevators(env, fullAddress, targetKey, roadAddress);
    const elevators = await enrichElevatorDetails(env, discovered.rows);
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
      roadAddress: clean(roadAddress),
      buildingName: clean(buildingName),
      queryAddress: discovered.queryAddress,
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
    const accessFailure = /HTTP\s*403|access|denied|not registered|등록|인증|service key/i
      .test(`${result.resultCode} ${result.message}`);
    await writeCache(env, key, fullAddress, result, accessFailure ? "+10 minutes" : "+1 day");
    if (accessFailure) {
      await writeCache(env, SERVICE_PAUSE_KEY, "", result, "+10 minutes");
    }
    return result;
  }
}
