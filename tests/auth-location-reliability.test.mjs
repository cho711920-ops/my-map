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
    get length() { return values.size; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    key(index) { return Array.from(values.keys())[index] || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    has(key) { return values.has(key); }
  };
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const parameterEnd = source.indexOf(") {", start);
  assert.notEqual(parameterEnd, -1, `${name} parameters must end before its body`);
  const brace = source.indexOf("{", parameterEnd);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`could not extract ${name}`);
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

test("account-scoped recovery envelopes survive reload, logout, and account switches", () => {
  assert.match(auth, /Account-scoped AI\/list dirty envelopes intentionally survive sign-out/);
  assert.doesNotMatch(auth, /removeAiVisitDirtyRecoveryForAccount|removeListDirtyRecoveryForAccount/);
  assert.doesNotMatch(auth, /AI_VISIT_DEVICE_CACHE_KEYS = \[[^\]]*(?:cloud_dirty|dirty_envelope)/);

  const accountAKey = "js_ai_visit_cloud_dirty_v1::a%40example.com";
  const accountBKey = "js_ai_visit_cloud_dirty_v1::b%40example.com";
  const accountAListKey = "js_list_sync_dirty_envelope_v1_favorite::a%40example.com";
  const accountBListKey = "js_list_sync_dirty_envelope_v1_favorite::b%40example.com";
  const localStorage = memoryStorage({
    [accountAKey]: "account-a-dirty",
    [accountBKey]: "account-b-dirty",
    [accountAListKey]: "account-a-list-dirty",
    [accountBListKey]: "account-b-list-dirty",
    js_ai_visit_sessions_v6: "unscoped-device-cache",
    js_list_account_email_v6: "a@example.com"
  });
  const sessionStorage = memoryStorage({ js_authenticated_account_v1: "a@example.com" });
  const context = { window: { localStorage, sessionStorage } };
  vm.createContext(context);
  vm.runInContext([
    'const AUTH_ACCOUNT_SESSION_KEY = "js_authenticated_account_v1";',
    'const PRECISE_LOCATION_KEYS = ["js_kakao_navigation_location_v1", "js_ai_visit_location_v6"];',
    'const AI_VISIT_DEVICE_CACHE_KEYS = ["js_ai_visit_sessions_v6", "js_ai_visit_session_v6"];',
    extractFunction(auth, "removeStorageKeys"),
    extractFunction(auth, "clearPreciseLocationCaches"),
    extractFunction(auth, "syncLocationPrivacyForAccount")
  ].join("\n"), context);

  context.syncLocationPrivacyForAccount("a@example.com");
  assert.equal(context.window.JSLegacyStorageOwnerEmailV1, "a@example.com", "legacy ownership is captured before assets can rewrite it");
  assert.equal(localStorage.has(accountAKey), true, "same-account recovery must survive reload");
  assert.equal(localStorage.has(accountBKey), true);
  assert.equal(localStorage.has(accountAListKey), true);
  assert.equal(localStorage.has(accountBListKey), true);
  assert.equal(localStorage.has("js_ai_visit_sessions_v6"), true);

  localStorage.setItem(accountBKey, "account-b-dirty");
  localStorage.setItem(accountBListKey, "account-b-list-dirty");
  localStorage.setItem("js_list_account_email_v6", "b@example.com");
  context.syncLocationPrivacyForAccount("b@example.com");
  assert.equal(localStorage.has(accountAKey), true);
  assert.equal(localStorage.has(accountBKey), true);
  assert.equal(localStorage.has(accountAListKey), true);
  assert.equal(localStorage.has(accountBListKey), true);
  assert.equal(localStorage.has("js_ai_visit_sessions_v6"), false);
  assert.equal(context.window.JSLegacyStorageOwnerEmailV1, "a@example.com", "captured ownership cannot drift during an account switch");
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
