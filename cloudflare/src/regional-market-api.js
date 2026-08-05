const SGIS_BASE = "https://sgisapi.mods.go.kr/OpenAPI3";
const RONE_BASE = "https://www.reb.or.kr/r-one/openapi";
const RONE_TABLES = {
  vacancy: "T241833134686576", rent: "T248223134698125",
  rentIndex: "T241273134677393", returnRate: "T246253134913401"
};
let sgisToken = { value: "", expiresAt: 0 };

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function getJson(base, params) {
  const url = new URL(base);
  Object.entries(params || {}).forEach(([name, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(name, String(value));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`공공데이터 응답 오류(HTTP ${response.status})`);
  return response.json().catch(() => { throw new Error("공공데이터 응답을 해석하지 못했습니다."); });
}

function firstResult(payload) {
  if (!payload || Number(payload.errCd) !== 0) return null;
  return Array.isArray(payload.result) ? payload.result[0] || null : payload.result || null;
}

async function accessToken(env) {
  if (sgisToken.value && Date.now() < sgisToken.expiresAt) return sgisToken.value;
  const id = clean(env.SGIS_SERVICE_ID);
  const secret = clean(env.SGIS_SERVICE_SECRET);
  if (!id || !secret) return "";
  const payload = await getJson(`${SGIS_BASE}/auth/authentication.json`, { consumer_key: id, consumer_secret: secret });
  const result = firstResult(payload);
  const value = clean(result?.accessToken);
  if (!value) throw new Error("SGIS 인증에 실패했습니다. Service ID/Secret을 확인해주세요.");
  const timeoutSeconds = Math.max(300, Math.min(21_000, Number(result?.accessTimeout) || 18_000));
  sgisToken = { value, expiresAt: Date.now() + (timeoutSeconds - 60) * 1000 };
  return value;
}

async function sgisContext(env, lat, lng) {
  if (!clean(env.SGIS_SERVICE_ID) || !clean(env.SGIS_SERVICE_SECRET)) {
    return { status: "setup_required", source: "SGIS", message: "SGIS 인증정보 연결이 필요합니다." };
  }
  try {
    const token = await accessToken(env);
    const location = firstResult(await getJson(`${SGIS_BASE}/addr/rgeocodewgs84.json`, {
      accessToken: token, x_coor: lng, y_coor: lat, addr_type: 20
    }));
    if (!location) throw new Error("SGIS에서 매물 행정동을 찾지 못했습니다.");
    const admCode = clean(location.adm_dr_cd) || [location.sido_cd, location.sgg_cd, location.emdong_cd].map(clean).join("");
    if (admCode.length < 7) throw new Error("SGIS 행정동 코드가 올바르지 않습니다.");
    let populationYear = "2024";
    let companyYear = "2024";
    try {
      const years = firstResult(await getJson(`${SGIS_BASE}/year/data.json`, { accessToken: token }));
      populationYear = clean(years?.lin_yr) || populationYear;
      companyYear = clean(years?.lcorp_yr) || companyYear;
    } catch {}
    const population = firstResult(await getJson(`${SGIS_BASE}/stats/population.json`, {
      accessToken: token, year: populationYear, adm_cd: admCode, low_search: 0
    }));
    if (!population) throw new Error("SGIS 배후수요 통계가 없는 행정동입니다.");
    let company = null;
    try {
      company = firstResult(await getJson(`${SGIS_BASE}/stats/company.json`, {
        accessToken: token, year: companyYear, adm_cd: admCode, low_search: 0
      }));
    } catch {}
    const residents = number(population.tot_ppltn);
    const employees = number(company?.tot_worker);
    const ratio = residents && employees != null ? Math.round(employees / residents * 1000) / 10 : null;
    let demandType = "혼합형 배후수요";
    let interpretation = "거주인구와 사업체 종사자 수를 함께 확인해야 하는 혼합형 지역입니다.";
    if (ratio != null && ratio >= 80) {
      demandType = "직장·업무 배후수요 우세";
      interpretation = "거주인구 대비 종사자 비중이 높아 평일 주간 수요를 우선 검토할 수 있습니다.";
    } else if (ratio != null && ratio <= 35) {
      demandType = "주거 배후수요 우세";
      interpretation = "거주인구 비중이 커 생활밀착형·저녁·주말 수요를 우선 검토할 수 있습니다.";
    }
    return { status: "ready", source: "SGIS", location: { fullAddress: clean(location.full_addr),
      sido: clean(location.sido_nm), sigungu: clean(location.sgg_nm), dong: clean(location.emdong_nm), admCode },
      populationYear, companyYear, residents, households: number(population.tot_family),
      averageAge: number(population.avg_age), averageHouseholdSize: number(population.avg_fmember_cnt),
      populationDensity: number(population.ppltn_dnsty), companies: number(company?.corp_cnt), employees,
      employeeResidentRatio: ratio, demandType, interpretation };
  } catch (error) {
    return { status: "error", source: "SGIS", message: clean(error?.message) || "SGIS 조회에 실패했습니다." };
  }
}

function quarterCandidates() {
  const date = new Date();
  let year = date.getUTCFullYear();
  let quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const result = [];
  for (let index = 0; index < 12; index += 1) {
    result.push(`${year}0${quarter}`);
    quarter -= 1;
    if (quarter < 1) { quarter = 4; year -= 1; }
  }
  return result;
}

function roneRows(payload) {
  for (const block of Array.isArray(payload?.SttsApiTblData) ? payload.SttsApiTblData : []) {
    if (Array.isArray(block?.row)) return block.row;
  }
  return [];
}

async function fetchRoneRows(tableId, period, key) {
  return roneRows(await getJson(`${RONE_BASE}/SttsApiTblData.do`, {
    KEY: key, Type: "json", pIndex: 1, pSize: 1000,
    STATBL_ID: tableId, DTACYCLE_CD: "QY", WRTTIME_IDTFR_ID: period
  }));
}

function compact(value) {
  return clean(value).replace(/[\s>\/·.,()_-]+/g, "");
}

function regionName(address) {
  return ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
    .find((name) => clean(address).includes(name)) || "";
}

function selectRow(rows, address, pattern) {
  const candidates = (rows || []).filter((row) => !pattern || pattern.test(clean(row.ITM_NM)));
  const nationwide = candidates.find((row) => clean(row.CLS_FULLNM || row.CLS_NM) === "전국") || null;
  const region = regionName(address);
  const addressKey = compact(address);
  const regional = candidates.filter((row) => {
    const name = clean(row.CLS_FULLNM || row.CLS_NM);
    return name !== "전국" && (!region || name.startsWith(region));
  });
  let exact = null;
  let score = -1;
  regional.forEach((row) => clean(row.CLS_FULLNM || row.CLS_NM).split(/[>\/]/).slice(1).forEach((segment) => {
    const key = compact(segment);
    if (key.length >= 2 && addressKey.includes(key) && key.length > score) { exact = row; score = key.length; }
  }));
  const broad = regional.find((row) => clean(row.CLS_FULLNM || row.CLS_NM) === region) || null;
  return { local: exact || broad, nationwide, exact: Boolean(exact) };
}

function metric(rows, address, name, pattern) {
  const selected = selectRow(rows, address, pattern);
  const basis = selected.local || selected.nationwide;
  if (!basis) return null;
  return { name, market: clean(basis.CLS_FULLNM || basis.CLS_NM), value: number(basis.DTA_VAL),
    unit: clean(basis.UI_NM), period: clean(basis.WRTTIME_DESC),
    nationwideValue: number(selected.nationwide?.DTA_VAL), nationwideUnit: clean(selected.nationwide?.UI_NM),
    exactMarketMatch: selected.exact };
}

async function roneContext(env, address) {
  const key = clean(env.RONE_API_KEY);
  if (!key) return { status: "setup_required", source: "한국부동산원 R-ONE", message: "R-ONE 인증키 연결이 필요합니다." };
  try {
    let period = "";
    let vacancy = [];
    for (const candidate of quarterCandidates()) {
      vacancy = await fetchRoneRows(RONE_TABLES.vacancy, candidate, key);
      if (vacancy.length) { period = candidate; break; }
    }
    if (!period) throw new Error("R-ONE 최신 분기 자료를 찾지 못했습니다.");
    const [rent, rentIndex, returnRate] = await Promise.all([
      fetchRoneRows(RONE_TABLES.rent, period, key),
      fetchRoneRows(RONE_TABLES.rentIndex, period, key),
      fetchRoneRows(RONE_TABLES.returnRate, period, key)
    ]);
    const metrics = [metric(vacancy, address, "공실률", /공실률/), metric(rent, address, "시장 임대료", /임대료/),
      metric(rentIndex, address, "임대가격지수", /지수/), metric(returnRate, address, "투자수익률", /투자수익률|소득수익률/)].filter(Boolean);
    if (!metrics.length) throw new Error("매물 지역과 비교할 R-ONE 시장지표가 없습니다.");
    return { status: "ready", source: "한국부동산원 R-ONE", propertyType: "소규모 상가",
      period: metrics[0].period || period, metrics,
      note: "R-ONE 지표는 개별 매물의 확정 임대가가 아니라 해당 조사시장·건물유형의 비교 기준입니다." };
  } catch (error) {
    return { status: "error", source: "한국부동산원 R-ONE", message: clean(error?.message) || "R-ONE 조회에 실패했습니다." };
  }
}

async function readCache(env, key) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT details_json FROM building_cache
    WHERE cache_key=?1 AND datetime(expires_at)>datetime('now')`).bind(key).first();
  try {
    const parsed = JSON.parse(row?.details_json || "null");
    return parsed?.ok ? { ...parsed, cached: true } : null;
  } catch { return null; }
}

async function writeCache(env, key, result) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO building_cache (cache_key, parcel_json, summary_json, details_json, checked_at, expires_at)
    VALUES (?1, '{}', '{}', ?2, ?3, datetime('now','+6 hours'))
    ON CONFLICT(cache_key) DO UPDATE SET details_json=excluded.details_json,
      checked_at=excluded.checked_at, expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify(result), new Date().toISOString()).run();
}

export async function getRegionalMarket(env, query) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("지역 분석에 필요한 매물 좌표가 없습니다.");
  const key = `regional-market-v1-${lat.toFixed(4)}-${lng.toFixed(4)}`;
  if (clean(query.force) !== "1") {
    const cached = await readCache(env, key);
    if (cached) return cached;
  }
  const sgis = await sgisContext(env, lat, lng);
  const address = clean(sgis?.location?.fullAddress) || clean(query.address);
  const rone = await roneContext(env, address);
  const result = { ok: true, action: "regionalMarket", version: 1, propertyId: clean(query.propertyId),
    address, sgis, rone,
    generatedAt: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date()),
    cached: false };
  await writeCache(env, key, result);
  return result;
}
