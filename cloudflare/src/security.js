const encoder = new TextEncoder();

export const SESSION_COOKIE = "js_realestate_session";
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const LOCAL_PASSWORD_ITERATIONS = 310_000;
const MAX_SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const LOCAL_ID_SUFFIX = "@local.js-map";

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
}

function sessionMaxAgeSeconds(env) {
  const configured = Number(env.SESSION_MAX_AGE_SECONDS || DEFAULT_SESSION_MAX_AGE_SECONDS);
  return Number.isFinite(configured) && configured >= 300
    ? Math.min(configured, MAX_SESSION_MAX_AGE_SECONDS)
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

export function normalizeLocalUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) ? username : "";
}

export function localIdentityEmail(username) {
  const normalized = normalizeLocalUsername(username);
  return normalized ? `${normalized}${LOCAL_ID_SUFFIX}` : "";
}

function constantTimeEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index % Math.max(1, a.length)] || 0) ^ (b[index % Math.max(1, b.length)] || 0);
  }
  return mismatch === 0;
}

async function deriveLocalPassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations
  }, key, 256));
}

export async function createLocalPassword(password, iterations = LOCAL_PASSWORD_ITERATIONS) {
  const secret = String(password || "");
  if (secret.length < 10 || secret.length > 128) {
    throw Object.assign(new Error("비밀번호는 10자 이상 128자 이하로 입력해 주세요."), { statusCode: 400 });
  }
  const rounds = Math.max(100_000, Math.min(Number(iterations) || LOCAL_PASSWORD_ITERATIONS, 600_000));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveLocalPassword(secret, salt, rounds);
  return { salt: base64UrlEncode(salt), hash: base64UrlEncode(hash), iterations: rounds };
}

export async function verifyLocalPassword(password, account) {
  const iterations = Math.max(100_000, Math.min(Number(account?.password_iterations) || 0, 600_000));
  if (!iterations || !account?.password_salt || !account?.password_hash) return false;
  try {
    const actual = await deriveLocalPassword(String(password || ""), base64UrlDecode(account.password_salt), iterations);
    return constantTimeEqual(actual, base64UrlDecode(account.password_hash));
  } catch {
    return false;
  }
}

async function localAccessProfile(username, env) {
  const normalized = normalizeLocalUsername(username);
  if (!normalized || !env.DB || typeof env.DB.prepare !== "function") return null;
  try {
    const row = await env.DB.prepare(`SELECT username, linked_email, display_name, role, active, password_salt,
      password_hash, password_iterations, session_version, failed_attempts, locked_until
      FROM local_accounts WHERE username=?1 LIMIT 1`).bind(normalized).first();
    return row || null;
  } catch {
    return null;
  }
}

export async function authenticateLocalAccount(username, password, env, now = Date.now()) {
  const normalized = normalizeLocalUsername(username);
  const suppliedPassword = String(password || "");
  const account = normalized ? await localAccessProfile(normalized, env) : null;
  const linkedEmail = String(account?.linked_email || "").trim().toLowerCase();
  const linkedProfile = linkedEmail ? await accessProfile(linkedEmail, env) : null;
  const lockedUntil = Date.parse(String(account?.locked_until || "")) || 0;
  const passwordAccount = account || {
    password_salt: "AAAAAAAAAAAAAAAAAAAAAA",
    password_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    password_iterations: 100_000
  };
  const passwordMatches = await verifyLocalPassword(suppliedPassword.slice(0, 128), passwordAccount);
  const valid = Boolean(suppliedPassword.length <= 128 && account && Number(account.active) === 1 &&
    (!linkedEmail || linkedProfile) &&
    lockedUntil <= now && passwordMatches);
  if (!valid) {
    if (account && env.DB && typeof env.DB.prepare === "function") {
      const failures = Number(account.failed_attempts || 0) + 1;
      const nextLockedUntil = failures >= 5 ? new Date(now + 10 * 60_000).toISOString() : "";
      await env.DB.prepare(`UPDATE local_accounts SET failed_attempts=?1, locked_until=?2,
        updated_at=?3 WHERE username=?4`).bind(failures, nextLockedUntil, new Date(now).toISOString(), normalized).run();
    }
    throw Object.assign(new Error("아이디 또는 비밀번호를 확인해 주세요."), { statusCode: 401 });
  }
  await env.DB.prepare(`UPDATE local_accounts SET failed_attempts=0, locked_until='', last_login_at=?1,
    updated_at=?1 WHERE username=?2`).bind(new Date(now).toISOString(), normalized).run();
  return {
    sub: `local:${normalized}`,
    email: linkedEmail || localIdentityEmail(normalized),
    username: normalized,
    authType: "local",
    role: String(linkedProfile?.role || account.role || "member"),
    displayName: String(account.display_name || linkedProfile?.displayName || normalized),
    sessionVersion: Number(account.session_version || 1)
  };
}

function sessionSecret(env) {
  const secret = String(env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("SESSION_SECRET은 32자 이상이어야 합니다.");
  return secret;
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(value, env) {
  return base64UrlEncode(await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(value)));
}

export function envAllowedEmails(env) {
  return new Set(
    String(env.ALLOWED_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function envAccessRole(email, env) {
  const normalized = String(email || "").trim().toLowerCase();
  const configured = String(env.ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const index = configured.indexOf(normalized);
  if (index < 0) return "";
  return index === 0 ? "owner" : "member";
}

export async function accessProfile(email, env) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      const row = await env.DB.prepare(
        "SELECT email, display_name, role, active FROM allowed_users WHERE email = ?1 LIMIT 1"
      ).bind(normalized).first();
      if (row) {
        if (Number(row.active) !== 1) return null;
        return {
          email: normalized,
          displayName: String(row.display_name || ""),
          role: String(row.role || "member")
        };
      }
    } catch {}
  }
  const role = envAccessRole(normalized, env);
  return role ? { email: normalized, displayName: "", role } : null;
}

export async function isAllowedEmail(email, env) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  if (envAllowedEmails(env).has(normalized)) return true;
  if (!env.DB || typeof env.DB.prepare !== "function") return false;

  try {
    const row = await env.DB.prepare(
      "SELECT email FROM allowed_users WHERE email = ?1 AND active = 1 LIMIT 1"
    ).bind(normalized).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

export function requireRole(user, roles) {
  const allowed = new Set(Array.isArray(roles) ? roles : [roles]);
  const role = String(user?.role || "member");
  if (!allowed.has(role)) {
    throw Object.assign(new Error("이 작업을 수행할 권한이 없습니다."), { statusCode: 403 });
  }
  return user;
}

export function parseCookies(request) {
  const source = String(request.headers.get("cookie") || "");
  return Object.fromEntries(
    source.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      const key = index >= 0 ? part.slice(0, index) : part;
      const value = index >= 0 ? part.slice(index + 1) : "";
      return [decodeURIComponent(key), decodeURIComponent(value)];
    })
  );
}

export function sessionCookieHeader(value, env, maxAge = sessionMaxAgeSeconds(env)) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(env) {
  return sessionCookieHeader("", env, 0);
}

export async function createSessionToken(user, env, now = Date.now()) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    sub: String(user.sub || ""),
    email: String(user.email || "").trim().toLowerCase(),
    role: String(user.role || "member"),
    displayName: String(user.displayName || user.name || ""),
    authType: String(user.authType || "google"),
    username: String(user.username || ""),
    sessionVersion: Number(user.sessionVersion || 0),
    iat: now,
    exp: now + sessionMaxAgeSeconds(env) * 1000
  })));
  return `${payload}.${await sign(payload, env)}`;
}

export async function verifySessionToken(token, env, now = Date.now()) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw Object.assign(new Error("잘못된 로그인 세션입니다."), { statusCode: 401 });
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(env),
    base64UrlDecode(signature),
    encoder.encode(payload)
  );
  if (!valid) throw Object.assign(new Error("잘못된 로그인 세션입니다."), { statusCode: 401 });

  const decoded = decodeJsonSegment(payload);
  if (!decoded.exp || now >= Number(decoded.exp)) {
    throw Object.assign(new Error("로그인 세션이 만료되었습니다."), { statusCode: 401 });
  }
  if (decoded.authType === "local") {
    const account = await localAccessProfile(decoded.username, env);
    if (!account || Number(account.active) !== 1 ||
      Number(account.session_version || 1) !== Number(decoded.sessionVersion || 0)) {
      throw Object.assign(new Error("사용이 중지되었거나 다시 로그인이 필요한 계정입니다."), { statusCode: 403 });
    }
    const linkedEmail = String(account.linked_email || "").trim().toLowerCase();
    const linkedProfile = linkedEmail ? await accessProfile(linkedEmail, env) : null;
    if (linkedEmail && !linkedProfile) {
      throw Object.assign(new Error("연결된 Google 계정의 사용이 중지되었습니다."), { statusCode: 403 });
    }
    return {
      ...decoded,
      email: linkedEmail || localIdentityEmail(account.username),
      username: String(account.username || ""),
      role: String(linkedProfile?.role || account.role || "member"),
      displayName: String(account.display_name || linkedProfile?.displayName || account.username || "")
    };
  }
  if (!await isAllowedEmail(decoded.email, env)) {
    throw Object.assign(new Error("승인되지 않은 Google 계정입니다."), { statusCode: 403 });
  }
  if (decoded.role) return decoded;
  const profile = await accessProfile(decoded.email, env);
  return { ...decoded, role: profile?.role || "member", displayName: profile?.displayName || "" };
}

export async function requireSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) throw Object.assign(new Error("로그인이 필요합니다."), { statusCode: 401 });
  return verifySessionToken(token, env);
}

export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) {
    throw Object.assign(new Error("허용되지 않은 요청 출처입니다."), { statusCode: 403 });
  }
}

let jwksCache = { expiresAt: 0, keys: [] };

async function googleKeys() {
  if (jwksCache.keys.length && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw Object.assign(new Error("Google 로그인 키를 확인하지 못했습니다."), { statusCode: 502 });
  const payload = await response.json();
  const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 300);
  jwksCache = {
    keys: Array.isArray(payload.keys) ? payload.keys : [],
    expiresAt: Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000
  };
  return jwksCache.keys;
}

export async function verifyGoogleCredential(credential, env, now = Date.now()) {
  const parts = String(credential || "").split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Google 로그인 정보가 없습니다."), { statusCode: 400 });
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonSegment(headerPart);
  const payload = decodeJsonSegment(payloadPart);
  if (header.alg !== "RS256" || !header.kid) {
    throw Object.assign(new Error("지원하지 않는 Google 로그인 형식입니다."), { statusCode: 401 });
  }
  const jwk = (await googleKeys()).find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw Object.assign(new Error("Google 로그인 서명 키를 찾지 못했습니다."), { statusCode: 401 });
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    encoder.encode(`${headerPart}.${payloadPart}`)
  );
  const validIssuer = payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
  const validAudience = Array.isArray(payload.aud)
    ? payload.aud.includes(String(env.GOOGLE_CLIENT_ID || ""))
    : payload.aud === String(env.GOOGLE_CLIENT_ID || "");
  if (!valid || !validIssuer || !validAudience || Number(payload.exp || 0) * 1000 <= now) {
    throw Object.assign(new Error("Google 로그인 정보를 확인할 수 없습니다."), { statusCode: 401 });
  }
  const profile = payload.email_verified ? await accessProfile(payload.email, env) : null;
  if (!payload.email_verified || !profile) {
    throw Object.assign(new Error("승인되지 않은 Google 계정입니다."), { statusCode: 403 });
  }
  return { ...payload, role: profile.role, displayName: profile.displayName || payload.name || "" };
}
