import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionToken,
  envAllowedEmails,
  isAllowedEmail,
  requireSameOrigin,
  verifySessionToken
} from "../cloudflare/src/security.js";

const env = {
  ALLOWED_EMAILS: "cho711920@gmail.com, STAFF@example.com ",
  SESSION_SECRET: "this-is-a-local-test-secret-longer-than-32-characters",
  SESSION_MAX_AGE_SECONDS: "600"
};

test("environment allowlist is normalized", () => {
  assert.deepEqual([...envAllowedEmails(env)], ["cho711920@gmail.com", "staff@example.com"]);
});

test("D1 allowlist extends the bootstrap environment allowlist", async () => {
  const dbEnv = {
    ...env,
    DB: {
      prepare() {
        return {
          bind(email) {
            return { first: async () => email === "worker@example.com" ? { email } : null };
          }
        };
      }
    }
  };
  assert.equal(await isAllowedEmail("CHO711920@GMAIL.COM", dbEnv), true);
  assert.equal(await isAllowedEmail("worker@example.com", dbEnv), true);
  assert.equal(await isAllowedEmail("blocked@example.com", dbEnv), false);
});

test("session token verifies and rejects tampering or expiration", async () => {
  const now = Date.now();
  const token = await createSessionToken({ sub: "owner", email: "cho711920@gmail.com" }, env, now);
  const session = await verifySessionToken(token, env, now + 1_000);
  assert.equal(session.email, "cho711920@gmail.com");
  await assert.rejects(() => verifySessionToken(`${token}x`, env, now + 1_000), /잘못된/);
  await assert.rejects(() => verifySessionToken(token, env, now + 601_000), /만료/);
});

test("removing an email from the allowlist revokes an existing session", async () => {
  const token = await createSessionToken({ sub: "staff", email: "staff@example.com" }, env);
  await assert.rejects(
    () => verifySessionToken(token, { ...env, ALLOWED_EMAILS: "cho711920@gmail.com" }),
    /승인되지 않은/
  );
});

test("same-origin guard rejects a foreign origin", () => {
  requireSameOrigin(new Request("https://js-map.com/api/session", { headers: { origin: "https://js-map.com" } }));
  assert.throws(
    () => requireSameOrigin(new Request("https://js-map.com/api/session", { headers: { origin: "https://evil.example" } })),
    /허용되지 않은/
  );
});

