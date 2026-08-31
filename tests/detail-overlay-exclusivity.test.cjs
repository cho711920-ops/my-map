const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(source, /function closeDetailForOverlay\(\)/);
assert.match(source, /drawer\.classList\.remove\("open", "opening-v827", "closing-v827"\)/);
assert.match(source, /state\.detailRequestToken \+= 1/);
assert.match(source, /document\.addEventListener\("click", function\(event\)/);
assert.match(source, /openOperationsCenter\|openListManager\|openQuickAddModal\|startAiVisitPreview/);
assert.match(source, /toggleDetailFilter\|toggleV6ActionMenu\|toggleSortDropdown/);
assert.match(source, /global\.closeAiSidePanel\(\)/);
assert.match(source, /closeForOverlay: closeDetailForOverlay/);
assert.match(operations, /JSUnifiedListingsV8\.closeForOverlay\(\)/);
assert.match(html, /unified-listings-v8\.js\?v=8\.1\.38-swipe-prefetch/);
assert.match(html, /operations-center-v7\.js\?v=7\.22\.7-list-transaction-link/);

let capturedClick = null;
let ariaHidden = "false";
const drawerClasses = new Set(["open"]);
const drawer = {
  classList: {
    contains: (name) => drawerClasses.has(name),
    remove: (...names) => names.forEach((name) => drawerClasses.delete(name))
  },
  contains: () => false,
  setAttribute: (name, value) => { if (name === "aria-hidden") ariaHidden = value; }
};
const documentMock = {
  addEventListener(type, handler, capture) {
    if (type === "click" && capture === true) capturedClick = handler;
  },
  getElementById(id) { return id === "unifiedDetailDrawerV8" ? drawer : null; }
};
const windowMock = {
  addEventListener() {},
  clearTimeout() {},
  setTimeout() { return 1; },
  requestAnimationFrame() {},
  closeAiSidePanel() { this.aiCloseCount = (this.aiCloseCount || 0) + 1; }
};
windowMock.window = windowMock;
vm.runInNewContext(source, { window: windowMock, document: documentMock, console });
assert.equal(typeof capturedClick, "function");
capturedClick({
  target: {
    closest() {
      return {
        getAttribute(name) { return name === "onclick" ? "openOperationsCenter('dashboard')" : ""; },
        matches() { return false; }
      };
    }
  }
});
assert.equal(drawerClasses.has("open"), false);
assert.equal(ariaHidden, "true");
assert.equal(windowMock.aiCloseCount, 1);
assert.equal(typeof windowMock.JSUnifiedListingsV8.closeForOverlay, "function");

console.log("detail overlay exclusivity tests passed");
