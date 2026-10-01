import {test, expect} from "@playwright/test";

test.beforeEach(async ({page, context}) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
});

async function configureLand(page, landUse, room = "3층") {
  const details = {scope: "land", landAreaM2: 330.5785, landUse, zoning: "제2종일반주거지역"};
  await page.route("**/api/data?*", async route => {
    if (new URL(route.request().url()).searchParams.get("action") !== "unifiedListingDetail") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    for (const original of data.originals || []) if (original.propertyId === "FIXTURE-LAND") {
      Object.assign(original, {room, saleDetails: details});
    }
    await route.fulfill({response, json: data});
  });
  await page.evaluate(({details, room}) => {
    const item = window.allItems.find(value => value.propertyId === "FIXTURE-LAND");
    item.room = room;
    // Initial production list responses carry a compact source summary, not full details.
    item.saleDetails = null;
    item.saleSummary = null;
    for (const original of item.unifiedOriginalsV8 || []) {
      Object.assign(original, {room, saleDetails: undefined, saleSummary: {...details}});
    }
    window.__landUseIdentity = {room: item.room, key: item.key, propertyId: item.propertyId, salePrice: item.salePrice};
  }, {details, room});
}

async function selectMarket(page, isMobile, mode) {
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption(mode);
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
}

async function expectLandIdentityUnchanged(page) {
  expect(await page.evaluate(() => {
    const item = window.allItems.find(value => value.propertyId === "FIXTURE-LAND");
    return JSON.stringify({room: item.room, key: item.key, propertyId: item.propertyId, salePrice: item.salePrice}) ===
      JSON.stringify(window.__landUseIdentity);
  })).toBe(true);
}

test("land cards use compact-source land use once, keep zoning, and hide the legacy floor", async ({page, isMobile}, testInfo) => {
  await configureLand(page, "대");
  await selectMarket(page, isMobile, "land_sale");
  const card = page.locator("#list .item");
  await expect(card).toHaveCount(1);
  const badge = card.locator(".item-room-badge.land-use-badge-v1");
  await expect(badge).toHaveText("지목: 대");
  await expect(badge).toBeVisible();
  await expect(card.locator(".item-address-room-v650")).not.toContainText("3층");
  await expect(card).not.toContainText("호실 -");
  await expect(card.locator(".listing-land-info-v1")).toContainText("용도지역");
  await expect(card.locator(".listing-land-info-v1")).toContainText("제2종일반주거지역");
  await expect(card.locator(".listing-land-info-v1")).not.toContainText("지목");
  expect(((await card.innerText()).match(/지목/g) || []).length).toBe(1);
  await expect(card.locator(".building-sale-info-v1")).toHaveCount(0);
  await expectLandIdentityUnchanged(page);
  await page.screenshot({path: testInfo.outputPath("land-use-card.png")});

  await card.locator(".item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(drawer.locator(".unified-detail-source-address-v827")).toContainText("지목: 대");
  await expect(drawer.locator(".unified-detail-source-address-v827")).not.toContainText("3층");
  await expect(drawer.locator(".listing-sale-details-v1")).toContainText("지목");
  if (isMobile) {
    const facts = drawer.locator(".phone-detail-facts-v2");
    await expect(facts.locator("dt").filter({hasText: /^지목$/})).toHaveCount(1);
    await expect(facts.locator("dt").filter({hasText: /^층·호실$/})).toHaveCount(0);
    await expect(facts).not.toContainText("3층");
  }
  await expectLandIdentityUnchanged(page);
});

test("missing land use is explicit even when an old floor or room is present", async ({page, isMobile}) => {
  await configureLand(page, null, "301호");
  await selectMarket(page, isMobile, "land_sale");
  const card = page.locator("#list .item");
  await expect(card.locator(".item-room-badge.land-use-badge-v1")).toHaveText("지목 미확인");
  await expect(card).not.toContainText("301호");
  await expect(card).not.toContainText("호실 -");
  await expect(card.locator(".listing-land-info-v1")).toContainText("제2종일반주거지역");
  expect(((await card.innerText()).match(/지목/g) || []).length).toBe(1);
  await expectLandIdentityUnchanged(page);
});

test("long land-use values stay inside the address row on desktop and phone", async ({page, isMobile}, testInfo) => {
  const longLandUse = "대(일부 전·답·임야 포함, 복수 필지의 지목은 원본 자료 확인 필요)";
  await configureLand(page, longLandUse);
  await selectMarket(page, isMobile, "land_sale");
  const badge = page.locator("#list .item-room-badge.land-use-badge-v1");
  await expect(badge).toHaveText("지목: " + longLandUse);
  await expect(badge).toBeVisible();
  expect(await badge.evaluate(element => {
    const row = element.closest(".item-address-room-v650");
    const badgeRect = element.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth + 1 && badgeRect.left >= rowRect.left - 1 &&
      badgeRect.right <= rowRect.right + 1;
  })).toBe(true);
  await page.screenshot({path: testInfo.outputPath("land-use-long.png")});
  await expectLandIdentityUnchanged(page);
});

test("land-use decoration does not change lease floors or building-sale scope badges", async ({page, isMobile}) => {
  await page.evaluate(() => {
    const lease = window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
    lease.room = "3/10";
    lease.saleDetails = {landUse: "대", zoning: "일반주거지역"};
    const building = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    building.room = "전체";
    building.saleDetails = {scope: "whole_building", saleExtent: "whole_building", landUse: "대", aboveGroundFloors: 5, belowGroundFloors: 1};
    window.applyFilter();
  });
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  const leaseCard = page.locator("#list .item").filter({hasText: "테스트 괴정 상가"});
  await expect(leaseCard.locator(".item-room-badge")).toHaveText("3층");
  await expect(page.locator("#list .land-use-badge-v1")).toHaveCount(0);
  await selectMarket(page, isMobile, "building_sale");
  await expect(page.locator("#list .building-sale-scope-v1")).toHaveText("건물 전체 매매");
  await expect(page.locator("#list .building-sale-floor-v1")).toHaveText("지하 1층 ~ 지상 5층");
  await expect(page.locator("#list .land-use-badge-v1")).toHaveCount(0);
});
