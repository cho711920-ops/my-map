import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { masterFallbackOriginal } from "../cloudflare/src/d1-api.js";

test("an active master without linked sources still has a usable detail record", () => {
  const original = masterFallbackOriginal({
    id: "M-orphan-1",
    main_source: "당근",
    building_name: "일반상가",
    address: "서구 괴정동 427-28",
    room: "1층",
    deposit: 5000,
    monthly_rent: 300,
    area_m2: 44.6,
    source_url: "https://realty.daangn.com/?article_id=3787382",
    contacts_json: "[]",
    version: 3
  }, ["https://example.com/one.jpg"]);

  assert.equal(original.originalId, "master:M-orphan-1");
  assert.equal(original.masterFallback, true);
  assert.equal(original.address, "서구 괴정동 427-28");
  assert.equal(original.room, "1층");
  assert.equal(original.rent, 300);
  assert.equal(original.thumbnail, "https://example.com/one.jpg");
  assert.equal(original.sourceUnavailable, false);
});

test("a master whose collected sources are all hidden keeps its last photo with an unavailable marker", () => {
  const original = masterFallbackOriginal({
    id: "M-hidden-1",
    main_source: "네이버",
    address: "서구 탄방동 616",
    room: "4층",
    source_count: 2,
    active_source_count: 0,
    missing_count: 3
  }, ["https://example.com/last-normal.jpg"]);

  assert.equal(original.thumbnail, "https://example.com/last-normal.jpg");
  assert.equal(original.sourceUnavailable, true);
  assert.equal(original.missingCount, 3);
});

test("fallback detail cards do not expose source move controls", async () => {
  const script = await readFile(new URL("../js/unified-listings-v8.js", import.meta.url), "utf8");
  assert.match(script, /!selected\.masterFallback && originals\.length > 1/);
  assert.match(script, /!selected\.masterFallback \? '<button type="button" class="move"/);
});
