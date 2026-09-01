const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const script = fs.readFileSync("js/script.js", "utf8");
const css = fs.readFileSync("css/header-professional-v1.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const cardStart = script.indexOf("var cardWarmupTimerV6107 = 0;");
const cardEnd = script.indexOf("div.ondblclick = function", cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, "카드 선행조회 블록이 있어야 합니다.");
const cardBlock = script.slice(cardStart, cardEnd);
assert.match(cardBlock, /window\.setTimeout\(function\(\) \{[\s\S]*?\}, 180\)/);
assert.match(cardBlock, /div\.onpointerleave = cancelCardWarmupV6107/);
assert.match(cardBlock, /div\.onpointerdown = cancelCardWarmupV6107/);
assert.match(cardBlock, /div\.matches\(":hover"\)/);
assert.ok(
  cardBlock.indexOf("JSUnifiedListingsV8.prefetch") < cardBlock.indexOf("div.onpointerenter"),
  "상세조회는 pointerenter 본문에서 즉시 실행하지 않고 지연 함수 안에 있어야 합니다."
);

const resizeStart = script.indexOf("function resizeMemoEditorNowV6107(");
const resizeEnd = script.indexOf("function getMemoItemV655(", resizeStart);
assert.ok(resizeStart >= 0 && resizeEnd > resizeStart, "메모 높이 조절 블록이 있어야 합니다.");
const resizeBlock = script.slice(resizeStart, resizeEnd);
assert.match(resizeBlock, /__memoResizeFrameV6107/);
assert.match(resizeBlock, /requestAnimationFrame\(function\(\)/);
assert.match(resizeBlock, /if \(element\.__memoResizeFrameV6107\) return/);

const resizeFrames = [];
let resizeReads = 0;
const resizeContext = {
  requestAnimationFrame(callback) {
    resizeFrames.push(callback);
    return resizeFrames.length;
  },
  cancelAnimationFrame() {}
};
vm.runInNewContext(`${resizeBlock}; this.resizeMemo = autoResizeMemoEditor;`, resizeContext);
const editor = { isConnected: true, style: {} };
Object.defineProperty(editor, "scrollHeight", {
  get() {
    resizeReads += 1;
    return 64;
  }
});
resizeContext.resizeMemo(editor);
resizeContext.resizeMemo(editor);
assert.equal(resizeFrames.length, 1, "한 프레임 안의 연속 입력은 높이 계산을 한 번만 예약해야 합니다.");
assert.equal(resizeReads, 0, "입력 이벤트 중에는 강제 레이아웃을 읽지 않아야 합니다.");
resizeFrames.shift()();
assert.equal(resizeReads, 1);
assert.equal(editor.style.height, "64px");

const saveStart = script.indexOf("function saveItemMemo(");
const saveEnd = script.indexOf("function getCustomerMatchStatus(", saveStart);
const saveBlock = script.slice(saveStart, saveEnd);
assert.equal(
  (saveBlock.match(/showMemoStatusV655\(key, "저장완료", "success", 1400\)/g) || []).length,
  1,
  "저장완료 렌더링은 한 번만 실행되어야 합니다."
);
assert.doesNotMatch(
  saveBlock,
  /memoStatusMessagesV655\[key\] = \{ text: "저장완료"[\s\S]*?refreshMemoCardV655\(key, false\)[\s\S]*?showMemoStatusV655/
);

assert.match(css, /\.map-quick-tool-btn \{[\s\S]*?backdrop-filter: none !important/);
assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);
assert.match(html, /header-professional-v1\.css\?v=1\.1\.8-compact-action-priority/);

console.log("interaction smooth v6.10.7 tests passed");
