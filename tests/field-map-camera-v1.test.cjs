const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "js", "map-field-camera-v1.js");

function makeCamera(width = 800, height = 600, options = {}) {
  const elements = [];
  const observers = [];
  const timers = new Map();
  let timerId = 0;
  const document = { hidden: false, visibilityState: "visible" };
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentNode = null;
      this.parentElement = null;
      this.ownerDocument = document;
      this.attributes = new Map();
      this.dataset = {};
      this.style = {
        setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] || ""; },
        removeProperty(name) { delete this[name]; }
      };
      const classes = new Set();
      this.classList = {
        add(...values) { values.forEach((value) => classes.add(value)); },
        remove(...values) { values.forEach((value) => classes.delete(value)); },
        contains(value) { return classes.has(value); },
        toggle(value, force) {
          const next = force === undefined ? !classes.has(value) : !!force;
          if (next) classes.add(value); else classes.delete(value);
          return next;
        }
      };
      elements.push(this);
    }
    get clientWidth() {
      if (this === viewport) return width;
      return this.style.width && this.style.width.endsWith("px")
        ? parseFloat(this.style.width) : this.parentElement ? this.parentElement.clientWidth : 0;
    }
    get clientHeight() {
      if (this === viewport) return height;
      return this.style.height && this.style.height.endsWith("px")
        ? parseFloat(this.style.height) : this.parentElement ? this.parentElement.clientHeight : 0;
    }
    get offsetWidth() { return this.clientWidth; }
    get offsetHeight() { return this.clientHeight; }
    get firstElementChild() { return this.children[0] || null; }
    get firstChild() { return this.firstElementChild; }
    get nextSibling() {
      if (!this.parentNode) return null;
      return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = child.parentElement = this;
      return child;
    }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    removeChild(child) {
      this.children = this.children.filter((current) => current !== child);
      child.parentNode = child.parentElement = null;
      return child;
    }
    insertBefore(child, before) {
      if (!before) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentNode = child.parentElement = this;
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    addEventListener() {}
    removeEventListener() {}
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      for (const child of this.children) {
        if (child.id === selector.slice(1)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
    querySelectorAll() { return []; }
    contains(child) { return child === this || this.children.some((element) => element.contains(child)); }
    getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, width: this.clientWidth, height: this.clientHeight,
        right: this.clientWidth, bottom: this.clientHeight };
    }
  }
  const viewport = new Element();
  viewport.id = "map";
  document.createElement = (tag) => new Element(tag);
  document.documentElement = new Element("html");
  document.body = new Element("body");
  document.getElementById = (id) => elements.find((element) => element.id === id) || null;
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.addEventListener = () => {};
  const calls = { relayout: 0, center: 0, events: [] };
  function Point(x, y) { this.x = x; this.y = y; }
  function LatLng(lat, lng) { this.getLat = () => lat; this.getLng = () => lng; }
  function Observer(callback) {
    this.callback = callback;
    this.observe = () => {};
    this.disconnect = () => {};
    observers.push(this);
  }
  const context = {
    console, document, HTMLElement: Element, Element, ResizeObserver: Observer, MutationObserver: Observer,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    cancelAnimationFrame(id) { timers.delete(id); },
    addEventListener() {}, removeEventListener() {},
    getComputedStyle(element) { return { position: "relative", width: element.clientWidth + "px", height: element.clientHeight + "px" }; },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    kakao: { maps: { Point, LatLng, event: { addListener() {}, removeListener() {}, trigger(_map, name) { calls.events.push(name); } } } }
  };
  context.window = context;
  context.globalThis = context;
  let camera;
  let surface;
  if (options.deferred) {
    // Authentication may defer this module until after SDK startup in the HTML host.
    surface = new Element();
    surface.id = "jsFieldMapSurfaceV1";
    viewport.appendChild(surface);
  } else {
    vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });
    camera = context.JSFieldMapCameraV1;
    assert.ok(camera, "camera public API is available");
    surface = camera.createContainer(viewport);
  }
  assert.ok(surface && surface.parentElement === viewport, "the SDK surface belongs to the existing viewport");
  const copyrightNodes = [];
  const tilePane = new Element();
  const controlPane = new Element();
  surface.appendChild(tilePane);
  const copyrightCount = options.copyrightCount === undefined ? 1 : options.copyrightCount;
  for (let index = 0; index < copyrightCount; index += 1) {
    const attribution = new Element();
    attribution.style.position = "absolute";
    attribution.style.bottom = "0px";
    const link = new Element("a");
    link.setAttribute("href", "https://map.kakao.com/");
    const logo = new Element("img");
    logo.setAttribute("alt", "Kakao Maps");
    link.appendChild(logo);
    const scale = new Element("span");
    scale.textContent = "50m";
    attribution.append(link, scale);
    attribution.querySelector = (selector) => selector === 'a[href*="map.kakao.com"] img' ? logo : null;
    surface.appendChild(attribution);
    copyrightNodes.push({ attribution, link, logo, scale });
  }
  surface.appendChild(controlPane);
  const raw = {
    containerPointFromCoords(point) { return new Point(surface.clientWidth / 2 + point.getLng(), surface.clientHeight / 2 - point.getLat()); },
    coordsFromContainerPoint(point) { return new LatLng(surface.clientHeight / 2 - point.y, point.x - surface.clientWidth / 2); }
  };
  let center = new LatLng(0, 0);
  const map = {
    getProjection: () => raw,
    getCenter: () => center,
    setCenter(value) { center = value; calls.center += 1; },
    getContainer: () => surface,
    getNode: () => surface,
    getLevel: () => 3,
    relayout() { calls.relayout += 1; }
  };
  context.map = map;
  const originalSdkChildren = surface.children.slice();
  if (options.deferred) {
    vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });
    camera = context.JSFieldMapCameraV1;
    assert.ok(camera, "deferred camera public API is available");
  } else camera.attach(map);
  return { camera, viewport, surface, map, raw, calls, Point, LatLng, width, height, context,
    copyrightNodes, tilePane, controlPane, elements, originalSdkChildren,
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      observers.forEach((observer) => observer.callback([]));
    } };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${message}: expected ${expected}, received ${actual}`);
}

test("normal map mode preserves the viewport and raw SDK projection", () => {
  const app = makeCamera();
  assert.equal(app.viewport.clientWidth, 800);
  assert.equal(app.viewport.clientHeight, 600);
  assert.equal(app.camera.projection(app.map), app.raw);
  assert.equal(app.camera.contains(new app.LatLng(0, 0)), null);
  assert.equal(app.camera.state().active, false);
});

for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315, 359]) {
  test(`head-up ${bearing} degrees maps forward upward and rightward to the right`, () => {
    const app = makeCamera();
    app.camera.setBearing(bearing);
    const projection = app.camera.projection(app.map);
    const radians = bearing * Math.PI / 180;
    const forward = projection.containerPointFromCoords(new app.LatLng(100 * Math.cos(radians), 100 * Math.sin(radians)));
    const right = projection.containerPointFromCoords(new app.LatLng(-100 * Math.sin(radians), 100 * Math.cos(radians)));
    near(forward.x, 400, "forward x");
    near(forward.y, 200, "forward y");
    near(right.x, 500, "right x");
    near(right.y, 300, "right y");
    assert.equal(app.camera.state().active, true);
  });
}

for (const [width, height] of [[800, 600], [390, 844], [1280, 720], [768, 1024]]) {
  test(`rotated ${width} by ${height} viewport round-trips and remains fully covered at every test angle`, () => {
    const app = makeCamera(width, height);
    const points = [[0, 0], [width, 0], [0, height], [width, height], [width / 2, height / 2], [23, height - 37]];
    for (const bearing of [0, 15, 45, 89, 90, 135, 180, 225, 270, 315, 359]) {
      app.camera.setBearing(bearing);
      const projection = app.camera.projection(app.map);
      for (const [x, y] of points) {
        const geo = projection.coordsFromContainerPoint(new app.Point(x, y));
        const roundTrip = projection.containerPointFromCoords(geo);
        near(roundTrip.x, x, `round-trip x at ${bearing}`);
        near(roundTrip.y, y, `round-trip y at ${bearing}`);
        const rawPoint = app.raw.containerPointFromCoords(geo);
        assert.ok(rawPoint.x >= -0.00001 && rawPoint.x <= app.surface.clientWidth + 0.00001,
          `SDK surface covers x=${x}, y=${y} at ${bearing} degrees`);
        assert.ok(rawPoint.y >= -0.00001 && rawPoint.y <= app.surface.clientHeight + 0.00001,
          `SDK surface covers x=${x}, y=${y} at ${bearing} degrees`);
      }
      assert.equal(app.viewport.clientWidth, width, "rotating does not resize the existing layout viewport");
      assert.equal(app.viewport.clientHeight, height, "rotating does not resize the existing layout viewport");
    }
  });
}

test("visibility uses the clipped screen rectangle, not the larger SDK surface", () => {
  const app = makeCamera(800, 600);
  for (const bearing of [0, 45, 90, 180, 270]) {
    app.camera.setBearing(bearing);
    const projection = app.camera.projection(app.map);
    for (const [x, y] of [[1, 1], [799, 599], [400, 300]]) {
      const geo = projection.coordsFromContainerPoint(new app.Point(x, y));
      assert.equal(app.camera.contains(geo), true, `visible screen point ${x},${y} at ${bearing}`);
    }
    for (const [x, y] of [[-1, 300], [801, 300], [400, -1], [400, 601]]) {
      const geo = projection.coordsFromContainerPoint(new app.Point(x, y));
      assert.equal(app.camera.contains(geo), false, `offscreen point ${x},${y} at ${bearing}`);
    }
  }
});

test("bearing changes reuse the same overscan geometry without repeated SDK relayout", () => {
  const app = makeCamera(390, 844);
  app.camera.setBearing(0);
  const relayouts = app.calls.relayout;
  const size = [app.surface.clientWidth, app.surface.clientHeight];
  for (const bearing of [45, 90, 180, 270, 359, 1]) app.camera.setBearing(bearing);
  assert.deepEqual([app.surface.clientWidth, app.surface.clientHeight], size);
  assert.equal(app.calls.relayout, relayouts, "GPS direction updates should change transforms, not rebuild tile geometry");
});

test("reset restores ordinary projection, north-up footprint, and SDK center", () => {
  const app = makeCamera(800, 600);
  const originalCenter = app.map.getCenter();
  app.camera.setBearing(123);
  app.camera.reset();
  assert.equal(app.camera.state().active, false);
  assert.equal(app.camera.projection(app.map), app.raw);
  assert.equal(app.camera.contains(new app.LatLng(0, 0)), null);
  assert.equal(app.surface.clientWidth, 800);
  assert.equal(app.surface.clientHeight, 600);
  near(app.map.getCenter().getLat(), originalCenter.getLat(), "latitude remains unchanged");
  near(app.map.getCenter().getLng(), originalCenter.getLng(), "longitude remains unchanged");
  assert.doesNotMatch(app.surface.style.transform || "", /rotate\((?!0(?:deg)?\))/,
    "OFF must not retain a previous non-zero bearing");
});

test("missing bearing leaves ordinary map geometry and does not invent a direction", () => {
  const app = makeCamera();
  app.camera.setBearing(90);
  app.camera.setBearing(null);
  assert.equal(app.camera.state().active, false);
  assert.equal(app.camera.projection(app.map), app.raw);
  assert.equal(app.camera.contains(new app.LatLng(0, 0)), null);
});

test("resizing while following keeps center and remeasures the real viewport", () => {
  const app = makeCamera(800, 600);
  app.camera.setBearing(45);
  const originalCenter = app.map.getCenter();
  const beforeResize = app.calls.relayout;
  app.resize(600, 800);
  const projection = app.camera.projection(app.map);
  const center = projection.containerPointFromCoords(new app.LatLng(0, 0));
  near(center.x, 300, "resized horizontal center");
  near(center.y, 400, "resized vertical center");
  assert.ok(app.calls.relayout > beforeResize, "viewport resize triggers SDK geometry refresh");
  near(app.map.getCenter().getLat(), originalCenter.getLat(), "resize preserves latitude");
  near(app.map.getCenter().getLng(), originalCenter.getLng(), "resize preserves longitude");
  for (const [x, y] of [[0, 0], [600, 0], [0, 800], [600, 800]]) {
    const geo = projection.coordsFromContainerPoint(new app.Point(x, y));
    const rawPoint = app.raw.containerPointFromCoords(geo);
    assert.ok(rawPoint.x >= 0 && rawPoint.x <= app.surface.clientWidth);
    assert.ok(rawPoint.y >= 0 && rawPoint.y <= app.surface.clientHeight);
  }
  const afterResize = app.calls.relayout;
  app.resize(600, 800);
  assert.equal(app.calls.relayout, afterResize, "identical resize notifications do not create a relayout loop");
});

test("invalid bearings cannot corrupt a valid camera and finite angles normalize", () => {
  const app = makeCamera();
  app.camera.setBearing(450);
  assert.equal(app.camera.state().bearing, 90);
  const transform = app.surface.style.transform;
  for (const invalid of [undefined, "180", NaN, Infinity, -Infinity]) {
    assert.equal(app.camera.setBearing(invalid), false);
    assert.equal(app.camera.state().bearing, 90);
    assert.equal(app.surface.style.transform, transform);
  }
  app.camera.setBearing(-90);
  assert.equal(app.camera.state().bearing, 270);
});

test("the adapter never alters another map instance's projection", () => {
  const app = makeCamera();
  const otherProjection = { containerPointFromCoords() {}, coordsFromContainerPoint() {} };
  const otherMap = { getProjection: () => otherProjection };
  app.camera.setBearing(90);
  assert.equal(app.camera.projection(otherMap), otherProjection);
  assert.equal(app.map.getProjection(), app.raw, "SDK public projection is not monkey-patched");
});

for (const copyrightCount of [0, 2]) {
  test(`${copyrightCount === 0 ? "missing" : "ambiguous"} SDK attribution fails closed to ordinary north-up geometry`, () => {
    const app = makeCamera(800, 600, { copyrightCount });
    const childrenBefore = app.surface.children.slice();
    const relayouts = app.calls.relayout;
    assert.equal(app.camera.setBearing(90), false);
    assert.equal(app.camera.state().active, false);
    assert.equal(app.camera.projection(app.map), app.raw);
    assert.equal(app.camera.contains(new app.LatLng(0, 0)), null);
    assert.equal(app.surface.clientWidth, 800);
    assert.equal(app.surface.clientHeight, 600);
    assert.equal(app.surface.style.transform, "none");
    assert.equal(app.calls.relayout, relayouts);
    assert.deepEqual(app.surface.children, childrenBefore, "attribution uncertainty must not mutate SDK nodes");
    assert.equal(app.viewport.classList.contains("js-field-map-heading-up-v1"), false);
  });
}

test("ON and OFF preserve the original SDK attribution, link, logo and live scale nodes and sibling order", () => {
  const app = makeCamera();
  const { attribution, link, logo, scale } = app.copyrightNodes[0];
  const originalNodes = app.surface.children.slice();
  const clickHandler = () => {};
  link.onclick = clickHandler;
  for (const bearing of [45, 180]) {
    assert.equal(app.camera.setBearing(bearing), true);
    assert.equal(attribution.parentElement, app.viewport, "copyright rail is not cropped by the rotated SDK surface");
    assert.equal(attribution.classList.contains("js-field-map-copyright-v1"), true);
    assert.equal(attribution.children[0], link);
    assert.equal(link.children[0], logo);
    assert.equal(attribution.children[1], scale);
    assert.equal(link.getAttribute("href"), "https://map.kakao.com/");
    assert.equal(link.onclick, clickHandler, "real link handlers are retained rather than cloned");
    scale.textContent = "20m";
    assert.equal(attribution.children[1].textContent, "20m", "SDK references keep updating the same scale node");
    app.camera.reset();
    assert.equal(attribution.parentElement, app.surface);
    assert.equal(attribution.classList.contains("js-field-map-copyright-v1"), false);
    assert.deepEqual(app.surface.children, originalNodes, "OFF restores the exact original sibling placement");
  }
});

test("OFF still restores attribution when its original next SDK sibling has disappeared", () => {
  const app = makeCamera();
  const attribution = app.copyrightNodes[0].attribution;
  app.camera.setBearing(90);
  app.controlPane.remove();
  app.camera.reset();
  assert.equal(attribution.parentElement, app.surface);
  assert.equal(app.surface.children[app.surface.children.length - 1], attribution);
  assert.equal(attribution.classList.contains("js-field-map-copyright-v1"), false);
  assert.equal(app.camera.state().active, false);
});

test("deferred module adopts an existing SDK host without replacing DOM, recentering, or creating another container", () => {
  const app = makeCamera(800, 600, { deferred: true });
  assert.equal(app.context.map, app.map, "the existing Kakao Map instance is retained");
  assert.equal(app.camera.state().active, false);
  assert.equal(app.camera.projection(app.map), app.raw);
  assert.equal(app.camera.contains(new app.LatLng(0, 0)), null);
  assert.equal(app.viewport.querySelector("#jsFieldMapSurfaceV1"), app.surface);
  assert.equal(app.camera.createContainer(app.viewport), app.surface, "repeat adoption returns the same SDK host");
  assert.equal(app.elements.filter((element) => element.id === "jsFieldMapSurfaceV1").length, 1);
  assert.deepEqual(app.surface.children, app.originalSdkChildren, "all original tile/control/attribution nodes remain in place");
  assert.equal(app.calls.relayout, 0, "optional-module arrival must not cause map flicker");
  assert.equal(app.calls.center, 0, "optional-module arrival must not alter camera center");
  app.resize(800, 600);
  assert.equal(app.calls.relayout, 0, "the initial ResizeObserver callback is also inert");
  assert.equal(app.calls.center, 0);
});

test("deferred adoption automatically attaches the existing map and restores its original nodes after field mode", () => {
  const app = makeCamera(768, 1024, { deferred: true });
  const attribution = app.copyrightNodes[0].attribution;
  assert.equal(app.camera.setBearing(180), true, "no manual attach call should be necessary after deferred startup");
  assert.equal(app.camera.state().active, true);
  assert.equal(attribution.parentElement, app.viewport);
  const center = app.camera.projection(app.map).containerPointFromCoords(new app.LatLng(0, 0));
  near(center.x, 384, "adopted map remains horizontally centered");
  near(center.y, 512, "adopted map remains vertically centered");
  app.camera.reset();
  assert.equal(app.context.map, app.map);
  assert.equal(app.camera.projection(app.map), app.raw);
  assert.deepEqual(app.surface.children, app.originalSdkChildren);
  assert.equal(attribution.parentElement, app.surface);
  assert.equal(app.elements.filter((element) => element.id === "jsFieldMapSurfaceV1").length, 1);
});
