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

async function installMapBoundary(page, options = {}) {
  await page.evaluate(({camera}) => {
    const listeners = new Map();
    const overlays = new Set();
    const viewport = document.getElementById("map");
    let host = viewport;
    let credits = null;
    if (camera) {
      host = document.getElementById("jsFieldMapSurfaceV1") || document.createElement("div");
      host.id = "jsFieldMapSurfaceV1";
      if (!host.parentNode) viewport.appendChild(host);
      host.style.background = "repeating-linear-gradient(0deg, transparent, transparent 59px, #dce5ee 60px), repeating-linear-gradient(90deg, #f0f6fa, #f0f6fa 59px, #dce5ee 60px)";
      credits = document.createElement("div");
      credits.id = "fixtureSdkCredits";
      Object.assign(credits.style, {position: "absolute", bottom: "0px", left: "0px", height: "19px", zIndex: "1", display: "flex", gap: "4px", alignItems: "center"});
      credits.innerHTML = '<span data-fixture-scale>50m</span><a href="http://map.kakao.com/"><img width="32" height="10" alt="Kakao test boundary" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'10\'%3E%3Ctext x=\'0\' y=\'9\' font-size=\'10\'%3Ekakao%3C/text%3E%3C/svg%3E"></a>';
      host.appendChild(credits);
    }
    const state = {watchCalls: 0, centerCalls: 0, levelCalls: 0, markerMoves: 0, positionCallback: null};
    function LatLng(lat, lng) { this.getLat = () => lat; this.getLng = () => lng; }
    function emit(type) { for (const listener of listeners.get(type) || []) listener(); }
    const map = Object.assign({}, window.map, {
      center: new LatLng(36.34, 127.38), level: 5, draggable: true, zoomable: true,
      getCenter() { return this.center; },
      getLevel() { return this.level; },
      getDraggable() { return this.draggable; },
      getZoomable() { return this.zoomable; },
      getProjection() { return {
        containerPointFromCoords(point) { return {x: host.clientWidth/2+(point.getLng()-map.center.getLng())*100000, y: host.clientHeight/2-(point.getLat()-map.center.getLat())*100000}; },
        coordsFromContainerPoint(point) { return new LatLng(map.center.getLat()-(point.y-host.clientHeight/2)/100000, map.center.getLng()+(point.x-host.clientWidth/2)/100000); }
      }; },
      setDraggable(value) { this.draggable = value; },
      setZoomable(value) { this.zoomable = value; },
      setCenter(point) {
        this.center = point; state.centerCalls += 1;
        for (const overlay of overlays) overlay.render();
        emit("center_changed"); emit("idle");
      },
      setLevel(level) { this.level = level; state.levelCalls += 1; if (credits) credits.querySelector("[data-fixture-scale]").textContent = ({1: "20m", 2: "30m", 3: "50m"})[level] || ""; emit("zoom_changed"); emit("idle"); },
      panTo(point) { this.setCenter(point); },
      relayout() { for (const overlay of overlays) overlay.render(); }
    });
    function CustomOverlay(settings) {
      this.content = settings.content;
      this.anchor = camera ? document.createElement("div") : this.content;
      if (camera) this.anchor.appendChild(this.content);
      this.position = settings.position;
      this.owner = null;
      this.render = () => {
        if (!this.owner) return;
        const point = this.position;
        Object.assign(this.anchor.style, {
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
        if (owner) { host.appendChild(this.anchor); overlays.add(this); this.render(); }
        else { this.anchor.remove(); overlays.delete(this); }
      };
    }
    window.map = map;
    window.kakao = {maps: {LatLng, Point: function(x,y) {this.x=x;this.y=y;}, CustomOverlay, event: {
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
      host,
      credits,
      fix(lat, lng, accuracy = 8, motion = {}) {
        if (!state.positionCallback) throw new Error("Production GPS watcher was not started");
        state.positionCallback({coords: {latitude: lat, longitude: lng, accuracy, ...motion}, timestamp: Date.now()});
      }
    };
    document.getElementById("map").style.position = "relative";
  }, {camera: !!options.camera});
  await page.addScriptTag({content: "var jsCurrentLocationOverlayV630 = null; var jsCurrentLocationWatchIdV630 = null;\n" + locationSource});
  if (options.camera) {
    await page.addScriptTag({url: "/js/map-field-camera-v1.js"});
    await page.addScriptTag({url: "/js/map-field-orientation-v1.js"});
  }
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

async function expectPointerCentered(page) {
  const pointerBounds = await page.locator(".js-current-location-dot-v630").boundingBox();
  const mapBounds = await page.locator("#map").boundingBox();
  expect(pointerBounds).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  expect(pointerBounds.width).toBe(36);
  expect(pointerBounds.height).toBe(44);
  expect(Math.abs(pointerBounds.x + pointerBounds.width / 2 - mapBounds.x - mapBounds.width / 2)).toBeLessThan(1);
  expect(Math.abs(pointerBounds.y + pointerBounds.height / 2 - mapBounds.y - mapBounds.height / 2)).toBeLessThan(1);
}

async function expectNavigationArtwork(dot) {
  const icon = dot.locator("svg");
  const pointer = icon.locator("[data-field-navigation-pointer]");
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveClass(/js-field-mode-navigation-icon-v1/);
  await expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
  await expect(icon.locator("path")).toHaveCount(1);
  await expect(pointer).toHaveAttribute("d", "m12 2 7 19-7-4-7 4Z");
  await expect(pointer).toHaveAttribute("fill", "#dc2626");
  await expect(pointer).toHaveAttribute("stroke", "white");
  await expect(pointer).toHaveAttribute("stroke-width", "1.3");
  await expect(icon.locator("circle")).toHaveCount(1);
  await expect(icon.locator("[data-field-navigation-pending]")).toHaveAttribute("fill", "#dc2626");
  await expect(dot.locator("[data-field-car-body], .js-field-mode-direction-cue-v1")).toHaveCount(0);
}

async function expectPointerHeading(page, heading) {
  await expect.poll(() => page.locator(".js-field-mode-car-icon-v1").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    return (Math.round(angle) + 360) % 360;
  })).toBe(heading);
}

async function surfaceBearing(page) {
  return page.locator("#jsFieldMapSurfaceV1").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const angle = -Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    return (angle + 360) % 360;
  });
}

async function expectSurfaceBearing(page, heading) {
  await expect.poll(async () => {
    const current = await surfaceBearing(page);
    return Math.abs((current - heading + 540) % 360 - 180);
  }).toBeLessThan(0.0001);
}

async function dispatchDeviceTurn(page, heading) {
  await page.evaluate((value) => {
    const alpha = ((screen.orientation.angle || 0) - value + 360) % 360;
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", {absolute: true, alpha, beta: 0, gamma: 0}));
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", {absolute: true, alpha, beta: 0, gamma: 0}));
  }, heading);
}

async function confirmedTravelFix(page, fix) {
  await page.evaluate(({lat, lng, heading}) => window.__fieldFixture.fix(lat, lng, 8, {heading, speed: 4}), fix);
  await page.waitForTimeout(1050);
  await page.evaluate(({lat, lng, heading}) => window.__fieldFixture.fix(lat, lng, 8, {heading, speed: 4}), fix);
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

for (const input of ["mouse", "touch"]) {
  test(`${input}: short presses cycle scales; only an uninterrupted three-second hold turns field mode OFF`, async ({browser, baseURL}) => {
    const touch = input === "touch";
    const context = await browser.newContext({serviceWorkers: "block", isMobile: touch, hasTouch: touch,
      viewport: touch ? {width: 390, height: 844} : {width: 1280, height: 800},
      ...(touch ? {userAgent: phoneUA, screen: {width: 390, height: 844}} : {})});
    try {
      await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseURL);
      await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
      await page.locator("#fixtureControls").evaluate(element => {element.style.display = "none";});
      await installMapBoundary(page);
      const toggle = page.locator(touch ? "#mapFieldModeCompactToggleV1" : "#mapFieldModeToggleV1");
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
      const outside = {x: point.x + (point.x > 200 ? -70 : 70), y: point.y};
      const session = touch ? await context.newCDPSession(page) : null;
      const now = Date.now();
      await page.clock.install({time: new Date(now)});
      await page.clock.pauseAt(new Date(now + 100));
      await page.evaluate(() => {
        startCurrentLocationTrackingV630();
        __fieldFixture.fix(36.3504, 127.3845);
        window.__fieldPressEvents = [];
        for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "pointerleave", "click"]) {
          window.addEventListener(type, event => {
            window.__fieldPressEvents.push({type, button: event.button, pointerId: event.pointerId,
              isPrimary: event.isPrimary, fieldButton: !!event.target.closest?.("[data-field-mode-toggle]"),
              enabled: JSFieldModeV1.state().enabled, scale: JSFieldModeV1.state().scale});
            if (window.__fieldPressEvents.length > 20) window.__fieldPressEvents.shift();
          });
        }
      });
      async function touchEvent(type, location = point) {
        await session.send("Input.dispatchTouchEvent", {type, touchPoints: /End|Cancel/.test(type) ? [] : [
          {...location, id: 1, radiusX: 3, radiusY: 3, force: 1}
        ]});
      }
      async function down() {
        if (touch) await touchEvent("touchStart");
        else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
      }
      async function up() {
        if (touch) await touchEvent("touchEnd");
        else await page.mouse.up();
        await page.clock.runFor(50);
      }
      async function tap() { await down(); await page.clock.runFor(60); await up(); }
      async function expectState(enabled, scale) {
        expect(await page.evaluate(() => JSFieldModeV1.state()),
          JSON.stringify(await page.evaluate(() => window.__fieldPressEvents))).toMatchObject({enabled, scale, controlsOpen: false});
        await expect(toggle).toHaveAttribute("aria-pressed", String(enabled));
        await expectSingleFieldControl(page, toggle, enabled ? scale : null);
      }
      for (const scale of [20, 30, 50, 20]) {
        await tap();
        await expectState(true, scale);
        expect((await cameraState(page)).level).toBe(({20: 1, 30: 2, 50: 3})[scale]);
      }
      await down();
      await page.clock.runFor(2500);
      await expectState(true, 20);
      await up();
      await expectState(true, 30);

      await down();
      await page.clock.runFor(2999);
      await expectState(true, 30);
      await page.clock.runFor(1);
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await up();
      // The browser's real release click must not immediately switch back ON.
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await tap();
      await expectState(true, 20);

      await down();
      await page.clock.runFor(2000);
      if (touch) await touchEvent("touchMove", outside);
      else await page.mouse.move(outside.x, outside.y);
      await page.clock.runFor(2000);
      await expectState(true, 20);
      await up();
      await expectState(true, 20);

      await down();
      await page.clock.runFor(2000);
      if (touch) await touchEvent("touchCancel");
      else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.clock.runFor(2000);
      if (!touch) await up();
      await expectState(true, 20);
      expect((await cameraState(page)).watchCalls).toBe(1);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
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
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expectSingleFieldControl(page, toggle, null);
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
      await expectSingleFieldControl(page, toggle, 20);
      await expect(panel.locator("[data-field-mode-status]")).toHaveText("내 위치 따라가는 중");
      await expect(dot).toHaveClass(/js-field-mode-car-v1/);
      await expectNavigationArtwork(dot);
      await expect(dot.locator("[data-field-navigation-pointer]")).toBeHidden();
      await expect(dot.locator("[data-field-navigation-pending]")).toBeVisible();
      await expect(dot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await cameraState(page)).toMatchObject({center: [36.3504, 127.3845], position: [36.3504, 127.3845], level: 1, draggable: false, zoomable: false, watchCalls: 1});

      for (const scale of [30, 50, 20, 30, 50]) {
        await toggle.click();
        await expectSingleFieldControl(page, toggle, scale);
        expect(await page.evaluate(() => JSFieldModeV1.state())).toMatchObject({enabled: true, controlsOpen: false, scale});
        expect((await cameraState(page)).level).toBe(({20: 1, 30: 2, 50: 3})[scale]);
      }
      for (const [key, scale] of [["Enter", 20], [" ", 30], ["Enter", 50]]) {
        await toggle.press(key);
        await expectSingleFieldControl(page, toggle, scale);
      }
      await toggle.focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement.closest("[data-field-mode-expand], [data-field-mode-controls]"))).toBe(false);
      expect((await cameraState(page)).watchCalls).toBe(1);

      // A small stationary jitter must not move either the camera or the pointer.
      const steady = await cameraState(page);
      await page.evaluate(() => {
        for (let index = 0; index < 12; index += 1) window.__fieldFixture.fix(36.350405, 127.384505);
      });
      await page.waitForTimeout(1050);
      expect(await cameraState(page)).toEqual(steady);

      // A burst with a confirmed GPS course settles at the newest fix without API reads.
      await page.evaluate(() => {
        for (let index = 1; index <= 12; index += 1) {
          window.__fieldFixture.fix(36.3504 + index * 0.0001, 127.3845 + index * 0.0001, 8, {heading: 45, speed: 4});
        }
      });
      await expect.poll(async () => (await cameraState(page)).center[0]).toBeCloseTo(36.3516, 7);
      const moved = await cameraState(page);
      expect(moved.position[0]).toBeCloseTo(36.3516, 7);
      expect(moved.position[1]).toBeCloseTo(127.3857, 7);
      await expectPointerCentered(page);
      await expect(dot.locator("[data-field-navigation-pointer]")).toBeVisible();
      await expect(dot.locator("[data-field-navigation-pending]")).toBeHidden();
      expect(apiRequests.length).toBe(apiBaseline);
      expect(await preservedState(page)).toEqual(before);
      await expectSingleFieldControl(page, toggle, 50);
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

      await toggle.click({delay: 3100});
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expectSingleFieldControl(page, toggle, null);
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

test("GPS course turns the centered navigation pointer through cardinal directions and restores the dot on OFF", async ({browser, baseURL}, testInfo) => {
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
    await expectSingleFieldControl(page, toggle, 20);
    await expectNavigationArtwork(dot);
    await expect(dot.locator("[data-field-navigation-pointer]")).toHaveCSS("visibility", "hidden");
    await expect(dot.locator("[data-field-navigation-pointer]")).toBeHidden();
    await expect(dot.locator("[data-field-navigation-pending]")).toHaveCSS("visibility", "visible");
    await expect(dot.locator("[data-field-navigation-pending]")).toBeVisible();
    await expect(dot.locator(".js-field-mode-heading-pending-v1")).toHaveText("방향 확인 중");
    await expect(dot.locator(".js-field-mode-heading-pending-v1")).toBeVisible();
    expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({heading: null, headingSource: ""});
    await expectPointerCentered(page);
    await page.screenshot({path: testInfo.outputPath("field-heading-pending.png")});

    const courses = [
      {name: "north", heading: 0, lat: 36.3514, lng: 127.3845},
      {name: "east", heading: 90, lat: 36.3514, lng: 127.3855},
      {name: "south", heading: 180, lat: 36.3504, lng: 127.3855},
      {name: "west", heading: 270, lat: 36.3504, lng: 127.3845}
    ];
    for (const course of courses) {
      await confirmedTravelFix(page, course);
      await expect.poll(() => page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(course.heading);
      await expectPointerHeading(page, course.heading);
      expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({heading: course.heading, headingSource: "gps"});
      await expect.poll(async () => (await cameraState(page)).center).toEqual([course.lat, course.lng]);
      await expect(dot).toHaveClass(/js-field-mode-heading-known-v1/);
      await expect(dot.locator(".js-field-mode-heading-pending-v1")).toBeHidden();
      await expect(dot.locator("[data-field-navigation-pointer]")).toHaveCSS("visibility", "visible");
      await expect(dot.locator("[data-field-navigation-pointer]")).toBeVisible();
      await expect(dot.locator("[data-field-navigation-pending]")).toHaveCSS("visibility", "hidden");
      await expect(dot.locator("[data-field-navigation-pending]")).toBeHidden();
      await expect(dot.locator(".js-field-mode-direction-cue-v1")).toHaveCount(0);
      await expectPointerCentered(page);
      await expect(page.locator("#map")).toHaveCSS("transform", "none");
      await page.screenshot({path: testInfo.outputPath("field-heading-" + course.name + ".png")});
      if (course.name === "north") {
        const bounds = await dot.boundingBox();
        await page.screenshot({
          path: testInfo.outputPath("navigation-pointer-preview.png"),
          clip: {x: bounds.x + bounds.width / 2 - 80, y: bounds.y + bounds.height / 2 - 70, width: 160, height: 140}
        });
      }
    }

    // A parked receiver can report a different heading; keep the last travel
    // direction and avoid moving the overlay or camera for stationary jitter.
    const parked = await cameraState(page);
    await page.evaluate(() => window.__fieldFixture.fix(36.350405, 127.384505, 8, {heading: 90, speed: 0}));
    await expectPointerHeading(page, 270);
    expect(await cameraState(page)).toEqual(parked);

    await confirmedTravelFix(page, {lat: 36.3514, lng: 127.3845, heading: 359});
    await expectPointerHeading(page, 359);
    const beforeNorth = await dot.evaluate((element) => parseFloat(element.style.getPropertyValue("--js-field-mode-heading")));
    await page.evaluate(() => window.__fieldFixture.fix(36.3524, 127.3845, 8, {heading: 1, speed: 4}));
    await expectPointerHeading(page, 359);
    expect(await page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(359);
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__fieldFixture.fix(36.3524, 127.3845, 8, {heading: 6, speed: 4}));
    await expectPointerHeading(page, 6);
    const afterNorth = await dot.evaluate((element) => parseFloat(element.style.getPropertyValue("--js-field-mode-heading")));
    expect(afterNorth - beforeNorth).toBe(7);
    await expect(dot).toHaveClass(/js-field-mode-heading-turn-v1/);
    expect(await icon.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);

    await page.emulateMedia({reducedMotion: "reduce"});
    await expect(icon).toHaveCSS("transition-duration", "0s");
    await confirmedTravelFix(page, {lat: 36.3524, lng: 127.3855, heading: 90});
    await expectPointerHeading(page, 90);
    await expect.poll(async () => (await cameraState(page)).center).toEqual([36.3524, 127.3855]);
    await expectPointerCentered(page);
    await expect(page.locator("#mapFieldModeControlsV1")).toBeHidden();
    expect((await cameraState(page)).watchCalls).toBe(1);
    await expect(dot).toHaveCount(1);
    expect(apiRequests.length).toBe(apiBaseline);

    await toggle.click({delay: 3100});
    await expectSingleFieldControl(page, toggle, null);
    await expect(dot).not.toHaveClass(/js-field-mode-car-v1|js-field-mode-heading-known-v1|js-field-mode-heading-turn-v1/);
    await expect(dot.locator("svg, .js-field-mode-heading-pending-v1")).toHaveCount(0);
    await expect(dot).toHaveCSS("background-color", "rgb(123, 44, 255)");
    expect(await dot.evaluate((element) => element.style.getPropertyValue("--js-field-mode-heading"))).toBe("");
    expect(await cameraState(page)).toMatchObject({draggable: true, zoomable: true, watchCalls: 1});
    expect(apiRequests.length).toBe(apiBaseline);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

for (const device of [devices[0], devices[3]]) {
  test(`${device.name}: travel-only heading-up ignores device turns and retains stopped direction and favorites`, async ({browser, baseURL}, testInfo) => {
    test.setTimeout(60000);
    const context = await browser.newContext({
      serviceWorkers: "block", isMobile: true, hasTouch: true, userAgent: device.userAgent,
      viewport: {width: device.width, height: device.height}, screen: {width: device.screenWidth, height: device.screenHeight}
    });
    try {
      await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      const apiRequests = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        if (new URL(request.url()).pathname === "/api/data") apiRequests.push({url: request.url(), method: request.method()});
      });
      await page.goto(baseURL);
      await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "true");
      await expect.poll(() => page.evaluate(() => window.JSV6ListStore.load("favorite").some(folder => folder.id === "fixture-favorites"))).toBe(true);
      await page.locator("#fixtureControls").evaluate(element => {element.style.display="none";});
      await installMapBoundary(page, {camera:true});
      // Use the real favorite UI so both the saved folder and map-only filter
      // must survive subsequent heading changes and the mobile list round trip.
      await page.locator(device.phone ? '[data-mobile-view="favorites"]' : "#mapQuickListBtn").click();
      const favorites = page.locator("#unifiedFavoriteModalV7");
      await expect(favorites).toHaveAttribute("aria-hidden", "false");
      if (device.phone) await favorites.locator(".phone-favorite-folder-card-v2").filter({hasText:"테스트 찜폴더"}).click();
      await favorites.getByRole("button", {name:"지도 보기",exact:true}).click();
      await expect(favorites).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator("#list .item")).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => window.activeFavoriteFolderId)).toBe("fixture-favorites");
      await page.evaluate(() => {
        // Keep this synthetic property inside the simulated travel corridor.
        // The default fixture location is hundreds of screen pixels away.
        const favoriteItem = window.allItems.find(item => item.propertyId === "FIXTURE-LEASE-1");
        favoriteItem.latlng = new window.kakao.maps.LatLng(36.3504, 127.3850);
        document.getElementById("keyword").value="괴정";
        const mobileKeyword=document.getElementById("jsMobileKeywordV1");
        if(mobileKeyword) mobileKeyword.value="괴정";
        document.getElementById("sourceFilter").value="naver";
        window.applyFilter();
        window.selectedItemKey=window.allItems[0].key;
        window.startCurrentLocationTrackingV630();
        window.__fieldFixture.fix(36.3504,127.3845,8,{heading:null,speed:0});
      });
      const baseline = await preservedState(page);
      const savedFavorites = await page.evaluate(() => window.JSV6ListStore.load("favorite"));
      const allPropertyIds = await page.evaluate(() => window.allItems.map(item => item.propertyId));
      const apiBaseline = apiRequests.length;
      function expectOnlyExistingListResumeReads() {
        // The existing phone history.back path refreshes the two saved-list
        // scopes after 15 seconds. No listing query or write may be introduced.
        const reads = apiRequests.slice(apiBaseline);
        expect(reads.length).toBeLessThanOrEqual(device.phone ? 2 : 0);
        const scopes = reads.map(request => {
          expect(request.method).toBe("GET");
          const params = new URL(request.url).searchParams;
          expect(params.get("action")).toBe("loadCloudState");
          expect(["favorites", "visitLists"]).toContain(params.get("scope"));
          return params.get("scope");
        });
        expect(new Set(scopes).size).toBe(scopes.length);
      }
      const originalBounds = await page.locator("#map").boundingBox();
      const toggle=page.locator(device.phone ? "#mapFieldModeCompactToggleV1" : "#mapFieldModeToggleV1");
      const panel=page.locator(device.phone ? "#mapFieldModeCompactControlsV1" : "#mapFieldModeControlsV1");
      const dot=page.locator(".js-current-location-dot-v630");
      const surface=page.locator("#jsFieldMapSurfaceV1");
      const credits=page.locator("#fixtureSdkCredits");
      expect(await page.evaluate(() => window.JSFieldMapCameraV1.state().active)).toBe(false);
      expect(await page.evaluate(() => window.JSFieldOrientationV1.state().running)).toBe(false);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expectSingleFieldControl(page, toggle, 20);
      expect(await page.evaluate(() => window.JSFieldOrientationV1.state())).toMatchObject({running: false, listening: false});
      await expect(dot.locator("[data-field-navigation-pending]")).toBeVisible();
      await dispatchDeviceTurn(page, 180);
      expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({heading: null, headingSource: ""});
      expect(await page.evaluate(() => window.JSFieldMapCameraV1.state().active)).toBe(false);
      await page.evaluate(() => window.__fieldFixture.fix(36.3504,127.3855,8,{heading:90,speed:4}));
      await expect.poll(() => page.evaluate(() => window.JSFieldModeV1.state().headingSource)).toBe("gps");
      await expect.poll(() => page.evaluate(() => window.JSFieldMapCameraV1.state().bearing)).toBe(90);
      await expectSurfaceBearing(page, 90);
      await expect.poll(async () => (await cameraState(page)).center).toEqual([36.3504,127.3855]);
      await expectPointerCentered(page);
      await expect(dot.locator(".js-field-mode-car-icon-v1")).toHaveCSS("transform", "none");
      expect(await dot.locator("svg").evaluate(element => {
        const matrix=element.getScreenCTM();
        return Math.abs(Math.atan2(matrix.b,matrix.a)*180/Math.PI);
      })).toBeLessThan(0.01);
      await expect(credits).toBeVisible();
      await expect(credits).toContainText("20m");
      await expectWithinMap(page,"#fixtureSdkCredits");
      expect(await credits.evaluate(element => element.parentElement.id)).toBe("map");
      expect(await page.locator("#map").boundingBox()).toEqual(originalBounds);
      expect(await preservedState(page)).toEqual(baseline);

      // Device orientation never starts controlling the camera, while moving
      // or stopped. Small course noise also leaves the established direction.
      await dispatchDeviceTurn(page, 180);
      expect(await page.evaluate(() => window.JSFieldMapCameraV1.state().bearing)).toBe(90);
      await page.evaluate(() => window.__fieldFixture.fix(36.3504,127.3855,8,{heading:94,speed:4}));
      expect(await page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(90);
      await expectSurfaceBearing(page, 90);

      // One implausibly abrupt GPS course is withheld. A coherent subsequent
      // sample confirms the turn, and its visual rotation is interpolated.
      await page.waitForTimeout(50);
      await page.evaluate(() => window.__fieldFixture.fix(36.3504,127.3855,8,{heading:180,speed:4}));
      expect(await page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(90);
      await expectSurfaceBearing(page, 90);
      await page.waitForTimeout(1050);
      const turnStarted = Date.now();
      await page.evaluate(() => window.__fieldFixture.fix(36.3504,127.3855,8,{heading:180,speed:4}));
      await expect.poll(() => page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(180);
      await page.waitForTimeout(150);
      const intermediate = await surfaceBearing(page);
      expect(intermediate).toBeGreaterThan(90);
      expect(intermediate).toBeLessThan(180);
      await expectSurfaceBearing(page, 180);
      expect(Date.now() - turnStarted).toBeGreaterThanOrEqual(500);
      await expect.poll(() => page.evaluate(() => window.JSFieldMapCameraV1.state().bearing)).toBe(180);
      await expectPointerCentered(page);
      expect(await page.evaluate(() => window.JSFieldModeV1.state().headingSource)).toBe("gps");
      await expect(panel.locator("[data-field-mode-direction]")).not.toContainText("기기 위쪽이 바라보는 방향");

      const stopped = await cameraState(page);
      await page.evaluate(() => window.__fieldFixture.fix(36.3504,127.3855,8,{heading:270,speed:0}));
      await dispatchDeviceTurn(page, 270);
      await page.waitForTimeout(10200);
      await page.evaluate(() => window.__fieldFixture.fix(36.3504,127.3855,8,{heading:0,speed:0.2}));
      await dispatchDeviceTurn(page, 0);
      expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({heading: 180, headingSource: "gps"});
      await expectSurfaceBearing(page, 180);
      expect(await cameraState(page)).toEqual(stopped);
      expect(await page.evaluate(() => window.JSFieldOrientationV1.state())).toMatchObject({running: false, listening: false});

      // Restarting follows travel only after a large new course is confirmed.
      await confirmedTravelFix(page, {lat: 36.3504, lng: 127.3845, heading: 270});
      await expectSurfaceBearing(page, 270);
      await expect.poll(() => page.evaluate(() => window.JSFieldModeV1.state().heading)).toBe(270);
      await expect.poll(async () => (await cameraState(page)).center).toEqual([36.3504,127.3845]);
      await expectPointerCentered(page);
      expect(await preservedState(page)).toEqual(baseline);
      if (device.phone) {
        // Filtering out an offscreen virtual property is not deletion. Exercise
        // the production predicate without changing the saved folder or cards.
        const offscreen = await page.evaluate(() => {
          const item = window.allItems.find(value => value.propertyId === "FIXTURE-LEASE-1");
          const originalPosition = item.latlng;
          item.latlng = new window.kakao.maps.LatLng(36.35, 127.38);
          try {
            return {visible: window.getFilteredItems().map(value => value.propertyId),
              contains: window.JSFieldMapCameraV1.contains(item.latlng),
              allPropertyIds: window.allItems.map(value => value.propertyId),
              favorites: window.JSV6ListStore.load("favorite")};
          } finally { item.latlng = originalPosition; }
        });
        expect(offscreen.contains).toBe(false);
        expect(offscreen.visible).toEqual([]);
        expect(offscreen.allPropertyIds).toEqual(allPropertyIds);
        expect(offscreen.favorites).toEqual(savedFavorites);
      }
      await page.screenshot({path:testInfo.outputPath("field-travel-only-heading-up.png")});
      await expectSingleFieldControl(page, toggle, 20);
      expect(apiRequests.length, "GPS movement, turns and a long stop perform no API calls").toBe(apiBaseline);

      // The single main button updates the lifted SDK scale without exposing
      // the retained compatibility popup or adding a second focus target.
      for (const scale of [30, 50, 20]) {
        await toggle.click();
        await expect(credits).toContainText(scale + "m");
        await expectSingleFieldControl(page, toggle, scale);
      }
      if (device.phone) {
        await page.locator('[data-mobile-view="list"]').click();
        await expect(toggle).toBeHidden();
        await expect(page.locator("#list .item")).toBeVisible();
        await expect(page.locator("#list")).toContainText("괴정");
        await page.locator('[data-mobile-view="map"]').click();
        await expect(toggle).toBeVisible();
        expect(await page.evaluate(() => window.JSFieldMapCameraV1.state().active)).toBe(true);
      }
      await expect.poll(() => preservedState(page)).toEqual(baseline);
      expect(await page.evaluate(() => window.JSV6ListStore.load("favorite"))).toEqual(savedFavorites);
      expectOnlyExistingListResumeReads();

      await toggle.click({delay: 3100});
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expectSingleFieldControl(page, toggle, null);
      await expect(surface).toHaveCSS("transform", "none");
      await expect(dot).toHaveCSS("background-color", "rgb(123, 44, 255)");
      await expect(dot.locator("svg")).toHaveCount(0);
      expect(await page.evaluate(() => window.JSFieldMapCameraV1.state().active)).toBe(false);
      expect(await page.evaluate(() => window.JSFieldOrientationV1.state())).toMatchObject({running:false,listening:false,status:"off"});
      expect(await credits.evaluate(element => element.parentElement.id)).toBe("jsFieldMapSurfaceV1");
      await expectWithinMap(page,"#fixtureSdkCredits");
      expect(await surface.evaluate(element => ({width:element.clientWidth,height:element.clientHeight}))).toEqual({width:originalBounds.width,height:originalBounds.height});
      await page.evaluate(() => {
        const alpha=((screen.orientation.angle||0)-270+360)%360;
        window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute",{absolute:true,alpha,beta:0,gamma:0}));
        window.__fieldFixture.fix(36.3504,127.3865,8,{heading:270,speed:4});
      });
      expect(await page.evaluate(() => window.JSFieldModeV1.state())).toMatchObject({enabled:false,heading:null});
      await expect(surface).toHaveCSS("transform", "none");
      expect(await cameraState(page)).toMatchObject({center:[36.3504,127.3845],draggable:true,zoomable:true,watchCalls:1});
      expect(await preservedState(page)).toEqual(baseline);
      expectOnlyExistingListResumeReads();
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
}
