import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(fs.readFileSync("js/listing-trade-ui-v1.js", "utf8"), {window,
  document: {getElementById() {return null;}, querySelector() {return null;}, documentElement: {setAttribute() {}}}});
const ui = window.JSListingTradeV1;
function item(details = {}, extras = {}) {
  return {name: "테스트", address: "가상 주소", room: "전체", type: "빌딩/건물", source: "네이버",
    propertyId: "P-1", key: "legacy-room-key", tradeType: "sale", saleCategory: "building", salePrice: 30000,
    saleDetails: {scope: "whole_building", saleExtent: "whole_building", ...details}, ...extras};
}

test("whole-building floor ranges use explicit basement/ground counts without mutating any stored field", () => {
  for (const [details, expected] of [
    [{aboveGroundFloors: 5, belowGroundFloors: 1}, "지하 1층 ~ 지상 5층"],
    [{aboveGroundFloors: "4", belowGroundFloors: "0"}, "지상 1층 ~ 지상 4층"],
    [{aboveGroundFloors: 1, belowGroundFloors: 0}, "지상 1층"],
    [{aboveGroundFloors: 5}, "지상 5층 · 지하 미확인"],
    [{aboveGroundFloors: 5, belowGroundFloors: null}, "지상 5층 · 지하 미확인"],
    [{aboveGroundFloors: 5, belowGroundFloors: ""}, "지상 5층 · 지하 미확인"],
    [{aboveGroundFloors: 5, belowGroundFloors: false}, "지상 5층 · 지하 미확인"],
    [{aboveGroundFloors: 5, belowGroundFloors: -1}, "지상 5층 · 지하 미확인"],
    [{aboveGroundFloors: 5.5, belowGroundFloors: 1}, "지하 1층 · 지상 미확인"],
    [{totalFloors: 5}, "총 5층"],
    [{totalFloors: 5, belowGroundFloors: 1}, "총 5층 · 지하 1층"],
    [{belowGroundFloors: 0}, "지하 없음 · 지상 미확인"],
    [{aboveGroundFloors: 0}, "층수 미확인"],
    [{}, "층수 미확인"]
  ]) {
    const value = item(details), before = JSON.stringify(value);
    assert.equal(ui.buildingFloorLabel(value), expected);
    assert.equal(JSON.stringify(value), before);
  }
});

test("unit sales display current/total and never advertise the whole building range", () => {
  for (const [room, detail, expected] of [
    ["3/10", {}, "해당 3층 / 총 10층"],
    ["3/10층", {}, "해당 3층 / 총 10층"],
    ["3층/10층", {}, "해당 3층 / 총 10층"],
    ["-1/5", {}, "해당 지하 1층 / 총 5층"],
    ["B1/5층", {}, "해당 지하 1층 / 총 5층"],
    ["지하1층", {totalFloors: 5}, "해당 지하 1층 / 총 5층"],
    ["고/10층", {}, "해당 고층 / 총 10층"],
    ["3층", {aboveGroundFloors: 10, belowGroundFloors: 2}, "해당 3층 / 총 10층"],
    ["301호", {totalFloors: 10}, "301호 / 총 10층"],
    ["", {totalFloors: 10}, "해당층 미확인 / 총 10층"],
    ["0층", {}, "층수 미확인"],
    ["0.0층", {}, "층수 미확인"],
    ["3.0층", {totalFloors: 10}, "해당 3층 / 총 10층"],
    ["-1.0/5.0", {}, "해당 지하 1층 / 총 5층"],
    ["", {}, "층수 미확인"]
  ]) assert.equal(ui.buildingFloorLabel(item({scope: "unit", saleExtent: "unit", ...detail}, {room, saleCategory: "officetel"})), expected, room);
});

test("lease and land retain their existing renderer and building detail uses the same floor label", () => {
  const building = item({aboveGroundFloors: 5, belowGroundFloors: 1});
  assert.equal(ui.buildingFloorLabel({...building, tradeType: "lease"}), "");
  assert.equal(ui.buildingFloorLabel({...building, saleCategory: "land"}), "");
  assert.equal(ui.buildingFloorLabel(item({scope: "land"})), "");
  assert.equal(ui.buildingFloorLabel(null), "");
  assert.match(ui.saleDetailsHtml(building), /<dt>층수<\/dt><dd>지하 1층 ~ 지상 5층<\/dd>/);
  assert.doesNotMatch(ui.saleDetailsHtml(building), /<dt>지상층수<\/dt>/);
  assert.match(ui.saleDetailsHtml({...building, saleCategory: "land"}), /<dt>지상층수<\/dt>/);
});

test("recovered provider floor scope corrects display only, including whole-building basement mistaken for an occupied floor", () => {
  const legacy = item({scope: "unit", floorScope: "whole_building", aboveGroundFloors: 3, belowGroundFloors: 1}, {room: "지하1층"});
  const before = JSON.stringify(legacy);
  assert.equal(ui.buildingFloorLabel(legacy), "지하 1층 ~ 지상 3층");
  assert.match(ui.saleDetailsHtml(legacy), /<dt>매매 범위<\/dt><dd>건물 전체 매매<\/dd>/);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(ui.buildingFloorLabel(item({scope: "whole_building", floorScope: "unit", saleExtent: "unit", totalFloors: 5}, {room: "4층"})), "해당 4층 / 총 5층");
});

test("source-summary floor disagreement is not silently combined and does not remove valid financial data", () => {
  const shared = {scope: "whole_building", saleExtent: "whole_building", totalDeposit: 3000, monthlyIncome: 100, aboveGroundFloors: 5, belowGroundFloors: 1};
  const master = item({}, {saleDetails: undefined});
  master.unifiedOriginalsV8 = [item({}, {saleDetails: undefined, saleSummary: {...shared}}),
    item({}, {saleDetails: undefined, saleSummary: {...shared, belowGroundFloors: 2}})];
  assert.equal(ui.buildingFloorLabel(master), "층수 미확인");
  assert.equal(ui.saleSummary(master).monthlyIncome, 100);
  assert.ok(ui.saleYield(master) > 0);
  master.unifiedOriginalsV8.pop();
  assert.equal(ui.buildingFloorLabel(master), "지하 1층 ~ 지상 5층");
});

test("sale extent needs explicit read evidence and never treats legacy scope defaults as confirmed", () => {
  for (const detail of [{scope: "unit"}, {scope: "whole_building"}, {floorScope: "whole_building"}, {saleExtent: "unknown"}]) {
    const value = item({}, {room: "지하1층", saleDetails: detail});
    const before = JSON.stringify(value);
    assert.equal(ui.buildingSaleScopeLabel(value), "매매 범위 미확인");
    assert.equal(ui.buildingFloorLabel(value), "매매 대상 층·호실 미확인");
    assert.doesNotMatch(ui.buildingSaleInfoHtml(value), /건물 전체 매매|일부 매매\(층·호실\)|building-sale-floor-v1/);
    assert.equal(JSON.stringify(value), before);
  }
  const direct = item({}, {source: "직접등록", room: "301호", saleDetails: {scope: "whole_building"}});
  assert.equal(ui.buildingSaleExtent(direct), "unknown");
  assert.match(ui.buildingSaleInfoHtml(item()), /건물 전체 매매/);
  const unit = item({saleExtent: "unit", totalFloors: 10}, {room: "3층"});
  assert.match(ui.buildingSaleInfoHtml(unit), /일부 매매\(층·호실\)/);
  assert.match(ui.buildingSaleInfoHtml(unit), /해당 3층 \/ 총 10층/);
  assert.doesNotMatch(ui.buildingSaleInfoHtml(unit), /3층 전체/);
  assert.match(ui.saleDetailsHtml(unit), /<dt>매매 범위<\/dt><dd>일부 매매\(층·호실\)<\/dd>/);
  for (const value of [{...unit, tradeType: "lease"}, {...unit, saleCategory: "land"}, null]) {
    assert.equal(ui.buildingSaleScopeLabel(value), "");
    assert.equal(ui.buildingSaleInfoHtml(value), "");
  }
});

test("scope conflicts show unknown, while floor-only conflicts do not hide a confirmed sale extent", () => {
  const master = item({}, {saleDetails: undefined, room: "지하1층"});
  master.unifiedOriginalsV8 = [item({aboveGroundFloors: 3}), item({aboveGroundFloors: 4})];
  assert.equal(ui.buildingSaleScopeLabel(master), "건물 전체 매매");
  master.saleDetails = {scope: "unit", aboveGroundFloors: 12, belowGroundFloors: 2};
  assert.equal(ui.buildingFloorLabel(master), "층수 미확인");
  master.unifiedOriginalsV8[1].saleDetails.saleExtent = "unit";
  assert.equal(ui.buildingSaleScopeLabel(master), "매매 범위 미확인");
  assert.equal(ui.buildingFloorLabel(master), "매매 대상 층·호실 미확인");
});

test("legacy direct details do not mask compatible read evidence or alter financial and identity fields", () => {
  const master = item({}, {room: "지하1층", saleDetails: {scope: "unit", monthlyIncome: 200}});
  master.unifiedOriginalsV8 = [item({aboveGroundFloors: 5, belowGroundFloors: 1})];
  const before = JSON.stringify(master);
  assert.equal(ui.buildingSaleScopeLabel(master), "건물 전체 매매");
  assert.equal(ui.buildingFloorLabel(master), "지하 1층 ~ 지상 5층");
  assert.equal(ui.saleSummary(master).monthlyIncome, 200);
  assert.equal(JSON.stringify(master), before);
  master.unifiedOriginalsV8[0].salePrice = 1;
  assert.equal(ui.buildingSaleScopeLabel(master), "매매 범위 미확인");
  master.unifiedOriginalsV8[0].salePrice = master.salePrice;
  master.unifiedOriginalsV8[0].source = "당근";
  assert.equal(ui.buildingSaleScopeLabel(master), "매매 범위 미확인");
  master.unifiedOriginalsV8[0].source = master.source;
  master.sourceLink = "https://example.com/a";
  master.unifiedOriginalsV8[0].link = "https://example.com/b";
  assert.equal(ui.buildingSaleScopeLabel(master), "매매 범위 미확인");
  assert.equal(ui.buildingSaleScopeLabel({...master, saleDetails: null}), "매매 범위 미확인");
  master.unifiedOriginalsV8[0].link = master.sourceLink;
  assert.equal(ui.buildingSaleScopeLabel(master), "건물 전체 매매");
  master.saleSummary = {saleExtent: "unit", totalFloors: 5};
  assert.equal(ui.buildingSaleScopeLabel(master), "일부 매매(층·호실)");
});
