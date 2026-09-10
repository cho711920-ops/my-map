import assert from "node:assert/strict";

const ENDPOINT = "https://realty.kr.karrotmarket.com/graphql";
const LIST_HASH = "6372d5842a05f6a94d520e2045657c0661489faeab85ced23e504e5f0354b28c";
const DETAIL_HASH = "b8d21cf0c0de5cc8e43981f48123fcef3a45962bbe96317fb4864b3e20934b72";
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  origin: "https://realty.daangn.com",
  referer: "https://realty.daangn.com/",
  "x-realty-platform": "realty-web"
};

async function query(hash, variables) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      variables,
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
    })
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `당근 GraphQL HTTP ${response.status}`);
  assert.deepEqual(payload.errors || [], [], "당근 GraphQL 오류가 반환되었습니다.");
  return payload.data || {};
}

const input = {
  clusterId: "REGION:1095",
  propertyFilter: {
    salesTypes: ["STORE", "OFFICE", "FACTORY"],
    tradeTypes: ["MONTH"]
  }
};

const listData = await query(LIST_HASH, { first: 1, after: null, input });
const connection = listData.articleByClusterId;
assert.ok(connection && Array.isArray(connection.edges), "당근 목록 응답 형식이 변경되었습니다.");
assert.ok(connection.edges.length > 0, "당근 계약 검사용 클러스터가 비어 있습니다.");

const articleId = String(connection.edges[0]?.node?.article?.originalId || "");
assert.ok(articleId, "당근 목록에서 상세 매물 ID를 찾지 못했습니다.");
const detailData = await query(DETAIL_HASH, { articleId });
assert.ok(detailData.articleByOriginalArticleId, "당근 상세 응답 형식이 변경되었습니다.");

console.log("Daangn provider contract OK: list + detail");
