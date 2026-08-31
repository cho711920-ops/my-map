const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");
const quickTools = fs.readFileSync("js/map-quick-tools-v657.js", "utf8");

test("radius and distance guidance share one map-top status panel", () => {
  assert.match(html, /id="mapMeasureStatusV657"[\s\S]*?id="mapMeasureStatusTextV657"/);
  assert.match(quickTools, /function setStatus\(message\)[\s\S]*?mapMeasureStatusV657/);
  assert.match(quickTools, /반경 안 매물[\s\S]*?setStatus/);
  assert.match(quickTools, /경유점[\s\S]*?setStatus/);
  assert.match(css, /\.map-measure-status-v657\s*\{[\s\S]*?top:\s*74px;[\s\S]*?left:\s*calc\(\(100vw - var\(--map-sidebar-width-v659/s);
  assert.doesNotMatch(css, /\.map-measure-status-v657\s*\{[^}]*bottom:/s);
});

test("measurement status has a balanced accessible circular close control", () => {
  assert.match(html, /class="map-measure-status-close-v660"[\s\S]*?aria-label="반경 검색 또는 거리재기 해제"/);
  assert.match(html, /map-measure-status-close-v660[\s\S]*?<svg[\s\S]*?<path d="M7 7l10 10M17 7 7 17"/);
  assert.match(css, /\.map-measure-status-v657 \.map-measure-status-close-v660\s*\{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;[\s\S]*?border-radius:\s*50%/);
  assert.match(css, /\.map-measure-status-v657 \.map-measure-status-close-v660:focus-visible/);
  assert.match(html, /css\/style\.css\?v=6\.10\.1-map-status-top/);
});
