import { requireSameOrigin, requireSession, sendError } from "./_lib/security.js";

const STATUS_CACHE_TTL_MS = 15000;
const UPSTREAM_TIMEOUT_MS = 20000;
const statusCache = new Map();
const statusInFlight = new Map();

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWorkQueueStatus(url, owner) {
  const key = String(owner || "anonymous").toLowerCase();
  const cached = statusCache.get(key);
  if (cached && Date.now() - cached.savedAt < STATUS_CACHE_TTL_MS) {
    return { ...cached, cacheHit: true };
  }
  if (statusInFlight.has(key)) return statusInFlight.get(key);

  const pending = (async () => {
    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      cache: "no-store"
    });
    const value = {
      savedAt: Date.now(),
      cacheHit: false,
      status: response.ok ? 200 : 502,
      contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
      text: await response.text()
    };
    statusCache.set(key, value);
    if (statusCache.size > 50) statusCache.delete(statusCache.keys().next().value);
    return value;
  })();

  statusInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    statusInFlight.delete(key);
  }
}

function upstreamUrl(query) {
  const base = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_PROXY_SECRET;
  if (!base || !secret) throw new Error("Apps Script 프록시 환경 변수가 설정되지 않았습니다.");
  const url = new URL(base);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value != null && !Array.isArray(value)) url.searchParams.set(key, String(value));
  });
  url.searchParams.set("proxySecret", secret);
  return url;
}

export default async function handler(req, res) {
  try {
    const user = await requireSession(req);
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();
    if (req.method === "POST") requireSameOrigin(req);

    let response;
    if (req.method === "GET") {
      const query = { ...req.query, owner: user.email || "" };
      delete query._;
      if (String(query.action || "") === "workQueueStatus") {
        const value = await fetchWorkQueueStatus(upstreamUrl(query), user.email || "");
        res.setHeader("Content-Type", value.contentType);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-JS-Status-Cache", value.cacheHit ? "HIT" : "MISS");
        return res.status(value.status).send(value.text);
      }
      response = await fetch(upstreamUrl(query), { redirect: "follow", cache: "no-store" });
    } else {
      const contentLength = Number(req.headers["content-length"] || 0);
      if (contentLength > 2 * 1024 * 1024) {
        throw Object.assign(new Error("한 번에 보낼 수 있는 요청 크기를 초과했습니다."), { statusCode: 413 });
      }
      const secret = process.env.APPS_SCRIPT_PROXY_SECRET;
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("잘못된 요청 형식입니다."), { statusCode: 400 });
      }
      response = await fetch(upstreamUrl({}), {
        method: "POST",
        redirect: "follow",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...body, owner: user.email || "", proxySecret: secret })
      });
    }

    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";
    const text = await response.text();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    return res.status(response.ok ? 200 : 502).send(text);
  } catch (error) {
    return sendError(res, error);
  }
}
