const encoder = new TextEncoder();

export const SESSION_COOKIE = "js_realestate_session";
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 5 * 24 * 60 * 60;

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
    ? Math.min(configured, 30 * 24 * 60 * 60)
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
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
  if (!await isAllowedEmail(decoded.email, env)) {
    throw Object.assign(new Error("승인되지 않은 Google 계정입니다."), { statusCode: 403 });
  }
  return decoded;
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
  if (!payload.email_verified || !await isAllowedEmail(payload.email, env)) {
    throw Object.assign(new Error("승인되지 않은 Google 계정입니다."), { statusCode: 403 });
  }
  return payload;
}

