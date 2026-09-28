import {test, expect} from "@playwright/test";

// Exercise the real list, favorite store and modal against loopback-only data.
// No production listings, authenticated accounts or external sites are touched.
const reviewFolderId = "fixture-map-review";
const otherFolderId = "fixture-map-other";
const firstRef = "property:FIXTURE-LEASE-1";
const secondRef = "property:FIXTURE-LEASE-2";

test.beforeEach(async ({page, context}) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  // Allow the initial account-scoped cloud read to finish before installing data.
  await expect.poll(() => page.evaluate(() => window.JSV6ListStore.load("favorite").some(folder => folder.id === "fixture-favorites"))).toBe(true);
  await page.evaluate(({reviewFolderId, otherFolderId, firstRef, secondRef}) => {
    const timestamp = "2026-09-28T00:00:00Z";
    window.JSV6ListStore.save("favorite", [
      {id: reviewFolderId, name: "광택세차", itemKeys: [firstRef, secondRef], createdAt: timestamp, updatedAt: timestamp},
      {id: otherFolderId, name: "다른 고객 후보", itemKeys: [firstRef], createdAt: timestamp, updatedAt: timestamp}
    ]);
    window.applyFilter();
  }, {reviewFolderId, otherFolderId, firstRef, secondRef});
});

async function showList(page, isMobile) {
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item").first()).toBeVisible();
}

async function showFolderOnMap(page, isMobile, name = "광택세차") {
  await page.locator(isMobile ? '[data-mobile-view="favorites"]' : "#mapQuickListBtn").click();
  const modal = page.locator("#unifiedFavoriteModalV7");
  await expect(modal).toHaveAttribute("aria-hidden", "false");
  if (isMobile) {
    const backToIndex = modal.getByRole("button", {name: "찜폴더 목록으로", exact: true});
    if (await backToIndex.isVisible()) await backToIndex.click();
    await modal.locator(".phone-favorite-folder-card-v2").filter({hasText: name}).click();
    await modal.getByRole("button", {name: "지도 보기", exact: true}).click();
  } else {
    const mapButton = modal.getByRole("button", {name: "지도 보기", exact: true});
    await mapButton.nth(name === "광택세차" ? 0 : 1).click();
  }
  await expect(modal).toHaveAttribute("aria-hidden", "true");
  await showList(page, isMobile);
}

function row(page, propertyId = "FIXTURE-LEASE-1") {
  return page.locator('#list .item[data-property-id="' + propertyId + '"]');
}

async function savedFolders(page) {
  return page.evaluate(() => window.JSV6ListStore.load("favorite").map(folder => ({id: folder.id, itemKeys: [...folder.itemKeys]})));
}

async function expectFolderMode(page, count) {
  await expect.poll(() => page.evaluate(() => ({folder: window.activeFavoriteFolderId, favoriteOnly: window.favoriteOnly}))).toEqual({folder: reviewFolderId, favoriteOnly: true});
  await expect(page.locator("#list")).toHaveAttribute("data-total-count", String(count));
  if (count <= 2) await expect(page.locator("#list .item")).toHaveCount(count);
}

async function confirmRemoval(page, button, accept) {
  const dialogEvent = page.waitForEvent("dialog");
  const click = button.click();
  const dialog = await dialogEvent;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toContain("광택세차");
  expect(dialog.message()).toContain("제거");
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await click;
}

test("ordinary lists keep selection checkboxes and no folder-removal action", async ({page, isMobile}) => {
  await showList(page, isMobile);
  await expect(page.locator("#list .item .action-select-check")).toHaveCount(2);
  await expect(page.locator("#list .favorite-map-remove-v1")).toHaveCount(0);
  if (!isMobile) {
    await row(page).locator(".action-select-check").check();
    await expect.poll(() => page.evaluate(() => window.selectedPrintKeys.length)).toBe(1);
    await expect(page.locator('#unifiedDetailDrawerV8[aria-hidden="false"]')).toHaveCount(0);
  }
});

test("map view keeps row checkboxes beside removal and cancel leaves folder, selection and detail untouched", async ({page, isMobile}, testInfo) => {
  await showFolderOnMap(page, isMobile);
  await expectFolderMode(page, 2);
  await expect(page.locator("#list .action-select-check")).toHaveCount(2);
  if (!isMobile) {
    await expect(page.locator("#listMasterCheckbox")).toBeVisible();
    await expect(row(page).locator(".action-select-check")).toBeVisible();
    const checkboxBox = await row(page).locator(".action-select-check").boundingBox();
    const removalBox = await row(page).locator(".favorite-map-remove-v1").boundingBox();
    expect(checkboxBox.x + checkboxBox.width).toBeLessThan(removalBox.x);
  }
  const button = row(page).locator(".item-compact-head-v650 .favorite-map-remove-v1");
  await expect(button).toBeVisible();
  await expect(button).toHaveText("찜 제거");
  const foldersBefore = await savedFolders(page);
  await confirmRemoval(page, button, false);
  expect(await savedFolders(page)).toEqual(foldersBefore);
  await expectFolderMode(page, 2);
  await expect.poll(() => page.evaluate(() => window.selectedPrintKeys)).toEqual([]);
  await expect(page.locator('#unifiedDetailDrawerV8[aria-hidden="false"]')).toHaveCount(0);
  await page.screenshot({path: testInfo.outputPath(isMobile ? "favorite-map-remove-mobile.png" : "favorite-map-remove-desktop-1280.png")});
  if (!isMobile) {
    await page.setViewportSize({width: 1794, height: 865});
    await expect(button).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("favorite-map-remove-desktop.png")});
  }
});

test("confirmed removal affects only this folder and an empty map folder stays selected", async ({page, isMobile}) => {
  await showFolderOnMap(page, isMobile);
  const allItemsBefore = await page.evaluate(() => window.allItems.map(item => ({key: item.key, propertyId: item.propertyId})));
  await confirmRemoval(page, row(page).locator(".favorite-map-remove-v1"), true);
  await expectFolderMode(page, 1);
  await expect(row(page)).toHaveCount(0);
  expect(await savedFolders(page)).toEqual([
    {id: reviewFolderId, itemKeys: [secondRef]},
    {id: otherFolderId, itemKeys: [firstRef]}
  ]);
  expect(await page.evaluate(() => window.allItems.map(item => ({key: item.key, propertyId: item.propertyId})))).toEqual(allItemsBefore);
  await expect.poll(() => page.evaluate(() => window.selectedPrintKeys)).toEqual([]);
  await expect(page.locator('#unifiedDetailDrawerV8[aria-hidden="false"]')).toHaveCount(0);
  await confirmRemoval(page, row(page, "FIXTURE-LEASE-2").locator(".favorite-map-remove-v1"), true);
  await expectFolderMode(page, 0);
  expect(await savedFolders(page)).toEqual([
    {id: reviewFolderId, itemKeys: []},
    {id: otherFolderId, itemKeys: [firstRef]}
  ]);
  expect(await page.evaluate(() => window.allItems.map(item => ({key: item.key, propertyId: item.propertyId})))).toEqual(allItemsBefore);
});

test("clearing the favorite-folder filter removes only the folder-removal action", async ({page, isMobile}) => {
  await showFolderOnMap(page, isMobile);
  const chip = page.locator(isMobile ? "#jsPhoneFilterChipsV2 button" : "#activeFilterChipsV844 button").filter({hasText: "광택세차"});
  await chip.click();
  await expect.poll(() => page.evaluate(() => window.favoriteOnly)).toBe(false);
  await expect(page.locator("#list .favorite-map-remove-v1")).toHaveCount(0);
  await expect(page.locator("#list .action-select-check")).toHaveCount(2);
  if (!isMobile) {
    await expect(page.locator("#listMasterCheckbox")).toBeVisible();
    await row(page).locator(".action-select-check").check();
    await expect.poll(() => page.evaluate(() => window.selectedPrintKeys.length)).toBe(1);
  }
});

test("stale removal requests cannot mutate a previous folder after switching or clearing the filter", async ({page, isMobile}) => {
  await showFolderOnMap(page, isMobile);
  const foldersBefore = await savedFolders(page);
  await showFolderOnMap(page, isMobile, "다른 고객 후보");
  await expect.poll(() => page.evaluate(() => window.activeFavoriteFolderId)).toBe(otherFolderId);
  const attemptedDialogs = await page.evaluate(({reviewFolderId, otherFolderId, firstRef}) => {
    const previousConfirm = window.confirm;
    let dialogs = 0;
    window.confirm = () => {dialogs += 1; return true;};
    try {
      window.removeFavoriteMapItemV1(encodeURIComponent(reviewFolderId), encodeURIComponent(firstRef));
      window.clearActiveFilterChipV844("favoriteOnly");
      window.removeFavoriteMapItemV1(encodeURIComponent(otherFolderId), encodeURIComponent(firstRef));
    } finally {
      window.confirm = previousConfirm;
    }
    return dialogs;
  }, {reviewFolderId, otherFolderId, firstRef});
  expect(attemptedDialogs).toBe(0);
  expect(await savedFolders(page)).toEqual(foldersBefore);
  await expect(page.locator("#list .favorite-map-remove-v1")).toHaveCount(0);
  await expect(page.locator("#list .action-select-check")).toHaveCount(2);
});

test("returning from an original link preserves the folder-removal mode", async ({page, context, isMobile}) => {
  await showFolderOnMap(page, isMobile);
  await row(page).locator(".item-building-name").click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", {name: "선택한 원본 링크 열기"}).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveTitle("가상 원본 매물");
  await popup.close();
  await page.bringToFront();
  await page.locator("#unifiedDetailDrawerV8 > header button").click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "true");
  await expectFolderMode(page, 2);
  await expect(row(page).locator(".favorite-map-remove-v1")).toBeVisible();
  await expect(page.locator("#list .action-select-check")).toHaveCount(2);
  await confirmRemoval(page, row(page).locator(".favorite-map-remove-v1"), false);
});

test("desktop removal closes only the matching detail after confirmation", async ({page, isMobile}) => {
  test.skip(isMobile, "Phone details intentionally cover the underlying listing controls");
  await showFolderOnMap(page, false);
  await row(page).locator(".item-building-name").click();
  const detail = page.locator("#unifiedDetailDrawerV8");
  await expect(detail).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => page.evaluate(() => window.JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-1"))).toBe(true);
  await confirmRemoval(page, row(page).locator(".favorite-map-remove-v1"), false);
  await expect(detail).toHaveAttribute("aria-hidden", "false");
  await expectFolderMode(page, 2);
  await confirmRemoval(page, row(page, "FIXTURE-LEASE-2").locator(".favorite-map-remove-v1"), true);
  await expectFolderMode(page, 1);
  await expect(detail).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => page.evaluate(() => window.JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-1"))).toBe(true);
  await confirmRemoval(page, row(page).locator(".favorite-map-remove-v1"), true);
  await expectFolderMode(page, 0);
  await expect(detail).toHaveAttribute("aria-hidden", "true");
});

test("desktop folder map checkboxes still complete a field visit without removing favorites", async ({page, isMobile}, testInfo) => {
  test.skip(isMobile, "Phone browsing intentionally hides legacy selection and visit-management controls");
  // The common fixture omits the map toolbar module. Load its real selection
  // bar behavior here; only the write response is synthetic, never the UI path.
  await page.addScriptTag({url: "/js/map-quick-tools-v657.js"});
  const mutations = [];
  await page.route("**/api/data", async route => {
    const request = route.request();
    const payload = request.method() === "POST" ? request.postDataJSON() : null;
    if (payload?.action !== "toggleDone") return route.fallback();
    mutations.push(payload);
    return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, persisted: true})});
  });
  await page.evaluate(() => {
    window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1").memo = "(임장가자) / 방문 확인 테스트";
    window.applyFilter();
  });
  await showFolderOnMap(page, false);
  const foldersBefore = await savedFolders(page);
  const master = page.locator("#listMasterCheckbox");
  await page.locator(".list-master-select").click();
  await expect(master).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.selectedPrintKeys.length)).toBe(2);
  await expect(page.locator("#selectionActionBar")).toBeVisible();
  await expect(page.locator("#selectionActionCount")).toHaveText("2건 선택");
  await page.locator(".list-master-select").click();
  await expect(master).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.selectedPrintKeys.length)).toBe(0);
  await row(page).locator(".action-select-check").check();
  await expect(page.locator("#selectionActionCount")).toHaveText("1건 선택");
  await expect(page.locator("#selectionActionBar .selection-visit-btn")).toBeVisible();
  await expect(page.locator('#unifiedDetailDrawerV8[aria-hidden="false"]')).toHaveCount(0);
  // Cancelling removal must not discard the separately selected visit target.
  await confirmRemoval(page, row(page).locator(".favorite-map-remove-v1"), false);
  await expect(row(page).locator(".action-select-check")).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.selectedPrintKeys.length)).toBe(1);
  await page.screenshot({path: testInfo.outputPath("favorite-map-checkbox-visit-ready-desktop.png")});
  const dialogEvent = page.waitForEvent("dialog");
  const click = page.locator("#selectionActionBar .selection-visit-btn").click();
  const dialog = await dialogEvent;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toBe("임장을 완료할까요?");
  await dialog.accept();
  await click;
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0]).toMatchObject({
    action: "toggleDone", key: {propertyId: "FIXTURE-LEASE-1"},
    state: "active", memo: "(확인매물) / 방문 확인 테스트"
  });
  await expect(page.locator("#status")).toHaveText("임장 처리 1개 저장 요청 완료");
  await expect.poll(() => page.evaluate(() => window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1").memo)).toBe("(확인매물) / 방문 확인 테스트");
  await expect.poll(() => page.evaluate(() => window.selectedPrintKeys)).toEqual([]);
  await expect(page.locator("#selectionActionBar")).toBeHidden();
  await expectFolderMode(page, 2);
  expect(await savedFolders(page)).toEqual(foldersBefore);
  await expect(row(page).locator(".favorite-map-remove-v1")).toBeVisible();
  await expect(row(page).locator(".action-select-check")).not.toBeChecked();
  await page.screenshot({path: testInfo.outputPath("favorite-map-checkbox-visit-completed-desktop.png")});
});

test("removing a deep virtualized row preserves the neighboring card and scroll position", async ({page, isMobile}) => {
  await page.evaluate(({reviewFolderId}) => {
    const original = window.allItems[0];
    const clones = Array.from({length: 80}, (_, index) => ({
      ...original, key: "favorite-review-scroll-" + index,
      propertyId: "FAVORITE-REVIEW-SCROLL-" + index, name: "찜 검토 스크롤 " + index
    }));
    window.allItems = window.allItems.concat(clones);
    const folders = window.JSV6ListStore.load("favorite");
    folders.find(folder => folder.id === reviewFolderId).itemKeys = clones.map(item => "property:" + item.propertyId);
    window.JSV6ListStore.save("favorite", folders);
    window.applyFilter();
  }, {reviewFolderId});
  await showFolderOnMap(page, isMobile);
  await expectFolderMode(page, 80);
  const scroller = page.locator(isMobile ? "#list" : "#sidebar");
  const list = page.locator("#list");
  // Scroll through actual incremental rendering until leading cards have been
  // evicted into the virtual spacer, not merely below the initial viewport.
  for (let attempt = 0; attempt < 6 && Number(await list.getAttribute("data-rendered-start")) === 0; attempt += 1) {
    const previousEnd = Number(await list.getAttribute("data-rendered-end"));
    await scroller.evaluate(element => {element.scrollTop = element.scrollHeight;});
    await expect.poll(async () => Number(await list.getAttribute("data-rendered-end"))).toBeGreaterThan(previousEnd);
  }
  await expect.poll(async () => Number(await list.getAttribute("data-rendered-start"))).toBeGreaterThan(0);
  const before = await scroller.evaluate(element => {
    const viewport = element.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll("#list .item"));
    const anchor = cards.find(item => item.getBoundingClientRect().bottom > viewport.top);
    const removal = cards.find(item => {
      const rect = item.getBoundingClientRect();
      return item !== anchor && rect.top > viewport.top + 120 && rect.bottom < viewport.bottom - 24;
    });
    return {
      propertyId: removal?.getAttribute("data-property-id"),
      anchorId: anchor?.getAttribute("data-property-id"),
      anchorTop: anchor?.getBoundingClientRect().top,
      scrollTop: element.scrollTop
    };
  });
  expect(before.propertyId).toBeTruthy();
  expect(before.anchorId).toBeTruthy();
  expect(before.scrollTop).toBeGreaterThan(1500);
  await confirmRemoval(page, row(page, before.propertyId).locator(".favorite-map-remove-v1"), true);
  await expectFolderMode(page, 79);
  await expect(row(page, before.propertyId)).toHaveCount(0);
  await expect.poll(async () => Number(await list.getAttribute("data-rendered-start"))).toBeGreaterThan(0);
  // Preserve the current reviewing neighborhood; never jump back to row one.
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(before.scrollTop - 150);
  expect(await scroller.evaluate(element => element.scrollTop)).toBeLessThan(before.scrollTop + 150);
  await expect.poll(() => row(page, before.anchorId).evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(before.anchorTop, 0);
  expect((await savedFolders(page)).find(folder => folder.id === otherFolderId)).toEqual({id: otherFolderId, itemKeys: [firstRef]});
});
