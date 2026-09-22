import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {request} from "node:http";
import {createFixtureServer, fixtureHtml} from "./browser/fixture-server.mjs";

test("browser fixture mounts the real application and scripts without production auth or remote SDK", async () => {
  const html = await fixtureHtml();
  assert.match(html, /id="listingTradeModeSelectV1"/);
  assert.match(html, /src="\/js\/script.js"/);
  assert.match(html, /src="\/js\/unified-favorites-v7.js"/);
  assert.doesNotMatch(html, /src="(?:https?:|\/\/)|src="\/js\/(?:auth-gate|pwa|map)\b|id="wrap" inert/);
});

test("fixture server handles only loopback synthetic APIs and rejects arbitrary files", async () => {
  const server = createFixtureServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const health = await fetch(base + "/__fixture/health");
    assert.equal(health.headers.get("x-js-browser-fixture"), "1");
    assert.equal((await health.json()).fixture, true);
    const records = await (await fetch(base + "/api/data?action=unifiedListings")).json();
    assert.equal(Object.keys(records.groups).length, 4);
    for (const path of ["/.env", "/wrangler.toml", "/cloudflare/src/worker.js", "/tests/browser/fixture-server.mjs"]) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    const wrongHostStatus = await new Promise((resolve, reject) => {
      const req = request(base + "/__fixture/health", {headers: {host: "example.com"}}, (response) => {
        response.resume(); resolve(response.statusCode);
      });
      req.on("error", reject); req.end();
    });
    assert.equal(wrongHostStatus, 403);
  } finally {await new Promise((resolve) => server.close(resolve));}
});

test("Cloudflare public build does not copy test fixtures or browser reports", () => {
  const build = readFileSync(new URL("../tools/build-cloudflare-assets.mjs", import.meta.url), "utf8");
  const directories = build.match(/const directories = (\[[^;]+\]);/)[1];
  assert.doesNotMatch(directories, /tests|outputs|browser/);
  const config = readFileSync(new URL("../playwright.config.mjs", import.meta.url), "utf8");
  assert.match(config, /const baseURL = "http:\/\/127\.0\.0\.1:" \+ port/);
  assert.match(config, /JS_BROWSER_FIXTURE_PORT \|\| 4179/);
  assert.match(config, /!Number\.isInteger\(port\) \|\| port < 1024 \|\| port > 65535/);
  assert.match(config, /reuseExistingServer: false/);
  assert.match(config, /serviceWorkers: "block"/);
});
