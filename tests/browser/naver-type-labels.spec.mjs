import {test, expect} from "@playwright/test";

test.beforeEach(async ({page, context}) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  await page.route("**/api/data?*", async route => {
    if (new URL(route.request().url()).searchParams.get("action") !== "unifiedListingDetail") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    for (const original of data.originals || []) if (original.propertyId === "FIXTURE-BUILDING") {
      original.type = "A02"; original.saleCategory = "other";
    }
    await route.fulfill({response, json: data});
  });
  await page.evaluate(() => {
    const old = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    old.type = "A02"; old.saleCategory = "other";
    for (const original of old.unifiedOriginalsV8 || []) {original.type = "A02"; original.saleCategory = "other";}
    window.__oldTypeIdentity = {key: old.key, propertyId: old.propertyId};
    window.allItems.push({...old, type: "오피스텔", saleCategory: "officetel", propertyId: "FIXTURE-NEW-OFFICETEL", key: "fixture-new-officetel", name: "신규 오피스텔", unifiedOriginalsV8: []});
    window.allItems.push({...old, type: "B01", saleCategory: "other", propertyId: "FIXTURE-PRESALE", key: "fixture-presale", name: "분양권 매물", unifiedOriginalsV8: []});
  });
});

test("Korean type dropdown filters old codes and new labels together without changing favorite identity", async ({page, isMobile}) => {
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("building_sale");
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  if (isMobile) {
    await page.locator('#jsMobileSearchFormV1 [data-mobile-action="filter"]').click();
    await page.getByText("출처 · 매물 구분 · 중개보수", {exact: true}).click();
  }
  const filter = page.locator(isMobile ? "#v6DetailSheet_typeFilter" : "#typeFilter");
  await expect(filter.locator("option")).toHaveText([isMobile ? "전체" : "구분", "아파트분양권", "오피스텔"]);
  await filter.selectOption({label: "오피스텔"});
  if (isMobile) await page.locator(".js-phone-filter-apply").click();
  await expect(page.locator("#list .item")).toHaveCount(2);
  await expect(page.locator("#list .type-badge")).toHaveText(["오피스텔", "오피스텔"]);
  await page.locator("#list .item").filter({hasText: "테스트 건물매매"}).locator(".item-building-name").click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  if (isMobile) await expect(drawer.locator(".phone-detail-facts-v2")).toContainText("오피스텔");
  await expect(drawer).not.toContainText(/\bA02\b/);
  const identity = await page.evaluate(() => {
    const old = window.allItems.find(item => item.propertyId === "FIXTURE-BUILDING");
    return {key: old.key, propertyId: old.propertyId, type: old.type, before: window.__oldTypeIdentity};
  });
  expect(identity.type).toBe("A02");
  expect({key: identity.key, propertyId: identity.propertyId}).toEqual(identity.before);
});

test("Korean keyword search finds a legacy coded listing and keeps lease/building/land separated", async ({page, isMobile}) => {
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("building_sale");
  const search = page.locator(isMobile ? "#jsMobileKeywordV1" : "#keyword");
  await search.fill("오피스텔");
  await search.press("Enter");
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item")).toHaveCount(2);
  await expect(page.locator("#list")).toContainText("테스트 건물매매");
  await search.fill("");
  await search.press("Enter");
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("lease");
  await expect(page.locator("#list .item")).toHaveCount(2);
  await expect(page.locator("#list")).not.toContainText("테스트 건물매매");
  await page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1").selectOption("land_sale");
  await expect(page.locator("#list .item")).toHaveCount(1);
  await expect(page.locator("#list")).toContainText("테스트 토지매매");
});
