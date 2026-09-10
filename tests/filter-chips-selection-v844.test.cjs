const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const mapSource = fs.readFileSync("js/map.js", "utf8");
const unifiedSource = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const analysisSource = fs.readFileSync("js/analysis.js", "utf8");
const propertyEditSource = fs.readFileSync("js/property-edit-v648.js", "utf8");
const desktopCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const mobileCss = fs.readFileSync("css/mobile-app-v1.css", "utf8");

function chipRuntime() {
  const start = script.indexOf("function getFilterInputValueV844");
  const endMarker = "window.renderActiveFilterChipsV844 = renderActiveFilterChipsV844;";
  const end = script.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end > start, "filter chip runtime should be extractable");
  return script.slice(start, end);
}

function listingFilterRuntime() {
  const start = script.indexOf("function readOptionalFilterNumberV1");
  const end = script.indexOf("function listingRegistrationTime", start);
  assert.ok(start >= 0 && end > start, "listing filter runtime should be extractable");
  return script.slice(start, end);
}

function linkedSelectionRuntime() {
  const identityStart = script.indexOf("function actionSelectionKeyV660");
  const identityEndMarker = "window.clearLinkedListingSelectionV845 = clearLinkedListingSelectionV845;";
  const identityEnd = script.indexOf(identityEndMarker, identityStart) + identityEndMarker.length;
  const selectionStart = mapSource.indexOf("function selectListingOnMapV844");
  const selectionEndMarker = "window.selectListingOnMapV844 = selectListingOnMapV844;";
  const selectionEnd = mapSource.indexOf(selectionEndMarker, selectionStart) + selectionEndMarker.length;
  assert.ok(identityStart >= 0 && identityEnd > identityStart);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
  return script.slice(identityStart, identityEnd) + "\n" +
    mapSource.slice(selectionStart, selectionEnd);
}

function savedListRuntime() {
  const start = mapSource.indexOf("function findItemsBySavedKeys");
  const end = mapSource.indexOf("function restoreAutoUpdateViewState", start);
  assert.ok(start >= 0 && end > start);
  return mapSource.slice(start, end);
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
  assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id[^"']*zero-range-favorite-folder-v1=1/);
  assert.match(html, /unified-listings-v8\.js\?v=8\.1\.43-card-detail-toggle/);
  assert.match(html, /map\.js\?v=8\.2\.22-full-initial-render/);
  assert.match(html, /analysis\.js\?v=6\.3\.41-unique-linked-selection/);
  assert.match(html, /property-edit-v648\.js\?v=1\.0\.1-linked-selection/);
  assert.match(html, /unified-listings-v8\.css\?v=8\.1\.40-smooth-photo-expand/);
  assert.match(html, /mobile-app-v1\.css\?v=1\.0\.7-filter-chips-selection/);
  assert.match(script, /drawItems\(filtered\);\s*renderActiveFilterChipsV844\(\);/);
});

test("zero is a real range endpoint in both filtering and active chips", () => {
  const elements = {
    keyword: input(""),
    sourceFilter: select("", ""),
    typeFilter: select("", ""),
    brokerageFeeFilter: select("", ""),
    floorQuickFilter: select("", ""),
    sortFilter: select("", ""),
    industryFilter: input(""),
    minDeposit: input(""),
    maxDeposit: input(""),
    minRent: input(""),
    maxRent: input("0"),
    minPremium: input(""),
    maxPremium: input(""),
    minArea: input(""),
    maxArea: input(""),
    minFloor: input(""),
    maxFloor: input("")
  };
  const context = {
    console,
    document: {
      documentElement: { classList: { contains: () => false } },
      getElementById: (id) => elements[id] || null
    },
    map: { getBounds: () => ({ contain: () => true }) },
    allItems: [
      { key: "rent-zero", deposit: 1000, rent: 0, premium: 0, area: 10, latlng: {} },
      { key: "rent-positive", deposit: 1000, rent: 50, premium: 0, area: 10, latlng: {} }
    ],
    favoriteOnly: false,
    activeFavoriteFolderId: "",
    activeFavoriteFolderName: "",
    favoriteFilterKeys: [],
    hideDone: true,
    doneOnly: false,
    gongsilOnly: false,
    todayNewOnly: false,
    newListingDays: 0,
    matchesMultiKeyword: () => true,
    getItemSourceType: () => "",
    getItemFloorNumber: () => null,
    readOptionalNumberInput: () => null,
    isFavorite: () => false,
    isDone: () => false,
    window: {
      mapRadiusFilterV658: null,
      mapPolygonFilterV661: null,
      operationsMatchPropertyIds: null,
      JSListingTradeV1: {
        getMode: () => "lease",
        matchesItem: () => true
      }
    }
  };
  vm.runInNewContext(listingFilterRuntime(), context);
  assert.deepEqual(Array.from(context.getFilteredItems(), (item) => item.key), ["rent-zero"]);

  vm.runInNewContext(chipRuntime(), context);
  assert.equal(
    context.getActiveFilterChipsV844().find((chip) => chip.key === "rent").label,
    "월세 0만원 이하"
  );
});

test("every money and area endpoint distinguishes zero from an empty value", () => {
  const ids = [
    "minDeposit", "maxDeposit", "minRent", "maxRent",
    "minPremium", "maxPremium", "minArea", "maxArea"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, input("0")]));
  const context = {
    document: { getElementById: (id) => elements[id] || null }
  };
  const sourceStart = script.indexOf("function readOptionalFilterNumberV1");
  const sourceEnd = script.indexOf("function getFilteredItems", sourceStart);
  vm.runInNewContext(script.slice(sourceStart, sourceEnd), context);
  ids.forEach((id) => assert.equal(context.readOptionalFilterNumberV1(id, Infinity), 0));
  elements.maxRent.value = "";
  assert.equal(context.readOptionalFilterNumberV1("maxRent", Infinity), Infinity);
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
    newListingDays: 0,
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
    newListingDays: 0,
    applyFilter: () => { applyCount += 1; },
    window: { mapRadiusFilterV658: null }
  };
  vm.runInNewContext(chipRuntime(), context);
  context.clearActiveFilterChipV844("brokerage");
  assert.equal(elements.brokerageFeeFilter.value, "");
  assert.equal(applyCount, 1);
});

test("selected listing card and its current map cluster use one strong blue state", () => {
  assert.match(script, /isLinkedListingSelectedV845\(item\) \? " selected"/);
  assert.match(unifiedSource, /handleCardClick[\s\S]*?global\.selectListingOnMapV844\(item\)[\s\S]*?open\(encodeURIComponent\(propertyId\)\)/);
  assert.match(mapSource, /function selectListingOnMapV844\(item\)[\s\S]*?selectedListCardIdV845\s*=[\s\S]*?matchedOverlay[\s\S]*?redrawSelectedMarkers\(\)/);
  assert.match(mapSource, /card\.classList\.toggle\([\s\S]*?"selected"[\s\S]*?data-list-card-id-v681/);
  assert.match(analysisSource, /function openAiSidePanel\(item\)[\s\S]*?selectListingOnMapV844\(item\)/);
  assert.match(propertyEditSource, /clearLinkedListingSelectionV845\(\)/);
  assert.match(desktopCss, /#list \.item\.selected[\s\S]*?inset 4px 0 0 #0568e8/);
  assert.match(desktopCss, /\.circle-marker\.selected[\s\S]*?--cluster-fill: rgba\(5, 104, 232, \.98\)/);
  assert.match(mobileCss, /\.js-mobile-app-v1 #list \.item\.selected[\s\S]*?inset 4px 0 0 #0568e8/);
});

test("same-address same-floor listings keep card and cluster selection independent", () => {
  const first = { key: "same-address|1층|일반상가", propertyId: "M-first", sheetRow: 21 };
  const second = { key: "same-address|1층|일반상가", propertyId: "M-second", sheetRow: 22 };
  const selectedStates = [false, false];
  const cardIds = ["property:M-first|row:21", "property:M-second|row:22"];
  const cards = cardIds.map((cardId, index) => ({
    getAttribute: (name) => name === "data-list-card-id-v681" ? cardId : null,
    classList: { toggle: (name, enabled) => { if (name === "selected") selectedStates[index] = enabled; } }
  }));
  let redrawCount = 0;
  const context = {
    console,
    selectedItemKey: null,
    selectedListCardIdV845: null,
    selectedGroupKey: null,
    multiClusterMode: false,
    overlays: [
      { __cluster: { key: "cluster-first", items: [first] } },
      { __cluster: { key: "cluster-second", items: [second] } }
    ],
    redrawSelectedMarkers: () => { redrawCount += 1; },
    document: { querySelectorAll: () => cards }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(linkedSelectionRuntime(), context);

  context.selectListingOnMapV844(second);

  assert.equal(context.selectedItemKey, second.key);
  assert.equal(context.selectedListCardIdV845, cardIds[1]);
  assert.equal(context.selectedGroupKey, "cluster-second");
  assert.deepEqual(selectedStates, [false, true]);
  assert.equal(redrawCount, 1);
});

test("automatic refresh restores separate same-key cards in their original order", () => {
  const first = { key: "same-address|1층|일반상가", propertyId: "M-first", sheetRow: 21 };
  const second = { key: "same-address|1층|일반상가", propertyId: "M-second", sheetRow: 22 };
  const context = {
    allItems: [second, first],
    getLinkedSelectionCardIdV845: (item) => `property:${item.propertyId}|row:${item.sheetRow}`
  };
  vm.createContext(context);
  vm.runInContext(savedListRuntime(), context);

  const restored = context.findItemsBySavedKeys(
    [first.key, second.key],
    ["property:M-first|row:21", "property:M-second|row:22"]
  );

  assert.deepEqual(Array.from(restored, (item) => item.propertyId), ["M-first", "M-second"]);
});
