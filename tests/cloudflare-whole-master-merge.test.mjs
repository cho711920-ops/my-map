import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const worker = fs.readFileSync("cloudflare/src/worker.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("manual representative merge consolidates every linked original", () => {
  assert.match(unified, /action:"consolidateExistingMasters"[\s\S]*?duplicateMasterIds:\[sourceMasterId\]/);
  assert.match(unified, /move\(pending\.originalId, propertyId, pending\.revision, pending\.sourcePropertyId\)/);
  assert.match(unified, />다른 매물에 다시 합치기<\/button>/);
  assert.match(unified, /별도 분리를 취소하거나, 서로 다른 두 대표매물을 하나로 합칠 때만 사용하세요/);
});

test("merged source card is removed immediately from all live list arrays", () => {
  assert.match(unified, /function removeConsolidatedMasterFromView\(sourceMasterId, targetMasterId\)/);
  assert.match(unified, /\["allItems", "currentItems", "visibleListItems"\]/);
  assert.match(unified, /text\(item && item\.propertyId\) !== sourceMasterId/);
  assert.match(unified, /if \(typeof global\.applyFilter === "function"\) global\.applyFilter\(\)/);
});

test("merge cache invalidation finishes before the response is rendered", () => {
  assert.match(worker, /body\.action \|\| ""\) === "consolidateExistingMasters"\) \{\s*await invalidation;/);
  assert.match(worker, /mutationAction\(body\) === "moveOriginalListing"\) \{\s*await invalidation;/);
  assert.match(html, /js\/unified-listings-v8\.js\?v=8\.1\.19-separate-confirmed/);
});
