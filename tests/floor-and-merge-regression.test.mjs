import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  canonicalListingRoom,
  floorMatchesBounds,
  listingFloor,
  normalizedRoomKey,
  parseListingFloor
} from "../cloudflare/src/floor.js";

test("basement notations use one canonical floor", () => {
  for (const value of ["B1호", "b01", "B101호", "B층호", "지1", "지하1층", "-1층"]) {
    assert.equal(canonicalListingRoom(value), "지하1층", value);
    assert.equal(parseListingFloor(value), -1, value);
  }
  assert.equal(canonicalListingRoom("B201호"), "지하2층");
  assert.equal(canonicalListingRoom("B14호"), "지하1층");
  assert.equal(normalizedRoomKey("B01"), normalizedRoomKey("지하1층"));
});

test("room numbers infer floors for strict customer matching", () => {
  assert.equal(listingFloor({ floor: "", room: "101호" }), 1);
  assert.equal(listingFloor({ floor: "", room: "153호" }), 1);
  assert.equal(listingFloor({ floor: "", room: "235호" }), 2);
  assert.equal(listingFloor({ floor: "", room: "301호" }), 3);
  assert.equal(listingFloor({ floor: "", room: "49,50호" }), null);
});

test("strict first-floor bounds reject basements, upper floors and unknown rooms", () => {
  assert.equal(floorMatchesBounds(1, 1, 1), true);
  assert.equal(floorMatchesBounds(-1, 1, 1), false);
  assert.equal(floorMatchesBounds(2, 1, 1), false);
  assert.equal(floorMatchesBounds(null, 1, 1), false);
  assert.equal(floorMatchesBounds(null, null, null), true);
});

test("moving the last source removes the empty master and invalidates both listing caches", () => {
  const d1 = fs.readFileSync(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
  assert.match(d1, /NOT EXISTS \(SELECT 1 FROM listing_sources WHERE listing_id=\?2\)/);
  assert.match(d1, /emptyMasterRemovedAfterMove/);
  assert.match(worker, /SHEET_CACHE_ACTIONS[\s\S]*"moveOriginalListing"/);
  assert.match(worker, /UNIFIED_CACHE_ACTIONS = new Set\(\["moveOriginalListing"\]\)/);
});
