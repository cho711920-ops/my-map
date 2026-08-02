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

  return response.status(200).json({ enabled: true, ncpKeyId: ncpKeyId });
}
