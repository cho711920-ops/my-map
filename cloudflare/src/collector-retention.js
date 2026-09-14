// Collector history is pruned only after a verified, recoverable R2 archive.
// This is deliberately independent of listing/media deletion and review repair.
const DAY_MS = 86_400_000;
const ARCHIVE_PREFIX = "collector-retention/";
const MAX_ROW_BYTES = 512 * 1024;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const TERMINAL_SESSIONS = "('completed','partial','failed','abandoned','cancelled')";

function bounded(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return value !== "" && value != null && Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

export function collectorRetentionPolicy(env = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid collector retention time");
  const rawDays = bounded(env.COLLECTOR_RETENTION_RAW_DAYS, 90, 90, 3650);
  const sessionDays = bounded(env.COLLECTOR_RETENTION_SESSION_DAYS, 180, 180, 3650);
  return {
    now: new Date(now).toISOString(),
    mode: options.dryRun === true ? "dry-run"
      : env.COLLECTOR_RETENTION_MODE === "archive" ? "archive" : "dry-run",
    rawDays, sessionDays,
    batchLimit: bounded(env.COLLECTOR_RETENTION_BATCH_LIMIT, 50, 1, 100),
    rawCutoff: new Date(Date.parse(now) - rawDays * DAY_MS).toISOString(),
    sessionCutoff: new Date(Date.parse(now) - sessionDays * DAY_MS).toISOString()
  };
}

// Preserve all unresolved evidence, legacy originals, the latest snapshot, and
// the last *full processed* snapshot even when a newer duplicate is compact.
// ?1 is the age cutoff. The identical predicate is rechecked during DELETE.
const RAW_ELIGIBLE = `
  cr.processing_state IN ('processed','duplicate')
  AND cr.source<>'' AND cr.source_listing_id<>''
  AND cr.legacy_original_id=''
  AND cr.created_at<?1 AND julianday(cr.created_at)<julianday(?1) AND julianday(cr.processed_at)<julianday(?1)
  AND cr.error_text=''
  AND json_valid(cr.payload_json) AND json_valid(cr.result_json)
  AND length(CAST(cr.payload_json AS BLOB))<=${MAX_ROW_BYTES}
  AND length(CAST(cr.result_json AS BLOB))<=${MAX_ROW_BYTES}
  AND EXISTS (SELECT 1 FROM collector_sessions cs
    WHERE cs.id=cr.session_id AND cs.state='completed'
      AND length(CAST(cs.totals_json AS BLOB))<=${MAX_ROW_BYTES}
      AND length(CAST(cs.error_json AS BLOB))<=${MAX_ROW_BYTES})
  AND NOT EXISTS (SELECT 1 FROM jobs j
    WHERE (json_extract(CASE WHEN json_valid(j.payload_json) THEN j.payload_json ELSE '{}' END,'$.sessionId')=cr.session_id
      OR json_extract(CASE WHEN json_valid(j.progress_json) THEN j.progress_json ELSE '{}' END,'$.sessionId')=cr.session_id)
      AND j.state<>'completed')
  AND EXISTS (SELECT 1 FROM collector_raw newer
    WHERE newer.source=cr.source AND newer.source_listing_id=cr.source_listing_id
      AND newer.trade_type=cr.trade_type AND newer.processing_state='processed'
      AND json_valid(newer.payload_json)
      AND json_type(newer.payload_json,'$.raw') IN ('object','array')
      AND (newer.created_at>cr.created_at OR (newer.created_at=cr.created_at AND newer.id>cr.id)))
  AND NOT EXISTS (SELECT 1 FROM collector_raw unresolved
    WHERE unresolved.source=cr.source AND unresolved.source_listing_id=cr.source_listing_id
      AND unresolved.processing_state NOT IN ('processed','duplicate'))
  AND NOT EXISTS (SELECT 1 FROM collector_raw unresolved
    WHERE unresolved.processing_state NOT IN ('processed','duplicate')
      AND json_extract(CASE WHEN json_valid(unresolved.result_json) THEN unresolved.result_json ELSE '{}' END,'$.canonicalReviewId')=cr.id)
  AND NOT EXISTS (SELECT 1 FROM listing_data_quality_holds h
    WHERE h.state='open' AND (
      h.listing_id=json_extract(cr.result_json,'$.listingId')
      OR EXISTS (SELECT 1 FROM listing_sources ls
        WHERE ls.source=cr.source AND ls.source_listing_id=cr.source_listing_id
          AND (ls.id=h.source_id OR ls.listing_id=h.listing_id))
      OR EXISTS (SELECT 1 FROM json_tree(h.evidence_json) evidence
        WHERE evidence.type='text' AND evidence.value IN (cr.id,cr.source_listing_id,cr.session_id))
      OR EXISTS (SELECT 1 FROM json_each(cr.result_json,'$.candidateIds') candidate
        WHERE candidate.value=h.listing_id)))`;

const SESSION_ELIGIBLE = `
  cs.state IN ${TERMINAL_SESSIONS}
  AND cs.updated_at<?1 AND julianday(cs.updated_at)<julianday(?1) AND julianday(cs.finished_at)<julianday(?1)
  AND json_valid(cs.totals_json) AND json_valid(cs.error_json)
  AND length(CAST(cs.totals_json AS BLOB))<=${MAX_ROW_BYTES}
  AND length(CAST(cs.error_json AS BLOB))<=${MAX_ROW_BYTES}
  AND NOT EXISTS (SELECT 1 FROM collector_raw cr WHERE cr.session_id=cs.id)
  AND NOT EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.session_id=cs.id)
  AND NOT EXISTS (SELECT 1 FROM jobs j
    WHERE json_extract(CASE WHEN json_valid(j.payload_json) THEN j.payload_json ELSE '{}' END,'$.sessionId')=cs.id
      OR json_extract(CASE WHEN json_valid(j.progress_json) THEN j.progress_json ELSE '{}' END,'$.sessionId')=cs.id)
  AND NOT EXISTS (SELECT 1 FROM listing_data_quality_holds h, json_tree(h.evidence_json) evidence
    WHERE h.state='open' AND evidence.type='text' AND evidence.value=cs.id)
  AND EXISTS (SELECT 1 FROM collector_sessions newer
    WHERE newer.source=cs.source AND newer.state IN ${TERMINAL_SESSIONS}
      AND COALESCE(json_extract(CASE WHEN json_valid(newer.totals_json) THEN newer.totals_json ELSE '{}' END,'$.scope'),
        json_extract(CASE WHEN json_valid(newer.totals_json) THEN newer.totals_json ELSE '{}' END,'$.note'),'')
        =COALESCE(json_extract(CASE WHEN json_valid(cs.totals_json) THEN cs.totals_json ELSE '{}' END,'$.scope'),
        json_extract(CASE WHEN json_valid(cs.totals_json) THEN cs.totals_json ELSE '{}' END,'$.note'),'')
      AND (newer.updated_at>cs.updated_at OR (newer.updated_at=cs.updated_at AND newer.id>cs.id)))`;

function parseCursor(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

// A bounded indexed keyset scan prevents pinned old evidence from starving the
// rest of the table. A complete pass wraps to the beginning on the next run.
export async function planCollectorRetention(env, options = {}) {
  const policy = collectorRetentionPolicy(env, options);
  const cursor = options.cursor || {};
  const rawScan = await env.DB.prepare(`SELECT id, created_at FROM collector_raw
    WHERE processing_state IN ('processed','duplicate') AND created_at<?1
      AND (created_at>?2 OR (created_at=?2 AND id>?3))
    ORDER BY created_at,id LIMIT ?4`)
    .bind(policy.rawCutoff, cursor.rawAt || "", cursor.rawId || "", policy.batchLimit).all();
  const scannedRaw = rawScan.results || [];
  const raw = [];
  for (let offset = 0; offset < scannedRaw.length; offset += 40) {
    const ids = scannedRaw.slice(offset, offset + 40).map(row => row.id);
    const result = await env.DB.prepare(`SELECT cr.* FROM collector_raw cr
      WHERE ${RAW_ELIGIBLE} AND cr.id IN (${ids.map((_, index) => `?${index + 2}`).join(",")})
      ORDER BY cr.created_at,cr.id`).bind(policy.rawCutoff, ...ids).all();
    raw.push(...(result.results || []));
  }
  const sessionScan = await env.DB.prepare(`SELECT id, updated_at FROM collector_sessions
    WHERE state IN ${TERMINAL_SESSIONS} AND updated_at<?1
      AND (updated_at>?2 OR (updated_at=?2 AND id>?3))
    ORDER BY updated_at,id LIMIT ?4`)
    .bind(policy.sessionCutoff, cursor.sessionAt || "", cursor.sessionId || "", policy.batchLimit).all();
  const scannedSessions = sessionScan.results || [];
  const sessions = [];
  for (let offset = 0; offset < scannedSessions.length; offset += 40) {
    const ids = scannedSessions.slice(offset, offset + 40).map(row => row.id);
    const result = await env.DB.prepare(`SELECT cs.* FROM collector_sessions cs
      WHERE ${SESSION_ELIGIBLE} AND cs.id IN (${ids.map((_, index) => `?${index + 2}`).join(",")})
      ORDER BY cs.updated_at,cs.id`).bind(policy.sessionCutoff, ...ids).all();
    sessions.push(...(result.results || []));
  }
  const lastRaw = scannedRaw.at(-1);
  const lastSession = scannedSessions.at(-1);
  return {
    policy, raw, sessions,
    scanned: { raw: scannedRaw.length, sessions: scannedSessions.length },
    cursor: {
      rawAt: scannedRaw.length === policy.batchLimit ? lastRaw.created_at : "",
      rawId: scannedRaw.length === policy.batchLimit ? lastRaw.id : "",
      sessionAt: scannedSessions.length === policy.batchLimit ? lastSession.updated_at : "",
      sessionId: scannedSessions.length === policy.batchLimit ? lastSession.id : ""
    }
  };
}

function sameRowDelete(env, table, alias, row, predicate, cutoff) {
  // Match every archived column, not just an id or timestamp. An in-flight
  // update cannot make us delete a version that is absent from the archive.
  const columns = Object.keys(row);
  if (!columns.every(column => /^[a-z_]+$/.test(column))) throw new Error("Unsafe retention column");
  return env.DB.prepare(`DELETE FROM ${table} AS ${alias} WHERE ${predicate}
    AND ${columns.map((column, index) => `${alias}.${column} IS ?${index + 2}`).join(" AND ")}`)
    .bind(cutoff, ...columns.map(column => row[column]));
}

export async function runCollectorRetention(env, options = {}) {
  const plan = await planCollectorRetention(env, options);
  const { policy } = plan;
  const report = {
    ok: true, mode: policy.mode, at: policy.now, rawDays: policy.rawDays,
    sessionDays: policy.sessionDays, batchLimit: policy.batchLimit, scanned: plan.scanned,
    eligible: { raw: plan.raw.length, sessions: plan.sessions.length },
    deleted: { raw: 0, sessions: 0 }, cursor: plan.cursor, archiveKey: ""
  };
  if (policy.mode !== "archive" || (!plan.raw.length && !plan.sessions.length)) return report;
  if (typeof env.MEDIA?.put !== "function" || typeof env.MEDIA?.get !== "function") {
    throw new Error("Collector retention requires a readable R2 archive binding");
  }
  const archiveSessions = new Map(plan.sessions.map(row => [row.id, row]));
  const parentIds = [...new Set(plan.raw.map(row => row.session_id))];
  for (let offset = 0; offset < parentIds.length; offset += 40) {
    const ids = parentIds.slice(offset, offset + 40);
    const parents = await env.DB.prepare(`SELECT * FROM collector_sessions
      WHERE id IN (${ids.map((_, index) => `?${index + 1}`).join(",")})`).bind(...ids).all();
    for (const row of parents.results || []) archiveSessions.set(row.id, row);
  }
  if (parentIds.some(id => !archiveSessions.has(id))) {
    throw new Error("Collector retention parent session missing; no rows deleted");
  }
  const body = JSON.stringify({ version: 1, archivedAt: policy.now,
    policy: { rawDays: policy.rawDays, sessionDays: policy.sessionDays },
    deletionCandidates: { rawIds: plan.raw.map(row => row.id), sessionIds: plan.sessions.map(row => row.id) },
    tables: { collector_raw: plan.raw, collector_sessions: [...archiveSessions.values()] } });
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    // Re-plan a smaller *scan*, not merely a sliced candidate list: its keyset
    // cursor must not skip eligible rows omitted from this archive. This also
    // avoids retrying a permanently oversized page forever.
    if (policy.batchLimit > 1) return runCollectorRetention({ ...env,
      COLLECTOR_RETENTION_BATCH_LIMIT: Math.floor(policy.batchLimit / 2) }, { ...options, now: policy.now });
    return { ...report, ok: false, reason: "archive-size-limit", cursor: options.cursor || {} };
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const archiveKey = `${ARCHIVE_PREFIX}${policy.now.slice(0, 10)}/${crypto.randomUUID()}.json`;
  await env.MEDIA.put(archiveKey, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { purpose: "collector-retention-backup", sha256: digest, archivedAt: policy.now }
  });
  const verified = await env.MEDIA.get(archiveKey);
  if (!verified || await verified.text() !== body) {
    throw new Error("Collector retention archive verification failed; no rows deleted");
  }
  report.archiveKey = archiveKey;
  report.archiveSha256 = digest;
  const groups = [
    ["raw", "collector_raw", "cr", plan.raw, RAW_ELIGIBLE, policy.rawCutoff],
    ["sessions", "collector_sessions", "cs", plan.sessions, SESSION_ELIGIBLE, policy.sessionCutoff]
  ];
  for (const [name, table, alias, rows, predicate, cutoff] of groups) {
    for (let offset = 0; offset < rows.length; offset += 10) {
      const statements = rows.slice(offset, offset + 10)
        .map(row => sameRowDelete(env, table, alias, row, predicate, cutoff));
      const results = await env.DB.batch(statements);
      report.deleted[name] += results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
    }
  }
  return report;
}

// Called by the existing minute cron. The database lease makes this daily and
// safe across concurrent isolates. Errors never prevent collection/review work.
export async function runScheduledCollectorRetention(env, options = {}) {
  if (!env?.DB?.prepare) return { ok: true, skipped: "no-database" };
  let token = "";
  let policy;
  try {
    policy = collectorRetentionPolicy(env, options);
    await env.DB.prepare(`INSERT INTO collector_retention_state (id) VALUES ('daily')
      ON CONFLICT(id) DO NOTHING`).run();
    token = crypto.randomUUID();
    const leaseUntil = new Date(Date.parse(policy.now) + 15 * 60_000).toISOString();
    const claimed = await env.DB.prepare(`UPDATE collector_retention_state
      SET lease_token=?1,lease_until=?2 WHERE id='daily'
        AND (next_run_at='' OR next_run_at<=?3) AND (lease_until='' OR lease_until<=?3)`)
      .bind(token, leaseUntil, policy.now).run();
    if (!Number(claimed?.meta?.changes || 0)) return { ok: true, skipped: "not-due" };
    const state = await env.DB.prepare("SELECT cursor_json FROM collector_retention_state WHERE id='daily'").first();
    const report = await runCollectorRetention(env, { ...options, now: policy.now,
      cursor: parseCursor(state?.cursor_json) });
    const nextRun = new Date(Date.parse(policy.now) + (report.ok ? DAY_MS : 60 * 60_000)).toISOString();
    await env.DB.prepare(`UPDATE collector_retention_state SET lease_token='',lease_until='',
      next_run_at=?1,cursor_json=?2,last_report_json=?3,updated_at=?4 WHERE id='daily' AND lease_token=?5`)
      .bind(nextRun, JSON.stringify(report.cursor), JSON.stringify(report), policy.now, token).run();
    return report;
  } catch (error) {
    const report = { ok: false, mode: policy?.mode || "dry-run",
      error: String(error?.message || error).slice(0, 500) };
    if (token && policy) {
      try {
        await env.DB.prepare(`UPDATE collector_retention_state SET lease_token='',lease_until='',
          next_run_at=?1,last_report_json=?2,updated_at=?3 WHERE id='daily' AND lease_token=?4`)
          .bind(new Date(Date.parse(policy.now) + 60 * 60_000).toISOString(), JSON.stringify(report), policy.now, token).run();
      } catch { /* Missing migration or database outage: fail closed. */ }
    }
    return report;
  }
}
