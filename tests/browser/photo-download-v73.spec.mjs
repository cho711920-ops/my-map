import {test, expect} from "@playwright/test";
import {deflateSync} from "node:zlib";
import {readPhotoZip} from '../fixtures/photo-zip-check.mjs';

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
async function fixture(page, context, {market = 'lease', propertyId = id, incomplete = false} = {}) {
  const state = {downloads: [], writes: 0, fail: false, failIndex: -1, hold: false, release: null, incomplete, detailReads: 0};
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
      if (state.hold) await new Promise(resolve => {state.release = () => {state.hold = false; resolve();};});
      if (state.fail) return route.fulfill({status: 401, json: {ok: false, message: "expired fixture"}});
      if (url.searchParams.get('url') === source(state.failIndex)) return route.fulfill({status: 404, body: 'missing'});
      return route.fulfill({contentType: "image/png", body: png});
    }
    if (url.pathname === "/api/data" && ["unifiedListings", "unifiedListingDetail"].includes(url.searchParams.get("action"))) {
      const response = await route.fetch(), data = await response.json();
      const detail = url.searchParams.get('action') === 'unifiedListingDetail';
      if (detail) state.detailReads++;
      for (const original of data.groups ? Object.values(data.groups).flat() : data.originals || []) {
        if (original.propertyId === propertyId) Object.assign(original, {images: Array.from({length: state.incomplete ? 1 : 10}, (_, i) => source(i)), thumbnail: source(0), photoCount: 10});
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
  await expect(page.locator(".unified-detail-photo-count-v8")).toHaveText("1 / 10");
  return state;
}

async function verifyTenPhotos(file) {
  expect(file.suggestedFilename()).toMatch(/_사진전체_10장\.zip$/);
  const saved = readPhotoZip(await file.path());
  expect(saved).toHaveLength(10);
  saved.forEach((entry, i) => {
    expect(entry.name).toMatch(new RegExp('_사진_' + String(i + 1).padStart(2, '0') + '\\.png$'));
    expect(entry.bytes).toEqual(png);
  });
}

for (const [market, propertyId] of [['lease',id], ['building_sale','FIXTURE-BUILDING'], ['land_sale','FIXTURE-LAND']])
test(market + " detail and full viewer save all ten photos in one ZIP with compact controls and no initial downloads or writes", async ({page, context}, info) => {
  const state = await fixture(page, context, {market, propertyId});
  const gallery = page.locator(".unified-detail-gallery-v8");
  expect(state.downloads).toEqual([]);
  await page.evaluate(() => document.querySelector('.unified-detail-photo-nav-v8.next').click());
  await expect(page.locator(".unified-detail-photo-count-v8")).toHaveText("2 / 10");
  const size = await gallery.locator('.unified-photo-download-v73').boundingBox();
  expect(size.height).toBeLessThanOrEqual(32);
  expect(size.width).toBeLessThanOrEqual(100);
  const saved = page.waitForEvent("download");
  await gallery.locator(".unified-photo-download-v73").click();
  const file = await saved;
  await verifyTenPhotos(file);
  expect(state.downloads).toEqual(Array.from({length: 10}, (_, i) => source(i)));
  await expect(page.locator("#unifiedGalleryV8.open")).toHaveCount(0);
  await page.evaluate(() => document.querySelector('.unified-detail-hero-v8').click());
  const full = page.locator("#unifiedGalleryV8.open");
  await full.locator(".prev").click();
  await expect(full.locator("span:not(.photo-transition-ghost-v1)")).toHaveText("1 / 10");
  const fullSaved = page.waitForEvent("download");
  await full.locator(".unified-photo-download-v73").click();
  const fullFile = await fullSaved;
  await verifyTenPhotos(fullFile);
  expect(state.downloads).toEqual(Array.from({length: 20}, (_, i) => source(i % 10)));
  expect(state.writes).toBe(0);
  await page.screenshot({path: info.outputPath("photo-download-viewer.png")});
});

test("bulk download keeps the captured original and prevents duplicate clicks while photos and listings change", async ({page, context}) => {
  const state = await fixture(page, context); state.hold = true;
  const button = page.locator(".unified-detail-gallery-v8 .unified-photo-download-v73");
  await button.evaluate(e => { e.click(); e.click(); });
  await expect.poll(() => state.downloads.length).toBe(1);
  await expect(button).toBeDisabled();
  await page.evaluate(() => document.querySelector('.unified-detail-photo-nav-v8.next').click());
  await page.evaluate(() => window.JSUnifiedListingsV8.open('FIXTURE-LEASE-2'));
  const saved = page.waitForEvent("download");
  state.release();
  await verifyTenPhotos(await saved);
  expect(state.downloads).toEqual(Array.from({length: 10}, (_, i) => source(i)));
  await page.evaluate(() => window.JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  await expect(button).toBeEnabled();
});

test('bulk download hydrates thumbnail-only detail before saving all ten photos', async ({page, context}) => {
  const state = await fixture(page, context, {incomplete: true});
  await expect.poll(() => state.detailReads).toBeGreaterThan(0);
  state.incomplete = false;
  const saved = page.waitForEvent('download');
  await page.locator('.unified-detail-gallery-v8 .unified-photo-download-v73').click();
  await verifyTenPhotos(await saved);
  expect(state.downloads).toHaveLength(10);
});

test('missing photo list never silently saves a one-photo ZIP as all ten', async ({page, context}) => {
  const state = await fixture(page, context, {incomplete: true});
  const files = []; page.on('download', file => files.push(file));
  await page.locator('.unified-detail-gallery-v8 .unified-photo-download-v73').click();
  await expect(page.locator('#unifiedPhotoDownloadNoticeV73')).toContainText('10장 중 1장');
  expect(state.downloads).toHaveLength(0); expect(files).toHaveLength(0);
});

test('a failed fifth image produces no partial ZIP and a clean retry saves all ten', async ({page, context}) => {
  const state = await fixture(page, context); state.failIndex = 4;
  const files = []; page.on('download', file => files.push(file));
  const button = page.locator('.unified-detail-gallery-v8 .unified-photo-download-v73');
  await button.click();
  await expect(page.locator('#unifiedPhotoDownloadNoticeV73')).toContainText('4/10장 준비');
  expect(files).toHaveLength(0); await expect(button).toBeEnabled();
  state.failIndex = -1;
  const saved = page.waitForEvent('download'); await button.click();
  await verifyTenPhotos(await saved); expect(files).toHaveLength(1);
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
