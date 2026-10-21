import { canonicalListingRoom, parseListingFloor } from "./floor.js";
import { sourceAvailability, sourceAbsenceConfirmedAt } from "./source-availability.js";

const clean = value => String(value ?? "").trim();
const parsed = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };

export const MANUAL_REPRESENTATIVE_FIELDS = ["title", "building_name", "room", "deposit", "monthly_rent",
  "maintenance_fee", "premium", "area_m2", "sale_price", "listing_type", "sale_category", "sale_details_json"];

export async function loadManualRepresentativeFields(env, listingIds) {
  const ids = Array.isArray(listingIds) ? [...new Set(listingIds.map(clean).filter(Boolean))] : null;
  if (ids && !ids.length) return new Map();
  const scope = ids ? " AND listing_id IN (SELECT value FROM json_each(?1))" : "";
  const projection = prefix => `json_object(${MANUAL_REPRESENTATIVE_FIELDS.map(key =>
    `'${key}',json_extract(${prefix},'$.${key}')`).join(",")})`;
  const rows = await env.DB.prepare(`SELECT listing_id, action, ${projection("before_json")} AS before_fields,
      ${projection("after_json")} AS after_fields
    FROM listing_history WHERE (action='updateProperty' OR action='separateOriginalListing') AND json_valid(before_json) AND json_valid(after_json)
      ${scope} ORDER BY listing_id, id`).bind(...(ids ? [JSON.stringify(ids)] : [])).all();
  const result = new Map();
  for (const row of rows?.results || []) {
    const before = parsed(row.before_fields), after = parsed(row.after_fields);
    const fields = result.get(clean(row.listing_id)) || new Set();
    if (row.action === "separateOriginalListing") {
      fields.add("__separatedV55");
      result.set(clean(row.listing_id), fields);
      continue;
    }
    for (const field of MANUAL_REPRESENTATIVE_FIELDS) {
      const a = after[field], b = before[field];
      if (a == null && b == null || clean(a) === clean(b)) continue;
      fields.add(field);
      if (field === "title" || field === "building_name") { fields.add("title"); fields.add("building_name"); }
    }
    if (fields.size) result.set(clean(row.listing_id), fields);
  }
  return result;
}

// Only explicitly edited room fields are protected. Editing a memo or price
// must not freeze a stale provider floor. Query all affected masters in bulk.
export async function loadManualRoomOverrides(env, listingIds = null) {
  const ids = Array.isArray(listingIds) ? [...new Set(listingIds.map(clean).filter(Boolean))] : null;
  if (ids && !ids.length) return new Map();
  const scope = ids ? " AND h.listing_id IN (SELECT value FROM json_each(?1))" : "";
  const result = await env.DB.prepare(`SELECT DISTINCT h.listing_id, l.room AS master_room
    FROM listing_history h JOIN listings l ON l.id=h.listing_id
    WHERE h.action='updateProperty' AND json_valid(h.before_json) AND json_valid(h.after_json)
      AND json_type(h.after_json,'$.room') IS NOT NULL
      AND COALESCE(json_extract(h.before_json,'$.room'),'')<>COALESCE(json_extract(h.after_json,'$.room'),'')
      AND l.status<>'deleted'${scope}`).bind(...(ids ? [JSON.stringify(ids)] : [])).all();
  return new Map((result?.results || []).map(row => [clean(row.listing_id), clean(row.master_room)]));
}

export function withSourceOriginalMetadata(original, row, manualRooms = new Map(), manualFields = new Map()) {
  const metadata = parsed(row.floor_metadata_json);
  const manual = manualRooms.has(clean(row.listing_id));
  const rawRoom = clean(metadata.room ?? original.sourceRoom);
  const source = clean(row.source || original.source);
  const literalRoom = source === "공실박스" && rawRoom && !/(?:층|호|호실)$|^전체$/.test(rawRoom)
    ? rawRoom + "호" : rawRoom;
  const rawFloor = metadata.ambiguous ? null : parseListingFloor(metadata.floor ?? original.sourceFloor, false);
  const manualRoom = manual ? manualRooms.get(clean(row.listing_id)) : "";
  const manualFloor = manual && /층|(?:^|\s)-?\d+(?:\.\d+)?F\b/i.test(manualRoom)
    ? parseListingFloor(manualRoom, false) : null;
  const floor = manualFloor ?? (metadata.ambiguous ? null :
    rawFloor ?? parseListingFloor(literalRoom || original.room, Boolean(literalRoom)));
  const unavailable = Number(row.active) === 0;
  const sourceListingId = clean(row.source_listing_id);
  const providerSourceId = sourceListingId.replace(/::(?:lease|sale)$/, "").replace(/^네이버-/, "");
  const absenceConfirmedAt = sourceAbsenceConfirmedAt(row);
  return {
    ...original, originalId: clean(row.id) || original.originalId,
    propertyId: clean(row.listing_id) || original.propertyId, source,
    link: clean(row.source_url) || original.link || "",
    // Sale display adapters already recover the advertised scope/floor. Keep
    // that legacy display value; the literal source unit is separate metadata.
    room: manual ? manualRoom : original.tradeType === "sale" ? original.room : canonicalListingRoom(literalRoom || original.room, floor),
    floor: floor == null ? "" : floor,
    literalRoom, sourceFloor: rawFloor == null ? "" : rawFloor, sourceRoom: literalRoom,
    hasManualRoomOverride: manual, roomManuallyEditedV1: manual,
    sourceListingId, providerSourceId, active: unavailable ? 0 : 1,
    addressDisclosure: ["hidden", "public"].includes(row.address_disclosure) ? row.address_disclosure : "",
    sourceUnavailable: unavailable, missingCount: unavailable ? Math.max(1, Number(row.missing_count) || 0) : 0,
    ...sourceAvailability(row.active, row.availability_kind),
    manualDisplayFields: MANUAL_REPRESENTATIVE_FIELDS.filter(field => manualFields.get(clean(row.listing_id))?.has(field)).join(","),
    saleGroupingSeparatedV55: manualFields.get(clean(row.listing_id))?.has("__separatedV55") || false,
    lastCheckedAt: clean(row.updated_at || row.last_collected_at),
    // Compatibility alias only: neither field claims the provider's actual end
    // time. Legacy/active/invalid evidence must never manufacture a date.
    endedAt: absenceConfirmedAt,
    absenceConfirmedAt
  };
}
