import test from "node:test";
import assert from "node:assert/strict";

import {
  choosePendingReviewMatch,
  classifyListingCandidates,
  compareListingSpace,
  existingSourceNeedsAddressReclassification,
  hasExactLotAddress,
  normalizeReviewRecord,
  relevantReviewCandidates
} from "../cloudflare/src/collector-api.js";

function incoming(room, deposit = 1000, rent = 50, area = 10) {
  return { room, deposit, rent, area };
}

function existing(id, room, deposit = 1000, rent = 50, area = 10) {
  return { id, property_id: id, room, deposit, monthly_rent: rent, area_m2: area };
}

test("dong-only addresses never cross the exact-lot assignment boundary", () => {
  assert.equal(hasExactLotAddress("중구 용두동"), false);
  assert.equal(hasExactLotAddress("중구 용두동 1층"), false);
  assert.equal(hasExactLotAddress("대전광역시 중구 용두동 33-9"), true);
  assert.equal(hasExactLotAddress("유성구 계산동 산 12-3"), true);

  assert.equal(existingSourceNeedsAddressReclassification(
    { address: "중구 용두동 113-10" },
    { id: "O-1", listing_id: "M-old", listing_address: "중구 용두동 33-9" }
  ), true);
  assert.equal(existingSourceNeedsAddressReclassification(
    { address: "중구 용두동 33-9" },
    { id: "O-1", listing_id: "M-old", listing_address: "중구 용두동 33-9" }
  ), false);
  assert.equal(existingSourceNeedsAddressReclassification(
    { address: "중구 용두동" },
    { id: "O-1", listing_id: "M-old", listing_address: "중구 용두동 33-9" }
  ), false);
});

test("different floors and explicit units are automatically separated", () => {
  assert.equal(compareListingSpace(incoming("2층"), existing("M-1", "1층")).decision, "different");
  assert.equal(compareListingSpace(incoming("102호"), existing("M-1", "101호")).decision, "different");
  assert.equal(compareListingSpace(incoming("B02호"), existing("M-1", "B01호")).decision, "different");
  assert.equal(classifyListingCandidates(incoming("102호"), [existing("M-1", "101호")]).decision, "create");
});

test("active source terms recover an exact match hidden by stale representative terms", () => {
  const staleRepresentative = {
    ...existing("M-stale", "5층", 1000, 45, 20.1),
    active_source_snapshots: [existing("O-current", "5/6", 1000, 40, 20.1)]
  };
  const result = classifyListingCandidates(incoming("5/6", 1000, 40, 20.1), [staleRepresentative]);
  assert.equal(result.decision, "merge");
  assert.equal(result.candidate.id, "M-stale");
  assert.match(result.reason, /연결 원본/);
});

test("a direct representative match wins over another master's stale source match", () => {
  const staleRepresentative = {
    ...existing("M-stale", "1층", 2000, 110, 27.1),
    active_source_snapshots: [existing("O-stale", "1층", 2000, 100, 27.1)]
  };
  const directRepresentative = existing("M-direct", "1층", 2000, 100, 27.1);
  const result = classifyListingCandidates(incoming("1층", 2000, 100, 27.1), [
    staleRepresentative, directRepresentative
  ]);
  assert.equal(result.decision, "merge");
  assert.equal(result.candidate.id, "M-direct");
  assert.doesNotMatch(result.reason, /연결 원본/);
});

test("an explicit incoming unit stays separate from different units hidden under a generic master", () => {
  const genericMaster = {
    ...existing("M-501", "5층", 1000, 40, 20.1),
    active_source_snapshots: [existing("O-501", "501호", 1000, 40, 20.1)]
  };
  const result = classifyListingCandidates(incoming("502호", 1000, 40, 20.1), [genericMaster]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /호실이 다름/);
});

test("the same explicit room is one physical listing even when rental terms changed", () => {
  const result = classifyListingCandidates(incoming("101호", 3000, 180, 23.8), [
    existing("M-1", "101호", 1000, 50, 9)
  ]);
  assert.equal(result.decision, "merge");
  assert.equal(result.candidate.id, "M-1");
});

test("a generic floor and a unit on that floor merge only with matching terms and area", () => {
  assert.equal(classifyListingCandidates(incoming("1층", 1000, 50, 10.8), [
    existing("M-1", "101호", 1000, 50, 10)
  ]).decision, "merge");
  assert.equal(classifyListingCandidates(incoming("1층", 1000, 50, 11), [
    existing("M-1", "101호", 1000, 50, 10)
  ]).decision, "review");
  assert.equal(classifyListingCandidates(incoming("1층", 2000, 50, 10.5), [
    existing("M-1", "101호", 1000, 50, 10)
  ]).decision, "review");
  assert.equal(classifyListingCandidates(incoming("114호", 300, 60, 6), [
    existing("M-1", "1층", 3000, 130, 13.1)
  ]).decision, "create");
  assert.equal(classifyListingCandidates(incoming("1층", 3000, 130, 13.1), [
    existing("M-1", "114호", 300, 60, 6)
  ]).decision, "create");
});

test("materially different deposit and rent create separate listings on an otherwise ambiguous floor", () => {
  const explicitRoom = classifyListingCandidates(incoming("102호", 500, 60, 12), [
    existing("M-1", "1층", 300, 50, 11.8)
  ]);
  assert.equal(explicitRoom.decision, "create");
  assert.match(explicitRoom.reason, /임대조건이 모두 크게 다름/);

  const genericFloor = classifyListingCandidates(incoming("1층", 1500, 100, 12), [
    existing("M-1", "1층", 300, 50, 11.8)
  ]);
  assert.equal(genericFloor.decision, "create");
  assert.match(genericFloor.reason, /보증금·월세가 모두 크게 다름/);
});

test("thirty-percent-scale rental term gaps are separate on a generic floor", () => {
  const result = classifyListingCandidates(incoming("1층", 3000, 100, 14.8), [
    existing("M-other-offer", "1층", 1000, 80, 14.8)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /보증금·월세가 모두 크게 다름/);
});

test("same-floor offers with completely different terms and area are separate listings", () => {
  const result = classifyListingCandidates(incoming("8층", 1000, 65, 18.2), [
    existing("M-dunsan-1072", "8층", 3000, 160, 49.9)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /보증금·월세가 모두 크게 다름/);
});

test("Jijok 1023-3 larger floor offer is separate despite sharing the first floor", () => {
  const result = classifyListingCandidates(incoming("1층", 5000, 170, 45.8), [
    existing("M-seoul-vision", "1층", 2000, 140, 31.9)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /임대조건과 평수가 모두 크게 다름/);
});

test("a large same-floor area gap is separate even when the rent gap is modest", () => {
  const result = classifyListingCandidates(incoming("1층", 3000, 200, 46), [
    existing("M-smaller", "1층", 3000, 170, 28.3)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /평수가 명확히 다름/);
});

test("same-floor exact area with a small single-term price change is one listing", () => {
  const rentChange = classifyListingCandidates(incoming("1층", 5000, 160, 45.8), [
    existing("M-before-rent", "1층", 5000, 170, 45.8)
  ]);
  assert.equal(rentChange.decision, "merge");
  assert.match(rentChange.reason, /소폭 임대조건 변경/);

  const depositChange = classifyListingCandidates(incoming("1층", 2200, 100, 27.1), [
    existing("M-before-deposit", "1층", 2000, 100, 27.1)
  ]);
  assert.equal(depositChange.decision, "merge");
  assert.match(depositChange.reason, /소폭 임대조건 변경/);

  assert.equal(classifyListingCandidates(incoming("1층", 300, 20, 4.8), [
    existing("M-low-rent", "1층", 300, 15, 4.8)
  ]).decision, "review");
});

test("matching terms with both areas missing still merge safely", () => {
  const result = classifyListingCandidates(incoming("2층", 1500, 60, null), [
    existing("M-no-area", "2층", 1500, 60, null)
  ]);
  assert.equal(result.decision, "merge");
});

test("matching terms on the same floor merge when one area is missing", () => {
  const result = classifyListingCandidates(incoming("2층", 1500, 60, 27.1), [
    existing("M-one-area", "2층", 1500, 60, null)
  ]);
  assert.equal(result.decision, "merge");
  assert.match(result.reason, /면적 표기 호환/);
});

test("matching terms tolerate a small supply-exclusive area notation gap", () => {
  const result = classifyListingCandidates(incoming("2층", 3000, 150, 41.1), [
    existing("M-area-notation", "2층", 3000, 150, 38.9)
  ]);
  assert.equal(result.decision, "merge");
  assert.match(result.reason, /면적 표기 호환/);
});

test("an exact lot, floor, and offer tolerate a twenty-percent area notation gap", () => {
  const result = classifyListingCandidates({
    ...incoming("11층", 3000, 200, 18.2), address: "서구 둔산동 1249"
  }, [{
    ...existing("M-exact-lot-area-notation", "11층", 3000, 200, 15.4), address: "서구 둔산동 1249"
  }]);
  assert.equal(result.decision, "merge");
  assert.match(result.reason, /면적 표기 호환/);
});

test("a dong-only address never uses the wider area-notation tolerance", () => {
  const result = classifyListingCandidates({
    ...incoming("1층", 2000, 70, 17.2), address: "유성구 죽동"
  }, [{
    ...existing("M-dong-only-area-notation", "1층", 2000, 70, 20), address: "유성구 죽동"
  }]);
  assert.equal(result.decision, "review");
});

test("matching terms do not merge materially different same-floor areas", () => {
  const result = classifyListingCandidates(incoming("2층", 8000, 380, 59), [
    existing("M-larger-space", "2층", 8000, 380, 107)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /평수가 명확히 다름/);
});

test("a five-pyeong and thirty-percent same-floor area gap is a separate space", () => {
  const result = classifyListingCandidates(incoming("1층", 2000, 100, 14.8), [
    existing("M-other-size", "1층", 2000, 100, 20)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /평수가 명확히 다름/);
});

test("review workspace hides clearly different masters and keeps only plausible candidates", () => {
  const group = { items: [incoming("1층", 5000, 160, 45.8)] };
  const clearlyDifferent = {
    propertyId: "M-old", room: "1층", deposit: 2000, rent: 140, area: 31.9, tradeType: "lease"
  };
  const plausible = {
    propertyId: "M-new", room: "1층", deposit: 5000, rent: 170, area: 45.8, tradeType: "lease"
  };
  const otherFloor = {
    propertyId: "M-fourth", room: "4층", deposit: 5000, rent: 300, area: 103, tradeType: "lease"
  };
  assert.deepEqual(relevantReviewCandidates(group, [clearlyDifferent, plausible, otherFloor])
    .map((candidate) => candidate.propertyId), ["M-new"]);
});

test("same-floor offers with the same deposit stay separate when rent and area are clearly different", () => {
  const result = classifyListingCandidates(incoming("2층", 3000, 300, 100), [
    existing("M-existing", "2층", 3000, 150, 38.9),
    existing("M-third-floor", "3층", 3000, 250, 100),
    existing("M-fourth-floor", "4층", 3000, 200, 55.9)
  ]);
  assert.equal(result.decision, "create");
  assert.match(result.reason, /임대조건과 평수가 모두 크게 다름/);
});

test("same-floor offers with only a modest area or rent change still require review", () => {
  assert.equal(classifyListingCandidates(incoming("2층", 3000, 170, 42), [
    existing("M-existing", "2층", 3000, 150, 38.9)
  ]).decision, "review");
  assert.equal(classifyListingCandidates(incoming("2층", 3000, 300, 42), [
    existing("M-existing", "2층", 3000, 150, 38.9)
  ]).decision, "review");
});

test("small rental adjustments on an ambiguous floor still require review", () => {
  assert.equal(classifyListingCandidates(incoming("102호", 500, 55, 12), [
    existing("M-1", "1층", 300, 50, 11.8)
  ]).decision, "review");
  assert.equal(classifyListingCandidates(incoming("1층", 1000, 60, 12), [
    existing("M-1", "1층", 800, 50, 11.8)
  ]).decision, "review");
});

test("basement aliases share one floor while above-ground rooms remain separate", () => {
  assert.equal(classifyListingCandidates(incoming("B01", 1000, 50, 10.2), [
    existing("M-1", "지하1층", 1000, 50, 10)
  ]).decision, "merge");
  assert.equal(classifyListingCandidates(incoming("B01"), [existing("M-1", "101호")]).decision, "create");
});

test("multiple equally strong candidates remain for manual verification", () => {
  const result = classifyListingCandidates(incoming("1층", 1000, 50, 10.2), [
    existing("M-1", "101호", 1000, 50, 10),
    existing("M-2", "102호", 1000, 50, 10.1)
  ]);
  assert.equal(result.decision, "review");
});

test("an explicit room wins over an otherwise matching generic-floor candidate", () => {
  const result = classifyListingCandidates(incoming("112호", 5000, 100, 10.5), [
    existing("M-generic", "1층", 5000, 100, 10.4),
    existing("M-room", "112호", 5000, 100, 10.5)
  ]);
  assert.equal(result.decision, "merge");
  assert.equal(result.candidate.id, "M-room");
  assert.match(result.reason, /층호실 표기 우선/);
});

test("a generic floor wins over an otherwise matching explicit-room candidate", () => {
  const result = classifyListingCandidates(incoming("1층", 1000, 80, 25), [
    existing("M-room", "101호", 1000, 80, 25),
    existing("M-generic", "1층", 1000, 80, 25)
  ]);
  assert.equal(result.decision, "merge");
  assert.equal(result.candidate.id, "M-generic");
  assert.match(result.reason, /층호실 표기 우선/);
});

test("two equally aligned generic-floor candidates still require verification", () => {
  const result = classifyListingCandidates(incoming("1층", 1000, 80, 25), [
    existing("M-generic-a", "1층", 1000, 80, 25),
    existing("M-generic-b", "1층", 1000, 80, 25.1)
  ]);
  assert.equal(result.decision, "review");
});

test("a roomless offer is separate when both terms and area clearly differ", () => {
  assert.equal(classifyListingCandidates(incoming("", 1000, 70, 32.3), [
    existing("M-1", "1층", 1500, 150, 10.8)
  ]).decision, "create");
  assert.equal(classifyListingCandidates(incoming("", 1000, 70, 10.8), [
    existing("M-1", "1층", 1500, 150, 10.8)
  ]).decision, "review");
});

test("a provider re-post with a new source id reuses the oldest identical pending review", () => {
  const match = choosePendingReviewMatch({
    source: "당근", sourceId: "new-2", room: "1층", deposit: 1000, rent: 50, area: 10.5
  }, [{
    reviewId: "R-old", source: "당근", sourceId: "old-1", createdAt: "2026-08-01T00:00:00Z",
    room: "101호", deposit: 1000, monthly_rent: 50, area_m2: 10
  }]);
  assert.equal(match.reviewId, "R-old");
});

test("the same provider source id updates its pending review instead of becoming an alias", () => {
  const match = choosePendingReviewMatch({
    source: "당근", sourceId: "same-1", room: "1층", deposit: 1000, rent: 50, area: 10
  }, [{
    reviewId: "R-existing", source: "당근", sourceId: "same-1", createdAt: "2026-08-01T00:00:00Z",
    room: "1층", deposit: 1000, monthly_rent: 50, area_m2: 10
  }]);
  assert.equal(match, null);
});

test("different building dongs are separate even with the same unit", () => {
  assert.equal(classifyListingCandidates(incoming("102동 101호"), [
    existing("M-1", "101동 101호")
  ]).decision, "create");
});

test("legacy review rows never bind undefined optional values to D1", () => {
  const record = normalizeReviewRecord({
    originalId: "O-legacy", source: "네이버", sourceId: "네이버-1",
    buildingName: "일반상가", address: "중구 오류동 187-8", room: "1층",
    category: "상가점포", deposit: 5000, rent: 500, area: 75.7,
    memo: "(임장가자)", link: "https://fin.land.naver.com/articles/1"
  });
  assert.equal(record.latitude, null);
  assert.equal(record.longitude, null);
  assert.equal(record.fee, null);
  assert.equal(record.premium, null);
  assert.equal(record.tradeType, "lease");
  assert.equal(record.saleCategory, "");
  assert.equal(record.salePrice, null);
  assert.deepEqual(record.images, []);
  assert.deepEqual(record.contacts, []);
  assert.ok(Object.values(record).every((value) => value !== undefined));
});
