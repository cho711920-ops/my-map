import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalListingRoom, parseListingFloor } from "../cloudflare/src/floor.js";

test("current/total provider floors normalize to the listing floor", () => {
  assert.equal(parseListingFloor("1/1"), 1);
  assert.equal(parseListingFloor("6/7"), 6);
  assert.equal(parseListingFloor("-1/4"), -1);
  assert.equal(canonicalListingRoom("1/1"), "1층");
  assert.equal(canonicalListingRoom("6/7"), "6층");
  assert.equal(canonicalListingRoom("-1/4"), "지하1층");
  assert.equal(canonicalListingRoom("2.0층"), "2층");
  assert.equal(canonicalListingRoom("201/202호"), "201/202호");
});

test("listing cards format legacy current/total values before rendering", async () => {
  const script = await readFile(new URL("../js/script.js", import.meta.url), "utf8");
  assert.match(script, /function formatListingRoomForCardV653/);
  assert.match(script, /escapeHtml\(formatListingRoomForCardV653\(item\.room\)\)/);
  assert.match(script, /currentAndTotal = compact\.match/);
});
