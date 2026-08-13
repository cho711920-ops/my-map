const assert = require("node:assert/strict");
const fs = require("node:fs");

const script = fs.readFileSync("js/script.js", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const helperStart = script.indexOf("function parseOriginalListingNumberKeyword");
const helperEnd = script.indexOf("function parseExactJibunKeyword", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "source listing search helpers must exist");
const helpers = new Function(
  script.slice(helperStart, helperEnd) + "\n" +
  "return {parseOriginalListingNumberKeyword, matchesOriginalListingNumber};"
)();

const item = {
  sourceListingSearchV6579: ["n:2643232701", "d:3768587"],
  unifiedOriginalsV8: []
};

assert.deepEqual(helpers.parseOriginalListingNumberKeyword("2643232701"), {
  provider: "",
  number: "2643232701"
});
assert.deepEqual(helpers.parseOriginalListingNumberKeyword("네이버 2643232701"), {
  provider: "naver",
  number: "2643232701"
});
assert.deepEqual(helpers.parseOriginalListingNumberKeyword("당근3768587"), {
  provider: "daangn",
  number: "3768587"
});
assert.equal(helpers.matchesOriginalListingNumber(item, helpers.parseOriginalListingNumberKeyword("2643232701")), true);
assert.equal(helpers.matchesOriginalListingNumber(item, helpers.parseOriginalListingNumberKeyword("당근 3768587")), true);
assert.equal(helpers.matchesOriginalListingNumber(item, helpers.parseOriginalListingNumberKeyword("네이버 3768587")), false);
assert.equal(helpers.matchesOriginalListingNumber(item, helpers.parseOriginalListingNumberKeyword("376858")), false);
assert.equal(helpers.parseOriginalListingNumberKeyword("보증금 3000"), null);

assert.match(d1, /sourceSearchIds/);
assert.match(d1, /s\.source IN \('네이버','당근'\)/);
assert.match(d1, /l\.status<>'deleted'/);
assert.match(unified, /item\.sourceListingSearchV6579 =/);
assert.match(fs.readFileSync("cloudflare/src/worker.js", "utf8"),
  /api-cache\/unified-listings-v4-actual-gongsil-photos\.json/);
assert.match(html, /script\.js\?v=6\.5\.79-source-listing-search/);
assert.match(html, /unified-listings-v8\.js\?v=8\.1\.23-overlay-exclusivity/);

console.log("source listing number search v6.5.79 tests passed");
