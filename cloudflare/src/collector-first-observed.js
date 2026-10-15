import { normalizeListingTradeType } from "./listing-trade.js";

const clean = value => String(value ?? "").trim();
const allowedRawStates = new Set(["review", "awaiting_source_refresh", "processed", "duplicate"]);
const parse = value => { try { return value && typeof value === "object" ? value : JSON.parse(value || "{}"); } catch { return null; } };
const providerId = (source, id) => clean(id).replace(/::(?:lease|sale)$/, "")
  .replace(source === "네이버" ? /^네이버-/ : /$^/, "");
const suffixMarket = id => /::(lease|sale)$/.exec(clean(id))?.[1] || "";

export function advertisementObservationKey(source, sourceId, tradeType) {
  const name = clean(source), id = providerId(name, sourceId), market = normalizeListingTradeType(tradeType);
  return ["네이버", "당근", "공실박스"].includes(name) && id && market && (!suffixMarket(sourceId) || suffixMarket(sourceId) === market)
    ? JSON.stringify([name, id, market]) : "";
}

// Server timestamps without an offset are SQLite UTC. Calendar-only legacy
// first-collected dates are KST; reject rollover dates and future observations.
export function verifiedObservationTimestamp(value, now, { legacyDate = false } = {}) {
  const raw = clean(value), upper = Date.parse(clean(now));
  let normalized = raw;
  if (legacyDate && /^\d{2}[./-]\d{2}[./-]\d{2}$/.test(raw)) normalized = "20" + raw.replace(/[./]/g, "-");
  if (legacyDate && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += "T00:00:00+09:00";
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(normalized)) normalized = normalized.replace(" ", "T") + "Z";
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(normalized);
  if (!match || !Number.isFinite(upper)) return "";
  const timezone = match[4];
  let offset = 0;
  if (timezone !== "Z") {
    const hours = Number(timezone.slice(1, 3)), minutes = Number(timezone.slice(4));
    if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) return "";
    offset = (hours * 60 + minutes) * (timezone[0] === "+" ? 1 : -1);
  }
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || time > upper || time < Date.parse("2000-01-01T00:00:00Z") ||
      new Date(time + offset * 60000).toISOString().slice(0, 19) !== match[1] + "T" + match[2]) return "";
  return new Date(time).toISOString();
}

function sameIdentity(row, target) {
  const key = advertisementObservationKey(target.source, target.sourceId, target.tradeType);
  return Boolean(key) && advertisementObservationKey(row.source, row.source_listing_id || row.sourceId, row.trade_type || row.tradeType) === key;
}

function finiteAmount(value) {
  return value !== null && value !== undefined && clean(value) !== "" && typeof value !== "boolean" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function verifiedRawObservationAt(row, target) {
  if (!row || !allowedRawStates.has(clean(row.processing_state)) || clean(row.error_text) || !sameIdentity(row, target)) return "";
  if (clean(parse(row.result_json)?.action) === "collectorError") return "";
  const wrapper = typeof row.payload_json === "object" ? row.payload_json : parse(row.payload_json);
  const payload = wrapper?.record && typeof wrapper.record === "object" ? wrapper.record : wrapper;
  if (!payload || Array.isArray(payload)) return "";
  const source = clean(payload.source || row.source);
  const sourceId = clean(payload.sourceId || payload.providerSourceId || payload.source_listing_id || payload.articleNo || payload.articleNumber);
  const explicitMarket = clean(payload.tradeType || payload.trade_type);
  const market = normalizeListingTradeType(explicitMarket) || (!explicitMarket && (suffixMarket(sourceId) || normalizeListingTradeType(row.trade_type)));
  if (!sourceId || advertisementObservationKey(source, sourceId, market) !== advertisementObservationKey(target.source, target.sourceId, target.tradeType) ||
      suffixMarket(row.source_listing_id) && suffixMarket(row.source_listing_id) !== market || suffixMarket(sourceId) && suffixMarket(sourceId) !== market) return "";
  const address = clean(payload.address);
  if (!/(?:^|\s)[가-힣0-9·.]+(?:읍|면|동|가)\s+(?:산\s*)?\d+(?:-\d+)?(?:번지)?(?:\s|$)/.test(address)) return "";
  if (market === "sale" ? !finiteAmount(payload.salePrice ?? payload.sale_price) || Number(payload.salePrice ?? payload.sale_price) <= 0
    : !finiteAmount(payload.deposit) || !finiteAmount(payload.rent ?? payload.monthly_rent) || Number(payload.deposit) + Number(payload.rent ?? payload.monthly_rent) <= 0) return "";
  return verifiedObservationTimestamp(row.created_at, target.now);
}

export function firstObservedAdvertisement({ source, sourceId, tradeType, sourceRows = [], rawRows = [], now = new Date().toISOString() }) {
  const target = { source, sourceId, tradeType, now };
  const times = [], rawEvidenceIds = [], sourceEvidenceIds = [];
  for (const row of sourceRows) {
    if (!sameIdentity(row, target)) continue;
    const values = [verifiedObservationTimestamp(row.first_collected_at, now, { legacyDate: true }), verifiedObservationTimestamp(row.created_at, now)].filter(Boolean);
    if (values.length) { times.push(...values); sourceEvidenceIds.push(clean(row.id)); }
  }
  for (const row of rawRows) {
    const at = verifiedRawObservationAt(row, target);
    if (at) { times.push(at); rawEvidenceIds.push(clean(row.id)); }
  }
  return { firstObservedAt: times.length ? times.sort()[0] : new Date(now).toISOString(), previouslyObserved: times.length > 0,
    rawEvidenceIds: [...new Set(rawEvidenceIds)], sourceEvidenceIds: [...new Set(sourceEvidenceIds)] };
}

export async function loadFirstObservedAdvertisements(env, source, records, existingSources, now) {
  const aliases = new Set();
  for (const record of records) {
    const id = providerId(source, record.providerSourceId || record.sourceId), market = normalizeListingTradeType(record.tradeType);
    for (const value of [id, id + "::" + market]) {
      aliases.add(value);
      if (source === "네이버") aliases.add("네이버-" + value);
    }
  }
  const evidence = [], ids = [...aliases];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80), params = chunk.map((_, i) => "?" + (i + 2)).join(",");
    // Exact ID aliases preserve the existing source/number index. Never scan
    // all raw advertisements with a normalized-expression WHERE clause.
    const result = await env.DB.prepare(`SELECT 'raw' AS evidence_kind,id,source,source_listing_id,trade_type,
      processing_state,error_text,
      json_object('action',CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.action') END) AS result_json,
      created_at,'' AS first_collected_at,
      json_object('source',COALESCE(json_extract(payload_json,'$.record.source'),json_extract(payload_json,'$.source')),
        'sourceId',COALESCE(json_extract(payload_json,'$.record.sourceId'),json_extract(payload_json,'$.record.providerSourceId'),
          json_extract(payload_json,'$.record.source_listing_id'),json_extract(payload_json,'$.record.articleNo'),json_extract(payload_json,'$.record.articleNumber'),
          json_extract(payload_json,'$.sourceId'),json_extract(payload_json,'$.providerSourceId'),json_extract(payload_json,'$.source_listing_id'),
          json_extract(payload_json,'$.articleNo'),json_extract(payload_json,'$.articleNumber')),
        'tradeType',COALESCE(json_extract(payload_json,'$.record.tradeType'),json_extract(payload_json,'$.record.trade_type'),json_extract(payload_json,'$.tradeType'),json_extract(payload_json,'$.trade_type')),
        'address',COALESCE(json_extract(payload_json,'$.record.address'),json_extract(payload_json,'$.address')),
        'deposit',COALESCE(json_extract(payload_json,'$.record.deposit'),json_extract(payload_json,'$.deposit')),
        'rent',COALESCE(json_extract(payload_json,'$.record.rent'),json_extract(payload_json,'$.record.monthly_rent'),json_extract(payload_json,'$.rent'),json_extract(payload_json,'$.monthly_rent')),
        'salePrice',COALESCE(json_extract(payload_json,'$.record.salePrice'),json_extract(payload_json,'$.record.sale_price'),json_extract(payload_json,'$.salePrice'),json_extract(payload_json,'$.sale_price'))) AS payload_json
      FROM collector_raw WHERE source=?1 AND source_listing_id IN (${params})
        AND processing_state IN ('review','awaiting_source_refresh','processed','duplicate') AND COALESCE(error_text,'')='' AND json_valid(payload_json)
      UNION ALL SELECT 'source',id,source,source_listing_id,trade_type,'','','{}',created_at,first_collected_at,'{}'
      FROM listing_sources WHERE source=?1 AND source_listing_id IN (${params})`).bind(source, ...chunk).all();
    evidence.push(...(result?.results || []));
  }
  const byKey = new Map();
  for (const row of evidence) {
    const key = advertisementObservationKey(row.source, row.source_listing_id, row.trade_type);
    if (!byKey.has(key)) byKey.set(key, { rawRows: [], sourceRows: [] });
    byKey.get(key)[row.evidence_kind === "raw" ? "rawRows" : "sourceRows"].push(row);
  }
  const result = new Map();
  for (const record of records) {
    const key = advertisementObservationKey(source, record.sourceId, record.tradeType);
    const rows = byKey.get(key) || { rawRows: [], sourceRows: [] };
    const existing = existingSources.get(record.sourceId);
    result.set(key, firstObservedAdvertisement({ source, sourceId: record.sourceId, tradeType: record.tradeType,
      rawRows: rows.rawRows, sourceRows: existing ? [...rows.sourceRows, existing] : rows.sourceRows, now }));
  }
  return result;
}
