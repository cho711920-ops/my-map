import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "js_realestate_session";
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  const value = String(process.env.SESSION_SECRET || "");
  if (value.length < 32) throw new Error("SESSION_SECRET은 32자 이상이어야 합니다.");
  return value;
}

function sign(value) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function createSessionToken(user) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    sub: String(user.sub || ""),
    email: String(user.email || "").toLowerCase(),
    iat: now,
    exp: now + SESSION_MAX_AGE_MS
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw new Error("잘못된 세션입니다.");
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error("잘못된 세션입니다.");
  }
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!value.exp || Date.now() >= Number(value.exp)) throw new Error("만료된 세션입니다.");
  return value;
}

export function allowedEmails() {
  return new Set(
    String(process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAllowedEmail(email) {
  const allowlist = allowedEmails();
  return allowlist.size > 0 && allowlist.has(String(email || "").toLowerCase());
}

export function parseCookies(req) {
  const source = String(req.headers.cookie || "");
  return Object.fromEntries(
    source.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      const key = index >= 0 ? part.slice(0, index) : part;
      const value = index >= 0 ? part.slice(index + 1) : "";
      return [decodeURIComponent(key), decodeURIComponent(value)];
    })
  );
}

export function sessionCookieHeader(value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV !== "development" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookieHeader() {
  return sessionCookieHeader("", 0);
}

export async function requireSession(req) {
  const cookie = parseCookies(req)[SESSION_COOKIE];
  if (!cookie) throw Object.assign(new Error("로그인이 필요합니다."), { statusCode: 401 });

  try {
    const decoded = verifySessionToken(cookie);
    if (!isAllowedEmail(decoded.email)) {
      throw Object.assign(new Error("승인되지 않은 계정입니다."), { statusCode: 403 });
    }
    return decoded;
  } catch (error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error("로그인 세션이 만료되었습니다."), { statusCode: 401 });
  }
}

export function requireSameOrigin(req) {
  const origin = String(req.headers.origin || "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (!origin || !host) return;
  const expected = `${String(req.headers["x-forwarded-proto"] || "https")}://${host}`;
  if (origin !== expected) {
    throw Object.assign(new Error("허용되지 않은 요청 출처입니다."), { statusCode: 403 });
  }
}

export function sendError(res, error) {
  const status = Number(error && error.statusCode) || 500;
  res.status(status).json({
    ok: false,
    message: status >= 500 ? "서버 보안 설정을 확인해 주세요." : error.message
  });
}
