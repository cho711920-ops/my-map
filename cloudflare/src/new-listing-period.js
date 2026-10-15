// The fast Today read does not load the complete CSV or complete source cache.
// Timestamped collector dates are UTC; legacy dates without an offset are KST.
import { publicMasterSourcesWhereSql } from './source-availability.js';
import { hashSourceSnapshotRows, sourceSnapshotProofSql } from './source-snapshot-proof.js';
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
const SOURCE_REGISTRATION_DAY_SQL = REGISTRATION_DAY_SQL.replaceAll('first_collected_at', 'today_source.first_collected_at');
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
  // Only retry the page whose actual parent/source proof changed. A collector
  // updating another building must not invalidate every previously read page.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await readNewListingPeriodPage(env, query, loadOriginals, now);
    if (result.ok !== false || !result.snapshotChanged) return {
      ...result, snapshotConsistency: 'per-property-v1',
      unified: { ...result.unified, snapshotConsistency: 'per-property-v1' }
    };
    if (attempt === 2) return { ...result, retryScope: 'page', snapshotConsistency: 'per-property-v1' };
  }
}

async function readNewListingPeriodPage(env, query, loadOriginals, now) {
  if (String(query.days ?? '1') !== '1') throw badRequest('오늘 신규매물 조회는 1일 범위만 지원합니다.');
  const market = String(query.market || 'lease');
  if (!['lease', 'building', 'land'].includes(market)) throw badRequest('조회할 거래유형을 확인해 주세요.');
  const cursor = decodeCursor(query.cursor, market, koreanCalendarDay(now));
  const tradeType = market === 'lease' ? 'lease' : 'sale';
  const saleClause = market === 'lease' ? '' : market === 'land'
    ? "AND sale_category='land'" : "AND COALESCE(sale_category,'')<>'land'";
  const result = await env.DB.prepare(`WITH today_parents AS (
      SELECT listing_id AS id FROM listing_sources today_source
      WHERE today_source.active=1 AND today_source.trade_type=?2 AND (${SOURCE_REGISTRATION_DAY_SQL})=?1
      UNION SELECT id FROM listings WHERE (${REGISTRATION_DAY_SQL})=?1 AND trade_type=?2 AND status<>'deleted'
        AND NOT EXISTS (SELECT 1 FROM listing_sources stored WHERE stored.listing_id=listings.id)
    ) SELECT ${COLUMNS}, ${sourceSnapshotProofSql()} AS source_snapshot_proof,
      (SELECT json_group_array(today_source.id) FROM listing_sources today_source
        WHERE today_source.listing_id=listings.id AND today_source.active=1 AND today_source.trade_type=?2
          AND (${SOURCE_REGISTRATION_DAY_SQL})=?1) AS today_original_ids_json FROM listings
    WHERE id IN (SELECT id FROM today_parents) AND trade_type=?2 AND id>?3
      AND status<>'deleted' ${saleClause}
      AND ${publicMasterSourcesWhereSql("listings")}
      AND NOT EXISTS (SELECT 1 FROM listing_data_quality_holds quality_hold
        WHERE quality_hold.listing_id=listings.id AND quality_hold.state='open' AND quality_hold.blocks_publication=1)
    ORDER BY id LIMIT ?4`).bind(cursor.day, tradeType, cursor.id, PAGE_SIZE + 1).all();
  const rows = result?.results || [];
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE).map(row => ({ ...row, property_id: row.property_id || row.id }));
  await hashSourceSnapshotRows(items);
  const unified = await loadOriginals(items.map(row => row.id));
  // Source groups use parent PKs. Public cards use property_id, which can differ
  // on imported legacy records. Explicit empty groups clear old source metadata.
  const groups = {}, sourceSearchIds = {}, sourceSnapshotKeys = {}, sourceSnapshotPropertyIds = {}, todayOriginalIds = {};
  let todayAdCount = 0, todayManualCount = 0;
  for (const row of items) {
    const id = row.id, publicId = row.property_id;
    if (!row.source_snapshot_key || row.source_snapshot_key !== unified.sourceSnapshotKeys?.[id] ||
        unified.sourceSnapshotPropertyIds?.[id] !== publicId || !Array.isArray(unified.groups?.[id]) ||
        Object.hasOwn(groups, publicId)) {
      return { ok: false, snapshotChanged: true, message: '수집 결과가 바뀌어 오늘 신규광고를 다시 확인합니다.' };
    }
    const ids = JSON.parse(row.today_original_ids_json || '[]');
    const originalIdIndex = unified.fields?.indexOf('originalId');
    const activeIndex = unified.fields?.indexOf('active');
    const compact = /^compact-v\d+$/.test(unified.format || '');
    if (!Array.isArray(ids) || ids.some(sourceId => typeof sourceId !== 'string' || !sourceId ||
        !unified.groups[id].some(original => compact
          ? originalIdIndex >= 0 && original[originalIdIndex] === sourceId && Number(original[activeIndex]) === 1
          : original.originalId === sourceId && Number(original.active) === 1))) {
      return { ok: false, snapshotChanged: true, message: '오늘 신규광고의 원본 연결을 다시 확인합니다.' };
    }
    if (!compact && unified.groups[id].some(original => original.propertyId && original.propertyId !== id && original.propertyId !== publicId)) {
      return { ok: false, snapshotChanged: true, message: '오늘 신규광고의 매물 연결을 다시 확인합니다.' };
    }
    groups[publicId] = compact ? unified.groups[id] : unified.groups[id].map(original => ({ ...original, propertyId: publicId }));
    sourceSearchIds[publicId] = unified.sourceSearchIds?.[id] || [];
    sourceSnapshotKeys[publicId] = row.source_snapshot_key;
    sourceSnapshotPropertyIds[publicId] = publicId;
    todayOriginalIds[publicId] = ids;
    todayAdCount += ids.length;
    if (!ids.length) todayManualCount += 1;
    delete row.today_original_ids_json;
  }
  const end = new Date(cursor.day + 'T00:00:00+09:00');
  const rangeStart = end.toISOString();
  end.setTime(end.getTime() + 86400000);
  const nextCursor = hasMore ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ v: 1, day: cursor.day, market, id: items.at(-1).id }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
  return { ok: true, action: 'newListingPeriod', days: 1, market, day: cursor.day,
    serverNow: now.toISOString(), rangeStart, rangeEnd: end.toISOString(), items, hasMore, nextCursor,
    todayOriginalIds, todayAdCount, todayManualCount,
    unified: { ...unified, groups, sourceSearchIds, sourceSnapshotKeys, sourceSnapshotPropertyIds }, source: 'D1' };
}
