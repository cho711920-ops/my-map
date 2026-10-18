// On-demand public reference data. Never updates listings or advertisement state.
import { parseXmlRows } from './public-data-xml.js';

const sources = {
  land: ['RTMSDataSvcLandTrade', '15126466', '토지'],
  commercial: ['RTMSDataSvcNrgTrade', '15126463', '상업·업무용']
};
const pending = new WeakMap();
const text = value => String(value ?? '').trim();
const number = value => {
  if (value == null || typeof value === 'boolean' || !text(value)) return null;
  const n = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
function tag(xml, name) { return text(xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'))?.[1]); }

export function transactionQuery(query, now = new Date()) {
  const kind = text(query.kind), district = text(query.district), month = text(query.month);
  const thisMonth = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 7).replace('-', '');
  if (!sources[kind] || !/^[1-9]\d{4}$/.test(district) || !/^(20\d{2})(0[1-9]|1[0-2])$/.test(month) || month < '200601' || month > thisMonth)
    throw Object.assign(new Error('조회할 거래 유형·시군구·계약월을 확인해 주세요.'), {statusCode: 400});
  return {kind, district, month};
}

export function parseTransactions(xml, kind, district, month) {
  const code = tag(xml, 'resultCode');
  if (!['00', '000', '0000'].includes(code)) {
    const denied = /SERVICE|ACCESS|KEY|PERMISSION|인증|승인/i.test(tag(xml, 'resultMsg') + tag(xml, 'returnAuthMsg')) || ['20','30','31'].includes(code);
    throw Object.assign(new Error(denied ? '실거래 자료 이용 승인이 필요합니다. 공식 실거래가 사이트에서 확인해 주세요.' : '실거래 제공기관의 응답을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.'), {statusCode: 502, publicCode: denied ? 'approval_required' : 'upstream_unavailable'});
  }
  const rows = parseXmlRows(xml), records = [];
  for (const row of rows) {
    if (text(row.cdealDay) && text(row.cdealDay) !== '-') continue;
    if (!['', '-', 'N', '0', '정상'].includes(text(row.cdealType).toUpperCase())) continue;
    if (!['', '-', '전체', '전체거래'].includes(text(row.shareDealingType))) continue;
    if (text(row.sggCd) !== district) continue;
    const date = [text(row.dealYear), text(row.dealMonth).padStart(2,'0'), text(row.dealDay).padStart(2,'0')].join('-');
    const dateValue = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+dateValue) || dateValue.toISOString().slice(0,10) !== date || date.slice(0,7).replace('-','') !== month) continue;
    const amount = number(row.dealAmount);
    if (!amount || !text(row.umdNm)) continue;
    records.push({date, district: text(row.sggNm).slice(0,60), town: text(row.umdNm).slice(0,60),
      lot: text(row.jibun).slice(0,40), amount, landUse: text(row.jimok).slice(0,40), zoning: text(row.landUse).slice(0,120),
      buildingUse: text(row.buildingUse).slice(0,100), buildingType: text(row.buildingType).slice(0,30),
      landAreaM2: number(kind === 'land' ? row.dealArea : row.plottageAr), buildingAreaM2: kind === 'land' ? null : number(row.buildingAr),
      method: text(row.dealingGbn).slice(0,40)});
  }
  const totalCount = Number(tag(xml, 'totalCount'));
  if (!Number.isInteger(totalCount) || totalCount < 0 || totalCount < rows.length)
    throw Object.assign(new Error('실거래 자료의 총건수를 검증하지 못했습니다.'), {statusCode: 502, publicCode: 'upstream_unavailable'});
  return {records, rawCount: rows.length, totalCount, pageNo: Number(tag(xml, 'pageNo'))};
}

async function load(env, query) {
  const {kind, district, month} = query, source = sources[kind];
  const cacheKey = `sale-reference-transactions-v1/${kind}/${district}/${month}.json`;
  if (env.MEDIA) {
    try {
      const object = await env.MEDIA.get(cacheKey), cached = object && await object.json();
      const age = Date.now() - Date.parse(cached?.fetchedAt || '');
      if (cached?.ok && cached.complete && age >= 0 && age < 6 * 3600000) return {...cached, cached: true};
    } catch (_) {}
  }
  let key = text(env.MOLIT_TRADE_SERVICE_KEY || env.DATA_GO_KR_SERVICE_KEY);
  if (!key) return {ok: false, code: 'approval_required', message: '실거래 자료 연결이 준비되지 않았습니다. 공식 실거래가 사이트에서 확인해 주세요.'};
  try { key = decodeURIComponent(key); } catch (_) {}
  const records = []; let rawCount = 0, totalCount = null, page = 1;
  do {
    const url = new URL(`https://apis.data.go.kr/1613000/${source[0]}/get${source[0]}`);
    url.search = new URLSearchParams({serviceKey: key, LAWD_CD: district, DEAL_YMD: month, numOfRows: '1000', pageNo: String(page)});
    let response, xml;
    try {
      response = await fetch(url, {signal: AbortSignal.timeout(10000), redirect: 'error'});
      if (!response.ok) throw Error('upstream');
      xml = await response.text();
      if (xml.length > 6000000) throw Error('oversize');
    } catch (_) { throw Object.assign(new Error('실거래 제공기관에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.'), {statusCode: 502, publicCode: 'upstream_unavailable'}); }
    const parsed = parseTransactions(xml, kind, district, month);
    if (parsed.pageNo !== page && (page > 1 || parsed.pageNo)) throw Object.assign(new Error('실거래 자료의 페이지를 검증하지 못했습니다.'), {publicCode: 'upstream_unavailable'});
    if (totalCount != null && parsed.totalCount !== totalCount) throw Object.assign(new Error('조회 중 실거래 자료가 변경되었습니다. 다시 조회해 주세요.'), {publicCode: 'snapshot_changed'});
    totalCount = parsed.totalCount; rawCount += parsed.rawCount; records.push(...parsed.records);
    if (!parsed.rawCount) break;
    page++;
  } while (rawCount < totalCount && page <= 4);
  const result = {ok: true, action: 'saleTransactions', ...query, records, rawCount, totalCount,
    complete: rawCount === totalCount, fetchedAt: new Date().toISOString(), cached: false,
    source: '국토교통부 ' + source[2] + ' 매매 실거래가', sourcePage: `https://www.data.go.kr/data/${source[1]}/openapi.do`};
  if (result.complete && env.MEDIA) { try { await env.MEDIA.put(cacheKey, JSON.stringify(result), {httpMetadata: {contentType: 'application/json'}}); } catch (_) {} }
  return result;
}

export async function getSaleTransactions(env, incoming) {
  const query = transactionQuery(incoming);
  let requests = pending.get(env); if (!requests) { requests = new Map(); pending.set(env, requests); }
  const key = [query.kind, query.district, query.month].join(':');
  if (requests.has(key)) return requests.get(key);
  if (requests.size >= 8) return {ok: false, code: 'busy', message: '다른 실거래 자료를 조회 중입니다. 잠시 후 다시 눌러 주세요.'};
  const request = load(env, query).catch(error => ({ok: false, code: error.publicCode || 'upstream_unavailable', message: error.publicCode ? error.message : '실거래 자료를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.'})).finally(() => requests.delete(key));
  requests.set(key, request); return request;
}
