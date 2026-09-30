import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

const extensionRoot = new URL("../../edge-automation/extension/", import.meta.url);
const targets = [
  {key: "lease-naver", source: "naver", label: "네이버 임대 유성구", tradeType: "lease", enabled: true},
  {key: "lease-daangn", source: "daangn", label: "당근 임대 서구", tradeType: "lease", enabled: false},
  {key: "sale-naver", source: "naver", label: "네이버 매매 유성구", tradeType: "sale", enabled: false},
  {key: "sale-daangn", source: "daangn", label: "당근 매매 서구", tradeType: "sale", enabled: false}
].map(target => ({...target, district: "유성구", registeredAt: "2026-09-30T00:00:00Z", url: target.source === "naver" ? "https://fin.land.naver.com/" : "https://realty.daangn.com/"}));

function fixtureReport(market) {
  return {runId: "fixture-" + market, market, active: false, startedAt: 1790726400000, finishedAt: 1790726460000,
    summary: {total: 2, completed: 1, failed: 1}, total: 2,
    items: targets.filter(target => target.tradeType === market).map((target, index) => ({
      key: target.key, source: target.source, tradeType: market, label: target.label,
      status: index ? "completed" : "failed", counts: {version: 2, expected: market === "sale" ? 23 : 101, processed: market === "sale" ? 23 : 101, created: market === "sale" ? 3 : 1},
      message: index ? "수집 완료" : "검사용 실패", finishedAt: 1790726460000
    }))};
}

test.beforeEach(async ({page, baseURL}) => {
  const snapshot = {ok: true, backgroundBuild: "1.1.11", config: {enabled: true, schedule: "11:00", closeTabs: true, targets}, logs: [], runState: null,
    runReport: fixtureReport("sale"), runReports: {lease: fixtureReport("lease"), sale: fixtureReport("sale")}, readiness: {enabled: true, schedule: "11:00", windowsSchedule: "11:00", windowsTaskState: "Ready"}};
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").at(-1);
    if (url.origin === baseURL && url.pathname.startsWith("/__collector/") && ["options.html", "options.js", "options.css"].includes(name)) {
      return route.fulfill({contentType: name.endsWith("html") ? "text/html" : name.endsWith("css") ? "text/css" : "text/javascript", body: await readFile(new URL(name, extensionRoot), "utf8")});
    }
    return route.abort();
  });
  await page.addInitScript(({snapshot}) => {
    window.__collectorSnapshot = snapshot;
    window.__collectorMessages = [];
    window.chrome = {runtime: {getManifest: () => ({version: "1.1.11"}), sendMessage: (message, callback) => {
      window.__collectorMessages.push(structuredClone(message));
      if (message.type === "JS_AUTO_GET_STATE") callback(structuredClone(window.__collectorSnapshot));
      else if (message.type === "JS_AUTO_SAVE_CONFIG") {
        window.__collectorSnapshot.config = structuredClone(message.config);
        callback({ok: true, config: structuredClone(message.config)});
      } else callback({ok: true, total: 1, message: "검사 실행 요청 확인"});
    }}, storage: {onChanged: {addListener: listener => {window.__collectorStorageChanged = listener;}}}};
  }, {snapshot});
  await page.goto(baseURL + "/__collector/options.html");
  await expect(page.locator('.market-panel[data-market="sale"]')).toBeVisible();
});

test("collector separates market targets, schedule controls and persisted numeric reports", async ({page}, testInfo) => {
  const lease = page.locator('.market-panel[data-market="lease"]');
  const sale = page.locator('.market-panel[data-market="sale"]');
  await expect(lease).toContainText("네이버 임대 유성구");
  await expect(lease).not.toContainText("네이버 매매 유성구");
  await expect(sale).toContainText("네이버 매매 유성구");
  await expect(sale).not.toContainText("네이버 임대 유성구");
  await expect(lease.locator("input[data-toggle]")).toHaveCount(2);
  await expect(sale.locator("input[data-toggle]")).toHaveCount(0);
  await expect(lease).toContainText("101 / 101건 확인");
  await expect(sale).toContainText("23 / 23건 확인");
  await expect(page.locator("#enabled")).toBeChecked();
  await expect(page.locator("#schedule")).toHaveValue("11:00");
  const errors = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(errors).toBe(false);
  await page.screenshot({path: testInfo.outputPath("collector-market-panels.png"), fullPage: true});
});

test("sale all previews only sales and sends explicit market without saving schedule", async ({page}) => {
  await page.locator('[data-run-market="sale"][data-run-mode="all"]').click();
  await expect(page.locator("#runPreview")).toBeVisible();
  await expect(page.locator("#runPreviewBody")).toContainText("네이버 매매 유성구");
  await expect(page.locator("#runPreviewBody")).toContainText("당근 매매 서구");
  await expect(page.locator("#runPreviewBody")).not.toContainText("임대 유성구");
  await page.locator("#runConfirmed").click();
  await expect.poll(() => page.evaluate(() => window.__collectorMessages.filter(message => message.type === "JS_AUTO_RUN_NOW"))).toEqual([{type: "JS_AUTO_RUN_NOW", market: "sale"}]);
  expect(await page.evaluate(() => window.__collectorMessages.some(message => message.type === "JS_AUTO_SAVE_CONFIG"))).toBe(false);
});

test("one-time selection cannot leak the other market and includes schedule-disabled targets", async ({page}) => {
  await page.locator('input[data-once="1"]').check();
  await page.locator('input[data-once="3"]').check();
  await page.locator('[data-run-market="sale"][data-run-mode="selected"]').click();
  await expect(page.locator("#runPreviewBody")).toContainText("당근 매매 서구");
  await expect(page.locator("#runPreviewBody")).not.toContainText("당근 임대 서구");
  await page.locator("#runConfirmed").click();
  await expect.poll(() => page.evaluate(() => window.__collectorMessages.filter(message => message.type === "JS_AUTO_RUN_SELECTED"))).toEqual([
    {type: "JS_AUTO_RUN_SELECTED", market: "sale", keys: ["sale-daangn"], failedOnly: false}
  ]);
});

test("failed-only lease rerun uses its retained report after a newer sale run", async ({page}) => {
  await page.locator('[data-run-market="lease"][data-run-mode="failed"]').click();
  await expect(page.locator("#runPreviewBody")).toContainText("네이버 임대 유성구");
  await expect(page.locator("#runPreviewBody")).not.toContainText("매매 유성구");
  await page.locator("#runConfirmed").click();
  await expect.poll(() => page.evaluate(() => window.__collectorMessages.filter(message => message.type === "JS_AUTO_RUN_SELECTED"))).toEqual([
    {type: "JS_AUTO_RUN_SELECTED", market: "lease", keys: ["lease-naver"], failedOnly: true}
  ]);
});

test("lease schedule checkbox saves only schedule participation and sale selection does not save", async ({page}) => {
  await page.locator('input[data-once="2"]').check();
  expect(await page.evaluate(() => window.__collectorMessages.some(message => message.type === "JS_AUTO_SAVE_CONFIG"))).toBe(false);
  await page.locator('input[data-toggle="0"]').uncheck();
  await expect.poll(() => page.evaluate(() => window.__collectorMessages.filter(message => message.type === "JS_AUTO_SAVE_CONFIG").length)).toBe(1);
  const saved = await page.evaluate(() => window.__collectorMessages.find(message => message.type === "JS_AUTO_SAVE_CONFIG").config);
  expect(saved.enabled).toBe(true);
  expect(saved.schedule).toBe("11:00");
  expect(saved.targets[0].enabled).toBe(false);
  expect(saved.targets.filter(target => target.tradeType === "sale").every(target => target.enabled === false)).toBe(true);
});

test("newly registered Daangn sale target previews before the first report exists", async ({page}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.evaluate(async () => {
    window.__collectorSnapshot.runReport = null;
    window.__collectorSnapshot.runReports = {};
    await window.load();
  });
  await expect(page.locator('.market-panel[data-market="sale"]')).toContainText("아직 실행 기록이 없습니다");
  await page.locator('[data-run-market="sale"][data-run-mode="all"]').click();
  await expect(page.locator("#runPreviewBody")).toContainText("당근 매매 서구");
  await expect(page.locator("#runPreviewBody")).toContainText("예상 개수는 목록 확인 후 확정");
  expect(errors).toEqual([]);
});

test("stale background worker cannot launch a mixed run from a new sale UI", async ({page}) => {
  await page.locator('[data-run-market="sale"][data-run-mode="all"]').click();
  await expect(page.locator("#runPreview")).toBeVisible();
  await page.evaluate(async () => {
    window.__collectorSnapshot.backgroundBuild = "1.1.10";
    await window.load();
  });
  const buttons = page.locator("button[data-run-market]");
  for (let i = 0; i < await buttons.count(); i++) await expect(buttons.nth(i)).toBeDisabled();
  // A dialog opened before the status poll must also fail closed.
  await page.locator("#runConfirmed").dispatchEvent("click");
  expect(await page.evaluate(() => window.__collectorMessages.filter(message => /JS_AUTO_RUN_(NOW|SELECTED)/.test(message.type)))).toEqual([]);
});
