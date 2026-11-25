// Read-only search for advertisements rejected before a master was created.
// Number-search cards never supply an unverified position to the map.
const providers = {naver:'네이버',daangn:'당근',gongsil:'공실박스'};
const text = value => typeof value === 'string' ? value.trim() : '';
const clean = value => text(value).replace(/0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}/g,'').slice(0,160);
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const number = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
function https(value, hosts = null) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!hosts || hosts.includes(url.hostname)) ? url.href : ''; } catch { return ''; }
}
export function heldListingProjectionV299(row, mode) {
  if (!['error','review'].includes(row.processing_state) || !/^(?:건물번호가 있는 지번·도로명주소 없음|정확한 지번주소 없음)$/.test(row.error_text)) return null;
  const record = parse(row.payload_json);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const raw = record.raw || {}, trade = record.tradeType || row.trade_type;
  const saleCategory = record.saleCategory || row.sale_category;
  const suffix = text(row.source_listing_id).match(/::(lease|sale)$/)?.[1];
  const payloadSuffix = text(record.sourceId).match(/::(lease|sale)$/)?.[1];
  if (!['lease','sale'].includes(trade) || row.trade_type && row.trade_type !== trade || suffix && suffix !== trade || payloadSuffix && payloadSuffix !== trade || record.saleCategory && row.sale_category && record.saleCategory !== row.sale_category) return null;
  if (mode === 'lease' ? trade !== 'lease' : trade !== 'sale' || !saleCategory || (mode === 'land_sale' ? saleCategory !== 'land' : saleCategory === 'land')) return null;
  if (row.source === '당근' && (raw.isHide === true || raw.status && !['ON_GOING','ACTIVE'].includes(raw.status))) return null;
  const provider = Object.keys(providers).find(key => providers[key] === row.source);
  const sourceNumber = text(row.source_listing_id).replace(/^네이버-/,'').replace(/::(?:lease|sale)$/,'');
  if (!provider || !/^\d{1,20}$/.test(sourceNumber)) return null;
  if (record.source && record.source !== row.source || text(record.sourceId).replace(/^네이버-/,'').replace(/::(?:lease|sale)$/,'') !== sourceNumber) return null;
  const link = provider === 'daangn' ? `https://realty.daangn.com/?article_id=%22${sourceNumber}%22&panel_stack=article`
    : provider === 'naver' ? `https://fin.land.naver.com/articles/${sourceNumber}`
      : https(record.link,['www.gongsilbox.com','gongsilbox.com']);
  const images = [...new Set((Array.isArray(record.images) ? record.images : []).map(value => https(value)).filter(Boolean))].slice(0,80);
  // Never expose hidden raw addresses, coordinates, contacts, descriptions, or
  // internal queue IDs through this lookup. The area is explicitly public.
  const publicArea = provider === 'daangn' ? clean(raw.publicAddress || raw.publicJibunAddress) : '';
  return {key:`held:${provider}:${sourceNumber}:${trade}`,provider,source:row.source,sourceNumber,
    name:clean(record.buildingName) || '주소 확인 전 매물',publicArea,room:clean(record.room),
    tradeType:trade,saleCategory:saleCategory || '',deposit:number(record.deposit),rent:number(record.rent),
    salePrice:number(record.salePrice),fee:number(record.fee),premium:number(record.premium),area:number(record.area),thumbnail:images[0] || '',images,photoCount:images.length,
    link,location:null,status:'address-unverified',reason:'정확한 주소 확인 전',checkedAt:row.checked_at || row.created_at};
}
export async function heldListingSearchV299(env, query) {
  const id = text(query.number), provider = text(query.provider), mode = text(query.mode) || 'lease';
  if (!/^\d{1,20}$/.test(id) || provider && !Object.hasOwn(providers,provider) || !['lease','building_sale','land_sale'].includes(mode)) {
    throw Object.assign(Error('원본 매물번호와 거래유형을 확인해 주세요.'),{statusCode:400});
  }
  const ids = [id,`네이버-${id}`].flatMap(value => [value,`${value}::lease`,`${value}::sale`]);
  const result = await env.DB.prepare(`WITH matches AS (
    SELECT c.*,ROW_NUMBER() OVER (PARTITION BY c.source,
      REPLACE(REPLACE(REPLACE(c.source_listing_id,'네이버-',''),'::lease',''),'::sale',''),
      COALESCE(NULLIF(c.trade_type,''),json_extract(CASE WHEN json_valid(c.payload_json) THEN c.payload_json ELSE '{}' END,'$.tradeType'),'lease')
      ORDER BY COALESCE(NULLIF(c.processed_at,''),c.created_at) DESC,c.id DESC) AS rank_v299
    FROM collector_raw c WHERE c.source IN ('네이버','당근','공실박스')
      AND (?1='' OR c.source=?1) AND c.source_listing_id IN (SELECT value FROM json_each(?2)))
    SELECT m.source,m.source_listing_id,m.trade_type,m.sale_category,m.payload_json,m.processing_state,m.error_text,m.created_at,
      COALESCE(NULLIF(m.processed_at,''),m.created_at) AS checked_at
    FROM matches m WHERE m.rank_v299=1 AND NOT EXISTS (
      SELECT 1 FROM listing_sources s WHERE s.source=m.source AND
      REPLACE(REPLACE(REPLACE(s.source_listing_id,'네이버-',''),'::lease',''),'::sale','')=
      REPLACE(REPLACE(REPLACE(m.source_listing_id,'네이버-',''),'::lease',''),'::sale',''))
    ORDER BY m.source LIMIT 6`).bind(providers[provider] || '',JSON.stringify(ids)).all();
  return {ok:true,action:'heldListingSearchV299',number:id,mode,
    items:(result.results || []).map(row => heldListingProjectionV299(row,mode)).filter(Boolean)};
}
