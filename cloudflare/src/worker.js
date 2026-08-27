import {
  authenticateLocalAccount,
  clearSessionCookieHeader,
  createSessionToken,
  requireSameOrigin,
  requireSession,
  sessionCookieHeader,
  verifyGoogleCredential
} from "./security.js";
import { handlePermitLeaseLegal, handlePermitPublicData } from "./permit-api.js";
import { getBuildingRegister, getElevatorCapacityForListing } from "./building-register-api.js";
import { runScheduledElevatorEnrichment } from "./elevator-enrichment.js";
import { getCommercialArea } from "./commercial-area-api.js";
import { getRegionalMarket } from "./regional-market-api.js";
import {
  handleCollectorAdminGet,
  handleCollectorAdminPost,
  handleCollectorApi,
  runScheduledReviewRepair
} from "./collector-api.js";
import {
  adjustOperationsDashboard,
  buildD1SheetCsv,
  handleD1GetAction,
  handleD1PostAction,
  refreshOperationsDashboard
} from "./d1-api.js";

const QUEUE_CLIENT_VERSION = "1.0.8";
const UPSTREAM_TIMEOUT_MS = 20_000;
const D1_SHEET_CACHE_KEY = "api-cache/d1-sheet.csv";
const GEOCODE_CACHE_KEY = "api-cache/geocode-cache.json";
const UNIFIED_LISTINGS_CACHE_KEY = "api-cache/unified-listings-v5-source-aware-review.json";
const OPERATIONS_DASHBOARD_CACHE_KEY = "api-cache/operations-dashboard.json";
const LISTINGS_REVISION_KEY = "api-cache/revision/listings.json";
const OPERATIONS_REVISION_KEY = "api-cache/revision/operations.json";
const SHEET_CACHE_ACTIONS = new Set([
  "deleteProperty", "moveOriginalListing", "quickAdd", "restoreListingHistory", "toggleDone", "updateProperty", "updatePropertyMemo"
]);
const UNIFIED_CACHE_ACTIONS = new Set(["moveOriginalListing"]);
const OPERATIONS_CACHE_ACTIONS = new Set([
  "addCustomerActivity", "deleteCustomer", "deleteProperty", "moveOriginalListing", "quickAdd",
  "rebuildCustomerMatches", "restoreListingHistory", "saveCustomer", "toggleDone", "updateCustomerMatch", "updateProperty"
]);
const BROWSER_REVALIDATED_ACTIONS = new Set(["unifiedListings", "geocodeCache"]);
const UNIFIED_COMPACT_FIELDS = [
  "originalId", "source", "link", "room", "deposit", "rent", "fee", "premium", "area",
  "thumbnail", "photoCount", "contactCount", "revision"
];
const IMAGE_CACHE_HOSTS = new Set([
  "img.kr.gcp-karroter.net",
  "landthumb-phinf.pstatic.net",
  "dnvefa72aowie.cloudfront.net",
  "file1.gongsilbox.com"
]);
let sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function errorResponse(error) {
  const status = Number(error?.statusCode) || 500;
  return json({
    ok: false,
    message: status >= 500
      ? String(error?.publicMessage || "서버 보안 설정을 확인해 주세요.")
      : String(error?.message || "요청에 실패했습니다.")
  }, status, { "cache-control": "no-store" });
}

function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(self)");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  const path = new URL(request.url).pathname;
  if (path === "/" || path.endsWith(".html")) {
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function fetchWithTimeout(url, options = {}, timeout = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sha256Etag(body) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `"${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}"`;
}

async function sha256Key(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cacheAgeMs(object) {
  const savedAt = Number(object?.customMetadata?.savedAt || 0);
  return savedAt > 0 ? Date.now() - savedAt : Number.POSITIVE_INFINITY;
}

async function readR2TextCache(env, key, maxAgeMs) {
  if (!env.MEDIA || typeof env.MEDIA.get !== "function") return null;
  const object = await env.MEDIA.get(key);
  if (!object || cacheAgeMs(object) > maxAgeMs) return null;
  return {
    body: await object.text(),
    contentType: object.httpMetadata?.contentType || "application/json; charset=utf-8"
  };
}

function writeR2TextCache(env, context, key, body, contentType) {
  if (!env.MEDIA || typeof env.MEDIA.put !== "function") return;
  const task = env.MEDIA.put(key, body, {
    httpMetadata: { contentType: contentType || "application/json; charset=utf-8" },
    customMetadata: { savedAt: String(Date.now()) }
  });
  if (context && typeof context.waitUntil === "function") context.waitUntil(task);
}

function revisionKey(scope) {
  return String(scope || "").trim().toLowerCase() === "operations"
    ? OPERATIONS_REVISION_KEY
    : LISTINGS_REVISION_KEY;
}

async function readDataRevision(env, scope) {
  const normalizedScope = revisionKey(scope) === OPERATIONS_REVISION_KEY ? "operations" : "listings";
  const cached = await readR2TextCache(env, revisionKey(normalizedScope), 10 * 365 * 24 * 60 * 60_000);
  if (cached) {
    try {
      const payload = JSON.parse(cached.body);
      if (payload && payload.revision) return {
        ok: true,
        scope: normalizedScope,
        revision: String(payload.revision),
        changeIds: Array.isArray(payload.changeIds) ? payload.changeIds.slice(0, 50) : [],
        fullReload: payload.fullReload === true,
        changeAction: String(payload.changeAction || "")
      };
    } catch {}
  }
  return { ok: true, scope: normalizedScope, revision: "0" };
}

function touchDataRevision(env, context, scopes, afterPromise = null, changeInfo = {}) {
  if (!env.MEDIA || typeof env.MEDIA.put !== "function") return null;
  const token = `${Date.now()}-${crypto.randomUUID()}`;
  const task = Promise.resolve(afterPromise).then(() => Promise.all(
    [...new Set(scopes || [])].map((scope) => {
      const normalizedScope = scope === "operations" ? "operations" : "listings";
      return env.MEDIA.put(revisionKey(normalizedScope), JSON.stringify({
        ok: true,
        scope: normalizedScope,
        revision: token,
        ...(normalizedScope === "listings" ? {
          changeIds: Array.isArray(changeInfo.changeIds) ? changeInfo.changeIds.slice(0, 50) : [],
          fullReload: changeInfo.fullReload === true,
          changeAction: String(changeInfo.changeAction || "")
        } : {})
      }), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { savedAt: String(Date.now()) }
      });
    })
  ));
  if (context && typeof context.waitUntil === "function") context.waitUntil(task);
  return task;
}

function deleteR2Cache(env, context, keys) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!env.MEDIA || typeof env.MEDIA.delete !== "function" || !uniqueKeys.length) return null;
  const task = env.MEDIA.delete(uniqueKeys);
  if (context && typeof context.waitUntil === "function") context.waitUntil(task);
  return task;
}

function unifiedDetailCacheKey(propertyId) {
  const safe = String(propertyId || "").trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(safe) ? `api-cache/unified-detail-v5-sale-metadata/${safe}.json` : "";
}

function mutationAction(body) {
  const action = String(body?.action || "").trim();
  return action === "enqueueMutation" ? String(body?.taskAction || "").trim() : action;
}

function mutationCacheKeys(body, result = {}) {
  const action = mutationAction(body);
  const keys = [];
  if (SHEET_CACHE_ACTIONS.has(action)) keys.push(D1_SHEET_CACHE_KEY);
  if (UNIFIED_CACHE_ACTIONS.has(action)) keys.push(UNIFIED_LISTINGS_CACHE_KEY);
  if (OPERATIONS_CACHE_ACTIONS.has(action)) keys.push(OPERATIONS_DASHBOARD_CACHE_KEY);
  if (action === "saveGeocodeCache") keys.push(GEOCODE_CACHE_KEY);
  if (action === "moveOriginalListing") {
    keys.push(
      unifiedDetailCacheKey(result?.sourceMasterId),
      unifiedDetailCacheKey(result?.targetMasterId)
    );
  }
  return keys.filter(Boolean);
}

function collectorFinalized(action, payload) {
  if (action === "finalizeNaverSession" || action === "finalizeCollectionSession") return true;
  return action === "danggeunRunJobChunk" &&
    (payload?.job?.phase === "complete" || payload?.job?.status === "complete");
}

function compactUnifiedListingsBody(body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return body;
  }
  if (!payload || payload.format === "compact-v2" || !payload.groups || typeof payload.groups !== "object") {
    return body;
  }
  const sourceFields = payload.format === "compact-v1" && Array.isArray(payload.fields)
    ? payload.fields
    : null;
  const groups = {};
  for (const [propertyId, originals] of Object.entries(payload.groups)) {
    groups[propertyId] = (Array.isArray(originals) ? originals : []).map((original) => {
      const values = UNIFIED_COMPACT_FIELDS.map((field) => {
        if (sourceFields && Array.isArray(original)) {
          const index = sourceFields.indexOf(field);
          return index >= 0 ? original[index] ?? "" : "";
        }
        return original?.[field] ?? "";
      });
      while (values.length && values[values.length - 1] === "") values.pop();
      return values;
    });
  }
  return JSON.stringify({
    ok: payload.ok !== false,
    version: payload.version || 1,
    format: "compact-v2",
    fields: UNIFIED_COMPACT_FIELDS,
    groups,
    originalCount: Number(payload.originalCount || 0)
  });
}

async function handleListingImage(request, env, context) {
  await requireSession(request, env);
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const sourceValue = new URL(request.url).searchParams.get("url") || "";
  let source;
  try {
    source = new URL(sourceValue);
  } catch {
    throw Object.assign(new Error("Invalid image URL."), { statusCode: 400 });
  }
  if (source.protocol !== "https:" || !IMAGE_CACHE_HOSTS.has(source.hostname.toLowerCase())) {
    throw Object.assign(new Error("Image host is not allowed."), { statusCode: 403 });
  }

  const key = `images/external/${await sha256Key(source.toString())}`;
  if (env.MEDIA && typeof env.MEDIA.get === "function") {
    const cached = await env.MEDIA.get(key);
    if (cached) {
      const headers = new Headers();
      if (typeof cached.writeHttpMetadata === "function") cached.writeHttpMetadata(headers);
      if (!headers.get("content-type") && cached.httpMetadata?.contentType) {
        headers.set("content-type", cached.httpMetadata.contentType);
      }
      headers.set("cache-control", "private, max-age=604800, immutable");
      headers.set("x-js-image-cache", "HIT");
      if (cached.httpEtag) headers.set("etag", cached.httpEtag);
      return new Response(cached.body, { headers });
    }
  }

  const response = await fetchWithTimeout(source, {
    redirect: "follow",
    cache: "no-store",
    headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" }
  }, 25_000);
  const finalUrl = new URL(response.url || source);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (!response.ok || !IMAGE_CACHE_HOSTS.has(finalUrl.hostname.toLowerCase()) || !contentType.startsWith("image/")) {
    throw Object.assign(new Error("The source image could not be loaded."), { statusCode: 502 });
  }
  if (declaredSize > 12 * 1024 * 1024) {
    throw Object.assign(new Error("The source image is too large."), { statusCode: 413 });
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > 12 * 1024 * 1024) {
    throw Object.assign(new Error("The source image is too large."), { statusCode: 413 });
  }
  // R2 lifecycle expiration bounds storage. Keeping D1 out of this hot path avoids
  // one aggregate read and one counter write before every newly fetched image.
  const mayStore = env.MEDIA && typeof env.MEDIA.put === "function";
  if (mayStore) {
    const task = env.MEDIA.put(key, body, {
      httpMetadata: { contentType, cacheControl: "private, max-age=604800, immutable" },
      customMetadata: { savedAt: String(Date.now()), sourceHost: finalUrl.hostname.toLowerCase() }
    });
    if (context && typeof context.waitUntil === "function") context.waitUntil(task);
  }
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=604800, immutable",
      "x-js-image-cache": mayStore ? "MISS" : "MISS-NOSTORE"
    }
  });
}

async function handleSession(request, env) {
  if (request.method === "GET") {
    const user = await requireSession(request, env);
    const headers = { "cache-control": "no-store" };
    if (!user.authType) {
      const upgradedUser = { ...user, authType: "google" };
      headers["set-cookie"] = sessionCookieHeader(await createSessionToken(upgradedUser, env), env);
    }
    return json({ ok: true, email: user.email || "", displayName: user.displayName || "",
      role: user.role || "member", authType: user.authType || "google",
      username: user.username || "" }, 200, headers);
  }
  requireSameOrigin(request);
  if (request.method === "DELETE") {
    return json({ ok: true }, 200, {
      "cache-control": "no-store",
      "set-cookie": clearSessionCookieHeader(env)
    });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST, DELETE" } });
  const body = await request.json().catch(() => ({}));
  const loginType = String(body.loginType || "google").trim().toLowerCase();
  const user = loginType === "local"
    ? await authenticateLocalAccount(body.username, body.password, env)
    : await verifyGoogleCredential(String(body.credential || body.idToken || ""), env);
  const token = await createSessionToken(user, env);
  return json({ ok: true, email: user.email, authType: user.authType || "google",
    username: user.username || "" }, 200, {
    "cache-control": "no-store",
    "set-cookie": sessionCookieHeader(token, env)
  });
}

async function handleSheet(request, env, context) {
  await requireSession(request, env);
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const now = Date.now();
  const ttl = Math.max(5_000, Number(env.SHEET_MEMORY_CACHE_MS || 120_000));
  const r2Ttl = Math.max(ttl, Number(env.SHEET_R2_CACHE_MS || 5 * 60_000));
  const forceFresh = request.headers.get("x-js-force-refresh") === "1";
  if (!env.DB) throw Object.assign(new Error("D1 데이터베이스 연결을 확인해주세요."), { statusCode: 503 });
  const cacheKey = D1_SHEET_CACHE_KEY;
  if (forceFresh || !sheetCache.body || sheetCache.key !== cacheKey || now - sheetCache.fetchedAt >= ttl) {
    const cached = forceFresh ? null : await readR2TextCache(env, cacheKey, r2Ttl);
    if (cached) {
      sheetCache = { body: cached.body, etag: await sha256Etag(cached.body), fetchedAt: Date.now(), key: cacheKey };
    } else {
      const body = await buildD1SheetCsv(env);
      sheetCache = { body, etag: await sha256Etag(body), fetchedAt: Date.now(), key: cacheKey };
      writeR2TextCache(env, context, cacheKey, body, "text/csv; charset=utf-8");
    }
  }
  if (request.headers.get("if-none-match") === sheetCache.etag) {
    return new Response(null, { status: 304, headers: { etag: sheetCache.etag } });
  }
  return new Response(sheetCache.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "private, max-age=0, must-revalidate",
      vary: "Cookie, Accept-Encoding",
      etag: sheetCache.etag,
      "x-js-data-source": "D1"
    }
  });
}

function legacyQueueGuard() {
  return json({
    ok: true,
    action: "workQueueStatus",
    completed: 0,
    processing: 0,
    pending: 0,
    failed: 0,
    jobs: [],
    legacyGuard: true
  }, 200, { "x-js-legacy-poll-guard": "1", "cache-control": "private, no-store" });
}

function jsonp(callback, payload, headers = {}) {
  const safe = /^[A-Za-z_$][\w$]{0,127}$/.test(String(callback || "")) ? String(callback) : "";
  return new Response(safe ? `${safe}(${JSON.stringify(payload)});` : JSON.stringify(payload), {
    headers: {
      "content-type": safe ? "application/javascript; charset=utf-8" : "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      ...headers
    }
  });
}

function requestEtagMatches(request, etag) {
  const candidate = String(request.headers.get("if-none-match") || "");
  if (!candidate || !etag) return false;
  return candidate.split(",").some((value) => {
    const normalized = value.trim();
    return normalized === "*" || normalized === etag || normalized.replace(/^W\//, "") === etag;
  });
}

async function revalidatedPrivateResponse(request, body, contentType, headers = {}) {
  const etag = await sha256Etag(body);
  const responseHeaders = {
    "content-type": contentType || "application/json; charset=utf-8",
    "cache-control": "private, max-age=0, must-revalidate",
    vary: "Cookie, Accept-Encoding",
    etag,
    ...headers
  };
  if (requestEtagMatches(request, etag)) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }
  return new Response(body, { headers: responseHeaders });
}

async function handleDataApi(request, env, context) {
  const user = await requireSession(request, env);
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  }
  if (request.method === "POST") requireSameOrigin(request);

  if (request.method === "GET") {
    const incoming = new URL(request.url);
    const query = Object.fromEntries(incoming.searchParams.entries());
    delete query._;
    query.owner = user.email || "";
    if (query.action === "dataRevision") {
      return jsonp(query.callback, await readDataRevision(env, query.scope), {
        "cache-control": "private, no-store",
        "x-js-data-source": "R2-REVISION"
      });
    }
    const collectorAdmin = await handleCollectorAdminGet(env, user, query);
    if (collectorAdmin) {
      return jsonp(query.callback, collectorAdmin, {
        "cache-control": "private, no-store",
        "x-js-data-source": "D1"
      });
    }
    if (query.action === "buildingRegister") {
      return jsonp(query.callback, await getBuildingRegister(env, query), {
        "cache-control": "private, no-store",
        "x-js-data-source": "D1+PUBLIC-DATA"
      });
    }
    if (query.action === "elevatorCapacity") {
      const result = await getElevatorCapacityForListing(env, query);
      if (result?.persisted) {
        sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };
        const invalidation = deleteR2Cache(env, null, [D1_SHEET_CACHE_KEY]);
        const revisionUpdate = touchDataRevision(env, context, ["listings"], invalidation, {
          changeIds: [result.propertyId].filter(Boolean),
          changeAction: "elevatorCapacity"
        });
        if (context && typeof context.waitUntil === "function") context.waitUntil(invalidation);
        else await Promise.all([invalidation, revisionUpdate].filter(Boolean));
      }
      return jsonp(query.callback, result, {
        "cache-control": "private, no-store",
        "x-js-data-source": "D1+ELEVATOR-PUBLIC-DATA"
      });
    }
    if (query.action === "commercialArea") {
      return jsonp(query.callback, await getCommercialArea(env, query), {
        "cache-control": "private, no-store",
        "x-js-data-source": "PUBLIC-DATA"
      });
    }
    if (query.action === "regionalMarket") {
      return jsonp(query.callback, await getRegionalMarket(env, query), {
        "cache-control": "private, no-store",
        "x-js-data-source": "SGIS+R-ONE"
      });
    }
    if (query.action === "workQueueStatus" && query.client !== QUEUE_CLIENT_VERSION) return legacyQueueGuard();
    const detailCacheKey = query.action === "unifiedListingDetail"
      ? unifiedDetailCacheKey(query.propertyId)
      : "";
    const r2CacheKey = query.action === "unifiedListings"
      ? UNIFIED_LISTINGS_CACHE_KEY
      : query.action === "geocodeCache"
        ? GEOCODE_CACHE_KEY
        : query.action === "operationsDashboard"
          ? OPERATIONS_DASHBOARD_CACHE_KEY
          : detailCacheKey;
    if (r2CacheKey) {
      const defaultTtl = query.action === "unifiedListings"
        ? 60 * 60_000
        : query.action === "geocodeCache"
          ? 60 * 60_000
          : 60 * 60_000;
      const configuredTtl = query.action === "unifiedListings"
        ? Number(env.UNIFIED_LISTINGS_CACHE_MS || defaultTtl)
        : query.action === "geocodeCache"
          ? Number(env.GEOCODE_CACHE_MS || defaultTtl)
          : query.action === "operationsDashboard"
            ? Number(env.OPERATIONS_DASHBOARD_CACHE_MS || defaultTtl)
            : Number(env.UNIFIED_DETAIL_CACHE_MS || defaultTtl);
      const cached = await readR2TextCache(env, r2CacheKey, Math.max(30_000, configuredTtl));
      if (cached) {
        const cachedBody = query.action === "unifiedListings"
          ? compactUnifiedListingsBody(cached.body)
          : cached.body;
        if (cachedBody !== cached.body) {
          writeR2TextCache(env, context, r2CacheKey, cachedBody, cached.contentType);
        }
        if (BROWSER_REVALIDATED_ACTIONS.has(query.action) && !query.callback) {
          return revalidatedPrivateResponse(request, cachedBody, cached.contentType, {
            "x-js-data-cache": "HIT"
          });
        }
        return new Response(cachedBody, {
          headers: {
            "content-type": cached.contentType,
            "cache-control": "private, no-store",
            "x-js-data-cache": "HIT"
          }
        });
      }
    }
    const payload = await handleD1GetAction(env, user, query);
    if (!payload) {
      return jsonp(query.callback, { ok: false, action: query.action, message: "지원하지 않는 서버 작업입니다." }, {
        "x-js-data-source": "D1"
      });
    }
    const responseText = JSON.stringify(payload);
    if (r2CacheKey) writeR2TextCache(env, context, r2CacheKey, responseText, "application/json; charset=utf-8");
    if (BROWSER_REVALIDATED_ACTIONS.has(query.action) && !query.callback) {
      return revalidatedPrivateResponse(request, responseText, "application/json; charset=utf-8", {
        "x-js-data-source": "D1",
        ...(r2CacheKey ? { "x-js-data-cache": "MISS" } : {})
      });
    }
    return jsonp(query.callback, payload, {
      "x-js-data-source": "D1",
      ...(r2CacheKey ? { "x-js-data-cache": "MISS" } : {})
    });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2 * 1024 * 1024) {
    throw Object.assign(new Error("한 번에 보낼 수 있는 요청 크기를 초과했습니다."), { statusCode: 413 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("잘못된 요청 형식입니다."), { statusCode: 400 });
  }
  const collectorAdmin = await handleCollectorAdminPost(env, user, body);
  if (collectorAdmin) {
    sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };
    const wholeMergeDetailKeys = String(body.action || "") === "consolidateExistingMasters"
      ? [body.primaryMasterId, ...(Array.isArray(body.duplicateMasterIds) ? body.duplicateMasterIds : [])]
        .map(unifiedDetailCacheKey).filter(Boolean)
      : [];
    const collectorDetailKeys = (Array.isArray(collectorAdmin.affectedListingIds)
      ? collectorAdmin.affectedListingIds : []).map(unifiedDetailCacheKey).filter(Boolean);
    const snapshotUpdate = collectorAdmin.operationRefresh
      ? refreshOperationsDashboard(env)
      : adjustOperationsDashboard(env, collectorAdmin.operationAdjustments || {});
    const invalidation = Promise.resolve(snapshotUpdate).catch(() => null).then(() => {
      return deleteR2Cache(env, null, [
        D1_SHEET_CACHE_KEY, UNIFIED_LISTINGS_CACHE_KEY, OPERATIONS_DASHBOARD_CACHE_KEY,
        ...wholeMergeDetailKeys, ...collectorDetailKeys
      ]);
    });
    if (String(body.action || "") === "consolidateExistingMasters") {
      await invalidation;
    } else if (context && typeof context.waitUntil === "function") {
      context.waitUntil(invalidation);
    }
    touchDataRevision(env, context, ["listings", "operations"], invalidation, { fullReload: true,
      changeAction: String(body.action || "collectorAdmin") });
    return json(collectorAdmin, 200, { "cache-control": "no-store", "x-js-write-path": "D1" });
  }
  const d1Result = await handleD1PostAction(env, user, body);
  if (!d1Result) return json({ ok: false, action: body.action, message: "지원하지 않는 저장 작업입니다." }, 400);
  if (SHEET_CACHE_ACTIONS.has(mutationAction(body))) {
    sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };
  }
  const invalidatedKeys = mutationCacheKeys(body, d1Result);
  const operationSnapshot = invalidatedKeys.includes(OPERATIONS_DASHBOARD_CACHE_KEY)
    ? (d1Result.operationAdjustments
      ? adjustOperationsDashboard(env, d1Result.operationAdjustments)
      : refreshOperationsDashboard(env))
    : null;
  const invalidation = Promise.resolve(operationSnapshot).catch(() => null).then(() => {
    return deleteR2Cache(env, null, invalidatedKeys);
  });
  if (mutationAction(body) === "moveOriginalListing") {
    await invalidation;
  } else if (context && typeof context.waitUntil === "function") {
    context.waitUntil(invalidation);
  }
  const changedIds = [d1Result.propertyId, d1Result.sourceMasterId, d1Result.targetMasterId]
    .map((value) => String(value || "").trim()).filter(Boolean);
  touchDataRevision(env, context, [
    ...(invalidatedKeys.some((key) => key === D1_SHEET_CACHE_KEY || key === UNIFIED_LISTINGS_CACHE_KEY)
      ? ["listings"] : []),
    ...(invalidatedKeys.includes(OPERATIONS_DASHBOARD_CACHE_KEY) ? ["operations"] : [])
  ], invalidation, {
    changeIds: [...new Set(changedIds)],
    fullReload: !changedIds.length || mutationAction(body) === "moveOriginalListing",
    changeAction: mutationAction(body)
  });
  return json(d1Result, 200, { "cache-control": "no-store", "x-js-write-path": "D1" });
}

async function handleApi(request, env, context) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth-config") {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    return json({ googleClientId: String(env.GOOGLE_CLIENT_ID || ""), localLoginEnabled: true }, 200,
      { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/session") return handleSession(request, env);
  if (url.pathname === "/api/sheet") return handleSheet(request, env, context);
  if (url.pathname === "/api/collector") {
    const collectorBody = request.method === "POST"
      ? await request.clone().json().catch(() => ({}))
      : {};
    const response = await handleCollectorApi(request, env);
    const collectorPayload = response.ok
      ? await response.clone().json().catch(() => ({}))
      : {};
    if (response.ok && collectorFinalized(String(collectorBody?.action || ""), collectorPayload)) {
      sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };
      const invalidation = deleteR2Cache(env, null, [
        D1_SHEET_CACHE_KEY, UNIFIED_LISTINGS_CACHE_KEY, OPERATIONS_DASHBOARD_CACHE_KEY,
        GEOCODE_CACHE_KEY
      ]);
      const revisionUpdate = touchDataRevision(env, null, ["listings", "operations"], invalidation, {
        fullReload: true,
        changeAction: String(collectorBody?.action || "collectorFinalized")
      });
      /*
       * 수집 완료 응답을 브라우저에 돌려주기 전에 목록 캐시와 리비전을 확정합니다.
       * 이전처럼 waitUntil에만 맡기면 수집기는 완료됐지만 웹 목록이 과거 R2 캐시를
       * 다시 읽는 짧은 경합 구간이 생길 수 있습니다.
       */
      await Promise.all([invalidation, revisionUpdate]);
      if (context && typeof context.waitUntil === "function") {
        context.waitUntil(Promise.resolve(refreshOperationsDashboard(env)).catch(() => null));
        context.waitUntil(runElevatorEnrichmentMaintenance(env, context, "collectorElevatorEnrichment"));
      }
    }
    return response;
  }
  if (url.pathname === "/api/data") return handleDataApi(request, env, context);
  if (url.pathname === "/api/listing-image") return handleListingImage(request, env, context);
  if (url.pathname === "/api/permit-public-data") return handlePermitPublicData(request, env);
  if (url.pathname === "/api/permit-lease-legal") return handlePermitLeaseLegal(request, env);
  if (url.pathname === "/api/naver-maps-config") {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    const key = String(env.NAVER_MAPS_NCP_KEY_ID || "").trim();
    return key
      ? json({ enabled: true, ncpKeyId: key }, 200, { "cache-control": "no-store" })
      : json({ enabled: false, error: "NAVER_MAPS_NOT_CONFIGURED" }, 503, { "cache-control": "no-store" });
  }
  return json({ ok: false, message: "API 경로를 찾을 수 없습니다." }, 404, { "cache-control": "no-store" });
}

async function runScheduledMaintenance(env, context) {
  const review = await runScheduledReviewRepair(env);
  const elevator = await runScheduledElevatorEnrichment(env);
  const reviewChanged = Number(review?.merged || 0) + Number(review?.created || 0) + Number(review?.duplicate || 0);
  const elevatorChanged = Number(elevator?.changed || 0);
  if (!reviewChanged && !elevatorChanged) return { review, elevator };
  const snapshotUpdate = reviewChanged
    ? adjustOperationsDashboard(env, review.operationAdjustments || {})
    : null;
  const invalidation = Promise.resolve(snapshotUpdate).catch(() => null).then(() => {
    return deleteR2Cache(env, null, [
      D1_SHEET_CACHE_KEY,
      ...(reviewChanged ? [UNIFIED_LISTINGS_CACHE_KEY, OPERATIONS_DASHBOARD_CACHE_KEY,
        ...(Array.isArray(review?.affectedListingIds)
          ? review.affectedListingIds.map(unifiedDetailCacheKey).filter(Boolean) : [])] : [])
    ]);
  });
  await invalidation;
  sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };
  await touchDataRevision(env, null, reviewChanged ? ["listings", "operations"] : ["listings"], null, {
    changeIds: elevator?.changedIds || [],
    fullReload: reviewChanged,
    changeAction: reviewChanged ? "scheduledReviewRepair" : "scheduledElevatorEnrichment"
  });
  return { review, elevator };
}

async function runElevatorEnrichmentMaintenance(env, context, changeAction) {
  const result = await runScheduledElevatorEnrichment(env);
  if (!Number(result?.changed || 0)) return result;
  sheetCache = { body: "", etag: "", fetchedAt: 0, key: "" };
  const invalidation = deleteR2Cache(env, null, [D1_SHEET_CACHE_KEY]);
  await invalidation;
  await touchDataRevision(env, context, ["listings"], null, {
    changeIds: result.changedIds || [],
    changeAction
  });
  return result;
}

export default {
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);
      const response = url.pathname.startsWith("/api/")
        ? await handleApi(request, env, context)
        : await env.ASSETS.fetch(request);
      return withSecurityHeaders(response, request);
    } catch (error) {
      const url = new URL(request.url);
      if (url.pathname === "/api/data" && ["buildingRegister", "elevatorCapacity"].includes(url.searchParams.get("action"))) {
        console.error("official-public-data request failed", {
          action: url.searchParams.get("action"),
          message: String(error?.message || error),
          statusCode: Number(error?.statusCode) || 500
        });
      }
      const callback = url.pathname === "/api/data" ? url.searchParams.get("callback") : "";
      if (callback) {
        const status = Number(error?.statusCode) || 500;
        const publicMessage = status >= 500
          ? String(error?.publicMessage || error?.message || "서버 설정을 확인해 주세요.")
          : String(error?.message || "요청에 실패했습니다.");
        return withSecurityHeaders(jsonp(callback, {
          ok: false,
          message: publicMessage,
          errorType: status >= 500 ? "upstream" : "request"
        }), request);
      }
      return withSecurityHeaders(errorResponse(error), request);
    }
  },
  async scheduled(_event, env, context) {
    context.waitUntil(runScheduledMaintenance(env, context));
  }
};
