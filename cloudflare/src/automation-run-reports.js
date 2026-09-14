const statuses = new Set(["pending", "running", "completed", "partial", "deferred", "failed", "retrying", "retry_wait", "skipped"]);
const codes = new Set(["provider_auth", "provider_persisted_query", "provider_schema", "terminal", "deferred", "transient"]);
const numericKeys = ["expected", "processed", "detailProcessed", "unchanged", "created", "updated", "review", "addressDeferred", "failed"];
const count = value => Math.min(10000000, Math.max(0, Math.floor(Number(value) || 0)));
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
export function sanitizeAutomationRunReport(input, now = Date.now()) {
  if (!input || typeof input !== "object" || JSON.stringify(input).length > 48000) fail("자동수집 보고서 크기가 올바르지 않습니다.");
  if (!/^run-\d{10,16}-[a-z0-9]{1,20}$/.test(String(input.runId || ""))) fail("자동수집 실행번호가 올바르지 않습니다.");
  const startedAt = Number(input.startedAt);
  const revision = Number(input.revision || input.updatedAt);
  if (!Number.isSafeInteger(startedAt) || startedAt < now - 30 * 86400000 || startedAt > now + 300000 ||
      !Number.isSafeInteger(revision) || revision < startedAt || revision > now + 300000) fail("자동수집 보고시각을 확인해 주세요.");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 40) fail("자동수집 보고 대상이 올바르지 않습니다.");
  const items = input.items.map((item, index) => {
    if (!["naver", "daangn", "gongsil"].includes(item.source) || !statuses.has(item.status)) fail("자동수집 보고 상태가 올바르지 않습니다.");
    const counters = Object.fromEntries(numericKeys.map(key => [key, count(item.counts?.[key])]));
    return { targetIndex: index, source: item.source,
      district: ["유성구", "대덕구", "중구", "서구", "동구"].includes(item.district) ? item.district : "",
      tradeType: item.tradeType === "sale" ? "sale" : "lease", status: item.status,
      counts: counters, terminalCode: codes.has(item.terminalCode) ? item.terminalCode : "" };
  });
  const readiness = input.readiness || {};
  const timeText = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? value : "";
  const timestamp = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const finishedAt = timestamp(input.finishedAt);
  const active = input.active === true && !finishedAt;
  if (!active && items.some(item => ["pending", "running", "retrying", "retry_wait"].includes(item.status))) fail("미완료 대상이 남은 보고서를 종료할 수 없습니다.");
  return { version: 1, runId: input.runId, revision, startedAt, active,
    finishedAt: active ? null : finishedAt || revision,
    extensionVersion: /^\d+\.\d+\.\d+$/.test(String(input.extensionVersion || "")) ? input.extensionVersion : "",
    readiness: { enabled: readiness.enabled === true, schedule: timeText(readiness.schedule),
      nextAlarmAt: timestamp(readiness.nextAlarmAt), windowsSchedule: timeText(readiness.windowsSchedule),
      windowsCheckedAt: timestamp(readiness.windowsCheckedAt), windowsNextRunAt: timestamp(readiness.windowsNextRunAt),
      windowsTaskState: ["Ready", "Running", "Disabled", "Unknown"].includes(readiness.windowsTaskState) ? readiness.windowsTaskState : "Unknown" },
    items };
}
export async function saveAutomationRunReport(env, input) {
  const report = sanitizeAutomationRunReport(input);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT INTO collector_automation_runs
    (run_id, revision, active, started_at, reported_at, report_json) VALUES (?1,?2,?3,?4,?5,?6)
    ON CONFLICT(run_id) DO UPDATE SET revision=excluded.revision, active=excluded.active,
      reported_at=excluded.reported_at, report_json=excluded.report_json
    WHERE excluded.revision>collector_automation_runs.revision
      AND (collector_automation_runs.active=1 OR excluded.active=0)`)
    .bind(report.runId, report.revision, report.active ? 1 : 0, new Date(report.startedAt).toISOString(), now, JSON.stringify(report)).run();
  // Bounded pruning of telemetry only. Collection originals/backup policy is separate.
  await env.DB.prepare(`DELETE FROM collector_automation_runs WHERE run_id IN
    (SELECT run_id FROM collector_automation_runs WHERE active=0 AND started_at<?1 ORDER BY started_at LIMIT 25)`)
    .bind(new Date(Date.now() - 30 * 86400000).toISOString()).run();
  return { ok: true, action: "saveAutomationRunReport", runId: report.runId, changed: Number(result?.meta?.changes || 0) > 0 };
}
export async function readAutomationRunReports(env) {
  try {
    const rows = await env.DB.prepare("SELECT report_json,reported_at FROM collector_automation_runs ORDER BY started_at DESC LIMIT 10").all();
    return { available: true, runs: (rows.results || []).map(row => ({ ...JSON.parse(row.report_json), reportedAt: row.reported_at,
      stale: Date.now() - Date.parse(row.reported_at) > 10 * 60000 })) };
  } catch (error) {
    if (/no such table/.test(String(error?.message || error))) return { available: false, runs: [], message: "자동수집 보고서 저장소 업데이트가 필요합니다." };
    throw error;
  }
}
