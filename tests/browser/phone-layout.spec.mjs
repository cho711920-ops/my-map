import {test, expect} from "@playwright/test";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

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

for (const width of [360, 390, 430]) {
  test(`phone portrait ${width}: three useful tabs, usable search and no horizontal overflow`, async ({browser, baseURL}, testInfo) => {
    const context = await contextFor(browser, phoneOptions(width));
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await ready(page, baseURL);
      await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
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
      await noHorizontalOverflow(page);
      await page.screenshot({path: testInfo.outputPath(`phone-${width}-list.png`)});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
}

test("actual screen orientation shows the portrait guard and retains search, detail and mobile state on return", async ({browser, baseURL}) => {
  const context = await contextFor(browser, phoneOptions());
  try {
    const page = await context.newPage();
    await ready(page, baseURL);
    const search = page.locator("#jsMobileKeywordV1");
    await search.fill("괴정");
    await search.press("Enter");
    await page.locator('[data-mobile-view="list"]').click();
    await page.locator("#list .item .item-building-name").first().click();
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {width: 844, height: 390, screenWidth: 844, screenHeight: 390, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "landscapePrimary", angle: 90}});
    await expect(page.locator("html")).toHaveAttribute("data-js-phone-landscape", "true");
    await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
    await expect(page.locator("html")).toHaveClass(/js-mobile-app-v1/);
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeVisible();
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeFocused();
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("inert", "");
    await session.send("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, screenWidth: 390, screenHeight: 844, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "portraitPrimary", angle: 0}});
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-js-phone-landscape", "true");
    await expect(page.locator("#unifiedDetailDrawerV8")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "false");
    await expect(search).toHaveValue("괴정");
    await expect(page.locator("html")).toHaveAttribute("data-jsm-mobile-view", "list");
  } finally {await context.close();}
});

test("portrait keyboard viewport shrink never triggers the rotation guard", async ({browser, baseURL}) => {
  const context = await contextFor(browser, phoneOptions());
  try {
    const page = await context.newPage();
    await ready(page, baseURL);
    await page.locator("#jsMobileKeywordV1").fill("탄방");
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {width: 390, height: 280, screenWidth: 390, screenHeight: 844, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "portraitPrimary", angle: 0}});
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-js-phone-landscape", "true");
    await expect(page.locator("#jsMobileKeywordV1")).toHaveValue("탄방");
    await expect(page.locator("#jsMobileKeywordV1")).toBeVisible();
    await noHorizontalOverflow(page);
  } finally {await context.close();}
});

const unchangedDevices = [
  ["iPad 768", {viewport: {width: 768, height: 1024}, screen: {width: 768, height: 1024}, userAgent: ipadUA, isMobile: true, hasTouch: true}],
  ["iPad 820", {viewport: {width: 820, height: 1180}, screen: {width: 820, height: 1180}, userAgent: ipadDesktopUA, isMobile: true, hasTouch: true}],
  ["Android tablet split 600", {viewport: {width: 600, height: 900}, screen: {width: 820, height: 1280}, userAgent: tabletUA, isMobile: true, hasTouch: true}],
  ["desktop narrowed 390", {viewport: {width: 390, height: 844}, screen: {width: 1920, height: 1080}, userAgent: desktopUA, isMobile: false, hasTouch: false}],
  ["desktop 1280", {viewport: {width: 1280, height: 800}, screen: {width: 1920, height: 1080}, userAgent: desktopUA, isMobile: false, hasTouch: false}]
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
      output[selector] = {visible, display: style.display, fontSize: style.fontSize, box: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10)};
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
