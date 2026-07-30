const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "js", "gongsil-collector.js"),
  "utf8"
);

const start = source.indexOf("  function contactLabel(value)");
const end = source.indexOf("  function landlordPriority(label)", start);
assert(start >= 0 && end > start, "공실박스 연락처 역할 함수를 찾지 못했습니다.");

const context = {
  text(value) {
    return String(value == null ? "" : value).trim();
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

[
  ["남", "남성"],
  ["남성", "남성"],
  ["남자", "남성"],
  ["사장", "남성"],
  ["여", "여성"],
  ["여성", "여성"],
  ["여자", "여성"],
  ["사모", "여성"],
  ["1", "남성"],
  ["2", "여성"],
  ["5", "가족"],
  ["G", "관리업체"],
  ["B", "부동산"],
  ["J", "주인"],
  ["S", "세입자"]
].forEach(([input, expected]) => {
  assert.strictEqual(
    context.contactLabel(input),
    expected,
    `공실박스 연락처 역할 ${input}은(는) ${expected}(으)로 저장되어야 합니다.`
  );
});

console.log("gongsil contact role tests passed");
