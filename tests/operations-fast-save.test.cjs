const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ui = fs.readFileSync("js/operations-collection-v8.js", "utf8");
const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);
const apiBackend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_Code.gs_v6.5.4_연락처6개_안전작업대기열_최종본.gs",
  "utf8"
);

assert.match(ui, /검증목록을 최신화합니다/);
assert.match(ui, /setTimeout\(function\(\) \{ loadReviews\(true, true\); \}, 0\)/);
assert.doesNotMatch(
  ui,
  /return loadReviews\(true, true\)\.then\(function\(\) \{\s*message\(number\(result\.consolidated\)/
);

assert.match(backend, /MM_VERSION = "7\.26\.7"/);
assert.match(backend, /manualMergeConfirmed === true/);
assert.match(backend, /function mmManualConditionKeepMergeAllowed_/);
assert.match(backend, /사용자 확인 조건차이 통합 · 기존 임대조건 유지/);
assert.match(backend, /function mmReviewWorkspace_\(query\)/);
assert.match(backend, /allPendingTotal/);
assert.match(backend, /searchKey \? 300 : 120/);
assert.match(apiBackend, /mmReviewWorkspace_\(params\.query\)/);
assert.match(backend, /function mmRestoreReviewSourceLinkFromState_/);
assert.match(backend, /function mmVerifyReviewPreferredLinkWrites_/);
assert.match(backend, /preferredLinkChecks/);
assert.match(apiBackend, /mmVerifyReviewPreferredLinkWrites_/);
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
const rawRowsBody = backend.match(
  /function mmRawRowsForReviews_\(reviews\) \{([\s\S]*?)\n\}\n\nfunction mmSourceItemFromReviewMap_/
);
assert.ok(rawRowsBody);
assert.doesNotMatch(rawRowsBody[1], /createTextFinder\(rawId\)/);
assert.match(rawRowsBody[1], /getDisplayValues\(\)/);
assert.match(backend, /liveCandidatesByAddressPrice/);
assert.match(backend, /mmRoomsCanRepresentSameSpace_\(master\[2\], group\.room\)/);
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

const context = {
  Utilities: {
    formatDate() { return "2026-07-31 15:00:00"; }
  },
  Session: {
    getScriptTimeZone() { return "Asia/Seoul"; }
  }
};
vm.createContext(context);
vm.runInContext(backend, context);

assert.equal(context.mmReviewSearchKey_("서구 가장동 55"), "서구가장동55");
assert.equal(
  context.mmReviewSearchKey_("가장동55"),
  "가장동55"
);
assert.ok(
  context.mmReviewSearchKey_("서구 가장동 55").includes(
    context.mmReviewSearchKey_("가장동55")
  )
);

const manualMaster = Array(31).fill("");
manualMaster[0] = "기존 건물";
manualMaster[1] = "서구 도안동 887";
manualMaster[2] = "1층";
manualMaster[3] = "상가";
manualMaster[4] = 1000;
manualMaster[5] = 70;
manualMaster[8] = 10;
manualMaster[14] = "직접등록";
manualMaster[15] = "M-MANUAL";
manualMaster[30] = "직접등록";
const incomingDaangn = {
  source: "당근",
  sourceId: "D-887",
  address: "서구 도안동 887",
  room: "1층",
  buildingName: "",
  category: "상가",
  deposit: 2000,
  rent: 60,
  fee: "",
  premium: "",
  area: 9.9,
  cleanMemo: "",
  status: "",
  tags: [],
  collectedAt: "2026-07-31 15:00:00",
  link: "https://www.daangn.com/kr/realty/887"
};
assert.equal(context.mmManualConditionKeepMergeAllowed_(manualMaster, incomingDaangn), true);
assert.equal(
  context.mmManualConditionKeepMergeAllowed_(
    manualMaster,
    { ...incomingDaangn, room: "2층" }
  ),
  false
);
context.mmMergeItemIntoMaster_(manualMaster, incomingDaangn, false, true);
assert.equal(manualMaster[4], 1000);
assert.equal(manualMaster[5], 70);
assert.equal(manualMaster[8], 10);
assert.equal(manualMaster[16], incomingDaangn.link);
assert.equal(manualMaster[26], incomingDaangn.link);

const recoveredSourceItem = {
  source: "당근",
  sourceId: "D-887",
  link: ""
};
assert.equal(
  context.mmRestoreReviewSourceLinkFromState_(
    {
      sourceByKey: { "당근|D-887": 0 },
      sourceRows: [[
        "M-MANUAL", "당근", "D-887", incomingDaangn.link
      ]]
    },
    recoveredSourceItem
  ),
  true
);
assert.equal(recoveredSourceItem.link, incomingDaangn.link);

const storedLinkColumns = Array(14).fill("");
storedLinkColumns[0] = "M-MANUAL";
storedLinkColumns[1] = incomingDaangn.link;
storedLinkColumns[11] = incomingDaangn.link;
assert.deepEqual(
  JSON.parse(JSON.stringify(context.mmVerifyReviewPreferredLinkWrites_(
    {
      getSheetByName() {
        return {
          getLastRow() { return 2; },
          getRange() {
            return { getValues() { return [storedLinkColumns]; } };
          }
        };
      }
    },
    [{ masterId: "M-MANUAL", source: "당근" }]
  ))),
  { checked: 1, daangnPreferred: 1 }
);

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
