const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const collectorUi = fs.readFileSync(path.join(root, "js", "gongsil-collector.js"), "utf8");
const collectorApi = fs.readFileSync(path.join(root, "cloudflare", "src", "collector-api.js"), "utf8");
const d1 = fs.readFileSync(path.join(root, "cloudflare", "src", "d1-api.js"), "utf8");

const collectPhones = collectorUi.slice(
  collectorUi.indexOf("async function collectPhones("),
  collectorUi.indexOf("function isTenantLabel(")
);
assert.match(collectPhones, /isCollectiveItem\(item,\s*detail\)/);
assert.match(collectPhones, /listingCandidates\.map\([\s\S]*?\.concat\(buildingCandidates\.map\(/);
assert.match(collectPhones, /appendContactFields\(buildingCandidates,\s*detail && detail\.bilinfo/);
assert.match(collectorUi, /record\.contactList = phones\.contacts/);
assert.match(collectorUi, /record\.preserveContacts = true/);

assert.match(collectorApi, /record\?\.contactList/);
assert.match(collectorApi, /async function replaceMediaAndContacts\(/);
assert.match(collectorApi, /if \(!record\.preserveContacts\) \{/);
assert.match(collectorApi, /preserveContacts: Boolean\(record\?\.preserveContacts\) && contacts\.length === 0/);
assert.match(collectorApi, /const key = `\$\{clean\(contact\.role\)\}:\$\{normalizedPhone\}`/);
assert.match(collectorApi, /DELETE FROM listing_contacts WHERE id=\?1/);
assert.match(collectorApi, /UPDATE listing_contacts SET listing_id=\?1/);
assert.match(collectorApi, /INSERT INTO listing_contacts/);
assert.match(collectorApi, /first_seen_at, last_seen_at, created_at, updated_at/);
assert.match(collectorApi, /contactsChanged: assets\.contactsChanged/);

assert.match(d1, /async function listingContacts\(env, propertyId\)/);
assert.match(d1, /FROM listing_contacts c/);
assert.match(d1, /contactCount:\s*contacts\.length, contacts/);

console.log("Gongsil contact reconciliation against D1 tests passed");
