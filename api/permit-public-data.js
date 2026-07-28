import { requireSession, sendError } from "./_lib/security.js";

const DIGIT_RULES = {
  sigunguCd: /^\d{5}$/,
  bjdongCd: /^\d{5}$/,
  platGbCd: /^[01]$/,
  bun: /^\d{4}$/,
  ji: /^\d{4}$/
};

export function validateParcel(query) {
  const parcel = {};
  Object.entries(DIGIT_RULES).forEach(([key, rule]) => {
    const value = String(query && query[key] || "");
    if (!rule.test(value)) {
      throw Object.assign(new Error("지번 코드 형식이 올바르지 않습니다."), { statusCode: 400 });
    }
    parcel[key] = value;
  });
  return parcel;
}

export function normalizeBuildingResponse(data) {
  if (!data || !data.ok || data.action !== "buildingRegister") {
    throw Object.assign(
      new Error((data && data.message) || "건축물대장 자료를 확인하지 못했습니다."),
      { statusCode: 502 }
    );
  }
  return {
    ok: true,
    action: "permitPublicData",
    version: 1,
    parcel: data.parcel || null,
    buildings: Array.isArray(data.buildings) ? data.buildings : [],
    units: Array.isArray(data.units) ? data.units : [],
    recordCounts: data.recordCounts || {},
    source: data.source || "국토교통부 건축HUB 건축물대장정보 서비스",
    sourcePage: data.sourcePage || "https://www.data.go.kr/data/15134735/openapi.do",
    queriedAt: data.queriedAt || "",
    cached: Boolean(data.cached),
    limitations: [
      "위반건축물 표시는 공공 API에서 제공되지 않아 정부24 발급본 또는 관할 구청 확인이 필요합니다.",
      "용도지역·지구 정보는 표시하지만 해당 업종의 최종 행위 허용 여부는 관할 행정기관 확인이 필요합니다."
    ]
  };
}

function upstreamUrl(parcel, propertyId) {
  const base = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_PROXY_SECRET;
  if (!base || !secret) throw new Error("공공데이터 서버 연결 설정을 확인해주세요.");
  const url = new URL(base);
  url.searchParams.set("action", "buildingRegister");
  url.searchParams.set("mode", "details");
  Object.entries(parcel).forEach(([key, value]) => url.searchParams.set(key, value));
  if (propertyId) url.searchParams.set("propertyId", String(propertyId).slice(0, 100));
  url.searchParams.set("proxySecret", secret);
  return url;
}

export default async function handler(req, res) {
  try {
    await requireSession(req);
    if (req.method !== "GET") return res.status(405).end();
    const parcel = validateParcel(req.query);
    const response = await fetch(upstreamUrl(parcel, req.query.propertyId), {
      redirect: "follow",
      cache: "no-store"
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw Object.assign(new Error("공공데이터 응답 형식을 확인하지 못했습니다."), { statusCode: 502 });
    }
    if (!response.ok) {
      throw Object.assign(new Error("공공데이터 서버가 응답하지 않았습니다."), { statusCode: 502 });
    }
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(200).json(normalizeBuildingResponse(data));
  } catch (error) {
    return sendError(res, error);
  }
}
