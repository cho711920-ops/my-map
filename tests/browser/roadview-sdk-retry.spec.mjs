import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

async function install(context, mode) {
  const state = {mode, config: 0, sdk: 0, writes: 0};
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "oapi.map.naver.com") {
      state.sdk++;
      if (state.mode === "error") return route.fulfill({status: 503, contentType: "text/javascript", body: ""});
      return route.fulfill({contentType: "text/javascript", body: state.mode === "timeout" ? "/* missing Panorama fixture */" :
        "window.naver={maps:{Panorama:function(){}}};window.__jsNaverMapsReadyV653();"});
    }
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (request.method() !== "GET") state.writes++;
    if (url.pathname === "/api/naver-maps-config") {
      state.config++;
      return route.fulfill({json: {ncpKeyId: "fixture-valid-key"}});
    }
    if (url.pathname === "/") {
      const response = await route.fetch();
      const headers = {...response.headers()};
      headers["content-security-policy"] = headers["content-security-policy"].replace("script-src 'self'", "script-src https://oapi.map.naver.com 'self'");
      return route.fulfill({response, headers});
    }
    return route.continue();
  });
  return state;
}

for (const mode of ["error", "timeout"]) {
  test("roadview " + mode + " removes failed SDK and shares one successful retry", async ({page, context}) => {
    const state = await install(context, mode);
    if (mode === "timeout") await page.clock.install();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
    await expect.poll(() => state.sdk).toBe(1);
    if (mode === "timeout") await page.clock.fastForward(13000);
    await expect(page.locator("#naverMapsSdkV653")).toHaveCount(0);
    state.mode = "success";
    const shared = await page.evaluate(async () => {
      const first = window.loadNaverMapsSdkV653();
      const second = window.loadNaverMapsSdkV653();
      const shared = first === second;
      await Promise.all([first, second]);
      return shared;
    });
    expect(shared).toBe(true);
    expect(state.sdk).toBe(2);
    expect(state.config).toBe(2);
    await page.evaluate(() => window.loadNaverMapsSdkV653());
    expect(state.sdk).toBe(2);
    expect(state.writes).toBe(0);
  });
}

test("roadview loaded after window load schedules exactly one nonblocking idle warmup", async ({page}) => {
  const source = await readFile("js/script.js", "utf8");
  const start = source.indexOf("function warmNaverRoadviewSdkV658(");
  const end = source.indexOf("function normalizeAngle(", start);
  await page.goto("/original/fixture");
  expect(await page.evaluate(() => document.readyState)).toBe("complete");
  await page.evaluate(() => {
    window.__warmRequests = 0;
    window.loadNaverMapsSdkV653 = () => {window.__warmRequests++; return Promise.resolve({});};
  });
  await page.addScriptTag({content: source.slice(start, end)});
  await expect.poll(() => page.evaluate(() => window.__warmRequests)).toBe(1);
  await page.addScriptTag({content: source.slice(start, end)});
  expect(await page.evaluate(() => window.__warmRequests)).toBe(1);
});
