import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {getCommercialArea} from "../cloudflare/src/commercial-area-api.js";

const badgesSource = readFileSync(new URL("../js/building-register-v6.js", import.meta.url), "utf8");
function badgeRuntime(items) {
  const listeners = new Map();
  const context = vm.createContext({allItems: items,
    window: {addEventListener(name, handler) { listeners.set(name, handler); }},
    document: {querySelectorAll() { return []; }}, setTimeout() {}});
  vm.runInContext(badgesSource, context);
  return {context, listeners, badges: context.window.JSBuildingRegisterBadges};
}
const listing = (id, address, year = "2019") => ({propertyId: id, address,
  buildingInfoStatus: "connected", buildingYear: year, buildingElevators: 1, buildingElevatorCapacity: 8,
  memo: "사용자 메모", deposit: 1000});

test("rendering 18 known building badges indexes listings once instead of scanning per card", () => {
  let addressReads = 0;
  const items = Array.from({length: 25277}, (_, index) => {
    const row = listing("perf-" + index, "");
    Object.defineProperty(row, "address", {get() { addressReads++; return "대전광역시 서구 합성동 " + index; }});
    return row;
  });
  const {badges} = badgeRuntime(items);
  for (const row of items.slice(0, 18)) {
    badges.getCached(row);
    badges.bind({setAttribute() {}, getAttribute() { return null; }}, row);
  }
  assert.ok(addressReads < items.length + 500, "cached badge rendering must not rescan the complete list per card");
  assert.equal(items[17].memo, "사용자 메모");
  assert.equal(items[17].deposit, 1000);
});

test("badge updates still propagate to same-address listings across snapshots and address edits", () => {
  const first = listing("a", "대전광역시 서구 둔산동 1");
  const sibling = listing("b", "서구 둔산동 1", "");
  const other = listing("c", "서구 둔산동 2", "2020");
  const {context, badges, listeners} = badgeRuntime([first, sibling, other]);
  badges.getCached(first);
  assert.equal(sibling.buildingYear, "2019");
  assert.equal(other.buildingYear, "2020");
  first.buildingYear = "2024";
  badges.getCached(first);
  assert.equal(sibling.buildingYear, "2024");
  other.address = "서구 둔산동 1";
  other.buildingYear = "2025";
  badges.getCached(other);
  assert.equal(first.buildingYear, "2025");
  const replacement = listing("d", "서구 둔산동 1", "2030");
  context.allItems = [replacement, listing("e", "서구 둔산동 1", "")];
  badges.getCached(replacement);
  assert.equal(context.allItems[1].buildingYear, "2030");
  assert.equal(first.buildingYear, "2025", "previous snapshots must not be updated");
  const appended = listing("f", "서구 둔산동 1", "");
  context.allItems.push(appended);
  badges.getCached(replacement);
  assert.equal(appended.buildingYear, "2030");
  context.allItems[1] = listing("g", "서구 둔산동 1", "");
  listeners.get("js-listings-full-snapshot")();
  badges.getCached(replacement);
  assert.equal(context.allItems[1].buildingYear, "2030");
});

test("collection timestamps accept epoch milliseconds and ISO strings in Korean time", () => {
  const source = readFileSync(new URL("../js/operations-collection-v8.js", import.meta.url), "utf8");
  const declaration = source.match(/ {2}function formatAt\(value\) \{[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(declaration);
  const formatAt = vm.runInNewContext("(" + declaration + ")", {text: value => String(value ?? "").trim()});
  for (const value of [1792032966129, "1792032966129", "2026-10-15T02:56:06.129Z"]) {
    assert.equal(formatAt(value), "2026.10.15 11:56");
  }
  assert.equal(formatAt(null), "-");
  assert.equal(formatAt("unavailable"), "unavailable");
});

test("commercial-area requests encode both data.go.kr key formats exactly once", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    calls.push(new URL(input));
    return Response.json({header: {resultCode: "00"}, body: {items: [], totalCount: 0}});
  };
  try {
    for (const key of ["sample+key/value==", "sample%2Bkey%2Fvalue%3D%3D"]) {
      const result = await getCommercialArea({DATA_GO_KR_SERVICE_KEY: key}, {lat: 36.35, lng: 127.38});
      assert.equal(result.ok, true);
    }
    assert.equal(calls.length, 2);
    for (const url of calls) {
      assert.equal(url.searchParams.get("serviceKey"), "sample+key/value==");
      assert.ok(!url.href.includes("%252B") && !url.href.includes("%253D"));
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "apis.data.go.kr");
    }
    await getCommercialArea({DATA_GO_KR_SERVICE_KEY: "building-service-key",
      COMMERCIAL_DATA_GO_KR_SERVICE_KEY: "commercial%2Bkey%3D%3D"}, {lat: 36.35, lng: 127.38});
    assert.equal(calls.at(-1).searchParams.get("serviceKey"), "commercial+key==",
      "a dedicated commercial key must not replace or reuse a separate building-register key");
    globalThis.fetch = async () => new Response("Forbidden", {status: 403});
    await assert.rejects(getCommercialArea({DATA_GO_KR_SERVICE_KEY: "private-test-key"},
      {lat: 36.35, lng: 127.38}), error => /HTTP 403/.test(error.message) && !/private-test-key/.test(error.message));
    for (const code of ["20", "30"]) {
      globalThis.fetch = async () => Response.json({OpenAPI_ServiceResponse: {cmmMsgHeader: {
        returnReasonCode: code, returnAuthMsg: "private-test-key must never be echoed"}}}, {status: 403});
      await assert.rejects(getCommercialArea({DATA_GO_KR_SERVICE_KEY: "private-test-key"},
        {lat: 36.35, lng: 127.38}), error => error.message.includes("코드 " + code) && !/private-test-key/.test(error.message));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("a new keyword clears the previous cluster list scope, while unchanged-query refresh preserves it", () => {
  const source = readFileSync(new URL("../js/script.js", import.meta.url), "utf8");
  const declaration = source.match(/^function applyFilter\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(declaration);
  const keyword = {value: "선화"}, status = {innerHTML: ""};
  let selected = true, clears = 0, shown = [];
  const matches = [{propertyId: "new-region-a"}, {propertyId: "new-region-b"}];
  const context = vm.createContext({window: {jsLastAppliedKeywordV1: "문지"}, allItems: matches,
    document: {getElementById: id => id === "keyword" ? keyword : status},
    clearMapListSelectionForNavigationV6571() { selected = false; clears++; },
    getFilteredItems() { return matches; },
    drawItems(items) { shown = selected ? [] : items; },
    renderActiveFilterChipsV844() {}});
  vm.runInContext(declaration, context);
  context.applyFilter();
  assert.equal(clears, 1);
  assert.equal(shown.length, 2);
  assert.equal(status.innerHTML, "검색 결과 2개");
  selected = true;
  context.applyFilter();
  assert.equal(clears, 1, "same-keyword refresh and price/source filters must preserve a selected cluster");
});
