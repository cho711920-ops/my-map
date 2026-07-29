const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ui = fs.readFileSync("js/operations-collection-v8.js", "utf8");
const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);

assert.match(ui, /검증목록을 최신화합니다/);
assert.match(ui, /setTimeout\(function\(\) \{ loadReviews\(true, true\); \}, 0\)/);
assert.doesNotMatch(
  ui,
  /return loadReviews\(true, true\)\.then\(function\(\) \{\s*message\(number\(result\.consolidated\)/
);

assert.match(backend, /MM_VERSION = "7\.23\.8"/);
assert.match(backend, /sourceKeys: sourceKeys/);
assert.match(backend, /mmWriteDirtyMappedExisting_/);
assert.match(
  backend,
  /function mmLoadState_[\s\S]*?var sourceSheetRowNumbers = null;[\s\S]*?sourceSheetRowNumbers: sourceSheetRowNumbers/
);
const reconcileBody = backend.match(
  /function mmReconcileCompletedExternalSessions_\(\) \{([\s\S]*?)\n\}/
);
assert.ok(reconcileBody);
assert.doesNotMatch(reconcileBody[1], /options\.sourceKeys/);
assert.match(backend, /mmRemoveSheetRowsFast_/);
assert.match(backend, /createTextFinder\(rawId\)\.matchEntireCell\(true\)\.findNext\(\)/);
assert.match(backend, /function mmFindRowsByTextFast_/);
assert.match(backend, /function mmRewriteDuplicateSourceReferencesFast_/);
assert.match(backend, /function mmRewriteReviewDuplicateReferencesFast_/);
assert.match(
  backend,
  /function mmConsolidateExistingMastersFromWeb_[\s\S]*?createTextFinder\(primaryMasterId\)[\s\S]*?mmRewriteDuplicateSourceReferencesFast_[\s\S]*?mmRewriteReviewDuplicateReferencesFast_/
);
const consolidateBody = backend.match(
  /function mmConsolidateExistingMastersFromWeb_\(body\) \{([\s\S]*?)\n\}\n\nfunction mmFindRowsByTextFast_/
);
assert.ok(consolidateBody);
assert.doesNotMatch(consolidateBody[1], /mmLoadState_/);
assert.doesNotMatch(consolidateBody[1], /reviewSheet\.getRange\(\s*2,\s*1,\s*reviewSheet\.getLastRow\(\) - 1/);

const context = {};
vm.createContext(context);
vm.runInContext(backend, context);

const sheetRows = [
  ["header"],
  ["M-1"],
  ["M-2"],
  ["M-3"],
  ["M-4"],
  ["M-5"]
];
const mockSheet = {
  getLastRow() {
    let row = sheetRows.length;
    while (row > 1 && sheetRows[row - 1][0] === "") row -= 1;
    return row;
  },
  getRange(start, column, count) {
    assert.equal(column, 1);
    return {
      getValues() {
        return sheetRows.slice(start - 1, start - 1 + count).map((row) => row.slice());
      },
      setValues(values) {
        values.forEach((row, index) => { sheetRows[start - 1 + index] = row.slice(); });
      },
      clearContent() {
        for (let index = 0; index < count; index += 1) sheetRows[start - 1 + index] = [""];
      }
    };
  }
};
context.mmRemoveSheetRowsFast_(mockSheet, [3, 6], 1);
assert.deepEqual(
  sheetRows.slice(1, 4).map((row) => row[0]).sort(),
  ["M-1", "M-3", "M-4"].sort()
);
assert.equal(mockSheet.getLastRow(), 4);

const mappedRows = [["S-10", "old"], ["S-80", "changed"]];
const mappedSheetData = Array.from({ length: 82 }, () => ["", ""]);
const mappedSheet = {
  getRange(start, column, count) {
    assert.equal(column, 1);
    return {
      setValues(values) {
        assert.equal(values.length, count);
        values.forEach((row, index) => { mappedSheetData[start - 1 + index] = row.slice(); });
      }
    };
  }
};
context.mmWriteDirtyMappedExisting_(mappedSheet, mappedRows, { 1: true }, [10, 80], 2);
assert.deepEqual(mappedSheetData[79], ["S-80", "changed"]);
assert.deepEqual(mappedSheetData[9], ["", ""]);

console.log("operations fast save tests passed");
