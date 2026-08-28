// Advertised transaction fields only. TotBomoney/TotMmmoney and memo text are
// investment income, not proof that the property is also offered for lease.
const clean = (value) => String(value ?? "").trim();
export function gongsilAdvertisedOffers(list = {}, detail = {}) {
  // Kept identical in server and bookmarklet; covered by parity tests.
  const clean = value => String(value ?? "").trim();
  const amount = value => {
    if (value == null || clean(value) === "" || typeof value === "boolean") return null;
    const n = Number(clean(value).replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const first = (item, keys) => keys.map(key => amount(item?.[key])).find(n => n != null);
  const floor = detail?.floorinfo || {};
  const moneys = [floor.Moneys, floor.moneys, list.Moneys, list.moneys]
    .find(rows => Array.isArray(rows) && rows.length > 0);
  const label = clean(list.TradeType || list.tradeType || list.DealType).toLowerCase();
  const subtype = clean(floor.LndSubtype ?? list.Subtype ?? list.subtype)
    || ({ '매매': '1', sale: '1', buy: '1', '전세': '2', '월세': '3', lease: '3', '반전세': '9' })[label] || '';
  let salePrice, rental;
  if (moneys) {
    // Actual advertised rows win over stale numeric fields.
    const sale = moneys.find(m => /^(매매|sale|buy)$/i.test(clean(m?.Ty || m?.Type || m?.TradeType)));
    salePrice = first(sale, ["Price", "Ma", "Mae", "DealPrice", "Amount", "Bo"]);
    rental = moneys.filter(m => /^(월세|반전세)$/i.test(clean(m?.Ty || m?.Type || m?.TradeType)))
      .map(m => [amount(m.Bo), amount(m.Mm)])
      .find(([deposit, rent]) => deposit != null && rent > 0);
  } else {
    if (subtype && !/^[1239]+$/.test(subtype)) return [];
    // Subtype: 1=sale, 2=jeonse, 3=monthly, 9=semi-jeonse (13,31,39...).
    if (!subtype || subtype.includes("1")) {
      salePrice = ["Me", "SalePrice", "DealPrice", "SellPrice", "TradingPrice", "Ma", "Mae"]
        .map(key => amount(list[key])).find(n => n > 0);
    }
    const pairs = [];
    if (!subtype || subtype.includes("3")) pairs.push([
      first(list, ["Bo", "Deposit", "MmDeposit"]), first(list, ["Mm", "Monthly", "MmMonthly", "Rent"])
    ]);
    if (subtype.includes("9")) pairs.push([amount(list.Bjbo), amount(list.Bjmm)]);
    // Jun/Jmm alone is NOT evidence of a monthly advertisement.
    rental = pairs.find(([deposit, rent]) => deposit != null && rent > 0);
  }
  const offers = [];
  if (salePrice > 0) offers.push({ tradeType: "sale", salePrice, deposit: 0, rent: 0 });
  if (rental) offers.push({ tradeType: "lease", salePrice: null, deposit: rental[0], rent: rental[1] });
  return offers;
}

export function hasGongsilOfferEvidence(list = {}, detail = {}) {
  return Boolean(clean(detail?.floorinfo?.LndSubtype ?? list.Subtype ?? list.subtype))
    || /^(매매|sale|buy|전세|월세|lease|반전세)$/i.test(clean(list.TradeType || list.tradeType || list.DealType))
    || [detail?.floorinfo?.Moneys, detail?.floorinfo?.moneys, list.Moneys, list.moneys]
      .some(rows => Array.isArray(rows) && rows.length > 0);
}

export function gongsilProviderSourceId(value) {
  return clean(value).replace(/::(?:lease|sale)$/, "");
}

// Keep the original legacy row when it belongs to this market. Never move a
// user's existing source/listing to the opposite market on a later collection.
export function gongsilOfferSourceId(providerId, tradeType, savedTypes = new Map()) {
  const base = gongsilProviderSourceId(providerId);
  const qualified = `${base}::${tradeType === "sale" ? "sale" : "lease"}`;
  if (savedTypes.has(qualified)) return qualified;
  return savedTypes.get(base) === tradeType ? base : qualified;
}

export async function resolveGongsilOfferIds(env, records) {
  const bases = [...new Set(records.map((r) => gongsilProviderSourceId(r.sourceId)).filter(Boolean))];
  const savedTypes = new Map();
  for (let offset = 0; offset < bases.length; offset += 33) {
    const ids = bases.slice(offset, offset + 33).flatMap((id) => [id, `${id}::sale`, `${id}::lease`]);
    // At most 99 bindings, one indexed query per chunk. Do not download raw
    // payloads or query once per offer during a large manifest comparison.
    const rows = await env.DB.prepare(`WITH requested(id) AS (VALUES ${ids.map(() => "(?)").join(",")}),
      attached AS (SELECT source_listing_id, COALESCE(NULLIF(trade_type,''),'lease') AS trade_type
        FROM listing_sources WHERE source='공실박스' AND source_listing_id IN (SELECT id FROM requested)),
      pending AS (SELECT source_listing_id, COALESCE(NULLIF(trade_type,''),'lease') AS trade_type,
        ROW_NUMBER() OVER (PARTITION BY source_listing_id ORDER BY created_at DESC, id DESC) AS rn
        FROM collector_raw WHERE source='공실박스' AND processing_state <> 'error'
          AND source_listing_id IN (SELECT id FROM requested)
          AND source_listing_id NOT IN (SELECT source_listing_id FROM attached))
      SELECT source_listing_id, trade_type FROM attached
      UNION ALL SELECT source_listing_id, trade_type FROM pending WHERE rn=1`).bind(...ids).all();
    for (const row of rows.results || []) savedTypes.set(row.source_listing_id, row.trade_type);
  }
  return records.map((record) => ({ ...record,
    providerSourceId: gongsilProviderSourceId(record.sourceId),
    sourceId: gongsilOfferSourceId(record.sourceId, record.tradeType, savedTypes)
  }));
}
