"use strict";

// The build replaces these values with the exact public asset URLs and a
// content fingerprint. Source checkouts intentionally cache no app assets.
const BUILD_VERSION = "__JS_MAP_BUILD_VERSION__";
const PUBLIC_ASSET_URLS = /* __JS_MAP_PUBLIC_ASSETS__ */ [];
const CACHE_PREFIX = "js-map-public-static-v1-";
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const SHELL_URL = "__JS_MAP_STARTUP_SHELL__";
const HAS_PUBLIC_SHELL = /^\/startup-shell-v216-[a-f0-9]{24}$/.test(SHELL_URL);
const PUBLIC_URLS = new Set(PUBLIC_ASSET_URLS.map((path) => new URL(path, self.location.origin).href));
// Cloudflare's HTML handling redirects /offline.html to this canonical URL.
const OFFLINE_URL = "/offline";
const INSTALL_URLS = [OFFLINE_URL, "/icons/js-192.png", "/icons/js-512.png", "/manifest.webmanifest", ...(HAS_PUBLIC_SHELL ? [SHELL_URL] : [])];
const RELEASE_CACHE_V240 = "js-map-public-shell-v240";
const RELEASE_KEY_V240 = new URL("/startup-current-v240", self.location.origin).href;
let releaseCheckV240 = null;
let releaseCheckedAtV240 = 0;
let releaseFailureV241 = "";
let releaseRepairsV241 = 0;
const digestPublicV240 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");

async function reportPublicReleaseV241(stage, code) {
  if (!/^[a-f0-9]{24}$/.test(BUILD_VERSION)) return;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = new URL("/public-release-v240.json", self.location.origin);
    url.search = new URLSearchParams({release_status_v241: stage, build: BUILD_VERSION, code, repairs: String(releaseRepairsV241)}).toString();
    await fetch(new Request(url.href, {method: "HEAD", credentials: "omit", cache: "no-cache", redirect: "error", signal: controller.signal}));
  } catch (_) { /* Diagnostics never gate an app navigation or save. */ }
  finally { clearTimeout(timer); }
}

async function publicAssetBytesV241(response, url, expected) {
  if (!response || !mayCacheResponse(response, url)) return null;
  try {
    const bytes = await limitedPublicBodyV240(response, 2097152);
    return await digestPublicV240(bytes) === expected ? bytes : null;
  } catch (_) { return null; }
}

async function limitedPublicBodyV240(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Public release too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function checkPublicReleaseV240(prepareOwnAssets = false) {
  if (!HAS_PUBLIC_SHELL) return Promise.resolve();
  if (releaseCheckV240) return releaseCheckV240;
  if (Date.now() - releaseCheckedAtV240 < 1000) return Promise.resolve();
  releaseCheckedAtV240 = Date.now();
  releaseFailureV241 = "manifest_invalid";
  releaseRepairsV241 = 0;
  releaseCheckV240 = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const get = path => fetch(new Request(new URL(path, self.location.origin).href,
        {credentials: "omit", cache: "no-cache", redirect: "error", signal: controller.signal}));
      const response = await get("/public-release-v240.json");
      if (!response.ok || response.redirected || response.type === "opaque" || response.headers.has("set-cookie") ||
          !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "") ||
          /(?:^|,)\s*private\b/i.test(response.headers.get("cache-control") || "")) return;
      const release = JSON.parse(new TextDecoder().decode(await limitedPublicBodyV240(response, 131072)));
      if (release.version !== 240 || !/^[a-f0-9]{24}$/.test(release.build || "") ||
          release.shellUrl !== "/startup-shell-v216-" + release.build || !/^[a-f0-9]{64}$/.test(release.shellSha256 || "") ||
          !Array.isArray(release.assets) || release.assets.length > 512) return;
      const assets = new Map();
      for (const asset of release.assets) {
        const url = new URL(asset.url, self.location.origin);
        if (url.origin !== self.location.origin || !/^\/(?:js|css)\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(url.pathname) ||
            url.hash || !/^[a-f0-9]{64}$/.test(asset.sha256 || "") || url.searchParams.get("build") !== asset.sha256.slice(0, 16) || assets.has(url.href)) return;
        assets.set(url.href, asset.sha256);
      }
      const cache = await caches.open(RELEASE_CACHE_V240);
      const cached = await cache.match(RELEASE_KEY_V240);
      if (cached?.headers.get("x-js-public-shell-sha-v240") === release.shellSha256 &&
          cached.headers.get("x-js-public-shell-build-v240") === release.build &&
          (!prepareOwnAssets || cached.headers.get("x-js-public-shell-assets-v241") === "verified")) {
        releaseFailureV241 = ""; return;
      }
      // Own install-time shell is already fast. Only another release needs a
      // background HTML transfer; navigation never waits for this discovery.
      releaseFailureV241 = "shell_invalid";
      const shell = release.build === BUILD_VERSION
        ? await (await caches.open(CACHE_NAME)).match(new URL(SHELL_URL, self.location.origin).href)
        : await get(release.shellUrl);
      if (!shell || !mayCacheResponse(shell, new URL(SHELL_URL, self.location.origin).href)) return;
      const bytes = await limitedPublicBodyV240(shell, 524288);
      const sha = await digestPublicV240(bytes);
      const html = new TextDecoder().decode(bytes);
      if (sha !== release.shellSha256 || /\bid\s*=\s*["']jsNavigationSessionV149["']/i.test(html) ||
          !/<template\b[^>]*\bid=["']jsAuthenticatedHeadAssets["']/i.test(html)) return;
      // Pin every linked JS/CSS before publishing new markup. An older worker
      // must not later fetch a new deployment's bytes under an older build URL.
      for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
        const value = match[1].replaceAll("&amp;", "&");
        if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
        const url = new URL(value, self.location.origin);
        if (/^\/(?:js|css)\/.*\.(?:js|css)$/.test(url.pathname) && !assets.has(url.href)) return;
      }
      if (prepareOwnAssets || release.build !== BUILD_VERSION) {
        releaseFailureV241 = "asset_invalid";
        const owned = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) || name === RELEASE_CACHE_V240);
        const entries = [...assets];
        let next = 0, totalBytes = 0;
        await Promise.all([0, 1].map(async () => {
          while (next < entries.length) {
            const [url, expected] = entries[next++];
            let body = null, assetHeaders = null;
            const repair = [];
            for (const name of owned) {
              const candidate = await (await caches.open(name)).match(url);
              if (!candidate) continue;
              const bytes = await publicAssetBytesV241(candidate.clone(), url, expected);
              if (bytes && !body) { body = bytes; assetHeaders = new Headers(candidate.headers); }
              else if (!bytes) repair.push(name);
            }
            if (!body) {
              const asset = await get(url);
              body = await publicAssetBytesV241(asset.clone(), url, expected);
              if (!body) throw new Error("Invalid public release asset");
              assetHeaders = new Headers(asset.headers);
            }
            totalBytes += body.byteLength;
            if (totalBytes > 16777216) throw new Error("Public release asset limit");
            const headers = assetHeaders;
            headers.delete("content-encoding"); headers.delete("content-length");
            headers.set("x-js-public-asset-sha-v240", expected);
            await cache.put(url, new Response(body, {headers}));
            // Repair only attested JS/CSS URLs in our public-code caches. Old
            // workers can otherwise keep replaying corrupt bytes indefinitely.
            for (const name of repair) await (await caches.open(name)).put(url, new Response(body, {headers}));
            releaseRepairsV241 += repair.length;
          }
        }));
      }
      const headers = new Headers(shell.headers);
      headers.delete("content-encoding"); headers.delete("content-length");
      headers.set("x-js-public-shell-sha-v240", sha);
      headers.set("x-js-public-shell-build-v240", release.build);
      headers.set("x-js-public-shell-assets-v241", prepareOwnAssets || release.build !== BUILD_VERSION ? "verified" : "own");
      await cache.put(RELEASE_KEY_V240, new Response(bytes, {headers}));
      releaseFailureV241 = "";
    } finally { clearTimeout(timer); }
  })().catch(error => { if (error?.name === "AbortError") releaseFailureV241 = "timeout"; })
    .finally(() => { releaseCheckV240 = null; });
  return releaseCheckV240;
}

async function prepareLegacyNavigationsV240() {
  const targets = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || name === CACHE_NAME) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.origin !== self.location.origin || !/^\/startup-shell-v216-[a-f0-9]{24}$/.test(url.pathname) || url.search) continue;
      const response = await cache.match(request.url);
      if (!response || !mayCacheResponse(response, new URL(SHELL_URL, self.location.origin).href)) continue;
      const html = new TextDecoder().decode(await limitedPublicBodyV240(response, 524288));
      if (/<template\b[^>]*\bid=["']jsAuthenticatedHeadAssets["']/i.test(html) &&
          !/\bid\s*=\s*["']jsNavigationSessionV149["']/i.test(html)) targets.push({cache, key: request.url});
    }
  }
  if (!targets.length) return;
  await checkPublicReleaseV240(true);
  const latest = await (await caches.open(RELEASE_CACHE_V240)).match(RELEASE_KEY_V240);
  if (!latest || latest.headers.get("x-js-public-shell-build-v240") !== BUILD_VERSION) {
    // Do not silently install an update that leaves legacy ordinary URLs stuck.
    // A later normal registration retries; current pages and drafts stay intact.
    throw new Error("Public release preparation did not finish");
  }
  // Legacy workers know only their install-time HTML cache key. Update only
  // these proven public navigation slots, after the new HTML AND all linked
  // exact assets are verified/prepared in the browser's public HTTP cache.
  // Running pages keep their JS, CSS, inputs and controller. No activation,
  // client claiming, reload, account cache or user photo mutation is involved.
  for (const {cache, key} of targets) await cache.put(key, latest.clone());
}

self.addEventListener("message", event => {
  if (event.data?.type !== "CHECK_PUBLIC_RELEASE_V240" || !event.source?.url) return;
  const url = new URL(event.source.url);
  if (url.origin !== self.location.origin || !["/", "/index.html"].includes(url.pathname)) return;
  event.waitUntil(checkPublicReleaseV240());
});

function mayCacheResponse(response, url) {
  const path = new URL(url).pathname;
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const expectedType = path.endsWith(".js") ? /^(?:text|application)\/javascript$/
    : path.endsWith(".css") ? /^text\/css$/
    : path.endsWith(".png") ? /^image\/png$/
    : path.endsWith(".webmanifest") ? /^application\/(?:manifest\+json|json)$/
    : path === OFFLINE_URL || HAS_PUBLIC_SHELL && path === SHELL_URL ? /^text\/html$/ : /^$/;
  return response.ok && !response.redirected && response.type !== "opaque" &&
    expectedType.test(type) &&
    !/(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("cache-control") || "") &&
    !response.headers.has("set-cookie");
}

async function fetchPublicAsset(url) {
  // Public assets need no session cookie. No API response or user-owned image
  // can enter this cache, including through redirects or arbitrary queries.
  const parsed = new URL(url);
  const immutable = PUBLIC_URLS.has(parsed.href) && /\.(?:js|css)$/.test(parsed.pathname) &&
    /^[a-f0-9]{16}$/.test(parsed.searchParams.get("build") || "");
  return fetch(new Request(url, { credentials: "omit", cache: immutable ? "force-cache" : "no-cache", redirect: "error" }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await reportPublicReleaseV241("started", "ok");
    try {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(INSTALL_URLS.map(async (path) => {
        const url = new URL(path, self.location.origin).href;
        const response = await fetchPublicAsset(url);
        if (!mayCacheResponse(response, url)) throw new Error("Public offline asset was not cacheable.");
        await cache.put(url, response);
      }));
      await prepareLegacyNavigationsV240();
      await reportPublicReleaseV241("prepared", releaseRepairsV241 ? "cache_repaired" : "ok");
    } catch (error) {
      await reportPublicReleaseV241("blocked", releaseFailureV241 || "install_failed");
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Normal activation means the previous worker no longer owns open pages.
    // Start with this installation's shell, never a pointer from an older build.
    const names = await caches.keys();
    const current = await caches.open(CACHE_NAME);
    for (const name of names.filter((value) => (value.startsWith(CACHE_PREFIX) || value === RELEASE_CACHE_V240) && value !== CACHE_NAME)) {
      const previous = await caches.open(name);
      // Copy only exact currently allowlisted content-fingerprinted JS/CSS.
      // Changed builds, APIs, HTML, cookies and user photos cannot be reused.
      for (const request of await previous.keys()) {
        const url = new URL(request.url);
        if (!PUBLIC_URLS.has(url.href) || !/\.(?:js|css)$/.test(url.pathname) ||
            !/^[a-f0-9]{16}$/.test(url.searchParams.get("build") || "") || await current.match(request.url)) continue;
        const response = await previous.match(request.url);
        if (response && mayCacheResponse(response,url.href)) await current.put(request.url,response);
      }
      await caches.delete(name);
    }
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
  const url = new URL(request.url);
  if (HAS_PUBLIC_SHELL && (url.pathname === "/" || url.pathname === "/index.html") && !url.search) {
    const current = await (await caches.open(RELEASE_CACHE_V240)).match(RELEASE_KEY_V240);
    if (current && /^[a-f0-9]{64}$/.test(current.headers.get("x-js-public-shell-sha-v240") || "") &&
        /^[a-f0-9]{24}$/.test(current.headers.get("x-js-public-shell-build-v240") || "")) return current;
    const cache = await caches.open(CACHE_NAME);
    const shell = await cache.match(new URL(SHELL_URL, self.location.origin).href);
    // Only credential-free, hash-verified public markup, including a later
    // release prepared in the background. Never swap JS/CSS in a running page.
    // Never cache or replay a user's authenticated navigation response. Login,
    // revocation and account isolation still require the live /api/session.
    if (shell) return shell;
  }
  try {
    // Non-app URLs retain their existing network/offline behavior.
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
    if (["/", "/index.html"].includes(url.pathname)) event.waitUntil(checkPublicReleaseV240());
    event.respondWith(navigationResponse(request));
    return;
  }
  if (PUBLIC_URLS.has(url.href)) event.respondWith(publicAssetResponse(request));
  else if (/^\/(?:js|css)\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(url.pathname) && /^[a-f0-9]{16}$/.test(url.searchParams.get("build") || "")) {
    event.respondWith((async () => {
      const cached = await (await caches.open(RELEASE_CACHE_V240)).match(url.href);
      const sha = cached?.headers.get("x-js-public-asset-sha-v240") || "";
      if (/^[a-f0-9]{64}$/.test(sha) && sha.slice(0, 16) === url.searchParams.get("build")) return cached;
      return fetch(request);
    })());
  }
});
