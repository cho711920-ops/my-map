import {test, expect} from "@playwright/test";

test.beforeEach(async ({page, context, isMobile}) => {
  test.skip(!isMobile, "Dedicated phone flows; legacy matrix is tested separately");
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
});

async function favoritesFolder(page) {
  await page.locator('[data-mobile-view="favorites"]').click();
  await page.locator(".phone-favorite-folder-card-v2").first().click();
  await expect(page.locator("#phoneFavoriteFolderScreenV2")).toBeVisible();
}

test("folder/detail/browser back retains folder and then returns through folder index", async ({page}) => {
  await favoritesFolder(page);
  await page.locator(".phone-favorite-item-open-v2").first().click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#unifiedFavoriteModalV7")).toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => history.state.jsmMobileLayerToken)).toBeTruthy();
  await page.goBack();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#phoneFavoriteFolderScreenV2")).toBeVisible();
  await expect(page.locator("#phoneFavoriteFolderScreenV2")).toContainText("테스트 찜폴더");
  await page.goBack();
  await expect(page.locator("#phoneFavoriteIndexV2")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#unifiedFavoriteModalV7")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-mobile-view="map"]')).toHaveAttribute("aria-current", "page");
});

test("filter toolbar choices are staged, can cancel, and zero monthly maximum is preserved", async ({page}) => {
  const trigger = page.locator('#jsMobileSearchFormV1 [data-mobile-action="filter"]');
  await trigger.click();
  await page.locator(".js-phone-filter-advanced summary").click();
  await page.locator("#v6DetailSheet_sourceFilter").selectOption("naver");
  await expect(page.locator("#sourceFilter")).toHaveValue("");
  await page.locator(".v6-detail-sheet-close").click();
  await expect(page.locator("#sourceFilter")).toHaveValue("");
  await trigger.click();
  await page.locator("#v6DetailSheet_maxRent").fill("0");
  await page.locator(".js-phone-filter-apply").click();
  await expect(page.locator("#maxRent")).toHaveValue("0");
  await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#jsPhoneListCountV2")).toHaveText("매물 0개");
  await expect(page.locator("#list")).toContainText("검색 결과가 없습니다");
  await page.locator("#jsPhoneFilterChipsV2 button").filter({hasText:"월세"}).click();
  await expect(page.locator("#jsPhoneListCountV2")).toHaveText("매물 2개");
});

test("search from favorites opens the matching list and dismisses keyboard focus", async ({page}) => {
  await favoritesFolder(page);
  await page.locator("#jsMobileKeywordV1").fill("탄방");
  await page.locator("#jsMobileKeywordV1").press("Enter");
  await expect(page.locator("#unifiedFavoriteModalV7")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("html")).toHaveAttribute("data-jsm-mobile-view", "list");
  await expect(page.locator("#list .item")).toHaveCount(1);
  await expect(page.locator("#list")).toContainText("탄방");
  await expect(page.locator("#jsMobileKeywordV1")).not.toBeFocused();
});

test("phone list scroll survives shared refresh and returning from detail", async ({page}) => {
  await page.evaluate(() => {
    const original=window.allItems[0];
    window.allItems=Array.from({length:80},(_,index)=>({...original,key:"phone-scroll-"+index,propertyId:"PHONE-SCROLL-"+index,name:"목록 확인 "+index}));
    window.applyFilter();
  });
  await page.locator('[data-mobile-view="list"]').click();
  const list=page.locator("#list");
  await list.evaluate(el=>{el.scrollTop=540;});
  const before=await list.evaluate(el=>el.scrollTop);
  expect(before).toBeGreaterThan(400);
  await page.evaluate(()=>window.applyFilter());
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBe(before);
  await page.locator('#list .item').filter({hasText:"목록 확인 4"}).first().locator('.item-building-name').click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden","false");
  const afterClick=await list.evaluate(el=>el.scrollTop);
  await page.locator("#unifiedDetailDrawerV8 > header button").click();
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBe(afterClick);
});

test("phone details expose actual contact picker and no registration or merge actions", async ({page}) => {
  await page.locator('[data-mobile-view="list"]').click();
  await page.locator("#list .item-building-name").first().click();
  await expect(page.locator(".phone-detail-actions-v2")).toBeVisible();
  await expect(page.locator(".unified-detail-actions-v8")).toHaveCount(0);
  await page.locator(".phone-detail-contact-v2").click();
  await expect(page.locator("#listContactModalV654")).toHaveClass(/open/);
  await expect(page.locator("#listContactModalV654")).toContainText(/연락처/);
});

test("detail favorite action opens a reachable folder picker", async ({page}) => {
  await page.locator('[data-mobile-view="list"]').click();
  await page.locator("#list .item-building-name").first().click();
  await page.locator(".phone-detail-actions-v2").getByRole("button", {name:"찜하기",exact:true}).click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden","true");
  const folder=page.locator(".phone-favorite-folder-card-v2").first();
  await folder.click();
  await expect(page.locator(".phone-favorite-add-v2")).toBeVisible();
  await page.locator(".phone-favorite-add-v2").click();
  await expect(page.locator(".phone-favorite-item-open-v2")).toHaveCount(1);
});

test("a tab tap before debounce preserves the newest query", async ({page}) => {
  // Synchronous DOM events intentionally leave no 180ms debounce window.
  await page.evaluate(()=>{
    const input=document.getElementById("jsMobileKeywordV1");
    input.value="탄방";
    input.dispatchEvent(new Event("input",{bubbles:true}));
    document.querySelector('[data-mobile-view="map"]').click();
  });
  await expect(page.locator("#jsMobileKeywordV1")).toHaveValue("탄방");
  await expect(page.locator("#keyword")).toHaveValue("탄방");
  await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator("#list .item")).toHaveCount(1);
});

test("first landscape login does not restore the pre-auth inert lock on portrait return", async ({page, context}) => {
  await page.route("http://127.0.0.1:*/", async route => {
    const response=await route.fetch();
    const html=(await response.text()).replace('<html lang="ko">','<html lang="ko" class="auth-pending">').replace('id="wrap"','id="wrap" inert');
    await route.fulfill({response,body:html});
  });
  const session=await context.newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride",{width:844,height:390,screenWidth:844,screenHeight:390,mobile:true,deviceScaleFactor:1,screenOrientation:{type:"landscapePrimary",angle:90}});
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
  await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
  await page.evaluate(()=>{
    document.getElementById("wrap").inert=false;
    document.documentElement.classList.remove("auth-pending");
  });
  await expect(page.locator("#jsPhonePortraitGuardV2")).toBeVisible();
  await session.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,screenWidth:390,screenHeight:844,mobile:true,deviceScaleFactor:1,screenOrientation:{type:"portraitPrimary",angle:0}});
  await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
  await expect(page.locator("#wrap")).not.toHaveAttribute("inert","");
  await page.locator('[data-mobile-view="list"]').click();
  await page.locator("#list .item-building-name").first().click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden","false");
});
