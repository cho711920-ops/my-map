const assert = require("node:assert/strict");
const fs = require("node:fs");

const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const collector = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");

assert.match(d1, /FROM listing_contacts c/);
assert.match(d1, /JOIN listing_sources s ON s\.id = c\.source_id/);
assert.match(d1, /c\.role, c\.name, c\.phone, c\.normalized_phone/);
assert.match(d1, /contacts_json/);
assert.match(d1, /main_source/);
assert.match(collector, /INSERT INTO listing_contacts/);
assert.match(collector, /source_id, role, name, phone, normalized_phone/);
assert.match(collector, /UPDATE listing_contacts SET listing_id=\?1/);
assert.match(collector, /const key = `\$\{clean\(contact\.role\)\}:\$\{normalizedPhone\}`/);

console.log("operations contact schema separation tests passed");
