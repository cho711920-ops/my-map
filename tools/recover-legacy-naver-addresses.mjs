import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_SQL = resolve(ROOT, "tools/repair-legacy-naver-addresses-generated.sql");
const OUTPUT_JSON = resolve(ROOT, "tools/repair-legacy-naver-addresses-manifest.json");
const DATABASE = "js-map-primary";
const PAGE_SIZE = 450;
const KAKAO_CONCURRENCY = 6;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sql(value) {
  return `'${clean(value).replaceAll("'", "''")}'`;
}

function id(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function runWrangler(args, { allowFailure = false } = {}) {
  const command = process.execPath;
  const wrangler = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(command, [wrangler, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(clean(result.stderr || result.stdout) || `wrangler failed (${result.status})`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function remoteRows(query) {
  const result = runWrangler(["d1", "execute", DATABASE, "--remote", "--command", query, "--json"]);
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload) || !payload[0]?.success) throw new Error(`D1 query failed: ${result.stdout}`);
  return Array.isArray(payload[0].results) ? payload[0].results : [];
}

function pages(query) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = remoteRows(`${query} LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
    rows.push(...page);
    console.log(`D1 rows: ${rows.length}`);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function kakaoJavascriptKey() {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
  const match = html.match(/dapi\.kakao\.com\/v2\/maps\/sdk\.js\?appkey=([A-Za-z0-9]+)/);
  if (!match) throw new Error("Kakao JavaScript key was not found in index.html");
  return match[1];
}

function exactAddress(document) {
  const address = document?.address;
  if (!address) return "";
  const district = clean(address.region_2depth_name);
  const dong = clean(address.region_3depth_name);
  const main = clean(address.main_address_no);
  const sub = clean(address.sub_address_no);
  if (!district || !dong || !main) return "";
  return `${district} ${dong} ${address.mountain_yn === "Y" ? "산 " : ""}${main}${sub && sub !== "0" ? `-${sub}` : ""}`;
}

function districtDong(value) {
  const match = clean(value).match(/(?:대전(?:광역시|시)?\s+)?([^\s]+구)\s+([^\s]+동)/);
  return match ? `${match[1]} ${match[2]}` : "";
}

async function reverseGeocode(row, key) {
  const lat = number(row.latitude, NaN);
  const lng = number(row.longitude, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 30 || lat > 40 || lng < 120 || lng > 130) {
    return { ...row, recovered_address: "", recovery_reason: "missing-coordinate" };
  }
  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  let lastError = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `KakaoAK ${key}`,
          KA: "sdk/4.4.19 os/javascript lang/ko-KR device/Win32 origin/https%3A%2F%2Fjs-map.com",
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15_000)
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        await new Promise((done) => setTimeout(done, 350 * attempt * attempt));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const recovered = exactAddress(payload?.documents?.[0]);
      if (!recovered) return { ...row, recovered_address: "", recovery_reason: "no-parcel-address" };
      const expectedDong = districtDong(row.snapshot_address || row.master_address);
      if (expectedDong && districtDong(recovered) !== expectedDong) {
        return { ...row, recovered_address: "", recovery_reason: `coordinate-dong-mismatch:${recovered}` };
      }
      return { ...row, recovered_address: recovered, recovery_reason: "coordinate-reverse-geocode" };
    } catch (error) {
      lastError = clean(error?.message || error);
      if (attempt < 5) await new Promise((done) => setTimeout(done, 350 * attempt * attempt));
    }
  }
  return { ...row, recovered_address: "", recovery_reason: `reverse-geocode-failed:${lastError}` };
}

async function mapConcurrent(rows, callback, concurrency) {
  const output = new Array(rows.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await callback(rows[index], index);
      completed += 1;
      if (completed % 100 === 0 || completed === rows.length) console.log(`Reverse geocode: ${completed}/${rows.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  return output;
}

function roomKey(value) {
  return clean(value).replace(/\.0(?=층|호)/g, "").replaceAll(" ", "");
}

function sourceSignature(row) {
  return [row.recovered_address, roomKey(row.room || row.floor), number(row.deposit), number(row.rent), number(row.area).toFixed(1), clean(row.trade_type || "lease")].join("|");
}

function strongCandidate(row, listing) {
  if (clean(listing.address) !== row.recovered_address) return false;
  if (clean(listing.trade_type || "lease") !== clean(row.trade_type || "lease")) return false;
  if (number(listing.deposit) !== number(row.deposit) || number(listing.monthly_rent) !== number(row.rent)) return false;
  const sourceRoom = roomKey(row.room || row.floor);
  const targetRoom = roomKey(listing.room || listing.floor);
  if (!sourceRoom || !targetRoom || sourceRoom !== targetRoom) return false;
  const sourceArea = number(row.area);
  const targetArea = number(listing.area_m2);
  return !sourceArea || !targetArea || Math.abs(sourceArea - targetArea) <= Math.max(2, sourceArea * 0.1);
}

function queryCandidates(addresses) {
  const output = [];
  const list = [...new Set(addresses)].sort();
  for (let offset = 0; offset < list.length; offset += 70) {
    const chunk = list.slice(offset, offset + 70);
    output.push(...remoteRows(`SELECT id,address,floor,room,deposit,monthly_rent,area_m2,trade_type,status FROM listings WHERE status='active' AND address IN (${chunk.map(sql).join(",")})`));
  }
  return output;
}

function createRepairSql(actions) {
  const valueRows = actions.map((row) => `(${[
    row.source_row_id, row.source_listing_id, row.old_listing_id, row.action,
    row.target_listing_id, row.recovered_address, row.latitude, row.longitude
  ].map(sql).join(",")})`);
  const insertStatements = [];
  for (let offset = 0; offset < valueRows.length; offset += 250) {
    insertStatements.push(`INSERT OR REPLACE INTO repair_legacy_naver_address VALUES\n  ${valueRows
      .slice(offset, offset + 250).join(",\n  ")};`);
  }
  return `-- Generated by tools/recover-legacy-naver-addresses.mjs.
-- Exact parcel addresses come from each original Naver coordinate, never from the attached master coordinate.
CREATE TABLE IF NOT EXISTS repair_legacy_naver_address (
  source_row_id TEXT PRIMARY KEY,
  source_listing_id TEXT NOT NULL,
  old_listing_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_listing_id TEXT NOT NULL,
  exact_address TEXT NOT NULL,
  latitude REAL,
  longitude REAL
);

${insertStatements.join("\n\n")}

INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json)
SELECT s.listing_id,s.id,'legacyAddressRepairDetached','codex-address-repair@js-map.com',
  json_object('listingId',s.listing_id,'address',json_extract(s.list_snapshot_json,'$.address')),
  json_object('action',r.action,'targetListingId',r.target_listing_id,'address',r.exact_address,
    'reason','과거 동단위 주소 원본을 원본 좌표의 정확지번으로 복구')
FROM listing_sources s JOIN repair_legacy_naver_address r ON r.source_row_id=s.id
WHERE s.active=1 AND s.listing_id=r.old_listing_id AND r.action IN ('move','create');

INSERT OR IGNORE INTO listings(
  id,property_id,status,main_source,title,address,road_address,building_name,dong,floor,room,
  deposit,monthly_rent,premium,maintenance_fee,area_m2,latitude,longitude,operating_memo,
  search_tags,condition_key,physical_key,version,first_collected_at,last_collected_at,
  created_at,updated_at,listing_type,landlord_phone,tenant_phone,source_url,contacts_json,
  registration_at,trade_type,sale_category,sale_price
)
SELECT r.target_listing_id,r.target_listing_id,'active',s.source,
  COALESCE(NULLIF(json_extract(s.list_snapshot_json,'$.buildingName'),''),'일반상가'),r.exact_address,'',
  COALESCE(NULLIF(json_extract(s.list_snapshot_json,'$.buildingName'),''),'일반상가'),
  substr(r.exact_address,instr(r.exact_address,' ')+1,
    instr(substr(r.exact_address,instr(r.exact_address,' ')+1),' ')-1),'',
  COALESCE(json_extract(s.list_snapshot_json,'$.room'),''),
  json_extract(s.list_snapshot_json,'$.deposit'),json_extract(s.list_snapshot_json,'$.rent'),
  json_extract(s.list_snapshot_json,'$.premium'),json_extract(s.list_snapshot_json,'$.fee'),
  json_extract(s.list_snapshot_json,'$.area'),r.latitude,r.longitude,
  COALESCE(json_extract(s.list_snapshot_json,'$.memo'),''),'','','',1,
  s.first_collected_at,s.last_collected_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  COALESCE(NULLIF(json_extract(s.list_snapshot_json,'$.type'),''),'상가점포'),'','',s.source_url,'[]',
  COALESCE(NULLIF(s.first_collected_at,''),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  COALESCE(s.trade_type,'lease'),COALESCE(s.sale_category,''),s.sale_price
FROM listing_sources s JOIN repair_legacy_naver_address r ON r.source_row_id=s.id
WHERE r.action='create'
  AND r.source_row_id=(SELECT min(r2.source_row_id) FROM repair_legacy_naver_address r2
    WHERE r2.target_listing_id=r.target_listing_id AND r2.action='create');

UPDATE listing_media SET listing_id=(SELECT r.target_listing_id FROM repair_legacy_naver_address r WHERE r.source_row_id=listing_media.source_id),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_id IN (SELECT source_row_id FROM repair_legacy_naver_address WHERE action IN ('move','create'));

UPDATE listing_contacts SET listing_id=(SELECT r.target_listing_id FROM repair_legacy_naver_address r WHERE r.source_row_id=listing_contacts.source_id),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_id IN (SELECT source_row_id FROM repair_legacy_naver_address WHERE action IN ('move','create'));

UPDATE listing_sources SET
  listing_id=COALESCE((SELECT r.target_listing_id FROM repair_legacy_naver_address r WHERE r.source_row_id=listing_sources.id),listing_id),
  list_snapshot_json=json_set(list_snapshot_json,'$.address',(SELECT r.exact_address FROM repair_legacy_naver_address r WHERE r.source_row_id=listing_sources.id),
    '$.propertyId',COALESCE((SELECT r.target_listing_id FROM repair_legacy_naver_address r WHERE r.source_row_id=listing_sources.id),listing_id)),
  raw_json=json_set(raw_json,'$.jibunAddress','대전광역시 ' || (SELECT r.exact_address FROM repair_legacy_naver_address r WHERE r.source_row_id=listing_sources.id)),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE active=1 AND id IN (SELECT source_row_id FROM repair_legacy_naver_address);

CREATE TABLE IF NOT EXISTS repair_legacy_naver_single_target AS
SELECT r.old_listing_id, min(r.target_listing_id) AS target_listing_id
FROM repair_legacy_naver_address r
WHERE r.action IN ('move','create')
GROUP BY r.old_listing_id
HAVING count(DISTINCT r.target_listing_id)=1
  AND NOT EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id=r.old_listing_id AND s.active=1);

INSERT OR IGNORE INTO customer_matches(
  customer_id,listing_id,state,score,memo,created_at,updated_at,contacted_at,legacy_json
)
SELECT c.customer_id,r.target_listing_id,c.state,c.score,c.memo,c.created_at,c.updated_at,c.contacted_at,c.legacy_json
FROM customer_matches c JOIN repair_legacy_naver_single_target r ON r.old_listing_id=c.listing_id;

DELETE FROM customer_matches
WHERE listing_id IN (SELECT old_listing_id FROM repair_legacy_naver_single_target);

UPDATE customer_activities
SET listing_id=(SELECT r.target_listing_id FROM repair_legacy_naver_single_target r
  WHERE r.old_listing_id=customer_activities.listing_id)
WHERE listing_id IN (SELECT old_listing_id FROM repair_legacy_naver_single_target);

UPDATE cloud_state
SET value_json=(SELECT replace(cloud_state.value_json,'property:' || r.old_listing_id,
    'property:' || r.target_listing_id)
  FROM repair_legacy_naver_single_target r
  WHERE instr(cloud_state.value_json,'property:' || r.old_listing_id)>0
  LIMIT 1),
  version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE scope='favorites' AND EXISTS (
  SELECT 1 FROM repair_legacy_naver_single_target r
  WHERE instr(cloud_state.value_json,'property:' || r.old_listing_id)>0
);

UPDATE listings SET status='deleted',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT DISTINCT old_listing_id FROM repair_legacy_naver_address WHERE action IN ('move','create'))
  AND NOT EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id=listings.id AND s.active=1);

INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json)
SELECT s.listing_id,s.id,'legacyAddressRepairAttached','codex-address-repair@js-map.com','{}',
  json_object('sourceListingId',s.source_listing_id,'address',json_extract(s.list_snapshot_json,'$.address'),
    'reason','원본 좌표의 정확지번으로 소속 복구')
FROM listing_sources s JOIN repair_legacy_naver_address r ON r.source_row_id=s.id
WHERE r.action IN ('move','create') AND s.listing_id=r.target_listing_id;

DROP TABLE repair_legacy_naver_address;
DROP TABLE repair_legacy_naver_single_target;
`;
}

const suspects = pages(`SELECT s.id AS source_row_id,s.source_listing_id,s.listing_id AS old_listing_id,
  l.address AS master_address,json_extract(s.list_snapshot_json,'$.address') AS snapshot_address,
  json_extract(s.list_snapshot_json,'$.latitude') AS latitude,
  json_extract(s.list_snapshot_json,'$.longitude') AS longitude,
  json_extract(s.list_snapshot_json,'$.deposit') AS deposit,
  json_extract(s.list_snapshot_json,'$.rent') AS rent,
  json_extract(s.list_snapshot_json,'$.area') AS area,
  json_extract(s.list_snapshot_json,'$.room') AS room,
  json_extract(s.list_snapshot_json,'$.floor') AS floor,
  COALESCE(s.trade_type,'lease') AS trade_type
FROM listing_sources s JOIN listings l ON l.id=s.listing_id
WHERE s.source='네이버' AND s.active=1 AND l.status='active'
  AND json_extract(s.list_snapshot_json,'$.address') NOT GLOB '*동 *[0-9]*'
  AND l.address GLOB '*동 *[0-9]*'
ORDER BY s.id`);

const exactMismatches = pages(`SELECT s.id AS source_row_id,s.source_listing_id,s.listing_id AS old_listing_id,
  l.address AS master_address,json_extract(s.list_snapshot_json,'$.address') AS recovered_address,
  json_extract(s.list_snapshot_json,'$.latitude') AS latitude,
  json_extract(s.list_snapshot_json,'$.longitude') AS longitude,
  json_extract(s.list_snapshot_json,'$.deposit') AS deposit,
  json_extract(s.list_snapshot_json,'$.rent') AS rent,
  json_extract(s.list_snapshot_json,'$.area') AS area,
  json_extract(s.list_snapshot_json,'$.room') AS room,
  json_extract(s.list_snapshot_json,'$.floor') AS floor,
  COALESCE(s.trade_type,'lease') AS trade_type
FROM listing_sources s JOIN listings l ON l.id=s.listing_id
WHERE s.source='네이버' AND s.active=1 AND l.status='active'
  AND json_extract(s.list_snapshot_json,'$.address') GLOB '*동 *[0-9]*'
  AND replace(replace(json_extract(s.list_snapshot_json,'$.address'),'대전광역시 ',''),'대전시 ','')
      <> replace(replace(l.address,'대전광역시 ',''),'대전시 ','')
  AND l.address GLOB '*동 *[0-9]*'
ORDER BY s.id`);

const coordinateRows = suspects.filter((row) => clean(row.latitude) && clean(row.longitude) &&
  Number.isFinite(number(row.latitude, NaN)) && Number.isFinite(number(row.longitude, NaN)));
const recovered = await mapConcurrent(coordinateRows, (row) => reverseGeocode(row, kakaoJavascriptKey()), KAKAO_CONCURRENCY);
const sameAddress = recovered.filter((row) => row.recovered_address === row.master_address);
const movedAddress = recovered.filter((row) => row.recovered_address && row.recovered_address !== row.master_address);
const unresolved = suspects.filter((row) => !coordinateRows.some((candidate) => candidate.source_row_id === row.source_row_id))
  .map((row) => ({ ...row, recovery_reason: "missing-coordinate" }))
  .concat(recovered.filter((row) => !row.recovered_address));
const actionable = [...movedAddress, ...exactMismatches.map((row) => ({ ...row, recovery_reason: "stored-exact-address" }))];
const candidates = queryCandidates(actionable.map((row) => row.recovered_address));
const createdBySignature = new Map();
const actions = [];
for (const row of actionable) {
  const matches = candidates.filter((listing) => strongCandidate(row, listing));
  let action = "move";
  let target = matches.length === 1 ? matches[0].id : "";
  if (!target) {
    action = "create";
    const signature = sourceSignature(row);
    target = createdBySignature.get(signature) || id("M-address-repair", signature);
    createdBySignature.set(signature, target);
  }
  actions.push({ ...row, action, target_listing_id: target });
}
for (const row of sameAddress) {
  actions.push({ ...row, action: "same", target_listing_id: row.old_listing_id });
}
actions.sort((left, right) => left.source_row_id.localeCompare(right.source_row_id));

const manifest = {
  generatedAt: new Date().toISOString(),
  suspectDongOnly: suspects.length,
  coordinateRows: coordinateRows.length,
  sameAddress: sameAddress.length,
  differentAddress: movedAddress.length,
  storedExactMismatch: exactMismatches.length,
  unresolved: unresolved.length,
  actions: {
    same: actions.filter((row) => row.action === "same").length,
    move: actions.filter((row) => row.action === "move").length,
    create: actions.filter((row) => row.action === "create").length,
    createdMasters: new Set(actions.filter((row) => row.action === "create").map((row) => row.target_listing_id)).size
  },
  unresolvedRows: unresolved,
  changedRows: actions.filter((row) => row.action !== "same")
};
writeFileSync(OUTPUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(OUTPUT_SQL, createRepairSql(actions));
console.log(JSON.stringify({ ...manifest, unresolvedRows: undefined, changedRows: undefined }, null, 2));

if (APPLY) {
  const result = runWrangler(["d1", "execute", DATABASE, "--remote", "--file", OUTPUT_SQL, "--yes"]);
  console.log(result.stdout);
}
