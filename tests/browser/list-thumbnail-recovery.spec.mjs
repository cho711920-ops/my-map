import {test, expect} from "@playwright/test";

// Only image transport and source photo data are synthetic. The actual list,
// detail gallery, image handlers, favorite store and phone layout are exercised.
const firstId = "FIXTURE-LEASE-1";
const secondId = "FIXTURE-LEASE-2";
const photo = index => `https://landthumb-phinf.pstatic.net/fixture/photo-${index}.jpg?type=m1024`;
const firstPhoto = photo(1);
const secondPhoto = photo(2);
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#d8efe7"/><path d="M30 180V80h260v100M30 120h260M110 80v100M210 80v100" fill="none" stroke="#17665b" stroke-width="8"/><text x="160" y="216" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#17665b">TEST PROPERTY PHOTO</text></svg>';

function card(page, id = firstId) {
  return page.locator(`#list .item[data-property-id="${id}"]`);
}

function thumbnail(page, id = firstId) {
  return card(page, id).locator(".unified-thumb-v8");
}

async function imageReady(image) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
}

async function installFixture(page, context, {photos = {[firstId]: [firstPhoto], [secondId]: []}, direct = true, proxy = true} = {}) {
  const state = {direct, proxy, photos: {}, configuredPhotos: photos, requests: {direct: {}, proxy: {}}, writes: 0};
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const isProxy = url.hostname === "127.0.0.1" && url.pathname === "/api/listing-image";
    const isDirect = url.hostname === "landthumb-phinf.pstatic.net" && url.pathname.startsWith("/fixture/");
    if (isProxy || isDirect) {
      const kind = isProxy ? "proxy" : "direct";
      const source = isProxy ? url.searchParams.get("url") : url.href;
      state.requests[kind][source] = (state.requests[kind][source] || 0) + 1;
      const result = typeof state[kind] === "function" ? state[kind](source) : state[kind];
      if (!result) return route.fulfill({status: 503, contentType: "text/plain", body: "Fixture temporary image failure"});
      return route.fulfill({status: 200, contentType: "image/svg+xml", body: tile, headers: {"cache-control": "no-store"}});
    }
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (request.method() !== "GET") state.writes += 1;
    if (url.pathname === "/") {
      const response = await route.fetch();
      const headers = {...response.headers()};
      headers["content-security-policy"] = headers["content-security-policy"].replace("img-src 'self' data:", "img-src 'self' data: https://landthumb-phinf.pstatic.net");
      return route.fulfill({response, headers});
    }
    if (url.pathname === "/api/data" && /^(unifiedListings|unifiedListingDetail)$/.test(url.searchParams.get("action") || "")) {
      const response = await route.fetch();
      const data = await response.json();
      const originals = data.groups ? Object.values(data.groups).flat() : data.originals || [];
      for (const original of originals) {
        const images = state.photos[original.propertyId] || [];
        Object.assign(original, {images, thumbnail: images[0] || "", photoCount: images.length});
      }
      return route.fulfill({response, json: data});
    }
    return route.continue();
  });
  return state;
}

async function openList(page, isMobile, state) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(card(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.JSV6ListStore.load("favorite").some(folder => folder.id === "fixture-favorites"))).toBe(true);
  // Account initialization can repaint the list. Add photo data after that
  // completes so request counts measure recovery for one actual card node.
  state.photos = state.configuredPhotos;
  await page.evaluate(async () => {
    const result = await window.JSUnifiedListingsV8.load(true);
    window.JSUnifiedListingsV8.attach(window.allItems, result);
    window.applyFilter();
  });
}

async function preserveListState(page) {
  return page.evaluate(() => ({
    keys: window.allItems.map(item => item.key),
    selection: window.selectedPrintKeys || [],
    favorites: window.JSV6ListStore.load("favorite"),
    favoriteOnly: window.favoriteOnly,
    activeFolder: window.activeFavoriteFolderId,
    filters: ["keyword", "sourceFilter", "typeFilter", "sortFilter"].map(id => [id, document.getElementById(id)?.value])
  }));
}

test("successful list image stays direct and lazy without proxy or writes; missing image remains genuinely absent", async ({page, context, isMobile}) => {
  const state = await installFixture(page, context);
  await openList(page, isMobile, state);
  const image = thumbnail(page).locator("img");
  await imageReady(image);
  await expect(image).toHaveAttribute("src", firstPhoto);
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("data-thumbnail-source-v8144", firstPhoto);
  await expect(thumbnail(page)).not.toContainText("사진 없음");
  await expect(thumbnail(page, secondId)).toHaveText("사진 없음");
  await expect(thumbnail(page, secondId).locator("img")).toHaveCount(0);
  expect(state.requests.direct[firstPhoto]).toBe(1);
  expect(state.requests.proxy).toEqual({});
  expect(state.writes).toBe(0);
});

test("failed direct image retries the exact source once through the existing image proxy", async ({page, context, isMobile}, testInfo) => {
  const state = await installFixture(page, context, {direct: false, proxy: true});
  await openList(page, isMobile, state);
  const image = thumbnail(page).locator("img");
  await imageReady(image);
  await expect(image).toHaveAttribute("src", "/api/listing-image?url=" + encodeURIComponent(firstPhoto));
  await expect(image).toHaveAttribute("data-thumbnail-source-v8144", firstPhoto);
  await expect(thumbnail(page)).toHaveClass(/has-photo/);
  await expect(thumbnail(page)).not.toContainText(/사진 없음|불러오기 실패/);
  expect(state.requests.direct[firstPhoto]).toBe(1);
  expect(state.requests.proxy[firstPhoto]).toBe(1);
  expect(state.writes).toBe(0);
  await page.screenshot({path: testInfo.outputPath("thumbnail-proxy-recovered.png")});
});

test("exhausted image recovery retains the source and shows load failure without repeat requests", async ({page, context, isMobile}, testInfo) => {
  const state = await installFixture(page, context, {direct: false, proxy: false});
  await openList(page, isMobile, state);
  const image = thumbnail(page).locator("img");
  await expect(thumbnail(page)).toHaveText("사진 불러오기 실패");
  await expect(image).toHaveCount(1);
  await expect(image).toBeHidden();
  await expect(image).toHaveAttribute("data-thumbnail-source-v8144", firstPhoto);
  expect(state.requests.direct[firstPhoto]).toBe(1);
  expect(state.requests.proxy[firstPhoto]).toBe(1);
  const before = structuredClone(state.requests);
  await image.evaluate(node => { node.dispatchEvent(new Event("error")); node.dispatchEvent(new Event("error")); });
  await expect(thumbnail(page)).toHaveText("사진 불러오기 실패");
  expect(state.requests).toEqual(before);
  await expect(thumbnail(page, secondId)).toHaveText("사진 없음");
  await page.screenshot({path: testInfo.outputPath("thumbnail-failure-versus-missing.png")});
});

test("successful detail image repairs only the matching failed thumbnail in place and preserves list state", async ({page, context, isMobile}, testInfo) => {
  const state = await installFixture(page, context, {photos: {[firstId]: [firstPhoto], [secondId]: [secondPhoto]}, direct: false, proxy: false});
  await openList(page, isMobile, state);
  await expect(thumbnail(page)).toHaveText("사진 불러오기 실패");
  await expect(thumbnail(page, secondId)).toHaveText("사진 불러오기 실패");
  if (!isMobile) await card(page, secondId).locator(".action-select-check").check();
  const before = await preserveListState(page);
  await page.evaluate(() => { window.__thumbnailOriginalCards = [...document.querySelectorAll("#list .item")]; });
  state.direct = source => source === firstPhoto;
  await card(page).locator(".item-building-name").click();
  const detail = page.locator(".unified-detail-hero-v8 img");
  await imageReady(detail);
  await expect(detail).toHaveAttribute("data-detail-source-v8144", firstPhoto);
  await expect.poll(() => thumbnail(page).locator("img").evaluate(node => node.style.display !== "none" && node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(thumbnail(page)).toHaveClass(/has-photo/);
  await expect(thumbnail(page)).not.toContainText(/사진 없음|불러오기 실패/);
  await expect(thumbnail(page, secondId)).toHaveText("사진 불러오기 실패");
  expect(await preserveListState(page)).toEqual(before);
  expect(await page.evaluate(() => window.__thumbnailOriginalCards.every((node, index) => node === document.querySelectorAll("#list .item")[index]))).toBe(true);
  const requestCounts = structuredClone(state.requests);
  await detail.evaluate(node => { node.dispatchEvent(new Event("load")); node.dispatchEvent(new Event("load")); });
  expect(state.requests).toEqual(requestCounts);
  await page.screenshot({path: testInfo.outputPath("detail-restored-matching-thumbnail.png")});
});

test("a seven-photo detail never substitutes another gallery image for the failed representative photo", async ({page, context, isMobile}) => {
  const images = [firstPhoto, ...[3, 4, 5, 6, 7, 8].map(photo)];
  const state = await installFixture(page, context, {photos: {[firstId]: images}, direct: false, proxy: source => source !== firstPhoto});
  await openList(page, isMobile, state);
  await expect(thumbnail(page)).toHaveText("사진 불러오기 실패");
  await card(page).locator(".item-building-name").click();
  const detail = page.locator(".unified-detail-hero-v8 img");
  await imageReady(detail);
  await expect(page.locator(".unified-detail-photo-count-v8")).toHaveText("2 / 7");
  await expect(detail).toHaveAttribute("data-detail-source-v8144", images[1]);
  await expect(thumbnail(page)).toHaveText("사진 불러오기 실패");
  await expect(thumbnail(page).locator("img")).toHaveAttribute("data-thumbnail-source-v8144", firstPhoto);
  state.direct = source => source === firstPhoto;
  await page.getByRole("button", {name: "이전 사진", exact: true}).click();
  await imageReady(detail);
  await expect(page.locator(".unified-detail-photo-count-v8")).toHaveText("1 / 7");
  await expect(detail).toHaveAttribute("data-detail-source-v8144", firstPhoto);
  await expect(thumbnail(page)).not.toContainText("사진 불러오기 실패");
  await expect.poll(() => thumbnail(page).locator("img").evaluate(node => node.complete && node.naturalWidth > 0 && node.style.display !== "none")).toBe(true);
});
