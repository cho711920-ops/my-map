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

test("lease and land retain their formatter while building details omit the floor row", () => {
  const building = item({aboveGroundFloors: 5, belowGroundFloors: 1});
  assert.equal(ui.buildingFloorLabel({...building, tradeType: "lease"}), "");
  assert.equal(ui.buildingFloorLabel({...building, saleCategory: "land"}), "");
  assert.equal(ui.buildingFloorLabel(item({scope: "land"})), "");
  assert.equal(ui.buildingFloorLabel(null), "");
  assert.doesNotMatch(ui.saleDetailsHtml(building), /<dt>층수<\/dt>/);
  assert.doesNotMatch(ui.saleDetailsHtml(building), /<dt>지상층수<\/dt>/);
  assert.doesNotMatch(ui.saleDetailsHtml({...building, saleCategory: "land"}), /<dt>지상층수<\/dt>/);
});

test("recovered provider floor scope corrects display only, including whole-building basement mistaken for an occupied floor", () => {
  const legacy = item({scope: "unit", floorScope: "whole_building", aboveGroundFloors: 3, belowGroundFloors: 1}, {room: "지하1층"});
  const before = JSON.stringify(legacy);
  assert.equal(ui.buildingFloorLabel(legacy), "지하 1층 ~ 지상 3층");
  assert.doesNotMatch(ui.saleDetailsHtml(legacy), /<dt>매매 범위<\/dt>/);
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
    assert.doesNotMatch(ui.buildingSaleInfoHtml(value), /건물 전체 매매|특정 층·호실 매매|building-sale-floor-v1/);
    assert.equal(JSON.stringify(value), before);
  }
  const direct = item({}, {source: "직접등록", room: "301호", saleDetails: {scope: "whole_building"}});
  assert.equal(ui.buildingSaleExtent(direct), "unknown");
  assert.equal(ui.buildingSaleInfoHtml(item()), "");
  const unit = item({saleExtent: "unit", totalFloors: 10}, {room: "3층"});
  assert.equal(ui.buildingSaleInfoHtml(unit), "");
  assert.doesNotMatch(ui.saleDetailsHtml(unit), /<dt>매매 범위<\/dt>/);
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
  assert.equal(ui.buildingSaleScopeLabel(master), "특정 층·호실 매매");
});

test("provider target floor and room replace stale display values without rewriting identity", () => {
  for (const [details, expected] of [
    [{saleTargetFloor: "4", saleTargetRoom: "402호", totalFloors: 12}, "해당 4층 · 402호 / 총 12층"],
    [{saleTargetFloor: "B1", saleTargetRoom: "B101호", totalFloors: 5}, "해당 지하 1층 · B101호 / 총 5층"],
    [{saleTargetFloor: "고", totalFloors: 30}, "해당 고층 / 총 30층"],
    [{saleTargetFloor: "1~2층", totalFloors: 5}, "1~2층 / 총 5층"],
    [{saleTargetRoom: "301호", totalFloors: 5}, "301호 / 총 5층"],
    [{saleTargetFloor: "비공개", totalFloors: 25}, "해당층 비공개 / 총 25층"],
    [{saleTargetFloor: "비공개", saleTargetRoom: "A호"}, "해당층 비공개 · A호"]
  ]) {
    const value = item({saleExtent: "unit", ...details}, {room: "지하2층"});
    const before = JSON.stringify(value);
    assert.equal(ui.buildingFloorLabel(value), expected);
    assert.equal(JSON.stringify(value), before);
    assert.equal(ui.buildingSaleInfoHtml(value), "");
    assert.doesNotMatch(ui.saleDetailsHtml(value), /<dt>(?:매매 범위|층수|매물 위치)<\/dt>/);
  }
  const evidence = item({saleExtent: "unit", saleTargetFloor: "3", saleExtentEvidence: '원본: <전체 아님> "일부"'});
  assert.doesNotMatch(ui.saleDetailsHtml(evidence), /구분 근거/);
  assert.equal(ui.buildingSaleInfoHtml(evidence), "");
  assert.doesNotMatch(ui.saleDetailsHtml(evidence), /<전체 아님>/);
});

test("conflicting original unit targets cannot revive an old master floor", () => {
  const master = item({}, {saleDetails: undefined, room: "7층"});
  master.unifiedOriginalsV8 = [item({saleExtent: "unit", saleTargetFloor: "3"}),
    item({saleExtent: "unit", saleTargetFloor: "4"})];
  assert.equal(ui.buildingSaleScopeLabel(master), "특정 층·호실 매매");
  assert.equal(ui.buildingFloorLabel(master), "층수 미확인");
  assert.equal(master.room, "7층");
});

test("unknown extent can quote a supplied original floor without interpreting it as the sale scope", () => {
  const value = item({saleExtent: "unknown", saleSourceFloorText: "4층 / 총 4층"}, {room: "전체"});
  assert.equal(ui.buildingSaleScopeLabel(value), "매매 범위 미확인");
  assert.equal(ui.buildingFloorLabel(value), "원본 층 표기: 4층 / 총 4층");
  assert.equal(ui.buildingSaleInfoHtml(value), "");
  assert.doesNotMatch(ui.buildingSaleInfoHtml(value), /건물 전체 매매|특정 층·호실 매매/);
  assert.equal(value.room, "전체");
});

test("building-sale presentation hides scope and floor metadata but preserves data and original advertisement", () => {
  const descriptionText = "광고 원문: 4층 건물 중 1층 매매, 101호 문의";
  for (const saleExtent of ["whole_building", "unit", "unknown", undefined]) {
    const value = item({saleExtent, saleTargetFloor: "1층", saleTargetRoom: "101호", saleSourceFloorText: "1층 / 총 4층",
      saleExtentEvidence: "원본 일부 선택", aboveGroundFloors: 4, belowGroundFloors: 0, totalFloors: 4,
      descriptionCategory: "multifamily", descriptionText, grossAreaM2: 100, monthlyIncome: 100},
    {name: "홍도동 청우빌라", room: "1/4층", saleCategory: "villa"});
    const before = JSON.stringify(value);
    assert.equal(ui.isBuildingSale(value), true);
    assert.equal(ui.buildingSaleInfoHtml(value), "");
    const html = ui.saleDetailsHtml(value);
    assert.doesNotMatch(html, /<dt>(?:매매 범위|구분 근거|층수|지상층수|지하층수|총층수|분류 보완|매물 위치)<\/dt>/);
    assert.match(html, /<dt>연면적<\/dt>/);
    assert.match(html, /<dt>기존 월 임대수입<\/dt>/);
    assert.ok(html.includes(descriptionText));
    assert.equal(JSON.stringify(value), before);
  }
  for (const value of [null, undefined, {}, item(), item({saleExtent: "unit"}), item({saleExtent: "unknown"}),
    item({}, {tradeType: "lease"}), item({scope: "land", landUse: "답"}, {saleCategory: "land"})]) {
    assert.equal(ui.buildingSaleInfoHtml(value), "");
  }
  const land = item({scope: "land", landUse: "답"}, {saleCategory: "land"});
  assert.equal(ui.isBuildingSale(land), false);
  assert.equal(ui.isBuildingSale({...land, tradeType: "lease"}), false);
  assert.equal(ui.isBuildingSale(null), false);
  assert.match(ui.saleDetailsHtml(land), /<dt>매매 범위<\/dt><dd>토지<\/dd>/);
  assert.match(ui.saleDetailsHtml(land), /<dt>지목<\/dt><dd>답<\/dd>/);
});
