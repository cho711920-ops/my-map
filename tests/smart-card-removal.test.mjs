import assert from "node:assert/strict";
import test from "node:test";
import {existsSync, readFileSync} from "node:fs";
import worker from "../cloudflare/src/worker.js";
import {createSessionToken, SESSION_COOKIE} from "../cloudflare/src/security.js";

test("the public page and asset source no longer ship the retired smart-card feature", () => {
  const html = readFileSync("index.html", "utf8");
  for (const file of ["js/analysis.js", "js/commercial-public-v6.js", "js/regional-market-v1.js",
    "css/commercial-public-v6.css", "css/regional-market-v1.css", "css/ai-report-print-v1.css", "assets/semas-logo.png",
    "cloudflare/src/commercial-area-api.js", "cloudflare/src/regional-market-api.js"]) {
    assert.equal(existsSync(file), false, file + " must be removed from the release source");
    assert.ok(!html.includes(file));
  }
  assert.doesNotMatch(html, /aiSidePanel|copyCurrentAIAnalysis|printCurrentAIReport/);
  assert.doesNotMatch(readFileSync("js/script.js", "utf8"), /\.ondblclick\s*=|openItem\(item\)|스마트 매물카드/);
});

test("retired analysis actions retain authentication and cannot call an external provider", async () => {
  const env = {ALLOWED_EMAILS: "retirement-test@example.invalid",
    SESSION_SECRET: "local-retirement-test-secret-with-at-least-32-characters"};
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {upstreamCalls++; throw Error("retired provider must not be reached");};
  try {
    const token = await createSessionToken({sub: "retirement-test", email: env.ALLOWED_EMAILS}, env);
    for (const action of ["commercialArea", "regionalMarket"]) {
      const url = "https://js-map.com/api/data?action=" + action + "&lat=36.35&lng=127.38";
      const unauthenticated = await worker.fetch(new Request(url), env);
      assert.equal(unauthenticated.status, 401);
      const response = await worker.fetch(new Request(url, {
        headers: {cookie: SESSION_COOKIE + "=" + encodeURIComponent(token)}
      }), env);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.action, action);
      assert.match(body.message, /지원하지 않는 서버 작업/);
    }
    assert.equal(upstreamCalls, 0);
  } finally {globalThis.fetch = originalFetch;}
});
