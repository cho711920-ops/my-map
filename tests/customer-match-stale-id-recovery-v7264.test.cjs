const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");
const duplicateUi = fs.readFileSync("js/listing-duplicate-cleanup-v1.js", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");

assert.match(d1, /function matchId\(customerId, listingId\)/);
assert.match(d1, /async function updateCustomerMatch\(env, body\)/);
assert.match(d1, /SELECT id FROM listings WHERE id=\?1 OR property_id=\?1 LIMIT 1/);
assert.match(d1, /ON CONFLICT\(customer_id, listing_id\) DO UPDATE SET state=excluded\.state/);
assert.match(d1, /matchId:\s*matchId\(customerId, listing\.id\)/);
assert.match(
  operations,
  /var resolvedMatchId = text\(result && result\.matchId\) \|\| previousMatchId;[\s\S]*?context\.matchId = resolvedMatchId/
);
assert.match(
  operations,
  /window\.refreshCustomerMatchesAfterDuplicateMergeV7186 = function\(\)[\s\S]*?apiGet\("customerMatches"/
);
assert.match(duplicateUi, /refreshCustomerMatchesAfterDuplicateMergeV7186/);
assert.match(html, /operations-center-v7\.js\?v=7\.22\.4-overlay-exclusivity/);
assert.doesNotMatch(html, /listing-duplicate-cleanup-v1\.js/);

console.log("customer match stable pair identity tests passed");
