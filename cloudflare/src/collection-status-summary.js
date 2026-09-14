// One vocabulary for the D1 session report and the web operations screen.
const DISTRICTS = ["유성구", "대덕구", "중구", "서구", "동구"];
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const own = (value, key) => value && Object.prototype.hasOwnProperty.call(value, key) && value[key] != null;
export function normalizeCollectionCounts(value = {}) {
  const foundKey = ["observed", "manifestCount", "found", "manifest"].find(key => own(value, key));
  const addressDeferred = count(value.addressMissing ?? value.addressDeferred);
  const legacyFailed = count(value.legacyFailed ?? value.failed);
  const failed = own(value, "failureCount") ? count(value.failureCount) : Math.max(0, legacyFailed - Math.min(legacyFailed, addressDeferred));
  const excluded = Math.max(0, count(value.requiredFieldRejected) - addressDeferred);
  return { ...value, found: foundKey ? count(value[foundKey]) : null, foundKnown: Boolean(foundKey),
    created: count(value.created), merged: count(value.merged), updated: count(value.updated),
    unchanged: count(value.unchanged ?? value.skippedUnchanged), duplicate: count(value.duplicate),
    review: count(value.review), legacyFailed, failed, failureCount: failed,
    addressDeferred, requiredFieldExcluded: excluded,
    completionIssues: [...new Set((Array.isArray(value.completionIssues) ? value.completionIssues : [])
      .filter(issue => !/^실패 \d+건$|^주소·층 오류 \d+건$/.test(String(issue)))
      .concat(addressDeferred ? [`정확한 주소 미제공 · 지도 등록 보류 ${addressDeferred}건`] : [],
        failed ? [`조회·저장 실패 ${failed}건`] : []))] };
}
export function koreanCollectionDate(value = Date.now()) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : "";
}
export function collectionDateRange(date) {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : koreanCollectionDate();
  const start = new Date(`${selected}T00:00:00+09:00`);
  if (!Number.isFinite(start.getTime()) || koreanCollectionDate(start) !== selected) throw Object.assign(new Error("올바른 조회 날짜를 선택해 주세요."), {statusCode: 400});
  return { date: selected, start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString(),
    baselineStart: new Date(start.getTime() - 14 * 86400000).toISOString() };
}
export function collectionScopeKey(row) {
  const scope = String(row.scope || "");
  const district = DISTRICTS.find(name => scope.includes(name));
  // Selected viewport/cluster runs must not replace a full-district census.
  const fullDistrict = district && /전체|완전수집/.test(scope);
  return `${row.source}|${row.tradeType === "sale" ? "sale" : "lease"}|${fullDistrict ? district : scope || "범위 미기록"}`;
}
export function summarizeCollectionDay(rows, date, { source = "", tradeType = "" } = {}) {
  const selected = new Map();
  const prior = new Map();
  const matches = row => (!source || row.source === source) && (!tradeType || (row.tradeType || "lease") === tradeType);
  for (const raw of rows) {
    const row = normalizeCollectionCounts(raw);
    if (!matches(row)) continue;
    const day = koreanCollectionDate(row.startedAt || row.endedAt);
    const key = collectionScopeKey(row);
    if (day === date) {
      const existing = selected.get(key);
      // Stable latest-session policy avoids adding checkpoint/retry snapshots.
      if (!existing || `${row.startedAt || ""}|${row.endedAt || ""}|${row.sessionId}` > `${existing.startedAt || ""}|${existing.endedAt || ""}|${existing.sessionId}`) selected.set(key, row);
    } else if (day < date && row.complete && row.foundKnown && row.found > 0) {
      const baseline = prior.get(key) || [];
      if (!baseline.some(item => item.day === day)) baseline.push({ day, found: row.found });
      prior.set(key, baseline);
    }
  }
  const items = [...selected.entries()].map(([key, row]) => {
    const values = (prior.get(key) || []).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 7).map(item => item.found).sort((a, b) => a - b);
    const baseline = values.length >= 3 ? values[Math.floor(values.length / 2)] : null;
    const dropWarning = row.complete && row.foundKnown && baseline >= 100 && row.found < baseline * 0.6;
    return { ...row, scopeKey: key, baseline, dropWarning,
      anomaly: dropWarning ? `최근 정상수집 중앙값 ${baseline.toLocaleString("ko-KR")}건 대비 크게 감소했습니다. 실제 감소/수집 범위를 확인해 주세요.` : "" };
  });
  const totals = { scopes: items.length, complete: 0, found: 0, unknownFound: 0, created: 0, merged: 0, updated: 0,
    unchanged: 0, review: 0, duplicate: 0, failed: 0, addressDeferred: 0, requiredFieldExcluded: 0 };
  for (const row of items) {
    totals.complete += row.complete ? 1 : 0;
    totals.unknownFound += row.foundKnown ? 0 : 1;
    for (const key of ["found", "created", "merged", "updated", "unchanged", "review", "duplicate", "failed", "addressDeferred", "requiredFieldExcluded"]) totals[key] += count(row[key]);
  }
  const districtCoverage = ["네이버", "당근"].filter(name => !source || source === name).map(name => ({
    source: name, districts: DISTRICTS.map(district => {
      const runs = items.filter(row => row.source === name && collectionScopeKey(row).endsWith(`|${district}`));
      return { district, state: !runs.length ? "missing" : runs.every(row => row.complete) ? "complete" : "attention" };
    })
  }));
  return { date, items, totals, districtCoverage,
    policy: "선택일 시작 기준 · 출처/거래유형/같은 범위는 최신 실행 1회만 합산합니다. 재실행 이전의 신규 건수는 합산하지 않으며, 일일 고유 신규 총계와 다를 수 있습니다." };
}
export function collectorActionGuidance(message) {
  const value = String(message || "");
  if (/401|403|UNAUTH|FORBIDDEN|로그인|승인되지|보안키/i.test(value)) return "로그인·수집 승인 상태를 확인해 주세요. 반복 실행만으로 해결되지 않을 수 있습니다.";
  if (/PersistedQuery|스키마|GraphQL|Unknown field|Cannot query field|최신 수집기/i.test(value)) return "공급처 API 또는 수집기 버전 확인이 필요합니다. 업데이트 확인 후 다시 실행해 주세요.";
  if (/주소|지번/.test(value)) return "정확한 주소가 확인될 때까지 지도 등록을 보류합니다. 원본에서 주소가 확인되면 검수해 주세요.";
  if (/429|시간|timeout|network|통신|연결|응답/i.test(value)) return "일시적인 연결 문제일 수 있습니다. 자동 재시도 상태를 확인하고 실패한 지역만 다시 실행할 수 있습니다.";
  return value ? "아래 상세 사유와 원본 상태를 확인해 주세요. 오류를 확인하기 전 전체 재수집은 필요하지 않습니다." : "";
}
