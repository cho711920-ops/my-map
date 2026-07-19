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
    await requireSession(req);
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();
    if (req.method === "POST") requireSameOrigin(req);

    let response;
    if (req.method === "GET") {
      response = await fetch(upstreamUrl(req.query), { redirect: "follow", cache: "no-store" });
    } else {
      const secret = process.env.APPS_SCRIPT_PROXY_SECRET;
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      response = await fetch(upstreamUrl({}), {
        method: "POST",
        redirect: "follow",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...body, proxySecret: secret })
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
