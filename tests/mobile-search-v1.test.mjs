import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mobile = fs.readFileSync(new URL("../js/mobile-app-v1.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../js/script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/mobile-app-v1.css", import.meta.url), "utf8");

test("mobile keyword search syncs immediately and searches outside map bounds", () => {
  assert.match(html, /mobile-app-v1\.js\?v=1\.0\.3-mobile-search/);
  assert.match(html, /mobile-app-v1\.css\?v=1\.0\.3-sort-row-aligned/);
  assert.match(mobile, /mobileInput\.addEventListener\("input", queueMobileKeywordSearch\)/);
  assert.match(mobile, /global\.jsMobileGlobalKeywordV1 = !!source\.value\.trim\(\)/);
  assert.match(script, /ignoreMapBounds \|\| mobileGlobalKeywordSearch/);
});

test("mobile sort control stays in the same row as the three listing filters", () => {
  assert.match(css, /#listToolbar > #sortDropdown\s*\{[\s\S]*?grid-column: auto !important;[\s\S]*?grid-row: auto !important;/);
  assert.match(css, /#listToolbar > #sortDropdown > #sortDropdownBtn/);
});

test("mobile list has an explicit empty result state", () => {
  assert.match(script, /jsm-list-empty-v1/);
  assert.match(css, /\.js-mobile-app-v1 #list \.jsm-list-empty-v1/);
});
