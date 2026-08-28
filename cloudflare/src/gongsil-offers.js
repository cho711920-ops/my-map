// Advertised transaction fields only. TotBomoney/TotMmmoney and memo text are
// investment income, not proof that the property is also offered for lease.
const clean = (value) => String(value ?? "").trim();
const amount = (value) => {
  if (value == null || clean(value) === "" || typeof value === "boolean") return null;
  const result = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(result) && result >= 0 ? result : null;
};
const first = (item, keys) => keys.map((key) => amount(item?.[key])).find((n) => n != null);

export function gongsilAdvertisedOffers(list = {}) {
  const moneys = Array.isArray(list.Moneys || list.moneys) ? list.Moneys || list.moneys : [];
  const saleMoney = moneys.find((m) => /^(매매|sale|buy)$/i.test(clean(m?.Ty || m?.Type || m?.TradeType)));
  const salePrice = ["Me", "SalePrice", "DealPrice", "SellPrice", "TradingPrice", "Ma", "Mae"]
    .map((key) => amount(list[key])).find((n) => n > 0)
    || first(saleMoney, ["Price", "Ma", "Mae", "DealPrice", "Amount", "Bo"]);
  const pairs = [
    [first(list, ["Bo", "Deposit", "MmDeposit"]), first(list, ["Mm", "Monthly", "MmMonthly", "Rent"])],
    [first(list, ["Jun", "JeonseDeposit"]), first(list, ["Jmm", "JeonseMonthly"])],
    ...moneys.filter((m) => /^(월세|반전세|전세)$/i.test(clean(m?.Ty || m?.Type || m?.TradeType)))
      .map((m) => [amount(m.Bo), amount(m.Mm)])
  ];
  const rental = pairs.find(([deposit, rent]) => deposit != null && rent > 0);
  const offers = [];
  if (salePrice > 0) offers.push({ tradeType: "sale", salePrice, deposit: 0, rent: 0 });
  if (rental) offers.push({ tradeType: "lease", salePrice: null, deposit: rental[0], rent: rental[1] });
  return offers;
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
