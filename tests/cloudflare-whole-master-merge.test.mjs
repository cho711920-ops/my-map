import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const worker = fs.readFileSync("cloudflare/src/worker.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("detail move transfers only the selected original", () => {
  assert.match(unified, /action = consolidateWholeMaster \? "consolidateExistingMasters" : "moveOriginalListing"/);
  assert.match(unified, /duplicateMasterIds:\[sourceMasterId\]/);
  assert.match(unified, /move\(pending\.originalId, propertyId, pending\.revision\)/);
  assert.doesNotMatch(unified, /move\(pending\.originalId, propertyId, pending\.revision, pending\.sourcePropertyId\)/);
  assert.match(unified, />원본 1개 합치기<\/button>/);
  assert.match(unified, /같은 묶음의 나머지 원본매물은 그대로 유지됩니다/);
});

test("detail exposes a separate whole-master merge flow including fallback-only listings", () => {
  assert.match(unified, />대표 전체 합치기<\/button>/);
  assert.match(unified, /function startWholeMasterMove\(encodedPropertyId\)/);
  assert.match(unified, /state\.pendingMove = \{mode: "whole", sourcePropertyId: sourcePropertyId\}/);
  assert.match(unified, /if \(wholeMaster\) move\("", propertyId, 1, pending\.sourcePropertyId\)/);
  assert.match(unified, /현재 매물의 모든 원본·사진·연결정보가 이동/);
  assert.doesNotMatch(unified, /!selected\.masterFallback[^\n]+대표 전체 합치기/);
});

test("merged source card is removed immediately from all live list arrays", () => {
  assert.match(unified, /function removeConsolidatedMasterFromView\(sourceMasterId, targetMasterId\)/);
  assert.match(unified, /\["allItems", "currentItems", "visibleListItems"\]/);
  assert.match(unified, /text\(item && item\.propertyId\) !== sourceMasterId/);
  assert.match(unified, /if \(typeof global\.applyFilter === "function"\) global\.applyFilter\(\)/);
});

test("merge completion is announced immediately while full-list synchronization continues in background", () => {
  assert.match(unified, /function showMergeNoticeV8139\(message, stateName, persistent\)/);
  assert.match(unified, /대표매물 통합 완료 · 이전 카드를 제거했고 최신 목록을 동기화하고 있습니다/);
  assert.match(unified, /refreshAfterMoveV8139\(result, consolidateWholeMaster\);\s*return result/);
  assert.doesNotMatch(unified, /return load\(true\)[\s\S]*?alert\("대표매물 전체 합치기가 완료되었습니다/);
  assert.match(unified, /저장은 완료됐지만 최신 목록 동기화가 지연됩니다/);
});

test("merge cache invalidation finishes before the response is rendered", () => {
  assert.match(worker, /wholeMergeDetailKeys[\s\S]*?body\.primaryMasterId[\s\S]*?body\.duplicateMasterIds/);
  assert.match(worker, /OPERATIONS_DASHBOARD_CACHE_KEY,[\s\S]*?\.\.\.wholeMergeDetailKeys/);
  assert.match(worker, /body\.action \|\| ""\) === "consolidateExistingMasters"\) \{\s*await invalidation;/);
  assert.match(worker, /mutationAction\(body\) === "moveOriginalListing"\) \{\s*await invalidation;/);
  assert.match(html, /js\/unified-listings-v8\.js\?v=8\.1\.42-favorite-static-photo/);
  assert.match(html, /css\/unified-listings-v8\.css\?v=8\.1\.40-smooth-photo-expand/);
});
