const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function run() {
  process.env.SESSION_SECRET = "sheet-cache-test-secret-value-1234567890";
  process.env.ALLOWED_EMAILS = "agent@example.com";
  process.env.APPS_SCRIPT_URL = "https://example.invalid/exec";
  process.env.APPS_SCRIPT_PROXY_SECRET = "proxy-test-secret";
  process.env.SHEET_MEMORY_CACHE_MS = "120000";

  const securityUrl = pathToFileURL(
    path.join(__dirname, "..", "api", "_lib", "security.js")
  ).href;
  const sheetUrl = pathToFileURL(
    path.join(__dirname, "..", "api", "sheet.js")
  ).href + `?test=${Date.now()}`;
  const security = await import(securityUrl);
  const handler = (await import(sheetUrl)).default;
  const token = security.createSessionToken({
    sub: "test-user",
    email: "agent@example.com"
  });

  let upstreamCalls = 0;
  let upstreamBody = "name,address\nA,대전 서구";
  global.fetch = async function() {
    upstreamCalls += 1;
    return new Response(upstreamBody, {
      status: 200,
      headers: { "content-type": "text/csv" }
    });
  };

  function request(headers = {}) {
    return {
      method: "GET",
      headers: {
        cookie: `${security.SESSION_COOKIE}=${encodeURIComponent(token)}`,
        ...headers
      }
    };
  }

  function response() {
    return {
      statusCode: 200,
      headers: {},
      body: undefined,
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      },
      end() {
        return this;
      }
    };
  }

  const first = response();
  await handler(request(), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body, upstreamBody);
  assert.match(first.headers.etag, /^"[A-Za-z0-9_-]+"$/);
  assert.equal(first.headers["cache-control"], "private, max-age=0, must-revalidate");
  assert.equal(upstreamCalls, 1);

  const unchanged = response();
  await handler(request({ "if-none-match": first.headers.etag }), unchanged);
  assert.equal(unchanged.statusCode, 304);
  assert.equal(unchanged.body, undefined);
  assert.equal(upstreamCalls, 1, "짧은 자동 확인은 메모리 캐시를 재사용해야 합니다.");

  upstreamBody = "name,address\nB,대전 유성구";
  const forced = response();
  await handler(request({ "x-js-force-refresh": "1" }), forced);
  assert.equal(forced.statusCode, 200);
  assert.equal(forced.body, upstreamBody);
  assert.equal(upstreamCalls, 2, "저장 직후 확인은 운영 시트를 다시 읽어야 합니다.");
  assert.notEqual(forced.headers.etag, first.headers.etag);

  console.log("sheet transfer cache tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
