import {test, expect} from "@playwright/test";
import {execFileSync} from "node:child_process";

const propertyId = "FIXTURE-LEASE-1";
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#17665b"/></svg>';
async function fixture(page, context, {failures = 0, delay = 0} = {}) {
  const state = {detailCalls: 0, imageCalls: 0, writes: 0, failures, delay, incomplete: false};
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
      return route.fulfill({contentType: "image/svg+xml", body: tile, headers: {"cache-control": "public,max-age=3600"}});
    }
    const action = url.searchParams.get("action");
    if (url.pathname === "/api/data" && ["unifiedListings", "unifiedListingDetail"].includes(action)) {
      const detail = action === "unifiedListingDetail";
      if (detail) {
        state.detailCalls++;
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
        if (state.failures-- > 0) return route.fulfill({status: 503, json: {ok: false, message: "Fixture lookup failure"}});
      }
      const response = await route.fetch();
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
  test("failed detail lookup recovers once on " + (direction > 0 ? "next" : "previous") + " without duplicate requests", async ({page, context}, testInfo) => {
    const state = await fixture(page, context, {failures: 1});
    await open(page);
    await expect(counter(page)).toHaveText("추가 사진 조회 실패 · 다음 버튼으로 재시도");
    expect(state.detailCalls).toBe(1);
    state.delay = 200;
    await next(page, direction, 3);
    await expect(counter(page)).toHaveText("다음 사진 불러오는 중…");
    await expect(counter(page)).toHaveText(direction > 0 ? "2 / 7" : "7 / 7");
    expect(state.detailCalls).toBe(2);
    expect(state.writes).toBe(0);
    await page.screenshot({path: testInfo.outputPath("detail-retry-recovered.png")});
  });
}

test("failed retry stops loading, repeated clicks are bounded, and reopening allows recovery", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 2});
  await open(page);
  await next(page);
  await expect(counter(page)).toHaveText("사진 조회 실패 · 상세를 다시 열어 주세요");
  await next(page, 1, 6);
  expect(state.detailCalls).toBe(2);
  await page.evaluate(() => window.JSUnifiedListingsV8.close());
  await open(page);
  await expect(counter(page)).toHaveText("1 / 7");
  expect(state.detailCalls).toBe(3);
  expect(state.writes).toBe(0);
});

test("clicks during initial lookup share the initial request and retain intended photo", async ({page, context}) => {
  const state = await fixture(page, context, {delay: 250});
  await page.evaluate(() => {window.JSUnifiedListingsV8.open("FIXTURE-LEASE-1");});
  await next(page, 1, 3);
  await expect(counter(page)).toHaveText("2 / 7");
  expect(state.detailCalls).toBe(1);
  expect(state.writes).toBe(0);
});

test("incomplete successful retry does not leave a false loading label or retry loop", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 1});
  await open(page);
  state.incomplete = true;
  await next(page);
  await expect(counter(page)).toHaveText("사진 조회 실패 · 상세를 다시 열어 주세요");
  await next(page, 1, 3);
  expect(state.detailCalls).toBe(2);
});

test("closing a pending retry prevents its late response from reopening the detail", async ({page, context}) => {
  const state = await fixture(page, context, {failures: 1});
  await open(page);
  state.delay = 200;
  await next(page);
  await page.evaluate(() => window.JSUnifiedListingsV8.close());
  await page.waitForTimeout(300);
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden", "true");
  expect(state.detailCalls).toBe(2);
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
