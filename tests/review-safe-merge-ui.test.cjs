const assert = require("node:assert/strict");
const fs = require("node:fs");

const ui = fs.readFileSync("js/operations-collection-v8.js", "utf8");
const css = fs.readFileSync("css/operations-collection-v8.css", "utf8");

assert.match(ui, /selectedMasterId/);
assert.match(ui, /selectedDuplicateMasterIds/);
assert.match(ui, /name="reviewMasterTarget"/);
assert.match(ui, /선택 기존중복 정리/);
assert.match(ui, /조건유지 통합/);
assert.match(ui, /신규조건 갱신/);
assert.match(ui, /reviewAction: action, masterId: masterId/);
assert.match(ui, /apiPost\("consolidateExistingMasters"/);
assert.match(ui, /신규 조건 갱신은 기준이 될 신규매물 1건만 선택/);
assert.match(ui, /safeCandidateIds/);
assert.match(ui, /selectedItemsMatchMaster/);
assert.match(ui, /기존 " \+ \(index \+ 1\) \+ "번과/);
assert.match(ui, /복수 후보 · 대표를 직접 선택/);
assert.match(ui, /review-rental-values/);

assert.match(css, /review-candidate-compact\.selected-master/);
assert.match(css, /review-match-group-0/);
assert.match(css, /review-match-ambiguous/);
assert.match(css, /review-match-different/);
assert.match(css, /review-rental-values/);
assert.match(css, /max-width:1366px/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /height:auto/);

console.log("review safe merge UI tests passed");
