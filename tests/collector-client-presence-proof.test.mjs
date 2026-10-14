import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const naver = fs.readFileSync("js/naver-collector.js", "utf8");
const gongsil = fs.readFileSync("js/gongsil-collector.js", "utf8");
const daangn = fs.readFileSync("js/daangn-collector.js", "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function extract(source, names, context) {
  const blocks = names.map(name => {
    const block = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }`, "m"));
    assert.ok(block, name);
    return block[0];
  });
  vm.runInNewContext(blocks.join("\n") + "\nthis.api={" + names.join(",") + "};", context);
  return context.api;
}
const article = id => ({articleNumber: String(id)});
function naverHarness(pages = []) {
  const requests = [];
  const context = {Map, Set, Date, Object, Array, Number, String, JSON,
    state: {clickedClusterCount: 9000}, FIN_MAX_PAGES: 5, FIN_ARTICLE_LIST_PATH: "/list", CITY_PAGE_DELAY: 0,
    clean: value => String(value ?? "").trim(), formatNumber: String,
    throwIfStopRequested() {}, setStatus() {}, updateDashboard() {}, setProgress() {}, delay: async () => {},
    buildFinDistrictRequest: district => ({filter: {legalDivisionNumbers: [district.cortarNo], legalDivisionType: "GUN",
      tradeTypes: ["B2"], realEstateTypes: ["E02", "D02"]}}),
    fetchPageWithRetry: async (url, options) => {
      requests.push({url, options});
      const next = pages.shift(); assert.ok(next, "unexpected page request");
      return {ok: true, json: async () => next};
    }};
  const api = extract(naver, ["articleList", "articleId", "hasMore", "naverProviderTotal", "naverPresenceScope", "checkedNaverList",
    "naverListResult", "checkedNaverTotal", "collectFinDistrictRaw"], context);
  return {api, context, requests};
}
const page = (ids, total, next, cursor = [{cursor: "next"}]) => ({result: {
  list: ids.map(article), totalCount: total, hasNextPage: next, lastInfo: next ? cursor : []}});
test("Naver preserves original totals, requires the terminal page, and transports the actual region/filter proof", async () => {
  const h = naverHarness([page(["1", "2"], 3, true), page(["3"], 3, false)]);
  const result = await h.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"}, {});
  assert.equal(result.length, 3); assert.equal(h.requests.length, 2);
  assert.deepEqual(plain(result.presenceScope), {version: 1, selectionKind: "provider-region", regionCode: "3017000000",
    filters: {legalDivisionType: "GUN", tradeTypes: ["B2"], realEstateTypes: ["D02", "E02"]}});
  assert.equal(result.completionProof.providerExpectedCount, 3);
  assert.equal(result.completionProof.observedUniqueCount, 3);
  assert.equal(result.completionProof.terminalReached, true);
  assert.equal(result.completionProof.listComplete, true);
  assert.ok(Number.isFinite(Date.parse(result.completionProof.capturedAt)));
});
test("Naver empty/repeated pages, lost cursors, early terminals and changing totals never become full snapshots", async () => {
  for (const pages of [
    [page(["1"], 2, true), page([], 2, true)],
    [page(["1"], 2, true), page(["1"], 2, false)],
    [page(["1"], 2, true, [])],
    [{result: {totalCount: 0, hasNextPage: false}}],
    [page(["1"], 2, false)],
    [page(["1"], 2, true), page(["2"], 3, false)]
  ]) {
    const h = naverHarness(pages);
    await assert.rejects(h.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"}, {}),
      /빈 목록|반복|이어읽기|검증 실패|건수가 변경|응답 형식/);
  }
});
test("Naver filter changes cannot combine page IDs or resumed checkpoints into a different scope", async () => {
  const h = naverHarness([page(["1"], 2, true), page(["2"], 2, false)]);
  const original = h.context.buildFinDistrictRequest;
  let pageNumber = 0;
  h.context.buildFinDistrictRequest = district => {
    const request = original(district);
    if (pageNumber++) request.filter.realEstateTypes = ["D01"];
    return request;
  };
  await assert.rejects(h.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"}, {}), /범위나 필터가 변경/);
  assert.equal(h.requests.length, 1);
  const resumed = naverHarness([]);
  await assert.rejects(resumed.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"}, {
    nextPage: 2, observedIds: ["1"], presenceScopeSignature: "different-old-filter"
  }), /범위나 필터가 변경/);
  assert.equal(resumed.requests.length, 0);
});
test("Naver zero is provider evidence; missing total is not zero, and resumed old checkpoints cannot invent previous IDs", async () => {
  const h = naverHarness([page([], 0, false)]);
  const result = await h.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"}, {});
  assert.equal(result.length, 0); assert.equal(result.completionProof.emptyConfirmed, true);
  assert.equal(h.api.naverProviderTotal({}), null);
  assert.equal(h.api.naverProviderTotal({totalCount: false}), null);
  const missing = naverHarness([page(["2"], 2, false)]);
  await assert.rejects(missing.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"}, {nextPage: 2}), /검증 실패/);
  const resumed = naverHarness([page(["2"], 2, false)]);
  const resumedResult = await resumed.api.collectFinDistrictRaw({name: "서구", cortarNo: "3017000000"},
    {nextPage: 2, observedIds: ["1"], expectedCountKnown: true, providerExpectedCount: 2});
  assert.equal(resumedResult.completionProof.observedUniqueCount, 2);
});
function gongsilHarness(ids = ["one", "two"]) {
  const context = {window: {}, crypto: globalThis.crypto, TextEncoder, Uint8Array, Date,
    text: value => String(value ?? "").trim(), pick: (item, keys) => keys.map(key => item[key]).find(v => v != null && v !== "") ?? "",
    unique: values => [...new Set(values)]};
  context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__ = {capture: {complete: true, capturedAt: 1_800_000_000_000,
    body: {level: 13, btype: "Xone", search: {sch_lndtype: ["상가"]},
      areacoord: {minlat: 36.2, minlng: 127.2, maxlat: 36.5, maxlng: 127.5}},
    groups: ids.length ? [{fidxs: ids}] : []}};
  const api = extract(gongsil, ["observedSourceIds", "getSelectedItemCount", "stableGongsilScopeJson", "emptyGongsilMapCapture",
    "capturedGongsilPresenceScope", "gongsilCompletionProof", "isCompleteGongsilCapture", "getGongsilSourceFloor", "getRoom"], context);
  return {api, context, capture: {body: {level: 13, btype: "Xone", bfidxs: ids}}, items: ids.map(Bfidx => ({Bfidx}))};
}
test("small Gongsil scopes need exact full-map union, not a size threshold or largest-cluster label", async () => {
  const h = gongsilHarness();
  const scope = await h.api.capturedGongsilPresenceScope(h.capture, h.items);
  assert.ok(scope);
  assert.equal(h.api.isCompleteGongsilCapture(2, 2, scope), true);
  assert.equal(await h.api.capturedGongsilPresenceScope({...h.capture, body: {...h.capture.body, bfidxs: ["one"]}}, [h.items[0]]), null);
  assert.equal(await h.api.capturedGongsilPresenceScope(h.capture, [h.items[0]]), null);
  assert.equal(h.api.isCompleteGongsilCapture(5000, 5000, null), false);
  const proof = h.api.gongsilCompletionProof(h.capture, h.items, scope, []);
  assert.equal(proof.listComplete, true); assert.equal(proof.providerExpectedCount, 2);
  assert.equal(proof.capturedAt, new Date(1_800_000_000_000).toISOString());
});
test("Gongsil explicit success-empty map has scoped zero proof; deltas, failed lists and absent capture timestamps do not", async () => {
  const h = gongsilHarness([]);
  const capture = h.api.emptyGongsilMapCapture();
  const scope = await h.api.capturedGongsilPresenceScope(capture, []);
  const proof = h.api.gongsilCompletionProof(capture, [], scope, []);
  assert.equal(proof.emptyConfirmed, true); assert.equal(proof.providerExpectedCount, 0);
  assert.equal(h.api.gongsilCompletionProof(capture, [], scope, ["failed"]).listComplete, false);
  delete capture.presenceCapturedAt;
  assert.equal(h.api.gongsilCompletionProof(capture, [], scope, []).listComplete, false);
  h.context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.body.removecoord = {minlat: 36};
  assert.equal(await h.api.capturedGongsilPresenceScope(capture, []), null);
});
test("a newer Gongsil map response during fingerprinting invalidates the old proof rather than borrowing the new timestamp", async () => {
  const h = gongsilHarness();
  let release;
  h.context.crypto = {subtle: {digest: () => new Promise(resolve => { release = resolve; })}};
  const pending = h.api.capturedGongsilPresenceScope(h.capture, h.items);
  h.context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture = {...h.context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture,
    capturedAt: 1_800_000_001_000};
  release(new Uint8Array(32).buffer);
  assert.equal(await pending, null);
  assert.equal(h.capture.presenceCapturedAt, undefined);
});
test("Gongsil explicit floor and literal basement room survive as separate information", () => {
  const {api} = gongsilHarness();
  assert.equal(api.getGongsilSourceFloor({Ff: -1, Ho: "B03"}), -1);
  assert.equal(api.getRoom({Ff: -1, Ho: "B03"}), "지하1층 B03호");
  assert.equal(api.getRoom({Ff: "1F", Ho: ""}), "1층");
  assert.equal(api.getRoom({Ho: "B03"}), "B03호");
});
test("Daangn new client accepts only the server's honest terminal, scoped and timestamped proof", () => {
  const api = extract(daangn, ["verifiedDaangnCompletionProof"], {});
  const proof = {version: 1, terminalReached: true, listComplete: true, scopeVerified: true, capturedAt: new Date().toISOString(),
    expectedCountKnown: false, providerExpectedCount: null, observedUniqueCount: 2, issueCodes: []};
  assert.equal(api.verifiedDaangnCompletionProof(proof), true);
  for (const patch of [{terminalReached: false}, {capturedAt: null}, {expectedCountKnown: true, providerExpectedCount: 3},
    {observedUniqueCount: 0}, {scopeVerified: false}]) {
    assert.equal(api.verifiedDaangnCompletionProof({...proof, ...patch}), false);
  }
  assert.equal(api.verifiedDaangnCompletionProof({...proof, observedUniqueCount: 0, emptyConfirmed: true}), true);
});
