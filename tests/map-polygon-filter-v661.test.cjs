const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const map = fs.readFileSync("js/map.js", "utf8");
const quickTools = fs.readFileSync("js/map-quick-tools-v657.js", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

test("point-in-polygon keeps only coordinates inside the drawn boundary", () => {
  const pointInPolygon = Function(`return (${functionSource(script, "isCoordinateInPolygonV661")})`)();
  const square = [
    {lat: 36.30, lng: 127.30},
    {lat: 36.30, lng: 127.40},
    {lat: 36.40, lng: 127.40},
    {lat: 36.40, lng: 127.30}
  ];
  assert.equal(pointInPolygon({lat: 36.35, lng: 127.35}, square), true);
  assert.equal(pointInPolygon({lat: 36.30, lng: 127.35}, square), true);
  assert.equal(pointInPolygon({lat: 36.45, lng: 127.35}, square), false);
  assert.equal(pointInPolygon(null, square), false);
  assert.equal(pointInPolygon({lat: 36.35, lng: 127.35}, square.slice(0, 2)), false);
});

test("drawing button follows radius search and completes a polygon filter", () => {
  assert.ok(html.indexOf('id="mapPolygonBtn"') > html.indexOf('id="mapRadiusBtn"'));
  assert.match(html, /id="mapPolygonBtn"[\s\S]*?onclick="togglePolygonSearchV661\(\)"[\s\S]*?<span>그리기<\/span>/);
  assert.match(quickTools, /window\.togglePolygonSearchV661 = function/);
  assert.match(quickTools, /polygonPoints\.length < 3/);
  assert.match(quickTools, /new kakao\.maps\.Polygon/);
  assert.match(quickTools, /window\.mapPolygonFilterV661 = \{[\s\S]*?points:/);
  assert.match(quickTools, /그리기 버튼을 다시 누르면 영역이 완성됩니다/);
  assert.match(css, /#map\.map-polygon-drawing-v661[\s\S]*?cursor: crosshair/);
  assert.match(css, /\.map-polygon-vertex-v661\.first/);
});

test("polygon is a first-class removable map and list filter", () => {
  assert.match(script, /var polygonFilter = window\.mapPolygonFilterV661 \|\| null/);
  assert.match(script, /polygonFilter[\s\S]*?isItemWithinMapPolygonV661\(item, polygonFilter\)/);
  assert.match(script, /push\("polygon", "그린 영역"\)/);
  assert.match(script, /key === "radius" \|\| key === "polygon"/);
  assert.match(script, /"그린 영역 안 매물 " \+ filtered\.length/);
  assert.match(map, /window\.mapRadiusFilterV658 \|\| window\.mapPolygonFilterV661/);
  assert.match(quickTools, /window\.mapRadiusFilterV658 = null;[\s\S]*?window\.mapPolygonFilterV661 = null/);
  assert.match(html, /style\.css\?v=6\.10\.1-map-status-top&amp;polygon-filter-v661=1/);
  assert.match(html, /map-quick-tools-v657\.js\?v=6\.5\.10-done-only-filter&amp;polygon-filter-v661=1/);
});
