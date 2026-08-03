import { createHash } from "node:crypto";
import { requireSession, sendError } from "./_lib/security.js";

const SHEET_MEMORY_CACHE_MS = Math.max(
  5000,
  Number(process.env.SHEET_MEMORY_CACHE_MS || 120000)
);

let sheetCache = {
  body: "",
  etag: "",
  fetchedAt: 0
};

function sheetEtag(body) {
  return `"${createHash("sha256").update(body).digest("base64url")}"`;
}

async function fetchSheetCsv(forceFresh) {
  const now = Date.now();
  if (
    !forceFresh &&
    sheetCache.body &&
    now - sheetCache.fetchedAt < SHEET_MEMORY_CACHE_MS
  ) {
    return sheetCache;
  }

  const base = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_PROXY_SECRET;
  if (!base || !secret) throw new Error("시트 프록시 환경 변수가 설정되지 않았습니다.");

  const url = new URL(base);
  url.searchParams.set("action", "sheetCsv");
  url.searchParams.set("proxySecret", secret);
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  const body = await response.text();
  if (!response.ok) throw new Error("시트 데이터를 불러오지 못했습니다.");

  sheetCache = {
    body,
    etag: sheetEtag(body),
    fetchedAt: Date.now()
  };
  return sheetCache;
}

export default async function handler(req, res) {
  try {
    await requireSession(req);
    if (req.method !== "GET") return res.status(405).end();

    const forceFresh = String(req.headers["x-js-force-refresh"] || "") === "1";
    const result = await fetchSheetCsv(forceFresh);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Vary", "Cookie, Accept-Encoding");
    res.setHeader("ETag", result.etag);

    if (String(req.headers["if-none-match"] || "") === result.etag) {
      return res.status(304).end();
    }

    return res.status(200).send(result.body);
  } catch (error) {
    return sendError(res, error);
  }
}
