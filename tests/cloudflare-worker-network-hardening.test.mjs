import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../cloudflare/src/worker.js";
import { createSessionToken, SESSION_COOKIE } from "../cloudflare/src/security.js";

const baseEnv = {
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  ALLOWED_EMAILS: "owner@example.com",
  SESSION_SECRET: "this-is-a-local-test-secret-longer-than-32-characters",
  ASSETS: { fetch: async () => new Response("asset") }
};

async function authenticatedRequest(path, customEnv = {}, init = {}, context = {}) {
  const env = { ...baseEnv, ...customEnv };
  const token = await createSessionToken({ sub: "owner", email: "owner@example.com" }, env);
  return worker.fetch(new Request(`https://js-map.com${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`
    }
  }), env, context);
}

test("www HTML navigations redirect to the canonical apex without redirecting API fetches", async () => {
  let assetReads = 0;
  const env = {
    ...baseEnv,
    ASSETS: { fetch: async () => { assetReads += 1; return new Response("asset"); } }
  };
  const navigation = await worker.fetch(new Request("https://www.js-map.com/favorites?folder=one", {
    headers: { accept: "text/html,application/xhtml+xml" }
  }), env);
  assert.equal(navigation.status, 308);
  assert.equal(navigation.headers.get("location"), "https://js-map.com/favorites?folder=one");
  assert.equal(assetReads, 0);

  const apiFetch = await worker.fetch(new Request("https://www.js-map.com/api/auth-config", {
    headers: { accept: "application/json" }
  }), env);
  assert.equal(apiFetch.status, 200);
  assert.equal((await apiFetch.json()).localLoginEnabled, true);
});

test("static asset routing enters the Worker so www HTML redirects run in production", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /run_worker_first\s*=\s*\[\s*"\/\*"\s*\]/);
});

test("Worker preserves the application CSP supplied by static assets", async () => {
  const applicationCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";
  const env = {
    ...baseEnv,
    ASSETS: {
      fetch: async () => new Response("<!doctype html>", {
        headers: { "content-type": "text/html", "content-security-policy": applicationCsp }
      })
    }
  };
  const response = await worker.fetch(new Request("https://js-map.com/", {
    headers: { accept: "text/html" }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), applicationCsp);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
});

test("listing-image redirects are manual and every hop is checked against the host allowlist", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), redirect: options?.redirect });
    return new Response(null, {
      status: 302,
      headers: { location: "https://example.com/private-image.jpg" }
    });
  };
  try {
    const source = encodeURIComponent("https://img.kr.gcp-karroter.net/start.jpg");
    const response = await authenticatedRequest(`/api/listing-image?url=${source}`, {
      MEDIA: { get: async () => null }
    });
    assert.equal(response.status, 502);
    assert.deepEqual(calls, [{
      url: "https://img.kr.gcp-karroter.net/start.jpg",
      redirect: "manual"
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing-image allowlist rejects credentials and nonstandard ports", async () => {
  for (const sourceUrl of [
    "https://user:secret@img.kr.gcp-karroter.net/image.jpg",
    "https://img.kr.gcp-karroter.net:8443/image.jpg"
  ]) {
    const response = await authenticatedRequest(
      `/api/listing-image?url=${encodeURIComponent(sourceUrl)}`,
      { MEDIA: { get: async () => null } }
    );
    assert.equal(response.status, 403);
  }
});

test("listing-image follows a bounded allowlisted redirect chain and records the final host", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const writes = [];
  const pending = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    calls.push({ url, redirect: options?.redirect });
    if (calls.length === 1) {
      return new Response(null, {
        status: 307,
        headers: { location: "https://landthumb-phinf.pstatic.net/final.jpg" }
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });
  };
  try {
    const source = encodeURIComponent("https://img.kr.gcp-karroter.net/start.jpg");
    const response = await authenticatedRequest(`/api/listing-image?url=${source}`, {
      MEDIA: {
        get: async () => null,
        put: async (...args) => writes.push(args)
      }
    }, {}, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.redirect === "manual"));
    assert.equal(writes.length, 1);
    assert.equal(writes[0][2].customMetadata.sourceHost, "landthumb-phinf.pstatic.net");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing-image stops after four redirects even when every hop is allowlisted", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: `https://img.kr.gcp-karroter.net/hop-${calls}.jpg` }
    });
  };
  try {
    const source = encodeURIComponent("https://img.kr.gcp-karroter.net/start.jpg");
    const response = await authenticatedRequest(`/api/listing-image?url=${source}`, {
      MEDIA: { get: async () => null }
    });
    assert.equal(response.status, 502);
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing-image rejects an oversized streamed body even without Content-Length", async () => {
  const originalFetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async () => new Response(new Uint8Array(12 * 1024 * 1024 + 1), {
    status: 200,
    headers: { "content-type": "image/jpeg" }
  });
  try {
    const source = encodeURIComponent("https://img.kr.gcp-karroter.net/oversized.jpg");
    const response = await authenticatedRequest(`/api/listing-image?url=${source}`, {
      MEDIA: {
        get: async () => null,
        put: async () => { writes += 1; }
      }
    });
    assert.equal(response.status, 413);
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing-image timeout remains active while an allowlisted response body is stalled", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.fetch = async (_input, options) => {
    const body = new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => {
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      }
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });
  };
  globalThis.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 5, ...args);
  try {
    const source = encodeURIComponent("https://img.kr.gcp-karroter.net/stalled.jpg");
    const response = await Promise.race([
      authenticatedRequest(`/api/listing-image?url=${source}`, {
        MEDIA: { get: async () => null }
      }),
      new Promise((_, reject) => originalSetTimeout(() => reject(new Error("stalled body was not aborted")), 1000))
    ]);
    assert.equal(response.status, 504);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("data writes enforce the actual UTF-8 byte limit without relying on Content-Length", async () => {
  const body = JSON.stringify({
    action: "saveCloudState",
    requestId: "utf8-limit-test",
    scope: "favorites",
    recordKey: "default",
    data: { note: "한".repeat(699_100) }
  });
  assert.ok(body.length < 2 * 1024 * 1024);
  assert.ok(Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024);
  const request = new Request("https://js-map.com/api/data", {
    method: "POST",
    headers: { origin: "https://js-map.com", "content-type": "application/json" },
    body
  });
  assert.equal(request.headers.get("content-length"), null);
  const env = { ...baseEnv };
  const token = await createSessionToken({ sub: "owner", email: "owner@example.com" }, env);
  request.headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
});

test("public login rejects an oversized streamed body before parsing or authentication", async () => {
  const request = new Request("https://js-map.com/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginType: "local", username: "a", password: "x".repeat(40 * 1024) })
  });
  assert.equal(request.headers.get("content-length"), null);
  const response = await worker.fetch(request, baseEnv);
  assert.equal(response.status, 413);
});
