const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const mapSource = fs.readFileSync("js/map.js", "utf8");
const css = fs.readFileSync("css/app-final-overrides-v690.css", "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const openBrace = source.indexOf("{", start);
  let depth = 0;

  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

assert.match(html, /id="mapListingCountV825"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /<span>매물<\/span><strong id="mapListingCountValueV825">0개</);
assert.ok(html.includes("app-final-overrides-v690.css?v=1.0.0&amp;map-listing-count-v825=1"));
assert.ok(html.includes("map.js?v=8.2.22-full-initial-render&amp;full-list-cache-v2=1&amp;polygon-filter-v661=1&amp;trade-market-v1=1&amp;map-listing-count-v825=1"));
assert.match(css, /\.map-listing-count-v825\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*12px;[\s\S]*?left:\s*12px;/);
assert.match(css, /\.js-mobile-app-v1 \.map-listing-count-v825\s*\{[\s\S]*?top:\s*calc\(var\(--jsm-header-height\) \+ 8px\);/);
assert.match(css, /body\.ai-side-panel-open \.map-listing-count-v825\s*\{[\s\S]*?left:\s*492px;/);
assert.match(css, /max-width:\s*1300px[\s\S]*?body\.ai-side-panel-open \.map-listing-count-v825\s*\{[\s\S]*?left:\s*432px;/);
assert.match(css, /\.map-listing-count-v825\s*\{[\s\S]*?pointer-events:\s*none;/);
assert.match(mapSource, /function clearMap\(\)[\s\S]*?overlays = \[\];[\s\S]*?updateMapListingCountV825\(\);/);
assert.match(mapSource, /function drawMapClustersOnlyV639\(items\)[\s\S]*?overlays\.push\(overlay\);[\s\S]*?updateMapListingCountV825\(\);/);

const badge = {
  dataset: {},
  attributes: {},
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
};
const value = { textContent: "" };
const context = {
  overlays: [
    { __cluster: { items: Array(3), key: "a" } },
    {},
    null,
    { __cluster: { items: Array(2), key: "b" } }
  ],
  document: {
    getElementById(id) {
      if (id === "mapListingCountV825") return badge;
      if (id === "mapListingCountValueV825") return value;
      return null;
    }
  }
};

vm.createContext(context);
vm.runInContext(`${extractFunction(mapSource, "updateMapListingCountV825")}; this.update = updateMapListingCountV825;`, context);

assert.equal(context.update(), 5);
assert.equal(value.textContent, "5개");
assert.equal(badge.dataset.listingCount, "5");
assert.equal(badge.attributes["aria-label"], "현재 지도에 표시된 매물 5개");

context.map = {
  getProjection() {
    return {
      containerPointFromCoords(position) {
        return position;
      }
    };
  }
};
context.document.getElementById = function(id) {
  if (id === "mapListingCountV825") return badge;
  if (id === "mapListingCountValueV825") return value;
  if (id === "map") return { clientWidth: 100, clientHeight: 80 };
  return null;
};
context.overlays = [
  { __cluster: { items: Array(2), latlng: { x: 20, y: 30 } } },
  { __cluster: { items: Array(4), displayLatlng: { x: 90, y: 70 } } },
  { __cluster: { items: Array(9), latlng: { x: 140, y: 30 } } },
  { __cluster: { items: Array(7), latlng: { x: 20, y: -5 } } }
];
assert.equal(context.update(), 6);
assert.equal(value.textContent, "6개");

context.overlays = [];
assert.equal(context.update(), 0);
assert.equal(value.textContent, "0개");
assert.equal(badge.dataset.listingCount, "0");

console.log("map listing count v8.2.5 tests passed");
