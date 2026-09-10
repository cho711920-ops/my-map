import test from "node:test";
import assert from "node:assert/strict";

import { handleD1GetAction, handleD1PostAction } from "../cloudflare/src/d1-api.js";
import worker from "../cloudflare/src/worker.js";
import {
  createLocalPassword,
  createSessionToken,
  LOCAL_PASSWORD_ITERATIONS,
  verifyLocalPassword,
  verifySessionToken
} from "../cloudflare/src/security.js";

const SESSION_SECRET = "this-is-an-access-control-test-secret-longer-than-32-characters";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function managementDb(seed = []) {
  const rows = new Map(seed.map((row) => [normalizeEmail(row.email), { ...row, email: normalizeEmail(row.email) }]));
  const writes = [];
  return {
    rows,
    writes,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (/COUNT\(\*\) AS count FROM allowed_users/.test(sql)) {
                const excluded = new Set(values.map(normalizeEmail));
                return { count: [...rows.values()].filter((row) => Number(row.active) === 1 &&
                  row.role === "owner" && !excluded.has(normalizeEmail(row.email))).length };
              }
              if (/FROM allowed_users/.test(sql)) return rows.get(normalizeEmail(values[0])) || null;
              return null;
            },
            async run() {
              writes.push({ sql, values });
              if (/INSERT INTO allowed_users/.test(sql)) {
                rows.set(normalizeEmail(values[0]), {
                  email: normalizeEmail(values[0]),
                  display_name: values[1],
                  role: values[2],
                  active: values[3],
                  created_by: values[4],
                  created_at: values[5],
                  updated_at: values[5]
                });
              }
              return { success: true, meta: { changes: 1 } };
            }
          };
        },
        async all() {
          if (/FROM allowed_users/.test(sql)) return { results: [...rows.values()] };
          if (/FROM local_accounts/.test(sql)) return { results: [] };
          return { results: [] };
        }
      };
    }
  };
}

test("Google sessions refresh the current D1 role and active state on every request", async () => {
  const database = managementDb([{ email: "staff@example.com", display_name: "직원", role: "member", active: 1 }]);
  const env = { DB: database, SESSION_SECRET, ALLOWED_EMAILS: "owner@example.com" };
  const token = await createSessionToken({
    sub: "staff", email: "staff@example.com", role: "admin", displayName: "옛 이름", authType: "google"
  }, env);

  const first = await verifySessionToken(token, env);
  assert.equal(first.role, "member");
  assert.equal(first.displayName, "직원");

  database.rows.get("staff@example.com").role = "viewer";
  assert.equal((await verifySessionToken(token, env)).role, "viewer");

  database.rows.get("staff@example.com").active = 0;
  await assert.rejects(() => verifySessionToken(token, env), (error) => error.statusCode === 403);
});

test("the first environment email remains the active bootstrap owner", async () => {
  const database = managementDb([{ email: "owner@example.com", display_name: "대표", role: "viewer", active: 0 }]);
  const env = { DB: database, SESSION_SECRET, ALLOWED_EMAILS: "OWNER@example.com,staff@example.com" };
  const token = await createSessionToken({ sub: "owner", email: "owner@example.com", role: "viewer" }, env);
  const session = await verifySessionToken(token, env);
  assert.equal(session.role, "owner");
  assert.equal(session.displayName, "대표");

  const management = await handleD1GetAction(env, session, { action: "userManagement" });
  assert.deepEqual(management.users.find((entry) => entry.email === "owner@example.com"), {
    email: "owner@example.com",
    displayName: "대표",
    role: "owner",
    active: true,
    createdAt: "",
    updatedAt: "",
    source: "ENV"
  });
});

test("malformed cookies and malformed session encodings return auth failures instead of 500", async () => {
  const env = {
    SESSION_SECRET,
    ALLOWED_EMAILS: "owner@example.com",
    ASSETS: { fetch: async () => new Response("asset") }
  };
  const malformedCookie = await worker.fetch(new Request("https://js-map.com/api/session", {
    headers: { cookie: "js_realestate_session=%E0%A4%A" }
  }), env);
  assert.equal(malformedCookie.status, 401);

  const malformedToken = await worker.fetch(new Request("https://js-map.com/api/session", {
    headers: { cookie: "js_realestate_session=%25.bad" }
  }), env);
  assert.equal(malformedToken.status, 401);

  const validToken = await createSessionToken({ sub: "owner", email: "owner@example.com" }, env);
  const validAlongsideMalformed = await worker.fetch(new Request("https://js-map.com/api/session", {
    headers: { cookie: `broken=%E0%A4%A; js_realestate_session=${encodeURIComponent(validToken)}` }
  }), env);
  assert.equal(validAlongsideMalformed.status, 200);
});

test("new passwords use the schema default while legacy 100k hashes remain verifiable", async () => {
  const current = await createLocalPassword("current-password-2026");
  assert.equal(LOCAL_PASSWORD_ITERATIONS, 310_000);
  assert.equal(current.iterations, 310_000);

  const legacy = await createLocalPassword("legacy-password-2026", 100_000);
  assert.equal(await verifyLocalPassword("legacy-password-2026", {
    password_salt: legacy.salt,
    password_hash: legacy.hash,
    password_iterations: legacy.iterations
  }), true);
});

test("admins cannot change peer admins or owners but can manage lower roles", async () => {
  const database = managementDb([
    { email: "owner@example.com", role: "owner", active: 1 },
    { email: "peer@example.com", role: "admin", active: 1 },
    { email: "member@example.com", role: "member", active: 1 }
  ]);
  const env = { DB: database };
  const admin = { email: "admin@example.com", role: "admin" };

  await assert.rejects(() => handleD1PostAction(env, admin, {
    action: "saveAllowedUser", requestId: "admin-owner", email: "owner@example.com", role: "member"
  }), (error) => error.statusCode === 403 && /동급 또는 상위/.test(error.message));
  await assert.rejects(() => handleD1PostAction(env, admin, {
    action: "saveAllowedUser", requestId: "admin-peer", email: "peer@example.com", role: "member"
  }), (error) => error.statusCode === 403 && /동급 또는 상위/.test(error.message));

  const result = await handleD1PostAction(env, admin, {
    action: "saveAllowedUser", requestId: "admin-member", email: "member@example.com", role: "viewer"
  });
  assert.equal(result.role, "viewer");
  assert.equal(database.rows.get("member@example.com").role, "viewer");
});

test("bootstrap and final active owner protections are enforced server-side", async () => {
  const bootstrapDb = managementDb([{ email: "owner@example.com", role: "owner", active: 1 }]);
  await assert.rejects(() => handleD1PostAction({ DB: bootstrapDb, ALLOWED_EMAILS: "owner@example.com" }, {
    email: "owner@example.com", role: "owner"
  }, {
    action: "saveAllowedUser", requestId: "bootstrap-owner", email: "owner@example.com", role: "member"
  }), (error) => error.statusCode === 403 && /기본 소유자/.test(error.message));

  const finalOwnerDb = managementDb([{ email: "sole@example.com", role: "owner", active: 1 }]);
  await assert.rejects(() => handleD1PostAction({ DB: finalOwnerDb }, {
    email: "sole@example.com", role: "owner"
  }, {
    action: "saveAllowedUser", requestId: "sole-owner", email: "sole@example.com", role: "admin"
  }), (error) => error.statusCode === 400 && /마지막/.test(error.message));

  finalOwnerDb.rows.set("other@example.com", { email: "other@example.com", role: "owner", active: 1 });
  const result = await handleD1PostAction({ DB: finalOwnerDb }, {
    email: "sole@example.com", role: "owner"
  }, {
    action: "saveAllowedUser", requestId: "two-owners", email: "other@example.com", role: "admin"
  });
  assert.equal(result.role, "admin");
});
