import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseDaangnUrl, validateDaangnJobTrade, collectorCompletionAudit, mergeDaangnDetailWithList } from "../cloudflare/src/collector-api.js";

const read = file => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const client = read("js/daangn-collector.js");
const server = read("cloudflare/src/collector-api.js");
const background = read("edge-automation/extension/background.js");
function functions(source, names, context = {}, indent = "  ") {
  const code = names.map(name => {
    const match = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?^${indent}}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
  vm.runInNewContext(code + "\nthis.api={" + names.join(",") + "};", context);
  return context.api;
}
const url = (tradeTypes, extra = {}) => {
  const value = new URL("https://realty.daangn.com/?cluster_id=REGION1154&js_district=유성구");
  value.searchParams.set("af", JSON.stringify({ salesTypes: ["STORE", "OFFICE", "FACTORY"], ...extra,
    ...(tradeTypes === undefined ? {} : { tradeTypes }) }));
  return value.toString();
};
const names = ["detectTradeType", "automaticTradeType", "selectedClusterUrl", "buildClusterUrl", "districtFromUrl"];
function clientApi(selected = ["매매"]) {
  return functions(client, names, { URL, location: { href: url(["BUY"]) },
    document: { querySelectorAll: () => selected.map(textContent => ({ textContent })) } });
}

for (const [values, expected] of [[["MONTH"], "lease"], [["BUY"], "sale"]]) {
  test(`structured ${values} ignores salesTypes key and opposite page selection`, () => {
    const api = clientApi(expected === "lease" ? ["매매"] : ["월세"]);
    assert.equal(api.detectTradeType(url(values)), expected);
    assert.equal(parseDaangnUrl(url(values)).tradeType, expected);
    assert.equal(api.automaticTradeType({ tradeType: expected }, url(values)), expected);
    const opposite = expected === "lease" ? "sale" : "lease";
    assert.throws(() => api.automaticTradeType({ tradeType: opposite }, url(values)), /거래유형 설정 불일치/);
    assert.throws(() => parseDaangnUrl(url(values), opposite), /거래유형 설정 불일치/);
  });
}
for (const values of [[], ["BUY", "MONTH"], ["JEONSE"], ["NOT_BUY"], "MONTH", ["MONTHLY_RENT"]]) {
  test(`unsupported/mixed trade filter is rejected: ${JSON.stringify(values)}`, () => {
    assert.equal(clientApi().detectTradeType(url(values)), "");
    assert.throws(() => parseDaangnUrl(url(values), "lease"), /거래유형 설정/);
    assert.throws(() => clientApi().automaticTradeType({}, url(values)), /거래유형 설정/);
  });
}
test("malformed JSON cannot silently switch collection markets", () => {
  const value = new URL(url(["MONTH"])); value.searchParams.set("af", "{broken");
  assert.equal(clientApi().detectTradeType(value.toString()), "");
  assert.throws(() => parseDaangnUrl(value.toString()), /거래유형 설정 오류/);
});
test("legacy targets default to monthly rent; explicit sale without filter stays sale", () => {
  const api = clientApi(["매매"]);
  assert.equal(api.automaticTradeType({}, url()), "lease");
  assert.equal(api.automaticTradeType({ tradeType: "sale" }, url()), "sale");
  assert.deepEqual(parseDaangnUrl(url()).propertyFilter.tradeTypes, ["MONTH"]);
  assert.deepEqual(parseDaangnUrl(url(), "sale").propertyFilter.tradeTypes, ["BUY"]);
});
test("registered URL retains its own market and property filters, not current browser page", () => {
  const registered = url(["MONTH"], { salesTypes: ["OFFICE"], minPrice: 100 });
  const selected = clientApi().selectedClusterUrl(registered, "유성구");
  assert.deepEqual(JSON.parse(new URL(selected).searchParams.get("af")), JSON.parse(new URL(registered).searchParams.get("af")));
  assert.equal(clientApi().detectTradeType(selected), "lease");
});
test("manual selection and delayed network captures cannot replace an automatic target", () => {
  const state = { automaticRunning: true, selectedUrl: url(["MONTH"]), tradeType: "lease" };
  const api = functions(client, ["captureSelectedCluster", "syncSelectionFromLocation", "handleMapMarkerClick"], { state });
  api.captureSelectedCluster(url(["BUY"]), "서구"); api.syncSelectionFromLocation(true); api.handleMapMarkerClick({});
  assert.equal(state.tradeType, "lease"); assert.equal(state.selectedUrl, url(["MONTH"]));
});
test("old corrupt job is rejected before any provider request or database write", async () => {
  const job = { status: "running", phase: "list", url: url(["MONTH"]), tradeType: "sale" };
  const api = functions(server, ["runDaangnChunk"], { loadDaangnJob: async () => job,
    daangnJobId: () => "test", validateDaangnJobTrade }, "");
  await assert.rejects(api.runDaangnChunk({}, { tradeType: "sale" }), /거래유형 설정 불일치/);
  assert.match(server, /if \(action === "danggeunResumeJob"\) validateDaangnJobTrade\(job, body.tradeType\)/);
});
test("checkpoint filter and incoming request cannot cross markets", () => {
  const job = { url: url(["MONTH"]), tradeType: "lease", propertyFilter: { tradeTypes: ["BUY"] } };
  assert.throws(() => validateDaangnJobTrade(job, "lease"), /거래유형 설정/);
  job.propertyFilter.tradeTypes = ["MONTH"];
  assert.throws(() => validateDaangnJobTrade(job, "sale"), /거래유형 설정/);
  assert.equal(validateDaangnJobTrade(job, "lease").tradeType, "lease");
});
test("sale apartments still rejected; rental categories still retained", () => {
  assert.throws(() => parseDaangnUrl(url(["BUY"], { salesTypes: ["APARTMENT"] })), /아파트 매매/);
  assert.deepEqual(parseDaangnUrl(url(["MONTH"])).propertyFilter.salesTypes, ["STORE", "OFFICE", "FACTORY"]);
});

test("one article with BUY and MONTH uses the requested offer, including updated detail rent", () => {
  const article = { originalId: "dual", salesTypeV3: { type: "STORE" }, trades: [
    { type: "BUY", price: 35000, preferred: true },
    { type: "MONTH", deposit: 1000, monthlyPay: 45 }
  ] };
  const lease = mergeDaangnDetailWithList(article, { rent: 40 }, clientApi().detectTradeType(url(["MONTH"])));
  assert.equal(lease.tradeType, "lease"); assert.equal(lease.rent, 45); assert.equal(lease.deposit, 1000);
  const sale = mergeDaangnDetailWithList(article, {}, "sale");
  assert.equal(sale.tradeType, "sale"); assert.equal(sale.salePrice, 35000); assert.equal(sale.rent, 0);
});

test("automatic runner starts the saved monthly target even while page shows sale", async () => {
  const state = { jobRequestGeneration: 0 };
  let started = 0;
  const context = { ...clientApi(), URL, VERSION: "1.5.1", state, panel: { style: {} },
    renderSelection() {}, refreshJobStatus: async () => {}, startOrResume: async () => {
      started++;
      assert.equal(state.tradeType, "lease");
      state.job = { status: "complete", completeCollection: true };
    } };
  const api = functions(client, ["runAutomatic", "runAutomaticTarget"], context);
  const result = await api.runAutomatic({ url: url(["MONTH"]), district: "유성구", tradeType: "lease" });
  assert.equal(started, 1); assert.equal(result.partial, false); assert.equal(state.automaticRunning, false);
});

const warnings = functions(background, ["completedTargetWithWarnings", "cleanSource"], {}, "");
const smallResult = () => ({ ok: true, result: { source: "daangn", partial: true,
  completionIssues: ["관찰 원본 100건 미만"], totals: { status: "complete", phase: "complete", found: 45, failed: 0, addressMissing: 0,
    completionProof: { version: 1, listExhausted: true, expected: 45, observed: 45, processed: 45 } } } });
test("exhausted small scope is a warning completion, without weakening missing-ad safety", () => {
  assert.equal(warnings.completedTargetWithWarnings(smallResult()), true);
  const audit = collectorCompletionAudit({ source: "당근", complete: true, scope: "대전 서구 완전수집",
    validationVersion: 2, collectorVersion: "1.5.1", expectedCount: 45, manifestCount: 45, processedCount: 45 }, 45);
  assert.equal(audit.complete, false);
  assert.deepEqual(audit.blockingIssues, ["관찰 원본 100건 미만"]);
});
test("address-only exclusions finish with a warning, actual failures keep retrying", () => {
  const result = smallResult();
  Object.assign(result.result.totals, { failed: 2, addressMissing: 2 });
  result.result.completionIssues.push("실패 2건", "주소·층 오류 2건");
  assert.equal(warnings.completedTargetWithWarnings(result), true);
  result.result.totals.failed = 3;
  assert.equal(warnings.completedTargetWithWarnings(result), false);
});
for (const patch of [
  result => result.ok = false,
  result => result.result.totals.status = "running",
  result => result.result.totals.completionProof.listExhausted = false,
  result => result.result.totals.completionProof.processed = 44,
  result => result.result.totals.completionProof.expected = 46,
  result => delete result.result.totals.completionProof,
  result => result.result.completionIssues.push("목록 페이지 잘림")
]) {
  test(`incomplete or unproven run must not pass warning completion: ${patch}`, () => {
    const result = smallResult(); patch(result);
    assert.equal(warnings.completedTargetWithWarnings(result), false);
  });
}
test("Naver warning completion remains supported", () => {
  assert.equal(warnings.completedTargetWithWarnings({ result: { source: "naver", session: {
    completeRequested: true, expectedCount: 100, processedCount: 100 } } }), true);
});
