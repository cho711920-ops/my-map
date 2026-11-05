import {test, expect} from "@playwright/test";
import {execFileSync} from "node:child_process";

test.afterEach(async ({context}) => { await context.unrouteAll({behavior: "ignoreErrors"}); });
const propertyId = "FIXTURE-LEASE-1";
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#17665b"/></svg>';
async function fixture(page, context, {failures = 0, delay = 0, holdPhoto = ''} = {}) {
  const state = {detailCalls: 0, photoCalls: 0, photoFailures: 0, photoDelay: 0, photoIncomplete: false, imageCalls: 0, writes: 0, failures, delay, incomplete: false};
  const photoWaiters = [];
  let photoReleased = false;
  state.releasePhoto = () => {photoReleased = true; photoWaiters.splice(0).forEach(resolve => resolve());};
  const baseline = process.env.JS_MEDIA_BASELINE === "1"
    ? execFileSync("git", ["show", "HEAD:js/unified-listings-v8.js"], {encoding: "utf8"}) : null;
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (request.method() !== "GET") state.writes++;
    if (url.pathname === "/js/unified-listings-v8.js" && baseline) return route.fulfill({contentType: "text/javascript", body: baseline});
    if (url.pathname.startsWith("/test-photo-")) {
      state.imageCalls++;
      if (url.pathname === holdPhoto && !photoReleased) await new Promise(resolve => photoWaiters.push(resolve));
      return route.fulfill({contentType: "image/svg+xml", body: tile, headers: {"cache-control": "public,max-age=3600"}});
    }
    const action = url.searchParams.get("action");
    if (url.pathname === "/api/data" && action === "unifiedListingPhotos") {
      state.photoCalls++;
      if (state.photoDelay) await new Promise(resolve => setTimeout(resolve, state.photoDelay));
      if (state.photoFailures-- > 0) return route.fulfill({status: 503, json: {ok: false, message: "Fixture photo lookup failure"}});
      return route.fulfill({json: {ok: true, propertyId, originalId: url.searchParams.get("originalId"),
        images: Array.from({length: state.photoIncomplete ? 1 : 7}, (_, i) => "/test-photo-" + i + ".svg"), photoCount: 7}});
    }
    if (url.pathname === "/api/data" && ["unifiedListings", "unifiedListingDetail"].includes(action)) {
      const detail = action === "unifiedListingDetail";
      if (detail) {
        state.detailCalls++;
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
        if (state.failures-- > 0) return route.fulfill({status: 503, json: {ok: false, message: "Fixture lookup failure"}});
      }
      const response = await route.fetch({maxRetries: 1});
      const data = await response.json();
      for (const original of data.groups ? Object.values(data.groups).flat() : data.originals || []) {
        if (original.propertyId !== propertyId) continue;
        const images = Array.from({length: detail && !state.incomplete ? 7 : 1}, (_, index) => "/test-photo-" + index + ".svg");
        Object.assign(original, {images, thumbnail: images[0], photoCount: 7});
      }
      return route.fulfill({response, json: data});
    }
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  await expect.poll(() => page.evaluate(() => window.JSV6ListStore.load("favorite").length)).toBeGreaterThan(0);
  return state;
}
function counter(page) {return page.locator(".unified-detail-photo-count-v8");}
function open(page) {return page.evaluate(() => window.JSUnifiedListingsV8.open("FIXTURE-LEASE-1"));}
function next(page, direction = 1, times = 1) {
  return page.evaluate(({direction, times}) => {
    const button = document.querySelector(direction < 0 ? ".unified-detail-photo-nav-v8.prev" : ".unified-detail-photo-nav-v8.next");
    for (let i = 0; i < times; i++) button.click();
  }, {direction, times});
}

for (const direction of [1, -1]) {
  test("photos prepared independently of failed detail navigate " + (direction > 0 ? "next" : "previous") + " without duplicate requests", async ({page, context}, testInfo) => {
    const state = await fixture(page, context, {failures: 1});
    await open(page);
    await expect(counter(page)).toHaveText("1 / 7");
    expect(state.detailCalls).toBe(1);
    state.photoDelay = 200;
    await next(page, direction);
    await expect(counter(page)).toHaveText(direction > 0 ? "2 / 7" : "7 / 7");
    expect(state.detailCalls).toBe(1);
    expect(state.photoCalls).toBe(1);
    expect(state.writes).toBe(0);
    await page.screenshot({path: testInfo.outputPath("detail-retry-recovered.png")});
  });
}

test("photo-list failure can be retried in the same open detail without a request loop", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 1});
  state.photoFailures = 2;
  await open(page);
  await next(page);
  await expect(counter(page)).toHaveText("사진 목록 조회 실패 · 다음 버튼으로 재시도");
  await next(page, 1, 6);
  expect(state.photoCalls).toBe(2);
  await page.waitForTimeout(2100);
  await next(page);
  await expect(counter(page)).toHaveText("2 / 7");
  expect(state.photoCalls).toBe(3);
  expect(state.detailCalls).toBe(1);
  expect(state.writes).toBe(0);
});

test("clicks during initial lookup share the initial request and retain intended photo", async ({page, context}) => {
  const state = await fixture(page, context, {delay: 250});
  state.photoDelay = 250;
  await page.evaluate(() => {window.JSUnifiedListingsV8.open("FIXTURE-LEASE-1");});
  await next(page, 1, 3);
  await expect(counter(page)).toHaveText("2 / 7");
  expect(state.detailCalls).toBe(1);
  expect(state.writes).toBe(0);
});

test("incomplete successful retry does not leave a false loading label or retry loop", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 1});
  state.photoIncomplete = true;
  await open(page);
  await next(page);
  await expect(counter(page)).toHaveText("사진 목록 조회 실패 · 다음 버튼으로 재시도");
  await next(page, 1, 3);
  expect(state.detailCalls).toBe(1);
  expect(state.photoCalls).toBe(1);
});

test("closing a pending retry prevents its late response from reopening the detail", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 1});
  await open(page);
  state.photoDelay = 200;
  await next(page);
  await page.evaluate(() => window.JSUnifiedListingsV8.close());
  await page.waitForTimeout(300);
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "true");
  expect(state.detailCalls).toBe(1);
  expect(state.photoCalls).toBe(1);
});

test("normal photo navigation keeps one detail fetch and its existing transition budget", async ({page, context}, testInfo) => {
  const state = await fixture(page, context);
  const started = Date.now();
  await open(page);
  await expect(counter(page)).toHaveText("1 / 7");
  const openMs = Date.now() - started;
  const transitionMs = [];
  for (let index = 2; index <= 4; index++) {
    const start = Date.now();
    await next(page);
    await expect(counter(page)).toHaveText(index + " / 7");
    transitionMs.push(Date.now() - start);
    await expect(page.locator(".unified-detail-hero-v8 img")).toHaveAttribute("data-detail-source-v8144", "/test-photo-" + (index - 1) + ".svg");
  }
  expect(state.detailCalls).toBe(1);
  expect(state.writes).toBe(0);
  expect(Math.max(...transitionMs)).toBeLessThan(1000);
  console.log("MEDIA_PERFORMANCE", JSON.stringify({project: testInfo.project.name, baseline: process.env.JS_MEDIA_BASELINE === "1", openMs, transitionMs, detailCalls: state.detailCalls, imageCalls: state.imageCalls}));
});

test('photo crossfade keeps one outgoing frame and every rapid click advances exactly once', async ({page, context}) => {
  const state = await fixture(page, context);
  await open(page);
  const image = page.locator('.unified-detail-hero-v8 img');
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await next(page);
  await expect(counter(page)).toHaveText('2 / 7');
  await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(1);
  await expect.poll(() => image.evaluate(el => el.getAnimations().some(a => a.effect.getTiming().duration >= 350))).toBe(true);
  await next(page, 1, 3);
  await expect(counter(page)).toHaveText('5 / 7');
  await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(1);
  await expect(image).toHaveAttribute('data-detail-source-v8144', '/test-photo-4.svg');
  await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(0);
  await next(page, -1);
  await expect(counter(page)).toHaveText('4 / 7');
  const box = await image.boundingBox();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7 - 100, box.y + box.height / 2, {steps:5});
  await page.mouse.up();
  await expect(counter(page)).toHaveText('5 / 7');
  await expect(page.locator('#unifiedGalleryV8.open')).toHaveCount(0);
  await page.evaluate(() => JSUnifiedListingsV8.close());
  await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(0);
  await open(page);
  await expect(counter(page)).toHaveText('1 / 7');
  expect(state.detailCalls).toBe(1); expect(state.writes).toBe(0);
});

test('a slow destination retains the previous frame and cannot overwrite a newer reverse navigation', async ({page, context}) => {
  const state = await fixture(page, context, {holdPhoto:'/test-photo-1.svg'});
  try {
    await open(page);
    const image = page.locator('.unified-detail-hero-v8 img');
    await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    await next(page);
    await expect(counter(page)).toHaveText('2 / 7');
    await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(1);
    await expect(image).toHaveCSS('opacity', '0');
    await next(page, -1);
    await expect(counter(page)).toHaveText('1 / 7');
    state.releasePhoto();
    await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(0);
    await expect(image).toHaveAttribute('data-detail-source-v8144', '/test-photo-0.svg');
    await expect(image).toHaveCSS('opacity', '1');
    expect(state.detailCalls).toBe(1); expect(state.writes).toBe(0);
  } finally {state.releasePhoto();}
});

test('enlarged photo navigation shares crossfade cleanup and reduced-motion preference remains immediate', async ({page, context, isMobile}) => {
  const state = await fixture(page, context);
  await open(page);
  // The existing portrait stylesheet disables the separate enlarged modal.
  // Exercise its real controls on PC, and the shared detail on both layouts.
  if (!isMobile) {
    await page.locator('.unified-detail-hero-v8').click();
    const modal = page.locator('#unifiedGalleryV8');
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => modal.locator('img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    await modal.locator('.next').click();
    await expect(modal.locator('span:not(.photo-transition-ghost-v1)')).toHaveText('2 / 7');
    await expect(modal.locator('.photo-transition-ghost-v1')).toHaveCount(1);
    await modal.locator('.close').click();
    await expect(modal.locator('.photo-transition-ghost-v1')).toHaveCount(0);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await next(page, 1, 3);
  await expect(counter(page)).toHaveText('4 / 7');
  await expect(page.locator('.photo-transition-ghost-v1')).toHaveCount(0);
  expect(state.detailCalls).toBe(1); expect(state.writes).toBe(0);
});

test("independent photo list stays usable when a slower full-detail request subsequently fails", async ({page, context, isMobile}) => {
  const state = await fixture(page, context, {failures: 1, delay: 600});
  await page.evaluate(() => {window.JSUnifiedListingsV8.open("FIXTURE-LEASE-1");});
  await next(page);
  await expect(counter(page)).toHaveText("2 / 7");
  const before = await page.locator(".unified-detail-gallery-v8").elementHandle();
  await expect(page.locator("#unifiedDetailBodyV8")).toContainText("원본 최신 조회에 실패");
  expect(await page.locator(".unified-detail-gallery-v8").evaluate((e,old) => e === old,before)).toBe(true);
  await expect(counter(page)).toHaveText("2 / 7");
  await next(page);
  await expect(counter(page)).toHaveText("3 / 7");
  if (!isMobile) {
    await page.locator(".unified-detail-hero-v8").click();
    await expect(page.locator("#unifiedGalleryV8 > span:not(.photo-transition-ghost-v1)")).toHaveText("3 / 7");
    await page.locator("#unifiedGalleryV8 .next").click();
    await expect(page.locator("#unifiedGalleryV8 > span:not(.photo-transition-ghost-v1)")).toHaveText("4 / 7");
  }
  expect(state.photoCalls).toBe(1);expect(state.detailCalls).toBe(1);expect(state.writes).toBe(0);
});

test("a failed full detail still allows opening all recovered photos directly from the hero", async ({page, context, isMobile}) => {
  test.skip(isMobile,"Portrait uses inline photos");
  const state = await fixture(page, context, {failures: 1});
  await open(page);
  await page.locator(".unified-detail-hero-v8").click();
  await expect(page.locator("#unifiedGalleryV8 > span:not(.photo-transition-ghost-v1)")).toHaveText("1 / 7");
  await page.locator("#unifiedGalleryV8 .next").click();
  await expect(page.locator("#unifiedGalleryV8 > span:not(.photo-transition-ghost-v1)")).toHaveText("2 / 7");
  expect(state.photoCalls).toBe(1);expect(state.writes).toBe(0);
});

test("a response for the wrong advert never replaces the selected photo list", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 1});
  await context.route(url => url.pathname === "/api/data" && url.searchParams.get("action") === "unifiedListingPhotos",route=>route.fulfill({json:{ok:true,propertyId,originalId:'wrong-ad',images:['/test-photo-4.svg','/test-photo-5.svg']}}));
  await open(page);await next(page);
  await expect(counter(page)).toHaveText("사진 목록 조회 실패 · 다음 버튼으로 재시도");
  await expect(page.locator('.unified-detail-hero-v8 img')).toHaveAttribute('data-detail-source-v8144','/test-photo-0.svg');
  expect(state.writes).toBe(0);
});

test("a late thumbnail-only full response cannot erase a separately recovered complete gallery", async ({page, context}) => {
  const state = await fixture(page, context, {delay: 600});state.incomplete = true;
  await page.evaluate(() => {JSUnifiedListingsV8.open("FIXTURE-LEASE-1");});
  await next(page);await expect(counter(page)).toHaveText("2 / 7");
  await page.waitForTimeout(750);await expect(counter(page)).toHaveText("2 / 7");
  await next(page);await expect(counter(page)).toHaveText("3 / 7");
  expect(state.photoCalls).toBe(1);expect(state.writes).toBe(0);
});
