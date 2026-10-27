// Read only explicit land fields from the same advertisement. In particular,
// advertised road access is not proof of legal frontage or buildability.
import { naverSaleMeasurements, saleMeasurements } from './sale-measurements.js';
const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
const present = value => text(value) && !/^(?:-|—|미확인|미제공|확인\s*필요)$/.test(text(value));
const LAND_USES = new Set(['전','답','과수원','목장용지','임야','광천지','염전','대','공장용지','학교용지','주차장','주유소용지','창고용지','도로','철도용지','제방','하천','구거','유지','양어장','수도용지','공원','체육용지','유원지','종교용지','사적지','묘지','잡종지']);
export function naverLandFields(raw = {}) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const spaces = [raw.saleRaw?.detailInfo?.spaceInfo, raw.saleRaw?.spaceInfo, raw.spaceInfo, raw];
  const articles = [raw.saleRaw?.detailInfo?.articleDetailInfo, raw.saleRaw?.articleDetailInfo, raw.articleDetailInfo, raw];
  const first = (objects, key) => objects.map(o => o?.[key]).find(present);
  const name = text(first(articles, 'articleName'));
  const road = spaces.map(o => o?.approachRoad).find(v => typeof v === 'boolean');
  const roadType = first(spaces, 'approachRoadType'); // bounded D1 json_type projection
  return Object.fromEntries(Object.entries({
    landUse: LAND_USES.has(name) ? name : '',
    zoning: text(first(spaces, 'areaUsage')),
    currentUse: text(first(spaces, 'currentPurpose')),
    recommendedUse: text(first(spaces, 'recommendedPurpose')),
    roadAccess: road === true || roadType === 'true' ? '진입도로 있음' : road === false || roadType === 'false' ? '진입도로 없음' : ''
  }).filter(([,value]) => value).concat(Object.entries(saleMeasurements({landAreaM2:
    naverSaleMeasurements(raw).landAreaM2 ?? raw.landAreaM2}))));
}
export function withNaverLandDisplay(original, raw = {}, source = original?.source) {
  if (source !== '네이버' || original?.tradeType !== 'sale' || original.saleCategory !== 'land') return original;
  const detail = original.saleDetails || {}, fields = naverLandFields(raw);
  const missing = Object.fromEntries(Object.entries(fields).filter(([key]) =>
    !detail.manualSaleFieldsV1?.includes(key) && (detail[key] == null || typeof detail[key] === 'string' && !present(detail[key]))));
  return Object.keys(missing).length ? {...original, saleDetails:{...detail,...missing}} : original;
}
