// Test-only loopback server. Never proxy a request to an upstream or serve secrets.
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const fixtureRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const email = "browser-fixture@example.invalid";
export const fixtureItems = [
  {propertyId: "FIXTURE-LEASE-1", key: "fixture-lease-1", name: "테스트 괴정 상가", address: "대전 서구 괴정동 1-1", room: "1층", type: "상가", deposit: 2000, rent: 90, area: 25, tradeType: "lease"},
  {propertyId: "FIXTURE-LEASE-2", key: "fixture-lease-2", name: "테스트 탄방 상가", address: "대전 서구 탄방동 2-2", room: "2층", type: "상가", deposit: 3000, rent: 150, area: 40, tradeType: "lease"},
  {propertyId: "FIXTURE-BUILDING", key: "fixture-building", name: "테스트 건물매매", address: "대전 서구 괴정동 3-3", room: "건물전체", type: "건물", tradeType: "sale", saleCategory: "building", salePrice: 50000, area: 100,
    saleDetails: {landAreaM2: 330.5785, grossAreaM2: 661.157, totalDeposit: 5000, monthlyIncome: 200}},
  {propertyId: "FIXTURE-LAND", key: "fixture-land", name: "테스트 토지매매", address: "대전 유성구 장대동 4-4", room: "", type: "토지", tradeType: "sale", saleCategory: "land", salePrice: 30000, area: 100,
    saleDetails: {landAreaM2: 330.5785, landUse: "대", zoning: "일반주거지역"}}
].map((item) => ({fee: 0, premium: 0, memo: "브라우저 검사 전용 가상 자료", state: "active", source: "네이버", regDate: "2026-09-14", latitude: 36.35, longitude: 127.38, ...item}));
const folder = {id: "fixture-favorites", name: "테스트 찜폴더", itemKeys: ["property:FIXTURE-LEASE-1"], createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z"};
const scripts = ["data-access-v6.js", "phone-device-v1.js", "local-metrics-v1.js", "dialog-focus-v1.js", "unified-listings-v8.js", "commercial-brokerage-v1.js", "listing-trade-ui-v1.js", "sale-workbench-v1.js", "script.js", "parser.js", "quickadd-at.js", "property-edit-v648.js", "list-manager-v6.js", "unified-favorites-v7.js", "mobile-detail-fix-v6.js", "async-mutation-queue-v1.js", "mobile-app-v1.js", "phone-app-v2.js", "phone-device-check-v1.js"];

export async function fixtureHtml() {
  const index = await readFile(resolve(fixtureRoot, "index.html"), "utf8");
  const application = index.match(/<template id="jsAuthenticatedApplication">([\s\S]*?)<\/template>/)?.[1];
  if (!application) throw new Error("The production application template was not found");
  const styles = [...index.matchAll(/<link[^>]*href="(css\/[^"?]+\.css)(?:[^\"]*)"[^>]*>/g)]
    .map((match) => match[1]).filter((path) => !path.includes("auth-gate"));
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JS부동산 브라우저 검사 전용</title>' +
    styles.map((path) => `<link rel="stylesheet" href="/${path}">`).join("") +
    '<style>body.jsm-more-open-v1 #fixtureControls,body:has(.lm-modal.open,.unified-detail-drawer-v8.open,#v6DetailSheetPortal.open,#operationsCenter.open,dialog[open]) #fixtureControls{display:none!important}</style></head><body>' +
    application.replace('id="wrap" inert aria-hidden="true"', 'id="wrap"') +
    '<aside id="fixtureControls" style="position:fixed;left:12px;bottom:88px;z-index:50000;max-width:340px;background:white;padding:6px"><small>가상 데이터 검사</small><label><input type="checkbox" id="fixtureQuotaFailure">저장공간 오류 재현</label><button id="fixtureSave" type="button">저장 검사</button><span id="fixtureSaveResult" role="status"></span><small id="fixtureModules"></small></aside>' +
    `<script>window.JSAuthenticatedAccountEmail=${JSON.stringify(email)};window.__fixtureItems=${JSON.stringify(fixtureItems)};</script>` +
    scripts.map((name) => `<script src="/js/${name}"></script>`).join("") +
    '<script src="/__fixture/bootstrap.js"></script></body></html>';
}

export function createFixtureServer() {
  let failWrites = false;
  let jobs = [];
  const cloud = new Map();
  function originals(origin) {
    return Object.fromEntries(fixtureItems.map((item) => [item.propertyId, [{...item, originalId: item.propertyId + "-ORIGINAL", sourceId: item.propertyId,
      buildingName: item.name, monthlyRent: item.rent || 0, link: origin + "/original/" + item.propertyId, images: [], photoCount: 0, revision: 1}]]));
  }
  return createServer(async (request, response) => {
    const host = request.headers.host || "";
    if (!/^127\.0\.0\.1:\d+$/.test(host)) { response.writeHead(403); response.end("Loopback only"); return; }
    const url = new URL(request.url, "http://" + host);
    const send = (status, type, body) => {response.writeHead(status, {"content-type": type, "cache-control": "no-store", "x-js-browser-fixture": "1"}); response.end(body);};
    const json = (body, status = 200) => send(status, "application/json; charset=utf-8", JSON.stringify(body));
    try {
      if (url.pathname === "/__fixture/health") return json({ok: true, fixture: true});
      if (url.pathname === "/" && request.method === "GET") {
        failWrites = false; jobs = []; cloud.clear();
        response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-src 'none'; object-src 'none'");
        return send(200, "text/html; charset=utf-8", await fixtureHtml());
      }
      if (url.pathname === "/api/session") return json({ok: true, email, role: "owner"});
      if (url.pathname === "/__fixture/bootstrap.js") return send(200, "text/javascript; charset=utf-8", await readFile(new URL("./fixture-bootstrap.js", import.meta.url), "utf8"));
      if (url.pathname.startsWith("/original/")) return send(200, "text/html; charset=utf-8", "<!doctype html><title>가상 원본 매물</title><p>검사 전용 원본 링크</p>");
      if (url.pathname === "/__fixture/fail-writes" && request.method === "POST") {failWrites = url.searchParams.get("enabled") === "1"; return json({ok: true});}
      if (url.pathname === "/api/data") {
        let body = {};
        if (request.method === "POST") {
          let raw = "";
          for await (const chunk of request) {raw += chunk; if (raw.length > 100000) return json({ok: false}, 413);}
          body = JSON.parse(raw || "{}");
          if (failWrites) return json({ok: false, message: "브라우저 검사 저장실패", retryable: true}, 503);
        }
        const action = body.action || url.searchParams.get("action");
        if (action === "unifiedListings") return json({ok: true, groups: originals(url.origin), sourceSearchIds: {}});
        if (action === "unifiedListingDetail") return json({ok: true, originals: originals(url.origin)[url.searchParams.get("propertyId")] || []});
        if (action === "loadCloudState") {
          const scope = url.searchParams.get("scope");
          return json({ok: true, found: true, version: 1, data: cloud.get(scope) || (/favorite/i.test(scope) ? [folder] : []), deletedIds: {}});
        }
        if (action === "saveCloudState") {cloud.set(body.scope, body.data); return json({ok: true, persisted: true, version: Number(body.expectedVersion || 0) + 1, data: body.data, deletedIds: {}});}
        if (action === "enqueueMutation") {
          if (!jobs.some((job) => job.id === body.requestId)) jobs.push({id: body.requestId, status: "완료", attempts: 1, result: "{}"});
          return json({ok: true, queued: true});
        }
        if (action === "workQueueStatus") return json({ok: true, completed: jobs.length, pending: 0, processing: 0, failed: 0, jobs});
        if (/Contacts$/.test(action || "")) return json({ok: true, contacts: []});
        return json({ok: false, message: "Fixture does not implement this action"}, 400);
      }
      if (request.method === "GET" && /^\/(?:js|css|icons)\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|png)$/.test(url.pathname)) {
        const type = url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".png") ? "image/png" : "image/svg+xml";
        return send(200, type, await readFile(resolve(fixtureRoot, url.pathname.slice(1))));
      }
      send(404, "text/plain", "Fixture route not found");
    } catch (error) {send(500, "text/plain", "Fixture error: " + error.message);}
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.JS_BROWSER_FIXTURE_PORT || 4179);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid loopback fixture port");
  createFixtureServer().listen(port, "127.0.0.1", () => console.log("JS browser fixture http://127.0.0.1:" + port));
}
