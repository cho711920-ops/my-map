import test from "node:test";
import assert from "node:assert/strict";

import { choosePendingReviewMatch, classifyListingCandidates, compareListingSpace, normalizeReviewRecord } from "../cloudflare/src/collector-api.js";

function incoming(room, deposit = 1000, rent = 50, area = 10) {
  return { room, deposit, rent, area };
}

function existing(id, room, deposit = 1000, rent = 50, area = 10) {
  return { id, property_id: id, room, deposit, monthly_rent: rent, area_m2: area };
}

test("different floors and explicit units are automatically separated", () => {
  assert.equal(compareListingSpace(incoming("2층"), existing("M-1", "1층")).decision, "different");
  assert.equal(compareListingSpace(incoming("102호"), existing("M-1", "101호")).decision, "different");
  assert.equal(classifyListingCandidates(incoming("102호"), [existing("M-1", "101호")]).decision, "create");
});

test("the same explicit room is one physical listing even when rental terms changed", () => {
  const result = classifyListingCandidates(incoming("101호", 3000, 180, 23.8), [
    existing("M-1", "101호", 1000, 50, 9)
  ]);
  assert.equal(result.decision, "merge");
  assert.equal(result.candidate.id, "M-1");
});

test("a generic floor and a unit on that floor merge only with exact terms and under one pyeong difference", () => {
  assert.equal(classifyListingCandidates(incoming("1층", 1000, 50, 10.8), [
    existing("M-1", "101호", 1000, 50, 10)
  ]).decision, "merge");
  assert.equal(classifyListingCandidates(incoming("1층", 1000, 50, 11), [
    existing("M-1", "101호", 1000, 50, 10)
  ]).decision, "review");
  assert.equal(classifyListingCandidates(incoming("1층", 2000, 50, 10.5), [
    existing("M-1", "101호", 1000, 50, 10)
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
    existing("M-2", "1층", 1000, 50, 10.1)
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
  assert.deepEqual(record.images, []);
  assert.deepEqual(record.contacts, []);
  assert.ok(Object.values(record).every((value) => value !== undefined));
});
