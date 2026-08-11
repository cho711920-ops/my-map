import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  collectorCompletionAudit,
  gongsilImageUrls,
  gongsilPhotoUrl,
  manifestEntryMatch,
  mergeDaangnDetailWithList,
  normalizedRecord,
  shouldRefreshGongsilDetail,
  sourceConditionChanged
} from "../cloudflare/src/collector-api.js";

test("Daangn detail rows inherit stable list fields when the detail response omits them", () => {
  const record = mergeDaangnDetailWithList({
    originalId: "987654321",
    trades: [{ preferred: true, type: "MONTHLY_RENT" }],
    content: "detail without address or floor"
  }, {
    sourceId: "987654321",
    listSnapshot: "list-fingerprint",
    address: "대전광역시 서구 괴정동 100-1",
    room: "B1층",
    deposit: 3000,
    rent: 120,
    area: 33.4
  });
  assert.equal(record.sourceId, "987654321");
  assert.equal(record.address, "대전광역시 서구 괴정동 100-1");
  assert.equal(record.room, "B1층");
  assert.equal(record.deposit, 3000);
  assert.equal(record.rent, 120);
  assert.equal(record.area, 33.4);
  assert.equal(record.listSnapshot, "list-fingerprint");
  assert.equal(record.latitude, null);
  assert.equal(record.longitude, null);
});

test("Daangn addressInfo is accepted as a provider address candidate", () => {
  const record = mergeDaangnDetailWithList({
    originalId: "123456789",
    addressInfo: "대전광역시 유성구 봉명동 100-2",
    trades: [{ preferred: true, type: "MONTHLY_RENT", deposit: 1000, monthlyPay: 80 }]
  });
  assert.match(record.address, /유성구 봉명동 100-2/);
});

test("Daangn structured building address wins over a floor number in addressInfo", () => {
  const record = mergeDaangnDetailWithList({
    originalId: "3851563",
    publicJibunAddress: "대전광역시 유성구 봉명동",
    addressInfo: "봉명동 1층 코너각지, 식당이었던 자리",
    complex: {
      buildingsForAddress: {
        edges: [{ node: {
          roadAddress: "대전광역시 유성구 봉명서로 61-3",
          jibunAddress: "대전광역시 유성구 봉명동 1030-4"
        } }]
      }
    },
    publicCoordinate: { lat: "36.3578080", lon: "127.3272713" },
    trades: [{ preferred: true, type: "MONTHLY_RENT", deposit: 3000, monthlyPay: 130 }]
  });
  assert.equal(record.address, "유성구 봉명동 1030-4");
  assert.equal(record.latitude, 36.357808);
  assert.equal(record.longitude, 127.3272713);
});

test("pre-normalized Daangn rows are repaired again from their raw provider detail", () => {
  const record = normalizedRecord("당근", {
    source: "당근",
    sourceId: "4157102",
    address: "봉명동 1",
    room: "1층",
    latitude: null,
    longitude: null,
    raw: {
      originalId: "4157102",
      publicJibunAddress: "대전광역시 유성구 봉명동",
      addressInfo: "봉명동 1층 상가 월세",
      complex: {
        buildingsForAddress: {
          edges: [{ node: {
            roadAddress: "대전광역시 유성구 계룡로59번길 25",
            jibunAddress: "대전광역시 유성구 봉명동 469-18"
          } }]
        }
      },
      publicCoordinate: { lat: "36.3585108", lon: "127.3421884" },
      trades: [{ preferred: true, type: "MONTH", deposit: 1800, monthlyPay: 60 }]
    }
  });
  assert.equal(record.address, "유성구 봉명동 469-18");
  assert.equal(record.latitude, 36.3585108);
  assert.equal(record.longitude, 127.3421884);
});

test("Daangn road-address placeholders use the explicit property category", () => {
  const store = mergeDaangnDetailWithList({
    originalId: "4182029",
    complex: { name: "계룡로 658-4", jibunAddress: "대전광역시 서구 용문동 257-5" },
    salesTypeV3: { type: "STORE" },
    trades: [{ preferred: true, type: "MONTHLY_RENT", deposit: 1000, monthlyPay: 70 }]
  });
  const office = mergeDaangnDetailWithList({
    originalId: "office-1",
    complex: { name: "둔산로 100", jibunAddress: "대전광역시 서구 둔산동 100" },
    salesTypeV3: { type: "OFFICE" },
    trades: [{ preferred: true, type: "MONTHLY_RENT", deposit: 1000, monthlyPay: 70 }]
  });
  const named = mergeDaangnDetailWithList({
    originalId: "named-1",
    buildingName: "테크노월드",
    complex: { jibunAddress: "대전광역시 유성구 관평동 100" },
    salesTypeV3: { type: "STORE" },
    trades: [{ preferred: true, type: "MONTHLY_RENT", deposit: 1000, monthlyPay: 70 }]
  });
  assert.equal(store.buildingName, "일반상가");
  assert.equal(office.buildingName, "사무실");
  assert.equal(named.buildingName, "테크노월드");
});

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

test("legacy recovery marker is not mistaken for a current list fingerprint", () => {
  const row = {
    snapshot_hash: "legacy-recovery",
    list_snapshot_json: JSON.stringify({
      deposit: 2000, rent: 80, area: 47.5, room: "2층", address: "유성구 구암동 601-19"
    })
  };
  assert.equal(manifestEntryMatch({
    listSnapshot: "new-current-fingerprint", deposit: 2000, rent: 80, area: 47.4,
    room: "2층", address: "대전광역시 유성구 구암동 601-19"
  }, row), "legacy");
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

test("presentation-only fingerprint changes do not refetch unchanged rental terms", () => {
  const row = {
    snapshot_hash: "fnv1a-00000000",
    list_snapshot_json: "old provider presentation",
    saved_deposit: 3000,
    saved_rent: 120,
    saved_area: 33,
    saved_room: "2층",
    saved_address: "서구 둔산동 100-1"
  };
  assert.equal(manifestEntryMatch({
    listSnapshot: "new title, tags or representative photo",
    deposit: 3000,
    rent: 120,
    area: 33.4,
    room: "2층",
    address: "대전광역시 서구 둔산동 100-1"
  }, row), "material");
});

test("Gongsilbox unchanged details refresh weekly instead of on every daily collection", () => {
  const now = Date.parse("2026-08-10T06:00:00.000Z");
  assert.equal(shouldRefreshGongsilDetail("2026-08-09T06:00:00.000Z", now), false);
  assert.equal(shouldRefreshGongsilDetail("2026-08-02T06:00:00.000Z", now), true);
  assert.equal(shouldRefreshGongsilDetail("", now), true);
});

test("source refreshes are separated from actual rental-condition changes", () => {
  const previous = { room: "2층", type: "일반상가", deposit: 2000, rent: 90,
    fee: 10, premium: 0, area: 26, memo: "기존", photoCount: 1, contactCount: 1 };
  assert.equal(sourceConditionChanged(previous, {
    ...previous, memo: "새 메모", photoCount: 3, contactCount: 2
  }), false);
  assert.equal(sourceConditionChanged(previous, { ...previous, rent: 100 }), true);
  assert.equal(sourceConditionChanged(previous, { ...previous, room: "3층" }), true);
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

test("a full manifest with only provider-hidden addresses completes without repeating the district", () => {
  const result = collectorCompletionAudit({
    source: "당근", scope: "대전 유성구 완전수집", complete: true,
    validationVersion: 2, collectorVersion: "1.4.7",
    expectedCount: 1857, manifestCount: 1857, processedCount: 1857,
    failed: 22, addressMissing: 22, truncated: false, note: "구 완전수집 완료"
  }, 1857);
  assert.equal(result.complete, true);
  assert.deepEqual(result.blockingIssues, []);
  assert.match(result.issues.join(" / "), /주소·층 오류 22건/);
});

test("provider-hidden addresses are persisted as retryable collector errors", async () => {
  const collectorSource = await readFile(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  assert.match(collectorSource, /processing_state <> 'error'/);
  assert.match(collectorSource, /async function saveCollectorError/);
  assert.match(collectorSource, /processing_state='error'/);
  assert.match(collectorSource, /await saveCollectorError\(env, record, sessionId, "지번주소 없음"\)/);
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

test("Daangn detail failures stay queued with bounded retries and recorded causes", async () => {
  const source = await readFile(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  assert.match(source, /DAANGN_DETAIL_MAX_ATTEMPTS = 8/);
  assert.match(source, /pendingDetailIds: job\.pendingDetailIds \|\| \[\]/);
  assert.match(source, /detailAttempts: job\.detailAttempts \|\| \{\}/);
  assert.match(source, /pending\.push\(id\)/);
  assert.match(source, /job\.detailErrors\.push/);
  assert.match(source, /mapWithConcurrency\(ids, retrying \? 1 : 2/);
  assert.match(source, /if \(!pending\.length\)/);
  assert.doesNotMatch(source, /job\.failed \+= ids\.length - records\.length/);
  const listEntry = source.slice(source.indexOf("function daangnListEntry"), source.indexOf("async function loadDaangnJob"));
  assert.match(listEntry, /sourceId: record\.sourceId/);
  assert.match(listEntry, /category: record\.category/);
  assert.doesNotMatch(listEntry, /Object\.keys\(article/);
});

test("manifest comparison includes unchanged listings still waiting in collector review", async () => {
  const source = await readFile(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  const migration = await readFile(new URL(
    "../cloudflare/migrations/0011_collector_raw_source_lookup.sql", import.meta.url
  ), "utf8");
  assert.match(source, /WITH ranked AS \([\s\S]*?FROM collector_raw/);
  assert.match(source, /ROW_NUMBER\(\) OVER \(PARTITION BY source_listing_id ORDER BY created_at DESC\)/);
  assert.match(source, /if \(id && !rows\.has\(id\)\) rows\.set\(id, row\)/);
  assert.match(migration, /collector_raw\(source, source_listing_id, created_at DESC\)/);
});

test("collector review snapshots refresh in place instead of growing every run", async () => {
  const source = await readFile(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  assert.match(source, /ON CONFLICT\(source, source_listing_id\) WHERE processing_state='review' DO UPDATE SET/);
  assert.match(source, /session_id=excluded\.session_id/);
  assert.match(source, /created_at=excluded\.created_at/);
});

test("Naver automatic districts use manifest-first collection instead of page-by-page detail saves", async () => {
  const source = await readFile(new URL("../js/naver-collector.js", import.meta.url), "utf8");
  assert.match(source, /var VERSION = "5\.9\.1"/);
  assert.match(source, /if \(options\.automatic\) \{[\s\S]*?clearAutoDistrictProgress\(district\.cortarNo\);[\s\S]*?\}/);
  assert.doesNotMatch(source, /if \(options\.automatic\) return collectFinAutomaticDistrict\(district\)/);
  assert.match(source, /var classification = await classifyNaverManifest\(allItems, session\)/);
});

test("Gongsilbox collective-building contacts retain the provider role label", async () => {
  const collector = await readFile(new URL("../js/gongsil-collector.js", import.meta.url), "utf8");
  const listingUi = await readFile(new URL("../js/script.js", import.meta.url), "utf8");
  assert.match(collector, /sourceRole:\s*candidateInfo\.buildingLevel && collectiveItem/);
  assert.match(collector, /role:\s*contact\.sourceRole \|\| contactRoleCode\(contact\.label\)/);
  assert.match(listingUi, /\^\(\?:주인\|관리\|사장\)\$/);
  assert.match(listingUi, /contact\.roleLabel \|\| meta\.name/);
});
