import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const navigation = fs.readFileSync("js/kakao-navigation-v1.js", "utf8");
const visitSession = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");
const visitRoute = fs.readFileSync("js/ai-visit-route-v6.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    has(key) { return values.has(key); }
  };
}

function loadNavigation({ cached = false } = {}) {
  const storageValue = JSON.stringify({ lat: 36.1, lng: 127.1, accuracy: 25, timestamp: Date.now() });
  const sessionStorage = memoryStorage(cached ? { js_kakao_navigation_location_v1: storageValue } : {});
  const localStorage = memoryStorage({ js_kakao_navigation_location_v1: storageValue, js_ai_visit_location_v6: storageValue });
  const alerts = [];
  const requests = [];
  const opened = [];
  const navigator = {
    userAgent: "desktop-test",
    geolocation: {
      getCurrentPosition(success, failure, options) {
        requests.push(options);
        failure({ code: 2 });
      }
    }
  };
  const document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {}
  };
  const window = {
    setTimeout,
    clearTimeout,
    open(url) { opened.push(url); }
  };
  vm.runInNewContext(navigation, {
    window, navigator, document, sessionStorage, localStorage,
    alert(message) { alerts.push(message); },
    console
  });
  return { window, sessionStorage, localStorage, alerts, requests, opened };
}

test("authenticated assets can retry failed URLs and keep unavailable controls explicitly busy", () => {
  assert.match(auth, /authenticatedScriptLoads\.delete\(key\)/);
  assert.match(auth, /authenticatedAssetsPromise = null;[\s\S]*?throw error/);
  assert.match(auth, /failures\.push\(error\)[\s\S]*?throw new AggregateError/);
  assert.match(auth, /setAttribute\("aria-disabled", "true"\)/);
  assert.match(auth, /setAttribute\("aria-busy", "true"\)/);
  assert.match(auth, /retryDeferredAuthenticatedAssets/);
});

test("logout reloads only after a successful DELETE and clears precise location caches", () => {
  assert.match(auth, /const response = await fetch\("\/api\/session", \{ method: "DELETE", credentials: "same-origin" \}\)/);
  assert.match(auth, /if \(!response\.ok \|\| result\.ok === false\)[\s\S]*?throw new Error/);
  assert.match(auth, /clearPreciseLocationCaches\(\{ clearVisitDeviceCache: true, clearAccountMarker: true \}\)/);
  assert.doesNotMatch(auth, /finally \{\s*location\.reload\(\)/);
});

test("precise locations are session-only and old persistent values are only removed", () => {
  for (const source of [navigation, visitSession, visitRoute]) {
    assert.match(source, /sessionStorage\.setItem\(LOCATION_CACHE_KEY/);
    assert.doesNotMatch(source, /localStorage\.setItem\(LOCATION_CACHE_KEY/);
    assert.match(source, /localStorage\.removeItem\((?:LOCATION_CACHE_KEY|key)/);
  }
  assert.match(html, /kakao-navigation-v1\.js\?v=1\.1\.0-session-location/);
  assert.match(html, /ai-visit-route-v6\.js\?v=6\.1\.0-session-location/);
  assert.match(html, /ai-visit-session-v6\.js\?v=6\.4\.40-location-privacy/);
});

test("navigation asks for a live fix before using a labeled tab fallback", () => {
  const runtime = loadNavigation({ cached: true });
  runtime.window.JSKakaoNavigation.open({ lat: 36.2, lng: 127.2, name: "목적지" });

  assert.equal(runtime.requests.length, 2);
  assert.ok(runtime.requests.every((options) => options.maximumAge === 0));
  assert.equal(runtime.opened.length, 1);
  assert.ok(runtime.alerts.some((message) => message.includes("최근 위치")));
  assert.equal(runtime.localStorage.has("js_kakao_navigation_location_v1"), false);
  assert.equal(runtime.localStorage.has("js_ai_visit_location_v6"), false);

  runtime.window.JSKakaoNavigation.clearLocationCache();
  assert.equal(runtime.sessionStorage.has("js_kakao_navigation_location_v1"), false);
});
