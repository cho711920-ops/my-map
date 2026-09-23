import {test, expect} from "@playwright/test";

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
