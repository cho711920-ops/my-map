import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

test.beforeEach(async ({context}) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.deviceModelReads = 0;
    const original = navigator.userAgentData;
    Object.defineProperty(navigator, "userAgentData", {configurable:true,value:{
      mobile: original?.mobile, platform: original?.platform,
      getHighEntropyValues: async () => {window.deviceModelReads++; return {model:"TEST-DEVICE"};}
    }});
  });
});

test("ordinary visits do not show diagnostics or query a device model", async ({page}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
  await expect(page.locator("#jsPhoneDeviceCheckV1")).toHaveCount(0);
  expect(await page.evaluate(()=>window.deviceModelReads)).toBe(0);
});

test("explicit diagnostic URL shows local device-only facts and leaves classification unchanged", async ({page, isMobile}) => {
  await page.goto("/?phoneCheck=1");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
  const panel=page.locator("#jsPhoneDeviceCheckV1");
  await expect(panel).toBeVisible();
  await expect(panel.locator("pre")).toContainText("TEST-DEVICE");
  await expect(panel.locator("pre")).not.toContainText(/example\.invalid|FIXTURE-LEASE|session|token/);
  expect(await page.evaluate(()=>window.deviceModelReads)).toBe(1);
  expect(await page.evaluate(()=>window.JSPhoneDeviceV1.isPhone())).toBe(isMobile);
  await panel.getByRole("button",{name:"다시 확인",exact:true}).click();
  expect(await page.evaluate(()=>window.deviceModelReads)).toBe(1);
  await panel.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(panel).toHaveCount(0);
});

test("real authenticated bootstrap shows diagnostics even while a secondary script is stalled", async ({page}) => {
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  await page.route("http://127.0.0.1:*/?phoneCheck=1", route=>route.fulfill({status:200,contentType:"text/html",body:html}));
  await page.route("https://dapi.kakao.com/**", route=>route.fulfill({status:200,contentType:"text/javascript",body:"window.kakao={maps:{load:function(){}}};"}));
  let resume;
  const stalled=new Promise(resolve=>{resume=resolve;});
  await page.route("**/js/async-mutation-queue-v1.js*",async route=>{
    await stalled;
    await route.fulfill({status:200,contentType:"text/javascript",body:"/* resumed test-only secondary script */"});
  });
  try {
    await page.goto("/?phoneCheck=1",{waitUntil:"domcontentloaded"});
    await expect(page.locator("html")).not.toHaveClass(/auth-pending/);
    await expect(page.locator("#jsPhoneDeviceCheckV1")).toBeVisible({timeout:1500});
  } finally {resume();}
});

test("standalone diagnostic works without queries, login, map or any API request", async ({page}) => {
  const apiRequests=[];
  await page.route("**/api/**", route=>{
    apiRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/phone-check");
  await expect(page).toHaveTitle("기기 화면 확인 · JS부동산");
  const panel=page.locator("#jsPhoneDeviceCheckV1");
  await expect(panel).toBeVisible();
  await expect(panel.locator("pre")).toContainText("독립 확인 페이지");
  await expect(panel.locator("pre")).toContainText("TEST-DEVICE");
  expect(apiRequests).toEqual([]);
  await expect(page.locator("#wrap, #jsAuthGate, #map")).toHaveCount(0);
  await panel.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(panel).toHaveCount(0);
});
