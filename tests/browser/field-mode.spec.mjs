import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

// Only the external Kakao/GPS boundary is synthetic. Load the production
// controller and its actual map.js location callbacks into the loopback app.
const mapSource = await readFile(new URL("../../js/map.js", import.meta.url), "utf8");
const locationStart = mapSource.indexOf("function updateCurrentLocationOverlayV630(");
const locationEnd = mapSource.indexOf("function groupByAddress(", locationStart);
if (locationStart < 0 || locationEnd < 0) throw new Error("Map location callbacks are missing");
const locationSource = mapSource.slice(locationStart, locationEnd);

const tabletUA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const ipadUA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const phoneUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const devices = [
  {name: "tablet landscape 1280", width: 1280, height: 800, screenWidth: 1280, screenHeight: 800, userAgent: tabletUA},
  {name: "tablet portrait 768", width: 768, height: 1024, screenWidth: 768, screenHeight: 1024, userAgent: ipadUA},
  {name: "tablet split 600", width: 600, height: 900, screenWidth: 820, screenHeight: 1280, userAgent: tabletUA},
  {name: "phone portrait 390", width: 390, height: 844, screenWidth: 390, screenHeight: 844, userAgent: phoneUA, phone: true}
];

test.beforeEach(({isMobile}, testInfo) => {
  test.skip(isMobile || testInfo.project.name !== "desktop", "Dedicated touch-device contexts run once from the desktop project.");
});

async function installMapBoundary(page) {
  await page.evaluate(() => {
    const listeners = new Map();
    const overlays = new Set();
    const state = {watchCalls: 0, centerCalls: 0, levelCalls: 0, markerMoves: 0, positionCallback: null};
    function LatLng(lat, lng) { this.getLat = () => lat; this.getLng = () => lng; }
    function emit(type) { for (const listener of listeners.get(type) || []) listener(); }
    const map = Object.assign({}, window.map, {
      center: new LatLng(36.34, 127.38), level: 5, draggable: true, zoomable: true,
      getCenter() { return this.center; },
      getLevel() { return this.level; },
      getDraggable() { return this.draggable; },
      getZoomable() { return this.zoomable; },
      setDraggable(value) { this.draggable = value; },
      setZoomable(value) { this.zoomable = value; },
      setCenter(point) {
        this.center = point; state.centerCalls += 1;
        for (const overlay of overlays) overlay.render();
        emit("center_changed"); emit("idle");
      },
      setLevel(level) { this.level = level; state.levelCalls += 1; emit("zoom_changed"); emit("idle"); },
      panTo(point) { this.setCenter(point); },
      relayout() { for (const overlay of overlays) overlay.render(); }
    });
    function CustomOverlay(settings) {
      this.content = settings.content;
      this.position = settings.position;
      this.owner = null;
      this.render = () => {
        if (!this.owner) return;
        const point = this.position;
        Object.assign(this.content.style, {
          position: "absolute", zIndex: String(settings.zIndex),
          left: "calc(50% + " + ((point.getLng() - map.center.getLng()) * 100000) + "px)",
          top: "calc(50% - " + ((point.getLat() - map.center.getLat()) * 100000) + "px)",
          transform: "translate(" + (-settings.xAnchor * 100) + "%, " + (-settings.yAnchor * 100) + "%)"
        });
      };
      this.setPosition = (point) => { this.position = point; state.markerMoves += 1; this.render(); };
      this.getPosition = () => this.position;
      this.getContent = () => this.content;
      this.setMap = (owner) => {
        this.owner = owner;
        if (owner) { document.getElementById("map").appendChild(this.content); overlays.add(this); this.render(); }
        else { this.content.remove(); overlays.delete(this); }
      };
    }
    window.map = map;
    window.kakao = {maps: {LatLng, CustomOverlay, event: {
      addListener(target, type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      },
      trigger(target, type) { emit(type); }
    }}};
    Object.defineProperty(navigator, "geolocation", {configurable: true, value: {
      watchPosition(success) { state.watchCalls += 1; state.positionCallback = success; return 101; }
    }});
    window.__fieldFixture = {
      state,
      fix(lat, lng, accuracy = 8, motion = {}) {
        if (!state.positionCallback) throw new Error("Production GPS watcher was not started");
        state.positionCallback({coords: {latitude: lat, longitude: lng, accuracy, ...motion}, timestamp: Date.now()});
      }
    };
    document.getElementById("map").style.position = "relative";
  });
  await page.addScriptTag({content: "var jsCurrentLocationOverlayV630 = null; var jsCurrentLocationWatchIdV630 = null;\n" + locationSource});
  await page.addScriptTag({url: "/js/map-field-mode-v1.js"});
  await page.addScriptTag({url: "/js/map-quick-tools-v657.js"});
  await page.evaluate(() => window.syncMapQuickToolGeometryV659());
}

async function preservedState(page) {
  return page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll("#list .item")).map((item) => item.textContent),
    filters: ["keyword", "sourceFilter", "typeFilter", "minRent", "maxRent", "sortFilter"].map((id) => [id, document.getElementById(id)?.value]),
    selectedItemKey: window.selectedItemKey,
    favoriteOnly: window.favoriteOnly,
    activeFavoriteFolderId: window.activeFavoriteFolderId,
    favoriteKeys: window.favoriteKeys
  }));
}

async function cameraState(page) {
  return page.evaluate(() => ({
    center: [window.map.getCenter().getLat(), window.map.getCenter().getLng()],
    level: window.map.getLevel(),
    draggable: window.map.getDraggable(), zoomable: window.map.getZoomable(),
    position: window.jsCurrentLocationOverlayV630 && [window.jsCurrentLocationOverlayV630.getPosition().getLat(), window.jsCurrentLocationOverlayV630.getPosition().getLng()],
    watchCalls: window.__fieldFixture.state.watchCalls,
    centerCalls: window.__fieldFixture.state.centerCalls,
    markerMoves: window.__fieldFixture.state.markerMoves
  }));
}

async function expectWithinMap(page, selector) {
  const bounds = await page.locator(selector).boundingBox();
  const map = await page.locator("#map").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(map.x - 1);
  expect(bounds.y).toBeGreaterThanOrEqual(map.y - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(map.x + map.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(map.y + map.height + 1);
}

async function expectCarCentered(page) {
  const carBounds = await page.locator(".js-current-location-dot-v630").boundingBox();
  const mapBounds = await page.locator("#map").boundingBox();
  expect(carBounds).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  expect(carBounds.width).toBe(36);
  expect(carBounds.height).toBe(44);
  expect(Math.abs(carBounds.x + carBounds.width / 2 - mapBounds.x - mapBounds.width / 2)).toBeLessThan(1);
  expect(Math.abs(carBounds.y + carBounds.height / 2 - mapBounds.y - mapBounds.height / 2)).toBeLessThan(1);
}

async function expectCarHeading(page, heading) {
  await expect.poll(() => page.locator(".js-field-mode-car-icon-v1").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    return (Math.round(angle) + 360) % 360;
  })).toBe(heading);
}

async function expectPopupAreaReleased(page, bounds) {
  const point = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 8};
  const hit = await page.evaluate(({x, y}) => {
    const target = document.elementFromPoint(x, y);
    return {
      exists: !!target,
      fieldControls: !!target?.closest("[data-field-mode-controls]"),
      fieldWrapper: !!target?.closest(".map-field-mode-wrap-v1, .map-field-mode-compact-v1")
    };
  }, point);
  expect(hit).toEqual({exists: true, fieldControls: false, fieldWrapper: false});
}

for (const device of devices) {
  test(`${device.name}: real GPS following, scales and OFF preserve map workflow`, async ({browser, baseURL}, testInfo) => {
    const context = await browser.newContext({
      serviceWorkers: "block", isMobile: true, hasTouch: true, userAgent: device.userAgent,
      viewport: {width: device.width, height: device.height},
      screen: {width: device.screenWidth, height: device.screenHeight}
    });
    try {
      await context.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      const apiRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/data") apiRequests.push(request.url()); });
      await page.goto(baseURL);
      await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
      await page.locator("#fixtureControls").evaluate((element) => { element.style.display = "none"; });
      await installMapBoundary(page);
      if (device.phone) await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
      else await expect(page.locator("html")).not.toHaveClass(/js-phone-app-v2/);
      if (device.width === 1280) {
        // Touch-landscape CSS must honor the modal's closed state. Opening only
        // its shell avoids loading external roadview imagery in this fixture.
        const roadview = page.locator("#roadviewModal");
        await expect(roadview).toBeHidden();
        await roadview.evaluate((element) => { element.classList.add("open"); element.setAttribute("aria-hidden", "false"); });
        await expect(roadview).toBeVisible();
        await roadview.locator(".roadview-modal-close").click();
        await expect(roadview).toBeHidden();
      }

      const compact = device.width <= 768;
      const toggle = page.locator(compact ? "#mapFieldModeCompactToggleV1" : "#mapFieldModeToggleV1");
      const panel = page.locator(compact ? "#mapFieldModeCompactControlsV1" : "#mapFieldModeControlsV1");
      const expander = page.locator(`[data-field-mode-expand][aria-controls="${compact ? "mapFieldModeCompactControlsV1" : "mapFieldModeControlsV1"}"]`);
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(panel).toBeHidden();
      await expect(expander).toBeHidden();
      await expectWithinMap(page, compact ? "#mapFieldModeCompactV1" : "#mapFieldModeToggleV1");

      // Seed a real filtered list and selection before camera movement.
      await page.evaluate(() => {
        document.getElementById("keyword").value = "괴정";
        const mobileKeyword = document.getElementById("jsMobileKeywordV1");
        if (mobileKeyword) mobileKeyword.value = "괴정";
        document.getElementById("sourceFilter").value = "naver";
        window.applyFilter();
        window.selectedItemKey = window.allItems[0].key;
        window.startCurrentLocationTrackingV630();
        window.__fieldFixture.fix(36.3504, 127.3845);
      });
      await expect(page.locator("#list .item")).toHaveCount(1);
      const before = await preservedState(page);
      const apiBaseline = apiRequests.length;
      const dot = page.locator(".js-current-location-dot-v630");
      await expect(dot).toHaveCSS("background-color", "rgb(123, 44, 255)");

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(panel).toBeVisible();
      await expect(expander).toBeVisible();
      await expect(expander).toHaveText("50m ▾");
      await expect(expander).toHaveAttribute("aria-expanded", "true");
      await expect(panel.locator("[data-field-mode-status]")).toHaveText("내 위치 따라가는 중");
      await expectWithinMap(page, compact ? "#mapFieldModeCompactControlsV1" : "#mapFieldModeControlsV1");
      await expect(dot).toHaveClass(/js-field-mode-car-v1/);
      await expect(dot.locator("[data-field-car-body]")).toHaveAttribute("fill", "#dc2626");
      await expect(dot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await cameraState(page)).toMatchObject({center: [36.3504, 127.3845], position: [36.3504, 127.3845], level: 3, draggable: false, zoomable: false, watchCalls: 1});

      const initialPanelBounds = await panel.boundingBox();
      await expect(panel).toBeHidden({timeout: 4500});
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(expander).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({enabled: true, controlsOpen: false, scale: 50});
      await expectPopupAreaReleased(page, initialPanelBounds);
      await expander.click();
      await expect(panel).toBeVisible();
      const selectionPanelBounds = await panel.boundingBox();
      await panel.locator('[data-field-mode-scale="20"]').click();
      expect((await cameraState(page)).level).toBe(1);
      await expect(panel).toBeHidden();
      await expect(expander).toHaveText("20m ▾");
      await expect(expander).toHaveAttribute("aria-expanded", "false");
      await expectPopupAreaReleased(page, selectionPanelBounds);
      await expect(panel.locator('[data-field-mode-scale="20"]')).toHaveAttribute("aria-pressed", "true");
      await expander.click();
      await expect(panel).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect((await cameraState(page)).watchCalls).toBe(1);
      await panel.locator('[data-field-mode-scale="50"]').click();
      expect((await cameraState(page)).level).toBe(3);
      await expect(panel).toBeHidden();
      await expect(expander).toHaveText("50m ▾");
      await expect(panel.locator('[data-field-mode-scale="50"]')).toHaveAttribute("aria-pressed", "true");

      await expander.click();
      await expect(panel).toBeVisible();
      const keyboardChoice = panel.locator('[data-field-mode-scale="20"]');
      await keyboardChoice.focus();
      await page.waitForTimeout(3100);
      await expect(panel).toBeVisible();
      await keyboardChoice.press("Escape");
      await expect(panel).toBeHidden();
      await expect(expander).toBeFocused();
      await expander.click();
      await expect(panel).toBeVisible();
      await page.locator("#map").dispatchEvent("pointerdown");
      await expect(panel).toBeHidden();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");

      // A small stationary jitter must not move either the camera or the car.
      const steady = await cameraState(page);
      await page.evaluate(() => {
        for (let index = 0; index < 12; index += 1) window.__fieldFixture.fix(36.350405, 127.384505);
      });
      await page.waitForTimeout(1050);
      expect(await cameraState(page)).toEqual(steady);

      // A burst of real movement settles at the newest fix without API reads.
      await page.evaluate(() => {
        for (let index = 1; index <= 12; index += 1) window.__fieldFixture.fix(36.3504 + index * 0.0001, 127.3845 + index * 0.0001);
      });
      await expect.poll(async () => (await cameraState(page)).center[0]).toBeCloseTo(36.3516, 7);
      const moved = await cameraState(page);
      expect(moved.position[0]).toBeCloseTo(36.3516, 7);
      expect(moved.position[1]).toBeCloseTo(127.3857, 7);
      await expectCarCentered(page);
      expect(apiRequests.length).toBe(apiBaseline);
      expect(await preservedState(page)).toEqual(before);
      await expect(panel).toBeHidden();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({path: testInfo.outputPath("field-mode-on.png")});

      if (compact) {
        await page.locator('[data-mobile-view="list"]').click();
        await expect(page.locator("#mapFieldModeCompactV1")).toBeHidden();
        await expect(page.locator("#list .item")).toHaveCount(1);
        await expect(page.locator("#list")).toContainText("괴정");
        await page.locator("#sidebar").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        await page.screenshot({path: testInfo.outputPath("field-mode-list.png")});
        await page.locator('[data-mobile-view="map"]').click();
        await expect(toggle).toBeVisible();
        expect(await preservedState(page)).toEqual(before);
      }

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(panel).toBeHidden();
      await expect(expander).toBeHidden();
      await expect(dot).not.toHaveClass(/js-field-mode-car-v1/);
      await expect(dot.locator("svg")).toHaveCount(0);
      await expect(dot).toHaveCSS("background-color", "rgb(123, 44, 255)");
      expect(await cameraState(page)).toMatchObject({draggable: true, zoomable: true, watchCalls: 1});
      await page.evaluate(() => {
        window.map.setCenter(new window.kakao.maps.LatLng(36.34, 127.38));
        window.map.setLevel(6);
        window.__fieldFixture.fix(36.3517, 127.3858);
      });
      await page.waitForTimeout(30);
      expect(await cameraState(page)).toMatchObject({center: [36.34, 127.38], level: 6, position: [36.3517, 127.3858]});
      expect(await preservedState(page)).toEqual(before);
      expect(apiRequests.length).toBe(apiBaseline);

      // Existing filter and favorite surfaces still open after field mode.
      const filter = page.locator(compact ? '#jsMobileSearchFormV1 [data-mobile-action="filter"]' : "#detailBtn");
      await filter.click();
      await expect(page.locator(".v6-detail-sheet")).toBeVisible();
      await page.screenshot({path: testInfo.outputPath("field-mode-filter.png")});
      await page.locator(".v6-detail-sheet-close").click();
      await expect(page.locator("#keyword")).toHaveValue("괴정");
      await expect(page.locator("#sourceFilter")).toHaveValue("naver");
      await page.evaluate(() => window.openListManager("favorite"));
      await expect(page.locator("#unifiedFavoriteModalV7")).toHaveClass(/open/);
      await expect(page.locator("#unifiedFavoriteModalV7")).toContainText("테스트 찜폴더");
      if (device.phone) await expect(page.locator("#mapFieldModeCompactV1")).toBeHidden();
      await page.screenshot({path: testInfo.outputPath("field-mode-favorites.png")});
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test("GPS course turns the centered car through cardinal directions and restores the dot on OFF", async ({browser, baseURL}, testInfo) => {
  const context = await browser.newContext({
    serviceWorkers: "block", isMobile: true, hasTouch: true, userAgent: tabletUA,
    viewport: {width: 1280, height: 800}, screen: {width: 1280, height: 800}, reducedMotion: "no-preference"
  });
  try {
    await context.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    const apiRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/data") apiRequests.push(request.url()); });
    await page.goto(baseURL);
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
    await page.locator("#fixtureControls").evaluate((element) => { element.style.display = "none"; });
    await installMapBoundary(page);
    await page.evaluate(() => {
      window.startCurrentLocationTrackingV630();
      window.__fieldFixture.fix(36.3504, 127.3845, 8, {heading: null, speed: 0});
    });
    const apiBaseline = apiRequests.length;
    const toggle = page.locator("#mapFieldModeToggleV1");
    const dot = page.locator(".js-current-location-dot-v630");
    const icon = dot.locator(".js-field-mode-car-icon-v1");
    await toggle.click();
    await expect(dot.locator(".js-field-mode-heading-pending-v1")).toHaveText("방향 확인 중");
    await expect(dot.locator(".js-field-mode-heading-pending-v1")).toBeVisible();
    expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({heading: null, headingSource: ""});
    await expectCarCentered(page);
    await page.screenshot({path: testInfo.outputPath("field-heading-pending.png")});

    const courses = [
      {name: "north", heading: 0, lat: 36.3514, lng: 127.3845},
      {name: "east", heading: 90, lat: 36.3514, lng: 127.3855},
      {name: "south", heading: 180, lat: 36.3504, lng: 127.3855},
      {name: "west", heading: 270, lat: 36.3504, lng: 127.3845}
    ];
    for (const course of courses) {
      await page.evaluate(({lat, lng, heading}) => window.__fieldFixture.fix(lat, lng, 8, {heading, speed: 4}), course);
      await expect.poll(() => page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(course.heading);
      await expectCarHeading(page, course.heading);
      expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({heading: course.heading, headingSource: "gps"});
      await expect.poll(async () => (await cameraState(page)).center).toEqual([course.lat, course.lng]);
      await expect(dot).toHaveClass(/js-field-mode-heading-known-v1/);
      await expect(dot.locator(".js-field-mode-heading-pending-v1")).toBeHidden();
      await expect(dot.locator(".js-field-mode-direction-cue-v1")).toBeVisible();
      await expectCarCentered(page);
      await expect(page.locator("#map")).toHaveCSS("transform", "none");
      await page.screenshot({path: testInfo.outputPath("field-heading-" + course.name + ".png")});
    }

    // A parked receiver can report a different heading; keep the last travel
    // direction and avoid moving the overlay or camera for stationary jitter.
    const parked = await cameraState(page);
    await page.evaluate(() => window.__fieldFixture.fix(36.350405, 127.384505, 8, {heading: 90, speed: 0}));
    await expectCarHeading(page, 270);
    expect(await cameraState(page)).toEqual(parked);

    await page.evaluate(() => window.__fieldFixture.fix(36.3514, 127.3845, 8, {heading: 359, speed: 4}));
    await expectCarHeading(page, 359);
    const beforeNorth = await dot.evaluate((element) => parseFloat(element.style.getPropertyValue("--js-field-mode-heading")));
    await page.evaluate(() => window.__fieldFixture.fix(36.3524, 127.3845, 8, {heading: 1, speed: 4}));
    await expectCarHeading(page, 1);
    const afterNorth = await dot.evaluate((element) => parseFloat(element.style.getPropertyValue("--js-field-mode-heading")));
    expect(afterNorth - beforeNorth).toBe(2);
    await expect(dot).toHaveClass(/js-field-mode-heading-turn-v1/);
    expect(await icon.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);

    await page.emulateMedia({reducedMotion: "reduce"});
    await expect(icon).toHaveCSS("transition-duration", "0s");
    await page.evaluate(() => window.__fieldFixture.fix(36.3524, 127.3855, 8, {heading: 90, speed: 4}));
    await expectCarHeading(page, 90);
    await expect.poll(async () => (await cameraState(page)).center).toEqual([36.3524, 127.3855]);
    await expectCarCentered(page);
    await expect(page.locator("#mapFieldModeControlsV1")).toBeHidden();
    expect((await cameraState(page)).watchCalls).toBe(1);
    await expect(dot).toHaveCount(1);
    expect(apiRequests.length).toBe(apiBaseline);

    await toggle.click();
    await expect(dot).not.toHaveClass(/js-field-mode-car-v1|js-field-mode-heading-known-v1|js-field-mode-heading-turn-v1/);
    await expect(dot.locator("svg, .js-field-mode-heading-pending-v1")).toHaveCount(0);
    await expect(dot).toHaveCSS("background-color", "rgb(123, 44, 255)");
    expect(await dot.evaluate((element) => element.style.getPropertyValue("--js-field-mode-heading"))).toBe("");
    expect(await cameraState(page)).toMatchObject({draggable: true, zoomable: true, watchCalls: 1});
    expect(apiRequests.length).toBe(apiBaseline);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
