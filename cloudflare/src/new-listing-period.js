// The fast Today read does not load the complete CSV or complete source cache.
// Timestamped collector dates are UTC; legacy dates without an offset are KST.
import { publicMasterSourcesWhereSql } from './source-availability.js';
export const REGISTRATION_DAY_SQL = `CASE
  WHEN substr(trim(first_collected_at), -1) IN ('Z','z')
    OR (length(trim(first_collected_at))>=25 AND substr(trim(first_collected_at), -6, 1) IN ('+','-'))
    THEN date(first_collected_at, '+9 hours')
  WHEN substr(trim(first_collected_at), 3, 1) IN ('-','.','/')
    THEN date('20' || replace(replace(substr(trim(first_collected_at), 1, 8), '.', '-'), '/', '-'))
  ELSE date(replace(replace(substr(trim(first_collected_at), 1, 10), '.', '-'), '/', '-')) END`;

const COLUMNS = `id, title, address, room, listing_type, deposit, monthly_rent, maintenance_fee, premium, area_m2,
  landlord_phone, tenant_phone, operating_memo, status, first_collected_at, main_source,
  property_id, source_url, contacts_json, building_year, building_elevators,
  building_approval_date, building_info_checked_at, building_info_status, registration_at,
  last_collected_at, latitude, longitude, building_elevator_capacity,
  trade_type, sale_category, sale_price, sale_details_json`;
const PAGE_SIZE = 75;
const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });

export function koreanCalendarDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return false;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function decodeCursor(value, market, today) {
  if (!value) return { day: today, id: '' };
  try {
    if (typeof value !== 'string' || value.length > 600 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const age = (Date.parse(today + 'T00:00:00Z') - Date.parse(parsed.day + 'T00:00:00Z')) / 86400000;
    if (parsed.v !== 1 || parsed.market !== market || !validDay(parsed.day) || (age !== 0 && age !== 1) ||
        typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 100) throw new Error();
    return { day: parsed.day, id: parsed.id };
  } catch { throw badRequest('오늘 신규매물 조회 위치가 올바르지 않습니다. 다시 조회해 주세요.'); }
}

export async function newListingPeriod(env, query, loadOriginals, now = new Date()) {
  if (String(query.days ?? '1') !== '1') throw badRequest('오늘 신규매물 조회는 1일 범위만 지원합니다.');
  const market = String(query.market || 'lease');
  if (!['lease', 'building', 'land'].includes(market)) throw badRequest('조회할 거래유형을 확인해 주세요.');
  const cursor = decodeCursor(query.cursor, market, koreanCalendarDay(now));
  const tradeType = market === 'lease' ? 'lease' : 'sale';
  const saleClause = market === 'lease' ? '' : market === 'land'
    ? "AND sale_category='land'" : "AND COALESCE(sale_category,'')<>'land'";
  const result = await env.DB.prepare(`SELECT ${COLUMNS} FROM listings
    WHERE (${REGISTRATION_DAY_SQL})=?1 AND trade_type=?2 AND id>?3
      AND status<>'deleted' ${saleClause}
      AND ${publicMasterSourcesWhereSql("listings")}
      AND NOT EXISTS (SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id=listings.id AND quality_hold.state='open' AND quality_hold.blocks_publication=1)
    ORDER BY id LIMIT ?4`).bind(cursor.day, tradeType, cursor.id, PAGE_SIZE + 1).all();
  const rows = result?.results || [];
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE).map(row => ({ ...row, property_id: row.property_id || row.id }));
  const unified = await loadOriginals(items.map(row => row.id));
  // Source groups use parent PKs. Public cards use property_id, which can differ
  // on imported legacy records. Explicit empty groups clear old source metadata.
  const groups = {}, sourceSearchIds = {};
  for (const row of items) {
    groups[row.property_id] = unified.groups?.[row.id] || unified.groups?.[row.property_id] || [];
    sourceSearchIds[row.property_id] = unified.sourceSearchIds?.[row.id] || [];
  }
  const end = new Date(cursor.day + 'T00:00:00+09:00');
  const rangeStart = end.toISOString();
  end.setTime(end.getTime() + 86400000);
  const nextCursor = hasMore ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ v: 1, day: cursor.day, market, id: items.at(-1).id }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
  return { ok: true, action: 'newListingPeriod', days: 1, market, day: cursor.day,
    serverNow: now.toISOString(), rangeStart, rangeEnd: end.toISOString(), items, hasMore, nextCursor,
    unified: { ...unified, groups, sourceSearchIds }, source: 'D1' };
}
