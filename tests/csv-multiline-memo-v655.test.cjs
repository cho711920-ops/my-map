const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const scriptSource = fs.readFileSync("js/script.js", "utf8");
const mapSource = fs.readFileSync("js/map.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");

const parserMatch = scriptSource.match(
  /function parseCSVRecordsV655\(data\) \{[\s\S]*?\n\}\n\n\nfunction itemKey/
);
assert.ok(parserMatch, "줄바꿈 셀을 지원하는 CSV 레코드 파서가 필요합니다.");

const context = {};
vm.createContext(context);
vm.runInContext(parserMatch[0].replace(/\n\n\nfunction itemKey$/, ""), context);

const csv = [
  "\uFEFF건물이름,주소,호실,구분,보증금,월세,관리비,권리금,평수,임대인,세입자,메모,상태,등록일,출처,매물ID,링크,연락처",
  [
    "일반상가",
    "서구 갈마동 263-19",
    "1층",
    "상가점포",
    "3000",
    "220",
    "",
    "",
    "30",
    "",
    "",
    "\"첫 줄\r\n둘째 줄\"",
    "임장가자",
    "2026.07.30",
    "직접등록",
    "M-safe-id",
    "",
    "\"[{\"\"role\"\":\"\"임대인\"\",\"\"phone\"\":\"\"010-1111-2222\"\"}]\""
  ].join(",")
].join("\r\n");

const rows = context.parseCSVRecordsV655(csv);
assert.equal(rows.length, 2);
assert.equal(rows[1][11], "첫 줄\n둘째 줄");
assert.equal(rows[1][15], "M-safe-id");
assert.equal(
  rows[1][17],
  '[{"role":"임대인","phone":"010-1111-2222"}]'
);

assert.match(mapSource, /var rows = parseCSVRecordsV655\(data\);/);
assert.match(mapSource, /var c = rows\[i\];/);
assert.doesNotMatch(mapSource, /data\.trim\(\)\.split\("\\n"\)/);
assert.match(indexSource, /js\/script\.js\?v=6\.5\.82-revalidated-geocode-cache/);
assert.match(indexSource, /js\/map\.js\?v=8\.2\.13-local-geocode-first/);

console.log("multiline memo CSV tests passed");
