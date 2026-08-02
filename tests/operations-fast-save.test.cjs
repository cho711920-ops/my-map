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
assert.match(ui, /실제 시트 저장·재확인/);
assert.match(ui, /reviewRowsRemovedVerified/);
assert.match(ui, /setTimeout\(function\(\) \{ loadReviews\(true, true\); \}, 0\)/);
assert.doesNotMatch(
  ui,
  /return loadReviews\(true, true\)\.then\(function\(\) \{\s*message\(number\(result\.consolidated\)/
);

assert.match(backend, /MM_VERSION = "8\.1\.1"/);
assert.match(backend, /function mmEnsureCustomerSystemReady_\(\)/);
assert.match(backend, /function mmSaveCustomer_\(body\)[\s\S]*?mmEnsureCustomerSystemReady_\(\)/);
assert.match(backend, /function mmAddCustomerActivity_\(body\)[\s\S]*?mmEnsureCustomerSystemReady_\(\)/);
assert.match(backend, /body\.compactResponse === true/);
assert.match(backend, /manualMergeConfirmed === true/);
assert.match(backend, /function mmManualConditionKeepMergeAllowed_/);
assert.match(backend, /사용자가 같은 실제 공간으로 확인/);
assert.match(backend, /function mmReviewWorkspace_\(query\)/);
assert.match(backend, /allPendingTotal/);
assert.match(backend, /searchKey \? 300 : 120/);
assert.match(apiBackend, /mmReviewWorkspace_\(params\.query\)/);
assert.match(backend, /function mmRestoreReviewSourceLinkFromState_/);
assert.match(backend, /function mmVerifyReviewPreferredLinkWrites_/);
assert.match(backend, /function mmVerifyReviewActionWrites_/);
assert.match(backend, /function mmVerifyReviewIdsRemoved_/);
assert.match(backend, /function mmLoadReviewBatchRows_/);
assert.match(backend, /preferredLinkChecks/);
assert.match(apiBackend, /mmVerifyReviewPreferredLinkWrites_/);
assert.match(apiBackend, /actionWritesVerified/);
assert.match(apiBackend, /reviewRowsRemovedVerified/);
assert.match(backend, /sourceKeys: sourceKeys/);
assert.match(backend, /sourceRowsForKeys = action === "각각등록" \? reviewRows : requestedRows/);
assert.match(backend, /stateOptions\.skipMasterRows = true/);
assert.match(backend, /stateOptions\.masterIds/);
assert.match(backend, /stateOptions\.masterAddresses = requestedRows\.map/);
assert.match(backend, /reviewLoad\.rows\.map\(function\(review\) \{ return review\[6\]; \}\)/);
assert.match(backend, /masterSheetRowNumbers: masterSheetRowNumbers/);
assert.match(backend, /loadedReviewRows: reviewRows\.length/);
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
  /function mmRawRowsForReviews_\(reviews, spreadsheet\) \{([\s\S]*?)\n\}\n\nfunction mmSourceItemFromReviewMap_/
);
assert.ok(rawRowsBody);
assert.doesNotMatch(rawRowsBody[1], /createTextFinder\(rawId\)/);
assert.match(rawRowsBody[1], /getDisplayValues\(\)/);
assert.match(backend, /options\.spreadsheet \|\| mmSpreadsheet_\(\)/);
assert.match(backend, /mmRawRowsForReviews_\(requestedRows, spreadsheet\)/);
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
    formatDate() { return "2026-07-31 15:00:00"; },
    getUuid() { return "test-uuid"; },
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest() { return Array(32).fill(1); }
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
assert.equal(manualMaster[16], "");
assert.equal(manualMaster[26], "");

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
assert.equal(
  context.mmNormalizeSourceItem_("당근", {
    sourceId: "D-LINK",
    link: incomingDaangn.link
  }).link,
  incomingDaangn.link
);

const retryMaster = Array(31).fill("");
retryMaster[1] = "서구 가장동 55";
retryMaster[2] = "1층";
retryMaster[4] = 500;
retryMaster[5] = 55;
retryMaster[8] = 8.9;
retryMaster[15] = "M-RETRY";
retryMaster[17] = "활성";
retryMaster[30] = "당근";
const retrySource = Array(19).fill("");
retrySource[0] = "M-RETRY";
retrySource[1] = "당근";
retrySource[2] = "3930784";
retrySource[3] = incomingDaangn.link;
const retrySourceItem = {
  ...incomingDaangn,
  source: "당근",
  sourceId: "3930784",
  address: "서구 가장동 55",
  room: "1층",
  deposit: 500,
  rent: 55,
  area: 8.9
};
const retryState = {
  masterRows: [retryMaster],
  sourceRows: [retrySource],
  masterById: { "M-RETRY": 0 },
  sourceByKey: { "당근|3930784": 0 },
  dirtyMaster: {},
  dirtySource: {}
};
const retryReview = Array(28).fill("");
retryReview[23] = "R-RETRY";
const retryHistory = [];
const retryResult = context.mmApplyReviewActionToState_(
  retryState,
  retryReview,
  retrySourceItem,
  "각각등록",
  retryHistory,
  []
);
assert.equal(retryResult.masterId, "M-RETRY");
assert.equal(retryResult.recovered, false);
assert.equal(retryState.masterRows.length, 1);
assert.equal(retryState.masterRows[0][16], "");
assert.equal(retryState.masterRows[0][26], "");
assert.equal(retryHistory.length, 0);

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
          getRange(_start, column) {
            return {
              getDisplayValues() {
                assert.equal(column, 16);
                return [["M-MANUAL"]];
              },
              getValues() { return [storedLinkColumns]; }
            };
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

const reviewRowsForTargetedLoad = [
  Array(28).fill(""),
  Array(28).fill(""),
  Array(28).fill("")
];
reviewRowsForTargetedLoad[0][23] = "R-1";
reviewRowsForTargetedLoad[1][23] = "R-2";
reviewRowsForTargetedLoad[2][23] = "R-3";
reviewRowsForTargetedLoad[0][6] = "서구 도안동 887";
reviewRowsForTargetedLoad[1][6] = "서구 도안동 887";
reviewRowsForTargetedLoad[2][6] = "서구 가장동 55";
const reviewLoadSheet = {
  getLastRow() { return 4; },
  getRange(start, column, count, width) {
    return {
      getDisplayValues() {
        assert.equal(width, 1);
        assert.ok(column === 24 || column === 7);
        return reviewRowsForTargetedLoad
          .slice(start - 2, start - 2 + count)
          .map((row) => [row[column - 1]]);
      },
      getValues() {
        assert.equal(column, 1);
        assert.equal(width, 28);
        return reviewRowsForTargetedLoad
          .slice(start - 2, start - 2 + count)
          .map((row) => row.slice());
      }
    };
  }
};
const targetedReviewLoad = context.mmLoadReviewBatchRows_(
  reviewLoadSheet,
  ["R-2"],
  false
);
assert.equal(targetedReviewLoad.allRowsLoaded, false);
assert.equal(targetedReviewLoad.rows.length, 1);
assert.equal(targetedReviewLoad.rows[0][23], "R-2");
assert.equal(targetedReviewLoad.rowNumberById["R-2"], 3);
const addressExpandedReviewLoad = context.mmLoadReviewBatchRows_(
  reviewLoadSheet,
  ["R-1"],
  false,
  ["서구 도안동 887"]
);
assert.equal(addressExpandedReviewLoad.rows.length, 2);
assert.deepEqual(
  Array.from(addressExpandedReviewLoad.rows, (row) => row[23]),
  ["R-1", "R-2"]
);

assert.equal(
  context.mmVerifyReviewIdsRemoved_(
    {
      getLastRow() { return 2; },
      getRange() {
        return { getDisplayValues() { return [["R-OTHER"]]; } };
      }
    },
    ["R-2"]
  ),
  1
);
assert.throws(
  () => context.mmVerifyReviewIdsRemoved_(
    {
      getLastRow() { return 2; },
      getRange() {
        return { getDisplayValues() { return [["R-2"]]; } };
      }
    },
    ["R-2"]
  ),
  /대기행 1건/
);

function gridSheet(rows) {
  return {
    getLastRow() { return rows.length + 1; },
    getRange(start, column, count, width) {
      const values = rows
        .slice(start - 2, start - 2 + count)
        .map((row) => row.slice(column - 1, column - 1 + width));
      return {
        getValues() { return values.map((row) => row.slice()); },
        getDisplayValues() {
          return values.map((row) => row.map((value) => String(value == null ? "" : value)));
        }
      };
    }
  };
}

const scopedMasterOne = Array(31).fill("");
scopedMasterOne[1] = "서구 도안동 887";
scopedMasterOne[15] = "M-1";
scopedMasterOne[17] = "활성";
const scopedMasterTwo = Array(31).fill("");
scopedMasterTwo[1] = "서구 가장동 55";
scopedMasterTwo[15] = "M-2";
scopedMasterTwo[17] = "활성";
const scopedMasterSheet = gridSheet([scopedMasterOne, scopedMasterTwo]);
const emptySourceSheet = gridSheet([]);
context.SpreadsheetApp = {
  getActiveSpreadsheet() {
    return {
      getSheetByName(name) {
        if (name === "JS부동산 매물현황") return scopedMasterSheet;
        if (name === "매물출처이력") return emptySourceSheet;
        return null;
      }
    };
  }
};
const scopedState = context.mmLoadState_([], {
  masterIds: ["M-2"],
  sourceKeys: [],
  skipReviewHold: true
});
assert.equal(scopedState.masterRows.length, 1);
assert.equal(scopedState.masterRows[0][15], "M-2");
assert.deepEqual(Array.from(scopedState.masterSheetRowNumbers), [3]);
const holdOnlyState = context.mmLoadState_([], {
  skipMasterRows: true,
  sourceKeys: [],
  skipReviewHold: true
});
assert.equal(holdOnlyState.masterRows.length, 0);

const verifyMaster = Array(31).fill("");
verifyMaster[1] = "서구 도안동 887";
verifyMaster[2] = "1층";
verifyMaster[4] = 2000;
verifyMaster[5] = 60;
verifyMaster[6] = 10;
verifyMaster[7] = 0;
verifyMaster[8] = 9.9;
verifyMaster[15] = "M-VERIFY";
verifyMaster[17] = "활성";
const verifySource = Array(19).fill("");
verifySource[0] = "M-VERIFY";
verifySource[1] = "당근";
verifySource[2] = "D-VERIFY";
verifySource[3] = incomingDaangn.link;
verifySource[8] = "Y";
const verifyHoldSource = Array(19).fill("");
verifyHoldSource[1] = "네이버";
verifyHoldSource[2] = "N-HOLD";
verifyHoldSource[8] = "N";
verifyHoldSource[17] = "검증보류";
const verifyHold = Array(28).fill("");
verifyHold[0] = "보류";
verifyHold[23] = "R-HOLD";
const verifySpreadsheet = {
  getSheetByName(name) {
    if (name === "JS부동산 매물현황") return gridSheet([verifyMaster]);
    if (name === "매물출처이력") return gridSheet([verifySource, verifyHoldSource]);
    if (name === "검증보류") return gridSheet([verifyHold]);
    return null;
  }
};
assert.deepEqual(
  JSON.parse(JSON.stringify(context.mmVerifyReviewActionWrites_(
    verifySpreadsheet,
    [
      {
        reviewId: "R-CONDITION",
        action: "조건변경승인",
        masterId: "M-VERIFY",
        created: false,
        source: "당근",
        sourceId: "D-VERIFY",
        link: incomingDaangn.link,
        deposit: 2000,
        rent: 60,
        fee: 10,
        premium: 0,
        area: 9.9
      },
      {
        reviewId: "R-HOLD",
        action: "보류",
        masterId: "",
        created: false,
        source: "네이버",
        sourceId: "N-HOLD",
        link: "",
        deposit: "",
        rent: "",
        fee: "",
        premium: "",
        area: ""
      }
    ]
  ))),
  { checked: 2, sourceChecked: 2, masterChecked: 1, holdChecked: 1 }
);

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
