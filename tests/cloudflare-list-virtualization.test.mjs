import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("property list keeps a bounded bidirectional render window", () => {
  const script = read("js/script.js");
  const style = read("css/style.css");
  const html = read("index.html");

  assert.match(script, /return window\.innerWidth <= 768 \? 14 : 18/);
  assert.match(script, /getListRenderChunkSize\(\) \* 2/);
  assert.match(script, /function trimListWindowFromStartV1/);
  assert.match(script, /function renderPreviousListChunkV1/);
  assert.match(script, /data-rendered-start/);
  assert.match(script, /data-rendered-count/);
  assert.match(style, /#list \.list-virtual-top-spacer-v1/);
  assert.match(html, /js\/script\.js\?v=6\.5\.76-data-access/);
});

test("listing workflow no longer exposes legacy Google Sheet wording", () => {
  const runtimeFiles = [
    "index.html",
    "js/ai-visit-session-v6.js",
    "js/gongsil-collector.js",
    "js/map.js",
    "js/operations-collection-v8.js",
    "js/parser.js",
    "js/script.js",
    "js/unified-listings-v8.js"
  ];

  for (const relativePath of runtimeFiles) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /시트|구글시트/, `${relativePath} still contains legacy wording`);
  }
  assert.doesNotMatch(read("index.html"), /docs\.google\.com\/spreadsheets/);
  assert.doesNotMatch(read("js/parser.js"), /function openGoogleSheet/);
});
