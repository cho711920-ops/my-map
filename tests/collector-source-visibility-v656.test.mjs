import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { nextCollectorSourceVisibilityState } from "../cloudflare/src/collector-api.js";

const collectorSource = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");
const d1Source = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const scriptSource = fs.readFileSync("js/script.js", "utf8");
const quickToolsSource = fs.readFileSync("js/map-quick-tools-v657.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

test("source visibility counts only consecutive complete-collection misses", () => {
  assert.deepEqual(
    nextCollectorSourceVisibilityState({ active: 1, missingCount: 0 }, false, true),
    { active: 1, missingCount: 1 }
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

test("an observed source resets misses and reactivates without touching contract status", () => {
  assert.deepEqual(
    nextCollectorSourceVisibilityState({ active: 0, missingCount: 3 }, true, true),
    { active: 1, missingCount: 0 }
  );
  assert.match(
    collectorSource,
    /UPDATE listing_sources SET active=1, missing_count=0,[\s\S]*?last_collected_at=\?1[\s\S]*?active=0 OR missing_count<>0/
  );
  const finalizeSection = collectorSource.slice(
    collectorSource.indexOf("async function finalizeSession"),
    collectorSource.indexOf("function collectorHostAllowed")
  );
  assert.doesNotMatch(finalizeSection, /UPDATE listings SET status/);
});

test("transaction candidates are non-completed listings whose every source is hidden", () => {
  assert.match(d1Source, /JOIN listings l ON l\.id=s\.listing_id/);
  assert.match(d1Source, /l\.status NOT IN \('deleted','계약완료'\)/);
  assert.match(d1Source, /HAVING SUM\(CASE WHEN active=1 THEN 1 ELSE 0 END\)=0/);
  assert.match(d1Source, /MAX\(missing_count\) >= 3/);
});

test("done-only view is mutually exclusive with hiding completed listings", () => {
  assert.match(htmlSource, /id="doneOnlyBtn"[\s\S]*?계약완료만 보기/);
  assert.match(htmlSource, /id="mapQuickDoneOnlyBtn"[\s\S]*?계약완료만 보기/);
  assert.match(scriptSource, /var doneOnly = false/);
  assert.match(scriptSource, /doneOnly \? isDone\(item\) : \(!hideDone \|\| !isDone\(item\)\)/);
  assert.match(scriptSource, /function toggleHideDone\(\)[\s\S]*?if \(hideDone\) doneOnly = false/);
  assert.match(scriptSource, /function toggleDoneOnly\(\)[\s\S]*?if \(doneOnly\) hideDone = false/);
  assert.match(scriptSource, /localStorage\.setItem\(doneViewStorageKeyV656, mode\)/);
  assert.match(quickToolsSource, /\["mapQuickDoneOnlyBtn", !!window\.doneOnly\]/);
  assert.match(htmlSource, /script\.js\?v=6\.5\.78-naver-map-tiles/);
  assert.match(htmlSource, /map-quick-tools-v657\.js\?v=6\.5\.10-done-only-filter/);
});
