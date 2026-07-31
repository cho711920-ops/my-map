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
  /function mmMergeItemIntoMaster_[\s\S]*row\[MM_MASTER_REPRESENTATIVE_SOURCE_COLUMN - 1\] = item\.source;/
);
assert.doesNotMatch(
  backend,
  /function mmMergeItemIntoMaster_[\s\S]*?row\[18\] = item\.source;/
);

console.log("operations contact-column conflict tests: ok");
