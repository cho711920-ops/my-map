const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function toggleRuntime() {
  const start = source.indexOf("function isDetailOpenForPropertyV8143");
  const end = source.indexOf("function openGallery", start);
  assert.ok(start >= 0 && end > start, "card detail toggle runtime should be extractable");
  return source.slice(start, end);
}

function createRuntime() {
  let ariaHidden = "true";
  let openCount = 0;
  let closeCount = 0;
  let selectCount = 0;
  const state = { pendingMove: null, openPropertyId: "" };
  const drawer = {
    getAttribute(name) { return name === "aria-hidden" ? ariaHidden : null; }
  };
  const context = {
    console,
    state,
    text: (value) => String(value == null ? "" : value).trim(),
    document: {
      getElementById(id) { return id === "unifiedDetailDrawerV8" ? drawer : null; }
    },
    global: {
      selectListingOnMapV844() { selectCount += 1; }
    },
    open(encodedPropertyId) {
      openCount += 1;
      state.openPropertyId = decodeURIComponent(encodedPropertyId || "");
      ariaHidden = "false";
    },
    closeDetail() {
      closeCount += 1;
      state.openPropertyId = "";
      ariaHidden = "true";
    }
  };
  vm.createContext(context);
  vm.runInContext(toggleRuntime(), context);
  return {
    context,
    counts: () => ({ openCount, closeCount, selectCount }),
    setOpen(propertyId) {
      state.openPropertyId = propertyId;
      ariaHidden = "false";
    }
  };
}

function cardEvent(targetSelector = "") {
  return {
    target: {
      closest(selector) { return selector === targetSelector ? {} : null; }
    }
  };
}

test("a second click on the same listing closes its detail without changing map selection", () => {
  const runtime = createRuntime();
  const item = { propertyId: "M-101" };

  assert.equal(runtime.context.handleCardClick(item, cardEvent()), true);
  assert.deepEqual(runtime.counts(), { openCount: 1, closeCount: 0, selectCount: 1 });

  assert.equal(runtime.context.handleCardClick(item, cardEvent()), true);
  assert.deepEqual(runtime.counts(), { openCount: 1, closeCount: 1, selectCount: 1 });

  assert.equal(runtime.context.handleCardClick(item, cardEvent()), true);
  assert.deepEqual(runtime.counts(), { openCount: 2, closeCount: 1, selectCount: 2 });
});

test("thumbnail clicks use the same detail toggle while inner action buttons stay independent", () => {
  const runtime = createRuntime();
  runtime.setOpen("M-202");

  assert.equal(runtime.context.toggleCardDetail(encodeURIComponent("M-202")), false);
  assert.deepEqual(runtime.counts(), { openCount: 0, closeCount: 1, selectCount: 0 });

  assert.equal(runtime.context.toggleCardDetail(encodeURIComponent("M-202")), true);
  assert.deepEqual(runtime.counts(), { openCount: 1, closeCount: 1, selectCount: 0 });

  assert.equal(runtime.context.handleCardClick({ propertyId: "M-202" }, cardEvent("button,input,label,a,textarea,select")), false);
  assert.deepEqual(runtime.counts(), { openCount: 1, closeCount: 1, selectCount: 0 });
});

test("the listing thumbnail and deployed asset version reference the toggle behavior", () => {
  assert.match(source, /unified-thumb-v8[\s\S]*?JSUnifiedListingsV8\.toggleCardDetail/);
  assert.match(source, /toggleCardDetail: toggleCardDetail/);
  assert.match(html, /unified-listings-v8\.js\?v=8\.1\.43-card-detail-toggle/);
});
