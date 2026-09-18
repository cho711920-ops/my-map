import { requireRole } from "./security.js";
import { collectorRetentionPolicy } from "./collector-retention.js";

const GET_ACTIONS = new Set(["operationsQualityHolds", "operationsRetentionStatus"]);
const POST_ACTIONS = new Set(["resolveOperationsQualityHold"]);
const ISSUE_LABELS = {
  orphan_zero_rent_lease: "원본 연결 없는 월세 0원 매물",
  daangn_buy_only_in_lease: "매매 원본이 임대로 분류됨",
  daangn_monthly_terms_stale: "당근 원본과 임대조건 불일치",
  daangn_zero_rent_unproven: "당근 월세 0원 거래근거 부족",
  daangn_exact_address_unproven: "당근 정확한 지번 미제공 · 주소 확인 보류",
  gongsil_master_terms_stale: "공실박스 원본과 임대조건 불일치",
  gongsil_sale_in_lease: "공실박스 매매 원본이 임대로 분류됨",
  gongsil_verified_jeonse: "원본에서 확인된 정상 전세",
  gongsil_zero_rent_needs_review: "공실박스 월세 0원 거래근거 부족",
  zero_rent_lease_needs_review: "월세 0원 거래유형 확인 필요"
};
// A release only clears a publication hold. A sale/classification correction
// must use a separate reviewed edit workflow; it cannot be achieved here.
const RELEASABLE_ISSUES = new Set([
  "daangn_monthly_terms_stale", "daangn_zero_rent_unproven",
  "gongsil_master_terms_stale", "gongsil_zero_rent_needs_review",
  "gongsil_verified_jeonse", "zero_rent_lease_needs_review"
]);
const clean = value => String(value ?? "").trim();
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function parseObject(value) {
  if (typeof value !== "string" || value.length > 100_000) return {};
  try { const parsed = JSON.parse(value); return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}
function money(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function sourceUrl(value) {
  try {
    const url = new URL(clean(value));
    const roots = ["naver.com", "daangn.com", "gongsilbox.com"];
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        !roots.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`)) ||
        [...url.searchParams.keys()].some(key => /token|secret|password|signature|auth|api.?key/i.test(key))) return "";
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  } catch { return ""; }
}
function safeEvidence(value) {
  const input = parseObject(value);
  const result = {};
  for (const key of ["sourceCount", "activeSourceCount", "preserveRepresentative", "hasBuy", "hasMonth",
    "manualHistory", "saleCollisionCount", "activeNonDaangnCount", "nestedRawSourceCount",
    "hasPositiveLeaseOffer", "hasSaleOnlyOffer", "hasStructuredEvidence", "verifiedJeonse",
    "correctedDeposit", "correctedMonthlyRent", "suggestedDeposit", "suggestedMonthlyRent",
    "correctedSalePrice", "verifiedSingleSemiJeonse"]) {
    if (typeof input[key] === "boolean" || (typeof input[key] === "number" && Number.isFinite(input[key]))) result[key] = input[key];
  }
  if (input.stored && typeof input.stored === "object") result.stored = {
    tradeType: clean(input.stored.tradeType).slice(0, 20), mainSource: clean(input.stored.mainSource).slice(0, 50),
    deposit: money(input.stored.deposit), monthlyRent: money(input.stored.monthlyRent)
  };
  if (Array.isArray(input.sourceIds)) result.sourceIds = input.sourceIds.slice(0, 40).map(id => clean(id).slice(0, 160));
  if (typeof input.selectedSourceId === "string") result.selectedSourceId = input.selectedSourceId.slice(0, 160);
  return result;
}
function safeResolution(value) {
  const input = parseObject(value);
  const legacyAction = ["repair_monthly", "reclassify_sale", "repairRollback", "planRollback"].includes(input.action) ? input.action : "";
  return {
    operation: clean(input.operation || legacyAction).slice(0, 80), note: clean(input.note).slice(0, 2000),
    sourceUrl: sourceUrl(input.sourceUrl), sourceId: clean(input.sourceId).slice(0, 160),
    reviewedAt: clean(input.reviewedAt || input.correctedAt || input.at).slice(0, 40), tradeType: clean(input.tradeType).slice(0, 20),
    deposit: money(input.deposit), monthlyRent: money(input.monthlyRent),
    fieldsChanged: typeof input.fieldsChanged === "boolean" ? input.fieldsChanged
      : ["repair_monthly", "reclassify_sale", "repairRollback"].includes(legacyAction) ? true : null
  };
}
function publicSource(row) {
  const snapshot = parseObject(row.list_snapshot_json);
  return {
    id: row.id, source: row.source, sourceListingId: row.source_listing_id,
    sourceUrl: sourceUrl(row.source_url), active: Number(row.active) === 1,
    tradeType: clean(row.trade_type), address: clean(snapshot.address).slice(0, 300),
    deposit: money(snapshot.deposit), monthlyRent: money(snapshot.rent),
    updatedAt: row.updated_at, lastCollectedAt: row.last_collected_at
  };
}
const SOURCE_COLUMNS = "id,listing_id,source,source_listing_id,source_url,active,trade_type,list_snapshot_json,updated_at,last_collected_at";

export const isOperationsQualityGetAction = action => GET_ACTIONS.has(clean(action));
export const isOperationsQualityPostAction = action => POST_ACTIONS.has(clean(action));

async function qualityHolds(env, query) {
  const state = clean(query.state) || "open";
  if (!["open", "resolved", "dismissed", "all"].includes(state)) fail("검수 상태가 올바르지 않습니다.");
  const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 50)));
  const offset = Math.max(0, Math.min(100_000, Math.floor(Number(query.offset) || 0)));
  const rows = await env.DB.prepare(`SELECT h.*,l.property_id,l.title,l.address,l.room,
    l.status AS listing_status,l.trade_type,l.deposit,l.monthly_rent,l.version
    FROM listing_data_quality_holds h JOIN listings l ON l.id=h.listing_id
    WHERE (?1='all' OR h.state=?1)
    ORDER BY h.blocks_publication DESC,h.updated_at DESC,h.listing_id,h.issue_code LIMIT ?2 OFFSET ?3`)
    .bind(state, limit, offset).all();
  const summaries = await env.DB.prepare(`SELECT state,blocks_publication,COUNT(*) AS count
    FROM listing_data_quality_holds GROUP BY state,blocks_publication`).all();
  const listingIds = [...new Set((rows.results || []).map(row => row.listing_id))];
  const sources = listingIds.length ? await env.DB.prepare(`WITH ranked AS (
    SELECT ${SOURCE_COLUMNS},ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY active DESC,updated_at DESC,id) AS source_rank
    FROM listing_sources WHERE listing_id IN (${listingIds.map((_, index) => `?${index + 1}`).join(",")}))
    SELECT ${SOURCE_COLUMNS} FROM ranked WHERE source_rank<=40 ORDER BY active DESC,updated_at DESC,id`)
    .bind(...listingIds).all() : { results: [] };
  const byListing = new Map();
  for (const row of sources.results || []) {
    if (!byListing.has(row.listing_id)) byListing.set(row.listing_id, []);
    if (byListing.get(row.listing_id).length < 40) byListing.get(row.listing_id).push(publicSource(row));
  }
  const summary = { openBlocking: 0, openNonBlocking: 0, resolved: 0, dismissed: 0, total: 0 };
  let total = 0;
  for (const row of summaries.results || []) {
    const count = Number(row.count) || 0;
    summary.total += count;
    if (row.state === "open") summary[Number(row.blocks_publication) ? "openBlocking" : "openNonBlocking"] += count;
    else if (Object.hasOwn(summary, row.state)) summary[row.state] += count;
    if (state === "all" || row.state === state) total += count;
  }
  return {
    ok: true, action: "operationsQualityHolds", source: "D1", kind: "publication-quality-hold",
    description: "공개 보류 검수입니다. 수집 원문의 주소 보류·중복 검증 대기와는 별도입니다.",
    state, limit, offset, total, summary,
    rows: (rows.results || []).map(row => ({
      listingId: row.listing_id, propertyId: row.property_id, issueCode: row.issue_code,
      reason: ISSUE_LABELS[row.issue_code] || "추가 검수 필요", state: row.state,
      blocksPublication: Number(row.blocks_publication) === 1, sourceId: row.source_id || "",
      title: row.title, address: row.address, room: row.room, listingStatus: row.listing_status,
      tradeType: row.trade_type, deposit: money(row.deposit), monthlyRent: money(row.monthly_rent),
      version: Number(row.version), updatedAt: row.updated_at, detectedAt: row.detected_at,
      detectedBy: row.detected_by, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by,
      evidence: safeEvidence(row.evidence_json), resolution: safeResolution(row.resolution_json),
      sources: byListing.get(row.listing_id) || [],
      releaseRequiresEvidence: true, releaseSupported: row.state === "open" && RELEASABLE_ISSUES.has(row.issue_code) &&
        (money(row.monthly_rent) > 0 || (row.issue_code === "gongsil_verified_jeonse" && parseObject(row.evidence_json).verifiedJeonse === true)),
      releaseNotice: "검수로 공개 보류만 해제합니다. 가격·주소·거래유형은 수정하지 않습니다. 원본과 현재 값이 다르면 먼저 개별 수정이 필요합니다."
    }))
  };
}

async function retentionStatus(env) {
  const policy = collectorRetentionPolicy(env);
  const row = await env.DB.prepare(`SELECT lease_until,next_run_at,last_report_json,updated_at
    FROM collector_retention_state WHERE id='daily'`).first();
  const report = parseObject(row?.last_report_json);
  const counts = value => ({ raw: Math.max(0, Number(value?.raw) || 0), sessions: Math.max(0, Number(value?.sessions) || 0) });
  const scanned = counts(report.scanned), eligible = counts(report.eligible);
  const archiveKey = /^collector-retention\/\d{4}-\d{2}-\d{2}\/[a-f\d-]+\.json$/.test(clean(report.archiveKey)) ? report.archiveKey : "";
  return {
    ok: true, action: "operationsRetentionStatus", source: "D1", configured: Boolean(row), policy,
    running: Boolean(row?.lease_until && row.lease_until > policy.now),
    nextRunAt: clean(row?.next_run_at), lastUpdatedAt: clean(row?.updated_at),
    lastReport: Object.keys(report).length ? {
      ok: report.ok === true, mode: ["archive", "dry-run"].includes(report.mode) ? report.mode : "unknown",
      at: clean(report.at).slice(0, 40), scanned, eligible, deleted: counts(report.deleted),
      excludedInLastScan: { raw: Math.max(0, scanned.raw - eligible.raw), sessions: Math.max(0, scanned.sessions - eligible.sessions) },
      archiveKey, archiveVerified: Boolean(archiveKey && /^[a-f\d]{64}$/.test(clean(report.archiveSha256))),
      error: report.ok === false ? "최근 자동 정리에 실패했습니다. 자료를 보호한 상태에서 서버 로그 확인이 필요합니다." : "",
      reason: report.reason === "archive-size-limit" ? "백업 파일 크기 제한" : ""
    } : null,
    totalRemaining: null,
    notice: "검사 수와 제외 수는 최근 배치 기준이며 전체 잔여 건수가 아닙니다. 검수 중인 원문·최신 원본은 보호하고 백업을 검증한 뒤에만 정리합니다."
  };
}

export async function handleOperationsQualityGet(env, user, query = {}) {
  if (!isOperationsQualityGetAction(query.action)) return null;
  requireRole(user, ["owner", "admin"]);
  if (!env?.DB?.prepare) fail("운영 데이터베이스가 연결되지 않았습니다.", 503);
  return query.action === "operationsQualityHolds" ? qualityHolds(env, query) : retentionStatus(env);
}

async function resolveHold(env, user, body) {
  const listingId = clean(body.listingId), issueCode = clean(body.issueCode);
  const expectedVersion = Number(body.expectedVersion), expectedHoldUpdatedAt = clean(body.expectedHoldUpdatedAt);
  const evidence = body.evidence && typeof body.evidence === "object" ? body.evidence : {};
  const note = clean(evidence.note), url = sourceUrl(evidence.sourceUrl);
  const state = clean(body.resolutionState) || "resolved";
  if (!listingId || listingId.length > 160 || !issueCode || issueCode.length > 100 ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !expectedHoldUpdatedAt) fail("매물 버전과 검수 대상이 필요합니다.");
  if (!note || note.length > 2000 || !url) fail("검수 근거와 저장된 원본 링크를 입력해 주세요.");
  if (!["resolved", "dismissed"].includes(state)) fail("해제 처리 상태가 올바르지 않습니다.");
  if (!RELEASABLE_ISSUES.has(issueCode)) fail("원본 누락·매매 분류 문제는 공개 해제만으로 해결할 수 없습니다. 개별 거래유형 검수가 필요합니다.", 409);
  const hold = await env.DB.prepare(`SELECT * FROM listing_data_quality_holds WHERE listing_id=?1 AND issue_code=?2`)
    .bind(listingId, issueCode).first();
  const listing = await env.DB.prepare(`SELECT id,property_id,status,address,room,trade_type,deposit,monthly_rent,version,updated_at
    FROM listings WHERE id=?1`).bind(listingId).first();
  if (!hold || !listing) fail("검수 대상을 찾을 수 없습니다.", 404);
  if (hold.state !== "open" || hold.updated_at !== expectedHoldUpdatedAt || Number(listing.version) !== expectedVersion) {
    fail("다른 작업에서 매물 또는 검수 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.", 409);
  }
  if (listing.status !== "active" || listing.trade_type !== "lease" || !clean(listing.address)) {
    fail("현재 매물의 상태·거래유형·주소를 먼저 검수해야 합니다.", 409);
  }
  if (evidence.tradeType !== listing.trade_type || money(evidence.deposit) == null || money(evidence.monthlyRent) == null ||
      money(evidence.deposit) !== money(listing.deposit) || money(evidence.monthlyRent) !== money(listing.monthly_rent)) {
    fail("확인한 거래유형·보증금·월세가 현재 매물과 다릅니다. 공개 해제는 실제 값을 수정하지 않습니다.", 409);
  }
  if (money(listing.monthly_rent) === 0 && (issueCode !== "gongsil_verified_jeonse" ||
      parseObject(hold.evidence_json).verifiedJeonse !== true)) {
    fail("월세 0원은 정상 전세라는 원본 검증 없이 공개 해제할 수 없습니다. 거래조건을 개별 검수해 주세요.", 409);
  }
  const sources = (await env.DB.prepare(`SELECT ${SOURCE_COLUMNS} FROM listing_sources WHERE listing_id=?1 ORDER BY id LIMIT 41`)
    .bind(listingId).all()).results || [];
  if (!sources.length || sources.length > 40) fail("연결된 원본의 개별 검수가 필요합니다.", 409);
  const selected = sources.find(source => Number(source.active) === 1 && sourceUrl(source.source_url) === url);
  if (!selected) fail("입력한 링크가 이 매물에 연결된 활성 원본과 일치하지 않습니다.", 409);
  if (hold.source_id && hold.source_id !== selected.id) fail("보류 사유에 기록된 원본으로 검수해 주세요.", 409);
  // All active attached sources must agree. A single convenient matching source
  // must not mask a contradictory sale/monthly source or a preserved master.
  for (const source of sources.filter(source => Number(source.active) === 1)) {
    const snapshot = parseObject(source.list_snapshot_json);
    if (source.trade_type !== "lease" || snapshot.tradeType !== "lease" ||
        snapshot.preserveRepresentative || clean(snapshot.address) !== clean(listing.address) ||
        clean(snapshot.room) !== clean(listing.room) || money(snapshot.deposit) !== money(listing.deposit) ||
        money(snapshot.rent) !== money(listing.monthly_rent) || money(snapshot.deposit) == null || money(snapshot.rent) == null) {
      fail("연결된 활성 원본의 주소·호실·거래조건이 현재 매물과 일치하지 않습니다. 원본 비교 후 개별 수정이 필요합니다.", 409);
    }
  }
  const now = new Date().toISOString(), token = crypto.randomUUID();
  const resolution = { operation: "reviewed_publication_release", reviewToken: token, note,
    sourceUrl: url, sourceId: selected.id, reviewedAt: now, tradeType: listing.trade_type,
    deposit: money(listing.deposit), monthlyRent: money(listing.monthly_rent), fieldsChanged: false };
  const resolutionJson = JSON.stringify(resolution);
  // D1 batch is one transaction. The first conditional update validates the
  // hold, listing version AND every attached source. A unique marker makes
  // both follow-up writes no-ops if the CAS lost; no history-only success.
  const params = [state, resolutionJson, clean(user.email).toLowerCase(), now, listingId, issueCode,
    expectedHoldUpdatedAt, hold.evidence_json, expectedVersion, listing.updated_at, sources.length,
    hold.source_id, hold.blocks_publication, hold.resolution_json,
    JSON.stringify([listing.status, listing.address, listing.room, listing.trade_type, listing.deposit, listing.monthly_rent])];
  const sourceGuards = sources.map(source => {
    const fields = ["listing_id", "source_url", "active", "trade_type", "list_snapshot_json", "updated_at"];
    params.push(source.id, JSON.stringify(fields.map(field => source[field])));
    return `EXISTS (SELECT 1 FROM listing_sources s WHERE s.id=?${params.length - 1}
      AND json_array(${fields.map(field => `s.${field}`).join(",")})=?${params.length})`;
  });
  const before = { issueCode, state: hold.state, blocksPublication: Boolean(hold.blocks_publication), version: expectedVersion };
  const after = { issueCode, state, blocksPublication: false, version: expectedVersion + 1, ...resolution };
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE listing_data_quality_holds SET state=?1,blocks_publication=0,resolution_json=?2,
      resolved_by=?3,resolved_at=?4,updated_at=?4 WHERE listing_id=?5 AND issue_code=?6 AND state='open'
      AND updated_at=?7 AND evidence_json=?8 AND source_id IS ?12 AND blocks_publication=?13 AND resolution_json=?14
      AND EXISTS (SELECT 1 FROM listings l WHERE l.id=?5 AND l.version=?9 AND l.updated_at=?10
        AND json_array(l.status,l.address,l.room,l.trade_type,l.deposit,l.monthly_rent)=?15)
      AND (SELECT COUNT(*) FROM listing_sources s WHERE s.listing_id=?5)=?11
      AND ${sourceGuards.join(" AND ")}`).bind(...params),
    env.DB.prepare(`UPDATE listings SET version=version+1,updated_at=?1 WHERE id=?2 AND version=?3
      AND EXISTS (SELECT 1 FROM listing_data_quality_holds h WHERE h.listing_id=?2 AND h.issue_code=?4 AND h.resolution_json=?5)`)
      .bind(now, listingId, expectedVersion, issueCode, resolutionJson),
    env.DB.prepare(`INSERT INTO listing_history (listing_id,source_id,action,actor_email,before_json,after_json,created_at)
      SELECT ?1,?2,'resolveOperationsQualityHold',?3,?4,?5,?6 WHERE EXISTS
      (SELECT 1 FROM listing_data_quality_holds h JOIN listings l ON l.id=h.listing_id
        WHERE h.listing_id=?1 AND h.issue_code=?7 AND h.resolution_json=?8 AND l.version=?9 AND l.updated_at=?6)`)
      .bind(listingId, selected.id, clean(user.email).toLowerCase(), JSON.stringify(before), JSON.stringify(after), now,
        issueCode, resolutionJson, expectedVersion + 1)
  ]);
  if (!Number(results[0]?.meta?.changes)) fail("동시에 원본·매물·검수 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.", 409);
  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM listing_data_quality_holds
    WHERE listing_id=?1 AND state='open' AND blocks_publication=1`).bind(listingId).first();
  return { ok: true, action: "resolveOperationsQualityHold", persisted: true, source: "D1", listingId,
    propertyId: clean(listing.property_id || listing.id), issueCode, state, version: expectedVersion + 1,
    fieldsChanged: false, remainingBlockingHolds: Number(remaining?.count) || 0,
    message: "검수 근거를 기록하고 해당 공개 보류를 해제했습니다. 가격·주소·거래유형은 수정하지 않았습니다." };
}

export async function handleOperationsQualityPost(env, user, body = {}) {
  if (!isOperationsQualityPostAction(body.action)) return null;
  requireRole(user, ["owner", "admin"]);
  if (!env?.DB?.prepare || !env.DB.batch) fail("운영 데이터베이스가 연결되지 않았습니다.", 503);
  return resolveHold(env, user, body);
}
