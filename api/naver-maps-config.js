function isInvalidNcpKeyId(value) {
  var normalized = String(value || "").trim().toUpperCase();
  return !normalized || [
    "X-NCP-APIGW-API-KEY-ID",
    "YOUR_CLIENT_ID",
    "YOUR_NCP_KEY_ID",
    "NAVER_MAPS_NCP_KEY_ID",
    "PLACEHOLDER",
    "UNDEFINED",
    "NULL"
  ].indexOf(normalized) >= 0;
}

export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ enabled: false, error: "METHOD_NOT_ALLOWED" });
  }

  var ncpKeyId = String(process.env.NAVER_MAPS_NCP_KEY_ID || "").trim();
  if (!ncpKeyId) {
    return response.status(503).json({ enabled: false, error: "NAVER_MAPS_NOT_CONFIGURED" });
  }
  if (isInvalidNcpKeyId(ncpKeyId)) {
    return response.status(503).json({ enabled: false, error: "NAVER_MAPS_INVALID_CONFIG" });
  }

  return response.status(200).json({ enabled: true, ncpKeyId: ncpKeyId });
}
