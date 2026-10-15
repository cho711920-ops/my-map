import test from "node:test";
import assert from "node:assert/strict";
import {background, result, extract, read} from "./fixtures/daangn-report-fixture.mjs";
import {sanitizeAutomationRunReport} from "../cloudflare/src/automation-run-reports.js";
import {normalizeNewSourceAdCounts} from "../cloudflare/src/collection-status-summary.js";

const plain = value => JSON.parse(JSON.stringify(value));
const lifecycle = {presenceReported: true, missingMarked: 9, deactivated: 4, adsReappeared: 2,
  presenceTracking: true, presenceScopeEstablished: false, presenceTrackingIssue: ""};
const ui = extract(read("edge-automation/extension/options.js"),
  ["escapeHtml", "registeredTime", "displayCounts", "countText", "reportStatus", "renderRunSummary"],
  {state: {}, STATUS_TEXT: {completed: "완료", partial: "부분완료"}});

for (const source of ["naver", "daangn", "gongsil"]) {
  test(`${source} finalization counters survive the final-result report boundary`, () => {
    const run = source === "daangn" ? result() : {result: {source, session: {
      expectedCount: 20, processedCount: 20, ...lifecycle}, totals: {created: 1}}};
    if (source === "daangn") Object.assign(run.result.totals, lifecycle);
    const counts = background.resultCounts(run);
    for (const [key, value] of Object.entries(lifecycle)) assert.equal(counts[key], value, key);
    const text = ui.countText({source, status: "completed", counts});
    assert.match(text, /원본광고 미노출 4건/);
    assert.match(text, /원본광고 재등장 2건/);
    assert.doesNotMatch(text, /미노출 9건|계약완료|거래완료/);
    assert.match(background.resultNotice(run), /원본광고 미노출 4건/);
  });
}

test("scope deferral, initial baseline and a verified zero removal are distinct, never inferred from legacy zeros", () => {
  const item = counts => ({source: "gongsil", status: "completed", counts});
  for (const [flags, label, forbidden] of [
    [{presenceTracking: false, presenceTrackingIssue: "unverified-map-scope"}, "종료판정보류", /비교기준저장|미노출/],
    [{presenceScopeEstablished: true, deactivated: 0}, "비교기준저장", /종료판정보류|미노출/],
    [{deactivated: 0}, "원본광고 미노출 0건", /종료판정보류|비교기준저장/]
  ]) {
    const counts = {...lifecycle, adsReappeared: 0, ...flags};
    const text = ui.countText(item(counts));
    assert.ok(text.includes(label)); assert.doesNotMatch(text, forbidden);
    const summary = ui.renderRunSummary({startedAt: Date.now(), items: [item(counts)]});
    assert.ok(summary.includes(label)); assert.doesNotMatch(summary, forbidden);
  }
  const legacy = background.resultCounts({result: {source: "gongsil", totals: {processed: 20}}});
  assert.equal(legacy.presenceReported, undefined);
  assert.doesNotMatch(ui.countText(item(legacy)), /미노출|종료판정|비교기준/);
  const explicitlyUnknown = background.resultCounts({result: {source: "gongsil",
    totals: {presenceReported: false, deactivated: 0, presenceTracking: false}}});
  assert.equal(explicitlyUnknown.presenceReported, undefined);
});

test("a new verified Daangn empty census is zero, not the old registered target count or pre-counting", () => {
  const run = result(0, 0, 0);
  run.result.completionIssues = [];
  run.result.totals.created = 0; run.result.totals.review = 0;
  Object.assign(run.result.totals.completionProof, {terminalReached: true, listComplete: true, scopeVerified: true,
    expectedCountKnown: true, providerExpectedCount: 0, observedUniqueCount: 0, emptyConfirmed: true,
    capturedAt: new Date().toISOString(), issueCodes: []});
  const counts = background.resultCounts(run);
  assert.equal(counts.listComplete, true);
  assert.equal(background.completedTargetWithWarnings(run), true);
  assert.equal(ui.countText({source: "daangn", status: "completed", counts}, {selectedCount: 500}), "목록 0건 · 확인 0건");
  run.result.totals.completionProof.emptyConfirmed = false;
  assert.equal(background.resultCounts(run).listComplete, false);
  assert.equal(background.completedTargetWithWarnings(run), false);
});

test("new provider proof errors cannot be bypassed by internally consistent legacy counts", () => {
  for (const patch of [{terminalReached: false}, {listComplete: false}, {scopeVerified: false},
    {capturedAt: "bad"}, {issueCodes: ["repeat-page"]}, {providerExpectedCount: 2079}]) {
    const run = result();
    Object.assign(run.result.totals.completionProof, {terminalReached: true, listComplete: true, scopeVerified: true,
      expectedCountKnown: true, providerExpectedCount: 2078, observedUniqueCount: 2078, emptyConfirmed: false,
      capturedAt: new Date().toISOString(), issueCodes: [], ...patch});
    assert.equal(background.resultCounts(run).listComplete, false);
    assert.equal(background.completedTargetWithWarnings(run), false);
  }
});

test("cloud report transport preserves lifecycle states but never uploads arbitrary issue details", async () => {
  const now = Date.now();
  const config = {targets: []};
  const api = extract(read("edge-automation/extension/background.js"), ["minimalAutomationReport"], {
    BACKGROUND_BUILD: "1.1.14", getConfig: async () => config, automationReadiness: async () => ({}),
    targetKey: value => value.key, inferredTradeType: () => "lease"});
  const input = {runId: `run-${now}-presence`, startedAt: now, updatedAt: now + 1, active: false,
    items: [{source: "gongsil", status: "completed", counts: {...lifecycle,
      presenceTrackingIssue: "https://private.example/?key=secret 010-1234-5678", raw: {secret: "never"}}}]};
  const local = await api.minimalAutomationReport(input);
  const clean = sanitizeAutomationRunReport(plain(local), now + 10);
  for (const value of [local, clean]) {
    const text = JSON.stringify(value);
    assert.doesNotMatch(text, /https|secret|010-1234|raw/);
    assert.equal(value.items[0].counts.deactivated, 4);
    assert.equal(value.items[0].counts.missingMarked, 9);
    assert.equal(value.items[0].counts.adsReappeared, 2);
    assert.equal(value.items[0].counts.presenceReported, true);
    assert.equal(value.items[0].counts.presenceTrackingIssue, "동일 범위·전체목록 확인 필요");
  }
});

test("Gongsil saved-but-unproved viewport reports a deferral without retrying the finished collection", async () => {
  const state = {dashboard: {}, collectionTradeType: "lease"};
  const finalization = {...lifecycle, presenceTracking: false, presenceTrackingIssue: "unverified-map-scope"};
  const api = extract(read("js/gongsil-collector.js"), ["newSourceAdCounts", "runAutomaticTarget"], {
    state, VERSION: "test", panel: {style: {}}, window: {setTimeout}, setStatus() {},
    emptyGongsilMapCapture: () => null,
    clickScreenLargestCluster: () => {state.capture = {}; return 20;},
    getSelectedItemCount: () => 20,
    collectAndSave: async () => {
      state.dashboard = {found: 20, processed: 20, failed: 0};
      state.lastResult = {ok: true, ...finalization, finalization};
    }
  }, "  ");
  const output = await api.runAutomaticTarget({tradeType: "lease"});
  assert.equal(output.partial, false);
  assert.equal(output.session, finalization);
  const counts = background.resultCounts({result: output});
  assert.equal(counts.presenceTrackingIssue, "unverified-map-scope");
  assert.match(ui.countText({source: "gongsil", status: "completed", counts}), /종료판정보류/);
});

test("Gongsil automatic completion cannot reuse old successful dashboard numbers without a current save response", async () => {
  const state = {dashboard: {found: 20, processed: 20, failed: 0}, collectionTradeType: "lease"};
  const api = extract(read("js/gongsil-collector.js"), ["newSourceAdCounts", "runAutomaticTarget"], {
    state, VERSION: "test", panel: {style: {}}, window: {setTimeout}, setStatus() {},
    emptyGongsilMapCapture: () => null, clickScreenLargestCluster: () => {state.capture = {}; return 20;},
    getSelectedItemCount: () => 20, collectAndSave: async () => {}
  }, "  ");
  await assert.rejects(api.runAutomaticTarget({tradeType: "lease"}), /최종 저장 응답/);
});

test("Gongsil batch finalization preserves all counters and its message uses deactivated, not missing-marked", async () => {
  const api = extract(read("js/gongsil-collector.js"), ["newSourceAdCounts", "sendToAppsScript"], {
    state: {stopRequested: false}, importItemTotal: () => 0, collectionSignature: () => "empty",
    finalizeGongsilSession: async () => lifecycle, localStorage: {removeItem() {}}, SAVE_PROGRESS_KEY: "test",
    text: value => String(value || "")
  }, "  ");
  const output = await api.sendToAppsScript([], {manifestRegistered: true, sessionId: "test"}, "test-key");
  for (const [key, value] of Object.entries(lifecycle)) assert.equal(output[key], value, key);
  assert.match(output.message, /원본광고 미노출 4건/);
  assert.match(output.message, /원본광고 재등장 2건/);
  assert.doesNotMatch(output.message, /미노출 9건|계약완료|거래완료/);
});

test("Naver automatic completion keeps the full server finalization in its session result", async () => {
  const finalResult = {ok: true, complete: true, expectedCount: 20, processedCount: 20, ...lifecycle};
  const api = extract(read("js/naver-collector.js"), ["newSourceAdCounts", "runAutomatic"], {
    state: {dashboard: {found: 20, processed: 20}}, panel: {style: {}}, VERSION: "test", isFinNaver: () => true,
    DAEJEON_DISTRICTS: [{name: "서구", cortarNo: "3017000000"}], autoDistrictSelect: {}, autoRegisterButton: {},
    collectFinSelectedAndSave: async () => ({ok: true, complete: true, finalResult})
  }, "  ");
  const output = await api.runAutomatic({district: {name: "서구"}});
  assert.equal(output.session, finalResult);
  const counts = background.resultCounts({result: output});
  assert.equal(counts.deactivated, 4); assert.equal(counts.adsReappeared, 2);
});

test("Daangn server completion copies the lifecycle finalization into its public job counters", async () => {
  const api = extract(read("cloudflare/src/collector-api.js"), ["finalizeDaangnJob"], {
    normalizeNewSourceAdCounts,
    daangnPresenceProof: () => ({presenceScope: {selectionKind: "provider-cluster"}, completionProof: {listComplete: true}}),
    finalizeSession: async () => ({ok: true, complete: true, ...lifecycle}),
    countValue: value => Math.max(0, Number(value || 0)), clean: value => String(value || "").trim()});
  const job = {found: 20, ids: [], providerIds: [], failed: 0, addressMissing: 0};
  await api.finalizeDaangnJob({}, job);
  for (const [key, value] of Object.entries(lifecycle)) assert.equal(job[key], value, key);
  assert.match(job.message, /원본광고 미노출 4건/);
  assert.match(job.message, /원본광고 재등장 2건/);
});
