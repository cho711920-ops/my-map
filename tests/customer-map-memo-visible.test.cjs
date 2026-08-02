const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const unifiedCss = fs.readFileSync(path.join(root, "css", "unified-listings-v8.css"), "utf8");
const operations = fs.readFileSync(path.join(root, "js", "operations-center-v7.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(script, /var memoToggleButton\s*=/, "메모 버튼은 카드마다 한 번만 생성되어야 합니다.");
assert.match(
  script,
  /customerMatchControls \? ' customer-match-card-actions-v653' : ''/,
  "고객매칭 지도 목록에만 전용 배치를 적용해야 합니다."
);
assert.match(
  script,
  /customerMatchMapActionsV721 =[\s\S]*?memoToggleButton \+ customerMatchControls/,
  "메모 버튼은 일반 작업 도구와 같은 카드 안에 있어야 합니다."
);
assert.match(
  unifiedCss,
  /\.customer-match-card-actions-v653\s*\{[^}]*grid-template-rows:\s*29px 24px\s*!important/s,
  "일반 도구와 후보·보류 보조 동작은 서로 다른 줄에 있어야 합니다."
);
assert.match(
  unifiedCss,
  /\.customer-match-card-actions-v653 \.item-action-left\s*\{[^}]*grid-row:\s*1\s*!important/s,
  "내비·로드뷰·대장·원본·수정은 먼저 보이는 도구 줄에 있어야 합니다."
);
assert.match(
  unifiedCss,
  /\.customer-match-card-actions-v653 \.item-action-left > \.item-source-link-btn\s*\{[^}]*min-width:\s*106px\s*!important[^}]*background:\s*#0877dc\s*!important/s,
  "원본 펼치기 버튼은 충분한 너비와 핵심 파란색을 유지해야 합니다."
);
assert.match(
  unifiedCss,
  /\.customer-match-card-main-v654 \.item-compact-price-v650\.price-line\s*\{[^}]*background:\s*#f2f8ff[^}]*font-size:\s*12\.5px\s*!important/s,
  "고객매칭 카드에서 임대조건이 가장 먼저 읽혀야 합니다."
);
assert.match(script, /customer-match-card-grid-v654/);
assert.match(script, /customer-match-card-main-v654/);
assert.match(html, /id="customerMatchMapStatusCompactV2"[^>]*hidden/);
assert.ok(
  html.indexOf('class="quick-add-btn quick-add-with-sync') < html.indexOf('id="customerMatchMapStatusCompactV2"'),
  "고객매칭 상태는 빠른등록 바로 뒤에 배치되어야 합니다."
);
assert.match(operations, /compactStatus\.hidden = false/);
assert.match(operations, /compactStatus\.hidden = true/);
assert.match(unifiedCss, /\.map-quick-tools\s*\{[^}]*\+ 2px\)/s);
assert.match(unifiedCss, /\.header\s*\{[^}]*justify-content:\s*center\s*!important[^}]*font-size:\s*27px\s*!important/s);
assert.match(html, /script\.js\?v=6\.5\.52-customer-contact-return/);

console.log("customer map card layout tests passed");
