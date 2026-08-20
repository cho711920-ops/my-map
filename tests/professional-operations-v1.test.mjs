import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, d1, security, map, admin, html] = await Promise.all([
  readFile(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/src/security.js", import.meta.url), "utf8"),
  readFile(new URL("../js/map.js", import.meta.url), "utf8"),
  readFile(new URL("../js/operations-admin-v1.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

test("operations dashboard uses a persisted snapshot and refreshes only after finalized collection", () => {
  assert.match(d1, /operations_snapshots/);
  assert.match(d1, /refreshOperationsDashboard/);
  assert.match(worker, /collectorFinalized[\s\S]*refreshOperationsDashboard/);
  assert.match(worker, /adjustOperationsDashboard\(env, d1Result\.operationAdjustments\)/);
  assert.match(
    worker,
    /const revisionUpdate = touchDataRevision\(env, null,[\s\S]*?await Promise\.all\(\[invalidation, revisionUpdate\]\)/,
    "수집 완료 응답 전 목록 캐시 삭제와 리비전 변경을 모두 기다려야 합니다."
  );
});

test("active clients apply small listing changes without downloading the full sheet", () => {
  assert.match(worker, /changeIds:/);
  assert.match(d1, /action: "listingChanges"/);
  assert.match(map, /applyListingChangesV683/);
  assert.match(map, /변경된 매물 .*건만 동기화했습니다/);
});

test("history and role management are isolated from customer matching and notifications", () => {
  assert.match(html, /operationsTabHistory/);
  assert.match(html, /operationsTabUsers/);
  assert.match(admin, /listingHistory/);
  assert.match(admin, /userManagement/);
  assert.doesNotMatch(admin, /notification|알림|customerMatches|rebuildCustomer/);
  assert.match(admin, /function deactivateAdminTabs\(\)/);
  assert.match(admin, /deactivateAdminTabs\(\);[\s\S]*return previousSwitch\(tab\)/);
  assert.match(html, /operations-admin-v1\.js\?v=1\.0\.5-shared-data-only/);
  assert.match(admin, />이전으로 복구<\/button>/);
  assert.doesNotMatch(admin, />이 값으로 복구<\/button>/);
  assert.match(d1, /businessHistoryDiff/);
  assert.match(d1, /h\.action IN \('quickAdd', 'updateProperty', 'updatePropertyMemo', 'restoreListingHistory'\)/);
});

test("server enforces edit and administrator roles", () => {
  assert.match(security, /export function requireRole/);
  assert.match(d1, /requireRole\(user, \["owner", "admin"\]\)/);
  assert.match(d1, /effectiveAction !== "saveCloudState"/);
});

test("listing images use a seven-day immutable browser cache", () => {
  assert.match(worker, /private, max-age=604800, immutable/);
});
