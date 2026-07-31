const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");
const duplicateUi = fs.readFileSync("js/listing-duplicate-cleanup-v1.js", "utf8");
const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);

const helperMatch = backend.match(
  /function mmResolveCustomerMatchByPair_\(sheet, customerId, masterId\) \{[\s\S]*?\n\}\n\nfunction mmUpdateCustomerMatch_/
);
assert.ok(helperMatch, "고객ID와 대표매물ID로 현재 매칭을 다시 찾는 함수가 필요합니다.");

const context = {
  MM_MATCH_HEADERS: Array.from({ length: 13 }, (_, index) => "H" + index),
  mmText_: (value) => String(value == null ? "" : value).trim(),
  mmNumber_: (value) => Number(value) || 0
};
vm.createContext(context);
vm.runInContext(
  helperMatch[0].replace(/\n\nfunction mmUpdateCustomerMatch_$/, ""),
  context
);

const customerId = "C-safe";
const masterId = "M-current";
const currentMatchId = customerId + "|" + masterId + "|3";
const row = [
  currentMatchId, customerId, masterId, 3, 75, "통과", "", "", "신규",
  "2026-07-31", "2026-07-31", "", ""
];
const sheet = {
  getLastRow() {
    return 2;
  },
  getRange(start, column) {
    if (start === 2 && column === 2) {
      return {
        createTextFinder(value) {
          return {
            matchEntireCell() {
              return this;
            },
            findAll() {
              return value === customerId ? [{ getRow: () => 2 }] : [];
            }
          };
        }
      };
    }
    if (start === 2 && column === 1) {
      return { getValues: () => [row.slice()] };
    }
    throw new Error("Unexpected range: " + [start, column].join(","));
  }
};

const resolved = context.mmResolveCustomerMatchByPair_(
  sheet, customerId, masterId
);
assert.equal(resolved.rowNumber, 2);
assert.equal(resolved.row[0], currentMatchId);

assert.match(
  backend,
  /if \(\(!row \|\| identityChanged\) && requestedCustomerId && requestedMasterId\)[\s\S]*?mmResolveCustomerMatchByPair_/
);
assert.match(backend, /recoveredMatchId:\s*Boolean\(requestedMatchId && requestedMatchId !== resolvedMatchId\)/);
assert.match(
  operations,
  /window\.refreshCustomerMatchesAfterDuplicateMergeV7186 = function\(\)[\s\S]*?apiGet\("customerMatches"[\s\S]*?operationsMatchContextByPropertyId/
);
assert.match(
  operations,
  /var resolvedMatchId = text\(result && result\.matchId\) \|\| previousMatchId;[\s\S]*?context\.matchId = resolvedMatchId/
);
assert.match(duplicateUi, /refreshCustomerMatchesAfterDuplicateMergeV7186/);
assert.match(html, /operations-center-v7\.js\?v=7\.18\.6-stale-match-id-recovery/);
assert.match(html, /listing-duplicate-cleanup-v1\.js\?v=1\.5\.1-customer-match-refresh/);

console.log("customer match stale ID recovery tests passed");
