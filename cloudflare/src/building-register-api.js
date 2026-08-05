import { parseXmlRows } from "../../api/_lib/permit-open-data.js";

const API_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";
const ENDPOINTS = {
  title: ["getBrTitleInfo", "건축물 표제부"],
  recap: ["getBrRecapTitleInfo", "건축물 총괄표제부"],
  floor: ["getBrFlrOulnInfo", "층별개요"],
  exclusive: ["getBrExposInfo", "건축물 전유부"],
  exclusiveArea: ["getBrExposPubuseAreaInfo", "전유공용면적"],
  zone: ["getBrJijiguInfo", "지역지구구역"]
};

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parcelFrom(query) {
  const parcel = {
    sigunguCd: clean(query.sigunguCd), bjdongCd: clean(query.bjdongCd),
    platGbCd: clean(query.platGbCd) === "1" ? "1" : "0",
    bun: clean(query.bun || "0000").padStart(4, "0"),
    ji: clean(query.ji || "0000").padStart(4, "0")
  };
  if (!/^\d{5}$/.test(parcel.sigunguCd) || !/^\d{5}$/.test(parcel.bjdongCd) ||
      !/^\d{4}$/.test(parcel.bun) || !/^\d{4}$/.test(parcel.ji)) {
    throw Object.assign(new Error("건축물대장 조회에 필요한 지번 코드가 올바르지 않습니다."), { statusCode: 400 });
  }
  return parcel;
}

function cacheKey(parcel) {
  return [parcel.sigunguCd, parcel.bjdongCd, parcel.platGbCd, parcel.bun, parcel.ji].join("_");
}

function xmlValue(xml, tag) {
  const matched = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(matched?.[1]).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

async function fetchPage(env, endpoint, label, parcel, pageNo) {
  const key = clean(env.DATA_GO_KR_SERVICE_KEY);
  if (!key) throw new Error("서버 공공데이터 인증키가 연결되지 않았습니다.");
  const url = new URL(`${API_BASE}/${endpoint}`);
  url.searchParams.set("serviceKey", key);
  Object.entries(parcel).forEach(([name, value]) => url.searchParams.set(name, value));
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("_type", "xml");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/xml,text/xml" } });
  } finally {
    clearTimeout(timer);
  }
  const xml = await response.text();
  if (!response.ok) throw new Error(`${label} 조회에 실패했습니다. HTTP ${response.status}`);
  const resultCode = xmlValue(xml, "resultCode");
  if (resultCode && !["00", "0", "NORMAL_SERVICE"].includes(resultCode)) {
    throw new Error(`${label} API 오류: ${xmlValue(xml, "resultMsg") || resultCode}`);
  }
  return { items: parseXmlRows(xml), totalCount: Number(xmlValue(xml, "totalCount")) || 0 };
}

async function fetchEndpoint(env, key, parcel) {
  const [endpoint, label] = ENDPOINTS[key];
  const first = await fetchPage(env, endpoint, label, parcel, 1);
  const pageCount = Math.min(10, Math.max(1, Math.ceil((first.totalCount || first.items.length) / 100)));
  const rest = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(env, endpoint, label, parcel, index + 2)))
    : [];
  const items = first.items.concat(...rest.map((page) => page.items));
  return { items, totalCount: first.totalCount || items.length, truncated: (first.totalCount || items.length) > items.length };
}

function registerType(row) {
  return [clean(row?.regstrGbCdNm), clean(row?.regstrKindCdNm)].filter(Boolean).join(" · ");
}

function title(row) {
  return {
    managementKey: clean(row?.mgmBldrgstPk), lotAddress: clean(row?.platPlc), roadAddress: clean(row?.newPlatPlc),
    registerType: registerType(row), buildingName: clean(row?.bldNm), dongName: clean(row?.dongNm),
    mainAnnex: clean(row?.mainAtchGbCdNm), mainUse: clean(row?.mainPurpsCdNm), otherUse: clean(row?.etcPurps),
    structure: clean(row?.strctCdNm), otherStructure: clean(row?.etcStrct), roof: clean(row?.roofCdNm),
    otherRoof: clean(row?.etcRoof), groundFloors: number(row?.grndFlrCnt), undergroundFloors: number(row?.ugrndFlrCnt),
    height: number(row?.heit), householdCount: number(row?.hhldCnt), familyCount: number(row?.fmlyCnt),
    siteArea: number(row?.platArea), buildingArea: number(row?.archArea), totalArea: number(row?.totArea),
    floorArea: number(row?.vlRatEstmTotArea), buildingCoverageRatio: number(row?.bcRat), floorAreaRatio: number(row?.vlRat),
    passengerElevators: number(row?.rideUseElvtCnt), emergencyElevators: number(row?.emgenUseElvtCnt),
    indoorMechanicalParking: number(row?.indrMechUtcnt), outdoorMechanicalParking: number(row?.oudrMechUtcnt),
    indoorSelfParking: number(row?.indrAutoUtcnt), outdoorSelfParking: number(row?.oudrAutoUtcnt),
    permitDate: clean(row?.pmsDay), startDate: clean(row?.stcnsDay), approvalDate: clean(row?.useAprDay),
    createdDate: clean(row?.crtnDay), seismicDesign: clean(row?.rserthqkDsgnApplyYn),
    seismicAbility: clean(row?.rserthqkAblty), floors: [], zones: []
  };
}

function floor(row) {
  return {
    managementKey: clean(row?.mgmBldrgstPk), buildingName: clean(row?.bldNm), dongName: clean(row?.dongNm),
    floorType: clean(row?.flrGbCdNm), floorNo: number(row?.flrNo), floorName: clean(row?.flrNoNm),
    structure: clean(row?.strctCdNm), otherStructure: clean(row?.etcStrct),
    mainUse: clean(row?.mainPurpsCdNm), otherUse: clean(row?.etcPurps), area: number(row?.area), createdDate: clean(row?.crtnDay)
  };
}

function exclusive(row) {
  return {
    managementKey: clean(row?.mgmBldrgstPk), lotAddress: clean(row?.platPlc), roadAddress: clean(row?.newPlatPlc),
    registerType: registerType(row), buildingName: clean(row?.bldNm), dongName: clean(row?.dongNm),
    floorType: clean(row?.flrGbCdNm), floorNo: number(row?.flrNo), floorName: clean(row?.flrNoNm), roomName: clean(row?.hoNm),
    mainUse: clean(row?.mainPurpsCdNm), otherUse: clean(row?.etcPurps), structure: clean(row?.strctCdNm),
    otherStructure: clean(row?.etcStrct), area: number(row?.area), createdDate: clean(row?.crtnDay), areas: []
  };
}

function exclusiveArea(row) {
  return {
    ...exclusive(row), areaType: clean(row?.exposPubuseGbCdNm), mainAnnex: clean(row?.mainAtchGbCdNm)
  };
}

function zone(row) {
  return { managementKey: clean(row?.mgmBldrgstPk), type: clean(row?.jijiguGbCdNm), name: clean(row?.jijiguCdNm),
    representative: clean(row?.reprYn), detail: clean(row?.etcJijigu), createdDate: clean(row?.crtnDay) };
}

function normalizedName(value) {
  return clean(value).toLowerCase().replace(/[\s()[\]{}·.,_-]+/g, "");
}

function sameBuilding(building, row, count) {
  const buildingKey = clean(building?.managementKey);
  const rowKey = clean(row?.managementKey);
  if (buildingKey && rowKey && buildingKey === rowKey) return true;
  if (count === 1) return true;
  const names = [normalizedName(building?.buildingName), normalizedName(row?.buildingName)];
  const dongs = [normalizedName(building?.dongName).replace(/동$/, ""), normalizedName(row?.dongName).replace(/동$/, "")];
  return (!names[0] || !names[1] || names[0] === names[1] || names[0].includes(names[1]) || names[1].includes(names[0])) &&
    (!dongs[0] || !dongs[1] || dongs[0] === dongs[1]);
}

function roomKey(value) {
  const text = clean(value).toUpperCase().replace(/\s+/g, "").replace(/^제/, "").replace(/호$/, "");
  const basement = text.match(/^B0*(\d+[A-Z]?)$/);
  if (basement) return `B${basement[1]}`;
  const match = text.match(/0*(\d+[A-Z]?)/);
  return match ? match[1] : text;
}

function sameUnit(unit, area) {
  const rooms = [roomKey(unit?.roomName), roomKey(area?.roomName)];
  if (rooms[0] && rooms[1]) {
    return rooms[0] === rooms[1] && sameBuilding(unit, area, 2) &&
      clean(unit?.floorNo) === clean(area?.floorNo) && clean(unit?.floorType) === clean(area?.floorType);
  }
  const keys = [clean(unit?.managementKey), clean(area?.managementKey)];
  return Boolean(keys[0] && keys[0] === keys[1]);
}

function responseBase(parcel, propertyId) {
  return {
    ok: true, action: "buildingRegister", version: 10, propertyId: clean(propertyId), parcel,
    source: "국토교통부 건축HUB 건축물대장정보 서비스", sourceType: "official-open-api",
    sourcePage: "https://www.data.go.kr/data/15134735/openapi.do", updateCycle: "월간",
    queriedAt: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date()),
    cached: false
  };
}

async function readCache(env, key, mode) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT summary_json, details_json, expires_at FROM building_cache
    WHERE cache_key=?1 AND (expires_at='' OR datetime(expires_at)>datetime('now'))`).bind(key).first();
  const value = mode === "summary" ? row?.summary_json : row?.details_json;
  const parsed = value ? JSON.parse(value) : null;
  return parsed?.ok ? { ...parsed, cached: true } : null;
}

async function writeCache(env, key, parcel, mode, result) {
  if (!env.DB) return;
  const summaryJson = mode === "summary" ? JSON.stringify(result) : "";
  const detailsJson = mode === "summary" ? "" : JSON.stringify(result);
  await env.DB.prepare(`INSERT INTO building_cache (cache_key, parcel_json, summary_json, details_json, checked_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, datetime('now','+30 days'))
    ON CONFLICT(cache_key) DO UPDATE SET parcel_json=excluded.parcel_json,
      summary_json=CASE WHEN excluded.summary_json<>'' THEN excluded.summary_json ELSE building_cache.summary_json END,
      details_json=CASE WHEN excluded.details_json<>'' THEN excluded.details_json ELSE building_cache.details_json END,
      checked_at=excluded.checked_at, expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify(parcel), summaryJson, detailsJson, new Date().toISOString()).run();
}

async function persistBuildingBadge(env, propertyId, result) {
  if (!propertyId || !env.DB) return { ok: true, persisted: false };
  const building = result.buildings?.[0] || result.recaps?.[0] || {};
  const approval = clean(building.approvalDate);
  const year = approval.match(/^\d{4}/)?.[0] || "";
  const elevators = Number(building.passengerElevators || 0) + Number(building.emergencyElevators || 0);
  const update = await env.DB.prepare(`UPDATE listings SET building_year=?1, building_elevators=?2,
    building_approval_date=?3, building_info_checked_at=?4, building_info_status='connected', updated_at=?4
    WHERE property_id=?5 OR id=?5`).bind(year, elevators, approval, new Date().toISOString(), clean(propertyId)).run();
  return { ok: true, persisted: Number(update?.meta?.changes || 0) > 0, year, elevators, approvalDate: approval };
}

export async function getBuildingRegister(env, query) {
  const parcel = parcelFrom(query || {});
  const mode = clean(query.mode).toLowerCase() === "summary" ? "summary" : "full";
  const key = `building-register-v10-${cacheKey(parcel)}`;
  if (!/^(1|true|yes)$/i.test(clean(query.force))) {
    const cached = await readCache(env, key, mode);
    if (cached) {
      cached.propertyId = clean(query.propertyId);
      cached.buildingInfoCache = await persistBuildingBadge(env, query.propertyId, cached);
      return cached;
    }
  }
  const requested = mode === "summary" ? ["title", "recap"] : Object.keys(ENDPOINTS);
  const settled = await Promise.all(requested.map(async (name) => [name, await fetchEndpoint(env, name, parcel)]));
  const map = Object.fromEntries(settled);
  let buildings = (map.title?.items || []).map(title);
  const recaps = (map.recap?.items || []).map(title);
  if (!buildings.length && recaps.length) buildings = recaps.slice();
  const base = responseBase(parcel, query.propertyId);
  if (mode === "summary") {
    const result = { ...base, partial: true, detailsPending: true, buildings, recaps, units: [],
      recordCounts: { buildings: map.title?.totalCount || 0, recapTitles: map.recap?.totalCount || 0,
        floors: 0, exclusiveUnits: 0, exclusiveAreas: 0, zones: 0 },
      truncated: Boolean(map.title?.truncated || map.recap?.truncated) };
    result.buildingInfoCache = await persistBuildingBadge(env, query.propertyId, result);
    await writeCache(env, key, parcel, mode, result);
    return result;
  }
  const floors = (map.floor?.items || []).map(floor);
  const zones = (map.zone?.items || []).map(zone);
  const areas = (map.exclusiveArea?.items || []).map(exclusiveArea);
  let units = (map.exclusive?.items || []).map(exclusive);
  if (!units.length && areas.length) {
    const seen = new Set();
    units = areas.filter((entry) => {
      const value = `${entry.managementKey}|${entry.buildingName}|${entry.dongName}|${entry.floorNo}|${roomKey(entry.roomName)}`;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    }).map((entry) => ({ ...entry, areas: [] }));
  }
  units.forEach((unit) => { unit.areas = areas.filter((entry) => sameUnit(unit, entry)); });
  if (!buildings.length && (floors.length || zones.length)) buildings = [title({})];
  buildings.forEach((building) => {
    building.floors = floors.filter((entry) => sameBuilding(building, entry, buildings.length));
    building.zones = zones.filter((entry) => sameBuilding(building, entry, buildings.length));
  });
  const result = { ...base, partial: false, detailsPending: false, buildings, recaps, units,
    recordCounts: { buildings: map.title?.totalCount || buildings.length, recapTitles: map.recap?.totalCount || recaps.length,
      floors: map.floor?.totalCount || floors.length, exclusiveUnits: map.exclusive?.totalCount || units.length,
      exclusiveAreas: map.exclusiveArea?.totalCount || areas.length, zones: map.zone?.totalCount || zones.length },
    truncated: Object.values(map).some((entry) => entry.truncated) };
  result.buildingInfoCache = await persistBuildingBadge(env, query.propertyId, result);
  await writeCache(env, key, parcel, mode, result);
  return result;
}
