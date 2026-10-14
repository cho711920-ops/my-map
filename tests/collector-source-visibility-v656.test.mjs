import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  nextCollectorSourceVisibilityState,
  removeCompletedListingMemo,
  shouldReactivateCompletedListing
} from "../cloudflare/src/collector-api.js";

const collectorSource = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");
const d1Source = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const presenceSource = fs.readFileSync("cloudflare/src/advertisement-presence.js", "utf8");
const scriptSource = fs.readFileSync("js/script.js", "utf8");
const quickToolsSource = fs.readFileSync("js/map-quick-tools-v657.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

test("source visibility ends an ad on its first proved complete-collection miss only", () => {
  assert.deepEqual(
    nextCollectorSourceVisibilityState({ active: 1, missingCount: 0 }, false, true),
    { active: 0, missingCount: 1 }
  );
  assert.deepEqual(
    nextCollectorSourceVisibilityState({ active: 1, missingCount: 2 }, false, true),
    { active: 0, missingCount: 3 }
  );
  assert.deepEqual(
    nextCollectorSourceVisibilityState({ active: 1, missingCount: 1 }, false, false),
    { active: 1, missingCount: 1 }
  );
});

test("an observed source resets misses and reactivates a completed listing only after a real return", () => {
  assert.deepEqual(
    nextCollectorSourceVisibilityState({ active: 0, missingCount: 3 }, true, true),
    { active: 1, missingCount: 0 }
  );
  assert.match(presenceSource, /UPDATE listing_sources SET active=1,missing_count=0,last_collected_at=\?1/);
  assert.match(presenceSource, /active=0 OR missing_count<>0/);
  assert.equal(shouldReactivateCompletedListing("계약완료", { active: 0, missingCount: 3 }, true), true);
  assert.equal(shouldReactivateCompletedListing("계약완료", { active: 1, missingCount: 0 }, true), false);
  assert.equal(shouldReactivateCompletedListing("계약완료", null, true, true), true);
  assert.equal(shouldReactivateCompletedListing("계약완료", { active: 0, missingCount: 3 }, false), false);
  assert.equal(shouldReactivateCompletedListing("active", { active: 0, missingCount: 3 }, true), false);
  assert.equal(removeCompletedListingMemo("임대인 통화 / [거래완료 2026-08-10]"), "임대인 통화");
  assert.equal(removeCompletedListingMemo("[거래완료 2026-08-10]"), "");
  assert.match(collectorSource, /sourceReappeared/);
  assert.match(collectorSource, /UPDATE listings SET status='active', operating_memo=\?1[^;]+status='계약완료'/s);
});

test("transaction candidates count ended source advertisements independently of active siblings", () => {
  assert.match(d1Source, /JOIN listings l ON l\.id=s\.listing_id/);
  assert.match(d1Source, /l\.status NOT IN \('deleted','계약완료'\)/);
  const candidates = d1Source.match(/async function transactionCandidates\(env\) \{([^]*?)\nconst BUSINESS_HISTORY_FIELDS/)[1];
  assert.match(candidates, /s\.active=0/);
  assert.match(candidates, /originalId: original\.originalId/);
  assert.doesNotMatch(candidates, /HAVING|GROUP BY l\.id/);
});

test("done-only view is mutually exclusive with hiding completed listings", () => {
  assert.match(htmlSource, /id="doneOnlyBtn"[\s\S]*?계약완료만 보기/);
  assert.match(htmlSource, /id="mapQuickDoneOnlyBtn"[\s\S]*?계약완료만 보기/);
  assert.match(scriptSource, /var doneOnly = false/);
  assert.match(scriptSource, /doneOnly \? \(isDone\(item\) \|\| Number\(item\.unifiedEndedOriginalCountV1 \|\| 0\) > 0\) : \(!hideDone \|\| !isDone\(item\)\)/);
  assert.match(scriptSource, /function toggleHideDone\(\)[\s\S]*?if \(hideDone\) doneOnly = false/);
  assert.match(scriptSource, /function toggleDoneOnly\(\)[\s\S]*?if \(doneOnly\) hideDone = false/);
  assert.match(scriptSource, /localStorage\.setItem\(doneViewStorageKeyV656, mode\)/);
  assert.match(quickToolsSource, /\["mapQuickDoneOnlyBtn", !!window\.doneOnly\]/);
  assert.match(htmlSource, /script\.js\?v=/);
  assert.match(htmlSource, /map-quick-tools-v657\.js\?v=/);
});
