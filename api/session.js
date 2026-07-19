import { OAuth2Client } from "google-auth-library";
import {
  SESSION_MAX_AGE_MS,
  clearSessionCookieHeader,
  createSessionToken,
  isAllowedEmail,
  requireSameOrigin,
  requireSession,
  sendError,
  sessionCookieHeader
} from "./_lib/security.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const user = await requireSession(req);
      return res.status(200).json({ ok: true, email: user.email || "" });
    }

    requireSameOrigin(req);
    if (req.method === "DELETE") {
      res.setHeader("Set-Cookie", clearSessionCookieHeader());
      return res.status(200).json({ ok: true });
    }

    if (req.method !== "POST") return res.status(405).end();
    const idToken = String((req.body && (req.body.credential || req.body.idToken)) || "");
    if (!idToken) return res.status(400).json({ ok: false, message: "Google 로그인 정보가 없습니다." });

    const clientId = String(process.env.GOOGLE_CLIENT_ID || "");
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID가 설정되지 않았습니다.");
    const ticket = await new OAuth2Client(clientId).verifyIdToken({
      idToken,
      audience: clientId
    });
    const decoded = ticket.getPayload() || {};
    if (!decoded.email_verified || !isAllowedEmail(decoded.email)) {
      return res.status(403).json({ ok: false, message: "승인되지 않은 Google 계정입니다." });
    }

    const sessionCookie = createSessionToken(decoded);
    res.setHeader("Set-Cookie", sessionCookieHeader(sessionCookie, SESSION_MAX_AGE_MS / 1000));
    return res.status(200).json({ ok: true, email: decoded.email });
  } catch (error) {
    res.setHeader("Set-Cookie", clearSessionCookieHeader());
    return sendError(res, error);
  }
}
