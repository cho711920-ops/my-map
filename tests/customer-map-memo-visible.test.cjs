const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(script, /var memoToggleButton\s*=/, "메모 버튼을 한 번만 생성해야 합니다.");
assert.match(
  script,
  /customerMatchControls \+\s*\(customerMatchControls \? memoToggleButton : ''\)/,
  "고객매칭 상태에서는 메모 버튼이 지도목록 작업버튼 앞에 와야 합니다."
);
assert.match(
  script,
  /\(!customerMatchControls \? memoToggleButton : ''\)/,
  "일반 목록에서는 기존 메모 버튼 위치를 유지해야 합니다."
);
assert.match(
  css,
  /\.customer-match-inline-actions \+ \.item-memo-toggle/,
  "고객매칭 메모 버튼은 눈에 띄는 전용 스타일이 필요합니다."
);
assert.match(html, /script\.js\?v=6\.5\.13-customer-map-memo/);

console.log("customer map memo visibility tests passed");
