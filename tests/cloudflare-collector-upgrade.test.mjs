import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { collectorCompletionAudit } from "../cloudflare/src/collector-api.js";

test("complete collections require a current verified manifest", () => {
  const valid = collectorCompletionAudit({
    source: "공실박스", scope: "공실박스 2000개 이상 전체클러스터",
    complete: true, validationVersion: 2, collectorVersion: "2.0.0",
    expectedCount: 2000, manifestCount: 2012, processedCount: 2012,
    failed: 0, addressMissing: 0, truncated: false, note: "완전수집 완료"
  }, 2012);
  assert.equal(valid.complete, true);
  assert.deepEqual(valid.issues, []);
});

test("failed, incomplete, stale or truncated runs never count missing listings", () => {
  const unsafe = collectorCompletionAudit({
    source: "당근", scope: "대전 서구 완전수집", complete: true,
    validationVersion: 2, collectorVersion: "1.2.0",
    expectedCount: 1200, manifestCount: 1198, processedCount: 1190,
    failed: 3, addressMissing: 5, truncated: true, note: "구 완전수집 완료"
  }, 1198);
  assert.equal(unsafe.complete, false);
  assert.match(unsafe.issues.join(" / "), /예상 1200건 중 1198건만 확인/);
  assert.match(unsafe.issues.join(" / "), /실패 3건/);
  assert.match(unsafe.issues.join(" / "), /주소·층 오류 5건/);
  assert.match(unsafe.issues.join(" / "), /페이지 잘림/);

  const stale = collectorCompletionAudit({
    source: "네이버", scope: "대전 전체", complete: true,
    expectedCount: 500, manifestCount: 500, processedCount: 500
  }, 500);
  assert.equal(stale.complete, false);
  assert.match(stale.issues.join(" / "), /최신 수집기 검증정보 없음/);
});

test("collector installers always load the current js-map runtime", async () => {
  const files = await Promise.all([
    readFile(new URL("../collector-install.html", import.meta.url), "utf8"),
    readFile(new URL("../naver-collector-install.html", import.meta.url), "utf8"),
    readFile(new URL("../daangn-collector-install.html", import.meta.url), "utf8"),
    readFile(new URL("../js/collector-loader.js", import.meta.url), "utf8")
  ]);
  for (const source of files) assert.doesNotMatch(source, /my-map-ten-roan\.vercel\.app/);
  assert.match(files[0], /https:\/\/js-map\.com\/js\/collector-loader\.js/);
  assert.match(files[3], /naver-collector\.js/);
  assert.match(files[3], /daangn-collector\.js/);
  assert.match(files[3], /gongsil-collector\.js/);
});

test("collector updates reconcile individual media and contacts instead of replacing every row", async () => {
  const source = await readFile(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /DELETE FROM listing_media WHERE source_id=\?1/);
  assert.doesNotMatch(source, /DELETE FROM listing_contacts WHERE source_id=\?1/);
  assert.match(source, /DELETE FROM listing_media WHERE id=\?1/);
  assert.match(source, /DELETE FROM listing_contacts WHERE id=\?1/);
  assert.match(source, /loadExistingSources/);
  assert.match(source, /loadCandidateListings/);
});
