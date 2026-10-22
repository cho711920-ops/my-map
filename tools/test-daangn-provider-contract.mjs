import assert from "node:assert/strict";
import { DAANGN_GRAPHQL_URL, DAANGN_LIST_FIRST_HASH, DAANGN_LIST_NEXT_HASH, DAANGN_DETAIL_HASH } from "../cloudflare/src/daangn-provider-contract.js";
import { observeDaangnListPage, daangnPresenceProof } from "../cloudflare/src/collector-api.js";

// Read-only provider check. No production writes, ad contents, addresses,
// cursors, credentials or original IDs are printed.
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  origin: "https://realty.daangn.com",
  referer: "https://realty.daangn.com/",
  "x-realty-platform": "realty-web"
};

async function query(hash, variables) {
  const response = await fetch(DAANGN_GRAPHQL_URL, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(10000),
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

async function verify() {
  const exhaustive = process.argv.includes("--full-list");
  const regions = exhaustive ? [1095, 1112, 1130, 1154, 1166] : [1095];
  for (const trade of process.argv.includes("--sale-only") ? ["BUY"] : ["MONTH", "BUY"]) {
    for (const region of regions) {
      const input = {clusterId: `REGION:${region}`, propertyFilter: {
        salesTypes: trade === "BUY"
          ? ["STORE", "OFFICE", "FACTORY", "ONE_ROOM", "TWO_ROOM", "OFFICETEL", "HOUSE", "BUILDING", "LAND"]
          : ["STORE", "OFFICE", "FACTORY"], tradeTypes: [trade]
      }};
      const job = {clusterId: input.clusterId, propertyFilter: input.propertyFilter,
        ids: [], providerIds: [], listPageSignatures: [], page: 0, cursor: "", hasNextPage: true};
      let detailId = "";
      do {
        const data = await query(job.page === 0 ? DAANGN_LIST_FIRST_HASH : DAANGN_LIST_NEXT_HASH,
          {first: exhaustive ? 100 : 1, after: job.cursor || null, input});
        const articles = observeDaangnListPage(job, data.articleByClusterId);
        if (!detailId) detailId = String(articles[0]?.originalId || "");
        if (job.page > 100) throw new Error("당근 검증 페이지 제한 초과");
      } while (job.hasNextPage && (exhaustive || job.page < 2));
      assert.ok(detailId, "당근 계약 검사용 클러스터가 비어 있습니다.");
      const detail = (await query(DAANGN_DETAIL_HASH, {articleId: detailId})).articleByOriginalArticleId;
      assert.ok(String(detail?.originalId) === detailId, "당근 상세 원본번호 불일치");
      assert.ok(Array.isArray(detail.trades), "당근 상세 거래조건 형식이 변경되었습니다.");
      if (exhaustive) assert.equal(daangnPresenceProof(job).completionProof.listComplete, true);
      console.log(JSON.stringify({region, trade, pages: job.page, uniqueAds: job.providerIds.length,
        terminal: !job.hasNextPage, detailVerified: true}));
    }
  }
  console.log("Daangn provider contract OK: first + pagination + detail (lease/sale)");
}

verify().catch(error => { console.error(error.message); process.exitCode = 1; });
