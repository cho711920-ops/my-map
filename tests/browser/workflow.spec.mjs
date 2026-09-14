import {test, expect} from "@playwright/test";

// These are real UI-module regression tests against synthetic loopback data.
// Authentication, third-party maps and collector websites are outside this fixture.
test.beforeEach(async ({page, context}) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
});

async function listView(page, isMobile) {
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item").first()).toBeVisible();
}
function market(page, isMobile) {return page.locator(isMobile ? "#jsMobileTradeModeV1" : "#listingTradeModeSelectV1");}

test("search works and the same listing card toggles its detail", async ({page, isMobile}) => {
  const search = page.locator(isMobile ? "#jsMobileKeywordV1" : "#keyword");
  await search.fill("괴정");
  await search.press("Enter");
  await listView(page, isMobile);
  await expect(page.locator("#list .item")).toHaveCount(1);
  const title = page.locator("#list .item .item-building-name").first();
  await title.click();
  const drawer = page.locator("#unifiedDetailDrawerV8");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  if (isMobile) {
    // Mobile uses a full-screen detail: close it with the actual close control.
    await drawer.locator("header button").click();
  } else {
    await title.click();
  }
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
  await expect(search).toHaveValue("괴정");
});

test("both screen sizes share the market and sale-filter controls", async ({page, isMobile}) => {
  await market(page, isMobile).selectOption("building_sale");
  await listView(page, isMobile);
  await expect(page.locator("#list .item")).toHaveCount(1);
  await expect(page.locator("#list")).toContainText("테스트 건물매매");
  const trigger = page.locator(isMobile ? '#jsMobileSearchFormV1 [data-mobile-action="filter"]' : "#detailBtn");
  await trigger.click();
  const price = page.locator(isMobile ? "#v6DetailSheet_minDeposit" : "#minDeposit");
  await expect(price).toHaveAttribute("placeholder", /매매가/);
  await expect(page.locator("#saleLandMin")).toBeVisible();
  await expect(page.locator("#saleGrossMin")).toBeVisible();
  await expect(page.locator(isMobile ? "#v6DetailSheet_minRent" : "#minRent")).toBeHidden();
  if (isMobile) {
    await page.locator("#saleLandMin").fill("9999");
    await page.keyboard.press("Escape");
    await expect(page.locator("#v6DetailSheetPortal")).not.toHaveClass(/open/);
    await expect(trigger).toBeFocused();
    await expect(page.locator("#detailFilter #saleFiltersV1")).toHaveCount(1);
    await expect(page.locator("#saleLandMin")).toHaveValue("");
  } else {
    await trigger.click();
  }
  await market(page, isMobile).selectOption("land_sale");
  await trigger.click();
  await expect(page.locator("#saleUnitPriceMin")).toBeVisible();
  await expect(page.locator("#saleGrossMin")).toBeHidden();
  await expect(page.locator("#saleFiltersV1")).toHaveCount(1);
});

test("favorite-folder map filtering survives returning from an original link", async ({page, context, isMobile}) => {
  if (isMobile) {
    await page.locator('[data-mobile-view="more"]').click();
    await page.locator('[data-mobile-action="favorites"]').click();
  } else {
    await page.locator("#mapQuickListBtn").click();
  }
  const favorites = page.locator("#unifiedFavoriteModalV7");
  await expect(favorites).toContainText("테스트 찜폴더");
  await favorites.getByRole("button", {name: "지도 보기", exact: true}).click();
  await expect(page).toHaveURL("http://127.0.0.1:4179/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  await listView(page, isMobile);
  await expect(page.locator("#list .item")).toHaveCount(1);
  await page.locator("#list .item .item-building-name").first().click();
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", {name: "선택한 원본 링크 열기"}).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveTitle("가상 원본 매물");
  await popup.close();
  await page.bringToFront();
  await expect(page).toHaveURL("http://127.0.0.1:4179/");
  await expect.poll(() => page.evaluate(() => window.activeFavoriteFolderId)).toBe("fixture-favorites");
  await expect.poll(() => page.evaluate(() => window.favoriteOnly)).toBe(true);
  await expect(page.locator("#list .item")).toHaveCount(1);
});

test("local save failure is visible and retry does not report a phantom save", async ({page, isMobile}) => {
  await page.evaluate(() => {
    window.__fixtureOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "js_async_mutation_outbox_v1") throw new DOMException("Fixture quota", "QuotaExceededError");
      return window.__fixtureOriginalSetItem.call(this, key, value);
    };
  });
  await page.locator("#fixtureSave").click();
  await expect(page.locator("#fixtureSaveResult")).toHaveText("저장 실패 · 다시 시도");
  await expect.poll(() => page.evaluate(() => window.JSAsyncMutations.pendingCount())).toBe(0);
  const badge = page.locator(isMobile ? "#jsMobileSaveStatusV1" : "#asyncMutationStatusV1");
  await expect(badge).toBeVisible();
  if (isMobile) await expect(badge).toContainText("저장 실패 1건");
  await page.evaluate(() => {Storage.prototype.setItem = window.__fixtureOriginalSetItem;});
  await page.locator("#fixtureSave").click();
  await expect(page.locator("#fixtureSaveResult")).toHaveText("전송 대기 접수");
  await expect.poll(() => page.evaluate(() => window.JSAsyncMutations.getStatus().completed)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.JSAsyncMutations.pendingCount())).toBe(0);
  await expect.poll(() => page.evaluate(() => window.JSAsyncMutations.getStatus().failed)).toBe(0);
});

test("mobile more sheet restores keyboard focus after Escape", async ({page, isMobile}) => {
  test.skip(!isMobile, "Mobile-only sheet");
  const trigger = page.locator('[data-mobile-view="more"]');
  await trigger.click();
  const layer = page.locator("#jsMobileMoreLayerV1");
  await expect(layer).toHaveClass(/open/);
  await expect(layer.locator("header button")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(layer).not.toHaveClass(/open/);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator('[data-mobile-action="favorites"]').click();
  await expect(page.locator("#unifiedFavoriteModalV7")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#unifiedFavoriteModalV7")).not.toHaveClass(/open/);
  await expect(trigger).toBeFocused();
});

test("desktop to mobile resizing preserves the visible keyword and market", async ({page, isMobile}) => {
  test.skip(isMobile, "Starts from the desktop layout");
  await page.locator("#keyword").fill("괴정");
  await page.locator("#keyword").press("Enter");
  await page.locator("#listingTradeModeSelectV1").selectOption("building_sale");
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator("#jsMobileKeywordV1")).toHaveValue("괴정");
  await expect(page.locator("#jsMobileTradeModeV1")).toHaveValue("building_sale");
  await listView(page, true);
  await expect(page.locator("#list .item")).toHaveCount(1);
  await expect(page.locator("#list")).toContainText("테스트 건물매매");
});
