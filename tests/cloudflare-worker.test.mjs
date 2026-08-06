import test from "node:test";
import assert from "node:assert/strict";

import worker from "../cloudflare/src/worker.js";
import {
  createSessionToken,
  SESSION_COOKIE
} from "../cloudflare/src/security.js";

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

async function authenticatedRequest(path, customEnv = {}, context = {}, init = {}) {
  const requestEnv = { ...env, ...customEnv };
  const token = await createSessionToken({
    sub: "google-user-1",
    email: "cho711920@gmail.com"
  }, requestEnv);
  return worker.fetch(new Request(`https://js-map.com${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`
    }
  }), requestEnv, context);
}

test("unified listing metadata is served from a fresh R2 cache", async () => {
  let upstreamCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error("upstream should not be called on a cache hit");
  };
  try {
    const response = await authenticatedRequest(
      "/api/data?action=unifiedListings",
      {
        MEDIA: {
          get: async (key) => {
            assert.equal(key, "api-cache/unified-listings.json");
            return {
              customMetadata: { savedAt: String(Date.now()) },
              httpMetadata: { contentType: "application/json; charset=utf-8" },
              text: async () => JSON.stringify({ ok: true, groups: { sample: [] } })
            };
          }
        }
      }
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-data-cache"), "HIT");
    assert.equal((await response.json()).ok, true);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operations dashboard is served from R2 without repeating full-table counts", async () => {
  let databaseQueries = 0;
  const response = await authenticatedRequest(
    "/api/data?action=operationsDashboard",
    {
      DB: { prepare() { databaseQueries += 1; throw new Error("cached dashboard must not query D1"); } },
      MEDIA: {
        get: async (key) => {
          assert.equal(key, "api-cache/operations-dashboard.json");
          return {
            customMetadata: { savedAt: String(Date.now()) },
            httpMetadata: { contentType: "application/json; charset=utf-8" },
            text: async () => JSON.stringify({ ok: true, action: "operationsDashboard", activeMaster: 8754 })
          };
        }
      }
    }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-js-data-cache"), "HIT");
  assert.equal((await response.json()).activeMaster, 8754);
  assert.equal(databaseQueries, 0);
});

test("primary sheet reads come directly from D1 without Apps Script", async () => {
  let upstreamCalls = 0;
  const cachedWrites = [];
  const pending = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          assert.match(this.sql, /FROM listings WHERE \(status <> 'deleted'\) AND rowid > \?1/);
          assert.doesNotMatch(this.sql, /OFFSET/);
          return {
            results: [{
              title: "테스트건물",
              address: "대전광역시 서구 테스트로 1",
              room: "101호",
              listing_type: "일반상가",
              deposit: 1000,
              monthly_rent: 80,
              maintenance_fee: 5,
              premium: 0,
              area_m2: 33,
              landlord_phone: "010-0000-0000",
              tenant_phone: "",
              operating_memo: "D1 메모",
              status: "active",
              first_collected_at: "2026-08-05",
              main_source: "직접등록",
              property_id: "d1-property-1",
              source_url: "",
              contacts_json: "[]",
              building_year: "",
              building_elevators: 0,
              building_approval_date: "",
              building_info_checked_at: "",
              building_info_status: "",
              registration_at: "2026-08-05T00:00:00.000Z",
              last_collected_at: "2026-08-05T00:00:00.000Z",
              latitude: 36.3504,
              longitude: 127.3845
            }]
          };
        }
      };
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error("Apps Script must not be called for D1 primary reads");
  };
  try {
    const response = await authenticatedRequest(
      "/api/sheet",
      {
        DB: db,
        D1_PRIMARY_READS: "1",
        MEDIA: {
          get: async () => null,
          put: async (...args) => cachedWrites.push(args)
        }
      },
      { waitUntil: (promise) => pending.push(promise) },
      { headers: { "x-js-force-refresh": "1" } }
    );
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-data-source"), "D1");
    assert.match(await response.text(), /테스트건물,대전광역시 서구 테스트로 1,101호/);
    assert.equal(upstreamCalls, 0);
    assert.equal(cachedWrites[0][0], "api-cache/d1-sheet.csv");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("primary sheet appends saved listing coordinates for map-first rendering", async () => {
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          assert.match(sql, /last_collected_at, latitude, longitude/);
          return { results: [{
            title: "좌표건물", address: "대전광역시 동구 천동 556", room: "1층",
            listing_type: "단지내상가", status: "active", property_id: "M-COORD-1",
            contacts_json: "[]", latitude: 36.320123, longitude: 127.441234
          }] };
        }
      };
    }
  };
  const response = await authenticatedRequest("/api/sheet", { DB: db, D1_PRIMARY_READS: "1" },
    { waitUntil() {} }, { headers: { "x-js-force-refresh": "1" } });
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.match(csv, /최종수집시각,위도,경도/);
  assert.match(csv, /36\.320123,127\.441234/);
});

test("full listing details and photos come directly from D1", async () => {
  const db = {
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
        async all() {
          if (/FROM listing_sources/.test(this.sql)) {
            return { results: [{
              id: "O-source-1",
              list_snapshot_json: JSON.stringify({ originalId: "O-source-1", photoCount: 2 }),
              raw_json: JSON.stringify({ images: ["https://example.invalid/one.jpg", "https://example.invalid/two.jpg"] })
            }] };
          }
          if (/FROM listing_media/.test(this.sql)) {
            return { results: [
              { source_id: "O-source-1", external_url: "https://example.invalid/one.jpg", sort_order: 0 },
              { source_id: "O-source-1", external_url: "https://example.invalid/two.jpg", sort_order: 1 }
            ] };
          }
          return { results: [] };
        }
      };
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Apps Script must not be called for D1 details"); };
  try {
    const response = await authenticatedRequest(
      "/api/data?action=unifiedListingDetail&propertyId=M-property-1",
      { DB: db, D1_PRIMARY_READS: "1", D1_DETAIL_READS: "1" }
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-data-source"), "D1");
    const payload = await response.json();
    assert.equal(payload.originals.length, 1);
    assert.deepEqual(payload.originals[0].images, [
      "https://example.invalid/one.jpg",
      "https://example.invalid/two.jpg"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing images are allowlisted and stored in R2 after the first load", async () => {
  const writes = [];
  const pending = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).hostname, "img.kr.gcp-karroter.net");
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "3" }
    });
  };
  try {
    const source = encodeURIComponent("https://img.kr.gcp-karroter.net/sample.jpg");
    const response = await authenticatedRequest(
      `/api/listing-image?url=${source}`,
      {
        MEDIA: {
          get: async () => null,
          put: async (...args) => writes.push(args)
        }
      },
      { waitUntil: (promise) => pending.push(promise) }
    );
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("x-js-image-cache"), "MISS");
    assert.equal(writes.length, 1);
    assert.match(writes[0][0], /^images\/external\/[A-Za-z0-9_-]+$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing image writes stop before the seven-day storage budget is exceeded", async () => {
  let writes = 0;
  const db = {
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
        async first() { return { total: 64 * 1024 * 1024 }; },
        async run() { return { meta: { changes: 1 } }; }
      };
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "image/jpeg", "content-length": "3" }
  });
  try {
    const source = encodeURIComponent("https://landthumb-phinf.pstatic.net/budget.jpg");
    const response = await authenticatedRequest(
      `/api/listing-image?url=${source}`,
      {
        DB: db,
        IMAGE_CACHE_7D_BUDGET_BYTES: String(64 * 1024 * 1024),
        MEDIA: { get: async () => null, put: async () => { writes += 1; } }
      }
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-image-cache"), "MISS-NOSTORE");
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing image proxy rejects an unknown host", async () => {
  const response = await authenticatedRequest(
    `/api/listing-image?url=${encodeURIComponent("https://example.com/image.jpg")}`,
    { MEDIA: { get: async () => null } }
  );
  assert.equal(response.status, 403);
});

test("lease legal endpoint keeps the feature available when an API key is not configured", async () => {
  const response = await authenticatedRequest(
    "/api/permit-lease-legal?topics=contract-party,repair"
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    configured: false,
    records: [],
    message: "서버에 국가법령정보 공동활용 인증값 연결이 필요합니다. 확인하지 못한 판례를 대신 표시하지 않습니다."
  });
});

test("public permit endpoint reads the official building register without Apps Script", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (/BldRgstHubService/.test(url.pathname)) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header>
        <body><items><item><mgmBldrgstPk>PK-1</mgmBldrgstPk><bldNm>테스트 건물</bldNm>
        <platPlc>대전광역시 서구 둔산동 1</platPlc><mainPurpsCdNm>제2종근린생활시설</mainPurpsCdNm>
        <useAprDay>20200101</useAprDay></item></items><totalCount>1</totalCount></body></response>`, {
        status: 200, headers: { "content-type": "application/xml" }
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await authenticatedRequest(
      "/api/permit-public-data?sigunguCd=30170&bjdongCd=11200&platGbCd=0&bun=0001&ji=0000&industryId=general-restaurant",
      {
        DATA_GO_KR_SERVICE_KEY: "test-public-data-key"
      }
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.action, "permitPublicData");
    assert.equal(payload.buildings.length, 1);
    assert.equal(payload.buildings[0].buildingName, "테스트 건물");
    assert.equal(payload.buildingPermitHistory.status, "CONNECTED");
    assert.equal(payload.industryPermitHistory.status, "CONNECTED");
    assert.equal(payload.landUseActivities.status, "CONNECTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collector endpoint rejects requests without the private collector key", async () => {
  const response = await worker.fetch(new Request("https://js-map.com/api/collector", {
    method: "POST",
    headers: { origin: "https://fin.land.naver.com", "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "saveNaverBatch", data: [] })
  }), { ...env, COLLECTOR_ACCESS_KEY: "private-key" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).ok, false);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://fin.land.naver.com");
});

test("collector manifest comparison runs directly against D1", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() { statements.push({ sql: this.sql, args: this.args }); return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; },
        async first() { return null; }
      };
    }
  };
  const response = await worker.fetch(new Request("https://js-map.com/api/collector", {
    method: "POST",
    headers: { origin: "https://fin.land.naver.com", "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "classifySourceManifest",
      requestId: "manifest-test-1",
      accessKey: "private-key",
      source: "네이버",
      sessionId: "NAVER-TEST-1",
      entries: [{ sourceId: "네이버-123", listSnapshot: "snapshot", deposit: 1000, rent: 80, area: 10, room: "1층" }]
    })
  }), { ...env, DB: db, COLLECTOR_ACCESS_KEY: "private-key" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.unknown, 1);
  assert.deepEqual(payload.needsDetail, ["네이버-123"]);
  assert.ok(statements.some((entry) => /collector_sessions/.test(entry.sql)));
  assert.ok(statements.some((entry) => /mutation_results/.test(entry.sql)));
});

test("naver manifest repairs missing D1 and shared-cache coordinates without a detail fetch", async () => {
  const statements = [];
  const batches = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() { statements.push({ sql: this.sql, args: this.args }); return { meta: { changes: 1 } }; },
        async all() {
          if (/FROM listing_sources s LEFT JOIN listings l/.test(this.sql)) {
            return { results: [{
              source_listing_id: "네이버-2637317828",
              snapshot_hash: "",
              list_snapshot_json: JSON.stringify({
                deposit: 3000, rent: 130, area: 11.7, room: "1층", address: "동구 천동 556"
              }),
              listing_id: "M-COORD-REPAIR",
              listing_latitude: null,
              listing_longitude: null
            }] };
          }
          return { results: [] };
        },
        async first() { return null; }
      };
    },
    async batch(items) {
      batches.push(...items.map((item) => ({ sql: item.sql, args: item.args })));
      return items.map(() => ({ success: true }));
    }
  };
  const response = await worker.fetch(new Request("https://js-map.com/api/collector", {
    method: "POST",
    headers: { origin: "https://fin.land.naver.com", "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "classifySourceManifest",
      requestId: "manifest-coordinate-repair",
      accessKey: "private-key",
      source: "네이버",
      sessionId: "NAVER-COORD-TEST",
      entries: [{
        sourceId: "네이버-2637317828", deposit: 3000, rent: 130, area: 11.7,
        room: "1층", address: "동구 천동 556", latitude: 36.320123, longitude: 127.441234
      }]
    })
  }), { ...env, DB: db, COLLECTOR_ACCESS_KEY: "private-key" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.coordinatesRepaired, 1);
  assert.equal(payload.unchanged, 1);
  assert.deepEqual(payload.needsDetail, []);
  assert.ok(batches.some((entry) => /UPDATE listings SET latitude/.test(entry.sql) &&
    entry.args[0] === 36.320123 && entry.args[1] === 127.441234));
  assert.ok(batches.some((entry) => /INSERT INTO geocode_cache/.test(entry.sql) &&
    entry.args[0] === "동구 천동 556"));
  assert.ok(statements.some((entry) => /collector_sessions/.test(entry.sql)));
});

test("memo edits commit directly to D1 without a Google runtime", async () => {
  const statements = [];
  const pending = [];
  const deletedCacheKeys = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() { statements.push({ sql: this.sql, args: this.args }); return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; }
      };
    },
    async batch() { return []; }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Google runtime must not be called"); };
  try {
    const response = await authenticatedRequest(
      "/api/data",
      {
        DB: db,
        MEDIA: { delete: async (keys) => deletedCacheKeys.push(...keys) }
      },
      { waitUntil: (promise) => pending.push(promise) },
      {
        method: "POST",
        headers: { origin: "https://js-map.com", "content-type": "application/json" },
        body: JSON.stringify({
          action: "updatePropertyMemo",
          requestId: "memo-request-1",
          key: { propertyId: "m-property-1" },
          memo: "updated memo",
          contacts: []
        })
      }
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-write-path"), "D1");
    const payload = await response.json();
    assert.equal(payload.persisted, true);
    assert.equal(payload.queued, false);
    assert.equal(payload.memo, "updated memo");
    assert.ok(statements.some((entry) => /UPDATE listings SET operating_memo/.test(entry.sql)));
    await Promise.all(pending);
    assert.ok(!statements.some((entry) => /apps-script-sync/.test(entry.sql)));
    assert.ok(deletedCacheKeys.includes("api-cache/d1-sheet.csv"));
    assert.ok(!deletedCacheKeys.includes("api-cache/unified-listings.json"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("primary memo edits persist only in D1 and do not queue a Sheet sync", async () => {
  const statements = [];
  const deletedCacheKeys = [];
  const pending = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() {
          statements.push({ sql: this.sql, args: this.args });
          return { meta: { changes: 1 } };
        }
      };
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Apps Script must not be called for D1 primary writes");
  };
  try {
    const response = await authenticatedRequest(
      "/api/data",
      {
        DB: db,
        D1_PRIMARY_WRITES: "1",
        MEDIA: { delete: async (keys) => deletedCacheKeys.push(...keys) }
      },
      { waitUntil: (promise) => pending.push(promise) },
      {
        method: "POST",
        headers: { origin: "https://js-map.com", "content-type": "application/json" },
        body: JSON.stringify({
          action: "updatePropertyMemo",
          requestId: "memo-request-d1-only",
          key: { propertyId: "d1-property-1" },
          memo: "D1 only memo",
          contacts: []
        })
      }
    );
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-js-write-path"), "D1");
    const payload = await response.json();
    assert.equal(payload.persisted, true);
    assert.equal(payload.queued, false);
    assert.equal(payload.propertyId, "d1-property-1");
    assert.ok(statements.some((entry) => /UPDATE listings SET operating_memo/.test(entry.sql)));
    assert.ok(statements.some((entry) => /INSERT INTO mutation_results/.test(entry.sql)));
    assert.ok(deletedCacheKeys.includes("api-cache/d1-sheet.csv"));
    assert.ok(!deletedCacheKeys.includes("api-cache/unified-listings.json"));
    assert.ok(!statements.some((entry) => /INSERT INTO jobs/.test(entry.sql)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("geocode saves invalidate only the geocode cache", async () => {
  const deletedCacheKeys = [];
  const pending = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
        async run() { return { meta: { changes: 1 } }; }
      };
    },
    async batch(items) { return items.map(() => ({ success: true })); }
  };
  const response = await authenticatedRequest(
    "/api/data",
    { DB: db, MEDIA: { delete: async (keys) => deletedCacheKeys.push(...keys) } },
    { waitUntil: (promise) => pending.push(promise) },
    {
      method: "POST",
      headers: { origin: "https://js-map.com", "content-type": "application/json" },
      body: JSON.stringify({
        action: "saveGeocodeCache",
        requestId: "geocode-cache-scope",
        entries: [{ address: "대전광역시 중구 중앙로 1", lat: 36.3, lng: 127.4 }]
      })
    }
  );
  await Promise.all(pending);
  assert.equal(response.status, 200);
  assert.deepEqual(deletedCacheKeys, ["api-cache/geocode-cache.json"]);
});

test("personal cloud-state saves do not invalidate shared listing caches", async () => {
  const deletedCacheKeys = [];
  const pending = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
        async run() { return { meta: { changes: 1 } }; }
      };
    }
  };
  const response = await authenticatedRequest(
    "/api/data",
    { DB: db, MEDIA: { delete: async (keys) => deletedCacheKeys.push(...keys) } },
    { waitUntil: (promise) => pending.push(promise) },
    {
      method: "POST",
      headers: { origin: "https://js-map.com", "content-type": "application/json" },
      body: JSON.stringify({
        action: "saveCloudState",
        requestId: "cloud-state-cache-scope",
        scope: "favorites",
        recordKey: "default",
        data: { ids: ["M-1"] }
      })
    }
  );
  await Promise.all(pending);
  assert.equal(response.status, 200);
  assert.deepEqual(deletedCacheKeys, []);
});
