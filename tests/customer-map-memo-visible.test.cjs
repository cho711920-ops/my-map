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
  /customerMatchControls \? ' customer-match-card-actions-v653' : ''/,
  "고객매칭 지도목록에는 너비 고정용 전용 클래스가 필요합니다."
);
assert.match(
  script,
  /'<\/div>' \+\s*memoToggleButton \+\s*'<\/div>'/,
  "메모 버튼은 모든 작업버튼의 맨 뒤에 있어야 합니다."
);
assert.match(
  css,
  /\.customer-match-card-actions-v653\s*\{[^}]*overflow-x:\s*hidden/s,
  "고객매칭 작업줄은 확대·축소 시 가로 스크롤 뒤로 버튼이 숨지 않아야 합니다."
);
assert.match(
  css,
  /\.customer-match-card-actions-v653 \.item-action-left > button\s*\{[^}]*flex:\s*1 1 0/s,
  "일반 작업버튼은 가용 너비에 맞춰 함께 줄어들어야 합니다."
);
assert.match(html, /script\.js\?v=6\.5\.37-gongsil-source-relations/);

console.log("customer map memo visibility tests passed");
