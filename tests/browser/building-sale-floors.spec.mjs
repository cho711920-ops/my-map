import {test, expect} from "@playwright/test";

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
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("일부 매매(층·호실)");
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
  await expect(scope).toHaveText("일부 매매(층·호실)");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("해당 3층 / 총 10층");
  expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("building-scope-unit.png")});
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".building-sale-scope-v1")).toHaveText("일부 매매(층·호실)");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("일부 매매(층·호실)");
  if (isMobile) await expect(drawer.locator(".phone-detail-facts-v2")).toContainText("일부 매매(층·호실)");
  await expect(drawer).not.toContainText("3층 전체 매매");
});

test("lease and land room labels remain unchanged", async ({page, isMobile}) => {
  await page.evaluate(() => {
    const lease = window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
    lease.room = "3/10";
    lease.saleDetails = {scope: "whole_building", aboveGroundFloors: 10, belowGroundFloors: 2};
    const land = window.allItems.find(item => item.propertyId === "FIXTURE-LAND");
    land.room = "토지";
    window.applyFilter();
  });
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item").filter({hasText: "테스트 괴정 상가"}).locator(".item-room-badge")).toHaveText("3층");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveCount(0);
  await expect(page.locator("#list .building-sale-info-v1")).toHaveCount(0);
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("land_sale");
  await expect(page.locator("#list .item-room-badge")).toHaveText("토지");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveCount(0);
  await expect(page.locator("#list .building-sale-info-v1")).toHaveCount(0);
});
