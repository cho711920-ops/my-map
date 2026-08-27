import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  carryConfirmedVisitMemo,
  hasConfirmedVisitMemo,
  markConfirmedVisitMemo,
  preserveConfirmedVisitMemo
} from "../cloudflare/src/visit-status.js";

test("provider refreshes never overwrite a confirmed visit memo", () => {
  const confirmed = "(확인매물) / 현장 메모 · 열쇠는 우편함";
  const incoming = "(임장가자) 새 당근 광고 설명";
  assert.equal(preserveConfirmedVisitMemo(confirmed, incoming), confirmed);
  assert.equal(preserveConfirmedVisitMemo("(임장가자) 기존", incoming), incoming);
  assert.equal(hasConfirmedVisitMemo(confirmed), true);
});

test("merge and separation carry confirmation to the surviving master", () => {
  assert.equal(
    carryConfirmedVisitMemo("(임장가자) 대상 대표 메모", "(확인매물) / 출발 대표 메모"),
    "(확인매물) / 대상 대표 메모"
  );
  assert.equal(
    carryConfirmedVisitMemo("(확인매물) / 대상 메모", "(임장가자) 출발 메모"),
    "(확인매물) / 대상 메모"
  );
  assert.equal(markConfirmedVisitMemo("(공실박스) 내부 화장실"), "(확인매물) / 내부 화장실");
});

test("every representative-writing and master-moving path uses confirmation preservation", async () => {
  const collector = await readFile(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  const d1 = await readFile(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
  const repair = await readFile(new URL("../tools/restore-confirmed-visits-2026-08-20.sql", import.meta.url), "utf8");

  assert.match(collector, /SELECT main_source, operating_memo, status FROM listings/);
  assert.match(collector, /preserveConfirmedVisitMemo\(currentListing\?\.operating_memo, record\.memo\)/);
  assert.equal((collector.match(/record\.area, representativeMemo/g) || []).length, 2);
  assert.match(collector, /carryConfirmedVisitMemo\(primaryMemo, duplicate\.operating_memo\)/);
  assert.match(d1, /carryConfirmedVisitMemo\(original\.memo, parent\?\.operating_memo\)/);
  assert.match(d1, /carryConfirmedVisitMemo\(target\.operating_memo, source\.operating_memo\)/);
  assert.match(repair, /restoreConfirmedVisitMarker/);
  assert.match(repair, /h\.after_json LIKE '%\(확인매물\)%'/);
});
