import { getBuildingRegister } from "./building-register-api.js";
import { getElevatorCapacity } from "./elevator-capacity-api.js";

const REGISTER_CACHE_PREFIX = "building-register-v10-";
const REGISTER_CACHE_RE = /^building-register-v10-(\d{5})_(\d{5})_([01])_(\d{4})_(\d{4})$/;
const DAEJEON_DISTRICTS = "동구|중구|서구|유성구|대덕구";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function resultRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export function normalizedLotAddress(value) {
  return clean(value)
    .replace(/^(?:대전광역시|대전시)\s*/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/번지/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function parseDaejeonParcelAddress(value) {
  const address = clean(value)
    .replace(/^(?:대전광역시|대전시)\s*/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/번지/g, " ")
    .replace(/\s+/g, " ");
  const match = address.match(new RegExp(`(${DAEJEON_DISTRICTS})\\s+([가-힣0-9]+(?:동|가|읍|면|리))\\s+(산\\s*)?(\\d+)(?:\\s*-\\s*(\\d+))?`));
  if (!match) return null;
  return {
    district: match[1],
    neighborhood: match[2],
    platGbCd: match[3] ? "1" : "0",
    bun: String(Number(match[4])).padStart(4, "0"),
    ji: String(Number(match[5] || 0)).padStart(4, "0")
  };
}

function parcelFromCacheKey(cacheKey) {
  const match = clean(cacheKey).match(REGISTER_CACHE_RE);
  if (!match) return null;
  return { sigunguCd: match[1], bjdongCd: match[2], platGbCd: match[3], bun: match[4], ji: match[5] };
}

async function registerIndex(env) {
  const result = await env.DB.prepare(`SELECT cache_key, summary_json FROM building_cache
    WHERE cache_key LIKE ?1 AND summary_json<>''
      AND (expires_at='' OR datetime(expires_at)>datetime('now'))
    ORDER BY datetime(checked_at) DESC LIMIT 3000`)
    .bind(`${REGISTER_CACHE_PREFIX}%`).all();
  const exact = new Map();
  const neighborhood = new Map();
  for (const row of resultRows(result)) {
    const parcel = parcelFromCacheKey(row.cache_key);
    if (!parcel) continue;
    let data;
    try { data = JSON.parse(row.summary_json); } catch (_) { continue; }
    const locations = [...(data?.buildings || []), ...(data?.recaps || [])];
    for (const location of locations) {
      const exactKey = normalizedLotAddress(location?.lotAddress);
      if (exactKey && !exact.has(exactKey)) exact.set(exactKey, parcel);
      const parsed = parseDaejeonParcelAddress(location?.lotAddress);
      const neighborhoodKey = parsed ? `${parsed.district}|${parsed.neighborhood}` : "";
      if (neighborhoodKey && !neighborhood.has(neighborhoodKey)) {
        neighborhood.set(neighborhoodKey, { sigunguCd: parcel.sigunguCd, bjdongCd: parcel.bjdongCd });
      }
    }
  }
  return { exact, neighborhood };
}

async function pendingBuildingListings(env, limit) {
  const result = await env.DB.prepare(`SELECT id, property_id, address, building_name
    FROM listings WHERE status<>'deleted' AND trim(COALESCE(address,''))<>'' AND (
      trim(COALESCE(building_info_checked_at,''))=''
      OR (building_elevators>0 AND COALESCE(building_elevator_capacity,0)=0
        AND trim(COALESCE(road_address,''))=''
        AND datetime(building_info_checked_at)<datetime('now','-12 hours'))
    )
    ORDER BY datetime(COALESCE(NULLIF(last_collected_at,''), updated_at)) DESC LIMIT ?1`)
    .bind(limit).all();
  return resultRows(result);
}

function parcelForListing(index, listing) {
  const exact = index.exact.get(normalizedLotAddress(listing.address));
  if (exact) return exact;
  const parsed = parseDaejeonParcelAddress(listing.address);
  if (!parsed) return null;
  const codes = index.neighborhood.get(`${parsed.district}|${parsed.neighborhood}`);
  if (!codes) return null;
  return { ...codes, platGbCd: parsed.platGbCd, bun: parsed.bun, ji: parsed.ji };
}

async function enrichBuildingBadges(env, { candidateLimit = 80, freshLookupLimit = 2 } = {}) {
  const index = await registerIndex(env);
  const candidates = await pendingBuildingListings(env, candidateLimit);
  const changedIds = [];
  let checked = 0;
  let freshLookups = 0;
  for (const listing of candidates) {
    const parcel = parcelForListing(index, listing);
    if (!parcel) continue;
    if (freshLookups >= freshLookupLimit && !index.exact.has(normalizedLotAddress(listing.address))) continue;
    try {
      const result = await getBuildingRegister(env, {
        ...parcel,
        mode: "summary",
        propertyId: clean(listing.property_id || listing.id),
        address: clean(listing.address)
      });
      checked += 1;
      if (!result?.cached) freshLookups += 1;
      if (result?.buildingInfoCache?.persisted) changedIds.push(clean(listing.id));
    } catch (error) {
      console.error("scheduled building-register enrichment failed", {
        listingId: clean(listing.id), message: clean(error?.message || error)
      });
      freshLookups += 1;
    }
    if (freshLookups >= freshLookupLimit && checked >= 20) break;
  }
  return { checked, freshLookups, changedIds };
}

async function pendingCapacityLocations(env, limit) {
  const result = await env.DB.prepare(`SELECT MIN(id) AS id, MIN(property_id) AS property_id,
      address, road_address, MIN(building_name) AS building_name,
      MAX(building_elevators) AS building_elevators,
      MAX(COALESCE(NULLIF(last_collected_at,''), updated_at)) AS collected_at
    FROM listings WHERE status<>'deleted' AND trim(COALESCE(address,''))<>''
      AND (trim(COALESCE(road_address,''))<>'' OR building_elevators>0)
      AND (
        trim(COALESCE(elevator_registry_checked_at,''))=''
        OR (elevator_registry_status='unavailable'
          AND datetime(elevator_registry_checked_at)<datetime('now','-1 day'))
        OR datetime(elevator_registry_checked_at)<datetime('now','-45 days')
      )
    GROUP BY address, road_address
    ORDER BY road_address='' ASC, datetime(MIN(COALESCE(NULLIF(elevator_registry_checked_at,''),'1970-01-01'))) ASC,
      datetime(collected_at) DESC LIMIT ?1`)
    .bind(limit).all();
  return resultRows(result);
}

function capacityCacheKey(listing) {
  return clean(listing.road_address || listing.address)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^0-9A-Za-z가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 150);
}

async function persistCapacityForLocation(env, listing, registry) {
  const roadAddress = clean(listing.road_address);
  const address = clean(listing.address);
  const now = new Date().toISOString();
  const available = registry?.available !== false;
  const count = available && registry?.matched && Array.isArray(registry?.elevators)
    ? registry.elevators.length : 0;
  const capacity = count > 0 ? Number(registry?.maxCapacity || 0) : 0;
  const status = available ? (count > 0 ? "matched" : "no_match") : "unavailable";
  const result = await env.DB.prepare(`UPDATE listings SET
      elevator_registry_count=CASE WHEN ?1 THEN ?2 ELSE elevator_registry_count END,
      elevator_registry_checked_at=?3, elevator_registry_status=?4,
      building_elevators=CASE WHEN ?1 THEN MAX(COALESCE(building_register_elevators,building_elevators,0),?2)
        ELSE building_elevators END,
      building_elevator_capacity=CASE WHEN ?1 THEN CASE WHEN ?2>0 THEN ?5 ELSE 0 END
        ELSE building_elevator_capacity END,
      building_info_status=CASE WHEN ?2>0 THEN '확인완료' ELSE building_info_status END,
      road_address=CASE WHEN trim(COALESCE(road_address,''))='' AND ?6<>'' THEN ?6 ELSE road_address END,
      updated_at=?3
    WHERE status<>'deleted'
      AND ((?6<>'' AND trim(COALESCE(road_address,''))=?6) OR address=?7) RETURNING id`)
    .bind(available ? 1 : 0, count, now, status, capacity, roadAddress, address).all();
  return resultRows(result).map((row) => clean(row.id)).filter(Boolean);
}

async function enrichElevatorCapacities(env, { candidateLimit = 40, freshLookupLimit = 2 } = {}) {
  const candidates = await pendingCapacityLocations(env, candidateLimit);
  const changedIds = [];
  let checked = 0;
  let freshLookups = 0;
  for (const listing of candidates) {
    let result;
    try {
      result = await getElevatorCapacity(env, {
        address: clean(listing.address),
        roadAddress: clean(listing.road_address),
        buildingName: clean(listing.building_name),
        cacheKey: `scheduled-${capacityCacheKey(listing)}`,
        expectedCount: Number(listing.building_elevators || 0)
      });
    } catch (error) {
      console.error("scheduled elevator-capacity enrichment failed", {
        listingId: clean(listing.id), message: clean(error?.message || error)
      });
      freshLookups += 1;
      if (freshLookups >= freshLookupLimit) break;
      continue;
    }
    checked += 1;
    if (!result?.cached) freshLookups += 1;
    changedIds.push(...await persistCapacityForLocation(env, listing, result));
    if (freshLookups >= freshLookupLimit) break;
  }
  return { checked, freshLookups, changedIds };
}

export async function runScheduledElevatorEnrichment(env, options = {}) {
  if (!env?.DB) return { checked: 0, changed: 0, changedIds: [] };
  const building = await enrichBuildingBadges(env, options);
  const capacity = await enrichElevatorCapacities(env, options);
  const changedIds = [...new Set([...building.changedIds, ...capacity.changedIds])];
  return {
    checked: Number(building.checked || 0) + Number(capacity.checked || 0),
    changed: changedIds.length,
    changedIds,
    building,
    capacity
  };
}
