import { execFileSync } from "node:child_process";
import { parseXmlRows } from "../api/_lib/permit-open-data.js";

const DATABASE = "js-map-primary";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";
const SOURCE_API = "http://openapigw.elevator.go.kr/openapi/service/ElevatorOperationService/getOperationInfoListV1";
const DISTRICTS = ["동구", "중구", "서구", "유성구", "대덕구"];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function sqlText(value) {
  return `'${clean(value).replace(/'/g, "''")}'`;
}

function d1(command) {
  const output = execFileSync(process.execPath, [
    WRANGLER, "d1", "execute", DATABASE, "--remote", "--json", "--command", command
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(output);
  if (!parsed?.[0]?.success) throw new Error("D1 command failed");
  return parsed[0];
}

function roadKey(value) {
  return clean(value)
    .replace(/^\d{5}\s*/, "")
    .replace(/^(?:대전광역시|대전시)\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function xmlValue(xml, tag) {
  return clean(String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]);
}

async function fetchPageOnce(district, pageNo) {
  const url = new URL(SOURCE_API);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "500");
  url.searchParams.set("elevator_no", "");
  url.searchParams.set("buld_address", `대전광역시 ${district}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/xml,text/xml" } });
  } finally {
    clearTimeout(timer);
  }
  const xml = await response.text();
  if (!response.ok || !["00", "0", "NORMAL_SERVICE"].includes(xmlValue(xml, "resultCode"))) {
    throw new Error(`${district} elevator index failed: HTTP ${response.status} ${xmlValue(xml, "resultMsg")}`);
  }
  return { rows: parseXmlRows(xml), total: Number(xmlValue(xml, "totalCount")) || 0 };
}

async function fetchPage(district, pageNo) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchPageOnce(district, pageNo);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function fetchDistrict(district) {
  const first = await fetchPage(district, 1);
  const pages = Math.max(1, Math.ceil(first.total / 500));
  const rest = [];
  for (let pageNo = 2; pageNo <= pages; pageNo += 1) rest.push(await fetchPage(district, pageNo));
  const rows = first.rows.concat(...rest.map((page) => page.rows));
  process.stdout.write(`${district}: ${rows.length} elevator rows\n`);
  return rows;
}

function listingTargets() {
  const query = `WITH register_locations AS (
    SELECT replace(replace(replace(json_extract(j.value,'$.lotAddress'),'대전광역시',''),'번지',''),' ','') AS lot_key,
      json_extract(j.value,'$.roadAddress') AS road_address
    FROM building_cache b, json_each(b.summary_json,'$.buildings') AS j
    WHERE b.cache_key LIKE 'building-register-v10-%' AND trim(json_extract(j.value,'$.roadAddress'))<>''
    UNION
    SELECT replace(replace(replace(json_extract(j.value,'$.lotAddress'),'대전광역시',''),'번지',''),' ','') AS lot_key,
      json_extract(j.value,'$.roadAddress') AS road_address
    FROM building_cache b, json_each(b.summary_json,'$.recaps') AS j
    WHERE b.cache_key LIKE 'building-register-v10-%' AND trim(json_extract(j.value,'$.roadAddress'))<>''
  ), source_locations AS (
    SELECT listing_id, MAX(CASE
      WHEN json_extract(raw_json,'$.publicAddress') LIKE '%로 %'
        OR json_extract(raw_json,'$.publicAddress') LIKE '%길 %'
        THEN json_extract(raw_json,'$.publicAddress')
      WHEN json_extract(raw_json,'$.address') LIKE '%로 %'
        OR json_extract(raw_json,'$.address') LIKE '%길 %'
        THEN json_extract(raw_json,'$.address')
      ELSE '' END) AS road_address
    FROM listing_sources WHERE active=1 AND source='당근' GROUP BY listing_id
  )
  SELECT l.id, l.address, l.building_name, l.building_elevators,
    l.building_elevator_capacity, l.building_info_checked_at,
    COALESCE(NULLIF(trim(l.road_address),''), MIN(r.road_address), NULLIF(trim(MIN(s.road_address)),'')) AS road_address
  FROM listings l LEFT JOIN register_locations r
    ON r.lot_key=replace(replace(replace(l.address,'대전광역시',''),'번지',''),' ','')
    LEFT JOIN source_locations s ON s.listing_id=l.id
  WHERE l.status<>'deleted'
  GROUP BY l.id HAVING trim(COALESCE(NULLIF(l.road_address,''), MIN(r.road_address), NULLIF(trim(MIN(s.road_address)),'')))<>''`;
  return d1(query).results || [];
}

function registryIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    // The operation service names the road-address field `address1`; `address2`
    // is only the parenthesized legal-dong suffix such as "(송촌동)".
    const key = roadKey(row?.address1);
    const elevatorNo = clean(row?.elevatorNo || row?.elvtrUniqueNo);
    const status = clean(row?.elvtrSttsNm || row?.elvtrStts);
    if (/철거|폐지|말소/.test(status)) continue;
    const capacity = Number(clean(row?.ratedCap).replace(/,/g, "")) || 0;
    if (!key || !elevatorNo) continue;
    const current = index.get(key) || { elevators: new Set(), capacity: 0 };
    current.elevators.add(elevatorNo);
    current.capacity = Math.max(current.capacity, capacity);
    index.set(key, current);
  }
  return new Map([...index].map(([key, value]) => [key, {
    count: value.elevators.size,
    capacity: value.capacity
  }]));
}

function applyRows(rows) {
  const now = new Date().toISOString();
  for (let offset = 0; offset < rows.length; offset += 40) {
    const statements = rows.slice(offset, offset + 40).map((row) => `UPDATE listings SET
      road_address=CASE WHEN trim(COALESCE(road_address,''))='' THEN ${sqlText(row.road_address)} ELSE road_address END,
      elevator_registry_count=${Number(row.registryCount || 0)},
      elevator_registry_checked_at=${sqlText(now)},
      elevator_registry_status=${sqlText(row.registryCount > 0 ? "matched" : "no_match")},
      building_elevators=MAX(COALESCE(building_register_elevators,building_elevators,0),${Number(row.registryCount || 0)}),
      building_elevator_capacity=${Number(row.registryCount > 0 ? row.capacity || 0 : 0)},
      building_info_status=CASE WHEN ${Number(row.registryCount || 0)}>0 THEN '확인완료' ELSE building_info_status END,
      updated_at=${sqlText(now)}
      WHERE id=${sqlText(row.id)} AND status<>'deleted';`).join("\n");
    d1(statements);
    process.stdout.write(`D1 updated: ${Math.min(offset + 40, rows.length)}/${rows.length}\n`);
  }
}

const apply = process.argv.includes("--apply");
const targets = listingTargets();
const coverage = d1(`SELECT COUNT(*) AS active_listings,
  SUM(CASE WHEN trim(COALESCE(building_info_checked_at,''))<>'' AND building_elevators=0 THEN 1 ELSE 0 END) AS checked_zero
  FROM listings WHERE status<>'deleted'`).results?.[0] || {};
process.stdout.write(`Active listings: ${Number(coverage.active_listings || 0)}\n`);
process.stdout.write(`Listings with a verified official road-address: ${targets.length}\n`);
const operationRows = (await Promise.all(DISTRICTS.map(fetchDistrict))).flat();
const index = registryIndex(operationRows);
const prepared = targets.map((row) => {
  const registry = index.get(roadKey(row.road_address)) || { count: 0, capacity: 0 };
  return { ...row, registryCount: registry.count, capacity: registry.capacity };
});
const matched = prepared.filter((row) => row.registryCount > 0);
const mismatchedZero = matched.filter((row) => Number(row.building_elevators || 0) === 0 &&
  clean(row.building_info_checked_at));
const newlyVerified = matched.filter((row) => Number(row.building_elevators || 0) === 0 &&
  !clean(row.building_info_checked_at));
const newlyCapacitated = matched.filter((row) => Number(row.capacity || 0) > 0 &&
  Number(row.building_elevator_capacity || 0) !== Number(row.capacity || 0));
const vehicleOrUnknownOnly = matched.filter((row) => Number(row.capacity || 0) === 0);
const uniqueMatchedRoads = new Set(matched.map((row) => roadKey(row.road_address))).size;
process.stdout.write(`Safety-registry matches: ${matched.length}/${prepared.length} listings at ${uniqueMatchedRoads} road addresses\n`);
process.stdout.write(`Building-HUB zero but safety-registry matched: ${mismatchedZero.length} listings\n`);
process.stdout.write(`Previously unchecked but safety-registry matched: ${newlyVerified.length} listings\n`);
process.stdout.write(`Capacity values to add or correct: ${newlyCapacitated.length} listings\n`);
process.stdout.write(`Elevator exists but person capacity is unknown: ${vehicleOrUnknownOnly.length} listings\n`);
process.stdout.write(`Unique official elevator road addresses: ${index.size}\n`);
if (!matched.length && prepared.length) {
  process.stdout.write(`Listing road sample: ${JSON.stringify(prepared.slice(0, 3).map((row) => ({
    roadAddress: row.road_address, key: roadKey(row.road_address)
  })))}\n`);
  process.stdout.write(`Elevator road sample: ${JSON.stringify(operationRows
    .filter((row) => Number(clean(row?.ratedCap).replace(/,/g, "")) > 0 && clean(row?.address1))
    .slice(0, 3).map((row) => ({ roadAddress: row.address1, key: roadKey(row.address1), capacity: row.ratedCap })))}\n`);
}

if (!apply) {
  process.stdout.write("Dry run only. Re-run with --apply to update road_address and verified capacities.\n");
} else {
  applyRows(prepared);
  const verified = d1(`SELECT COUNT(*) AS active_elevator_listings,
    SUM(CASE WHEN COALESCE(building_elevator_capacity,0)>0 THEN 1 ELSE 0 END) AS with_capacity,
    SUM(CASE WHEN COALESCE(building_elevator_capacity,0)=0 THEN 1 ELSE 0 END) AS with_unknown_capacity,
    SUM(CASE WHEN elevator_registry_status='matched' THEN 1 ELSE 0 END) AS safety_registry_matched
    FROM listings WHERE status<>'deleted' AND building_elevators>0`).results?.[0] || {};
  process.stdout.write(`${JSON.stringify(verified)}\n`);
}
