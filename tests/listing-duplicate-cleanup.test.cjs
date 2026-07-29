const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("js/listing-duplicate-cleanup-v1.js", "utf8");
const css = fs.readFileSync("css/listing-duplicate-cleanup-v1.css", "utf8");
const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);

assert.match(html, /listing-duplicate-cleanup-v1\.css/);
assert.match(html, /listing-duplicate-cleanup-v1\.js/);
assert.match(ui, /대표로 유지/);
assert.match(ui, /중복으로 정리/);
assert.match(ui, /consolidateExistingMasters/);
assert.match(ui, /임대조건이 달라도 사용자가 같은 매물로 직접 선택하면 정리할 수 있습니다/);
assert.match(ui, /manualOverride/);
assert.match(ui, /사용자 임대조건 차이 동일매물 확인/);
assert.match(ui, /101호와 102호처럼 다른 공간은 차단/);
assert.match(ui, /removeDuplicatesFromCurrentView/);
assert.match(ui, /window\.loadSheet\(true\)/);
assert.match(css, /duplicate-cleanup-primary/);
assert.match(css, /duplicate-cleanup-target/);
assert.match(css, /flex:0 0 72px!important/);

assert.match(backend, /MM_DUPLICATE_ARCHIVE_SHEET = "중복통합이력"/);
assert.match(backend, /mmIsNearDuplicate_\(primary, duplicateForCheck\)/);
assert.match(backend, /manualOverride/);
assert.match(backend, /자동 중복기준 예외/);
assert.match(backend, /사용자 임대조건 차이 동일매물 확인/);
assert.match(backend, /if \(!mmRoomsCanRepresentSameSpace_\(primary\[2\], duplicate\[2\]\)\)/);
assert.match(backend, /mmRewriteDuplicateReferences_/);
assert.match(backend, /mmArchiveAndRemoveDuplicateMasters_/);
assert.match(backend, /mmRemoveSheetRowsFast_/);
assert.doesNotMatch(backend, /masterSheet\.deleteRow\(rowNumber\)/);
assert.match(backend, /mmWriteDirtyExisting_\(sheet, rows, dirty, rows\.length, config\.width, 3\)/);
assert.match(backend, /rawIdList\.length <= 10/);
assert.match(backend, /mmIsNearDuplicate_\(master, item\)/);
assert.match(backend, /mmRoomsCanRepresentSameSpace_\(master\[2\], item\.room\)/);

console.log("listing duplicate cleanup tests passed");
