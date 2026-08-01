const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);
const code = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_Code.gs_v6.5.4_연락처6개_안전작업대기열_최종본.gs",
  "utf8"
);
const ui = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const listing = fs.readFileSync("js/script.js", "utf8");

const gasContext = {
  Utilities: {
    formatDate() { return "2026-08-01 10:00:00"; },
    getUuid() { return "uuid"; },
    DigestAlgorithm: {SHA_256: "SHA_256"},
    Charset: {UTF_8: "UTF_8"},
    computeDigest() { return Array(32).fill(7); }
  },
  Session: {getScriptTimeZone() { return "Asia/Seoul"; }}
};
vm.createContext(gasContext);
vm.runInContext(backend, gasContext);

function tellRow(sourceId, room, phone, active = "Y") {
  return ["T-" + sourceId + phone, "공실박스", sourceId, "서구 괴정동 1-1", "테스트건물",
    room, "임", phone, "2026-08-01", "2026-08-01", active];
}

const index = gasContext.mmV8TellContactIndex_([
  tellRow("G-101", "101호", "010-1111-1111"),
  tellRow("G-102", "102호", "010-2222-2222"),
  tellRow("G-101", "101호", "010-3333-3333", "N")
]);
const contacts = gasContext.mmV8ContactsForOriginals_([
  {originalId: "O-101", propertyId: "M-101", source: "공실박스", sourceId: "G-101"}
], index);

assert.deepEqual(Array.from(contacts, contact => contact.phone), ["010-1111-1111"]);
assert.equal(contacts[0].room, "101호");
assert.doesNotMatch(JSON.stringify(contacts), /010-2222-2222|010-3333-3333/,
  "같은 주소의 다른 출처매물ID나 비활성 연락처를 섞으면 안 됩니다.");

assert.match(code, /action === "unifiedListingContacts"/);
assert.match(code, /mmV8UnifiedListingContacts_\(params\.propertyId\)/);
assert.match(backend, /function mmV8UnifiedListingContacts_\(propertyId\)/);
assert.match(backend, /mmSourceKey_\(original\.source, original\.sourceId\)/);

const window = {innerWidth: 1280, addEventListener() {}};
const uiContext = {
  window,
  console,
  URLSearchParams,
  fetch() { throw new Error("network must not be used in attach test"); }
};
vm.createContext(uiContext);
vm.runInContext(ui, uiContext);
const items = [{propertyId: "M-101"}];
window.JSUnifiedListingsV8.attach(items, {groups: {"M-101": [
  {source: "네이버", sourceId: "N-101", contactCount: 0},
  {source: "공실박스", sourceId: "G-101", contactCount: 1}
]}});
assert.equal(items[0].gongsilContactCountV8, 1);

assert.match(listing, /Number\(item && item\.gongsilContactCountV8\) > 0/);
assert.match(listing, /JSUnifiedListingsV8\.loadContacts\(propertyId\)/);
assert.match(listing, /공실박스 원본[\s\S]*?contact\.room/);
assert.doesNotMatch(listing, /contactListRaw\s*=\s*JSON\.stringify\(result && result\.contacts\)/,
  "조회한 공실박스 연락처를 메인 매물 연락처 JSON으로 복사하면 안 됩니다.");

console.log("gongsil card contact link tests passed");
