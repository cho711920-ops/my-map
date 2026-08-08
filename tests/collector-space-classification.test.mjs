import test from "node:test";
import assert from "node:assert/strict";

import { classifyListingCandidates, compareListingSpace } from "../cloudflare/src/collector-api.js";

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

test("different building dongs are separate even with the same unit", () => {
  assert.equal(classifyListingCandidates(incoming("102동 101호"), [
    existing("M-1", "101동 101호")
  ]).decision, "create");
});

