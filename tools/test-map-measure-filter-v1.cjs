const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function classList() {
  const values = new Set();
  return {
    toggle(name, active) {
      if (active) values.add(name);
      else values.delete(name);
    },
    contains(name) { return values.has(name); }
  };
}

function element(id) {
  return {
    id,
    hidden: false,
    textContent: "",
    classList: classList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector() { return null; }
  };
}

const elements = new Map();
[
  "mapMeasureStatusV657",
  "mapMeasureStatusTextV657",
  "mapDistanceBtn",
  "mapRadiusBtn",
  "mapQuickTodayBtn",
  "mapQuickVisitOnlyBtn",
  "mapQuickHideDoneBtn",
  "selectionActionBar",
  "selectionActionCount"
].forEach((id) => elements.set(id, element(id)));

const handlers = {};
const polylines = [];
const circles = [];

class Polyline {
  constructor(options) {
    this.path = (options.path || []).slice();
    polylines.push(this);
  }
  setMap(value) { this.map = value; }
  setPath(pathValue) { this.path = pathValue.slice(); }
  getLength() { return Math.max(0, this.path.length - 1) * 100; }
}

class Circle {
  constructor(options) {
    this.options = options;
    circles.push(this);
  }
  setMap(value) { this.map = value; }
}

class CustomOverlay {
  constructor(options) {
    Object.assign(this, options);
  }
  setMap(value) { this.map = value; }
  setPosition(value) { this.position = value; }
  setContent(value) { this.content = value; }
}

const fakeMap = {};
let filterRefreshes = 0;
const context = {
  console,
  map: fakeMap,
  currentItems: [{}, {}],
  kakao: {
    maps: {
      Polyline,
      Circle,
      CustomOverlay,
      event: {
        addListener(target, name, callback) { handlers[name] = callback; }
      }
    }
  },
  document: {
    getElementById(id) { return elements.get(id) || null; },
    addEventListener() {}
  },
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  addEventListener() {},
  innerWidth: 1200,
  applyFilter() { filterRefreshes += 1; },
  selectedPrintKeys: [],
  todayNewOnly: false,
  gongsilOnly: false,
  hideDone: true
};
context.window = context;

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "map-quick-tools-v657.js"), "utf8"),
  context,
  { filename: "map-quick-tools-v657.js" }
);

function point(lat, lng) {
  return {
    getLat() { return lat; },
    getLng() { return lng; }
  };
}

assert.strictEqual(typeof handlers.click, "function", "map click handler must be registered");

context.toggleDistanceMeasureV657();
handlers.click({ latLng: point(36.3, 127.3) });
handlers.click({ latLng: point(36.31, 127.31) });
handlers.click({ latLng: point(36.32, 127.32) });
assert(
  polylines.some((line) => line.path.length === 3),
  "distance measurement must keep extending through consecutive points"
);
assert(
  elements.get("mapMeasureStatusTextV657").textContent.includes("경유점 3개"),
  "distance status must report the route point count"
);
assert.strictEqual(
  elements.get("mapDistanceBtn").attributes["aria-pressed"],
  "true",
  "distance button must stay active while adding route points"
);

context.startRadiusMeasureV657(300);
handlers.click({ latLng: point(36.35, 127.38) });
assert.strictEqual(circles[circles.length - 1].options.radius, 300);
assert.strictEqual(context.mapRadiusFilterV658.meters, 300);
assert(filterRefreshes >= 1, "radius selection must refresh the property list");
assert(
  elements.get("mapMeasureStatusTextV657").textContent.includes("매물 2개만 표시"),
  "radius status must show the filtered property count"
);

context.clearMapMeasurementsV657();
assert.strictEqual(context.mapRadiusFilterV658, null);
assert.strictEqual(elements.get("mapMeasureStatusV657").hidden, true);

console.log("Map route measurement and radius filtering tests: OK");
