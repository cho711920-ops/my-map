import {test, expect} from "@playwright/test";

test.beforeEach(async ({page, context}) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
});

const descriptionText = "광고 원문: 4층 건물 중 1층 매매 · 101호 문의";
const hiddenLabels = /^(?:매매 범위|구분 근거|층수|층·호실|지상층수|지하층수|총층수|분류 보완|매물 위치)$/;

async function configure(page, scenario) {
  await page.route("**/api/data?*", async route => {
    if (new URL(route.request().url()).searchParams.get("action") !== "unifiedListingDetail") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    const original = (data.originals || []).find(value => value.propertyId === "FIXTURE-BUILDING");
    if (original) {
      Object.assign(original, scenario);
      data.originals.push({...original, originalId: original.originalId + "-second"});
    }
    await route.fulfill({response, json: data});
  });
  await page.evaluate(scenario => {
    const current = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    Object.assign(current, scenario);
    window.__floorIdentity = {room: current.room, key: current.key, propertyId: current.propertyId,
      salePrice: current.salePrice, area: current.area, tradeType: current.tradeType, saleCategory: current.saleCategory};
    for (const original of current.unifiedOriginalsV8 || []) Object.assign(original, scenario,
      {saleDetails: undefined, saleSummary: scenario.saleDetails});
    current.saleDetails = null;
  }, scenario);
}

async function buildingList(page, isMobile) {
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("building_sale");
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item")).toHaveCount(1);
}

const cases = [
  {name: "Hongdo Cheongu villa first floor in a four-floor building", room: "1/4층", saleCategory: "villa",
    expectedAreas: ["전용", "11.8평"],
    saleDetails: {scope: "unit", saleExtent: "unit", saleTargetFloor: "1층", saleTargetRoom: "101호", totalFloors: 4, exclusiveAreaM2: 38.88}},
  {name: "confirmed whole building", room: "지하1층", saleCategory: "building",
    expectedAreas: ["대지", "67.6평", "연면적", "134.4평", "건축", "40.6평"],
    saleDetails: {scope: "unit", saleExtent: "whole_building", floorScope: "whole_building", aboveGroundFloors: 5, belowGroundFloors: 1,
      landAreaM2: 223.5, grossAreaM2: 444.34, buildingAreaM2: 134.05}},
  {name: "unknown sale extent with original floor evidence", room: "4층", saleCategory: "house",
    expectedAreas: ["면적 정보 미확인"],
    saleDetails: {scope: "unit", saleExtent: "unknown", saleSourceFloorText: "4층 / 총 4층", totalFloors: 4}},
  {name: "legacy scope without read-time classification", room: "301호", saleCategory: "officetel",
    expectedAreas: ["면적 정보 미확인"],
    saleDetails: {scope: "whole_building", totalFloors: 10}}
];

for (const sample of cases) {
  test(`${sample.name}: sale scope/floors are absent from list and detail without changing source data`, async ({page, isMobile}, testInfo) => {
    const scenario = {...sample, name: "홍도동 청우빌라", buildingName: "청우빌라", address: "대전 동구 홍도동 테스트 주소",
      saleDetails: {...sample.saleDetails, saleExtentEvidence: "원본 광고 근거", descriptionCategory: "multifamily",
        monthlyIncome: 100, descriptionText}};
    await configure(page, scenario);
    await buildingList(page, isMobile);
    await expect(page.locator("#list .building-sale-info-v1, #list .building-sale-scope-v1, #list .building-sale-floor-v1, #list .item-room-badge")).toHaveCount(0);
    const listArea = page.locator("#list .building-sale-area-info-v1");
    await expect(listArea).toHaveCount(1);
    await expect(listArea).toBeVisible();
    for (const text of sample.expectedAreas) await expect(listArea).toContainText(text);
    if (sample.saleDetails.exclusiveAreaM2) await expect(listArea).not.toContainText(/대지|연면적|건축/);
    if (sample.expectedAreas[0] === "면적 정보 미확인") await expect(listArea).toHaveText("면적 정보 미확인");
    await expect(page.locator("#list .item-building-name")).toContainText("청우빌라");
    await page.screenshot({path: testInfo.outputPath("building-sale-no-scope-floor-list.png")});
    await page.locator("#list .item-building-name").click();
    const drawer = page.locator("#unifiedDetailDrawerV8");
    await expect(drawer).toHaveAttribute("aria-hidden", "false");
    await expect(drawer.locator(".building-sale-info-v1, .building-sale-scope-v1, .building-sale-floor-v1")).toHaveCount(0);
    await expect(drawer.locator(".unified-detail-source-address-v827 > strong")).toHaveText(scenario.address);
    await expect(drawer.locator(".listing-sale-details-v1 dt").filter({hasText: hiddenLabels})).toHaveCount(0);
    const detailArea = drawer.locator(".building-sale-area-info-v1");
    await expect(detailArea).toHaveCount(1);
    await expect(detailArea).toBeVisible();
    for (const text of sample.expectedAreas) await expect(detailArea).toContainText(text);
    if (sample.saleDetails.grossAreaM2) await expect(drawer.locator(".listing-sale-details-v1")).toContainText("연면적");
    if (sample.saleDetails.exclusiveAreaM2) await expect(drawer.locator(".listing-sale-details-v1")).toContainText("전용면적");
    await expect(drawer.locator(".listing-sale-details-v1")).toContainText("기존 월 임대수입");
    if (isMobile) {
      await expect(drawer.locator(".phone-detail-facts-v2")).toBeVisible();
      await expect(drawer.locator(".phone-detail-facts-v2 dt").filter({hasText: hiddenLabels})).toHaveCount(0);
    }
    const originals = drawer.locator(".unified-original-row-v8");
    await expect(originals).toHaveCount(2);
    await expect(originals.locator(".unified-original-head-v8 em")).toHaveCount(0);
    const description = drawer.locator(".listing-sale-description-v1");
    await description.locator("summary").click();
    await expect(description.locator("div")).toHaveText(descriptionText);
    await page.screenshot({path: testInfo.outputPath("building-sale-no-scope-floor-detail.png")});
    expect(await page.evaluate(() => {
      const item = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
      return JSON.stringify({room: item.room, key: item.key, propertyId: item.propertyId,
        salePrice: item.salePrice, area: item.area, tradeType: item.tradeType, saleCategory: item.saleCategory}) === JSON.stringify(window.__floorIdentity);
    })).toBe(true);
  });
}

test("lease floor and land-use badges retain their existing behavior", async ({page, isMobile}) => {
  await page.evaluate(() => {
    const lease = window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
    lease.room = "3/10";
    window.applyFilter();
  });
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item").filter({hasText: "테스트 괴정 상가"}).locator(".item-room-badge")).toHaveText("3층");
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("land_sale");
  await expect(page.locator("#list .item-room-badge.land-use-badge-v1")).toHaveText("지목: 대");
  await page.locator("#list .item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("토지");
  await expect(drawer.locator(".listing-sale-details-v1 dt").filter({hasText: /^매매 범위$/})).toHaveCount(1);
  await expect(drawer.locator(".listing-sale-details-v1 dt").filter({hasText: /^지목$/})).toHaveCount(1);
});

test("building-sale favorites show known area without floor or room in the address and retain identity", async ({page, isMobile}) => {
  await expect.poll(() => page.evaluate(() => window.JSV6ListStore.load("favorite")
    .some(folder => folder.id === "fixture-favorites"))).toBe(true);
  const before = await page.evaluate(() => {
    const item = window.allItems.find(value => value.propertyId === "FIXTURE-LEASE-1");
    const identity = value => ({key: value.key, propertyId: value.propertyId, originalId: value.originalId});
    const snapshot = {
      item: identity(item),
      originals: (item.unifiedOriginalsV8 || []).map(identity),
      favoriteKeys: window.JSV6ListStore.load("favorite").find(folder => folder.id === "fixture-favorites").itemKeys,
      address: item.address
    };
    const saleDetails = {scope: "unit", saleExtent: "unit", exclusiveAreaM2: 38.88, totalFloors: 4};
    const sale = {tradeType: "sale", saleCategory: "villa", salePrice: 7000, saleDetails, room: "1층", floor: "4층"};
    Object.assign(item, sale);
    for (const original of item.unifiedOriginalsV8 || []) Object.assign(original, sale, {saleSummary: saleDetails});
    return snapshot;
  });
  await page.locator(isMobile ? '[data-mobile-view="favorites"]' : "#mapQuickListBtn").click();
  const modal = page.locator("#unifiedFavoriteModalV7");
  await expect(modal).toHaveAttribute("aria-hidden", "false");
  await expect(modal).toContainText("테스트 찜폴더");
  if (isMobile) await modal.locator(".phone-favorite-folder-card-v2").first().click();
  else await modal.getByRole("button", {name: "테스트 찜폴더 1개 보기", exact: true}).click();
  const row = modal.locator(isMobile ? ".phone-favorite-item-v2" : ".unified-favorite-item-v7");
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  const price = row.locator(isMobile ? ".phone-favorite-item-copy-v2 > strong" : ".unified-favorite-item-info-v7 > b");
  await expect(price).toContainText("매매");
  await expect(price).toContainText("전용 11.8평");
  const address = row.locator(isMobile ? ".phone-favorite-item-copy-v2 > small" : ".unified-favorite-item-info-v7 > span");
  await expect(address).toHaveText(before.address);
  await expect(address).not.toContainText(/1층|4층/);
  const after = await page.evaluate(() => {
    const item = window.allItems.find(value => value.propertyId === "FIXTURE-LEASE-1");
    const identity = value => ({key: value.key, propertyId: value.propertyId, originalId: value.originalId});
    const sale = value => ({tradeType: value.tradeType, saleCategory: value.saleCategory, salePrice: value.salePrice,
      room: value.room, floor: value.floor, saleDetails: value.saleDetails});
    return {
      identity: {item: identity(item), originals: (item.unifiedOriginalsV8 || []).map(identity),
        favoriteKeys: window.JSV6ListStore.load("favorite").find(folder => folder.id === "fixture-favorites").itemKeys,
        address: item.address},
      sale: sale(item), originalSales: (item.unifiedOriginalsV8 || []).map(sale)
    };
  });
  expect(after.identity).toEqual(before);
  const expectedSale = {tradeType: "sale", saleCategory: "villa", salePrice: 7000, room: "1층", floor: "4층",
    saleDetails: {scope: "unit", saleExtent: "unit", exclusiveAreaM2: 38.88, totalFloors: 4}};
  expect(after.sale).toEqual(expectedSale);
  expect(after.originalSales.length).toBeGreaterThan(0);
  for (const original of after.originalSales) expect(original).toEqual(expectedSale);
});
