const API_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function listFrom(payload) {
  const body = payload?.body || payload?.response?.body || {};
  const items = body?.items?.item ?? body?.items ?? [];
  return Array.isArray(items) ? items : items && typeof items === "object" ? [items] : [];
}

async function fetchPage(env, lat, lng, radius, pageNo) {
  const key = clean(env.DATA_GO_KR_SERVICE_KEY);
  if (!key) throw new Error("서버 공공데이터 인증키가 연결되지 않았습니다.");
  const url = new URL(API_URL);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("cx", String(lng));
  url.searchParams.set("cy", String(lat));
  url.searchParams.set("type", "json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`상가정보 API HTTP ${response.status}`);
  const header = payload?.header || payload?.response?.header || {};
  const resultCode = clean(header.resultCode || header.resultCd);
  if (resultCode && !["00", "0", "NORMAL_SERVICE"].includes(resultCode)) {
    throw new Error(clean(header.resultMsg) || "상가정보 API 오류");
  }
  const body = payload?.body || payload?.response?.body || {};
  return { items: listFrom(payload), totalCount: Number(body.totalCount) || 0 };
}

async function fetchAll(env, lat, lng, radius) {
  const first = await fetchPage(env, lat, lng, radius, 1);
  const availablePages = Math.max(1, Math.ceil((first.totalCount || first.items.length) / 1000));
  const pageCount = Math.min(5, availablePages);
  const rest = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(env, lat, lng, radius, index + 2)))
    : [];
  return { items: first.items.concat(...rest.map((page) => page.items)), totalCount: first.totalCount,
    pagesFetched: pageCount, truncated: availablePages > pageCount };
}

function recordsFrom(items, context) {
  const seen = new Set();
  const records = [];
  for (const item of items || []) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = clean(item?.bizesId) || `${clean(item?.bizesNm)}|${lat.toFixed(6)}|${lng.toFixed(6)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    records.push({ id, name: clean(item?.bizesNm), large: clean(item?.indsLclsNm || item?.indsLclsCd) || "기타",
      medium: clean(item?.indsMclsNm || item?.indsMclsCd) || "기타",
      small: clean(item?.indsSclsNm || item?.indsSclsCd) || "기타",
      lat, lng, address: clean(item?.rdnmAdr || item?.lnoAdr),
      distance: distanceMeters(context.lat, context.lng, lat, lng) });
  }
  return records;
}

function categoryCounts(records, field, radius) {
  const counts = new Map();
  records.filter((row) => row.distance <= radius).forEach((row) => counts.set(row[field], (counts.get(row[field]) || 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ko"));
}

function diversityScore(rows, total) {
  if (!total || !rows.length) return 0;
  const concentration = rows.reduce((sum, row) => sum + (row.count / total) ** 2, 0);
  return Math.max(0, Math.min(100, Math.round((1 - concentration) * 125)));
}

function radiusSummary(records, radius) {
  const selected = records.filter((row) => row.distance <= radius);
  const largeCategories = categoryCounts(records, "large", radius);
  const mediumCategories = categoryCounts(records, "medium", radius);
  const smallCategories = categoryCounts(records, "small", radius);
  const hectares = Math.PI * radius * radius / 10_000;
  return { radius, totalCount: selected.length, densityPerHa: hectares ? Math.round(selected.length / hectares * 10) / 10 : 0,
    diversityScore: diversityScore(mediumCategories, selected.length), largeCategories, mediumCategories, smallCategories };
}

function categoryMetrics(records, field, limit) {
  const names = categoryCounts(records, field, 500).slice(0, limit).map((entry) => entry.name);
  return names.map((name) => {
    const rows = records.filter((record) => record[field] === name).sort((left, right) => left.distance - right.distance);
    const count100 = rows.filter((row) => row.distance <= 100).length;
    const count300 = rows.filter((row) => row.distance <= 300).length;
    const count500 = rows.filter((row) => row.distance <= 500).length;
    const total300 = Math.max(1, records.filter((row) => row.distance <= 300).length);
    return { name, count100, count300, count500, nearestDistance: rows.length ? rows[0].distance : null,
      share300: Math.round(count300 / total300 * 1000) / 10 };
  }).sort((left, right) => right.count300 - left.count300 || right.count500 - left.count500);
}

async function readCache(env, key) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT details_json FROM building_cache
    WHERE cache_key=?1 AND datetime(expires_at)>datetime('now')`).bind(key).first();
  try {
    const parsed = JSON.parse(row?.details_json || "null");
    return parsed?.ok ? { ...parsed, cached: true } : null;
  } catch {
    return null;
  }
}

async function writeCache(env, key, context, result) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO building_cache (cache_key, parcel_json, summary_json, details_json, checked_at, expires_at)
    VALUES (?1, ?2, '{}', ?3, ?4, datetime('now','+6 hours'))
    ON CONFLICT(cache_key) DO UPDATE SET details_json=excluded.details_json,
      checked_at=excluded.checked_at, expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify(context), JSON.stringify(result), new Date().toISOString()).run();
}

export async function getCommercialArea(env, query) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  const radius = Math.max(300, Math.min(500, Number(query.radius) || 500));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, action: "commercialArea", message: "매물 좌표가 올바르지 않습니다." };
  }
  const key = `commercial-v3-${lat.toFixed(4)}-${lng.toFixed(4)}-${radius}`;
  if (clean(query.force) !== "1") {
    const cached = await readCache(env, key);
    if (cached) return cached;
  }
  const fetched = await fetchAll(env, lat, lng, radius);
  const records = recordsFrom(fetched.items, { lat, lng });
  const radii = [100, 300, 500].filter((value) => value <= radius).map((value) => radiusSummary(records, value));
  const byRadius = Object.fromEntries(radii.map((row) => [row.radius, row]));
  const summary300 = byRadius[300] || radii[0] || radiusSummary([], 300);
  const summary500 = byRadius[500] || radii[radii.length - 1] || summary300;
  const count100 = byRadius[100]?.totalCount || 0;
  const result = {
    ok: true, action: "commercialArea", version: 3,
    source: "소상공인시장진흥공단 상가(상권)정보 API", sourceType: "official-open-api",
    propertyId: clean(query.propertyId), lat, lng, radius: 300, maxRadius: radius,
    totalCount: summary300.totalCount, returnedCount: records.length, sourceTotalCount: fetched.totalCount,
    pagesFetched: fetched.pagesFetched, truncated: Boolean(fetched.truncated || fetched.totalCount > records.length),
    radii,
    distanceBands: { within100: count100, from100To300: Math.max(0, summary300.totalCount - count100),
      from300To500: Math.max(0, summary500.totalCount - summary300.totalCount) },
    largeCategories: summary300.largeCategories, mediumCategories: summary300.mediumCategories,
    smallCategories: summary300.smallCategories,
    categoryMetrics: { large: categoryMetrics(records, "large", 30), medium: categoryMetrics(records, "medium", 80),
      small: categoryMetrics(records, "small", 120) },
    stores: records.filter((row) => row.distance <= radius).sort((left, right) => left.distance - right.distance).slice(0, 600),
    generatedAt: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date()),
    cached: false
  };
  await writeCache(env, key, { lat, lng, radius }, result);
  return result;
}
