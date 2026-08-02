const assert = require("node:assert/strict");
const fs = require("node:fs");

const script = fs.readFileSync("js/script.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(
  script,
  /function isGongsilBoxItem\(item\)[\s\S]*?Array\.isArray\(item\.sourceTypesV8\)[\s\S]*?unifiedSources\.indexOf\("gongsil"\) >= 0 \|\| isFieldVisitItem\(item\)/,
  "a unified listing must remain visible as Gongsil when any linked original is from GongsilBox"
);
assert.match(
  html,
  /script\.js\?v=6\.5\.60-reliable-naver-roadview/,
  "the production page must load the relation-aware Gongsil filter"
);

console.log("gongsil unified source visibility tests passed");
