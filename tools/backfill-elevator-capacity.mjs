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
  )
  SELECT l.id, l.address, l.building_name, l.building_elevators,
    COALESCE(NULLIF(trim(l.road_address),''), MIN(r.road_address)) AS road_address
  FROM listings l LEFT JOIN register_locations r
    ON r.lot_key=replace(replace(replace(l.address,'대전광역시',''),'번지',''),' ','')
  WHERE l.status<>'deleted' AND l.building_elevators>0 AND COALESCE(l.building_elevator_capacity,0)=0
  GROUP BY l.id HAVING trim(COALESCE(NULLIF(l.road_address,''), MIN(r.road_address)))<>''`;
  return d1(query).results || [];
}

function capacityIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    // The operation service names the road-address field `address1`; `address2`
    // is only the parenthesized legal-dong suffix such as "(송촌동)".
    const key = roadKey(row?.address1);
    const capacity = Number(clean(row?.ratedCap).replace(/,/g, "")) || 0;
    if (!key || capacity <= 0) continue;
    index.set(key, Math.max(index.get(key) || 0, capacity));
  }
  return index;
}

function applyRows(rows) {
  const now = new Date().toISOString();
  for (let offset = 0; offset < rows.length; offset += 40) {
    const statements = rows.slice(offset, offset + 40).map((row) => `UPDATE listings SET
      road_address=CASE WHEN trim(COALESCE(road_address,''))='' THEN ${sqlText(row.road_address)} ELSE road_address END,
      building_elevator_capacity=CASE WHEN COALESCE(building_elevator_capacity,0)=0 AND ${Number(row.capacity || 0)}>0
        THEN ${Number(row.capacity || 0)} ELSE building_elevator_capacity END,
      updated_at=${sqlText(now)}
      WHERE id=${sqlText(row.id)} AND status<>'deleted' AND building_elevators>0;`).join("\n");
    d1(statements);
    process.stdout.write(`D1 updated: ${Math.min(offset + 40, rows.length)}/${rows.length}\n`);
  }
}

const apply = process.argv.includes("--apply");
const targets = listingTargets();
process.stdout.write(`Listings with an official road-address candidate: ${targets.length}\n`);
const operationRows = (await Promise.all(DISTRICTS.map(fetchDistrict))).flat();
const index = capacityIndex(operationRows);
const prepared = targets.map((row) => ({ ...row, capacity: index.get(roadKey(row.road_address)) || 0 }));
const matched = prepared.filter((row) => row.capacity > 0);
process.stdout.write(`Official capacity matches: ${matched.length}/${prepared.length}\n`);
process.stdout.write(`Unique official road-address capacities: ${index.size}\n`);
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
    SUM(CASE WHEN trim(COALESCE(road_address,''))<>'' THEN 1 ELSE 0 END) AS with_road_address
    FROM listings WHERE status<>'deleted' AND building_elevators>0`).results?.[0] || {};
  process.stdout.write(`${JSON.stringify(verified)}\n`);
}
