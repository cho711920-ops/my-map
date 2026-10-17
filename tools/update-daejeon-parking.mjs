// Read the portal's public download endpoint, then publish only Daejeon parking.
// No API keys, geocoding, listing writes or paid services are used.
import {writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function normalizeParking(rows) {
  const text = value => String(value ?? '').trim();
  const number = value => value !== null && text(value) !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const byId = new Map();
  let invalidCoordinates = 0;
  for (const row of rows) {
    if (!/^대전(?:광역시)?\s/.test(text(row.RDNMADR)) && !/^대전(?:광역시)?\s/.test(text(row.LNMADR))) continue;
    const lat = number(row.LATITUDE), lng = number(row.LONGITUDE);
    if (lat === null || lng === null || lat < 36.1 || lat > 36.65 || lng < 127.1 || lng > 127.7) { invalidCoordinates++; continue; }
    const id = text(row.PRKPLCE_NO), name = text(row.PRKPLCE_NM);
    if (!id || !name) continue;
    const capacity = number(row.PRKCMPRT);
    const item = {id, name, kind: ['공영', '민영'].includes(text(row.PRKPLCE_SE)) ? text(row.PRKPLCE_SE) : '미확인',
      type: text(row.PRKPLCE_TYPE), address: text(row.RDNMADR) || text(row.LNMADR), parcelAddress: text(row.LNMADR), lat, lng,
      capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : null,
      days: text(row.OPER_DAY), weekday: [text(row.WEEKDAY_OPER_OPEN_HHMM), text(row.WEEKDAY_OPER_COLSE_HHMM)],
      saturday: [text(row.SAT_OPER_OPER_OPEN_HHMM), text(row.SAT_OPER_CLOSE_HHMM)],
      holiday: [text(row.HOLIDAY_OPER_OPEN_HHMM), text(row.HOLIDAY_CLOSE_OPEN_HHMM)],
      charge: text(row.PARKINGCHRGE_INFO), basicMinutes: number(row.BASIC_TIME), basicFee: number(row.BASIC_CHARGE),
      extraMinutes: number(row.ADD_UNIT_TIME), extraFee: number(row.ADD_UNIT_CHARGE), dayFee: number(row.DAY_CMMTKT),
      monthFee: number(row.MONTH_CMMTKT), payment: text(row.METPAY), note: text(row.SPCMNT),
      operator: text(row.INSTITUTION_NM), phone: text(row.PHONE_NUMBER), referenceDate: text(row.REFERENCE_DATE)};
    const previous = byId.get(id);
    if (!previous || item.referenceDate > previous.referenceDate) byId.set(id, item);
  }
  return {items: [...byId.values()].sort((a,b) => a.id.localeCompare(b.id)), invalidCoordinates};
}

export async function updateParking() {
  const base = 'https://www.data.go.kr';
  async function get(url) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error('Public parking download HTTP ' + response.status);
        return await response.json();
      } catch (error) { last = error; }
    }
    throw last;
  }
  const header = await get(base + '/download/columList.json?pk=15012896&ext=JSON');
  const total = Number(header.totalCount), pageSize = 10000;
  if (!Number.isInteger(total) || total < 1 || total > 500000 || !Array.isArray(header.tableVO?.colNmList)) throw new Error('Unexpected parking download header');
  const rows = [];
  for (let page = 1; page <= Math.ceil(total / pageSize); page++) {
    const query = new URLSearchParams({publicDataPk: '15012896', totalCount: String(total), svcTableNm: header.tableVO.svcTableNm,
      perPage: String(pageSize), page: String(page)});
    header.tableVO.colNmList.forEach(column => query.append('colNmList', column));
    const result = await get(base + '/download/standard.json?' + query);
    if (!Array.isArray(result) || result.length !== Math.min(pageSize, total - rows.length)) throw new Error('Incomplete public parking download page ' + page);
    rows.push(...result);
  }
  const {items, invalidCoordinates} = normalizeParking(rows);
  const districts = ['동구','중구','서구','유성구','대덕구'];
  if (items.length < 50 || !districts.every(d => items.some(p => p.address.includes(' ' + d + ' ')))) throw new Error('Incomplete Daejeon parking coverage; existing snapshot preserved');
  const snapshot = {schemaVersion: 1, source: '전국주차장정보표준데이터 · 지방자치단체 제공',
    sourceUrl: base + '/data/15012896/standard.do', retrievedAt: new Date().toISOString(),
    coverage: '대전광역시 · 공개자료에 등록되고 좌표가 확인된 주차장. 전체 주차장이나 실시간 빈자리 정보가 아닙니다.',
    sourceRows: rows.length, invalidCoordinates, items};
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  await mkdir(resolve(root, 'data'), {recursive: true});
  await writeFile(resolve(root, 'data/daejeon-parking-v1.json'), JSON.stringify(snapshot) + '\n');
  console.log(JSON.stringify({sourceRows: rows.length, parking: items.length, invalidCoordinates,
    byDistrict: Object.fromEntries(districts.map(d => [d, items.filter(p => p.address.includes(' '+d+' ')).length])),
    byKind: Object.fromEntries(['공영','민영','미확인'].map(k => [k,items.filter(p => p.kind===k).length])),
    datedFrom: items.map(p=>p.referenceDate).sort()[0], datedTo: items.map(p=>p.referenceDate).sort().at(-1)}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await updateParking();
