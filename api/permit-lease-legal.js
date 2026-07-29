import { requireSession, sendError } from "./_lib/security.js";

const API_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const TIMEOUT_MS = 8000;
const TOPICS = {
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

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function pick(object, names) {
  for (const name of names) {
    if (object && clean(object[name])) return object[name];
  }
  return "";
}

function rowsFrom(payload) {
  const root = payload?.PrecSearch || payload?.precSearch || payload;
  const rows = root?.prec || root?.["판례"] || root?.items?.item || root?.items || [];
  return Array.isArray(rows) ? rows : (rows && typeof rows === "object" ? [rows] : []);
}

function normalize(row, topicId, topicTitle) {
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

async function fetchTopic(oc, topicId, topic) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(API_URL);
    url.searchParams.set("OC", oc);
    url.searchParams.set("target", "prec");
    url.searchParams.set("type", "JSON");
    url.searchParams.set("search", "2");
    url.searchParams.set("query", topic.query);
    url.searchParams.set("display", "5");
    url.searchParams.set("page", "1");
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`판례 API HTTP ${response.status}`);
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("판례 API가 JSON 형식으로 응답하지 않았습니다.");
    }
    return rowsFrom(payload).map((row) => normalize(row, topicId, topic.title));
  } finally {
    clearTimeout(timer);
  }
}

function selectedTopics(value) {
  return clean(value).split(",").map((item) => item.trim())
    .filter((item, index, all) => TOPICS[item] && all.indexOf(item) === index)
    .slice(0, 9);
}

export default async function handler(req, res) {
  try {
    await requireSession(req);
    if (req.method !== "GET") return res.status(405).end();
    const topicIds = selectedTopics(req.query.topics);
    if (!topicIds.length) return res.status(400).json({ error: "조회할 임대차 주제가 없습니다." });

    const oc = clean(process.env.LAW_OPEN_DATA_OC || process.env.LAW_OPEN_API_OC);
    res.setHeader("Cache-Control", "no-store, private");
    if (!oc) {
      return res.status(200).json({
        ok: true,
        configured: false,
        records: [],
        message: "서버에 국가법령정보 공동활용 인증값 연결이 필요합니다. 확인하지 못한 판례를 대신 표시하지 않습니다."
      });
    }

    const settled = await Promise.allSettled(
      topicIds.map((id) => fetchTopic(oc, id, TOPICS[id]))
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

    return res.status(200).json({
      ok: true,
      configured: true,
      records: unique,
      errors,
      source: "국가법령정보 공동활용 판례 목록 OPEN API",
      sourcePage: "https://open.law.go.kr/LSO/openApi/guideList.do",
      queriedAt: new Date().toISOString(),
      notice: "관련 가능성이 있는 판례 목록입니다. 적용 전 판결요지와 사실관계 및 현재 법령을 확인해야 합니다."
    });
  } catch (error) {
    return sendError(res, error);
  }
}
