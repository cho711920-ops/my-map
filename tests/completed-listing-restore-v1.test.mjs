import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [script, propertyEdit, d1, worker, style, html] = await Promise.all([
  readFile(new URL("../js/script.js", import.meta.url), "utf8"),
  readFile(new URL("../js/property-edit-v648.js", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8"),
  readFile(new URL("../css/style.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

test("completed listing badge provides a one-click available-state restore", () => {
  assert.match(script, /function restoreCompletedListing\(encodedKey\)/);
  assert.match(script, /onclick="event\.stopPropagation\(\); restoreCompletedListing/);
  assert.match(script, /toggleDoneStatus\(encodedKey, false\)/);
  assert.match(script, /거래완료 날짜 표식도 함께 제거됩니다/);
  assert.match(script, /연결된 동일매물 .*개도 그대로 유지합니다/);
  assert.match(style, /button\.done-badge\.done-restore-button-v1/);
});

test("both quick restore and edit-modal restore remove the completion marker and reload unified sources", () => {
  assert.match(script, /function makeDoneMemo\(memo, checked\)[\s\S]*if \(!checked\)[\s\S]*replace\(markerPattern/);
  assert.match(script, /toggleDoneStatus\(encodedKey, false\)[\s\S]*loadSheet\(true, true\)/);
  assert.match(script, /refreshUnifiedSources = Boolean\(detail\.result && detail\.result\.fullReload\)[\s\S]*loadSheet\(true, refreshUnifiedSources\)/);
  assert.match(propertyEdit, /item\.state === "계약완료"[\s\S]*!updated\.state[\s\S]*makeDoneMemo\(updated\.memo, false\)/);
  assert.match(propertyEdit, /function schedulePropertyEditReloadV634\(\)[\s\S]*loadSheet\(true, true\)/);
});

test("server snapshots and safely reconnects identical-listing sources", () => {
  assert.match(d1, /async function linkedSourceHistorySnapshot\(env, listingId\)/);
  assert.match(d1, /async function latestCompletedSourceSnapshot\(env, listingId\)/);
  assert.match(d1, /action IN \('toggleDone', 'updateProperty'\)/);
  assert.match(d1, /async function completionSourceRecoveryPlan\(env, listingId, snapshot, now\)/);
  assert.match(d1, /WHERE id=\?3 AND \(listing_id IS NULL OR trim\(listing_id\)=''\)/);
  assert.match(d1, /list_snapshot_json=json_set\(list_snapshot_json, '\$\.propertyId', \?1\)/);
  assert.match(d1, /sourceConflicts: recovery\.conflicts/);
  assert.match(d1, /fullReload: restoringCompleted/);
});

test("completion and restoration invalidate both list and unified-source caches", () => {
  assert.match(worker, /UNIFIED_CACHE_ACTIONS = new Set\(\[[\s\S]*"toggleDone"[\s\S]*"updateProperty"/);
  assert.match(worker, /d1Result\.fullReload === true/);
  assert.match(d1, /BUSINESS_HISTORY_FIELDS[\s\S]*"status"/);
  assert.match(d1, /'toggleDone', 'deleteProperty', 'restoreListingHistory'/);
});

test("restoration assets use cache-busting versions", () => {
  assert.match(html, /style\.css\?v=6\.10\.1-map-status-top[^"']*completed-restore-v1=1/);
  assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id[^"']*completed-restore-v1=1/);
  assert.match(html, /property-edit-v648\.js\?v=1\.0\.1-linked-selection&amp;completed-restore-v1=1/);
});
