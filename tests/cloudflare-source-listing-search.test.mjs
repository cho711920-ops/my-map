import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceListingSearchIndex } from "../cloudflare/src/d1-api.js";

test("Naver and Daangn source numbers build a hidden master search index", () => {
  assert.deepEqual(sourceListingSearchIndex([
    { listing_id: "M-1", source: "네이버", source_listing_id: "네이버-2643232701" },
    { listing_id: "M-1", source: "당근", source_listing_id: "3768587" },
    { listing_id: "M-1", source: "당근", source_listing_id: "3768587" },
    { listing_id: "M-2", source: "공실박스", source_listing_id: "12345" },
    { listing_id: "M-2", source: "네이버", source_listing_id: "invalid" }
  ]), {
    "M-1": ["n:2643232701", "d:3768587"]
  });
});

test("the source number index includes inactive originals without changing visible original groups", () => {
  const d1 = readFileSync(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
  assert.match(d1, /FROM listing_sources s JOIN listings l ON l\.id=s\.listing_id/);
  assert.match(d1, /WHERE l\.status<>'deleted' AND s\.source IN \('네이버','당근'\)/);
  assert.doesNotMatch(d1, /WHERE l\.status<>'deleted' AND s\.active=1/);
  assert.match(d1, /groups,\s*sourceSearchIds,/);
});
