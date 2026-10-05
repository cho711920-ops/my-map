const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const source = read("js/map-field-mode-v1.js");
const mapSource = read("js/map.js");
const html = read("index.html");

function eventTarget(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      if (listeners.has(type)) listeners.get(type).delete(callback);
    },
    dispatchEvent(event) {
      for (const callback of Array.from(listeners.get(event.type) || [])) callback(event);
      return true;
    }
  });
}

function element(tagName = "div") {
  const attributes = new Map();
  const classes = new Set();
  const node = eventTarget({
    tagName: tagName.toUpperCase(),
    children: [],
    style: {
      setProperty(name, value) { this[name] = String(value); },
      removeProperty(name) { delete this[name]; },
      getPropertyValue(name) { return this[name] || ""; }
    },
    dataset: {},
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : !!force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      }
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === "id") this.id = String(value);
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return descendants.filter((child) => selector === "*" || selector.split(",").some((part) => matches(child, part.trim())));
    },
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
    closest(selector) {
      for (let current = this; current; current = current.parentNode) {
        if (selector.split(",").some((part) => matches(current, part.trim()))) return current;
      }
      return null;
    },
    focus() {
      const document = this.ownerDocument;
      if (!document || document.activeElement === this) return;
      const previous = document.activeElement;
      document.activeElement = this;
      if (previous) document.dispatchEvent({ type: "focusout", target: previous, relatedTarget: this });
      document.dispatchEvent({ type: "focusin", target: this, relatedTarget: previous });
    },
    getBoundingClientRect() { return { width: 100, height: 100, top: 0, left: 0 }; }
  });
  Object.defineProperty(node, "className", {
    get() { return Array.from(classes).join(" "); },
    set(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); }
  });
  return node;
}

function matches(node, selector) {
  if (selector.startsWith("#")) return node.getAttribute("id") === selector.slice(1);
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  const attribute = /^\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(selector);
  if (attribute) return attribute[2] === undefined ? node.getAttribute(attribute[1]) !== null : node.getAttribute(attribute[1]) === attribute[2];
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function fakeClock() {
  let now = Date.parse("2026-10-02T03:00:00Z");
  let nextId = 1;
  const timers = new Map();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  return {
    Date: ClockDate,
    get now() { return now; },
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      const end = now + milliseconds;
      let count = 0;
      for (;;) {
        const due = Array.from(timers.entries()).filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        assert.ok(++count < 1000, "timers must settle without an infinite loop");
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = end;
    }
  };
}

function functionSource(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must remain available`);
  const body = text.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

function createRuntime(options = {}) {
  const clock = fakeClock();
  const calls = { centers: [], levels: [], markers: [], navigation: [], watches: [], clearedWatches: [], warnings: [], notifications: [] };
  const nodes = new Map();
  const allNodes = [];
  const ancestors = [];
  const markup = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  for (const match of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const index = ancestors.findLastIndex((node) => node.tagName.toLowerCase() === tag);
      if (index >= 0) ancestors.length = index;
      continue;
    }
    const node = element(tag);
    for (const attr of match[3].matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)) {
      node.setAttribute(attr[1], attr[2] ?? attr[3] ?? "");
      if (attr[1] === "class") node.className = attr[2] ?? attr[3] ?? "";
      if (attr[1] === "hidden") node.hidden = true;
    }
    if (node.getAttribute("id")) nodes.set(node.getAttribute("id"), node);
    allNodes.push(node);
    if (ancestors.length) ancestors.at(-1).appendChild(node);
    if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) ancestors.push(node);
  }
  const document = eventTarget({
    readyState: "complete",
    hidden: false,
    visibilityState: "visible",
    body: allNodes.find((node) => node.tagName === "BODY"),
    documentElement: allNodes.find((node) => node.tagName === "HTML"),
    getElementById(id) { return nodes.get(id) || null; },
    createElement: element,
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return allNodes.filter((node) => selector.split(",").some((part) => matches(node, part.trim()))); }
  });
  document.activeElement = document.body;
  for (const node of allNodes) node.ownerDocument = document;
  function LatLng(lat, lng) {
    this.getLat = () => lat;
    this.getLng = () => lng;
  }
  const mapListeners = new Map();
  const map = {
    center: new LatLng(36.34, 127.38),
    level: 7,
    draggable: options.draggable ?? true,
    zoomable: options.zoomable ?? true,
    getCenter() { return this.center; },
    getLevel() { return this.level; },
    getDraggable() { return this.draggable; },
    getZoomable() { return this.zoomable; },
    setCenter(coords) { this.center = coords; calls.centers.push(coords); },
    panTo(coords) { this.setCenter(coords); },
    setLevel(level) { this.level = level; calls.levels.push(level); },
    setDraggable(value) { this.draggable = value; },
    setZoomable(value) { this.zoomable = value; }
  };
  const kakao = { maps: {
    LatLng,
    event: {
      addListener(target, type, callback) {
        if (!mapListeners.has(type)) mapListeners.set(type, new Set());
        mapListeners.get(type).add(callback);
      },
      removeListener(target, type, callback) { mapListeners.get(type)?.delete(callback); }
    },
    CustomOverlay: function CustomOverlay(settings) {
      this.content = settings.content;
      this.position = settings.position;
      calls.markers.push(settings.position);
      this.setPosition = (coords) => { this.position = coords; calls.markers.push(coords); };
      this.getPosition = () => this.position;
      this.getContent = () => this.content;
      this.map = null;
      this.setMap = (target) => { this.map = target; };
    }
  } };
  const forbidden = (name) => () => assert.fail(`field mode must not call ${name}`);
  const storage = { getItem() { return null; }, setItem: forbidden("storage.setItem"), removeItem: forbidden("storage.removeItem"), clear: forbidden("storage.clear") };
  const navigator = { geolocation: options.geolocation === false ? undefined : {
    watchPosition(success, failure, settings) {
      calls.watches.push({ success, failure, settings });
      if (options.watchError) throw options.watchError;
      return 17;
    },
    getCurrentPosition: forbidden("geolocation.getCurrentPosition"),
    clearWatch(id) { calls.clearedWatches.push(id); }
  } };
  const context = eventTarget({
    document, navigator, kakao,
    map: options.map === false ? null : map,
    Date: clock.Date,
    performance: { now: () => clock.now },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    requestAnimationFrame(callback) { return clock.setTimeout(callback, 16); },
    cancelAnimationFrame: clock.clearTimeout,
    localStorage: storage, sessionStorage: storage,
    fetch: forbidden("fetch"),
    loadSheet: forbidden("loadSheet"),
    applyFilter: forbidden("applyFilter"),
    resetFilter: forbidden("resetFilter"),
    showList: forbidden("showList"),
    alert(message) { calls.notifications.push(message); },
    matchMedia() { return { matches: false, addEventListener() {} }; },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    console: { log() {}, error() {}, warn(...args) { calls.warnings.push(args); } },
    JSKakaoNavigation: { rememberPosition(position) { calls.navigation.push(position); } },
    favoriteOnly: true,
    favoriteKeys: ["property:keep"],
    activeFavoriteFolderId: "folder-keep",
    selectedItemKey: "listing-keep",
    jsCurrentLocationOverlayV630: null,
    jsCurrentLocationWatchIdV630: null
  });
  context.window = context;
  vm.createContext(context);
  vm.runInContext([
    functionSource(mapSource, "updateCurrentLocationOverlayV630"),
    functionSource(mapSource, "startCurrentLocationTrackingV630")
  ].join("\n"), context, { filename: "map-location-integration.js" });
  function loadController() {
    vm.runInContext(source, context, { filename: "map-field-mode-v1.js" });
    assert.ok(context.JSFieldModeV1, "the field mode controller must expose its public API");
  }
  if (!options.deferController) loadController();
  return {
    get api() { return context.JSFieldModeV1; },
    context, clock, calls, document, nodes, map, loadController,
    click(node) {
      document.dispatchEvent({ type: "pointerdown", target: node });
      const handler = node.getAttribute("onclick");
      if (handler) vm.runInContext(handler, context);
    },
    fix(lat = 36.3504, lng = 127.3845, accuracy = 12, timestamp = clock.now) {
      return { coords: { latitude: lat, longitude: lng, accuracy }, timestamp };
    },
    update(position) { context.updateCurrentLocationOverlayV630(position); },
    visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      document.dispatchEvent({ type: "visibilitychange" });
    },
    fireMap(type) { for (const callback of mapListeners.get(type) || []) callback(); }
  };
}

function coordinatePair(position) {
  return [position.getLat(), position.getLng()];
}

function fieldFix(app, options = {}) {
  const { north = 0, east = 0, accuracy = 4, heading, speed, timestamp = app.clock.now } = options;
  const latitude = 36.3504 + north / 111195;
  const longitude = 127.3845 + east / (111195 * Math.cos(36.3504 * Math.PI / 180));
  const position = app.fix(latitude, longitude, accuracy, timestamp);
  if (Object.hasOwn(options, "heading")) position.coords.heading = heading;
  if (Object.hasOwn(options, "speed")) position.coords.speed = speed;
  return position;
}

function markerHeading(app) {
  return app.context.jsCurrentLocationOverlayV630.getContent().style.getPropertyValue("--js-field-mode-heading");
}

function assertHeading(app, expected, source, message) {
  const state = app.api.state();
  if (expected === null) assert.equal(state.heading, null, message);
  else assert.ok(Math.abs(state.heading - expected) < 0.1, message || `expected heading ${expected}, received ${state.heading}`);
  assert.equal(state.headingSource, source, message);
}

function createIdleRuntime(pin = null) {
  const clock = fakeClock();
  const calls = { captures: 0, restored: [], draws: [], lists: [] };
  const pinnedItems = [{ key: "listing-keep" }];
  const document = eventTarget({ hidden: false, visibilityState: "visible", body: element("body"), getElementById() { return null; } });
  const context = {
    document,
    Date: clock.Date,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    following: true,
    viewport: "initial",
    JSFieldModeV1: { isFollowing: () => context.following },
    jsMapIdleTimerV638: null,
    jsFieldModeIdleRefreshPendingV1: false,
    jsLastIdleViewportKeyV638: "",
    jsPinnedClusterSelectionV6515: pin,
    jsPinnedClusterSpatialChangeIgnoreUntilV6517: 0,
    jsMapUserNavigationIntentUntilV6525: 0,
    jsLastRenderedItemsV639: [],
    currentItems: [],
    selectedGroupKey: null,
    selectedGroupKeys: [],
    multiClusterMode: false,
    isRendering: false,
    getMapSpatialKeyV6515() { return context.viewport; },
    getMapViewportKeyV638() { return context.viewport; },
    captureClusterSelectionSnapshotV638() { calls.captures += 1; return { singleItemIds: [] }; },
    restoreClusterSelectionSnapshotV638(snapshot) { calls.restored.push(snapshot); },
    getPinnedClusterItemsV6515() { return pinnedItems; },
    clearPinnedClusterSelectionV6515() { assert.fail("GPS camera movement must not clear the selected cluster"); },
    getFilteredItems() { return [{ key: context.viewport }]; },
    drawMapClustersOnlyV639(items) { calls.draws.push({ at: clock.now, keys: Array.from(items, (item) => item.key) }); },
    showList(items) { calls.lists.push(Array.from(items, (item) => item.key)); },
    getAdministrativeListItemsV6570(items) { return items; }
  };
  context.window = context;
  const visibilityStart = mapSource.indexOf('document.addEventListener("visibilitychange", function() {');
  assert.notEqual(visibilityStart, -1, "map visibility recovery must remain installed");
  const visibilityFunction = functionSource(
    mapSource.slice(visibilityStart).replace("function()", "function mapVisibilityForTest()"),
    "mapVisibilityForTest"
  );
  vm.createContext(context);
  vm.runInContext([
    ...[
      "preservePinnedClusterSelectionDuringRelayoutV6517",
      "keepPinnedClusterSelectionAcrossTransientUiV6525",
      "restorePinnedClusterSelectionAfterTransientUiV6525",
      "shouldClearPinnedClusterForMapNavigationV6525",
      "scheduleMapIdleRefreshV638"
    ].map((name) => functionSource(mapSource, name)),
    visibilityFunction,
    'document.addEventListener("visibilitychange", mapVisibilityForTest);'
  ].join("\n"), context, { filename: "map-follow-idle-integration.js" });
  return {
    context, clock, calls,
    visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      document.dispatchEvent({ type: "visibilitychange" });
    }
  };
}

test("field mode starts off at 50m and activation without a recent fix waits for GPS", () => {
  const app = createRuntime();
  assert.equal(app.api.state().enabled, false);
  assert.equal(app.api.state().controlsOpen, false);
  assert.equal(app.api.state().scale, 50);
  assert.equal(app.api.isFollowing(), false);
  app.api.toggle();
  assert.equal(app.api.state().enabled, true);
  assert.equal(app.api.state().controlsOpen, true);
  assert.equal(app.calls.centers.length, 0, "activation must not invent a location");
  app.clock.advance(1000);
  app.update(app.fix());
  assert.equal(app.api.isFollowing(), true);
  assert.deepEqual(coordinatePair(app.map.center), [36.3504, 127.3845]);
  assert.equal(app.map.level, 3);
});

test("activation can reuse an accurate fix from the last eight seconds but waits when it is old", () => {
  const fresh = createRuntime();
  fresh.update(fresh.fix());
  assert.equal(fresh.calls.markers.length, 1, "ordinary location marker still works while disabled");
  assert.equal(fresh.calls.centers.length, 0);
  fresh.clock.advance(2000);
  fresh.api.setEnabled(true);
  assert.equal(fresh.calls.centers.length, 1, "a stationary user can enter field mode immediately");
  assert.equal(fresh.api.isFollowing(), true);

  const old = createRuntime();
  old.update(old.fix());
  old.clock.advance(9000);
  old.api.setEnabled(true);
  assert.equal(old.calls.centers.length, 0, "an old ordinary-marker cache is not an activation fix");
  old.clock.advance(1000);
  old.update(old.fix(36.3505));
  assert.equal(old.calls.centers.length, 1);
});

test("20m and 50m selections use their Kakao levels without affecting listing data", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.api.setScale(20);
  assert.equal(app.api.state().scale, 20);
  assert.equal(app.api.state().controlsOpen, false);
  assert.equal(app.map.level, 1);
  app.api.toggleScaleControls();
  assert.equal(app.api.state().controlsOpen, true);
  app.api.setScale(50);
  assert.equal(app.api.state().scale, 50);
  assert.equal(app.api.state().controlsOpen, false);
  assert.equal(app.map.level, 3);
  app.api.setScale(75);
  assert.ok([20, 50].includes(app.api.state().scale), "unsupported choices must not become map scales");
  assert.equal(app.context.favoriteOnly, true);
  assert.deepEqual(app.context.favoriteKeys, ["property:keep"]);
  assert.equal(app.context.activeFavoriteFolderId, "folder-keep");
  assert.equal(app.context.selectedItemKey, "listing-keep");
});

test("scale controls close after three seconds while GPS and status updates keep following", () => {
  const app = createRuntime();
  const controls = app.document.querySelectorAll("[data-field-mode-controls]");
  app.api.setEnabled(true);
  app.update(app.fix());
  for (let index = 1; index <= 5; index += 1) {
    app.clock.advance(500);
    app.update(app.fix(36.3504 + index * 0.0001));
    assert.equal(app.api.state().controlsOpen, true);
  }
  app.api.onError({ code: 2 });
  app.clock.advance(499);
  assert.equal(app.api.state().controlsOpen, true);
  app.clock.advance(1);
  assert.equal(app.api.state().controlsOpen, false, "GPS and status updates must not extend the original deadline");
  assert.ok(controls.every((node) => node.hidden));
  assert.equal(app.api.state().enabled, true);
  assert.equal(app.api.isFollowing(), true);
  app.update(app.fix(36.3511));
  app.clock.advance(1000);
  app.update(app.fix(36.3512, 127.3845, 200));
  assert.equal(app.api.state().controlsOpen, false, "good and inaccurate fixes must not reopen the popup");
  assert.equal(app.calls.watches.length, 1);
  assert.equal(app.map.draggable, false);
  assert.deepEqual(coordinatePair(app.map.center), [36.3511, 127.3845]);
});

test("the scale expander only opens and closes controls without toggling mode or restarting GPS", () => {
  const app = createRuntime();
  const expanders = app.document.querySelectorAll("[data-field-mode-expand]");
  assert.equal(expanders.length, 2);
  assert.ok(expanders.every((node) => node.hidden));
  app.api.toggleScaleControls();
  assert.equal(app.api.state().enabled, false);
  assert.equal(app.api.state().controlsOpen, false);
  assert.equal(app.calls.watches.length, 0);

  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(3000);
  const cameraCalls = app.calls.centers.length;
  for (const expander of expanders) {
    assert.equal(expander.hidden, false);
    assert.equal(expander.textContent, "50m ▾");
    assert.equal(expander.getAttribute("aria-expanded"), "false");
    app.click(expander);
    assert.equal(app.api.state().controlsOpen, true);
    assert.ok(expanders.every((node) => node.getAttribute("aria-expanded") === "true"));
    app.click(expander);
    assert.equal(app.api.state().controlsOpen, false);
    assert.equal(app.api.state().enabled, true);
  }
  assert.equal(app.calls.centers.length, cameraCalls);
  assert.equal(app.calls.watches.length, 1);
  assert.equal(app.calls.clearedWatches.length, 0);
  app.api.toggleScaleControls();
  app.api.setScale(20);
  assert.ok(expanders.every((node) => node.textContent === "20m ▾" && node.getAttribute("aria-expanded") === "false"));
  app.api.toggleScaleControls();
  app.api.setScale(20);
  assert.equal(app.api.state().controlsOpen, false, "choosing the already selected scale also dismisses the popup");
  app.api.setEnabled(false);
  assert.ok(expanders.every((node) => node.hidden));
});

test("OFF, reactivation and explicit reopening replace the old popup deadline", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.clock.advance(2000);
  app.api.setEnabled(false);
  assert.equal(app.api.state().controlsOpen, false);
  app.clock.advance(500);
  app.api.setEnabled(true);
  app.clock.advance(500);
  assert.equal(app.api.state().controlsOpen, true, "the previous activation deadline must be cancelled");
  app.clock.advance(2499);
  assert.equal(app.api.state().controlsOpen, true);
  app.clock.advance(1);
  assert.equal(app.api.state().controlsOpen, false);
  app.api.toggleScaleControls();
  app.clock.advance(2000);
  app.api.toggleScaleControls();
  app.api.toggleScaleControls();
  app.clock.advance(1000);
  assert.equal(app.api.state().controlsOpen, true, "an old explicit-open timer must not close a later popup");
  app.clock.advance(2000);
  assert.equal(app.api.state().controlsOpen, false);
  assert.equal(app.calls.watches.length, 1);
});

test("outside pointer and Escape close the popup and keyboard focus pauses auto-hide", () => {
  const app = createRuntime();
  const panel = app.nodes.get("mapFieldModeControlsV1");
  const scaleButton = panel.querySelector('[data-field-mode-scale="20"]');
  const expander = app.document.querySelectorAll("[data-field-mode-expand]")
    .find((node) => node.getAttribute("aria-controls") === panel.getAttribute("id"));
  app.api.setEnabled(true);
  app.document.dispatchEvent({ type: "pointerdown", target: scaleButton });
  assert.equal(app.api.state().controlsOpen, true, "pressing inside the popup is not an outside click");
  app.document.dispatchEvent({ type: "pointerdown", target: app.document.body });
  assert.equal(app.api.state().controlsOpen, false);
  assert.equal(app.api.state().enabled, true);

  app.api.toggleScaleControls();
  scaleButton.focus();
  app.clock.advance(5000);
  assert.equal(app.api.state().controlsOpen, true, "focused scale buttons remain available to keyboard users");
  app.document.dispatchEvent({ type: "keydown", key: "Escape", target: scaleButton, preventDefault() {} });
  assert.equal(app.api.state().controlsOpen, false);
  assert.ok(app.document.activeElement === expander, "Escape returns popup focus to its scale expander");
  assert.equal(app.api.state().enabled, true);

  app.api.toggleScaleControls();
  scaleButton.focus();
  app.clock.advance(3500);
  app.document.body.focus();
  app.clock.advance(3000);
  assert.equal(app.api.state().controlsOpen, false, "leaving popup focus resumes auto-hide");
  app.api.toggleScaleControls();
  app.document.dispatchEvent({ type: "keydown", key: "Escape", target: app.document.body, preventDefault() {} });
  assert.ok(app.document.activeElement === app.document.body, "Escape outside the popup must not steal focus");
});

test("page suspension closes the scale popup and recovery or fresh GPS does not reopen it", () => {
  for (const lifecycle of ["visibility", "pagehide"]) {
    const app = createRuntime();
    app.api.setEnabled(true);
    app.clock.advance(1000);
    if (lifecycle === "visibility") app.visibility(true);
    else app.context.dispatchEvent({ type: "pagehide" });
    assert.equal(app.api.state().controlsOpen, false);
    app.clock.advance(1000);
    if (lifecycle === "visibility") app.visibility(false);
    else app.context.dispatchEvent({ type: "pageshow" });
    app.update(app.fix());
    assert.equal(app.api.state().controlsOpen, false);
    app.api.toggleScaleControls();
    app.clock.advance(1000);
    assert.equal(app.api.state().controlsOpen, true, "suspension cancels the original popup timer");
    app.clock.advance(2000);
    assert.equal(app.api.state().controlsOpen, false);
    assert.equal(app.api.state().enabled, true);
  }
});

test("desktop and compact controls expose the same enabled state, scale and live status", () => {
  const app = createRuntime();
  const toggles = app.document.querySelectorAll("[data-field-mode-toggle]");
  const controls = app.document.querySelectorAll("[data-field-mode-controls]");
  const statuses = app.document.querySelectorAll("[data-field-mode-status]");
  assert.equal(toggles.length, 2);
  assert.equal(controls.length, 2);
  assert.equal(statuses.length, 2);
  assert.ok(toggles.every((node) => node.getAttribute("aria-pressed") === "false"));
  assert.ok(controls.every((node) => node.hidden));
  app.api.setEnabled(true);
  app.update(app.fix());
  app.api.setScale(20);
  assert.ok(toggles.every((node) => node.getAttribute("aria-pressed") === "true"));
  assert.ok(controls.every((node) => node.hidden));
  assert.ok(app.document.querySelectorAll('[data-field-mode-scale="20"]').every((node) => node.getAttribute("aria-pressed") === "true"));
  assert.ok(app.document.querySelectorAll('[data-field-mode-scale="50"]').every((node) => node.getAttribute("aria-pressed") === "false"));
  app.api.onError({ code: 1 });
  assert.ok(statuses.every((node) => /권한|허용/.test(node.textContent)));
  assert.ok(controls.every((node) => node.hidden));
  assert.ok(app.calls.notifications.some((message) => /권한|허용/.test(message)),
    "permission feedback must be shown after mode turns itself off");
});

test("the existing location overlay switches to the field marker and restores its ordinary appearance", () => {
  const app = createRuntime();
  app.update(app.fix());
  const overlay = app.context.jsCurrentLocationOverlayV630;
  const ordinaryClass = overlay.content.className;
  const ordinaryMarkup = overlay.content.innerHTML;
  app.api.setEnabled(true);
  assert.equal(app.context.jsCurrentLocationOverlayV630, overlay, "mode must reuse the existing overlay");
  assert.notEqual(overlay.content.className + overlay.content.innerHTML, ordinaryClass + ordinaryMarkup);
  app.api.setEnabled(false);
  assert.equal(overlay.content.className, ordinaryClass);
  assert.equal(overlay.content.innerHTML, ordinaryMarkup);
});

test("field mode uses one simple navigation pointer with a neutral unknown-direction dot", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  const content = app.context.jsCurrentLocationOverlayV630.getContent();
  assert.match(content.innerHTML, /js-field-mode-navigation-icon-v1/);
  assert.match(content.innerHTML, /data-field-navigation-pointer/);
  assert.match(content.innerHTML, /data-field-navigation-pending/);
  assert.match(content.innerHTML, /방향 확인 중/);
  assert.equal((content.innerHTML.match(/<path\b/g) || []).length, 1);
  assert.doesNotMatch(content.innerHTML, /data-field-car-body|js-field-mode-direction-cue-v1|<rect\b/);
  assertHeading(app, null, "");
  app.clock.advance(1000);
  app.update(fieldFix(app, { heading: 90, speed: 2 }));
  assertHeading(app, 90, "gps");
  assert.equal(markerHeading(app), "90deg");
  app.api.setEnabled(false);
  assert.equal(content.innerHTML, "");
  assert.equal(markerHeading(app), "");
  assert.equal(app.calls.watches.length, 1);
});

test("deferred field mode adopts the existing marker, recent fix and shared watcher", () => {
  const app = createRuntime({ deferController: true });
  app.context.startCurrentLocationTrackingV630();
  app.calls.watches[0].success(app.fix());
  const overlay = app.context.jsCurrentLocationOverlayV630;
  const ordinaryAppearance = overlay.content.className + overlay.content.innerHTML;
  app.clock.advance(1000);
  app.loadController();
  app.api.setEnabled(true);
  assert.equal(app.context.jsCurrentLocationOverlayV630, overlay);
  assert.notEqual(overlay.content.className + overlay.content.innerHTML, ordinaryAppearance);
  assert.deepEqual(coordinatePair(app.map.center), [36.3504, 127.3845]);
  assert.equal(app.calls.watches.length, 1);
  assert.equal(app.calls.navigation.length, 1, "adoption is a display change and does not rewrite the GPS cache");
});

test("the essential map and location marker work when the optional controller is unavailable", () => {
  const app = createRuntime({ deferController: true });
  assert.equal(app.api, undefined);
  assert.doesNotThrow(() => app.context.startCurrentLocationTrackingV630());
  assert.doesNotThrow(() => app.calls.watches[0].success(app.fix()));
  assert.equal(app.calls.markers.length, 1);
  assert.equal(app.calls.navigation.length, 1);
  assert.equal(app.calls.centers.length, 0);
  assert.equal(app.context.jsCurrentLocationOverlayV630.map, app.map);
  assert.doesNotThrow(() => app.calls.watches[0].failure({ code: 1 }));
  const scriptTag = html.match(/<script\b[^>]*src="js\/map-field-mode-v1\.js[^>]*>/);
  assert.ok(scriptTag);
  assert.doesNotMatch(scriptTag[0], /data-auth-critical/, "an optional controller cannot prevent the authenticated map from loading");
});

test("invalid, stale and inaccurate fixes cannot move the marker or the follow center", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  for (const position of [
    null,
    {},
    app.fix(NaN),
    app.fix(91),
    app.fix(-91),
    app.fix(36, 181),
    app.fix(36, -181),
    app.fix(Infinity),
    app.fix(36, 127, 101),
    app.fix(36, 127, NaN),
    app.fix(36, 127, -1),
    app.fix(36, 127, 12, app.clock.now + 2000),
    app.fix(36, 127, 12, app.clock.now - 31000)
  ]) {
    assert.equal(app.api.onPosition(position), null);
  }
  assert.equal(app.calls.centers.length, 0);
  assert.equal(app.calls.markers.length, 0);
  app.update(app.fix());
  assert.equal(app.calls.centers.length, 1, "a valid fix can recover from rejected samples");
});

test("disabled mode preserves ordinary valid fixes without applying the follow accuracy threshold", () => {
  const app = createRuntime();
  const ordinary = app.fix(36.3504, 127.3845, 200);
  assert.equal(app.api.onPosition(ordinary), ordinary);
  assert.equal(app.api.onPosition(app.fix(91)), null);
  assert.equal(app.api.onPosition(app.fix("36.35")), null);
  assert.equal(app.calls.centers.length, 0);
});

test("direction starts unknown and native GPS course supports all cardinal directions including zero", () => {
  const app = createRuntime();
  assertHeading(app, null, "");
  app.api.setEnabled(true);
  app.update(fieldFix(app));
  const content = app.context.jsCurrentLocationOverlayV630.getContent();
  assertHeading(app, null, "");
  assert.equal(content.classList.contains("js-field-mode-heading-known-v1"), false);
  assert.match(content.getAttribute("aria-label"), /방향 확인 중/);

  for (const heading of [0, 90, 180, 270]) {
    app.clock.advance(1000);
    app.update(fieldFix(app, { heading, speed: 0.8, accuracy: 35 }));
    assertHeading(app, heading, "gps");
    assert.equal(content.classList.contains("js-field-mode-heading-known-v1"), true);
    assert.doesNotMatch(content.getAttribute("aria-label"), /방향 확인 중/);
    assert.equal(markerHeading(app), `${heading}deg`);
  }
  assert.equal(app.calls.centers.length, 1, "course changes at one coordinate do not move the camera");
  assert.equal(app.calls.markers.length, 1, "course changes reuse the existing marker content");
  assert.equal(app.calls.watches.length, 1);
});

test("native direction requires numeric finite course, movement speed and sufficiently accurate GPS", () => {
  const invalid = [
    ...[null, undefined, NaN, Infinity, -1, 360, 720, "90"].map((heading) => ({ heading, speed: 2 })),
    ...[null, undefined, NaN, Infinity, -1, "2", 0, 0.79, 61].map((speed) => ({ heading: 90, speed })),
    { heading: 90, speed: 2, accuracy: 35.01 },
    { heading: 90, speed: 2, accuracy: 100 }
  ];
  for (const motion of invalid) {
    const app = createRuntime();
    app.api.setEnabled(true);
    app.update(fieldFix(app, motion));
    assertHeading(app, null, "", `unreliable native course must remain unknown: ${String(motion.heading)}, ${String(motion.speed)}`);
    assert.equal(app.context.jsCurrentLocationOverlayV630.getContent().classList.contains("js-field-mode-heading-known-v1"), false);
  }
});

test("fresh native heading updates before tiny-position jitter and camera throttling return", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(fieldFix(app, { heading: 0, speed: 2 }));
  app.clock.advance(200);
  app.update(fieldFix(app, { east: 0.5, heading: 90, speed: 2 }));
  assertHeading(app, 90, "gps");
  assert.equal(markerHeading(app), "90deg");
  assert.equal(app.calls.centers.length, 1);
  assert.equal(app.calls.markers.length, 1);
  app.clock.advance(200);
  app.update(fieldFix(app, { east: 10, heading: 180, speed: 2 }));
  assertHeading(app, 180, "gps", "a queued camera position still supplies its fresh GPS course immediately");
  assert.equal(app.calls.centers.length, 1);
  app.clock.advance(600);
  assertHeading(app, 180, "gps");
  assert.equal(app.calls.centers.length, 2);
  assert.equal(app.calls.navigation.length, 3, "display replay must not add another GPS cache write");
});

test("movement direction accumulates subthreshold fixes independently of the displayed location", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(fieldFix(app));
  for (const north of [2, 4, 6]) {
    app.clock.advance(1000);
    app.update(fieldFix(app, { north, heading: null, speed: null }));
    assertHeading(app, null, "", "small GPS steps alone do not establish a reliable course");
  }
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 10, heading: NaN, speed: null }));
  assertHeading(app, 0, "movement");
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 10, east: 10 }));
  assertHeading(app, 90, "movement");
  app.clock.advance(1000);
  app.update(fieldFix(app, { east: 10 }));
  assertHeading(app, 180, "movement");
  app.clock.advance(1000);
  app.update(fieldFix(app));
  assertHeading(app, 270, "movement");
  app.clock.advance(1000);
  app.update(fieldFix(app, { heading: 270, speed: 2 }));
  assertHeading(app, 270, "gps", "native GPS can confirm the same direction without a visible turn");
  app.clock.advance(1000);
  app.update(fieldFix(app, { east: -10 }));
  assertHeading(app, 270, "movement", "the source updates even when fallback confirms the same direction");
});

test("movement direction must exceed combined endpoint accuracy", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(fieldFix(app, { accuracy: 10 }));
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 16, accuracy: 10 }));
  assertHeading(app, null, "", "16m displacement is uncertain when endpoint errors total 20m");
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 24, accuracy: 10 }));
  assertHeading(app, 0, "movement", "retaining the original baseline allows enough displacement to accumulate");
});

test("explicit stationary speed holds the last course and discards movement drift", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(fieldFix(app, { heading: 90, speed: 2 }));
  for (const [north, speed] of [[10, 0], [20, 0.4], [30, 0.79]]) {
    app.clock.advance(1000);
    app.update(fieldFix(app, { north, heading: 180, speed }));
    assertHeading(app, 90, "gps", "stationary drift must not alter the last reliable direction");
  }
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 32 }));
  assertHeading(app, 90, "gps", "resuming without native speed starts a new movement baseline");
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 34 }));
  assertHeading(app, 90, "gps");
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 44 }));
  assertHeading(app, 0, "movement");
});

test("invalid, coarse and implausible-speed fixes clear the movement baseline without erasing the last direction", () => {
  for (const invalid of ["coarse", "invalid coordinates", "invalid accuracy", "implausible speed"]) {
    const app = createRuntime();
    app.api.setEnabled(true);
    app.update(fieldFix(app, { heading: 90, speed: 2 }));
    app.clock.advance(1000);
    app.update(fieldFix(app, { north: 2 }));
    app.clock.advance(1000);
    const position = fieldFix(app, { north: 20, accuracy: invalid === "coarse" ? 36 : 4 });
    if (invalid === "invalid coordinates") position.coords.latitude = NaN;
    if (invalid === "invalid accuracy") position.coords.accuracy = NaN;
    if (invalid === "implausible speed") Object.assign(position.coords, { heading: 180, speed: 61 });
    app.update(position);
    assertHeading(app, 90, "gps", invalid);
    app.clock.advance(1000);
    app.update(fieldFix(app, { north: 24 }));
    assertHeading(app, 90, "gps", `a ${invalid} fix must not bridge the old movement baseline`);
    app.clock.advance(1000);
    app.update(fieldFix(app, { north: 36 }));
    assertHeading(app, 0, "movement");
  }
});

test("movement course rejects stale baselines and implausibly fast GPS jumps", () => {
  const gap = createRuntime();
  gap.api.setEnabled(true);
  gap.update(fieldFix(gap));
  gap.clock.advance(21000);
  gap.update(fieldFix(gap, { north: 10 }));
  assertHeading(gap, null, "", "movement older than 20 seconds cannot establish a course");
  gap.clock.advance(1000);
  gap.update(fieldFix(gap, { north: 20 }));
  assertHeading(gap, 0, "movement", "a fresh baseline recovers after an old gap");

  const teleport = createRuntime();
  teleport.api.setEnabled(true);
  teleport.update(fieldFix(teleport, { heading: 90, speed: 2 }));
  teleport.clock.advance(1000);
  teleport.update(fieldFix(teleport, { north: 200 }));
  assertHeading(teleport, 90, "gps", "an inferred speed over 60m/s must not become a direction");
});

test("direction rejects duplicate and older raw timestamps even before marker acceptance", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(fieldFix(app, { heading: 10, speed: 2 }));
  app.clock.advance(200);
  const latest = fieldFix(app, { east: 0.5, heading: 20, speed: 2 });
  app.update(latest);
  app.update(fieldFix(app, { east: 1, heading: 180, speed: 2, timestamp: latest.timestamp }));
  app.update(fieldFix(app, { east: 1, heading: 270, speed: 2, timestamp: latest.timestamp - 100 }));
  assertHeading(app, 20, "gps");
  assert.equal(markerHeading(app), "20deg");
  assert.equal(app.calls.centers.length, 1);

  app.clock.advance(200);
  app.update(fieldFix(app, { north: 10, heading: 30, speed: 2 }));
  app.clock.advance(200);
  app.update(fieldFix(app, { north: 20, heading: 270, speed: 2, accuracy: 80 }));
  assertHeading(app, 30, "gps");
  app.clock.advance(400);
  assertHeading(app, 30, "gps", "a delayed marker replay cannot overwrite the newer raw heading state");
  assert.equal(markerHeading(app), "30deg");
  app.clock.advance(100);
  app.update(fieldFix(app, { north: 30 }));
  assertHeading(app, 30, "gps", "replaying an older fix must not rebuild the baseline cleared by a newer coarse fix");
});

test("zero-time and out-of-order movement fixes cannot seed or rotate the fallback course", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  const first = fieldFix(app);
  app.update(first);
  app.update(fieldFix(app, { east: 20, timestamp: first.timestamp }));
  assertHeading(app, null, "");
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 10 }));
  assertHeading(app, 0, "movement", "the original baseline survives a duplicate timestamp");
  app.update(fieldFix(app, { east: 20, timestamp: first.timestamp + 500 }));
  assertHeading(app, 0, "movement");
  app.clock.advance(1000);
  app.update(fieldFix(app, { north: 20 }));
  assertHeading(app, 0, "movement", "an out-of-order point must not replace the movement baseline");
});

test("heading crosses north by the shortest turn while public direction remains normalized", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(fieldFix(app, { heading: 359, speed: 2 }));
  const content = app.context.jsCurrentLocationOverlayV630.getContent();
  assert.equal(markerHeading(app), "359deg", "the first reliable direction is placed without accumulating a turn from north");
  assert.equal(content.classList.contains("js-field-mode-heading-turn-v1"), false, "the first course must not animate from north");
  app.clock.advance(1000);
  app.update(fieldFix(app, { heading: 1, speed: 2 }));
  assertHeading(app, 1, "gps");
  assert.equal(markerHeading(app), "361deg");
  assert.equal(content.classList.contains("js-field-mode-heading-turn-v1"), true, "later direction changes may animate their short turn");
  app.clock.advance(1000);
  app.update(fieldFix(app, { heading: 359, speed: 2 }));
  assertHeading(app, 359, "gps");
  assert.equal(markerHeading(app), "359deg");
});

test("OFF, suspension, GPS errors and expiry reset direction, baseline and accumulated rotation", () => {
  for (const lifecycle of ["off", "visibility", "pagehide", "denied", "unavailable", "timeout", "expiry"]) {
    const app = createRuntime();
    app.api.setEnabled(true);
    app.update(fieldFix(app, { heading: 359, speed: 2 }));
    app.clock.advance(1000);
    app.update(fieldFix(app, { heading: 1, speed: 2 }));
    assert.equal(markerHeading(app), "361deg");
    if (lifecycle === "off") app.api.setEnabled(false);
    else if (lifecycle === "visibility") app.visibility(true);
    else if (lifecycle === "pagehide") app.context.dispatchEvent({ type: "pagehide" });
    else if (lifecycle === "expiry") app.clock.advance(31000);
    else app.api.onError({ code: { denied: 1, unavailable: 2, timeout: 3 }[lifecycle] });
    assertHeading(app, null, "", lifecycle);
    const content = app.context.jsCurrentLocationOverlayV630.getContent();
    assert.equal(content.classList.contains("js-field-mode-heading-known-v1"), false, lifecycle);
    assert.equal(content.classList.contains("js-field-mode-heading-turn-v1"), false, lifecycle);
    assert.equal(markerHeading(app), app.api.state().enabled ? "0deg" : "", lifecycle);
    if (app.api.state().enabled) assert.match(content.getAttribute("aria-label"), /방향 확인 중/, lifecycle);
    if (lifecycle === "visibility") app.visibility(false);
    if (lifecycle === "pagehide") app.context.dispatchEvent({ type: "pageshow" });
    app.clock.advance(9000);
    if (!app.api.state().enabled) app.api.setEnabled(true);
    app.update(fieldFix(app, { north: 30 }));
    assertHeading(app, null, "", `${lifecycle} must discard the earlier movement baseline`);
    app.clock.advance(1000);
    app.update(fieldFix(app, { north: 30, heading: 270, speed: 2 }));
    assertHeading(app, 270, "gps", `${lifecycle} must accept a new course after recovery`);
    assert.equal(markerHeading(app), "270deg", `${lifecycle} must not retain the previous accumulated turn`);
    assert.equal(app.calls.watches.length, 1, `${lifecycle} must reuse the shared watcher`);
  }
});

test("jitter below 3m keeps the marker and center together while navigation gets the raw fix", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  const firstCenter = coordinatePair(app.map.center);
  app.clock.advance(1100);
  const jitter = app.fix(36.35041, 127.3845);
  app.update(jitter);
  app.clock.advance(1500);
  assert.equal(app.calls.centers.length, 1);
  assert.equal(app.calls.markers.length, 1);
  assert.deepEqual(coordinatePair(app.map.center), firstCenter);
  assert.equal(app.calls.navigation.at(-1), jitter, "navigation retains the freshest raw GPS sample");
  app.update(app.fix(36.3505, 127.3845));
  assert.equal(app.calls.centers.length, 2);
  assert.equal(app.calls.markers.length, 2);
  assert.deepEqual(coordinatePair(app.calls.markers.at(-1)), coordinatePair(app.map.center));
});

test("rapid GPS updates render at most once per second and retain the newest trailing fix", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  app.update(app.fix(36.3505));
  app.clock.advance(200);
  app.update(app.fix(36.3506));
  assert.equal(app.calls.centers.length, 1);
  assert.equal(app.calls.markers.length, 1);
  app.clock.advance(700);
  assert.equal(app.calls.centers.length, 2);
  assert.equal(app.calls.markers.length, 2);
  assert.deepEqual(coordinatePair(app.map.center), [36.3506, 127.3845]);
  assert.deepEqual(coordinatePair(app.calls.markers.at(-1)), coordinatePair(app.map.center));
  app.clock.advance(2000);
  assert.equal(app.calls.centers.length, 2, "a pending fix must be delivered once");
});

test("displaying a delayed fix does not roll the navigation cache back from a newer raw sample", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  app.update(app.fix(36.3505));
  app.clock.advance(200);
  const latestRaw = app.fix(36.3506, 127.3845, 200);
  app.update(latestRaw);
  assert.equal(app.calls.navigation.at(-1), latestRaw);
  app.clock.advance(1000);
  assert.deepEqual(coordinatePair(app.map.center), [36.3505, 127.3845]);
  assert.equal(app.calls.navigation.at(-1), latestRaw);
  assert.equal(app.calls.navigation.length, 3, "internal display replay must not write the GPS cache again");
});

test("older samples cannot replace a newer pending fix or move the accepted marker backward", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  const older = app.fix(36.3505);
  app.clock.advance(200);
  app.update(app.fix(36.3506));
  app.update(older);
  app.clock.advance(700);
  assert.deepEqual(coordinatePair(app.map.center), [36.3506, 127.3845]);
  app.clock.advance(1100);
  app.update(older);
  assert.equal(app.calls.centers.length, 2);
  assert.equal(app.calls.markers.length, 2);
});

test("a fresh fix returning to the accepted point cancels a queued GPS jump", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  app.update(app.fix(36.3506));
  app.clock.advance(200);
  app.update(app.fix(36.35041));
  app.clock.advance(2000);
  assert.equal(app.calls.centers.length, 1);
  assert.equal(app.calls.markers.length, 1);
});

test("camera changes while following return to the accepted location and selected scale", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.map.setCenter(new app.context.kakao.maps.LatLng(36.4, 127.4));
  app.map.setLevel(6);
  app.fireMap("center_changed");
  app.fireMap("zoom_changed");
  app.clock.advance(0);
  assert.deepEqual(coordinatePair(app.map.center), [36.3504, 127.3845]);
  assert.equal(app.map.level, 3);
  assert.equal(app.context.favoriteOnly, true);
  assert.deepEqual(app.context.favoriteKeys, ["property:keep"]);
  assert.equal(app.context.activeFavoriteFolderId, "folder-keep");
  assert.equal(app.context.selectedItemKey, "listing-keep");
  app.api.setEnabled(false);
  app.map.setCenter(new app.context.kakao.maps.LatLng(36.4, 127.4));
  app.fireMap("center_changed");
  app.clock.advance(0);
  assert.deepEqual(coordinatePair(app.map.center), [36.4, 127.4]);
});

test("following preserves an offscreen pinned cluster through camera zoom and visibility recovery", () => {
  const snapshot = { selectedItemIdentity: "property:keep", singleItemIds: ["property:keep"] };
  const pin = { snapshot, spatialKey: "selected-viewport" };
  const app = createIdleRuntime(pin);
  app.context.viewport = "zoomed-follow-viewport";
  app.context.keepPinnedClusterSelectionAcrossTransientUiV6525(1800);
  assert.equal(app.context.shouldClearPinnedClusterForMapNavigationV6525(), false);
  assert.equal(pin.snapshot, snapshot);
  assert.equal(pin.spatialKey, "zoomed-follow-viewport");
  assert.ok(app.context.jsPinnedClusterSpatialChangeIgnoreUntilV6517 > app.clock.now);
  app.context.scheduleMapIdleRefreshV638();
  app.clock.advance(1000);
  assert.equal(app.calls.lists.length, 0, "offscreen map clusters must not replace the selected listing panel");
  app.visibility(true);
  app.clock.advance(200);
  app.context.viewport = "resumed-follow-viewport";
  app.visibility(false);
  app.clock.advance(120);
  assert.equal(app.calls.captures, 0, "empty offscreen overlays must not overwrite the remembered selection");
  assert.equal(pin.snapshot, snapshot);
  assert.equal(pin.spatialKey, "resumed-follow-viewport");
  assert.equal(app.calls.restored.at(-1), snapshot);
  assert.deepEqual(app.calls.lists.at(-1), ["listing-keep"]);
  app.context.following = false;
  app.context.keepPinnedClusterSelectionAcrossTransientUiV6525(1200);
  assert.equal(app.calls.captures, 1, "ordinary map interaction still captures a new selection snapshot");
});

test("GPS idle refresh is bounded without starvation and hidden refresh resumes even without a pin", () => {
  const app = createIdleRuntime();
  const startedAt = app.clock.now;
  app.context.scheduleMapIdleRefreshV638();
  for (let index = 1; index <= 4; index += 1) {
    app.clock.advance(200);
    app.context.viewport = "moving-" + index;
    app.context.scheduleMapIdleRefreshV638();
  }
  assert.equal(app.calls.draws.length, 0);
  app.clock.advance(200);
  assert.deepEqual(app.calls.draws, [{ at: startedAt + 1000, keys: ["moving-4"] }],
    "frequent GPS idle events must not continually postpone the first refresh");
  app.context.viewport = "before-hidden";
  app.context.scheduleMapIdleRefreshV638();
  app.clock.advance(200);
  app.visibility(true);
  app.clock.advance(1000);
  assert.equal(app.calls.draws.length, 1);
  assert.equal(app.calls.lists.length, 1);
  assert.equal(app.context.jsFieldModeIdleRefreshPendingV1, true);
  app.clock.advance(5000);
  app.context.viewport = "after-hidden";
  const resumedAt = app.clock.now;
  app.visibility(false);
  for (let index = 1; index <= 4; index += 1) {
    app.clock.advance(200);
    app.context.viewport = "resumed-" + index;
    app.context.scheduleMapIdleRefreshV638();
  }
  app.clock.advance(200);
  assert.equal(app.calls.draws.length, 2);
  assert.deepEqual(app.calls.draws.at(-1), { at: resumedAt + 1000, keys: ["resumed-4"] });
  assert.deepEqual(app.calls.lists.at(-1), ["resumed-4"]);
  assert.equal(app.context.jsFieldModeIdleRefreshPendingV1, false);
  app.clock.advance(2000);
  assert.equal(app.calls.draws.length, 2, "resuming schedules only one refresh for the latest viewport");
});

test("hiding the page cancels queued movement and resuming waits for fresh GPS", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  app.update(app.fix(36.3505));
  app.visibility(true);
  app.clock.advance(2000);
  const hiddenFix = app.fix(36.3506);
  app.update(hiddenFix);
  app.clock.advance(1500);
  assert.equal(app.calls.centers.length, 1);
  assert.equal(app.calls.markers.length, 1);
  app.visibility(false);
  app.clock.advance(1000);
  assert.equal(app.calls.centers.length, 1, "visibility alone must not replay an old coordinate");
  app.update(hiddenFix);
  assert.equal(app.calls.centers.length, 1, "a pre-resume cached fix is still stale for following");
  app.update(app.fix(36.3507));
  assert.equal(app.calls.centers.length, 2);
  assert.deepEqual(coordinatePair(app.calls.markers.at(-1)), coordinatePair(app.map.center));
});

test("pagehide also cancels trailing updates until pageshow and a fresh fix", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  app.update(app.fix(36.3505));
  app.context.dispatchEvent({ type: "pagehide" });
  app.clock.advance(2000);
  app.update(app.fix(36.3506));
  assert.equal(app.calls.centers.length, 1);
  app.context.dispatchEvent({ type: "pageshow" });
  assert.equal(app.calls.centers.length, 1);
  app.clock.advance(1000);
  app.update(app.fix(36.3507));
  assert.equal(app.calls.centers.length, 2);
});

test("turning mode off cancels queued following and restores prior map interaction settings", () => {
  for (const initial of [{ draggable: true, zoomable: true }, { draggable: false, zoomable: true }, { draggable: true, zoomable: false }]) {
    const app = createRuntime(initial);
    app.api.setEnabled(true);
    app.update(app.fix());
    assert.equal(app.map.draggable, false);
    assert.equal(app.map.zoomable, false);
    app.clock.advance(200);
    app.update(app.fix(36.3505));
    app.api.setEnabled(false);
    app.clock.advance(2000);
    assert.equal(app.api.state().enabled, false);
    assert.equal(app.api.isFollowing(), false);
    assert.equal(app.map.draggable, initial.draggable);
    assert.equal(app.map.zoomable, initial.zoomable);
    assert.equal(app.calls.centers.length, 1);
    app.update(app.fix(36.3506));
    assert.equal(app.calls.centers.length, 1, "normal marker updates must no longer recenter the map");
    assert.deepEqual(coordinatePair(app.calls.markers.at(-1)), [36.3506, 127.3845]);
  }
});

test("map tools can stop following without resetting favorites or the selected listing", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.api.stopForMapTool();
  assert.equal(app.api.isFollowing(), false);
  assert.equal(app.map.draggable, true);
  assert.equal(app.map.zoomable, true);
  assert.equal(app.context.favoriteOnly, true);
  assert.deepEqual(app.context.favoriteKeys, ["property:keep"]);
  assert.equal(app.context.activeFavoriteFolderId, "folder-keep");
  assert.equal(app.context.selectedItemKey, "listing-keep");
});

test("permission errors disable following and show a Korean explanation", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.api.onError({ code: 1, message: "denied" });
  assert.equal(app.api.state().enabled, false);
  assert.equal(app.api.isFollowing(), false);
  assert.equal(app.map.draggable, true);
  assert.equal(app.map.zoomable, true);
  assert.match(app.api.state().status, /권한|허용/);
});

test("unavailable GPS and timeouts explain the condition and recover with a valid fix", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  for (const code of [2, 3]) {
    app.api.onError({ code });
    assert.match(app.api.state().status, /[가-힣]/);
  }
  app.update(app.fix());
  assert.equal(app.api.isFollowing(), true);
  assert.equal(app.calls.centers.length, 1);
});

test("temporary GPS failure discards queued movement and waits for a post-error fix", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  app.clock.advance(200);
  const beforeError = app.fix(36.3505);
  app.update(beforeError);
  app.clock.advance(200);
  app.api.onError({ code: 2 });
  app.clock.advance(1000);
  app.update(beforeError);
  assert.equal(app.calls.centers.length, 1);
  assert.equal(app.calls.markers.length, 1);
  app.update(app.fix(36.3506));
  assert.equal(app.calls.centers.length, 2);
  assert.equal(app.calls.markers.length, 2);
});

test("a silent GPS watcher expires the displayed fix and resumes only on a fresh sample", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  const initial = app.fix();
  app.update(initial);
  const overlay = app.context.jsCurrentLocationOverlayV630;
  assert.equal(overlay.map, app.map);
  app.clock.advance(31000);
  assert.equal(app.api.state().enabled, true);
  assert.equal(overlay.map, null, "an expired GPS sample must not remain visible as a live car");
  assert.match(app.api.state().status, /위치.*확인|위치.*대기/);
  app.update(initial);
  assert.equal(overlay.map, null);
  app.map.setCenter(new app.context.kakao.maps.LatLng(36.4, 127.4));
  app.fireMap("center_changed");
  app.clock.advance(0);
  assert.deepEqual(coordinatePair(app.map.center), [36.4, 127.4], "expired coordinates cannot force the camera back");
  app.update(app.fix(36.3506));
  assert.equal(overlay.map, app.map);
  assert.deepEqual(coordinatePair(app.map.center), [36.3506, 127.3845]);
});

test("fresh stationary GPS refreshes expiry even when jitter suppression avoids a repaint", () => {
  const app = createRuntime();
  app.api.setEnabled(true);
  app.update(app.fix());
  const overlay = app.context.jsCurrentLocationOverlayV630;
  app.clock.advance(25000);
  app.update(app.fix(36.350401));
  app.clock.advance(6000);
  assert.equal(overlay.map, app.map, "stationary fresh GPS must keep the marker live");
  assert.equal(app.calls.markers.length, 1);
  assert.equal(app.calls.centers.length, 1);
  app.clock.advance(25000);
  assert.equal(overlay.map, null, "expiry follows the last fresh stationary sample");
});

test("synchronous geolocation startup failures reach the same visible error path", () => {
  const app = createRuntime({ watchError: { code: 2 } });
  assert.doesNotThrow(() => app.api.setEnabled(true));
  assert.match(app.api.state().status, /위치.*대기|위치.*확인/);
  assert.equal(app.calls.centers.length, 0);
  assert.equal(app.calls.markers.length, 0);
});

test("missing map or geolocation fails safely without starting another watcher", () => {
  for (const options of [{ map: false }, { geolocation: false }]) {
    const app = createRuntime(options);
    assert.doesNotThrow(() => app.api.setEnabled(true));
    assert.equal(app.api.isFollowing(), false);
    assert.match(app.api.state().status, /[가-힣]/);
    assert.equal(app.calls.watches.length, 0);
    assert.equal(app.calls.centers.length, 0);
  }
});

test("existing location tracking remains the only watcher and forwards its failures", () => {
  const app = createRuntime();
  app.context.startCurrentLocationTrackingV630();
  app.context.startCurrentLocationTrackingV630();
  app.api.setEnabled(true);
  app.api.setEnabled(false);
  app.api.setEnabled(true);
  assert.equal(app.calls.watches.length, 1);
  assert.equal(app.calls.clearedWatches.length, 0, "ordinary mode toggles must retain the shared watcher");
  assert.equal(app.calls.watches[0].settings.enableHighAccuracy, true);
  app.calls.watches[0].success(app.fix());
  assert.equal(app.calls.markers.length, 1);
  assert.equal(app.calls.centers.length, 1);
  app.calls.watches[0].failure({ code: 1 });
  assert.equal(app.api.state().enabled, false);
  assert.match(app.api.state().status, /권한|허용/);
  assert.deepEqual(app.calls.clearedWatches, [17], "a denied shared watcher is cleared so permission changes can be retried");
  app.api.setEnabled(true);
  assert.equal(app.calls.watches.length, 2, "re-enabling after permission changes starts one replacement watcher");
  app.api.setEnabled(true);
  app.context.startCurrentLocationTrackingV630();
  assert.equal(app.calls.watches.length, 2, "the replacement watcher is reused too");
});

test("integration loads field mode once and leaves listing, favorite and navigation stores alone", () => {
  assert.equal((html.match(/src="js\/map-field-mode-v1\.js(?:\?[^"\s]*)?"/g) || []).length, 1);
  assert.equal((mapSource.match(/\.watchPosition\s*\(/g) || []).length, 1);
  assert.doesNotMatch(source, /\.(?:watchPosition|getCurrentPosition)\s*\(/);
  assert.doesNotMatch(source, /\b(?:fetch|loadSheet|applyFilter|resetFilter|showList|resetToDaejeonOverviewV6524)\s*\(/);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|removeItem|clear)\s*\(/);
  assert.doesNotMatch(source, /\b(?:favoriteKeys|favoriteOnly|activeFavoriteFolderId|selectedItemKey|allItems|visibleListItems)\s*=/);
  const overlay = functionSource(mapSource, "updateCurrentLocationOverlayV630");
  assert.match(overlay, /JSKakaoNavigation\.rememberPosition\(position\)/);
  assert.match(overlay, /JSFieldModeV1\.onPosition\(/);
  assert.ok(overlay.indexOf("JSKakaoNavigation.rememberPosition") < overlay.indexOf("JSFieldModeV1.onPosition"),
    "navigation receives live coordinates before display-only filtering");
  assert.match(overlay, /JSFieldModeV1\.decorateMarker\(/);
  assert.match(functionSource(mapSource, "startCurrentLocationTrackingV630"), /JSFieldModeV1\.onError\(/);
});
