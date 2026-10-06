import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

// Opt-in network contract test. The page itself is fulfilled from this test at
// the app's registered SDK origin; it never requests the production page/API,
// inherits no user cookies, and permits only public Kakao SDK/tile GETs.
// JS_FIELD_REAL_SDK=1 JS_BROWSER_CHANNEL=msedge pnpm exec playwright test
//   tests/browser/field-map-camera.spec.mjs --project=desktop
const enabled = process.env.JS_FIELD_REAL_SDK === "1";
const fixtureURL = "https://js-map.com/__field-camera-sdk-fixture";
const allowedSdkHosts = new Set([
  "dapi.kakao.com", "t1.kakaocdn.net", "mts.kakaocdn.net", "t1.daumcdn.net", "t2.daumcdn.net", "t3.daumcdn.net", "t4.daumcdn.net",
  "mts.daumcdn.net", "map.daumcdn.net", "map0.daumcdn.net", "map1.daumcdn.net", "map2.daumcdn.net", "map3.daumcdn.net", "map4.daumcdn.net"
]);

test.beforeEach(({isMobile}, testInfo) => {
  test.skip(!enabled, "Set JS_FIELD_REAL_SDK=1 to run the isolated public Kakao SDK contract checks.");
  test.skip(isMobile || testInfo.project.name !== "desktop", "The network contract runs once from the desktop project.");
});

async function installRealMap(page) {
  const index = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const sdkURL = index.match(/<script src="(https:\/\/dapi\.kakao\.com\/v2\/maps\/sdk\.js[^"<>]+)"/)?.[1];
  if (!sdkURL) throw new Error("The configured public Kakao SDK script is missing");
  const [camera, css] = await Promise.all([
    readFile(new URL("../../js/map-field-camera-v1.js", import.meta.url), "utf8"),
    readFile(new URL("../../css/map-field-mode-v1.css", import.meta.url), "utf8")
  ]);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>임장모드 격리 SDK 검수</title><style>${css}
    *{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif;background:#e8edf4}
    header{position:absolute;inset:0 0 auto;height:48px;background:white;padding:12px;font-weight:bold}
    #map{position:absolute;top:54px;left:12px;right:228px;bottom:18px;overflow:hidden;background:#e6e7e8}
    aside{position:absolute;right:12px;top:54px;bottom:18px;width:204px;background:white;padding:14px}
    .circle-marker{display:grid;place-content:center;width:64px;height:36px;border:2px solid #1665cf;border-radius:8px;background:white;color:#123c73;font:700 14px Arial,sans-serif;cursor:pointer}
    .camera-current{background:#ffe4e6;border-color:#dc2626;color:#991b1b}
    @media(max-width:600px){#map{right:12px;bottom:78px}aside{left:12px;right:12px;top:auto;bottom:12px;height:54px;width:auto;padding:8px}}
    </style></head><body><header>임장 방향 SDK 검수 · 가상 좌표</header><div id="map"></div><aside>실제 SDK · 가상 매물<br><span id="selection">선택 없음</span></aside>
    <script>${camera}</script><script src="${sdkURL}"></script><script>
    kakao.maps.load(function(){
      var viewport=document.getElementById('map');
      var host=JSFieldMapCameraV1.createContainer(viewport);
      window.map=new kakao.maps.Map(host,{center:new kakao.maps.LatLng(36.3504,127.3845),level:3,draggable:false,scrollwheel:false,disableDoubleClickZoom:true});
      JSFieldMapCameraV1.attach(map);
      window.fixture={points:{},overlays:[],clicks:[],credits:null,host:host};
      var center=map.getProjection().containerPointFromCoords(map.getCenter());
      [['center',0,0,'내 위치'],['north',0,-110,'북쪽'],['east',110,0,'동쪽'],['south',0,110,'남쪽'],['west',-110,0,'서쪽']].forEach(function(row){
        var coords=row[0]==='center'?map.getCenter():map.getProjection().coordsFromContainerPoint(new kakao.maps.Point(center.x+row[1],center.y+row[2]));
        fixture.points[row[0]]=coords;
        var button=document.createElement('button');button.type='button';button.id='fixture-'+row[0];button.className='circle-marker'+(row[0]==='center'?' camera-current':'');button.textContent=row[3];
        button.addEventListener('click',function(){fixture.clicks.push(row[0]);document.getElementById('selection').textContent=row[3]+' 선택';});
        var overlay=new kakao.maps.CustomOverlay({position:coords,content:button,xAnchor:.5,yAnchor:.5,zIndex:100});overlay.setMap(map);fixture.overlays.push(overlay);
      });
      fixture.credits=Array.from(host.children).find(function(child){return child.querySelector('a[href*="map.kakao.com"] img');});
      document.documentElement.dataset.ready='true';
    });</script></body></html>`;
  const errors = [];
  const forbidden = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.href === fixtureURL) {
      return route.fulfill({status: 200, contentType: "text/html; charset=utf-8", body: html});
    }
    if (request.method() === "GET" && allowedSdkHosts.has(url.hostname)) return route.continue();
    forbidden.push({method: request.method(), host: url.hostname, path: url.pathname});
    return route.abort();
  });
  await page.goto(fixtureURL);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {timeout: 20000});
  await expect.poll(() => page.locator('#map img[src*="/tile/"]').evaluateAll((images) => images.filter((img) => img.complete && img.naturalWidth > 0).length)).toBeGreaterThan(5);
  return {errors, forbidden};
}

async function viewState(page) {
  return page.evaluate(() => {
    const mapRect = document.getElementById("map").getBoundingClientRect();
    const host = fixture.host;
    const geometry = {};
    for (const key of Object.keys(fixture.points)) {
      const element = document.getElementById("fixture-" + key);
      if (!element) continue; // The SDK detaches overlays outside its zoomed surface.
      const rect = element.getBoundingClientRect();
      const p = JSFieldMapCameraV1.projection(map).containerPointFromCoords(fixture.points[key]);
      const inverse = JSFieldMapCameraV1.projection(map).coordsFromContainerPoint(p);
      const inversePoint = JSFieldMapCameraV1.projection(map).containerPointFromCoords(inverse);
      geometry[key] = {x: rect.x + rect.width / 2 - mapRect.x, y: rect.y + rect.height / 2 - mapRect.y,
        width: rect.width, height: rect.height, projectedX: p.x, projectedY: p.y,
        inversePixelError: Math.hypot(inversePoint.x-p.x,inversePoint.y-p.y)};
    }
    return {width: mapRect.width, height: mapRect.height, hostWidth: host.clientWidth, hostHeight: host.clientHeight,
      hostTransform: getComputedStyle(host).transform, mapCenter: [map.getCenter().getLat(), map.getCenter().getLng()], geometry};
  });
}

async function expectAttribution(page, expectedScale) {
  const data = await page.evaluate(() => {
    const mapRect = document.getElementById("map").getBoundingClientRect();
    const credits = fixture.credits;
    if (!credits) return null;
    const r = credits.getBoundingClientRect();
    const logo = credits.querySelector('a[href*="map.kakao.com"] img');
    const logoRect = logo.getBoundingClientRect();
    return {connected: credits.isConnected, text: credits.textContent, logoLoaded: logo.complete && logo.naturalWidth > 0,
      inside: r.x >= mapRect.x && r.y >= mapRect.y && r.right <= mapRect.right && r.bottom <= mapRect.bottom,
      logoWidth: logoRect.width, logoHeight: logoRect.height, parentId: credits.parentElement.id};
  });
  expect(data).not.toBeNull();
  expect(data.connected).toBe(true);
  expect(data.inside).toBe(true);
  expect(data.logoLoaded).toBe(true);
  expect(data.logoWidth).toBeCloseTo(32, 0);
  expect(data.logoHeight).toBeCloseTo(10, 0);
  expect(data.text).toContain(expectedScale);
}

async function expectCornersCovered(page) {
  const results = await page.evaluate(() => {
    const rect = document.getElementById("map").getBoundingClientRect();
    return [[6,6],[rect.width-6,6],[6,rect.height-28],[rect.width-6,rect.height-28]].map(([x,y]) => {
      return document.elementsFromPoint(rect.x+x,rect.y+y).some((element) => element.tagName === "IMG" && /\/tile\//.test(element.src) && element.complete && element.naturalWidth > 0);
    });
  });
  expect(results).toEqual([true,true,true,true]);
}

test("actual Kakao: cardinal rotation, upright clickable overlays, projection and attribution", async ({page}, testInfo) => {
  test.setTimeout(60000);
  const boundary = await installRealMap(page);
  const baseline = await viewState(page);
  for (const bearing of [0, 45, 90, 180, 270, 359, 1]) {
    await page.evaluate((value) => JSFieldMapCameraV1.setBearing(value), bearing);
    await expect.poll(() => page.locator('#map img[src*="/tile/"]').evaluateAll((images) => images.filter((img) => !img.complete || !img.naturalWidth).length)).toBe(0);
    const state = await viewState(page);
    expect(state.width).toBe(baseline.width);
    expect(state.height).toBe(baseline.height);
    expect(state.hostWidth).toBeGreaterThanOrEqual(Math.hypot(state.width, state.height));
    expect(state.hostWidth).toBe(state.hostHeight);
    expect(state.mapCenter[0]).toBeCloseTo(baseline.mapCenter[0], 6);
    expect(state.mapCenter[1]).toBeCloseTo(baseline.mapCenter[1], 6);
    for (const value of Object.values(state.geometry)) {
      expect(value.width).toBeCloseTo(64, 0);
      expect(value.height).toBeCloseTo(36, 0);
      expect(Math.abs(value.x - value.projectedX)).toBeLessThan(1.5);
      expect(Math.abs(value.y - value.projectedY)).toBeLessThan(1.5);
      // Kakao's native projection quantizes geographic coordinates to pixels.
      expect(value.inversePixelError).toBeLessThan(1.5);
    }
    const angle = bearing * Math.PI / 180;
    const dx = baseline.geometry.east.x-baseline.geometry.center.x;
    const dy = baseline.geometry.east.y-baseline.geometry.center.y;
    expect(Math.abs(state.geometry.east.x-state.geometry.center.x-(dx*Math.cos(angle)+dy*Math.sin(angle)))).toBeLessThan(2);
    expect(Math.abs(state.geometry.east.y-state.geometry.center.y-(-dx*Math.sin(angle)+dy*Math.cos(angle)))).toBeLessThan(2);
    await page.locator("#fixture-east").click();
    await expect(page.locator("#selection")).toHaveText("동쪽 선택");
    await expectAttribution(page, "50m");
    await expectCornersCovered(page);
    if (bearing === 90 || bearing === 45) await page.screenshot({path: testInfo.outputPath(`heading-${bearing}.png`)});
  }
  await page.evaluate(() => {map.setLevel(1, {animate:false});});
  await expectAttribution(page, "20m");
  await page.evaluate(() => JSFieldMapCameraV1.reset());
  const restored = await viewState(page);
  expect(restored.hostTransform).toBe("none");
  expect(restored.hostWidth).toBe(restored.width);
  expect(restored.hostHeight).toBe(restored.height);
  await expect(page.locator("#map")).not.toHaveClass(/js-field-map-heading-up-v1/);
  await expectAttribution(page, "20m");
  expect(await page.evaluate(() => fixture.credits.parentElement === fixture.host)).toBe(true);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
});

test("actual Kakao: animated turns keep projection and overlays aligned without rebuilding every frame", async ({page}) => {
  const boundary = await installRealMap(page);
  const result = await page.evaluate(async () => {
    JSFieldMapCameraV1.setBearing(90);
    let refreshes = 0;
    window.scheduleMapIdleRefreshV638 = () => { refreshes += 1; };
    JSFieldMapCameraV1.setBearing(180, {animate: true});
    const frames = [];
    await new Promise(resolve => {
      function sample() {
        const state = JSFieldMapCameraV1.state();
        const viewport = document.getElementById("map").getBoundingClientRect();
        const marker = document.getElementById("fixture-east").getBoundingClientRect();
        const point = JSFieldMapCameraV1.projection(map).containerPointFromCoords(fixture.points.east);
        frames.push({bearing:state.bearing, error:Math.hypot(marker.x + marker.width / 2 - viewport.x - point.x,
          marker.y + marker.height / 2 - viewport.y - point.y), width:marker.width, height:marker.height});
        if (state.animating) requestAnimationFrame(sample);
        else resolve();
      }
      requestAnimationFrame(sample);
    });
    return {frames, refreshes};
  });
  expect(result.frames.some(frame => frame.bearing > 90 && frame.bearing < 180)).toBe(true);
  expect(result.frames.at(-1).bearing).toBe(180);
  expect(result.refreshes).toBe(2);
  for (const frame of result.frames) {
    expect(frame.error).toBeLessThan(2);
    expect(frame.width).toBeCloseTo(64, 0);
    expect(frame.height).toBeCloseTo(36, 0);
  }
  await page.locator("#fixture-east").click();
  await expect(page.locator("#selection")).toHaveText("동쪽 선택");
  await expectAttribution(page, "50m");
  await page.evaluate(() => {
    JSFieldMapCameraV1.setBearing(270, {animate:true});
    JSFieldMapCameraV1.reset();
  });
  await expect(page.locator("#map")).not.toHaveClass(/js-field-map-heading-up-v1/);
  expect(await page.evaluate(() => JSFieldMapCameraV1.state().animating)).toBe(false);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
});

test("actual Kakao: heading-up survives tablet/phone resizing and rejects overscan-only coordinates", async ({page}, testInfo) => {
  test.setTimeout(60000);
  const boundary = await installRealMap(page);
  await page.evaluate(() => JSFieldMapCameraV1.setBearing(135));
  for (const size of [{width:768,height:1024},{width:390,height:844},{width:1280,height:800}]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => {
      const viewport = document.getElementById("map");
      const state = JSFieldMapCameraV1.state();
      return state.width === viewport.clientWidth && state.height === viewport.clientHeight;
    })).toBe(true);
    await expect.poll(() => page.locator('#map img[src*="/tile/"]').evaluateAll((images) => images.filter((img) => !img.complete || !img.naturalWidth).length)).toBe(0);
    const state = await viewState(page);
    // Relayout and geographic projection both quantize in the native SDK;
    // their combined error is under three display pixels at oblique bearings.
    expect(Math.abs(state.geometry.center.x-state.width/2)).toBeLessThan(3);
    expect(Math.abs(state.geometry.center.y-state.height/2)).toBeLessThan(3);
    const containment = await page.evaluate(() => {
      const viewport = document.getElementById("map");
      const p = JSFieldMapCameraV1.projection(map);
      return [[-20,viewport.clientHeight/2],[viewport.clientWidth+20,viewport.clientHeight/2],[viewport.clientWidth/2,-20],[viewport.clientWidth/2,viewport.clientHeight+20],[viewport.clientWidth/2,viewport.clientHeight/2]].map(([x,y]) => JSFieldMapCameraV1.contains(p.coordsFromContainerPoint(new kakao.maps.Point(x,y))));
    });
    expect(containment).toEqual([false,false,false,false,true]);
    await expectAttribution(page, "50m");
    await expectCornersCovered(page);
    await page.locator("#fixture-center").click();
    await page.screenshot({path:testInfo.outputPath(`resized-${size.width}.png`)});
  }
  await page.evaluate(() => JSFieldMapCameraV1.setBearing(null));
  const state = await viewState(page);
  expect(state.hostTransform).toBe("none");
  expect(state.hostWidth).toBe(state.width);
  expect(state.hostHeight).toBe(state.height);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
});
