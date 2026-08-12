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

test("merged source card is removed immediately from all live list arrays", () => {
  assert.match(unified, /function removeConsolidatedMasterFromView\(sourceMasterId, targetMasterId\)/);
  assert.match(unified, /\["allItems", "currentItems", "visibleListItems"\]/);
  assert.match(unified, /text\(item && item\.propertyId\) !== sourceMasterId/);
  assert.match(unified, /if \(typeof global\.applyFilter === "function"\) global\.applyFilter\(\)/);
});

test("merge cache invalidation finishes before the response is rendered", () => {
  assert.match(worker, /body\.action \|\| ""\) === "consolidateExistingMasters"\) \{\s*await invalidation;/);
  assert.match(worker, /mutationAction\(body\) === "moveOriginalListing"\) \{\s*await invalidation;/);
  assert.match(html, /js\/unified-listings-v8\.js\?v=8\.1\.21-data-access/);
});
