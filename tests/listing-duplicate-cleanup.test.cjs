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
assert.match(ui, /주소·층\/호실·보증금·월세가 같고 평수 차 1평 미만/);
assert.match(ui, /manualOverride/);
assert.match(ui, /사용자 동일매물 직접 확인/);
assert.match(css, /duplicate-cleanup-primary/);
assert.match(css, /duplicate-cleanup-target/);
assert.match(css, /flex:0 0 72px!important/);

assert.match(backend, /MM_DUPLICATE_ARCHIVE_SHEET = "중복통합이력"/);
assert.match(backend, /mmIsNearDuplicate_\(primary, duplicateForCheck\)/);
assert.match(backend, /manualOverride/);
assert.match(backend, /자동 중복기준 예외/);
assert.match(backend, /mmRewriteDuplicateReferences_/);
assert.match(backend, /mmArchiveAndRemoveDuplicateMasters_/);
assert.match(backend, /masterSheet\.deleteRow\(rowNumber\)/);
assert.match(backend, /mmIsNearDuplicate_\(master, item\)/);
assert.match(backend, /mmRoomsCanRepresentSameSpace_\(master\[2\], item\.room\)/);

console.log("listing duplicate cleanup tests passed");
