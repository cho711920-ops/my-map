import { requireSameOrigin, requireSession, sendError } from "./_lib/security.js";

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
      response = await fetch(upstreamUrl({ ...req.query, owner: user.email || "" }), { redirect: "follow", cache: "no-store" });
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
