const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const helper = fs.readFileSync("js/dialog-focus-v1.js", "utf8");
const favorites = fs.readFileSync("js/unified-favorites-v7.js", "utf8");
const listManager = fs.readFileSync("js/list-manager-v6.js", "utf8");
const listings = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");

assert.match(html, /dialog-focus-v1\.js\?v=1\.0\.0-keyboard-focus[\s\S]*?unified-listings-v8\.js/);
assert.match(html, /unified-listings-v8\.js[^"']*dialog-focus-v1=1/);
assert.match(html, /list-manager-v6\.js[^"']*dialog-focus-v1=1/);
assert.match(html, /unified-favorites-v7\.js[^"']*dialog-focus-v1=1/);

assert.match(helper, /button:not\(\[disabled\]\)/);
assert.match(helper, /event\.key !== "Tab"/);
assert.match(helper, /event\.shiftKey/);
assert.match(helper, /__jsReturnFocusV1/);
assert.match(helper, /event\.key === "Escape"/);
assert.match(helper, /current\.hidden \|\| current\.inert/);
assert.match(helper, /attribute\(current, "aria-hidden"\) === "true"/);
assert.match(helper, /style\.display === "none"/);
assert.match(helper, /style\.visibility === "hidden"/);

assert.match(favorites, /JSDialogFocusV1\.activate\(modal/);
assert.match(favorites, /JSDialogFocusV1\.deactivate\(modal\)/);
assert.match(favorites, /detailIsOpen[\s\S]*?JSUnifiedListingsV8\.close\(\)/);
assert.match(favorites, /aria-hidden="true" onclick="closeUnifiedFavoritesV7/);

assert.match(listManager, /aria-label="목록 닫기"/);
assert.match(listManager, /aria-label="목록 선택 닫기"/);
assert.match(listManager, /aria-labelledby="v6MobileMenuTitle"/);
assert.match(listManager, /JSDialogFocusV1\.handleKeydown\(root, event, closeMobileSheet\)/);
assert.match(listManager, /JSDialogFocusV1\.deactivate\(root\)/);

assert.match(listings, /drawer\.setAttribute\("role", "dialog"\)/);
assert.match(listings, /drawer\.setAttribute\("aria-labelledby", "unifiedDetailTitleV8"\)/);
assert.match(listings, /JSDialogFocusV1\.activate\(drawer/);
assert.match(listings, /JSDialogFocusV1\.deactivate\(drawer\)/);
assert.match(listings, /modal\.setAttribute\("aria-modal", "true"\)/);
assert.match(listings, /aria-labelledby="tellModalTitleV8"/);
assert.match(listings, /aria-label="Tell 연락처 검색 닫기"/);
assert.match(listings, /if \(tellModal && tellModal\.classList\.contains\("open"\)\)/);
assert.match(listings, /function resolveTellReturnFocusV8\(detailDrawer\)/);
assert.match(listings, /active === document\.body \|\| activeIsInsideDetail\) \? trigger : active/);
assert.match(listings, /\{returnFocus: returnFocus\}/);

assert.match(workflow, /node-version: 22/);
assert.match(workflow, /pnpm install --frozen-lockfile/);
assert.match(workflow, /run: pnpm test/);
assert.match(workflow, /run: pnpm run cf:check/);

let activeElement;
const body = {};
function focusable(name) {
  return {
    name,
    disabled: false,
    isConnected: true,
    hidden: false,
    inert: false,
    parentElement: null,
    getAttribute() { return null; },
    closest() { return null; },
    focus() { activeElement = this; }
  };
}
const opener = focusable("opener");
const first = focusable("first");
const last = focusable("last");
const contained = new Set([first, last]);
const container = {
  __jsReturnFocusV1: null,
  getAttribute(name) { return name === "aria-hidden" ? "false" : null; },
  hasAttribute() { return false; },
  setAttribute() {},
  contains(element) { return contained.has(element); },
  querySelector() { return first; },
  querySelectorAll() { return [first, last]; },
  focus() { activeElement = this; }
};
const documentMock = {
  body,
  documentElement: { contains: () => true },
  get activeElement() { return activeElement; }
};
const windowMock = {
  document: documentMock,
  setTimeout(callback) { callback(); },
  getComputedStyle(element) {
    return {display: element.computedDisplay || "block", visibility: element.computedVisibility || "visible"};
  }
};
windowMock.window = windowMock;
activeElement = opener;
vm.runInNewContext(helper, {window: windowMock});

windowMock.JSDialogFocusV1.activate(container, first);
assert.equal(activeElement, first);
assert.equal(container.__jsReturnFocusV1, opener);

activeElement = last;
let prevented = false;
windowMock.JSDialogFocusV1.trap(container, {
  key: "Tab",
  shiftKey: false,
  preventDefault() { prevented = true; }
});
assert.equal(prevented, true);
assert.equal(activeElement, first);

windowMock.JSDialogFocusV1.deactivate(container);
assert.equal(activeElement, opener);

[
  {name: "aria-hidden ancestor", parent: {getAttribute: (name) => name === "aria-hidden" ? "true" : null}},
  {name: "inert ancestor", parent: {inert: true, getAttribute: () => null}},
  {name: "display-none ancestor", parent: {computedDisplay: "none", getAttribute: () => null}},
  {name: "visibility-hidden ancestor", parent: {computedVisibility: "hidden", getAttribute: () => null}}
].forEach(({name, parent}) => {
  parent.isConnected = true;
  parent.hidden = false;
  parent.parentElement = null;
  const hiddenReturn = focusable(name);
  hiddenReturn.parentElement = parent;
  container.__jsReturnFocusV1 = hiddenReturn;
  activeElement = first;
  windowMock.JSDialogFocusV1.deactivate(container);
  assert.equal(activeElement, first, `${name} must not receive restored focus`);
});

function classList(initial) {
  const values = new Set(initial || []);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  };
}

let tellActive;
let tellModal = null;
const tellBody = focusable("body");
tellBody.appendChild = (node) => { tellModal = node; node.parentElement = tellBody; };
const tellTrigger = focusable("tell-trigger");
tellTrigger.parentElement = tellBody;
tellTrigger.focus = function () { tellActive = this; };
const drawerFocused = focusable("drawer-control");
drawerFocused.focus = function () { tellActive = this; };
const drawerAttrs = {"aria-hidden": "false"};
const detailDrawer = {
  isConnected: true,
  hidden: false,
  inert: false,
  disabled: false,
  parentElement: tellBody,
  classList: classList(["open"]),
  contains: (node) => node === drawerFocused,
  getAttribute: (name) => drawerAttrs[name] == null ? null : drawerAttrs[name],
  setAttribute: (name, value) => { drawerAttrs[name] = value; }
};
drawerFocused.parentElement = detailDrawer;

const tellInput = focusable("tell-input");
const tellClose = focusable("tell-close");
const tellBackdrop = focusable("tell-backdrop");
const tellForm = focusable("tell-form");
[tellInput, tellClose, tellBackdrop, tellForm].forEach((node) => {
  node.focus = function () { tellActive = this; };
});

function makeTellModal() {
  const attrs = {};
  const modal = {
    id: "",
    className: "",
    isConnected: true,
    hidden: false,
    inert: false,
    disabled: false,
    parentElement: null,
    classList: classList(),
    contains: (node) => [tellInput, tellClose, tellBackdrop, tellForm].includes(node),
    getAttribute: (name) => attrs[name] == null ? null : attrs[name],
    setAttribute: (name, value) => { attrs[name] = value; },
    addEventListener() {},
    querySelector(selector) {
      if (selector === "header button") return tellClose;
      if (selector === ".tell-backdrop-v8") return tellBackdrop;
      if (selector === "input") return tellInput;
      if (selector === "form") return tellForm;
      return null;
    },
    querySelectorAll() { return [tellClose, tellInput]; }
  };
  [tellInput, tellClose, tellBackdrop, tellForm].forEach((node) => { node.parentElement = modal; });
  return modal;
}

const tellDocument = {
  body: tellBody,
  documentElement: {contains: () => true},
  get activeElement() { return tellActive; },
  getElementById(id) {
    if (id === "unifiedDetailDrawerV8") return detailDrawer;
    if (id === "tellModalV8") return tellModal;
    return null;
  },
  querySelector(selector) {
    return selector.indexOf("button.search-tell-v8") === 0 ? tellTrigger : null;
  },
  createElement() { return makeTellModal(); },
  addEventListener() {}
};
const tellWindow = {
  innerWidth: 1200,
  document: tellDocument,
  addEventListener() {},
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  requestAnimationFrame(callback) { callback(); },
  getComputedStyle(element) {
    return {display: element.computedDisplay || "block", visibility: element.computedVisibility || "visible"};
  }
};
tellWindow.window = tellWindow;
const tellContext = {window: tellWindow, document: tellDocument, console};
tellActive = drawerFocused;
vm.runInNewContext(helper, tellContext);
vm.runInNewContext(listings, tellContext);
tellWindow.JSUnifiedListingsV8.openTell();
assert.equal(detailDrawer.getAttribute("aria-hidden"), "true");
assert.equal(tellActive, tellInput, "Tell must move focus into its dialog");
tellClose.onclick();
assert.equal(tellActive, tellTrigger, "Tell must restore focus to the visible toolbar trigger");

console.log("dialog keyboard accessibility tests passed");
