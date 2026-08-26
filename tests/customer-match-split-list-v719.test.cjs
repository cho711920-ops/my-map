const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const css = fs.readFileSync("css/operations-center-v7.css", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");

assert.match(html, /operations-center-v7\.css\?v=7\.22\.6-inline-transactions/);
assert.match(html, /operations-center-v7\.js\?v=7\.22\.6-inline-transactions/);
assert.match(operations, /customerView:\s*"before"/);
assert.match(operations, /syncCustomerMatchMapStatusV722/);
assert.match(operations, /applyCompactCustomerSaveV723/);
assert.match(operations, /restoreCustomerEditorAfterFailureV723/);
assert.match(operations, /compactResponse:\s*true/);
assert.match(operations, /renderCustomerMatchListingCardV719/);
assert.match(operations, /handleOperationsCustomerMatchToggleV719/);
assert.match(operations, /return apiPost\("updateCustomerMatch"/);
assert.match(script, /function addListItem\(item, appendTarget, customerMatchContextV719\)/);
assert.match(script, /window\.renderCustomerMatchListingCardV719/);
assert.match(css, /operations-match-listing-cards-v719/);
assert.match(css, /customer-match-choice-v719\.introduce/);
assert.match(css, /customer-match-choice-v719\.hold/);

assert.match(d1, /async function updateCustomerMatch\(env, body\)/);
assert.match(d1, /ON CONFLICT\(customer_id, listing_id\) DO UPDATE SET state=excluded\.state/);
assert.match(d1, /if \(!body\.compactResponse\) result\.workspace = await customerWorkspace/);
assert.match(d1, /customerRow:\s*customerRow\(updated\)/);
assert.match(d1, /source:\s*"D1"/);

console.log("customer match split-list with D1 tests passed");
