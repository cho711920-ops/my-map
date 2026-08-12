const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("js/listing-duplicate-cleanup-v1.js", "utf8");
const css = fs.readFileSync("css/listing-duplicate-cleanup-v1.css", "utf8");
const collector = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");

assert.doesNotMatch(html, /listing-duplicate-cleanup-v1\.(?:css|js)/);
assert.match(ui, /consolidateExistingMasters/);
assert.match(ui, /manualOverride/);
assert.match(ui, /removeDuplicatesFromCurrentView/);
assert.match(ui, /window\.loadSheet\(true\)/);
assert.match(ui, /refreshCustomerMatchesAfterDuplicateMergeV7186/);
assert.match(css, /duplicate-cleanup-primary/);
assert.match(css, /duplicate-cleanup-target/);

assert.match(collector, /async function consolidateExisting\(env, user, body\)/);
assert.match(collector, /duplicateMasterIds/);
assert.match(collector, /UPDATE listing_sources SET listing_id=\?1/);
assert.match(collector, /UPDATE listing_media SET listing_id=\?1/);
assert.match(collector, /UPDATE listing_contacts SET listing_id=\?1/);
assert.match(collector, /UPDATE listings SET status='deleted'/);
assert.match(collector, /INSERT INTO listing_history/);
assert.match(collector, /action:\s*"consolidateExistingMasters"/);
assert.match(collector, /customerMatches, source:\s*"D1"/);

console.log("listing duplicate cleanup in D1 tests passed");
