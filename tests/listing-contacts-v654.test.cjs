const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const d1 = fs.readFileSync(path.join(root, "cloudflare", "src", "d1-api.js"), "utf8");
const collector = fs.readFileSync(path.join(root, "cloudflare", "src", "collector-api.js"), "utf8");

const csvStart = script.indexOf("function parseCSVLine");
const csvEnd = script.indexOf("function itemKey");
assert.ok(csvStart >= 0 && csvEnd > csvStart, "CSV parser block must exist");
const csvContext = {};
vm.createContext(csvContext);
vm.runInContext(script.slice(csvStart, csvEnd), csvContext);
const contacts = JSON.stringify([
  { role: "임대인", phone: "010-2446-8276" },
  { role: "임차인", phone: "010-4951-8276" }
]);
const csvCell = `"${contacts.replace(/"/g, '""')}"`;
const parsed = csvContext.parseCSVLine(`매물,주소,3층,일반상가,2000,150,0,0,83,,,메모,,,공실,ID,링크,${csvCell}`);
assert.deepStrictEqual(JSON.parse(parsed[17]), JSON.parse(contacts));

assert.match(script, /var LIST_CONTACT_ROLE_META_V650/);
assert.match(script, /postSafeMutationV654\("updatePropertyMemo", payload\)/);
assert.match(script, /item\.contactListRaw\s*=\s*JSON\.stringify\(result\.contacts\)/);
assert.match(script, /item\.memo\s*=\s*result\.memo/);

assert.match(d1, /export function extractManualMemoContacts\(memo\)/);
assert.match(d1, /export function reconcileMemoContacts\(source, storedContacts, memo\)/);
assert.match(d1, /if \(!isExternalListingSource\(source\)\)/);
assert.match(d1, /const contacts = reconcileMemoContacts\(before\.main_source, body\.contacts, body\.memo\)/);
assert.match(d1, /UPDATE listings SET operating_memo=\?1, contacts_json=\?2/);
assert.match(d1, /INSERT INTO listing_history/);
assert.match(d1, /contactCount:\s*contacts\.length, contacts/);

assert.match(collector, /const contacts = Array\.isArray\(record\?\.contactList\)/);
assert.match(collector, /normalized_phone, status, first_seen_at, last_seen_at/);
assert.match(collector, /const key = `\$\{clean\(contact\.role\)\}:\$\{normalizedPhone\}`/);

console.log("listing contacts and D1 persistence tests passed");
