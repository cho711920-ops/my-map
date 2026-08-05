import {
  clearSessionCookieHeader,
  createSessionToken,
  requireSameOrigin,
  requireSession,
  sessionCookieHeader,
  verifyGoogleCredential
} from "./security.js";

const QUEUE_CLIENT_VERSION = "1.0.8";
const BUILDING_CLIENT_VERSION = "8.1.1";
const UPSTREAM_TIMEOUT_MS = 20_000;
let sheetCache = { body: "", etag: "", fetchedAt: 0 };
const statusCache = new Map();
const statusInFlight = new Map();

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
    message: status >= 500 ? "서버 보안 설정을 확인해 주세요." : String(error?.message || "요청에 실패했습니다.")
  }, status, { "cache-control": "no-store" });
}

function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
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

function upstreamUrl(env, query = {}) {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_PROXY_SECRET) {
    throw new Error("Apps Script 연결 환경 변수가 설정되지 않았습니다.");
  }
  const url = new URL(env.APPS_SCRIPT_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && !Array.isArray(value)) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("proxySecret", env.APPS_SCRIPT_PROXY_SECRET);
  return url;
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

async function handleSession(request, env) {
  if (request.method === "GET") {
    const user = await requireSession(request, env);
    return json({ ok: true, email: user.email || "" }, 200, { "cache-control": "no-store" });
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
  const user = await verifyGoogleCredential(String(body.credential || body.idToken || ""), env);
  const token = await createSessionToken(user, env);
  return json({ ok: true, email: user.email }, 200, {
    "cache-control": "no-store",
    "set-cookie": sessionCookieHeader(token, env)
  });
}

async function handleSheet(request, env) {
  await requireSession(request, env);
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const now = Date.now();
  const ttl = Math.max(5_000, Number(env.SHEET_MEMORY_CACHE_MS || 120_000));
  const forceFresh = request.headers.get("x-js-force-refresh") === "1";
  if (forceFresh || !sheetCache.body || now - sheetCache.fetchedAt >= ttl) {
    const response = await fetch(upstreamUrl(env, { action: "sheetCsv" }), {
      redirect: "follow",
      cache: "no-store"
    });
    const body = await response.text();
    if (!response.ok) throw Object.assign(new Error("시트 데이터를 불러오지 못했습니다."), { statusCode: 502 });
    sheetCache = { body, etag: await sha256Etag(body), fetchedAt: Date.now() };
  }
  if (request.headers.get("if-none-match") === sheetCache.etag) {
    return new Response(null, { status: 304, headers: { etag: sheetCache.etag } });
  }
  return new Response(sheetCache.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "private, max-age=0, must-revalidate",
      vary: "Cookie, Accept-Encoding",
      etag: sheetCache.etag
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

async function workQueueStatus(url, owner) {
  const key = String(owner || "anonymous").toLowerCase();
  const cached = statusCache.get(key);
  if (cached && Date.now() - cached.savedAt < 15_000) return { ...cached, cacheHit: true };
  if (statusInFlight.has(key)) return statusInFlight.get(key);
  const pending = (async () => {
    const response = await fetchWithTimeout(url, { redirect: "follow", cache: "no-store" });
    const result = {
      savedAt: Date.now(),
      cacheHit: false,
      status: response.ok ? 200 : 502,
      contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
      text: await response.text()
    };
    statusCache.set(key, result);
    if (statusCache.size > 50) statusCache.delete(statusCache.keys().next().value);
    return result;
  })();
  statusInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    statusInFlight.delete(key);
  }
}

async function handleAppsScript(request, env) {
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
    if (query.action === "workQueueStatus" && query.client !== QUEUE_CLIENT_VERSION) return legacyQueueGuard();
    if (query.action === "buildingRegister" && query.mode === "summary" && query.client !== BUILDING_CLIENT_VERSION) {
      return jsonp(query.callback, {
        ok: true,
        action: "buildingRegister",
        buildings: [],
        recaps: [],
        units: [],
        buildingInfoCache: { ok: true, skipped: true },
        legacyGuard: true
      }, { "x-js-legacy-building-guard": "1" });
    }
    const url = upstreamUrl(env, query);
    if (query.action === "workQueueStatus") {
      const value = await workQueueStatus(url, user.email);
      return new Response(value.text, {
        status: value.status,
        headers: {
          "content-type": value.contentType,
          "cache-control": "private, no-store",
          "x-js-status-cache": value.cacheHit ? "HIT" : "MISS"
        }
      });
    }
    const options = { redirect: "follow", cache: "no-store" };
    const response = query.action === "buildingRegister" && query.mode === "summary"
      ? await fetchWithTimeout(url, options)
      : await fetch(url, options);
    return new Response(await response.text(), {
      status: response.ok ? 200 : 502,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
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
  const response = await fetch(upstreamUrl(env), {
    method: "POST",
    redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      ...body,
      owner: user.email || "",
      proxySecret: env.APPS_SCRIPT_PROXY_SECRET
    })
  });
  return new Response(await response.text(), {
    status: response.ok ? 200 : 502,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth-config") {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    return json({ googleClientId: String(env.GOOGLE_CLIENT_ID || "") }, 200, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/session") return handleSession(request, env);
  if (url.pathname === "/api/sheet") return handleSheet(request, env);
  if (url.pathname === "/api/apps-script") return handleAppsScript(request, env);
  if (url.pathname === "/api/naver-maps-config") {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    const key = String(env.NAVER_MAPS_NCP_KEY_ID || "").trim();
    return key
      ? json({ enabled: true, ncpKeyId: key }, 200, { "cache-control": "no-store" })
      : json({ enabled: false, error: "NAVER_MAPS_NOT_CONFIGURED" }, 503, { "cache-control": "no-store" });
  }
  return json({ ok: false, message: "API 경로를 찾을 수 없습니다." }, 404, { "cache-control": "no-store" });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const response = url.pathname.startsWith("/api/")
        ? await handleApi(request, env)
        : await env.ASSETS.fetch(request);
      return withSecurityHeaders(response, request);
    } catch (error) {
      return withSecurityHeaders(errorResponse(error), request);
    }
  }
};

