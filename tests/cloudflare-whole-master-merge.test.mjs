import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const worker = fs.readFileSync("cloudflare/src/worker.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("manual representative merge consolidates every linked original", () => {
  assert.match(unified, /action:"consolidateExistingMasters"[\s\S]*?duplicateMasterIds:\[sourceMasterId\]/);
  assert.match(unified, /move\(pending\.originalId, propertyId, pending\.revision, pending\.sourcePropertyId\)/);
  assert.match(unified, />이 매물 전체 통합<\/button>/);
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
  assert.match(html, /js\/unified-listings-v8\.js\?v=8\.1\.17-orphan-detail-fallback/);
});
