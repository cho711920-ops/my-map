import { requireSession, sendError } from "./_lib/security.js";

export default async function handler(req, res) {
  try {
    await requireSession(req);
    if (req.method !== "GET") return res.status(405).end();
    const base = process.env.APPS_SCRIPT_URL;
    const secret = process.env.APPS_SCRIPT_PROXY_SECRET;
    if (!base || !secret) throw new Error("시트 프록시 환경 변수가 설정되지 않았습니다.");

    const url = new URL(base);
    url.searchParams.set("action", "sheetCsv");
    url.searchParams.set("proxySecret", secret);
    const response = await fetch(url, { redirect: "follow", cache: "no-store" });
    const body = await response.text();
    if (!response.ok) throw new Error("시트 데이터를 불러오지 못했습니다.");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(200).send(body);
  } catch (error) {
    return sendError(res, error);
  }
}
