import test from "node:test";
import assert from "node:assert/strict";

import worker from "../cloudflare/src/worker.js";

const env = {
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  ALLOWED_EMAILS: "cho711920@gmail.com",
  SESSION_SECRET: "this-is-a-local-test-secret-longer-than-32-characters",
  ASSETS: { fetch: async () => new Response("asset") }
};

test("auth configuration exposes only the public client id", async () => {
  const response = await worker.fetch(new Request("https://js-map.com/api/auth-config"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { googleClientId: env.GOOGLE_CLIENT_ID });
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("protected APIs reject an unauthenticated request", async () => {
  const response = await worker.fetch(new Request("https://js-map.com/api/sheet"), env);
  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /로그인/);
});

test("static assets remain on the fast asset binding", async () => {
  const response = await worker.fetch(new Request("https://js-map.com/css/style.css"), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

