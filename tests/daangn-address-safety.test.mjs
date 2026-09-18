import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { hasExactLotAddress, isMonthlyCollectorRecord, mergeDaangnDetailWithList, normalizedRecord } from "../cloudflare/src/collector-api.js";

const samples = [
  {
    originalId: "4518229", publicJibunAddress: "대전광역시 유성구 문지동", address: "대전광역시 유성구 문지동",
    addressInfo: "문지동상가 카페 공방 꽃집 무권리 문지동 소형상가 12평",
    complex: null, isHideAddress: true, previousAddress: "소형상가 12"
  },
  {
    originalId: "4521089", publicJibunAddress: "대전광역시 중구 문창동",
    addressInfo: "문창동 1층 도로변 상가 22평 횡단보도앞 전면통유리",
    complex: null, isHideAddress: true, previousAddress: "문창동 1"
  }
];

function article(overrides = {}) {
  return {
    originalId: "address-test", floor: "1", salesTypeV3: { type: "STORE" },
    trades: [{ type: "MONTH", deposit: 1000, monthlyPay: 50 }],
    publicCoordinate: { lat: 36.3, lon: 127.4 }, ...overrides
  };
}

for (const sample of samples) {
  test(`${sample.originalId}: advertising floor/area is never an exact parcel`, () => {
    const record = normalizedRecord("당근", article(sample));
    assert.equal(record.address, "");
    assert.equal(hasExactLotAddress(record.address), false);
    assert.equal(record.latitude, null);
    assert.equal(record.longitude, null);
    assert.ok(record.memo.includes(sample.addressInfo));
  });

  test(`${sample.originalId}: re-normalization cannot restore the old guessed address or masked coordinates`, () => {
    const record = normalizedRecord("당근", {
      source: "당근", sourceId: sample.originalId, tradeType: "lease",
      address: sample.previousAddress, latitude: 36.3, longitude: 127.4,
      raw: article(sample)
    });
    assert.equal(record.address, "");
    assert.equal(record.latitude, null);
    assert.equal(record.longitude, null);
  });

  test(`${sample.originalId}: an old list checkpoint cannot restore the guessed address`, () => {
    const record = mergeDaangnDetailWithList(article(sample), {
      sourceId: sample.originalId, address: sample.previousAddress,
      listSnapshot: JSON.stringify({ address: sample.previousAddress })
    });
    assert.equal(record.address, "");
    assert.equal(normalizedRecord("당근", record).address, "");
  });
}

for (const text of [
  "문창동 1층", "문창동 1 층", "문창동 12평", "문창동 12 평", "문창동 12㎡", "문창동 12 m2",
  "문창동 12제곱미터", "문창동 12호", "문창동 12만원", "문창동 12-3평",
  "문창동 1(층)", "문창동 12(평)", "문창동 12 (㎡)", "문창동 12-3 (평)",
  "문창동 12,000원", "문창동 12,000 원",
  "소형상가 12", "소형상가 12평", "문창동 12번길", "문창동 상가 12평"
]) {
  test(`descriptive address candidate is rejected: ${text}`, () => {
    for (const field of ["publicJibunAddress", "addressInfo"]) {
      assert.equal(normalizedRecord("당근", article({ [field]: text })).address, "");
    }
  });
}

test("addressInfo must be entirely a parcel address, not a sentence containing an apparent parcel", () => {
  assert.equal(normalizedRecord("당근", article({ addressInfo: "대전광역시 유성구 봉명동 100-2" })).address,
    "유성구 봉명동 100-2");
  assert.equal(normalizedRecord("당근", article({ addressInfo: "봉명동 100-2번지" })).address, "봉명동 100-2");
  assert.equal(normalizedRecord("당근", article({ addressInfo: "봉명동 100-2 근처 상가" })).address, "");
  assert.equal(normalizedRecord("당근", article({ addressInfo: "서울특별시 종로구 종로1가 24" })).address,
    "종로구 종로1가 24");
});

test("parenthetical building names preserve an otherwise exact parcel in both address fields", () => {
  for (const field of ["publicJibunAddress", "addressInfo"]) {
    for (const text of ["중구 문창동 123-4(문창빌딩)", "중구 문창동 123-4 (문창빌딩)"]) {
      assert.equal(normalizedRecord("당근", article({ [field]: text })).address, "중구 문창동 123-4");
    }
  }
});

for (const [text, expected] of [
  ["대전광역시 유성구 문지동 500-1", "유성구 문지동 500-1"],
  ["중구 문창동 1", "중구 문창동 1"],
  ["봉명동 산 12-3", "봉명동 산 12-3"],
  ["중구 문창동 123-4 원창빌딩", "중구 문창동 123-4"],
  ["서울특별시 종로구 종로1가 24", "종로구 종로1가 24"]
]) {
  test(`structured exact parcel is preserved: ${text}`, () => {
    const record = normalizedRecord("당근", article({ publicJibunAddress: text, addressInfo: "소형상가 12평" }));
    assert.equal(record.address, expected);
    assert.equal(hasExactLotAddress(record.address), true);
  });
}

test("structured building parcel still wins over descriptive copy and hidden public coordinates", () => {
  const record = normalizedRecord("당근", article({
    ...samples[1], complex: { buildingsForAddress: { edges: [{ node: {
      jibunAddress: "대전광역시 중구 문창동 123-4", roadAddress: "대전광역시 중구 문창로 20"
    } }] } }
  }));
  assert.equal(record.address, "중구 문창동 123-4");
  assert.equal(record.roadAddress, "대전광역시 중구 문창로 20");
  assert.equal(record.latitude, null);
  assert.equal(record.longitude, null);
});

for (const raw of [
  { publicJibunAddress: "대전광역시 유성구 문지동" },
  { roadAddress: "대전광역시 유성구 문지로 20" },
  { isHideAddress: true }
]) {
  test(`region/road/hidden-only raw evidence blocks an unproven old parcel: ${JSON.stringify(raw)}`, () => {
    const detail = article(raw);
    assert.equal(normalizedRecord("당근", detail).address, "");
    assert.equal(mergeDaangnDetailWithList(detail, { address: "문지동 123-4" }).address, "");
    assert.equal(normalizedRecord("당근", {
      source: "당근", address: "문지동 123-4", raw: detail
    }).address, "");
  });
}

test("legacy list/saved parcels survive when raw details contain no address evidence", () => {
  const raw = article({ content: "detail without address fields" });
  const address = "대전광역시 서구 괴정동 100-1";
  assert.equal(mergeDaangnDetailWithList(raw, { address }).address, address);
  assert.equal(normalizedRecord("당근", { source: "당근", address, raw }).address, address);
  assert.equal(mergeDaangnDetailWithList(raw, { address: "소형상가 12" }).address, "");
  assert.equal(mergeDaangnDetailWithList(raw, { address: "문창동 1층" }).address, "");
});

test("explicit provider coordinates remain available even when the public coordinate is hidden", () => {
  const record = normalizedRecord("당근", article({
    isHideAddress: true, publicJibunAddress: "문창동 123-4", latitude: 36.31, longitude: 127.41
  }));
  assert.equal(record.latitude, 36.31);
  assert.equal(record.longitude, 127.41);
});

test("ingestion does not resurrect a rejected parcel from an existing source snapshot", async () => {
  const source = readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
  const errors = [];
  const rows = new Map(samples.map(sample => [sample.originalId, {
    listing_id: "existing-" + sample.originalId, listing_address: sample.previousAddress,
    list_snapshot_json: JSON.stringify({ address: sample.previousAddress })
  }]));
  const context = vm.createContext({
    normalizedRecord, isMonthlyCollectorRecord, hasExactLotAddress,
    ensureSession: async () => "test-session", loadExistingSources: async () => rows,
    loadSourceAssets: async () => new Map(), loadPendingReviewsByAddress: async () => new Map(),
    loadCandidateListings: async (_env, records) => { assert.equal(records.length, 0); return new Map(); },
    saveCollectorError: async (_env, record, _session, message) => errors.push({ record, message }),
    refreshCustomerMatchesForListings: async () => ({}), canonicalListingRoom: value => value
  });
  for (const name of ["clean", "normalizedAddress", "parseJson", "nowIso", "daangnAddressCandidates",
    "daangnLotAddress", "daangnHasAddressEvidence", "daangnFallbackAddress", "ingestRecords"]) {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, "m"));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  const statement = { bind() { return this; }, async first() { return { totals_json: "{}" }; }, async run() {} };
  const result = await context.ingestRecords({ DB: { prepare: () => statement } }, "당근", samples.map(sample => article(sample)));
  assert.equal(result.addressMissing, 2);
  assert.equal(result.created, 0);
  assert.equal(result.merged, 0);
  assert.equal(errors.length, 2);
  assert.ok(errors.every(({ record, message }) => record.address === "" && message === "정확한 지번주소 없음"));
});
