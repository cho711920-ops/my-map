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
assert.match(ui, /review-value-deposit/);
assert.match(ui, /review-value-rent/);
assert.match(ui, /review-value-area/);

assert.match(css, /review-candidate-compact\.selected-master/);
assert.match(css, /review-value-deposit/);
assert.match(css, /review-value-rent/);
assert.match(css, /review-value-area/);
assert.match(css, /max-width:1366px/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /height:auto/);

console.log("review safe merge UI tests passed");
