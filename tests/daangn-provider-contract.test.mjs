import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {DAANGN_GRAPHQL_URL, DAANGN_LIST_FIRST_HASH, DAANGN_LIST_NEXT_HASH} from "../cloudflare/src/daangn-provider-contract.js";
import {observeDaangnListPage, daangnPresenceProof, validateDaangnJobTrade} from "../cloudflare/src/collector-api.js";

const source = readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
function extract(names, context) {
  const code = names.map(name => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
  vm.runInNewContext(code + "\nthis.run = runDaangnChunk;", context);
  return context.run;
}

for (const [clusterId, tradeType, trade] of [
  ["REGION:1154", "lease", "MONTH"], ["REGION:1130", "sale", "BUY"],
  ["CELL:892e615345bffff", "lease", "MONTH"]
]) {
  test(`current first/pagination operations preserve ${clusterId} ${tradeType} scope and terminal proof`, async () => {
    const filter = {salesTypes: ["STORE", "OFFICE", "FACTORY"], tradeTypes: [trade]};
    const url = new URL("https://realty.daangn.com/");
    url.searchParams.set("cluster_id", clusterId); url.searchParams.set("af", JSON.stringify(filter));
    const job = {status: "running", phase: "list", url: url.toString(), clusterId,
      tradeType, propertyFilter: filter, ids: [], entries: [], providerIds: [],
      listPageSignatures: [], page: 0, cursor: "", hasNextPage: true};
    const requests = [];
    let saved = 0;
    let classifiedProof;
    const run = extract(["daangnGraphql", "runDaangnChunk"], {
      AbortController, setTimeout, clearTimeout, Date,
      DAANGN_GRAPHQL_URL, DAANGN_LIST_FIRST_HASH, DAANGN_LIST_NEXT_HASH, DAANGN_REQUEST_TIMEOUT_MS: 10000,
      daangnJobId: () => "fixture", loadDaangnJob: async () => job,
      validateDaangnJobTrade, observeDaangnListPage, daangnPresenceProof,
      clean: value => String(value || "").trim(),
      daangnListEntry: article => ({sourceId: article.originalId}), isMonthlyCollectorRecord: () => true,
      classifyManifest: async (_env, body) => {
        classifiedProof = body.completionProof;
        return {needsDetail: ["ad-one", "ad-two"], unchanged: 0};
      },
      saveDaangnJob: async () => { saved++; }, publicDaangnJob: value => value,
      fetch: async (endpoint, options) => {
        assert.equal(endpoint, DAANGN_GRAPHQL_URL);
        const body = JSON.parse(options.body);
        requests.push(body);
        assert.deepEqual(body.variables.input, {clusterId, propertyFilter: filter});
        const first = requests.length === 1;
        assert.equal(body.extensions.persistedQuery.sha256Hash, first ? DAANGN_LIST_FIRST_HASH : DAANGN_LIST_NEXT_HASH);
        assert.equal(body.variables.after, first ? null : "next-cursor");
        return {ok: true, json: async () => ({data: {articleByClusterId: {
          edges: [{node: {article: {originalId: first ? "ad-one" : "ad-two"}}}],
          pageInfo: {endCursor: first ? "next-cursor" : null, hasNextPage: first}
        }}})};
      }
    });
    await run({}, {tradeType});
    assert.notEqual(DAANGN_LIST_FIRST_HASH, DAANGN_LIST_NEXT_HASH);
    assert.equal(requests.length, 2); assert.equal(saved, 1);
    assert.equal(job.phase, "details"); assert.equal(job.page, 2);
    assert.deepEqual(job.providerIds, ["ad-one", "ad-two"]);
    assert.equal(classifiedProof.listComplete, true);
    assert.equal(classifiedProof.terminalReached, true);
    assert.equal(classifiedProof.observedUniqueCount, 2);
  });
}
