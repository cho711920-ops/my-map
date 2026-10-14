// Advertisement absence is meaningful only within an identical, proven census.
const text = value => String(value ?? "").trim();
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function validatedAdvertisementScope(source, value) {
  if (value?.version !== 1) return null;
  if (source === "공실박스") {
    const b = value.bounds;
    if (value.selectionKind !== "full-map-result" || !Array.isArray(b) || b.length !== 4 ||
        b.some(n => typeof n !== "number" || !Number.isFinite(n)) ||
        !(b[0] < b[2] && b[1] < b[3]) || b[0] < -90 || b[2] > 90 || b[1] < -180 || b[3] > 180 ||
        !Number.isInteger(value.level) || value.level < 1 || value.level > 22 ||
        !/^[a-f0-9]{64}$/.test(text(value.filtersHash)) || !/^[A-Za-z0-9_-]{1,40}$/.test(text(value.btype))) return null;
    return { version: 1, selectionKind: "full-map-result", bounds: b,
      level: value.level, btype: value.btype, filtersHash: value.filtersHash };
  }
  const kind = source === "네이버" ? "provider-region" : source === "당근" ? "provider-cluster" : "";
  if (!kind || value.selectionKind !== kind || !/^[A-Za-z0-9_:-]{1,100}$/.test(text(value.regionCode)) ||
      !value.filters || Array.isArray(value.filters) || typeof value.filters !== "object" ||
      !Object.keys(value.filters).length || stable(value.filters).length > 8000) return null;
  return { version: 1, selectionKind: kind, regionCode: text(value.regionCode), filters: value.filters };
}

export function advertisementCensusAudit(source, body, observedCount, now = Date.now()) {
  const proof = body?.completionProof;
  const scope = validatedAdvertisementScope(source, body?.presenceScope);
  const issues = [];
  const version = Number(body?.validationVersion);
  if (!Number.isInteger(version) || version < 3 || proof?.version !== 1) issues.push("광고번호 전체목록 검증정보 없음");
  if (!scope) issues.push("동일 범위·필터 확인 불가");
  if (proof?.terminalReached !== true || proof?.listComplete !== true || proof?.scopeVerified !== true) issues.push("마지막 페이지·전체목록 미확인");
  if (!Array.isArray(proof?.issueCodes) || proof.issueCodes.length) issues.push("목록 검증 오류");
  if (!Number.isInteger(proof?.observedUniqueCount) || proof.observedUniqueCount < 0 || proof.observedUniqueCount !== observedCount) issues.push("최종 고유 광고번호 수 불일치");
  if (proof?.expectedCountKnown === true) {
    if (!Number.isInteger(proof.providerExpectedCount) || proof.providerExpectedCount < 0 || proof.providerExpectedCount !== observedCount) issues.push("원본 총건수와 고유 광고번호 수 불일치");
  } else if (source !== "당근" || proof?.expectedCountKnown !== false) issues.push("원본 총건수 미확인");
  if (!observedCount && proof?.emptyConfirmed !== true) issues.push("빈 전체목록 미확인");
  const captured = Date.parse(proof?.capturedAt);
  if (!Number.isFinite(captured) || captured > now + 60_000) issues.push("목록 확인시각 미확인");
  return { valid: !issues.length, issues, scope,
    capturedAt: Number.isFinite(captured) ? new Date(captured).toISOString() : "" };
}

export async function advertisementScopeKey(source, scope) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(scope)));
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
  return `${source === "공실박스" ? "gongsil-map" : source === "네이버" ? "naver-region" : "daangn-cluster"}-v1-${hash}`;
}

export async function trackAdvertisementPresence(env, { source, body, sessionId, offers, markets, complete, providerCount }) {
  const audit = advertisementCensusAudit(source, body, providerCount);
  const result = { missingMarked: 0, deactivated: 0, presenceReset: 0, adsReappeared: 0,
    presenceTracking: false, presenceScopeEstablished: false, presenceScopeKey: "",
    presenceTrackingIssue: "", affectedListingIds: [] };
  // Older collectors may still save/update ads, but cannot infer absence.
  const capturedAt = audit.capturedAt;
  if (!capturedAt) {
    result.presenceTrackingIssue = audit.issues.join(" · ");
    return result;
  }
  const observed = offers.filter(row => markets.includes(row.tradeType));
  const seenJson = JSON.stringify(observed.map(row => ({ sourceId: row.sourceId, tradeType: row.tradeType })));
  const at = new Date().toISOString();
  const resetRows = await env.DB.prepare(`SELECT id,listing_id,active FROM listing_sources s
    WHERE source=?1 AND (active=0 OR missing_count<>0) AND updated_at<=?2 AND EXISTS (
      SELECT 1 FROM json_each(?3) seen WHERE json_extract(seen.value,'$.sourceId')=s.source_listing_id
      AND json_extract(seen.value,'$.tradeType')=COALESCE(NULLIF(s.trade_type,''),'lease'))`)
    .bind(source, capturedAt, seenJson).all();
  if ((resetRows?.results || []).length) {
    const reset = await env.DB.prepare(`UPDATE listing_sources SET active=1,missing_count=0,last_collected_at=?1,updated_at=?2
      WHERE source=?3 AND (active=0 OR missing_count<>0) AND updated_at<=?1 AND EXISTS (
        SELECT 1 FROM json_each(?4) seen WHERE json_extract(seen.value,'$.sourceId')=listing_sources.source_listing_id
        AND json_extract(seen.value,'$.tradeType')=COALESCE(NULLIF(listing_sources.trade_type,''),'lease')) RETURNING id,listing_id`)
      .bind(capturedAt, at, source, seenJson).all();
    const changed = reset?.results || [];
    const inactiveIds = new Set(resetRows.results.filter(row => Number(row.active) === 0).map(row => row.id));
    result.presenceReset = changed.length;
    result.adsReappeared = changed.filter(row => inactiveIds.has(row.id)).length;
    result.affectedListingIds.push(...changed.map(row => row.listing_id).filter(Boolean));
  }
  // updated_at also records a missing census: last_seen_at alone cannot order
  // a delayed positive snapshot against a more recently proved absence.
  await env.DB.prepare(`UPDATE collector_source_presence SET missing_count=0,last_seen_at=?1,updated_at=?2
    WHERE source=?3 AND last_seen_at<=?1 AND updated_at<=?1 AND missing_count<>0 AND EXISTS (
      SELECT 1 FROM json_each(?4) seen WHERE json_extract(seen.value,'$.sourceId')=collector_source_presence.source_listing_id
      AND json_extract(seen.value,'$.tradeType')=collector_source_presence.trade_type)`)
    .bind(capturedAt, at, source, seenJson).run();
  if (!complete || !audit.valid || !markets.length) {
    result.presenceTrackingIssue = audit.valid ? "부분수집: 없어진 광고 판정 보류" : audit.issues.join(" · ");
    return result;
  }
  const scopeKey = await advertisementScopeKey(source, audit.scope);
  result.presenceScopeKey = scopeKey;
  const previous = await env.DB.prepare(`SELECT p.*,s.id,s.listing_id,s.active,s.last_collected_at,
      s.updated_at AS source_updated_at,s.session_id AS source_session_id
    FROM collector_source_presence p LEFT JOIN listing_sources s ON s.source=p.source
      AND s.source_listing_id=p.source_listing_id AND COALESCE(NULLIF(s.trade_type,''),'lease')=p.trade_type
    WHERE p.scope_key=?1 AND p.source=?2 AND p.trade_type IN (SELECT value FROM json_each(?3))`)
    .bind(scopeKey, source, JSON.stringify(markets)).all();
  const seen = new Set(observed.map(row => `${row.tradeType}:${row.sourceId}`));
  const misses = (previous?.results || []).filter(row => row.id && Number(row.active) === 1 &&
    row.last_checked_session_id !== sessionId && !seen.has(`${row.trade_type}:${row.source_listing_id}`) &&
    text(row.last_seen_at) <= capturedAt && text(row.last_collected_at) <= capturedAt && text(row.source_updated_at) <= capturedAt);
  const missJson = JSON.stringify(misses);
  const writes = [env.DB.prepare(`INSERT INTO collector_source_presence
      (scope_key,source,trade_type,source_listing_id,missing_count,last_seen_at,last_checked_session_id,updated_at)
    SELECT ?1,?2,json_extract(seen.value,'$.tradeType'),json_extract(seen.value,'$.sourceId'),0,?3,?4,?5 FROM json_each(?6) seen WHERE 1
    ON CONFLICT(scope_key,source,trade_type,source_listing_id) DO UPDATE SET missing_count=0,
      last_seen_at=excluded.last_seen_at,last_checked_session_id=excluded.last_checked_session_id,updated_at=excluded.updated_at
    WHERE collector_source_presence.last_seen_at<=excluded.last_seen_at AND collector_source_presence.updated_at<=excluded.last_seen_at`)
    .bind(scopeKey, source, capturedAt, sessionId, at, seenJson)];
  if (misses.length) {
    writes.push(env.DB.prepare(`UPDATE collector_source_presence SET missing_count=1,last_checked_session_id=?1,updated_at=?2
      FROM json_each(?3) miss WHERE scope_key=?4 AND source=?5
      AND trade_type=json_extract(miss.value,'$.trade_type') AND source_listing_id=json_extract(miss.value,'$.source_listing_id')
      AND updated_at=json_extract(miss.value,'$.updated_at') AND EXISTS (SELECT 1 FROM listing_sources s
        WHERE s.id=json_extract(miss.value,'$.id') AND s.active=1
        AND s.last_collected_at=json_extract(miss.value,'$.last_collected_at')
        AND s.updated_at=json_extract(miss.value,'$.source_updated_at') AND s.session_id=json_extract(miss.value,'$.source_session_id'))`)
      .bind(sessionId, at, missJson, scopeKey, source));
    writes.push(env.DB.prepare(`UPDATE listing_sources SET missing_count=1,active=0,updated_at=?1
      FROM json_each(?2) miss WHERE listing_sources.id=json_extract(miss.value,'$.id') AND listing_sources.active=1
      AND listing_sources.last_collected_at=json_extract(miss.value,'$.last_collected_at')
      AND listing_sources.updated_at=json_extract(miss.value,'$.source_updated_at')
      AND listing_sources.session_id=json_extract(miss.value,'$.source_session_id') AND EXISTS (
        SELECT 1 FROM collector_source_presence p WHERE p.scope_key=?3 AND p.source=?4
        AND p.trade_type=json_extract(miss.value,'$.trade_type') AND p.source_listing_id=json_extract(miss.value,'$.source_listing_id')
        AND p.last_checked_session_id=?5 AND p.updated_at=?1 AND p.missing_count=1)`)
      .bind(at, missJson, scopeKey, source, sessionId));
  }
  await env.DB.batch(writes);
  result.presenceTracking = true;
  result.presenceScopeEstablished = !(previous?.results || []).length;
  const ended = misses.length ? await env.DB.prepare(`SELECT id,listing_id FROM listing_sources
    WHERE source=?1 AND active=0 AND missing_count=1 AND updated_at=?2
      AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?3))`).bind(source, at, missJson).all() : null;
  result.deactivated = result.missingMarked = (ended?.results || []).length;
  result.affectedListingIds.push(...(ended?.results || []).map(row => row.listing_id).filter(Boolean));
  result.affectedListingIds = [...new Set(result.affectedListingIds)];
  return result;
}
