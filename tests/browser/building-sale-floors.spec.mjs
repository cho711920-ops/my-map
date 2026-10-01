import {test, expect} from "@playwright/test";
import {withSaleExtentDisplay, saleExtentProvider} from "../../cloudflare/src/sale-extent-display.js";

test.beforeEach(async ({page, context}) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
});

async function configure(page, scenario) {
  await page.route("**/api/data?*", async route => {
    if (new URL(route.request().url()).searchParams.get("action") !== "unifiedListingDetail") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    for (const original of data.originals || []) if (original.propertyId === "FIXTURE-BUILDING") Object.assign(original, scenario);
    await route.fulfill({response, json: data});
  });
  await page.evaluate(scenario => {
    const current = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    Object.assign(current, scenario);
    window.__floorIdentity = {room: current.room, key: current.key, propertyId: current.propertyId, salePrice: current.salePrice};
    // Model actual legacy DB rows: master has no saleDetails, original list has compact summary.
    const originals = current.unifiedOriginalsV8 || [];
    for (const original of originals) Object.assign(original, scenario, {saleDetails: undefined, saleSummary: scenario.saleDetails});
    current.saleDetails = null;
  }, scenario);
}

async function buildingList(page, isMobile) {
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("building_sale");
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item")).toHaveCount(1);
}

test("whole-building range is visible in list/detail and preserves the legacy room/key", async ({page, isMobile}, testInfo) => {
  await configure(page, {room: "지하1층", saleCategory: "building", saleDetails: {scope: "unit", saleExtent: "whole_building", floorScope: "whole_building", aboveGroundFloors: 5, belowGroundFloors: 1}});
  await buildingList(page, isMobile);
  const badge = page.locator("#list .building-sale-floor-v1");
  await expect(badge).toHaveText("지하 1층 ~ 지상 5층");
  await expect(badge).toBeVisible();
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("건물 전체 매매");
  expect(await badge.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("building-range-list.png")});
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(drawer.locator(".building-sale-scope-v1")).toHaveText("건물 전체 매매");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("지하 1층 ~ 지상 5층");
  if (isMobile) await expect(drawer.locator(".phone-detail-facts-v2")).toContainText("지하 1층 ~ 지상 5층");
  expect(await page.evaluate(() => {
    const item = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    return JSON.stringify({room: item.room, key: item.key, propertyId: item.propertyId, salePrice: item.salePrice}) === JSON.stringify(window.__floorIdentity);
  })).toBe(true);
});

test("missing basement and unit sales are never rendered as an invented full-building range", async ({page, isMobile}) => {
  await configure(page, {room: "전체", saleDetails: {scope: "whole_building", saleExtent: "whole_building", aboveGroundFloors: 5}});
  await buildingList(page, isMobile);
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("지상 5층 · 지하 미확인");
  await page.evaluate(() => {
    const item = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    Object.assign(item, {room: "3/10층", saleCategory: "officetel", saleDetails: {scope: "unit", saleExtent: "unit", aboveGroundFloors: 10, belowGroundFloors: 2}});
    window.applyFilter();
  });
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("해당 3층 / 총 10층");
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("특정 층·호실 매매");
});

test("legacy default scope is visibly unconfirmed rather than incorrectly advertising a full building", async ({page, isMobile}, testInfo) => {
  await configure(page, {room: "301호", saleDetails: {scope: "whole_building", totalFloors: 5}});
  await buildingList(page, isMobile);
  const scope = page.locator("#list .building-sale-scope-v1");
  await expect(scope).toHaveText("매매 범위 미확인");
  await expect(scope).toBeVisible();
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveCount(0);
  expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("building-scope-unknown.png")});
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".building-sale-scope-v1")).toHaveText("매매 범위 미확인");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("매매 범위 미확인");
});

test("a particular floor or room sale is distinguished from selling that entire floor", async ({page, isMobile}, testInfo) => {
  await configure(page, {room: "3/10층", saleCategory: "officetel", saleDetails: {scope: "unit", saleExtent: "unit", totalFloors: 10}});
  await buildingList(page, isMobile);
  const scope = page.locator("#list .building-sale-scope-v1");
  await expect(scope).toHaveText("특정 층·호실 매매");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("해당 3층 / 총 10층");
  expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("building-scope-unit.png")});
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".building-sale-scope-v1")).toHaveText("특정 층·호실 매매");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("특정 층·호실 매매");
  if (isMobile) await expect(drawer.locator(".phone-detail-facts-v2")).toContainText("특정 층·호실 매매");
  await expect(drawer).not.toContainText("3층 전체 매매");
});

test("lease floors remain unchanged and land uses a land-use badge", async ({page, isMobile}) => {
  await page.evaluate(() => {
    const lease = window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
    lease.room = "3/10";
    lease.saleDetails = {scope: "whole_building", aboveGroundFloors: 10, belowGroundFloors: 2};
    const land = window.allItems.find(item => item.propertyId === "FIXTURE-LAND");
    land.room = "토지";
    land.saleDetails = {...land.saleDetails, landUse: null};
    for (const original of land.unifiedOriginalsV8 || []) {
      original.saleDetails = {...original.saleDetails, landUse: null};
      original.saleSummary = {...original.saleSummary, landUse: null};
    }
    window.applyFilter();
  });
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item").filter({hasText: "테스트 괴정 상가"}).locator(".item-room-badge")).toHaveText("3층");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveCount(0);
  await expect(page.locator("#list .building-sale-info-v1")).toHaveCount(0);
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("land_sale");
  await expect(page.locator("#list .item-room-badge.land-use-badge-v1")).toHaveText("지목 미확인");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveCount(0);
  await expect(page.locator("#list .building-sale-info-v1")).toHaveCount(0);
});

test("Naver explicit residence type recovers a whole factory sale from its original", async ({page, isMobile}, testInfo) => {
  const raw = {realEstateTypeCode: "E02", saleRaw: {detailInfo: {spaceInfo: {floorInfo: {
    residenceType: "2", floorType: "00", targetFloor: "-", groundTotalFloor: "2", undergroundTotalFloor: "0"
  }}}}};
  const scenario = withSaleExtentDisplay({source: "네이버", tradeType: "sale", saleCategory: "factory_warehouse",
    room: "지하1층", saleDetails: {scope: "unit"}}, saleExtentProvider(raw, "네이버"));
  await configure(page, scenario);
  await buildingList(page, isMobile);
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("건물 전체 매매");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("지상 1층 ~ 지상 2층");
  await page.screenshot({path: testInfo.outputPath("recovered-whole-building.png")});
  await page.locator("#list .item-building-name").click();
  const detail = page.locator("#unifiedDetailDrawerV8 .listing-sale-details-v1");
  await expect(detail).toContainText("건물 전체 매매");
  await expect(detail).toContainText("구분 근거");
  await expect(detail).toContainText(scenario.saleDetails.saleExtentEvidence);
});

test("explicit original targets replace stale floor labels while preserving stored room and favorites identity", async ({page, isMobile}, testInfo) => {
  const scenario = withSaleExtentDisplay({source: "공실박스", tradeType: "sale", saleCategory: "apartment",
    room: "1층", saleDetails: {scope: "unit", totalFloors: 12}},
  saleExtentProvider({list: {TypeView: "APT", Ho: "402", Ff: 4}}, "공실박스"));
  await configure(page, scenario);
  await buildingList(page, isMobile);
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("특정 층·호실 매매");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("해당 4층 · 402호 / 총 12층");
  await page.screenshot({path: testInfo.outputPath("recovered-specific-unit.png")});
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("해당 4층 · 402호 / 총 12층");
  if (isMobile) await expect(drawer.locator(".phone-detail-facts-v2")).toContainText("해당 4층 · 402호 / 총 12층");
  expect(await page.evaluate(() => {
    const item = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    return JSON.stringify({room: item.room, key: item.key, propertyId: item.propertyId, salePrice: item.salePrice}) === JSON.stringify(window.__floorIdentity);
  })).toBe(true);
});

test("a private original floor still identifies a unit without revealing a legacy stale floor", async ({page, isMobile}) => {
  const raw = {realEstateTypeCode: "A02", saleRaw: {detailInfo: {spaceInfo: {floorInfo: {
    residenceType: "1", floorType: "30", targetFloor: "-", totalFloor: "25"
  }}}}};
  const scenario = withSaleExtentDisplay({source: "네이버", tradeType: "sale", saleCategory: "officetel",
    room: "7층", saleDetails: {scope: "unit"}}, saleExtentProvider(raw, "네이버"));
  await configure(page, scenario);
  await buildingList(page, isMobile);
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("특정 층·호실 매매");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("해당층 비공개 / 총 25층");
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".building-sale-floor-v1")).toHaveText("해당층 비공개 / 총 25층");
  await expect(drawer.locator(".listing-sale-details-v1")).not.toContainText("7층");
});

test("advertised multifamily composition recovers the whole sale even when the provider defaults to false", async ({page, isMobile}) => {
  const raw = {salesTypeV3: {type: "TWO_ROOM"}, isEntireBuilding: false, content:
    "중개대상물 종류 - 다가구주택\n세대수 - 15세대\n대지면적 - 약 67평 (223.5㎡)\n연면적 - 약 134평 (444.34㎡)\n총층수 - 5층\n원룸, 1.5룸, 투룸 구성"};
  const scenario = withSaleExtentDisplay({source: "당근", tradeType: "sale", saleCategory: "other", room: "층수미확인",
    saleDetails: {scope: "unit", descriptionText: raw.content}}, saleExtentProvider(raw, "당근"));
  await configure(page, scenario);
  await buildingList(page, isMobile);
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("건물 전체 매매");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("총 5층");
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("구분 근거");
  await expect(drawer.locator(".building-sale-floor-v1")).toHaveText("총 5층");
});

test("a source with no description quotes its floor but does not invent a whole building from room counts", async ({page, isMobile}, testInfo) => {
  const raw = {salesTypeV3: {type: "HOUSE"}, isEntireBuilding: false, floor: "4.0", topFloor: 4,
    roomCnt: 18, bathroomCnt: 17, content: ""};
  const scenario = withSaleExtentDisplay({source: "당근", tradeType: "sale", saleCategory: "house", room: "4층",
    saleDetails: {scope: "unit", totalFloors: 4}}, saleExtentProvider(raw, "당근"));
  await configure(page, scenario);
  await buildingList(page, isMobile);
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("매매 범위 미확인");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("원본 층 표기: 4층 / 총 4층");
  await page.screenshot({path: testInfo.outputPath("unconfirmed-original-floor.png")});
  await page.locator("#list .item-building-name").click();
  await expect(page.locator("#unifiedDetailDrawerV8 .building-sale-floor-v1")).toHaveText("원본 층 표기: 4층 / 총 4층");
});
