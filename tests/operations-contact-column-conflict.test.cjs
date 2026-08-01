const fs = require("fs");
const assert = require("assert");

const backendPath =
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/" +
  "JS부동산_통합운영시스템_v7.gs";
const backend = fs.readFileSync(backendPath, "utf8");

assert.match(
  backend,
  /var MM_MASTER_CONTACT_LIST_COLUMN = 19;[\s\S]*var MM_MASTER_REPRESENTATIVE_SOURCE_COLUMN = 31;/
);
assert.match(
  backend,
  /"운영상태", "연락처목록"[\s\S]*"운영메모", "대표출처"/
);
assert.match(
  backend,
  /function mmMasterSource_\(row\)[\s\S]*MM_MASTER_REPRESENTATIVE_SOURCE_COLUMN - 1[\s\S]*row\[14\]/
);
assert.match(
  backend,
  /function mmReviewWorkspace_\(query\)[\s\S]*area: row\[8\], source: mmMasterSource_\(row\)/
);
assert.doesNotMatch(
  backend,
  /function mmReviewWorkspace_\(query\)[\s\S]*?source:\s*mmText_\(row\[18\]\s*\|\|\s*row\[14\]\)/
);
assert.match(
  backend,
  /function mmEnsureMasterContactSchema_\(spreadsheet\)[\s\S]*knownSource[\s\S]*contactValues\[index\]\[0\] = "";/
);
assert.match(
  backend,
  /function mmMergeItemIntoMaster_[\s\S]*v8 통합매물은 물리공간의 껍데기[\s\S]*row\[16\] = "";/
);
assert.doesNotMatch(
  backend,
  /function mmMergeItemIntoMaster_[\s\S]*?mmMergeExactGongsilContacts_\(row, item\)/
);
assert.match(backend, /var MM_V8_TELL_SHEET = "JS_연락처원본"/);
assert.match(backend, /v8부터 공실박스 연락처는 JS_연락처원본\(Tell\)에만 보관/);

console.log("operations contact-column conflict tests: ok");
