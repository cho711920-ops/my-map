import { withSourceOriginalMetadata, loadManualRepresentativeFields } from "./source-original-display.js";
import { normalizeNaverPropertyType } from "./naver-property-types.js";

const clean = value => String(value ?? "").trim();
const json = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const priority = { "당근": 0, "네이버": 1, "공실박스": 2, "직접등록": 3, "직접확인": 3 };
const number = value => value == null || clean(value) === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const equal = (left, right) => left === right || left == null && right == null;
const masterFields = ["title", "building_name", "room", "deposit", "monthly_rent", "maintenance_fee",
  "premium", "area_m2", "sale_price", "main_source", "source_url", "listing_type", "sale_category", "sale_details_json"];

function representativeFloorSql() {
  return `CASE WHEN source='공실박스' THEN json_object(
      'floor',COALESCE(json_extract(raw_json,'$.list.Ff'),json_extract(raw_json,'$.Ff')),
      'room',COALESCE(json_extract(raw_json,'$.list.Ho'),json_extract(raw_json,'$.Ho')))
    WHEN source='네이버' THEN json_object(
      'floor',COALESCE(json_extract(raw_json,'$.floorInfo.targetFloor'),
        json_extract(raw_json,'$.saleRaw.detailInfo.spaceInfo.floorInfo.targetFloor'),
        CASE WHEN json_type(raw_json,'$.floorInfo') IN ('text','integer','real') THEN json_extract(raw_json,'$.floorInfo') END,
        json_extract(raw_json,'$.roomInfo')),'room',json_extract(raw_json,'$.roomInfo'))
    WHEN source='당근' THEN json_object('floor',json_extract(raw_json,'$.floor'),
      'ambiguous',CASE WHEN json_type(raw_json,'$.isAmbiguousFloor')='true' THEN 1 ELSE 0 END,
      'room',json_extract(raw_json,'$.room')) ELSE '{}' END`;
}

export function chooseActiveRepresentative(master, rows) {
  const market = clean(master.trade_type) || "lease";
  const active = rows.filter(row => Number(row.active) === 1 && (clean(row.trade_type) || "lease") === market);
  const oldUrl = clean(master.source_url);
  const sameUrl = oldUrl ? active.filter(row => clean(row.source_url) === oldUrl) : [];
  const candidates = sameUrl.length ? sameUrl : active;
  return candidates.slice().sort((a, b) => (priority[clean(a.source)] ?? 9) - (priority[clean(b.source)] ?? 9) ||
    clean(b.last_collected_at || b.updated_at).localeCompare(clean(a.last_collected_at || a.updated_at)) ||
    clean(a.id).localeCompare(clean(b.id)))[0] || null;
}

// The caller owns cache/revision invalidation. No IDs, favorite relationships,
// user memos, manual contract status, contacts or source attachment are changed.
export async function refreshListingRepresentativesFromActiveSources(env, listingIds) {
  const targets = [...new Set((listingIds || []).map(clean).filter(Boolean))];
  const report = { changedListingIds: [], unchangedListingIds: [], conflictListingIds: [] };
  for (let offset = 0; offset < targets.length; offset += 75) {
    const ids = targets.slice(offset, offset + 75), packed = JSON.stringify(ids);
    const masters = await env.DB.prepare(`SELECT id,version,status,trade_type,updated_at,${masterFields.join(",")}
      FROM listings WHERE id IN (SELECT value FROM json_each(?1)) AND status<>'deleted'`).bind(packed).all();
    const originals = await env.DB.prepare(`SELECT id,listing_id,source,source_url,active,trade_type,
        updated_at,last_collected_at,snapshot_hash,list_snapshot_json,${representativeFloorSql()} AS floor_metadata_json
      FROM listing_sources WHERE listing_id IN (SELECT value FROM json_each(?1)) AND active=1`).bind(packed).all();
    const manual = await loadManualRepresentativeFields(env, ids);
    const byMaster = new Map();
    for (const row of originals?.results || []) {
      const values = byMaster.get(row.listing_id) || []; values.push(row); byMaster.set(row.listing_id, values);
    }
    const statements = [], written = [];
    for (const master of masters?.results || []) {
      const chosen = chooseActiveRepresentative(master, byMaster.get(master.id) || []);
      if (!chosen) { report.unchangedListingIds.push(master.id); continue; }
      const protectedFields = manual.get(master.id) || new Set();
      const manualRoom = protectedFields.has("room") ? new Map([[master.id, master.room]]) : new Map();
      const snapshot = withSourceOriginalMetadata(json(chosen.list_snapshot_json), chosen, manualRoom);
      const advertisedName = clean(snapshot.buildingName || snapshot.name);
      const previousNaverType = normalizeNaverPropertyType(master.listing_type);
      const candidateType = clean(snapshot.type);
      const sameNaverLabel = clean(master.main_source) === "네이버" && clean(chosen.source) === "네이버" &&
        previousNaverType.recognized && previousNaverType.code &&
        clean(master.listing_type).toUpperCase() === previousNaverType.code && previousNaverType.label === candidateType;
      const desired = {
        main_source: clean(chosen.source), source_url: clean(chosen.source_url),
        title: advertisedName || master.title, building_name: advertisedName || master.building_name,
        room: clean(snapshot.room) || master.room,
        deposit: number(snapshot.deposit), monthly_rent: number(snapshot.rent),
        maintenance_fee: number(snapshot.fee), premium: number(snapshot.premium), area_m2: number(snapshot.area),
        sale_price: number(snapshot.salePrice),
        listing_type: sameNaverLabel ? master.listing_type : candidateType || master.listing_type,
        sale_category: Object.prototype.hasOwnProperty.call(snapshot, "saleCategory") ? clean(snapshot.saleCategory) : master.sale_category,
        sale_details_json: Object.prototype.hasOwnProperty.call(snapshot, "saleDetails")
          ? JSON.stringify(snapshot.saleDetails && typeof snapshot.saleDetails === "object" && !Array.isArray(snapshot.saleDetails) ? snapshot.saleDetails : {})
          : master.sale_details_json
      };
      const snapshotKeys = { deposit: "deposit", monthly_rent: "rent", maintenance_fee: "fee",
        premium: "premium", area_m2: "area", sale_price: "salePrice" };
      // An omitted legacy field is not evidence to erase a known condition.
      // Explicit null, however, belongs to this surviving ad, not the old one.
      for (const field of masterFields) {
        if (protectedFields.has(field) || snapshotKeys[field] &&
            !Object.prototype.hasOwnProperty.call(snapshot, snapshotKeys[field])) desired[field] = master[field];
      }
      const changes = masterFields.filter(field => !equal(master[field], desired[field]));
      if (!changes.length) { report.unchangedListingIds.push(master.id); continue; }
      const bindings = [], bind = value => { bindings.push(value ?? null); return `?${bindings.length}`; };
      const assignments = changes.map(field => `${field}=${bind(desired[field])}`);
      const now = new Date().toISOString();
      assignments.push("version=version+1", `updated_at=${bind(now)}`);
      const guards = [`id=${bind(master.id)}`, `version IS ${bind(master.version)}`,
        `status IS ${bind(master.status)}`, `updated_at IS ${bind(master.updated_at)}`];
      for (const field of masterFields) guards.push(`${field} IS ${bind(master[field])}`);
      guards.push(`EXISTS (SELECT 1 FROM listing_sources current_source WHERE current_source.id=${bind(chosen.id)}
        AND current_source.listing_id=${bind(master.id)} AND current_source.active=1
        AND current_source.source_url IS ${bind(chosen.source_url)}
        AND current_source.snapshot_hash IS ${bind(chosen.snapshot_hash)}
        AND current_source.updated_at IS ${bind(chosen.updated_at)}
        AND current_source.last_collected_at IS ${bind(chosen.last_collected_at)})`);
      if (clean(master.source_url) && clean(master.source_url) !== clean(chosen.source_url)) {
        guards.push(`NOT EXISTS (SELECT 1 FROM listing_sources returned_source
          WHERE returned_source.listing_id=${bind(master.id)} AND returned_source.active=1
            AND COALESCE(NULLIF(returned_source.trade_type,''),'lease')=${bind(clean(master.trade_type) || "lease")}
            AND returned_source.source_url=${bind(master.source_url)})`);
      }
      statements.push(env.DB.prepare(`UPDATE listings SET ${assignments.join(",")} WHERE ${guards.join(" AND ")}`).bind(...bindings));
      written.push(master.id);
    }
    if (statements.length) {
      const results = await env.DB.batch(statements);
      written.forEach((id, index) => (Number(results?.[index]?.meta?.changes || 0) === 1
        ? report.changedListingIds : report.conflictListingIds).push(id));
    }
  }
  return report;
}
