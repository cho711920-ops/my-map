import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import worker from "../cloudflare/src/worker.js";
import {
  authenticateLocalAccount,
  createLocalPassword,
  createSessionToken,
  localIdentityEmail,
  normalizeLocalUsername,
  verifyLocalPassword,
  verifySessionToken
} from "../cloudflare/src/security.js";

const secret = "this-is-a-local-test-secret-longer-than-32-characters";

function localDb(account) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first: async () => /FROM local_accounts/.test(sql) ? account : null,
            run: async () => {
              if (/failed_attempts=0/.test(sql)) {
                account.failed_attempts = 0;
                account.locked_until = "";
                account.last_login_at = values[0];
              } else if (/SET failed_attempts=\?1/.test(sql)) {
                account.failed_attempts = values[0];
                account.locked_until = values[1];
              }
              return { success: true };
            }
          };
        }
      };
    }
  };
}

test("Google and local sessions use the configured 90-day maximum", async () => {
  const env = {
    ALLOWED_EMAILS: "owner@example.com",
    SESSION_SECRET: secret,
    SESSION_MAX_AGE_SECONDS: String(90 * 24 * 60 * 60)
  };
  const now = Date.now();
  const token = await createSessionToken({ sub: "owner", email: "owner@example.com" }, env, now);
  assert.equal((await verifySessionToken(token, env, now + 89 * 24 * 60 * 60_000)).email, "owner@example.com");
  await assert.rejects(() => verifySessionToken(token, env, now + 90 * 24 * 60 * 60_000), /만료/);
});

test("issued passwords are salted hashes and local sessions are revocable", async () => {
  const passwordRecord = await createLocalPassword("friend-safe-2026");
  const account = {
    username: "friend1",
    display_name: "친구",
    role: "member",
    active: 1,
    password_salt: passwordRecord.salt,
    password_hash: passwordRecord.hash,
    password_iterations: passwordRecord.iterations,
    session_version: 1,
    failed_attempts: 0,
    locked_until: ""
  };
  assert.notEqual(passwordRecord.hash, "friend-safe-2026");
  assert.equal(await verifyLocalPassword("friend-safe-2026", account), true);
  assert.equal(await verifyLocalPassword("wrong-password", account), false);

  const env = { DB: localDb(account), SESSION_SECRET: secret, SESSION_MAX_AGE_SECONDS: "7776000" };
  const user = await authenticateLocalAccount("FRIEND1", "friend-safe-2026", env);
  assert.equal(user.email, "friend1@local.js-map");
  assert.equal(user.authType, "local");
  const token = await createSessionToken(user, env);
  assert.equal((await verifySessionToken(token, env)).username, "friend1");
  account.session_version = 2;
  await assert.rejects(() => verifySessionToken(token, env), /다시 로그인/);
});

test("local account login endpoint creates a secure 90-day session cookie", async () => {
  const passwordRecord = await createLocalPassword("friend-safe-2026");
  const account = {
    username: "friend1", display_name: "친구", role: "member", active: 1,
    password_salt: passwordRecord.salt, password_hash: passwordRecord.hash,
    password_iterations: passwordRecord.iterations, session_version: 1,
    failed_attempts: 0, locked_until: ""
  };
  const env = {
    DB: localDb(account), SESSION_SECRET: secret, SESSION_MAX_AGE_SECONDS: "7776000",
    GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    ASSETS: { fetch: async () => new Response("asset") }
  };
  const response = await worker.fetch(new Request("https://js-map.com/api/session", {
    method: "POST",
    headers: { origin: "https://js-map.com", "content-type": "application/json" },
    body: JSON.stringify({ loginType: "local", username: "friend1", password: "friend-safe-2026" })
  }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict; Max-Age=7776000/);
  assert.deepEqual(await response.json(), {
    ok: true, email: localIdentityEmail("friend1"), authType: "local", username: "friend1"
  });
});

test("invalid local identifiers and repeated failures are rejected", async () => {
  assert.equal(normalizeLocalUsername("한글친구"), "");
  assert.equal(normalizeLocalUsername("ab"), "");
  assert.equal(normalizeLocalUsername("Friend_01"), "friend_01");
  await assert.rejects(() => createLocalPassword("short"), /10자 이상/);

  const passwordRecord = await createLocalPassword("friend-safe-2026");
  const account = {
    username: "friend1", display_name: "친구", role: "member", active: 1,
    password_salt: passwordRecord.salt, password_hash: passwordRecord.hash,
    password_iterations: passwordRecord.iterations, session_version: 1,
    failed_attempts: 4, locked_until: ""
  };
  await assert.rejects(() => authenticateLocalAccount("friend1", "wrong-password", {
    DB: localDb(account), SESSION_SECRET: secret
  }), /아이디 또는 비밀번호/);
  assert.equal(account.failed_attempts, 5);
  assert.ok(Date.parse(account.locked_until) > Date.now());
});

test("login and master user-management UI expose issued accounts without public signup", () => {
  const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
  const admin = fs.readFileSync("js/operations-admin-v1.js", "utf8");
  const migration = fs.readFileSync("cloudflare/migrations/0016_local_accounts.sql", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(auth, /아이디로 로그인/);
  assert.match(auth, /인터넷 연결을 기다리는 중입니다/);
  assert.match(admin, /saveLocalAccount/);
  assert.match(admin, /공개 회원가입 없이 마스터가/);
  assert.match(migration, /password_salt TEXT NOT NULL/);
  assert.match(migration, /session_version INTEGER NOT NULL/);
  assert.doesNotMatch(auth, /회원가입/);
  assert.match(html, /auth-gate-v1\.js\?v=1\.3\.0-local-account/);
});
