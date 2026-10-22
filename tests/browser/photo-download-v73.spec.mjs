import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {deflateSync} from "node:zlib";

const id = "FIXTURE-LEASE-1";
function pngChunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const header = Buffer.alloc(4), tail = Buffer.alloc(4);
  header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, bytes, tail]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), pngChunk("IEND", Buffer.alloc(0))]);
const source = index => `https://file1.gongsilbox.com/file/land_photo/download-fixture-${index}.png`;
async function fixture(page, context, {market = 'lease', propertyId = id} = {}) {
  const state = {downloads: [], writes: 0, fail: false, hold: false, release: null};
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") state.writes++;
    if (url.hostname === "file1.gongsilbox.com") return route.fulfill({contentType: "image/png", body: png});
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/") {
      const response = await route.fetch(), headers = {...response.headers()};
      headers['content-security-policy'] = headers['content-security-policy'].replace("img-src 'self' data:", "img-src 'self' data: https://file1.gongsilbox.com");
      return route.fulfill({response, headers});
    }
    if (url.pathname === "/api/listing-image") {
      if (route.request().resourceType() !== "fetch") return route.fulfill({contentType: "image/png", body: png});
      state.downloads.push(url.searchParams.get("url"));
      if (state.hold) await new Promise(resolve => {state.release = resolve;});
      if (state.fail) return route.fulfill({status: 401, json: {ok: false, message: "expired fixture"}});
      return route.fulfill({contentType: "image/png", body: png});
    }
    if (url.pathname === "/api/data" && ["unifiedListings", "unifiedListingDetail"].includes(url.searchParams.get("action"))) {
      const response = await route.fetch(), data = await response.json();
      for (const original of data.groups ? Object.values(data.groups).flat() : data.originals || []) {
        if (original.propertyId === propertyId) Object.assign(original, {images: [source(0), source(1)], thumbnail: source(0), photoCount: 2});
      }
      return route.fulfill({response, json: data});
    }
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  if (market !== 'lease') {
    await page.locator((await page.locator('#jsMobileTradeModeV1').isVisible()) ? '#jsMobileTradeModeV1' : '#listingTradeModeSelectV1').selectOption(market);
  }
  await page.evaluate(id => window.JSUnifiedListingsV8.open(id), propertyId);
  await expect(page.locator(".unified-detail-photo-count-v8")).toHaveText("1 / 2");
  return state;
}

for (const [market, propertyId] of [['lease',id], ['building_sale','FIXTURE-BUILDING'], ['land_sale','FIXTURE-LAND']])
test(market + " detail and full viewer download selected collected file without initial download requests or writes", async ({page, context}, info) => {
  const state = await fixture(page, context, {market, propertyId});
  const gallery = page.locator(".unified-detail-gallery-v8");
  expect(state.downloads).toEqual([]);
  await page.evaluate(() => document.querySelector('.unified-detail-photo-nav-v8.next').click());
  await expect(page.locator(".unified-detail-photo-count-v8")).toHaveText("2 / 2");
  const saved = page.waitForEvent("download");
  await gallery.locator(".unified-photo-download-v73").click();
  const file = await saved;
  expect(file.suggestedFilename()).toMatch(/_사진_02\.png$/);
  expect(await readFile(await file.path())).toEqual(png);
  expect(state.downloads).toEqual([source(1)]);
  await expect(page.locator("#unifiedGalleryV8.open")).toHaveCount(0);
  await page.evaluate(() => document.querySelector('.unified-detail-hero-v8').click());
  const full = page.locator("#unifiedGalleryV8.open");
  await full.locator(".prev").click();
  await expect(full.locator("span:not(.photo-transition-ghost-v1)")).toHaveText("1 / 2");
  const fullSaved = page.waitForEvent("download");
  await full.locator(".unified-photo-download-v73").click();
  const fullFile = await fullSaved;
  expect(fullFile.suggestedFilename()).toMatch(/_사진_01\.png$/);
  expect(await readFile(await fullFile.path())).toEqual(png);
  expect(state.downloads).toEqual([source(1), source(0)]);
  expect(state.writes).toBe(0);
  await page.screenshot({path: info.outputPath("photo-download-viewer.png")});
});

test("download captures original index once and prevents duplicate clicks while photos change", async ({page, context}) => {
  const state = await fixture(page, context); state.hold = true;
  const button = page.locator(".unified-detail-gallery-v8 .unified-photo-download-v73");
  await button.evaluate(e => { e.click(); e.click(); });
  await expect.poll(() => state.downloads.length).toBe(1);
  await expect(button).toBeDisabled();
  await page.evaluate(() => document.querySelector('.unified-detail-photo-nav-v8.next').click());
  const saved = page.waitForEvent("download");
  state.release();
  expect((await saved).suggestedFilename()).toMatch(/_사진_01\.png$/);
  expect(state.downloads).toEqual([source(0)]);
  await expect(button).toBeEnabled();
});

test("expired login never downloads an error document and allows a clean retry", async ({page, context}) => {
  const state = await fixture(page, context); state.fail = true;
  const files = []; page.on("download", file => files.push(file));
  const button = page.locator(".unified-detail-gallery-v8 .unified-photo-download-v73");
  await button.evaluate(e => e.click());
  await expect(page.locator("#unifiedPhotoDownloadNoticeV73")).toContainText("로그인 상태");
  expect(files).toHaveLength(0);
  await expect(button).toBeEnabled();
  state.fail = false;
  const saved = page.waitForEvent("download"); await button.evaluate(e => e.click()); await saved;
  expect(files).toHaveLength(1);
});

test("photo-less listing exposes no download control or download request", async ({page, context}) => {
  const state = await fixture(page, context);
  await page.evaluate(() => window.JSUnifiedListingsV8.open("FIXTURE-LEASE-2"));
  await expect(page.locator("#unifiedDetailBodyV8 .unified-photo-download-v73")).toHaveCount(0);
  expect(state.downloads).toHaveLength(0);
});
