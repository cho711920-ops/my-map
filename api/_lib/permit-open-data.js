const DATA_GO_BASE = "https://apis.data.go.kr";
const REQUEST_TIMEOUT_MS = 7000;

const INDUSTRY_ENDPOINTS = {
  "internet-computer-game": {
    path: "/1741000/pc_bangs/info",
    label: "인터넷컴퓨터게임시설제공업",
    sourcePage: "https://www.data.go.kr/data/15154951/openapi.do"
  },
  "general-game": {
    path: "/1741000/general_game_providers/info",
    label: "일반게임제공업",
    sourcePage: "https://www.data.go.kr/data/15154955/openapi.do"
  },
  "combined-game-distribution": {
    path: "/1741000/mixed_game_providers/info",
    label: "복합유통게임제공업",
    sourcePage: "https://www.data.go.kr/data/15154945/openapi.do"
  },
  "youth-game": {
    path: "/1741000/youth_game_providers/info",
    label: "청소년게임제공업",
    sourcePage: "https://www.data.go.kr/data/15154958/openapi.do"
  },
  "general-restaurant": {
    path: "/1741000/general_restaurants/info",
    label: "일반음식점영업",
    sourcePage: "https://www.data.go.kr/data/15154916/openapi.do"
  },
  "rest-restaurant": {
    path: "/1741000/rest_cafes/info",
    label: "휴게음식점영업",
    sourcePage: "https://www.data.go.kr/data/15154921/openapi.do"
  },
  "beauty-hair": {
    path: "/1741000/beauty_salons/info",
    label: "미용업(일반)",
    businessType: "일반미용업",
    sourcePage: "https://www.data.go.kr/data/15154918/openapi.do"
  },
  "beauty-nail": {
    path: "/1741000/beauty_salons/info",
    label: "미용업(손톱·발톱)",
    businessType: "네일미용업",
    sourcePage: "https://www.data.go.kr/data/15154918/openapi.do"
  },
  "beauty-skin": {
    path: "/1741000/beauty_salons/info",
    label: "미용업(피부)",
    businessType: "피부미용업",
    sourcePage: "https://www.data.go.kr/data/15154918/openapi.do"
  },
  "beauty-makeup": {
    path: "/1741000/beauty_salons/info",
    label: "미용업(화장·분장)",
    businessType: "화장ㆍ분장 미용업",
    sourcePage: "https://www.data.go.kr/data/15154918/openapi.do"
  }
};

const LAND_USE_NAMES = {
  "internet-computer-game": "인터넷컴퓨터게임시설제공업",
  "general-game-provider": "일반게임제공업",
  "mixed-game-provider": "복합유통게임제공업",
  "youth-game-provider": "청소년게임제공업",
  "general-restaurant": "일반음식점",
  "rest-restaurant": "휴게음식점",
  "beauty-hair": "미용업",
  "beauty-nail": "미용업",
  "beauty-skin": "미용업",
  "beauty-makeup": "미용업"
};

function text(value) {
  return String(value == null ? "" : value).trim();
}

function decodeXml(value) {
  return text(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function first(object, names) {
  for (const name of names) {
    if (object && object[name] != null && text(object[name])) return object[name];
  }
  return "";
}

function listFromResponse(payload) {
  const body = payload?.response?.body || payload?.body || payload;
  const items = body?.items?.item ?? body?.items ?? payload?.data ?? [];
  if (Array.isArray(items)) return items;
  return items && typeof items === "object" ? [items] : [];
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("공공데이터 응답이 JSON 형식이 아닙니다.");
    }
    if (!response.ok) throw new Error("공공데이터 서버 응답 오류");
    const resultCode = text(payload?.response?.header?.resultCode);
    if (resultCode && !["00", "0", "NORMAL_SERVICE"].includes(resultCode)) {
      throw new Error(text(payload?.response?.header?.resultMsg) || "공공데이터 조회 오류");
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/xml,text/xml" }
    });
    const bytes = await response.arrayBuffer();
    const raw = decodePublicXml(bytes, response.headers.get("content-type"));
    if (!response.ok) throw new Error("공공데이터 서버 응답 오류");
    const resultCode = text(raw.match(/<resultCode>([\s\S]*?)<\/resultCode>/i)?.[1]);
    if (resultCode && !["00", "0", "NORMAL_SERVICE"].includes(resultCode)) {
      const resultMsg = decodeXml(raw.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/i)?.[1]);
      throw new Error(resultMsg || "공공데이터 조회 오류");
    }
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

function runtimeSecrets(env) {
  if (env && typeof env === "object") return env;
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function keyOrThrow(name, env) {
  const secrets = runtimeSecrets(env);
  const value = text(secrets[name] || secrets.DATA_GO_KR_SERVICE_KEY);
  if (!value) throw new Error("서버 공공데이터 인증키가 연결되지 않았습니다.");
  return value;
}

function baseUrl(path, keyName, env) {
  const url = new URL(path, DATA_GO_BASE);
  url.searchParams.set("serviceKey", keyOrThrow(keyName, env));
  url.searchParams.set("_type", "json");
  url.searchParams.set("type", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  return url;
}

function normalizePermit(item) {
  return {
    permitType: text(first(item, ["archGbCdNm", "bldGbCdNm", "pmsGbCdNm", "permitType"])),
    permitNo: text(first(item, ["mgmPmsrgstPk", "pmsno", "permitNo"])),
    siteAddress: text(first(item, ["platPlc", "siteAddress", "address"])),
    buildingName: text(first(item, ["bldNm", "buildingName"])),
    mainUse: text(first(item, ["mainPurpsCdNm", "mainUse"])),
    applicationDate: text(first(item, ["pmsDay", "aplyDay", "applicationDate"])),
    permitDate: text(first(item, ["pmsDay", "permitDate"])),
    startDate: text(first(item, ["stcnsSchedDay", "stcnsDay", "startDate"])),
    approvalDate: text(first(item, ["useAprDay", "approvalDate"])),
    totalArea: Number(first(item, ["totArea", "totalArea"])) || null
  };
}

export async function fetchBuildingPermitHistory(parcel, env) {
  const url = baseUrl(
    "/1613000/ArchPmsHubService/getApBasisOulnInfo",
    "BUILDING_HUB_PERMIT_SERVICE_KEY",
    env
  );
  Object.entries(parcel).forEach(([name, value]) => url.searchParams.set(name, value));
  const payload = await fetchJson(url);
  return {
    status: "CONNECTED",
    records: listFromResponse(payload).map(normalizePermit).slice(0, 100),
    source: "국토교통부 건축HUB 건축인허가정보 서비스",
    sourcePage: "https://www.data.go.kr/data/15136267/openapi.do",
    queriedAt: new Date().toISOString()
  };
}

function compactAddress(value) {
  return text(value).replace(/\s+/g, "").replace(/[(),.-]/g, "");
}

function normalizeBusiness(item, config) {
  return {
    industry: config.label,
    businessName: text(first(item, ["BPLC_NM", "bplcNm", "businessName", "사업장명"])),
    status: text(first(item, [
      "DTL_SALS_STTS_NM", "SALS_STTS_NM", "trdStateNm", "dtlStateNm", "businessStatus", "영업상태명"
    ])),
    permitDate: text(first(item, ["LCPMT_YMD", "apvPermYmd", "permitDate", "인허가일자"])),
    closureDate: text(first(item, ["CLSBIZ_YMD", "dcbYmd", "closureDate", "폐업일자"])),
    lotAddress: text(first(item, ["LOTNO_ADDR", "siteWhlAddr", "siteAddress", "소재지전체주소"])),
    roadAddress: text(first(item, ["ROAD_NM_ADDR", "rdnWhlAddr", "roadAddress", "도로명전체주소"])),
    phone: text(first(item, ["TELNO", "siteTel", "phone", "소재지전화"])),
    businessType: text(first(item, [
      "UPTAE_NM", "SNT_UPTAE_NM", "xKXxNm", "uptaeNm", "businessType", "업태구분명"
    ]))
  };
}

export async function fetchIndustryPermitHistory(industryId, addresses, env) {
  const config = INDUSTRY_ENDPOINTS[industryId];
  if (!config) {
    return {
      status: "NOT_APPLICABLE",
      records: [],
      message: "선택 업종에 연결된 영업 인허가 이력 API가 없습니다."
    };
  }
  const keyName = industryId === "youth-game"
    ? "YOUTH_GAME_SERVICE_KEY"
    : "LOCALDATA_GAME_SERVICE_KEY";
  const url = baseUrl(config.path, keyName, env);
  const payload = await fetchJson(url);
  const targets = (addresses || []).map(compactAddress).filter(Boolean);
  const records = listFromResponse(payload)
    .map((item) => normalizeBusiness(item, config))
    .filter((item) => {
      if (config.businessType && item.businessType &&
          item.businessType.indexOf(config.businessType) === -1) return false;
      if (!targets.length) return false;
      const source = compactAddress(item.lotAddress + " " + item.roadAddress);
      return Boolean(source) && targets.some((target) => source.includes(target) || target.includes(source));
    })
    .slice(0, 50);
  return {
    status: "CONNECTED",
    records,
    source: `행정안전부 ${config.label} 조회서비스`,
    sourcePage: config.sourcePage,
    queriedAt: new Date().toISOString()
  };
}

export async function fetchLandUseActivities(industryId, env) {
  const landUseName = LAND_USE_NAMES[industryId];
  if (!landUseName) {
    return {
      status: "NOT_APPLICABLE",
      records: [],
      message: "선택 업종에 연결된 토지이용행위명이 없습니다."
    };
  }
  const url = baseUrl(
    "/1613000/arLandUseInfoService/DTsearchLunCd",
    "LAND_USE_RESTRICTION_SERVICE_KEY",
    env
  );
  url.searchParams.delete("_type");
  url.searchParams.delete("type");
  url.searchParams.delete("pageNo");
  url.searchParams.set("pageNum", "1");
  url.searchParams.set("numOfRows", "50");
  url.searchParams.set("landUseNm", landUseName);
  const xml = await fetchText(url);
  const records = parseXmlRows(xml).map((item) => ({
    name: text(first(item, ["LUN_NM", "lunNm"])),
    code: text(first(item, ["LUN_CD", "lunCd"]))
  })).filter((item) => item.name || item.code);
  return {
    status: "CONNECTED",
    records,
    searchedName: landUseName,
    source: "국토교통부 토지이용규제정보서비스",
    sourcePage: "https://www.data.go.kr/data/15058410/openapi.do",
    queriedAt: new Date().toISOString(),
    message: records.length
      ? "공식 토지이용행위 분류를 확인했습니다. 주소별 최종 허용 여부는 관할 행정기관 확인이 필요합니다."
      : "공식 토지이용행위 분류에서 일치 항목을 찾지 못했습니다."
  };
}

export function unavailableResult(error, source, sourcePage) {
  const message = error?.name === "AbortError"
    ? "공공데이터 응답시간을 초과했습니다."
    : text(error?.message) || "공공데이터를 조회하지 못했습니다.";
  return {
    status: "UNKNOWN",
    records: [],
    message,
    source,
    sourcePage
  };
}

export function parseXmlRows(xml) {
  const rows = [];
  const source = text(xml);
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(source))) {
    const row = {};
    const fieldPattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
    let fieldMatch;
    while ((fieldMatch = fieldPattern.exec(itemMatch[1]))) {
      row[fieldMatch[1]] = decodeXml(fieldMatch[2]);
    }
    rows.push(row);
  }
  return rows;
}

export function decodePublicXml(bytes, contentType = "") {
  const type = text(contentType).toLowerCase();
  let encoding = /euc-kr|ks_c_5601|cp949/.test(type) ? "euc-kr" : "utf-8";
  let raw = new TextDecoder(encoding).decode(bytes);
  const declaration = text(raw.slice(0, 160)).toLowerCase();
  if (encoding === "utf-8" && /encoding\s*=\s*["'](?:euc-kr|ks_c_5601|cp949)/.test(declaration)) {
    encoding = "euc-kr";
    raw = new TextDecoder(encoding).decode(bytes);
  }
  return raw;
}

export const permitOpenDataInternals = {
  INDUSTRY_ENDPOINTS,
  LAND_USE_NAMES,
  listFromResponse,
  normalizePermit,
  normalizeBusiness,
  compactAddress
};
