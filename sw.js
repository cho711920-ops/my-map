"use strict";

// The build replaces these values with the exact public asset URLs and a
// content fingerprint. Source checkouts intentionally cache no app assets.
const BUILD_VERSION = "__JS_MAP_BUILD_VERSION__";
const PUBLIC_ASSET_URLS = /* __JS_MAP_PUBLIC_ASSETS__ */ [];
const CACHE_PREFIX = "js-map-public-static-v1-";
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const PUBLIC_URLS = new Set(PUBLIC_ASSET_URLS.map((path) => new URL(path, self.location.origin).href));
// Cloudflare's HTML handling redirects /offline.html to this canonical URL.
const OFFLINE_URL = "/offline";
const INSTALL_URLS = [OFFLINE_URL, "/icons/js-192.png", "/icons/js-512.png", "/manifest.webmanifest"];

function mayCacheResponse(response, url) {
  const path = new URL(url).pathname;
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const expectedType = path.endsWith(".js") ? /^(?:text|application)\/javascript$/
    : path.endsWith(".css") ? /^text\/css$/
    : path.endsWith(".png") ? /^image\/png$/
    : path.endsWith(".webmanifest") ? /^application\/(?:manifest\+json|json)$/
    : path === OFFLINE_URL ? /^text\/html$/ : /^$/;
  return response.ok && !response.redirected && response.type !== "opaque" &&
    expectedType.test(type) &&
    !/(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("cache-control") || "") &&
    !response.headers.has("set-cookie");
}

async function fetchPublicAsset(url) {
  // Public assets need no session cookie. No API response or user-owned image
  // can enter this cache, including through redirects or arbitrary queries.
  return fetch(new Request(url, { credentials: "omit", cache: "no-cache", redirect: "error" }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(INSTALL_URLS.map(async (path) => {
      const url = new URL(path, self.location.origin).href;
      const response = await fetchPublicAsset(url);
      if (!mayCacheResponse(response, url)) throw new Error("Public offline asset was not cacheable.");
      await cache.put(url, response);
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
  })());
});

async function publicAssetResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetchPublicAsset(request.url);
  if (mayCacheResponse(response, request.url)) await cache.put(request.url, response.clone());
  return response;
}

async function navigationResponse(request) {
  try {
    // HTML always comes from the server. In particular, never persist the
    // authenticated application shell or login/session responses.
    return await fetch(request);
  } catch (_) {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(new URL(OFFLINE_URL, self.location.origin).href) ||
      new Response("인터넷 연결 후 JS부동산을 다시 열어 주세요.", {
        status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname === "/api" || url.pathname.startsWith("/api/") ||
      request.headers.has("authorization")) return;
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }
  if (PUBLIC_URLS.has(url.href)) event.respondWith(publicAssetResponse(request));
});
