import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";
import worker from "../cloudflare/src/worker.js";

test("production no longer imports Vercel runtime or Node Google authentication", () => {
  const root = new URL("../", import.meta.url);
  assert.equal(existsSync(new URL("vercel.json", root)), false);
  for (const name of readdirSync(new URL("cloudflare/src/", root))) {
    if (!name.endsWith(".js")) continue;
    const source = readFileSync(new URL(`cloudflare/src/${name}`, root), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:legacy\/|api\/_lib|google-auth-library)/);
  }
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.dependencies?.["google-auth-library"], undefined);
  assert.equal(pkg.devDependencies["google-auth-library"], "11.0.2");
});

test("archived Google v11 verifier keeps its constructor and ID-token verification contract", async () => {
  const client = new OAuth2Client("test-client.apps.googleusercontent.com");
  assert.equal(typeof client.verifyIdToken, "function");
  await assert.rejects(client.verifyIdToken({ idToken: "", audience: "test-client.apps.googleusercontent.com" }), /idToken/i);
});

test("only the generic offline notice is cacheable HTML", async () => {
  const env = { ASSETS: { async fetch() { return new Response("static", {
    headers: { "content-type": "text/html" }
  }); } } };
  for (const path of ["/", "/index.html", "/collector-install.html"]) {
    const response = await worker.fetch(new Request(`https://js-map.com${path}`), env);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  for (const path of ["/offline", "/offline.html"]) {
    const offline = await worker.fetch(new Request(`https://js-map.com${path}`), env);
    assert.equal(offline.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  }
});
