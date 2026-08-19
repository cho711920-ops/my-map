const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const mapSource = fs.readFileSync("js/map.js", "utf8");
const unifiedSource = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const desktopCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const mobileCss = fs.readFileSync("css/mobile-app-v1.css", "utf8");

function chipRuntime() {
  const start = script.indexOf("function getFilterInputValueV844");
  const endMarker = "window.renderActiveFilterChipsV844 = renderActiveFilterChipsV844;";
  const end = script.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end > start, "filter chip runtime should be extractable");
  return script.slice(start, end);
}

function input(value = "") {
  return { value };
}

function select(value, text) {
  return {
    value,
    selectedIndex: value ? 1 : 0,
    options: [{ textContent: "기본" }, { textContent: text || value }]
  };
}

test("active filter chips are mounted below the listing toolbar with cache-busted assets", () => {
  const toolbarIndex = html.indexOf('id="listToolbar"');
  const chipIndex = html.indexOf('id="activeFilterChipsV844"');
  const listIndex = html.indexOf('id="list"');
  assert.ok(toolbarIndex >= 0 && chipIndex > toolbarIndex && listIndex > chipIndex);
  assert.match(html, /script\.js\?v=6\.10\.4-filter-chips-selection/);
  assert.match(html, /unified-listings-v8\.js\?v=8\.1\.32-linked-selection/);
  assert.match(html, /map\.js\?v=8\.2\.17-linked-selection/);
  assert.match(html, /unified-listings-v8\.css\?v=8\.0\.44-filter-chips-selection/);
  assert.match(html, /mobile-app-v1\.css\?v=1\.0\.7-filter-chips-selection/);
  assert.match(script, /drawItems\(filtered\);\s*renderActiveFilterChipsV844\(\);/);
});

test("selected filter values become readable independent removable chips", () => {
  const elements = {
    keyword: input("탄방동"),
    sourceFilter: select("naver", "네이버"),
    typeFilter: select("일반상가", "일반상가"),
    brokerageFeeFilter: select("feeAtLeast200", "200 이상"),
    minDeposit: input("1000"),
    maxDeposit: input(""),
    minRent: input(""),
    maxRent: input("100"),
    minPremium: input(""),
    maxPremium: input(""),
    minArea: input(""),
    maxArea: input(""),
    minFloor: input(""),
    maxFloor: input(""),
    industryFilter: input("카페")
  };
  const context = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    favoriteOnly: false,
    hideDone: true,
    doneOnly: false,
    gongsilOnly: false,
    todayNewOnly: false,
    window: { mapRadiusFilterV658: null }
  };
  vm.runInNewContext(chipRuntime(), context);
  const labels = context.getActiveFilterChipsV844().map((chip) => chip.label);
  assert.deepEqual(Array.from(labels), [
    "검색 탄방동",
    "출처 네이버",
    "구분 일반상가",
    "중개보수 200 이상",
    "보증금 1,000만원 이상",
    "월세 100만원 이하",
    "업종 카페"
  ]);
});

test("one chip clears only its own condition and refreshes filtering", () => {
  const elements = {
    brokerageFeeFilter: select("feeAtLeast300", "300 이상")
  };
  let applyCount = 0;
  const context = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    favoriteOnly: false,
    hideDone: true,
    doneOnly: false,
    gongsilOnly: false,
    todayNewOnly: false,
    applyFilter: () => { applyCount += 1; },
    window: { mapRadiusFilterV658: null }
  };
  vm.runInNewContext(chipRuntime(), context);
  context.clearActiveFilterChipV844("brokerage");
  assert.equal(elements.brokerageFeeFilter.value, "");
  assert.equal(applyCount, 1);
});

test("selected listing card and its current map cluster use one strong blue state", () => {
  assert.match(script, /selectedItemKey === item\.key \? " selected"/);
  assert.match(unifiedSource, /handleCardClick[\s\S]*?global\.selectListingOnMapV844\(item\)[\s\S]*?open\(encodeURIComponent\(propertyId\)\)/);
  assert.match(mapSource, /function selectListingOnMapV844\(item\)[\s\S]*?selectedGroupKey\s*=[\s\S]*?matchedOverlay[\s\S]*?redrawSelectedMarkers\(\)/);
  assert.match(mapSource, /card\.classList\.toggle\([\s\S]*?"selected"[\s\S]*?data-listing-key/);
  assert.match(desktopCss, /#list \.item\.selected[\s\S]*?inset 4px 0 0 #0568e8/);
  assert.match(desktopCss, /\.circle-marker\.selected[\s\S]*?--cluster-fill: rgba\(5, 104, 232, \.98\)/);
  assert.match(mobileCss, /\.js-mobile-app-v1 #list \.item\.selected[\s\S]*?inset 4px 0 0 #0568e8/);
});
