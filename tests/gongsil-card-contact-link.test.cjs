const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ui = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const listing = fs.readFileSync("js/script.js", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");

assert.match(d1, /async function listingContacts\(env, propertyId\)/);
assert.match(d1, /FROM listing_contacts c/);
assert.match(d1, /JOIN listing_sources s ON s\.id = c\.source_id/);
assert.match(d1, /WHERE c\.listing_id = \?1 AND c\.status <> 'deleted'/);
assert.match(d1, /action:\s*"unifiedListingContacts"/);
assert.match(d1, /contactCount:\s*contacts\.length, contacts/);

const window = { innerWidth: 1280, addEventListener() {} };
const context = { window, console, URLSearchParams, fetch() { throw new Error("network must not be used"); } };
vm.createContext(context);
vm.runInContext(ui, context);
const items = [{ propertyId: "M-101" }];
window.JSUnifiedListingsV8.attach(items, { groups: { "M-101": [
  { source: "네이버", sourceId: "N-101", contactCount: 0 },
  { source: "공실박스", sourceId: "G-101", contactCount: 1 }
] } });
assert.equal(items[0].gongsilContactCountV8, 1);

assert.match(listing, /Number\(item && item\.gongsilContactCountV8\) > 0/);
assert.match(listing, /api\.loadContacts\(propertyId\)/);
assert.match(listing, /function prefetchListContactPopupV654\(encodedTarget\)/);
assert.match(ui, /contactPending:\s*\{\}/);
assert.match(ui, /function getCachedContacts\(propertyId\)/);
assert.doesNotMatch(listing, /contactListRaw\s*=\s*JSON\.stringify\(result && result\.contacts\)/);

console.log("Gongsil card contact D1 link tests passed");
