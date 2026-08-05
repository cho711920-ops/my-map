import {
  fetchBuildingPermitHistory,
  fetchIndustryPermitHistory,
  fetchLandUseActivities,
  unavailableResult
} from "../../api/_lib/permit-open-data.js";
import { requireSession } from "./security.js";
import { getBuildingRegister } from "./building-register-api.js";

const LAW_API_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const LAW_TIMEOUT_MS = 8_000;
const PARCEL_RULES = {
  sigunguCd: /^\d{5}$/,
  bjdongCd: /^\d{5}$/,
  platGbCd: /^[01]$/,
  bun: /^\d{4}$/,
  ji: /^\d{4}$/
};
const LAW_TOPICS = {
  "contract-party": { title: "계약 당사자·권리관계", query: "상가 임대차 대리권 보증금 반환" },
  "permit-cooperation": { title: "인허가·용도변경 협조", query: "상가 임대차 영업허가 불가 계약 해제" },
  repair: { title: "하자·수선의무", query: "임대인 수선의무 임차 목적물 사용수익" },
  "renewal-rent": { title: "계약갱신·차임 증감", query: "상가건물 임대차 계약갱신요구" },
  "deposit-restoration": { title: "보증금 반환·원상복구", query: "상가 임대차 원상회복 보증금 반환" },
  goodwill: { title: "권리금·신규임차인 주선", query: "상가 권리금 회수기회 방해 신규임차인 주선" },
  "business-transfer": { title: "영업양도·행정처분·시설 승계", query: "영업양도 행정처분 승계 임대차" },
  "management-nuisance": { title: "관리규약·소음·냄새", query: "집합건물 업종제한 관리규약 임대차" },
  "tax-cost": { title: "세금·관리비·이행강제금", query: "상가 임대차 관리비 부담 특약" }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store"
    }
  });
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = LAW_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function validateParcel(url) {
  const parcel = {};
  for (const [key, rule] of Object.entries(PARCEL_RULES)) {
    const value = clean(url.searchParams.get(key));
    if (!rule.test(value)) {
      throw Object.assign(new Error("지번 코드 형식이 올바르지 않습니다."), { statusCode: 400 });
    }
    parcel[key] = value;
  }
  return parcel;
}

function normalizeBuildingResponse(data) {
  if (!data || !data.ok || data.action !== "buildingRegister") {
    throw Object.assign(
      new Error(data?.message || "건축물대장 자료를 확인하지 못했습니다."),
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

function safeIndustryId(value) {
  const industryId = clean(value);
  return /^[a-z0-9-]{1,60}$/.test(industryId) ? industryId : "";
}

export async function handlePermitPublicData(request, env) {
  await requireSession(request, env);
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const url = new URL(request.url);
  const parcel = validateParcel(url);
  const data = await getBuildingRegister(env, {
    ...parcel, mode: "full", propertyId: url.searchParams.get("propertyId"), force: url.searchParams.get("force")
  });

  const normalized = normalizeBuildingResponse(data);
  const addresses = [
    normalized.parcel?.address,
    normalized.parcel?.roadAddress,
    ...normalized.buildings.map((item) => item?.address || item?.roadAddress)
  ].filter(Boolean);
  const industryId = safeIndustryId(url.searchParams.get("industryId"));
  const [buildingPermits, industryPermits, landUseActivities] = await Promise.allSettled([
    fetchBuildingPermitHistory(parcel, env),
    fetchIndustryPermitHistory(industryId, addresses, env),
    fetchLandUseActivities(industryId, env)
  ]);

  normalized.buildingPermitHistory = buildingPermits.status === "fulfilled"
    ? buildingPermits.value
    : unavailableResult(
      buildingPermits.reason,
      "국토교통부 건축HUB 건축인허가정보 서비스",
      "https://www.data.go.kr/data/15136267/openapi.do"
    );
  normalized.industryPermitHistory = industryPermits.status === "fulfilled"
    ? industryPermits.value
    : unavailableResult(industryPermits.reason, "행정안전부 지방행정 인허가 조회서비스", "");
  normalized.landUseActivities = landUseActivities.status === "fulfilled"
    ? landUseActivities.value
    : unavailableResult(
      landUseActivities.reason,
      "국토교통부 토지이용규제정보서비스",
      "https://www.data.go.kr/data/15058410/openapi.do"
    );
  return json(normalized);
}

function pick(object, names) {
  for (const name of names) {
    if (object && clean(object[name])) return object[name];
  }
  return "";
}

function lawRows(payload) {
  const root = payload?.PrecSearch || payload?.precSearch || payload;
  const rows = root?.prec || root?.["판례"] || root?.items?.item || root?.items || [];
  return Array.isArray(rows) ? rows : rows && typeof rows === "object" ? [rows] : [];
}

function normalizeLawRecord(row, topicId, topicTitle) {
  const id = clean(pick(row, ["판례일련번호", "precId", "ID", "id"]));
  const link = clean(pick(row, ["판례상세링크", "precDetailLink", "상세링크"]));
  return {
    id,
    topicId,
    topicTitle,
    caseName: clean(pick(row, ["사건명", "caseName", "name"])),
    caseNumber: clean(pick(row, ["사건번호", "caseNumber"])),
    decisionDate: clean(pick(row, ["선고일자", "decisionDate"])),
    court: clean(pick(row, ["법원명", "courtName"])),
    decisionType: clean(pick(row, ["판결유형", "decisionType", "선고"])),
    url: link
      ? new URL(link, "https://www.law.go.kr").toString()
      : id
        ? `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(id)}`
        : "https://www.law.go.kr"
  };
}

function selectedLawTopics(value) {
  return clean(value).split(",").map((item) => item.trim())
    .filter((item, index, all) => LAW_TOPICS[item] && all.indexOf(item) === index)
    .slice(0, 9);
}

async function fetchLawTopic(oc, topicId, topic) {
  const url = new URL(LAW_API_URL);
  url.searchParams.set("OC", oc);
  url.searchParams.set("target", "prec");
  url.searchParams.set("type", "JSON");
  url.searchParams.set("search", "2");
  url.searchParams.set("query", topic.query);
  url.searchParams.set("display", "5");
  url.searchParams.set("page", "1");
  const response = await fetchWithTimeout(url, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`판례 API HTTP ${response.status}`);
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error("판례 API가 JSON 형식으로 응답하지 않았습니다.");
  }
  return lawRows(payload).map((row) => normalizeLawRecord(row, topicId, topic.title));
}

export async function handlePermitLeaseLegal(request, env) {
  await requireSession(request, env);
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const topicIds = selectedLawTopics(new URL(request.url).searchParams.get("topics"));
  if (!topicIds.length) return json({ error: "조회할 임대차 주제가 없습니다." }, 400);

  const oc = clean(env.LAW_OPEN_DATA_OC || env.LAW_OPEN_API_OC);
  if (!oc) {
    return json({
      ok: true,
      configured: false,
      records: [],
      message: "서버에 국가법령정보 공동활용 인증값 연결이 필요합니다. 확인하지 못한 판례를 대신 표시하지 않습니다."
    });
  }

  const settled = await Promise.allSettled(
    topicIds.map((id) => fetchLawTopic(oc, id, LAW_TOPICS[id]))
  );
  const records = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") records.push(...result.value);
    else errors.push({ topicId: topicIds[index], message: clean(result.reason?.message) || "조회 실패" });
  });
  const unique = records.filter((record, index, all) => record.id
    ? all.findIndex((item) => item.id === record.id) === index
    : all.findIndex((item) =>
      item.caseName === record.caseName && item.caseNumber === record.caseNumber
    ) === index
  ).slice(0, 20);
  return json({
    ok: true,
    configured: true,
    records: unique,
    errors,
    source: "국가법령정보 공동활용 판례 목록 OPEN API",
    sourcePage: "https://open.law.go.kr/LSO/openApi/guideList.do",
    queriedAt: new Date().toISOString(),
    notice: "관련 가능성이 있는 판례 목록입니다. 적용 전 판결요지와 사실관계 및 현재 법령을 확인해야 합니다."
  });
}
