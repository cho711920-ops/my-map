import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/src/worker.js";
import { createSessionToken, SESSION_COOKIE } from "../cloudflare/src/security.js";

test("detail R2 cache expires within five minutes even with legacy or invalid configuration", async () => {
  for (const configured of [undefined, "3600000", "not-a-number"]) {
    let detailReads = 0;
    const env = {
      SESSION_SECRET: "test-secret-with-more-than-thirty-two-characters",
      ALLOWED_EMAILS: "test@example.com",
      D1_PRIMARY_READS: "1", D1_DETAIL_READS: "1",
      UNIFIED_DETAIL_CACHE_MS: configured,
      DB: { prepare(sql) { return {
        bind() { return this; },
        async first() { return null; },
        async all() {
          if (sql.includes("listing_sources")) detailReads++;
          return { results: [] };
        }
      }; } },
      MEDIA: { async get(key) {
        if (!key.includes("unified-detail")) return null;
        return { customMetadata: { savedAt: String(Date.now() - 6 * 60_000) },
          async text() { return JSON.stringify({ ok: true, originals: ["stale"] }); } };
      } }
    };
    const token = await createSessionToken({ email: "test@example.com" }, env);
    const response = await worker.fetch(new Request("https://js-map.com/api/data?action=unifiedListingDetail&propertyId=M-test", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` }
    }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-data-cache"), "MISS");
    assert.deepEqual((await response.json()).originals, []);
    assert.ok(detailReads > 0);
  }
});
