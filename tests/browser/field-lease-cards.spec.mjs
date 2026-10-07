import {test, expect} from "@playwright/test";
import {readFile, writeFile} from "node:fs/promises";
import ts from "typescript";

// The loopback fixture supplies real filters/list/detail/mobile modules. Extract
// map declarations without its network/bootstrap side effects; only SDK/GPS are
// replaced below. Rendering, address grouping, selection and detail are real.
const mapText = await readFile(new URL("../../js/map.js", import.meta.url), "utf8");
const mapAst = ts.createSourceFile("map.js", mapText, ts.ScriptTarget.Latest, true);
const mapDeclarations = mapAst.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
).map(statement => statement.getText(mapAst)).join("\n");
const tabletUA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const phoneUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const devices = [
  {name: "phone-portrait", width: 390, height: 844, screen: {width: 390, height: 844}, userAgent: phoneUA},
  {name: "tablet-portrait", width: 768, height: 1024, screen: {width: 768, height: 1024}, userAgent: tabletUA},
  {name: "tablet-portrait-wide", width: 820, height: 1180, screen: {width: 820, height: 1180}, userAgent: tabletUA},
  {name: "phone-landscape", width: 740, height: 360, screen: {width: 740, height: 360}, userAgent: phoneUA},
  {name: "tablet-landscape", width: 1280, height: 800, screen: {width: 1280, height: 800}, userAgent: tabletUA},
  {name: "tablet-split", width: 600, height: 900, screen: {width: 820, height: 1280}, userAgent: tabletUA}
];

test.beforeEach(({isMobile}, testInfo) => {
  test.skip(isMobile || testInfo.project.name !== "desktop", "Dedicated device contexts run from the desktop project.");
});

async function installBoundary(page) {
  await page.locator("#fixtureControls").evaluate(element => {element.style.display = "none";});
  await page.evaluate(() => {
    const listeners = new Map(), attached = new Set();
    const viewport = document.getElementById("map");
    const host = document.getElementById("jsFieldMapSurfaceV1") || document.createElement("div");
    host.id = "jsFieldMapSurfaceV1";
    host.style.background = "repeating-linear-gradient(0deg,transparent,transparent 59px,#d4e2ec 60px),repeating-linear-gradient(90deg,#edf4f8,#edf4f8 59px,#d4e2ec 60px)";
    viewport.appendChild(host);
    const credits = document.createElement("div");
    credits.id = "fixtureSdkCredits";
    Object.assign(credits.style, {position: "absolute", bottom: "0px", left: "0px", display: "flex", gap: "4px", fontSize: "11px"});
    credits.innerHTML = '<span data-fixture-scale>50m</span><a href="https://map.kakao.com/"><img width="32" height="10" alt="Kakao test boundary" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'10\'%3E%3Ctext x=\'0\' y=\'9\' font-size=\'10\'%3Ekakao%3C/text%3E%3C/svg%3E"></a>';
    host.appendChild(credits);
    function LatLng(lat, lng) { this.getLat = () => lat; this.getLng = () => lng; }
    function Point(x, y) { this.x = x; this.y = y; }
    const state = {watchCalls: 0, positionCallback: null};
    const emit = type => { for (const callback of listeners.get(type) || []) callback(); };
    const map = {
      center: new LatLng(36.35, 127.38), level: 3, draggable: true, zoomable: true,
      getCenter() { return this.center; }, getLevel() { return this.level; },
      getDraggable() { return this.draggable; }, getZoomable() { return this.zoomable; },
      setDraggable(value) { this.draggable = value; }, setZoomable(value) { this.zoomable = value; },
      getProjection() { return {
        containerPointFromCoords(coords) {
          const factor = 100000 * Math.pow(2, 3 - map.level);
          return new Point(host.clientWidth / 2 + (coords.getLng() - map.center.getLng()) * factor,
            host.clientHeight / 2 - (coords.getLat() - map.center.getLat()) * factor);
        },
        coordsFromContainerPoint(point) {
          const factor = 100000 * Math.pow(2, 3 - map.level);
          return new LatLng(map.center.getLat() - (point.y - host.clientHeight / 2) / factor,
            map.center.getLng() + (point.x - host.clientWidth / 2) / factor);
        }
      }; },
      getBounds() { return {contain(coords) {
        const point = map.getProjection().containerPointFromCoords(coords);
        return point.x >= 0 && point.x <= host.clientWidth && point.y >= 0 && point.y <= host.clientHeight;
      }}; },
      setCenter(point) { this.center = point; this.relayout(); emit("center_changed"); emit("idle"); },
      setLevel(level) { this.level = level; credits.querySelector("[data-fixture-scale]").textContent = ({1: "20m", 2: "30m", 3: "50m"})[level]; this.relayout(); emit("zoom_changed"); emit("idle"); },
      panTo(point) { this.setCenter(point); },
      relayout() { for (const overlay of attached) overlay.render(); }
    };
    function CustomOverlay(options) {
      this.position = options.position;
      this.owner = null;
      this.anchor = document.createElement("div");
      this.setContent = content => {
        this.content = content;
        if (typeof content === "string") this.anchor.innerHTML = content;
        else this.anchor.replaceChildren(content);
        this.render();
      };
      this.render = () => {
        if (!this.owner) return;
        const point = map.getProjection().containerPointFromCoords(this.position);
        Object.assign(this.anchor.style, {position: "absolute", left: point.x + "px", top: point.y + "px",
          zIndex: String(options.zIndex || 0), transform: "translate(" + (-100 * (options.xAnchor ?? .5)) + "%," + (-100 * (options.yAnchor ?? .5)) + "%)"});
      };
      this.setPosition = position => { this.position = position; this.render(); };
      this.getPosition = () => this.position;
      this.getContent = () => this.content;
      this.setMap = owner => {
        this.owner = owner;
        if (owner) { host.appendChild(this.anchor); attached.add(this); this.render(); }
        else { this.anchor.remove(); attached.delete(this); }
      };
      this.setContent(options.content);
    }
    window.map = map;
    window.kakao = {maps: {LatLng, Point, CustomOverlay, event: {
      addListener(target, type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      }, trigger(target, type) { emit(type); }
    }}};
    Object.defineProperty(navigator, "geolocation", {configurable: true, value: {
      watchPosition(callback) { state.watchCalls += 1; state.positionCallback = callback; return 101; }
    }});
    window.__leaseFixture = {state, fix(heading = null, speed = 0, position = {}) {
      state.positionCallback({coords: {latitude: 36.35, longitude: 127.38, accuracy: 8, heading, speed, ...position}, timestamp: Date.now()});
    }};
  });
  await page.addScriptTag({content: mapDeclarations});
  await page.addScriptTag({url: "/js/map-field-camera-v1.js"});
  await page.addScriptTag({url: "/js/map-field-lease-cards-v1.js"});
  await page.addScriptTag({url: "/js/map-field-mode-v1.js"});
  await page.addScriptTag({url: "/js/map-quick-tools-v657.js"});
  await page.evaluate(() => {
    kakao.maps.event.addListener(map, "idle", scheduleMapIdleRefreshV638);
    syncMapQuickToolGeometryV659();
    const first = allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
    // Keep the full three-row card inside a short landscape map at 20m scale;
    // the portrait-only north offset would put its top rows under the header.
    const shortMap = document.getElementById("map").clientHeight < 400;
    first.latlng = new kakao.maps.LatLng(shortMap ? 36.3498 : 36.3503, 127.3798);
    for (let index = 2; index <= 4; index += 1) {
      allItems.push({...first, propertyId: "FIXTURE-SAME-" + index, key: "fixture-same-" + index,
        room: index + "층", area: 20 + index * 5, deposit: 1000 * index, rent: 70 + index * 10});
    }
    favoriteOnly = true;
    favoriteKeys = allItems.filter(item => item.address === first.address).map(item => "property:" + item.propertyId);
    favoriteFilterKeys = favoriteKeys.slice();
    // These extra synthetic rows are personal favorites, not changes to the
    // fixture server's separately saved one-item folder.
    activeFavoriteFolderId = "";
    document.getElementById("keyword").value = "괴정";
    document.getElementById("jsMobileKeywordV1").value = "괴정";
    document.getElementById("sourceFilter").value = "naver";
    document.getElementById("maxRent").value = "150";
    startCurrentLocationTrackingV630();
    __leaseFixture.fix();
    applyFilter();
  });
}

async function preserved(page) {
  return page.evaluate(() => ({
    filters: ["keyword", "sourceFilter", "maxRent"].map(id => document.getElementById(id).value),
    favoriteOnly, favoriteKeys, favoriteFilterKeys, activeFavoriteFolderId,
    listings: allItems.map(item => [item.propertyId, item.address, item.room, item.deposit, item.rent, item.area]),
    folder: JSV6ListStore.load("favorite")
  }));
}

// The 120px target permits subpixel font metrics (120.14px in installed Edge).
async function expectCompactRowGeometry(row, maximumWidth = 121) {
  const geometry = await row.evaluate(row => {
    const topElement = row.querySelector(".field-lease-top-v1");
    const priceElement = row.querySelector(".field-lease-price-v1");
    const top = topElement.getBoundingClientRect();
    const price = priceElement.getBoundingClientRect();
    const card = row.closest(".field-lease-card-v1");
    const box = card.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const textBounds = [topElement, priceElement].map(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return {left: text.left, right: text.right, top: text.top, bottom: text.bottom,
        lineCount: range.getClientRects().length, overflow: element.scrollWidth - element.clientWidth};
    });
    return {topCenter: top.x + top.width / 2, priceCenter: price.x + price.width / 2,
      cardCenter: box.x + box.width / 2, topBottom: top.bottom, priceTop: price.top,
      width: box.width, rowHeight: rowBox.height, radius: parseFloat(getComputedStyle(card).borderRadius),
      cardLeft: box.left, cardRight: box.right, rowTop: rowBox.top, rowBottom: rowBox.bottom,
      textBounds,
      direction: style.flexDirection, align: style.alignItems, justify: style.justifyContent,
      lineCount: row.children.length};
  });
  expect(geometry).toMatchObject({direction: "column", align: "center", justify: "center", lineCount: 2});
  expect(geometry.width).toBeGreaterThanOrEqual(112);
  expect(geometry.width).toBeLessThanOrEqual(maximumWidth);
  expect(geometry.rowHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.rowHeight).toBeLessThanOrEqual(46);
  expect(geometry.radius).toBeLessThanOrEqual(6);
  expect(Math.abs(geometry.topCenter - geometry.cardCenter)).toBeLessThan(1);
  expect(Math.abs(geometry.priceCenter - geometry.cardCenter)).toBeLessThan(1);
  expect(geometry.priceTop).toBeGreaterThanOrEqual(geometry.topBottom);
  for (const line of geometry.textBounds) {
    expect(line.lineCount).toBe(1);
    expect(line.overflow).toBeLessThanOrEqual(1);
    expect(line.left).toBeGreaterThanOrEqual(geometry.cardLeft + 1);
    expect(line.right).toBeLessThanOrEqual(geometry.cardRight - 1);
    expect(line.top).toBeGreaterThanOrEqual(geometry.rowTop);
    expect(line.bottom).toBeLessThanOrEqual(geometry.rowBottom);
  }
  return geometry;
}

async function expectCardLayout(page) {
  const rows = page.locator(".field-lease-row-v1");
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator(".field-lease-top-v1")).toHaveText("1층 · 25평");
  await expect(rows.first().locator(".field-lease-price-v1")).toHaveText("보 2,000 / 월 90");
  for (const row of await rows.all()) await expectCompactRowGeometry(row);
}

async function expectSingleFieldControl(page, toggle, scale) {
  await expect(page.locator("[data-field-mode-expand]:visible")).toHaveCount(0);
  await expect(page.locator("[data-field-mode-controls]:visible")).toHaveCount(0);
  await expect(toggle.locator("[data-field-mode-indicator]")).toBeVisible();
  await expect(toggle.locator("[data-field-mode-indicator]")).toHaveText(scale ? scale + "m" : "OFF");
  expect(await page.locator("[data-field-mode-expand]").evaluateAll(buttons => buttons.every(button => {
    button.focus();
    return getComputedStyle(button).display === "none" && document.activeElement !== button;
  }))).toBe(true);
}

for (const device of devices) {
  test(`${device.name}: lease cards, three scales, detail, more and heading keep filters`, async ({browser, baseURL}, testInfo) => {
    const context = await browser.newContext({serviceWorkers: "block", isMobile: true, hasTouch: true,
      userAgent: device.userAgent, viewport: {width: device.width, height: device.height}, screen: device.screen});
    const errors = [], writes = [], forbidden = [];
    try {
      await context.route("**/*", route => {
        const request = route.request();
        if (new URL(request.url()).hostname !== "127.0.0.1") {
          forbidden.push(request.url()); return route.abort();
        }
        if (request.method() !== "GET") { writes.push(request.url()); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseURL);
      await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
      await installBoundary(page);
      await expect(page.locator("#list .item")).toHaveCount(4);
      await expect(page.locator(".circle-marker")).toHaveCount(1);
      const baseline = await preserved(page);
      const compact = device.height > device.width;
      const toggle = page.locator(compact ? "#mapFieldModeCompactToggleV1" : "#mapFieldModeToggleV1");
      await expectSingleFieldControl(page, toggle, null);
      await toggle.click();
      await expectSingleFieldControl(page, toggle, 20);
      expect(await page.evaluate(() => map.getLevel())).toBe(1);
      await expect(page.locator(".field-lease-card-v1")).toHaveCount(1);
      await expect(page.locator(".circle-marker")).toHaveCount(0);
      await expectCardLayout(page);
      await expect(page.locator(".field-lease-more-v1")).toHaveText("외 1개 더 보기");
      expect(await preserved(page)).toEqual(baseline);

      await toggle.click();
      await expectSingleFieldControl(page, toggle, 30);
      expect(await page.evaluate(() => map.getLevel())).toBe(2);
      await expect(page.locator("#fixtureSdkCredits")).toContainText("30m");
      await expectCardLayout(page);
      await page.screenshot({path: testInfo.outputPath(device.name + "-30m.png")});
      await toggle.click();
      await expectSingleFieldControl(page, toggle, 50);
      await expect(page.locator(".field-lease-card-v1")).toHaveCount(0);
      await expect(page.locator(".circle-marker")).toHaveCount(1);
      expect(await page.evaluate(() => JSFieldModeV1.state().enabled)).toBe(true);
      expect(await preserved(page)).toEqual(baseline);
      await toggle.click();
      await expectSingleFieldControl(page, toggle, 20);
      await expect(page.locator(".field-lease-card-v1")).toHaveCount(1);
      await expect(page.locator(".circle-marker")).toHaveCount(0);

      // The map button opens the real existing detail. Dispatching the second
      // button event checks the same public toggle even if a phone sheet covers it.
      await page.locator(".field-lease-row-v1").first().click();
      await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-1"))).toBe(true);
      await page.locator(".field-lease-row-v1").first().dispatchEvent("click");
      await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-1"))).toBe(false);
      expect(await page.evaluate(() => selectedItemKey)).toBe("fixture-lease-1");
      expect(await preserved(page)).toEqual(baseline);

      await page.locator(".field-lease-more-v1").click();
      await expect(page.locator("#list .item")).toHaveCount(4);
      await expect(page.locator("#status")).toHaveText("선택 매물 4개");
      if (compact) await page.locator('[data-mobile-view="map"]').click();
      await expect(toggle).toBeVisible();
      expect(await preserved(page)).toEqual(baseline);

      // Real heading camera: the map turns westward while two-line card text
      // stays horizontal, including its actual screen-space line geometry.
      await page.evaluate(() => __leaseFixture.fix(90, 4));
      await expect.poll(() => page.evaluate(() => JSFieldMapCameraV1.state().bearing)).toBe(90);
      await expectSingleFieldControl(page, toggle, 20);
      await expectCardLayout(page);
      const rotations = await page.locator(".field-lease-card-v1").evaluate(card => {
        const surface = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("jsFieldMapSurfaceV1")).transform);
        return {map: Math.atan2(surface.b, surface.a) * 180 / Math.PI,
          anchor: parseFloat(getComputedStyle(card.closest(".field-lease-anchor-v1")).rotate),
          card: getComputedStyle(card).rotate};
      });
      expect(Math.abs(rotations.map + rotations.anchor)).toBeLessThan(.01);
      expect(rotations.card).toBe("none");
      await page.screenshot({path: testInfo.outputPath(device.name + "-heading-up.png")});
      expect(await preserved(page)).toEqual(baseline);
      expect(await page.evaluate(() => __leaseFixture.state.watchCalls)).toBe(1);

      // Only this loopback fixture changes: long money must grow beyond the
      // ordinary compact card without clipping, wrapping or becoming taller.
      const originalAmounts = await page.evaluate(() => {
        const first = allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
        const original = {deposit: first.deposit, rent: first.rent};
        Object.assign(first, {deposit: 123456.78, rent: 123.45});
        applyFilter();
        return original;
      });
      const longRow = page.locator(".field-lease-row-v1").filter({hasText: "보 123,456.78 / 월 123.45"});
      await expect(longRow).toHaveCount(1);
      expect((await expectCompactRowGeometry(longRow, 210)).width).toBeGreaterThan(120);
      await page.screenshot({path: testInfo.outputPath(device.name + "-long-money.png")});
      await page.evaluate(original => {
        Object.assign(allItems.find(item => item.propertyId === "FIXTURE-LEASE-1"), original);
        applyFilter();
      }, originalAmounts);
      await expectCardLayout(page);
      expect(await preserved(page)).toEqual(baseline);

      await toggle.click({delay: 3100});
      await expectSingleFieldControl(page, toggle, null);
      await expect(page.locator(".field-lease-card-v1")).toHaveCount(0);
      await expect(page.locator(".circle-marker")).toHaveCount(1);
      await expect(page.locator("#jsFieldMapSurfaceV1")).toHaveCSS("transform", "none");
      expect(await preserved(page)).toEqual(baseline);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
      expect(forbidden).toEqual([]);
    } finally { await context.close(); }
  });
}

test("switching from a pinned building to another lease row survives GPS rendering", async ({browser, baseURL}, testInfo) => {
  const context = await browser.newContext({serviceWorkers: "block", isMobile: true, hasTouch: true,
    userAgent: tabletUA, viewport: {width: 1280, height: 800}, screen: {width: 1280, height: 800}});
  const errors = [], forbidden = [];
  try {
    await context.route("**/*", route => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1" || route.request().method() !== "GET") {
        forbidden.push(route.request().method() + " " + route.request().url()); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL);
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
    await installBoundary(page);
    await page.evaluate(() => {
      const second = allItems.find(item => item.propertyId === "FIXTURE-LEASE-2");
      second.address = "대전 서구 괴정동 2-2";
      second.latlng = new kakao.maps.LatLng(36.3497, 127.3802);
      favoriteKeys.push("property:" + second.propertyId);
      favoriteFilterKeys = favoriteKeys.slice();
      applyFilter();
    });
    const baseline = await preserved(page);
    const toggle = page.locator("#mapFieldModeToggleV1");
    await toggle.click();
    await expectSingleFieldControl(page, toggle, 20);
    await expect(page.locator(".field-lease-card-v1")).toHaveCount(2);
    const secondRow = page.locator(".field-lease-row-v1").filter({hasText: "보 3,000 / 월 150"});
    const singleGeometry = await expectCompactRowGeometry(secondRow);
    await testInfo.attach("lease-single-card-geometry.json", {
      body: Buffer.from(JSON.stringify(singleGeometry, null, 2)), contentType: "application/json"
    });
    await secondRow.locator("..").screenshot({path: testInfo.outputPath("lease-single-card-example.png")});
    await page.locator(".field-lease-more-v1").click();
    await expect(page.locator("#list .item")).toHaveCount(4);
    expect(await page.evaluate(() => getPinnedClusterItemsV6515().map(item => item.propertyId).sort())).toEqual(
      ["FIXTURE-LEASE-1", "FIXTURE-SAME-2", "FIXTURE-SAME-3", "FIXTURE-SAME-4"]);
    await secondRow.click();
    await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-2"))).toBe(true);
    await expect(page.locator("#list .item")).toHaveCount(1);
    await page.evaluate(() => __leaseFixture.fix(90, 4));
    await expect.poll(() => page.evaluate(() => JSFieldMapCameraV1.state().bearing)).toBe(90);
    // Observe a completed real idle refresh, not only the immediate click state.
    await expect.poll(() => page.evaluate(() => jsMapIdleTimerV638)).toBe(null);
    await expectSingleFieldControl(page, toggle, 20);
    expect(await page.evaluate(() => getPinnedClusterItemsV6515().map(item => item.propertyId))).toEqual(["FIXTURE-LEASE-2"]);
    expect(await page.evaluate(() => selectedItemKey)).toBe("fixture-lease-2");
    await expect(secondRow).toHaveClass(/selected/);
    await expectCompactRowGeometry(secondRow);
    await expect(page.locator("#list .item")).toContainText("2층");
    expect(await preserved(page)).toEqual(baseline);
    await page.evaluate(() => JSUnifiedListingsV8.close());
    await page.screenshot({path: testInfo.outputPath("tablet-building-switch-after-gps.png")});
    expect(errors).toEqual([]);
    expect(forbidden).toEqual([]);
  } finally { await context.close(); }
});

async function installNearbyAddresses(page) {
  await page.evaluate(() => {
    const first = allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
    // Three distinct ground points only 2-8px apart at 20m. All four rooms
    // belonging to the first address retain one shared, exact coordinate.
    allItems.filter(item => item.address === first.address).forEach(item => {
      item.latlng = new kakao.maps.LatLng(36.35, 127.37993);
    });
    const second = allItems.find(item => item.propertyId === "FIXTURE-LEASE-2");
    Object.assign(second, {address: "대전 서구 괴정동 2-2", latlng: new kakao.maps.LatLng(36.350005, 127.379945)});
    const third = {...first, propertyId: "FIXTURE-NEARBY-3", key: "fixture-nearby-3", address: "대전 서구 괴정동 3-3",
      room: "3층", deposit: 4000, rent: 120, latlng: new kakao.maps.LatLng(36.349995, 127.37995)};
    allItems.push(third);
    favoriteKeys.push("property:" + second.propertyId, "property:" + third.propertyId);
    favoriteFilterKeys = favoriteKeys.slice();
    applyFilter();
  });
}

async function originalCoordinates(page) {
  return page.evaluate(() => allItems.filter(item => item.latlng).map(item =>
    [item.propertyId, item.latlng.getLat(), item.latlng.getLng()]));
}

async function nearbyGeometry(page) {
  return page.evaluate(() => {
    const viewport = document.getElementById("map"), mapBox = viewport.getBoundingClientRect();
    const surface = document.getElementById("jsFieldMapSurfaceV1"), style = getComputedStyle(surface);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const origin = style.transformOrigin.split(" ").map(parseFloat);
    const boxOf = element => {
      const b = element.getBoundingClientRect();
      return {left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height};
    };
    const screenPoint = (svg, x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
      return {x: p.x, y: p.y};
    };
    const toolRail = boxOf(document.getElementById("mapQuickTools"));
    const railLeft = toolRail.left - mapBox.left;
    const layoutWidth = toolRail.width > 0 && toolRail.height > 0 && railLeft > viewport.clientWidth / 2 && railLeft < viewport.clientWidth
      ? railLeft - 4 : viewport.clientWidth;
    return {map: boxOf(viewport), toolRail, viewport: {width: viewport.clientWidth, height: viewport.clientHeight}, layoutWidth,
      cards: overlays.filter(overlay => overlay.__cluster?.fieldLease).map(overlay => {
      const cluster = overlay.__cluster;
      const anchor = Array.from(viewport.querySelectorAll(".field-lease-anchor-v1")).find(node =>
        node.dataset.fieldLeaseKey === encodeURIComponent(cluster.key));
      const card = anchor.querySelector(".field-lease-card-v1"), dot = anchor.querySelector(".field-lease-location-v1");
      const svg = anchor.querySelector(".field-lease-leader-v1"), line = anchor.querySelector(".field-lease-connector-v1");
      const tail = anchor.querySelector(".field-lease-tail-v1");
      const raw = map.getProjection().containerPointFromCoords(cluster.latlng);
      // Independent of the application's camera.projection/planLayout: derive
      // the ground point from SDK coordinates and the actual CSS transform.
      const projected = matrix.transformPoint(new DOMPoint(raw.x - origin[0], raw.y - origin[1]));
      const expected = {x: mapBox.left + viewport.clientLeft + surface.offsetLeft + origin[0] + projected.x,
        y: mapBox.top + viewport.clientTop + surface.offsetTop + origin[1] + projected.y};
      const dotBox = dot.getBoundingClientRect();
      const endpoint = screenPoint(svg, line.x2.baseVal.value, line.y2.baseVal.value);
      const start = screenPoint(svg, line.x1.baseVal.value, line.y1.baseVal.value);
      const tailTip = tail.getPointAtLength(tail.getTotalLength() / 2);
      const point = overlay.getPosition();
      return {key: cluster.key, count: cluster.items.length, card: boxOf(card), anchor: boxOf(anchor),
        layoutRow: {key: anchor.dataset.fieldLeaseKey, point: getMapDisplayProjectionV1().containerPointFromCoords(cluster.latlng),
          width: card.offsetWidth, height: card.offsetHeight, selected: card.classList.contains("selected"),
          previous: {x: parseFloat(card.style.left), y: parseFloat(card.style.top)}},
        position: [point.getLat(), point.getLng()], cluster: [cluster.latlng.getLat(), cluster.latlng.getLng()],
        items: cluster.items.map(item => [item.latlng.getLat(), item.latlng.getLng()]), expected,
        dot: {x: dotBox.left + dotBox.width / 2, y: dotBox.top + dotBox.height / 2}, endpoint, start,
        tailTip: screenPoint(svg, tailTip.x, tailTip.y),
        decorative: [anchor, svg, line, tail, dot].map(element => getComputedStyle(element).pointerEvents),
        cardPointer: getComputedStyle(card).pointerEvents, cardRotate: getComputedStyle(card).rotate,
        rendered: card.style.transform === "none"};
    })};
  });
}

async function expectNearbyGeometry(page) {
  // SDK scale/center events schedule the real idle redraw. Inspect its settled
  // placements, not the old card offset during the intervening map movement.
  await expect.poll(() => page.evaluate(() => jsMapIdleTimerV638)).toBe(null);
  await expect(page.locator(".field-lease-anchor-v1")).toHaveCount(3);
  await expect.poll(() => page.locator(".field-lease-card-v1").evaluateAll(cards =>
    cards.length === 3 && cards.every(card => card.style.transform === "none"))).toBe(true);
  await expect.poll(() => page.evaluate(() => JSFieldMapCameraV1.state().animating)).toBe(false);
  const geometry = await nearbyGeometry(page);
  // Retain exact measured inputs even on a failed assertion so the pure layout
  // solver can gain a deterministic unit regression without a browser fixture.
  await writeFile(test.info().outputPath("nearby-layout-inputs.json"), JSON.stringify({
    width: geometry.layoutWidth, height: geometry.viewport.height, rows: geometry.cards.map(card => card.layoutRow), geometry
  }, null, 2));
  expect(geometry.cards.map(card => card.count).sort()).toEqual([1, 1, 4]);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const entry of geometry.cards) {
    expect(entry.anchor.width).toBe(0);
    expect(entry.anchor.height).toBe(0);
    expect(entry.position).toEqual(entry.cluster);
    for (const coords of entry.items) expect(coords).toEqual(entry.cluster);
    expect(distance(entry.dot, entry.expected)).toBeLessThan(2);
    expect(distance(entry.endpoint, entry.dot)).toBeLessThan(1);
    expect(distance(entry.start, entry.tailTip)).toBeLessThan(1);
    expect(entry.decorative).toEqual(["none", "none", "none", "none", "none"]);
    expect(entry.cardPointer).toBe("auto");
    expect(entry.cardRotate).toBe("none");
    expect(entry.card.left).toBeGreaterThanOrEqual(geometry.map.left + 7);
    expect(entry.card.top).toBeGreaterThanOrEqual(geometry.map.top + 7);
    expect(entry.card.right).toBeLessThanOrEqual(geometry.map.right - 7);
    expect(entry.card.bottom).toBeLessThanOrEqual(geometry.map.bottom - 7);
    if (geometry.toolRail.width > 0 && geometry.toolRail.height > 0) {
      const a = entry.card, b = geometry.toolRail;
      const railOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      expect(railOverlap, "A fixed map control must not cover the listing text").toBeLessThan(1);
    }
  }
  for (let i = 0; i < geometry.cards.length; i += 1) {
    for (let j = i + 1; j < geometry.cards.length; j += 1) {
      const a = geometry.cards[i].card, b = geometry.cards[j].card;
      const intersection = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      expect(intersection, JSON.stringify({a, b})).toBeLessThan(1);
    }
  }
  return geometry;
}

const nearbyDevices = [
  {name: "phone-740", portrait: {width: 360, height: 740}, landscape: {width: 740, height: 360}, userAgent: phoneUA},
  {name: "phone-844", portrait: {width: 390, height: 844}, landscape: {width: 844, height: 390}, userAgent: phoneUA},
  {name: "tablet-1280", portrait: {width: 820, height: 1280}, landscape: {width: 1280, height: 820}, userAgent: tabletUA}
];
for (const device of nearbyDevices) test(`${device.name}: nearby cards keep real anchors through scale, GPS and rotation`, async ({browser, baseURL}, testInfo) => {
  const context = await browser.newContext({serviceWorkers: "block", isMobile: true, hasTouch: true,
    userAgent: device.userAgent, viewport: device.portrait, screen: device.portrait, deviceScaleFactor: 1});
  const errors = [], forbidden = [];
  try {
    await context.route("**/*", route => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1" || route.request().method() !== "GET") {
        forbidden.push(route.request().method() + " " + route.request().url()); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL);
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
    await installBoundary(page);
    await installNearbyAddresses(page);
    await expect(page.locator("#list .item")).toHaveCount(6);
    const baseline = await preserved(page), coordinates = await originalCoordinates(page);
    await expect(page.locator(".field-lease-anchor-v1")).toHaveCount(0);
    const normalCount = await page.locator(".circle-marker").count();
    expect(normalCount).toBeGreaterThan(0);
    const compactToggle = page.locator("#mapFieldModeCompactToggleV1");
    await compactToggle.click();
    await expectSingleFieldControl(page, compactToggle, 20);
    await expectNearbyGeometry(page);
    await page.locator(".field-lease-more-v1").click();
    await expect(page.locator("#list .item")).toHaveCount(4);
    await expect(page.locator("#status")).toHaveText("선택 매물 4개");
    await page.locator('[data-mobile-view="map"]').click();
    const secondRow = page.locator(".field-lease-row-v1").filter({hasText: "보 3,000 / 월 150"});
    await secondRow.click();
    await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-2"))).toBe(true);
    await expect(page.locator("#list .item")).toHaveCount(1);
    await page.getByRole("button", {name: "상세매물보기 닫기", exact: true}).click();
    await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-2"))).toBe(false);
    await page.locator('[data-mobile-view="map"]').click();
    expect(await page.evaluate(() => selectedItemKey)).toBe("fixture-lease-2");
    await expectNearbyGeometry(page);
    await compactToggle.click();
    await expectSingleFieldControl(page, compactToggle, 30);
    await expectNearbyGeometry(page);
    await page.evaluate(() => __leaseFixture.fix(90, 4, {latitude: 36.35002, longitude: 127.38001}));
    await expect.poll(() => page.evaluate(() => JSFieldMapCameraV1.state().bearing)).toBe(90);
    await expect.poll(() => page.evaluate(() => jsMapIdleTimerV638)).toBe(null);
    await expectNearbyGeometry(page);
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {...device.landscape, screenWidth: device.landscape.width,
      screenHeight: device.landscape.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "landscapePrimary", angle: 90}});
    await expect(page.locator("html")).toHaveClass(/js-handheld-landscape-v1/);
    await expect(page.locator("html")).not.toHaveClass(/js-phone-app-v2|js-mobile-app-v1/);
    await expect.poll(() => page.evaluate(() => jsMapIdleTimerV638)).toBe(null);
    await expectNearbyGeometry(page);
    // Exercise the displaced cards after a real rotation as well: neither
    // the connector nor another card may swallow the actual pointer click.
    await page.locator(".field-lease-more-v1").click();
    await expect(page.locator("#list .item")).toHaveCount(4);
    await secondRow.click();
    await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-2"))).toBe(true);
    await expect(page.locator("#list .item")).toHaveCount(1);
    await page.getByRole("button", {name: "상세매물보기 닫기", exact: true}).click();
    await expect.poll(() => page.evaluate(() => JSUnifiedListingsV8.isOpenForProperty("FIXTURE-LEASE-2"))).toBe(false);
    await page.locator("#unifiedDetailDrawerV8").evaluate(element =>
      Promise.all(element.getAnimations({subtree: true}).map(animation => animation.finished)));
    const landscapeGeometry = await expectNearbyGeometry(page);
    await testInfo.attach("landscape-anchor-geometry.json", {body: Buffer.from(JSON.stringify(landscapeGeometry, null, 2)), contentType: "application/json"});
    const screenshot = await session.send("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
    await writeFile(testInfo.outputPath("nearby-anchors-landscape.png"), Buffer.from(screenshot.data, "base64"));
    await session.send("Emulation.setDeviceMetricsOverride", {...device.portrait, screenWidth: device.portrait.width,
      screenHeight: device.portrait.height, mobile: true, deviceScaleFactor: 1, screenOrientation: {type: "portraitPrimary", angle: 0}});
    await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
    await expect.poll(() => page.evaluate(() => jsMapIdleTimerV638)).toBe(null);
    await expectNearbyGeometry(page);
    await page.screenshot({path: testInfo.outputPath("nearby-anchors-portrait.png")});
    expect(await originalCoordinates(page)).toEqual(coordinates);
    expect(await preserved(page)).toEqual(baseline);
    expect(await page.evaluate(() => __leaseFixture.state.watchCalls)).toBe(1);
    await compactToggle.click();
    await expectSingleFieldControl(page, compactToggle, 50);
    await expect(page.locator(".field-lease-anchor-v1,.field-lease-location-v1,.field-lease-leader-v1")).toHaveCount(0);
    await expect(page.locator(".circle-marker")).toHaveCount(normalCount);
    await compactToggle.click({delay: 3100});
    await expectSingleFieldControl(page, compactToggle, null);
    await expect(page.locator(".field-lease-anchor-v1,.field-lease-location-v1,.field-lease-leader-v1")).toHaveCount(0);
    await expect(page.locator(".circle-marker")).toHaveCount(normalCount);
    expect(await preserved(page)).toEqual(baseline);
    expect(errors).toEqual([]);
    expect(forbidden).toEqual([]);
  } finally { await context.close(); }
});
