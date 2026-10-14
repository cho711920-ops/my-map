import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizedRecord, staleAdvertisementSave } from "../cloudflare/src/collector-api.js";
import { normalizeCollectionCounts, summarizeCollectionDay } from "../cloudflare/src/collection-status-summary.js";

test("old or unproved saves cannot resurrect an ended advertisement", t => {
  t.mock.timers.enable({apis: ["Date"], now: Date.parse("2026-10-14T07:00:00Z")});
  const ended = {active: 0, missing_count: 1, updated_at: "2026-10-14T06:00:00Z"};
  assert.equal(staleAdvertisementSave(ended), true);
  assert.equal(staleAdvertisementSave(ended, {completionProof: {capturedAt: "2026-10-14T05:00:00Z"}}), true);
  assert.equal(staleAdvertisementSave(ended, {completionProof: {capturedAt: "2026-10-14T06:30:00Z"}}), false);
  assert.equal(staleAdvertisementSave(ended, {completionProof: {capturedAt: "2026-10-15T06:30:00Z"}}), true);
  assert.equal(staleAdvertisementSave({active: 1, updated_at: "2026-10-14T06:00:00Z"}), false);
  assert.equal(staleAdvertisementSave(null), false);
});

test("Gongsil server boundary preserves the explicit basement and literal B03 room", () => {
  const row = normalizedRecord("공실박스", {externalId: "123", tradeType: "lease",
    values: ["가영주택", "서구 갈마동 965", "B03", "상가점포", 300, 30],
    raw: {list: {Ff: -1, Ho: "B03"}}});
  assert.equal(row.room, "지하1층 B03호");
  assert.equal(row.sourceFloor, -1);
  assert.equal(row.sourceRoom, "B03");
});

test("review retirement preserves old evidence without publishing unobserved historic ads", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE collector_raw(id TEXT,processing_state TEXT,result_json TEXT,payload_json TEXT,processed_at TEXT)");
    db.exec("CREATE TABLE listing_history(listing_id TEXT,action TEXT)");
    db.prepare("INSERT INTO collector_raw VALUES(?,?,?,?,?)").run("R1", "review", '{"candidateIds":["M1"]}', '{"sourceId":"123","room":"B03"}', "");
    db.prepare("INSERT INTO collector_raw VALUES(?,?,?,?,?)").run("E1", "error", '{}', '{"sourceId":"456"}', "");
    db.exec(fs.readFileSync(new URL("../cloudflare/migrations/0026_advertisement_presence_policy.sql", import.meta.url), "utf8"));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM collector_raw WHERE processing_state='review'").get().n, 0);
    const row = db.prepare("SELECT * FROM collector_raw WHERE id='R1'").get();
    assert.equal(row.processing_state, "awaiting_source_refresh");
    assert.equal(row.payload_json, '{"sourceId":"123","room":"B03"}');
    assert.deepEqual(JSON.parse(row.result_json).candidateIds, ["M1"]);
    assert.equal(db.prepare("SELECT processing_state s FROM collector_raw WHERE id='E1'").get().s, "error");
  } finally { db.close(); }
});

test("daily reports distinguish verified endings, baseline, withheld absence and legacy unknowns", () => {
  assert.equal(normalizeCollectionCounts({presenceReported: false, presenceTracking: false}).presenceReported, false);
  const rows = [
    {sessionId: "N",source: "네이버",scope: "서구 전체",startedAt: "2026-10-14T02:00:00Z",complete: true,
      presenceScopeKey: "naver-A",presenceScopeKind: "provider-region",presenceReported: true,presenceTracking: true,deactivated: 2,adsReappeared: 1},
    {sessionId: "D",source: "당근",scope: "서구 선택 클러스터",startedAt: "2026-10-14T02:00:00Z",complete: true,
      presenceScopeKey: "daangn-A",presenceScopeKind: "provider-cluster",presenceReported: true,presenceTracking: true,presenceScopeEstablished: true},
    {sessionId: "G",source: "공실박스",scope: "선택 목록",startedAt: "2026-10-14T02:00:00Z",complete: true,
      presenceReported: true,presenceTracking: false}
  ];
  const report = summarizeCollectionDay(rows, "2026-10-14");
  assert.equal(report.totals.deactivated, 2);
  assert.equal(report.totals.adsReappeared, 1);
  assert.equal(report.totals.baselineScopes, 1);
  assert.equal(report.totals.absenceDeferredScopes, 1);
  assert.equal(report.districtCoverage.find(row => row.source === "당근").districts.find(row => row.district === "서구").state, "scope-only");
});
