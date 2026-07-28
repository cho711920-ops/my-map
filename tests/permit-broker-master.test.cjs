const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const master = JSON.parse(read("data/industry-master.json"));
const catalog = JSON.parse(read("data/industry-catalog.json"));
const ui = read("js/permit-diagnosis-ui.js");
const selector = read("js/industry-candidate-selector.js");

const all = catalog.industries.concat(master.industries);
const ids = new Set(all.map((item) => item.id));
[
  "general-restaurant", "rest-restaurant", "internet-computer-game",
  "beauty-nail", "karaoke", "private-academy", "fitness",
  "clinic", "pharmacy", "pet-hotel", "warehouse", "auto-repair"
].forEach((id) => assert(ids.has(id), `업종 누락: ${id}`));
assert(all.every((item) => item.id && item.officialName && item.keywords.length));
assert(ui.includes("industry-master.json"));
assert(ui.includes("custom-review-"), "검색되지 않는 업종도 관할확인 후보로 제공해야 합니다.");
assert(selector.includes("관할확인 필요"));
assert(selector.includes("상세규칙 연결"));

console.log("permit broker master tests: ok");
