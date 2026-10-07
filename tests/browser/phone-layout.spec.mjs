import {test, expect} from "@playwright/test";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {writeFile} from "node:fs/promises";

// Dedicated contexts make the classification tests independent of the runner's
// viewport. Every request is restricted to the synthetic loopback fixtures.
const phoneUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const ipadUA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ipadDesktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const tabletUA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const baselineRoot = process.env.JS_PHONE_BASELINE_ROOT;
let baselineServer;
let baselineURL;

test.beforeEach(async ({browserName}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The dedicated device matrix runs once, from the desktop project.");
});
test.beforeAll(async ({browserName}, testInfo) => {
  if (!baselineRoot || testInfo.project.name !== "desktop") return;
  const module = await import(pathToFileURL(resolve(baselineRoot, "tests/browser/fixture-server.mjs")).href);
  baselineServer = module.createFixtureServer();
  await new Promise((accept, reject) => {
    baselineServer.once("error", reject);
    baselineServer.listen(Number(process.env.JS_PHONE_BASELINE_PORT || 4183), "127.0.0.1", accept);
  });
  baselineURL = "http://127.0.0.1:" + baselineServer.address().port;
});
test.afterAll(async () => {
  if (baselineServer) await new Promise((accept, reject) => baselineServer.close((error) => error ? reject(error) : accept()));
});

async function contextFor(browser, options) {
  const context = await browser.newContext({serviceWorkers: "block", ...options});
  // Chromium's hasTouch flag exposes one touch point and keeps the host OS
  // platform. A desktop-UA iPad actually reports MacIntel + multiple touches.
  if (options.userAgent === ipadDesktopUA) await context.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {configurable: true, get: () => "MacIntel"});
    Object.defineProperty(navigator, "maxTouchPoints", {configurable: true, get: () => 5});
  });
  await context.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  return context;
}
async function ready(page, url) {
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  // Test controls are not product UI, so keep them out of geometry/screenshots.
  await page.locator("#fixtureControls").evaluate((element) => {element.hidden = true; element.style.display = "none";});
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#sidebar").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
}
function phoneOptions(width = 390) {
  return {viewport: {width, height: 844}, screen: {width, height: 844}, userAgent: phoneUA, isMobile: true, hasTouch: true};
}
async function noHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth}));
  expect(sizes.document).toBeLessThanOrEqual(sizes.width + 1);
  expect(sizes.body).toBeLessThanOrEqual(sizes.width + 1);
}

async function fixturePhotos(context, baseURL) {
  await context.route("**/api/data?*", async route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (!["unifiedListingDetail", "unifiedListings"].includes(action)) return route.fallback();
    const response = await route.fetch();
    const payload = await response.json();
    const rows = action === "unifiedListingDetail" ? payload.originals : Object.values(payload.groups).flat();
    rows.forEach(original => {original.images = [baseURL + "/icons/js-192.png", baseURL + "/icons/js-180.png"]; original.photoCount = 2;});
    await route.fulfill({response, json: payload});
  });
}

async function expectLandscapeSearch(page, width, height) {
  await expect(page.locator("html")).not.toHaveClass(/js-mobile-app-v1|js-phone-app-v2/);
  const search = page.locator("#keyword");
  await expect(search).toBeVisible();
  await expect.poll(async () => (await search.boundingBox())?.width || 0).toBeGreaterThanOrEqual(130);
  const box = await search.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(130);
  expect(box.height).toBeGreaterThanOrEqual(30);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
}

async function captureRotatedViewport(session, testInfo, name, dimensions) {
  // Playwright's stored viewport stays portrait after a raw CDP rotation. Do
  // not let its ordinary screenshot clip/capture alter that emulated viewport.
  const result = await session.send("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
  const body = Buffer.from(result.data, "base64");
  expect(body.readUInt32BE(16)).toBe(dimensions.width);
  expect(body.readUInt32BE(20)).toBe(dimensions.height);
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, {path, contentType: "image/png"});
}

const portraitDevices = [
  ...[360, 390, 430].map(width => ({name: "phone " + width, phone: true, options: phoneOptions(width)})),
  {name: "Android tablet split 600", phone: false, options: {viewport: {width: 600, height: 900}, screen: {width: 820, height: 1280}, userAgent: tabletUA, isMobile: true, hasTouch: true}},
  {name: "iPad 768", phone: false, options: {viewport: {width: 768, height: 1024}, screen: {width: 768, height: 1024}, userAgent: ipadUA, isMobile: true, hasTouch: true}},
  {name: "iPad desktop UA 820", phone: false, options: {viewport: {width: 820, height: 1180}, screen: {width: 820, height: 1180}, userAgent: ipadDesktopUA, isMobile: true, hasTouch: true}},
  {name: "tablet 1024", phone: false, options: {viewport: {width: 1024, height: 1366}, screen: {width: 1024, height: 1366}, userAgent: tabletUA, isMobile: true, hasTouch: true}}
];

for (const device of portraitDevices) {
  test(`${device.name} portrait: three useful tabs, usable search and no horizontal overflow`, async ({browser, baseURL}, testInfo) => {
    const width = device.options.viewport.width;
    const context = await contextFor(browser, device.options);
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await ready(page, baseURL);
      await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
      expect(await page.evaluate(() => ({phone: JSPhoneDeviceV1.isPhone(), handheld: JSPhoneDeviceV1.isHandheld(), mobile: JSPhoneDeviceV1.isMobileLayout()})))
        .toEqual({phone: device.phone, handheld: true, mobile: true});
      await expect(page.locator(".jsm-bottom-nav-v1 button:visible")).toHaveText(["지도", "매물", "찜"]);
      for (const value of ["visit", "customers", "more"]) await expect(page.locator(`[data-mobile-view="${value}"]`)).toBeHidden();
      await expect(page.locator(".jsm-quick-add-v1")).toBeHidden();
      await expect(page.locator(".desktop-operations-action")).toBeHidden();
      await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
      const search = page.locator("#jsMobileKeywordV1");
      await expect(search).toBeVisible();
      const box = await search.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(130);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await noHorizontalOverflow(page);
      await page.screenshot({path: testInfo.outputPath(`phone-${width}-map.png`)});
      await search.fill("괴정");
      await search.press("Enter");
      await page.locator('[data-mobile-view="list"]').click();
      await expect(page.locator("#list .item")).toHaveCount(1);
      await expect(page.locator("#jsMobileKeywordV1")).toHaveValue("괴정");
      await expect(page.locator("#listToolbar .list-source-control")).toBeHidden();
      await expect(page.locator("#sortDropdownBtn")).toBeVisible();
      await page.locator("#sidebar").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      const headerBox = await page.locator(".jsm-app-header-v1").boundingBox();
      const sidebarBox = await page.locator("#sidebar").boundingBox();
      const navBox = await page.locator(".jsm-bottom-nav-v1").boundingBox();
      expect(Math.abs(sidebarBox.y - (headerBox.y + headerBox.height))).toBeLessThanOrEqual(1);
      expect(Math.abs(sidebarBox.y + sidebarBox.height - navBox.y)).toBeLessThanOrEqual(1);
      expect(sidebarBox.width).toBe(width);
      await noHorizontalOverflow(page);
      await page.screenshot({path: testInfo.outputPath(`phone-${width}-list.png`)});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
}

const rotationDevices = [
  {name: "phone 844", portrait: {width: 390, height: 844}, landscape: {width: 844, height: 390}, userAgent: phoneUA},
  {name: "phone 740", portrait: {width: 360, height: 740}, landscape: {width: 740, height: 360}, userAgent: phoneUA},
  {name: "tablet 1280", portrait: {width: 820, height: 1280}, landscape: {width: 1280, height: 820}, userAgent: tabletUA}
];
for (const device of rotationDevices) test(`${device.name}: actual rotation uses PC landscape and preserves search, selection and detail`, async ({browser, baseURL}, testInfo) => {
  const context = await contextFor(browser, {viewport: device.portrait, screen: device.portrait, userAgent: device.userAgent, isMobile: true, hasTouch: true});
  try {
    await fixturePhotos(context, baseURL);
    const page = await context.newPage();
    const writes = [];
    page.on("request", request => {if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") writes.push(request.method());});
    await ready(page, baseURL);
    const search = page.locator("#jsMobileKeywordV1");
    await search.fill("괴정");
    await search.press("Enter");
    await page.locator('[data-mobile-view="list"]').click();
    await page.locator("#list .item .item-building-name").first().click();
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
    const selected = await page.evaluate(() => window.selectedItemKey);
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {...device.landscape, screenWidth: device.landscape.width, screenHeight: device.landscape.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "landscapePrimary", angle: 90}});
    await expect(page.locator("html")).toHaveClass(/js-handheld-landscape-v1/);
    await expect(page.locator("html")).not.toHaveClass(/js-phone-app-v2|js-mobile-app-v1/);
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
    await expect(page.locator("#unifiedDetailDrawerV8")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("#keyword")).toHaveValue("괴정");
    await expectLandscapeSearch(page, device.landscape.width, device.landscape.height);
    const map = await page.locator("#map").boundingBox(), sidebar = await page.locator("#sidebar").boundingBox();
    expect(map.width).toBeGreaterThan(100);
    expect(sidebar.width).toBeGreaterThan(200);
    expect(map.x + map.width).toBeLessThanOrEqual(sidebar.x + 1);
    expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(device.landscape.width + 1);
    await noHorizontalOverflow(page);
    await page.locator(".unified-detail-hero-v8").click();
    await expect(page.locator("#unifiedGalleryV8")).toHaveClass(/open/);
    await expect(page.locator("#unifiedGalleryV8")).toBeVisible();
    await page.getByRole("button", {name: "사진 크게 보기 닫기", exact: true}).click();
    await expect(page.locator("#unifiedGalleryV8")).not.toHaveClass(/open/);
    await expect(page.locator("html")).toHaveClass(/js-handheld-landscape-v1/);
    const thumbnail = page.locator("#list .unified-thumb-v8").first();
    const thumbnailImage = thumbnail.locator("img");
    await expect(thumbnailImage).toBeVisible();
    await expect.poll(() => thumbnailImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const thumbnailBox = await thumbnail.boundingBox(), imageBox = await thumbnailImage.boundingBox();
    // The <=768px desktop card rules do not apply to a narrow landscape
    // phone. A real image must stay inside its restored 70px thumbnail.
    expect(imageBox.width).toBeLessThanOrEqual(thumbnailBox.width + 1);
    expect(imageBox.height).toBeLessThanOrEqual(thumbnailBox.height + 1);
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(thumbnailBox.x + thumbnailBox.width + 1);
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(thumbnailBox.y + thumbnailBox.height + 1);
    await captureRotatedViewport(session, testInfo, "landscape-detail.png", device.landscape);
    expect(await page.evaluate(() => window.selectedItemKey)).toBe(selected);
    await session.send("Emulation.setDeviceMetricsOverride", {...device.portrait, screenWidth: device.portrait.width, screenHeight: device.portrait.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "portraitPrimary", angle: 0}});
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
    await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
    await expect(page.locator("html")).not.toHaveClass(/js-handheld-landscape-v1/);
    await expect(page.locator("#unifiedDetailDrawerV8")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
    await expect(search).toHaveValue("괴정");
    await expect(page.locator("html")).toHaveAttribute("data-jsm-mobile-view", "list");
    expect(await page.evaluate(() => window.selectedItemKey)).toBe(selected);
    expect(writes).toEqual([]);
  } finally {await context.close();}
});

for (const device of rotationDevices) test(`${device.name}: landscape search and filter can be clicked without clipping`, async ({browser, baseURL}, testInfo) => {
  const context = await contextFor(browser, {viewport: device.portrait, screen: device.portrait, userAgent: device.userAgent, isMobile: true, hasTouch: true});
  try {
    const page = await context.newPage();
    await ready(page, baseURL);
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {...device.landscape, screenWidth: device.landscape.width, screenHeight: device.landscape.height,
      mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "landscapePrimary", angle: 90}});
    await expect(page.locator("html")).toHaveClass(/js-handheld-landscape-v1/);
    await expectLandscapeSearch(page, device.landscape.width, device.landscape.height);
    if (device.landscape.width < 900) {
      // This layout fixture omits map-quick-tools, so expose the real menu DOM
      // solely to verify CSS containment/hit testing, not controller behaviour.
      const popover = page.locator("#mapQuickPopoverView");
      await expect(popover).toBeHidden();
      await popover.evaluate(element => {element.hidden = false;});
      await expect(popover).toBeVisible();
      await expect(popover).toHaveCSS("position", "fixed");
      const bounds = await popover.boundingBox(), mapBounds = await page.locator("#map").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x);
      expect(bounds.y).toBeGreaterThanOrEqual(mapBounds.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(device.landscape.height);
      const button = popover.locator("button").first();
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(40);
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await captureRotatedViewport(session, testInfo, "landscape-view-popover.png", device.landscape);
      await popover.evaluate(element => {element.hidden = true;});
      await expect(popover).toBeHidden();
    }
    await page.locator("#keyword").fill("괴정");
    await page.locator("#keyword").press("Enter");
    await expect(page.locator("#list .item")).toHaveCount(1);
    await page.locator("#detailBtn").click();
    await expect(page.locator("#v6DetailSheetPortal")).toHaveClass(/open/);
    await expect(page.locator("html")).toHaveAttribute("data-v6-detail-mode", "tablet");
    await expect(page.locator("#v6DetailSheet_minRent")).toBeVisible();
    await page.locator("#v6DetailSheet_minRent").click();
    await page.locator(".v6-detail-sheet-close").click();
    await expect(page.locator("#v6DetailSheetPortal")).not.toHaveClass(/open/);
    await page.locator("#list .item-building-name").first().click();
    await expect(page.locator("#unifiedDetailDrawerV8")).toBeVisible();
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
    await page.getByRole("button", {name: "상세매물보기 닫기", exact: true}).click();
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "true");
  } finally {await context.close();}
});

for (const device of rotationDevices.filter(device => device.name !== "phone 740")) {
  test(`${device.name}: favorite folder and original-link return survive an actual orientation round trip`, async ({browser, baseURL}) => {
    const context = await contextFor(browser, {viewport: device.portrait, screen: device.portrait, userAgent: device.userAgent, isMobile: true, hasTouch: true});
    try {
      const page = await context.newPage();
      const writes = [];
      page.on("request", request => {if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") writes.push(request.method());});
      await ready(page, baseURL);
      await page.locator('[data-mobile-view="favorites"]').click();
      await page.locator(".phone-favorite-folder-card-v2").filter({hasText: "테스트 찜폴더"}).click();
      await expect(page.locator("#phoneFavoriteFolderScreenV2")).toBeVisible();
      const saved = await page.evaluate(() => JSV6ListStore.load("favorite"));
      await page.locator(".phone-favorite-item-open-v2").first().click();
      await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setDeviceMetricsOverride", {...device.landscape, screenWidth: device.landscape.width, screenHeight: device.landscape.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "landscapePrimary", angle: 90}});
      await expect(page.locator("html")).toHaveClass(/js-handheld-landscape-v1/);
      await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
      const popupPromise = context.waitForEvent("page");
      await page.getByRole("button", {name: "선택한 원본 링크 열기", exact: true}).click();
      const popup = await popupPromise;
      await expect(popup).toHaveTitle("가상 원본 매물");
      await popup.close();
      await page.bringToFront();
      await expect(page).toHaveURL(baseURL + "/");
      await session.send("Emulation.setDeviceMetricsOverride", {...device.portrait, screenWidth: device.portrait.width, screenHeight: device.portrait.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "portraitPrimary", angle: 0}});
      await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
      await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
      await page.locator("#unifiedDetailDrawerV8 > header button").click();
      await expect(page.locator("#phoneFavoriteFolderScreenV2")).toBeVisible();
      await expect(page.locator("#phoneFavoriteFolderScreenV2")).toContainText("테스트 찜폴더");
      expect(await page.evaluate(() => JSPhoneFavoritesV2.getState().folderId)).toBe("fixture-favorites");
      expect(await page.evaluate(() => JSV6ListStore.load("favorite"))).toEqual(saved);
      expect(writes).toEqual([]);
    } finally {await context.close();}
  });
}

for (const device of [portraitDevices[1], portraitDevices[5]]) test(`${device.name}: portrait keyboard viewport shrink keeps the handheld layout without a rotation guard`, async ({browser, baseURL}) => {
  const context = await contextFor(browser, device.options);
  try {
    const page = await context.newPage();
    await ready(page, baseURL);
    await page.locator("#jsMobileKeywordV1").fill("탄방");
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {width: device.options.viewport.width, height: 280, screenWidth: device.options.screen.width, screenHeight: device.options.screen.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "portraitPrimary", angle: 0}});
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
    await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
    await expect(page.locator("html")).not.toHaveClass(/js-handheld-landscape-v1/);
    expect(await page.evaluate(() => JSPhoneDeviceV1.isMobileLayout())).toBe(true);
    await expect(page.locator("#jsMobileKeywordV1")).toHaveValue("탄방");
    await expect(page.locator("#jsMobileKeywordV1")).toBeVisible();
    await noHorizontalOverflow(page);
  } finally {await context.close();}
});

const unchangedDevices = [
  ["tablet landscape 1280", {viewport: {width: 1280, height: 800}, screen: {width: 1280, height: 800}, userAgent: tabletUA, isMobile: true, hasTouch: true}],
  ["desktop narrowed 390", {viewport: {width: 390, height: 844}, screen: {width: 1920, height: 1080}, userAgent: desktopUA, isMobile: false, hasTouch: false}],
  ["desktop 1280", {viewport: {width: 1280, height: 800}, screen: {width: 1920, height: 1080}, userAgent: desktopUA, isMobile: false, hasTouch: false}],
  ["desktop 1920", {viewport: {width: 1920, height: 1080}, screen: {width: 1920, height: 1080}, userAgent: desktopUA, isMobile: false, hasTouch: false}]
];
const geometrySelectors = ["#sidebar", "#map", ".jsm-app-header-v1", ".jsm-bottom-nav-v1", "#keyword", "#jsMobileKeywordV1", "#detailBtn", "#topResetBtn", ".desktop-tell-v8", ".desktop-operations-action", ".quick-add-btn", "#topLogoutBtnV1", "#listToolbar", "#sourceFilter", "#typeFilter", "#brokerageFeeFilter", "#sortDropdownBtn", "#list .item", ".v6-detail-sheet"];
async function geometry(page) {
  return page.evaluate((selectors) => {
    const output = {};
    selectors.forEach((selector) => {
      const element = document.querySelector(selector);
      if (!element) {output[selector] = null; return;}
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible = !!(rect.width && rect.height && style.visibility !== "hidden" && style.display !== "none");
      output[selector] = visible
        ? {visible, display: style.display, fontSize: style.fontSize, box: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10)}
        : {visible: false};
    });
    output.visibleNavigation = Array.from(document.querySelectorAll(".jsm-bottom-nav-v1 button")).filter((element) => element.getBoundingClientRect().width).map((element) => element.textContent.trim());
    return output;
  }, geometrySelectors);
}

for (const [name, options] of unchangedDevices) {
  test(`${name}: no phone opt-in and legacy controls remain available`, async ({browser, baseURL}) => {
    const context = await contextFor(browser, options);
    try {
      const page = await context.newPage();
      await ready(page, baseURL);
      await expect(page.locator("html")).not.toHaveClass(/js-phone-app-v2/);
      await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
      if (options.viewport.width <= 768) {
        await expect(page.locator(".jsm-bottom-nav-v1 button:visible")).toHaveText(["지도", "매물", "임장", "고객", "더보기"]);
        await expect(page.locator(".jsm-quick-add-v1")).toBeVisible();
      } else {
        await expect(page.locator(".desktop-operations-action")).toBeVisible();
        await expect(page.locator(".quick-add-btn")).toBeVisible();
        await expect(page.locator("#topLogoutBtnV1")).toBeVisible();
      }
    } finally {await context.close();}
  });

  test(`${name}: exact geometry and visible controls match the pre-phone backup`, async ({browser, baseURL}, testInfo) => {
    test.skip(!baselineURL, "Set JS_PHONE_BASELINE_ROOT to the extracted backup to run exact baseline comparisons.");
    const context = await contextFor(browser, options);
    const originalContext = await contextFor(browser, options);
    try {
      const page = await context.newPage();
      const original = await originalContext.newPage();
      await ready(page, baseURL);
      await ready(original, baselineURL);
      expect(await geometry(page)).toEqual(await geometry(original));
      if (options.viewport.width <= 768) {
        await page.locator('[data-mobile-view="list"]').click();
        await original.locator('[data-mobile-view="list"]').click();
      }
      await expect(page.locator("#list .item")).toHaveCount(2);
      await expect(original.locator("#list .item")).toHaveCount(2);
      // Existing sidebar transitions must finish before recording exact geometry.
      await page.locator("#sidebar").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      await original.locator("#sidebar").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      expect(await geometry(page)).toEqual(await geometry(original));
      await page.screenshot({path: testInfo.outputPath("current.png")});
      await original.screenshot({path: testInfo.outputPath("backup.png")});
      const trigger = options.viewport.width <= 768 ? '#jsMobileSearchFormV1 [data-mobile-action="filter"]' : "#detailBtn";
      await page.locator(trigger).click();
      await original.locator(trigger).click();
      expect(await geometry(page)).toEqual(await geometry(original));
    } finally {await context.close(); await originalContext.close();}
  });
}
