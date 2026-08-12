const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const script = read("js", "script.js");
const html = read("index.html");
const css = read("css", "style.css");
const d1 = read("cloudflare", "src", "d1-api.js");

function functionBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `${start} must exist`);
  assert.ok(endIndex > startIndex, `${start} block must be bounded by ${end}`);
  return source.slice(startIndex, endIndex);
}

const memoUi = functionBlock(script, "function toggleItemMemo(", "function memoDateLabel(");
const memoSave = functionBlock(script, "function saveItemMemo(", "function getCustomerMatchStatus(");
const memoD1 = functionBlock(d1, "async function updateMemo(", "async function toggleDone(");

assert.doesNotMatch(memoUi, /showList\(/);
assert.match(script, /card\.insertAdjacentHTML\("beforeend", buildMemoPanelMarkupV655\(item\)\)/);
assert.match(memoSave, /postSafeMutationV654\("updatePropertyMemo", payload\)/);
assert.match(memoSave, /item\.contactListRaw\s*=\s*JSON\.stringify\(result\.contacts\)/);
assert.match(memoSave, /item\.memo\s*=\s*result\.memo/);

assert.match(memoD1, /FROM listings WHERE property_id=\?1 LIMIT 1/);
assert.match(memoD1, /reconcileMemoContacts\(before\.main_source, body\.contacts, body\.memo\)/);
assert.match(memoD1, /INSERT INTO listing_history/);
assert.match(memoD1, /UPDATE listings SET operating_memo=\?1, contacts_json=\?2/);
assert.match(memoD1, /persisted:\s*true, queued:\s*false/);
assert.match(memoD1, /operationAdjustments:\s*\{ history:\s*1 \}/);

assert.match(html, /style\.css\?v=6\.5\.39-elevator-capacity-x/);
assert.match(html, /script\.js\?v=6\.5\.78-naver-map-tiles/);
assert.match(css, /\.memo-inline-status\.saving/);
assert.match(css, /\.memo-inline-status\.success/);
assert.match(css, /\.memo-inline-status\.error/);

console.log("fast inline memo with direct D1 persistence tests passed");
