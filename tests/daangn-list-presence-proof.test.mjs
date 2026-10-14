import test from "node:test";
import assert from "node:assert/strict";
import {observeDaangnListPage, daangnPresenceProof} from "../cloudflare/src/collector-api.js";

const job = () => ({clusterId: "REGION:1095", propertyFilter: {tradeTypes: ["MONTH"], salesTypes: ["STORE"]},
  providerIds: [], ids: [], listPageSignatures: [], page: 0, cursor: "", hasNextPage: true,
  expectedCountKnown: false, providerExpectedCount: null});
const page = (ids, next, cursor, total) => ({edges: ids.map(originalId => ({node: {article: {originalId}}})),
  pageInfo: {hasNextPage: next, endCursor: cursor}, ...(total === undefined ? {} : {totalCount: total})});
test("Daangn cursor proof persists all provider IDs separately from selected-market IDs and retains legacy summary fields", () => {
  const value = job();
  assert.deepEqual(observeDaangnListPage(value, page(["one", "other-market"], true, "next", 3)).map(a => a.originalId), ["one", "other-market"]);
  value.ids.push("one");
  observeDaangnListPage(value, page(["two"], false, null, 3));
  value.ids.push("two"); value.found = 2; value.skippedUnchanged = 1; value.processed = 1;
  const {presenceScope, completionProof: proof} = daangnPresenceProof(value);
  assert.deepEqual(presenceScope, {version: 1, selectionKind: "provider-cluster", regionCode: "REGION:1095", filters: value.propertyFilter});
  assert.equal(proof.observedUniqueCount, 3); assert.equal(proof.providerExpectedCount, 3);
  assert.equal(proof.expected, 2); assert.equal(proof.observed, 2); assert.equal(proof.processed, 2);
  assert.equal(proof.listExhausted, true); assert.equal(proof.listComplete, true);
  assert.ok(Number.isFinite(Date.parse(proof.capturedAt)));
});
test("Daangn missing/repeating cursor, repeated pages, premature empty, malformed edges and total mismatches fail closed", () => {
  for (const invalid of [
    page(["one"], true, ""), page([], true, "next"), {edges: [], pageInfo: {}},
    {edges: null, pageInfo: {hasNextPage: false}}, page([""], false, null), page(["one"], false, null, 2),
    page(["one"], false, null, "invalid")
  ]) {
    const value = job();
    assert.throws(() => observeDaangnListPage(value, invalid));
    assert.equal(value.page, 0); assert.equal(value.providerIds.length, 0);
    assert.equal(daangnPresenceProof(value).completionProof.listComplete, false);
  }
  const repeated = job(); observeDaangnListPage(repeated, page(["one"], true, "next"));
  assert.throws(() => observeDaangnListPage(repeated, page(["one"], false, null)), /반복|새 원본번호/);
  assert.throws(() => observeDaangnListPage(repeated, page(["two"], true, "next")), /이어읽기/);
});
test("unknown Daangn total can use explicit terminal cursor proof; empty is only explicit empty, and legacy checkpoints never claim whole coverage", () => {
  const empty = job(); observeDaangnListPage(empty, page([], false, null));
  const proof = daangnPresenceProof(empty).completionProof;
  assert.equal(proof.expectedCountKnown, false); assert.equal(proof.providerExpectedCount, null);
  assert.equal(proof.emptyConfirmed, true); assert.equal(proof.listComplete, true);
  const legacy = job(); delete legacy.providerIds; delete legacy.listPageSignatures;
  legacy.page = 1; legacy.cursor = "old"; legacy.ids = ["earlier"];
  observeDaangnListPage(legacy, page(["latest"], false, null));
  assert.equal(daangnPresenceProof(legacy).completionProof.listComplete, false);
  assert.ok(daangnPresenceProof(legacy).completionProof.issueCodes.includes("legacy-list-checkpoint"));
  const detailLegacy = job(); delete detailLegacy.providerIds;
  detailLegacy.hasNextPage = false; detailLegacy.phase = "details";
  assert.equal(daangnPresenceProof(detailLegacy).completionProof.listComplete, false);
});
