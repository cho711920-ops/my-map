const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const source = fs.readFileSync("js/script.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const openBrace = source.indexOf("{", start);
  let depth = 0;

  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

let pointerUpHandler = null;
const context = {
  document: {
    documentElement: { dataset: {} },
    addEventListener(name, handler) {
      if (name === "pointerup") pointerUpHandler = handler;
    }
  }
};

vm.createContext(context);
vm.runInContext([
  extractFunction("selectSearchTextOnMousePointerV824"),
  extractFunction("setupSearchMouseSelectAllV824"),
  "this.selectText = selectSearchTextOnMousePointerV824;",
  "this.setup = setupSearchMouseSelectAllV824;"
].join("\n"), context);

function createInput(value, start = 0, end = start, id = "keyword") {
  return {
    id,
    value,
    selectionStart: start,
    selectionEnd: end,
    selectCalls: 0,
    select() {
      this.selectCalls += 1;
      this.selectionStart = 0;
      this.selectionEnd = this.value.length;
    }
  };
}

const keyword = createInput("둔산동", 2, 2);
assert.equal(context.selectText(keyword, { pointerType: "mouse", button: 0 }), true);
assert.equal(keyword.selectCalls, 1);
assert.deepEqual([keyword.selectionStart, keyword.selectionEnd], [0, 3]);

assert.equal(context.selectText(createInput("", 0, 0), { pointerType: "mouse", button: 0 }), false);
assert.equal(context.selectText(createInput("둔산동", 0, 0), { pointerType: "touch", button: 0 }), false);
assert.equal(context.selectText(createInput("둔산동", 0, 0), { pointerType: "mouse", button: 2 }), false);

const draggedSelection = createInput("둔산동", 0, 2);
assert.equal(context.selectText(draggedSelection, { pointerType: "mouse", button: 0 }), false);
assert.equal(draggedSelection.selectCalls, 0);

context.setup();
assert.equal(typeof pointerUpHandler, "function");
const mobileKeyword = createInput("유성구", 1, 1, "jsMobileKeywordV1");
pointerUpHandler({ target: mobileKeyword, pointerType: "mouse", button: 0 });
assert.equal(mobileKeyword.selectCalls, 1);

const unrelated = createInput("서구", 0, 0, "anotherInput");
pointerUpHandler({ target: unrelated, pointerType: "mouse", button: 0 });
assert.equal(unrelated.selectCalls, 0);

assert.ok(html.includes("script.js?v=6.10.8-favorite-property-id"));
assert.ok(html.includes("search-select-all-v824=1"));

console.log("search click select-all v8.2.4 tests passed");
