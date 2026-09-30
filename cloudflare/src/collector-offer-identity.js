const clean = (value) => String(value ?? "").trim();
const market = (value) => {
  const type = clean(value);
  if (!type) return "lease";
  if (type === "sale" || type === "lease") return type;
  throw new Error("수집 원본 거래유형을 확인해 주세요.");
};

// The provider's article ID is used in original links and detail requests. The
// qualified ID belongs only to our storage and must never leak to the provider.
export function collectorProviderSourceId(value) {
  return clean(value).replace(/::(?:lease|sale)$/, "");
}

// Keep a legacy, unqualified source in its existing market. New opposite-market
// offers receive their own identity instead of moving that source/listing.
export function collectorOfferSourceId(providerId, tradeType, savedTypes = new Map()) {
  const base = collectorProviderSourceId(providerId);
  if (!base) return "";
  const type = market(tradeType);
  const qualified = `${base}::${type}`;
  if (savedTypes.has(qualified)) {
    // A corrupt qualified identity must not silently steal an opposite-market
    // listing. Let the caller report the inconsistency rather than overwrite it.
    if (market(savedTypes.get(qualified)) !== type) {
      throw new Error(`수집 원본 거래유형 충돌: ${qualified}`);
    }
    return qualified;
  }
  return savedTypes.has(base) && market(savedTypes.get(base)) === type ? base : qualified;
}

// Shared by manifest comparison, import and finalization. It is read-only: no
// existing source, favorite, listing state or pending record is migrated here.
export async function resolveCollectorOfferIds(env, source, records) {
  const sourceName = clean(source);
  if (!sourceName) throw new Error("수집 원본 출처가 필요합니다.");
  const bases = [...new Set(records.map((record) => collectorProviderSourceId(record.sourceId)).filter(Boolean))];
  const savedTypes = new Map();
  for (let offset = 0; offset < bases.length; offset += 32) {
    const ids = bases.slice(offset, offset + 32).flatMap((id) => [id, `${id}::sale`, `${id}::lease`]);
    // 96 IDs + one provider binding at most; no per-offer or raw-payload fetch.
    const rows = await env.DB.prepare(`WITH provider(name) AS (VALUES (?)),
      requested(id) AS (VALUES ${ids.map(() => "(?)").join(",")}),
      attached AS (SELECT s.source_listing_id,
          COALESCE(NULLIF(l.trade_type,''), NULLIF(s.trade_type,''),'lease') AS trade_type
        FROM listing_sources s LEFT JOIN listings l ON l.id=s.listing_id
        WHERE s.source=(SELECT name FROM provider)
          AND s.source_listing_id IN (SELECT id FROM requested)),
      pending AS (SELECT source_listing_id, COALESCE(NULLIF(trade_type,''),'lease') AS trade_type,
          ROW_NUMBER() OVER (PARTITION BY source_listing_id ORDER BY created_at DESC, id DESC) AS rn
        FROM collector_raw WHERE source=(SELECT name FROM provider) AND processing_state <> 'error'
          AND source_listing_id IN (SELECT id FROM requested)
          AND source_listing_id NOT IN (SELECT source_listing_id FROM attached))
      SELECT source_listing_id, trade_type FROM attached
      UNION ALL SELECT source_listing_id, trade_type FROM pending WHERE rn=1`).bind(sourceName, ...ids).all();
    for (const row of rows.results || []) savedTypes.set(row.source_listing_id, row.trade_type);
  }
  return records.map((record) => ({
    ...record,
    providerSourceId: collectorProviderSourceId(record.sourceId),
    sourceId: collectorOfferSourceId(record.sourceId, record.tradeType, savedTypes)
  }));
}
