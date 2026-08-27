// Private, versioned scratchpad. Never writes listing facts, user memos or status.
export async function saveSaleWorksheet(env, owner, recordKey, body) {
  const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), {statusCode}); };
  const expected = body.expectedVersion;
  const data = body.data;
  if (!owner || !recordKey || !Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER) fail('검토 저장 버전이 올바르지 않습니다.');
  if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 20000) fail('검토 자료가 올바르지 않습니다.');
  const assumptions = {};
  for (const key of ['price','deposit','income','loan','interest','vacancy','expense','acquisition']) {
    const value = data.assumptions?.[key];
    if (value == null || value === '') { assumptions[key] = ''; continue; }
    if (!['number','string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12 || (['interest','vacancy'].includes(key) && Number(value) > 100)) fail('계산 가정에 잘못된 값이 있습니다.');
    assumptions[key] = Number(value);
  }
  if (!Array.isArray(data.parcels) || data.parcels.length > 30) fail('필지는 최대 30개까지 저장할 수 있습니다.');
  const seen = new Set();
  const parcels = data.parcels.map(p => {
    const address = typeof p?.address === 'string' ? p.address.trim() : '';
    if (!address || address.length > 160 || !/(?:동|리|읍|면)\s*(?:산\s*)?\d+(?:-\d+)?$/.test(address) || typeof p.areaM2 !== 'number' || !Number.isFinite(p.areaM2) || p.areaM2 <= 0 || p.areaM2 > 1e12) fail('필지 주소와 면적을 확인하세요.');
    const id = address.replace(/\s/g,''); if (seen.has(id)) fail('같은 필지가 중복되었습니다.'); seen.add(id);
    return {address, areaM2:p.areaM2};
  });
  const now = new Date().toISOString();
  const text = (key, max) => typeof data[key] === 'string' ? data[key].slice(0,max) : '';
  const saved = {assumptions, parcels, note:text('note',2000), address:text('address',200), source:text('source',40), savedAt:now};
  const result = await env.DB.prepare(`INSERT INTO cloud_state(owner_email,scope,record_key,value_json,version,updated_at)
    SELECT ?1,'saleWorksheetV1',?2,?3,?4,?5 WHERE ?6=0 OR EXISTS(
      SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope='saleWorksheetV1' AND record_key=?2 AND version=?6)
    ON CONFLICT(owner_email,scope,record_key) DO UPDATE SET value_json=excluded.value_json,version=excluded.version,updated_at=excluded.updated_at
    WHERE cloud_state.version=?6`).bind(owner,recordKey,JSON.stringify(saved),expected+1,now,expected).run();
  if (Number(result.meta?.changes) !== 1) fail('다른 창에서 검토가 변경되었습니다. 창을 다시 열어 최신 자료를 확인하세요.',409);
  return {ok:true,persisted:true,queued:false,scope:'saleWorksheetV1',recordKey,version:expected+1,updatedAt:now,source:'D1'};
}
