import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  collectorCompletionAudit,
  gongsilImageUrls,
  gongsilPhotoUrl,
  manifestEntryMatch
} from "../cloudflare/src/collector-api.js";

test("Gongsilbox relative photo paths become cacheable absolute image URLs", () => {
  const first = "2025/09/20250911_1212163928_00.png";
  const second = "2025/09/20250911_1212163928_01.jpg";
  assert.equal(gongsilPhotoUrl(first), `https://file1.gongsilbox.com/file/land_photo/${first}`);
  assert.equal(gongsilPhotoUrl("../private.png"), "");
  assert.deepEqual(gongsilImageUrls({
    raw: { list: { Photos: [{ Photo: first }, { Photo: second }], Xbfimg: "fallback.png" } }
  }), [
    `https://file1.gongsilbox.com/file/land_photo/${first}`,
    `https://file1.gongsilbox.com/file/land_photo/${second}`
  ]);
});

test("Gongsilbox representative image is used only when detail photos are absent", () => {
  const fallback = "2025/08/20250822_1129224858_00.png";
  assert.deepEqual(gongsilImageUrls({ raw: { list: { Photos: [], Xbfimg: fallback } } }), [
    `https://file1.gongsilbox.com/file/land_photo/${fallback}`
  ]);
});

test("legacy source rows bootstrap from stable listing terms without a detail refetch", () => {
  const row = {
    snapshot_hash: "",
    list_snapshot_json: JSON.stringify({
      deposit: 2000, rent: 80, area: 47.5, room: "2층", address: "유성구 구암동 601-19"
    })
  };
  const entry = {
    listSnapshot: "current-list-fingerprint",
    deposit: "2,000", rent: "80", area: 47.4, room: "2층", address: "대전광역시 유성구 구암동 601-19"
  };
  assert.equal(manifestEntryMatch(entry, row), "legacy");
});

test("legacy source rows still refetch when material rental terms change", () => {
  const row = {
    snapshot_hash: "",
    list_snapshot_json: JSON.stringify({
      deposit: 2000, rent: 80, area: 47.5, room: "2층", address: "유성구 구암동 601-19"
    })
  };
  assert.equal(manifestEntryMatch({
    listSnapshot: "changed-rent", deposit: 2000, rent: 90, area: 47.5,
    room: "2층", address: "유성구 구암동 601-19"
  }, row), "");
  assert.equal(manifestEntryMatch({
    listSnapshot: "changed-floor", deposit: 2000, rent: 80, area: 47.5,
    room: "1층", address: "유성구 구암동 601-19"
  }, row), "");
});

test("current fingerprints refetch different list snapshots", () => {
  const row = {
    snapshot_hash: "fnv1a-6733d49c",
    list_snapshot_json: "{}"
  };
  assert.equal(manifestEntryMatch({listSnapshot: "same"}, row), "");
});

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

test("Gongsilbox collective-building contacts retain the provider role label", async () => {
  const collector = await readFile(new URL("../js/gongsil-collector.js", import.meta.url), "utf8");
  const listingUi = await readFile(new URL("../js/script.js", import.meta.url), "utf8");
  assert.match(collector, /sourceRole:\s*candidateInfo\.buildingLevel && collectiveItem/);
  assert.match(collector, /role:\s*contact\.sourceRole \|\| contactRoleCode\(contact\.label\)/);
  assert.match(listingUi, /\^\(\?:주인\|관리\|사장\)\$/);
  assert.match(listingUi, /contact\.roleLabel \|\| meta\.name/);
});
