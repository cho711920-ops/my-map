import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/phone-device-v1.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../js/phone-app-v2.js", import.meta.url), "utf8");
const androidPhone = "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
function load(overrides = {}) {
  const classes = new Set();
  const attrs = new Map();
  const events = [];
  const listeners = {};
  const window = {
    navigator: {userAgent: androidPhone, maxTouchPoints: 5, userAgentData: {mobile: true}},
    screen: {width: 390, height: 844, orientation: {type: "portrait-primary", addEventListener() {}}},
    innerWidth: 390, innerHeight: 760,
    matchMedia: () => ({matches: true}),
    addEventListener: (name, callback) => {listeners[name] = callback;},
    dispatchEvent: (event) => events.push(event),
    ...overrides
  };
  const document = {documentElement: {
    classList: {toggle(name, active) {if (active) classes.add(name); else classes.delete(name);}},
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name)
  }};
  vm.runInNewContext(source, {window, document, CustomEvent: function(type, init) {this.type = type; this.detail = init.detail;}});
  return {window, device: window.JSPhoneDeviceV1, classes, attrs, events, listeners};
}

test("390px smartphone is explicitly opted in without changing app views", () => {
  const fixture = load();
  assert.equal(fixture.device.isPhone(), true);
  assert.equal(fixture.device.isHandheld(), true);
  assert.equal(fixture.device.isMobileLayout(), true);
  assert.equal(fixture.device.isLandscape(), false);
  assert.ok(fixture.classes.has("js-phone-app-v2"));
  assert.equal(fixture.attrs.has("data-js-phone-landscape"), false);
  assert.equal(fixture.events[0].type, "js-phone-device-change");
  assert.deepEqual({...fixture.events[0].detail}, {phone: true, landscape: false, handheld: true, mobileLayout: true});
  assert.doesNotMatch(source, /js-mobile-view|applyFilter|setView\(/);
});

test("same smartphone remains a phone after rotation and clears landscape on return", () => {
  const fixture = load();
  fixture.window.screen.width = 844;
  fixture.window.screen.height = 390;
  fixture.window.screen.orientation.type = "landscape-primary";
  fixture.window.innerWidth = 844;
  fixture.listeners.orientationchange();
  assert.equal(fixture.device.isPhone(), true);
  assert.equal(fixture.device.isHandheld(), true);
  assert.equal(fixture.device.isMobileLayout(), false);
  assert.equal(fixture.classes.has("js-phone-app-v2"), false);
  assert.equal(fixture.classes.has("js-handheld-landscape-v1"), true);
  assert.equal(fixture.attrs.get("data-js-phone-landscape"), "true");
  assert.deepEqual({...fixture.events[1].detail}, {phone: true, landscape: true, handheld: true, mobileLayout: false});
  fixture.window.screen.width = 390;
  fixture.window.screen.height = 844;
  fixture.window.screen.orientation.type = "portrait-primary";
  fixture.listeners.orientationchange();
  assert.equal(fixture.attrs.has("data-js-phone-landscape"), false);
  assert.equal(fixture.classes.has("js-phone-app-v2"), true);
  assert.equal(fixture.classes.has("js-handheld-landscape-v1"), false);
  assert.equal(fixture.events.length, 3);
});

test("portrait keyboard shrink and unchanged resizes never signal landscape or discard state", () => {
  const fixture = load();
  fixture.window.innerHeight = 240;
  fixture.listeners.resize();
  fixture.listeners.resize();
  assert.equal(fixture.device.isLandscape(), false);
  assert.equal(fixture.device.isMobileLayout(), true);
  assert.ok(fixture.classes.has("js-phone-app-v2"));
  assert.equal(fixture.events.length, 1, "no redundant state event for a keyboard resize");
});

test("iPhone and iOS legacy angle use screen orientation, never the keyboard viewport", () => {
  const fixture = load({navigator: {userAgent: iphone, maxTouchPoints: 5}, screen: {width: 390, height: 844}, orientation: 0});
  fixture.window.innerHeight = 200;
  assert.equal(fixture.device.isLandscape(), false);
  fixture.window.orientation = -90;
  assert.equal(fixture.device.isLandscape(), true);
  fixture.device.sync();
  assert.equal(fixture.attrs.get("data-js-phone-landscape"), "true");
});

test("physical-screen fallback still ignores viewport dimensions", () => {
  const fixture = load({screen: {width: 844, height: 390}, innerWidth: 390, innerHeight: 900});
  assert.equal(fixture.device.isLandscape(), true);
});

for (const [name, settings] of [
  ["768px iPad", {navigator: {userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148", maxTouchPoints: 5}, screen: {width: 768, height: 1024}}],
  ["iPad desktop agent in 600px split screen", {navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5}, screen: {width: 820, height: 1180}, innerWidth: 600}],
  ["Android tablet in 600px split screen", {navigator: {userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/131.0 Safari/537.36", maxTouchPoints: 5, userAgentData: {mobile: false}}, screen: {width: 800, height: 1280}, innerWidth: 600}],
  ["tablet with mobile UA but wide physical display", {navigator: {userAgent: androidPhone, maxTouchPoints: 5, userAgentData: {mobile: true}}, screen: {width: 768, height: 1024}, innerWidth: 390}],
  ["small Android tablet without Mobile token", {navigator: {userAgent: "Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/131.0 Safari/537.36", maxTouchPoints: 5}}],
  ["Android tablet without a model token", {navigator: {userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Safari/537.36", maxTouchPoints: 5, userAgentData: {mobile: false}}, screen: {width: 800, height: 1280}}],
  ["Kindle tablet", {navigator: {userAgent: "Mozilla/5.0 Silk/80.0 Kindle", maxTouchPoints: 5}, screen: {width: 800, height: 1280}}]
]) {
  test(`${name} uses the portrait mobile layout without becoming a phone`, () => {
    const fixture = load(settings);
    assert.equal(fixture.device.isPhone(), false);
    assert.equal(fixture.device.isHandheld(), true);
    assert.equal(fixture.device.isMobileLayout(), true);
    assert.equal(fixture.device.isLandscape(), false);
    assert.equal(fixture.classes.has("js-phone-app-v2"), true);
    assert.deepEqual({...fixture.events[0].detail}, {phone: false, landscape: false, handheld: true, mobileLayout: true});

    fixture.window.innerHeight = 200;
    fixture.listeners.resize();
    assert.equal(fixture.device.isMobileLayout(), true, "software keyboard never switches to the PC layout");
    assert.equal(fixture.events.length, 1);

    fixture.window.screen.orientation = {type: "landscape-secondary"};
    fixture.listeners.orientationchange();
    assert.equal(fixture.device.isPhone(), false);
    assert.equal(fixture.device.isMobileLayout(), false);
    assert.equal(fixture.classes.has("js-phone-app-v2"), false);
    assert.equal(fixture.classes.has("js-handheld-landscape-v1"), true);
    assert.deepEqual({...fixture.events[1].detail}, {phone: false, landscape: true, handheld: true, mobileLayout: false});

    fixture.window.screen.orientation.type = "portrait-secondary";
    fixture.listeners.orientationchange();
    assert.equal(fixture.device.isMobileLayout(), true);
    assert.equal(fixture.classes.has("js-handheld-landscape-v1"), false);
    assert.equal(fixture.events.length, 3);
  });
}

for (const [name, settings] of [
  ["narrowed desktop", {navigator: {userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0", maxTouchPoints: 0, userAgentData: {mobile: false}}, screen: {width: 1920, height: 1080}, innerWidth: 390, matchMedia: () => ({matches: false})}],
  ["touch laptop with narrow reported display", {navigator: {userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0", maxTouchPoints: 10, userAgentData: {mobile: false}}}],
  ["Windows laptop with an inconsistent mobile hint", {navigator: {userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0", maxTouchPoints: 10, userAgentData: {mobile: true}}}],
  ["Mac desktop", {navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0}}],
  ["Mac desktop with one pointer", {navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 1}}],
  ["full desktop Linux agent on an unknown touch device", {navigator: {userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0 Safari/537.36", maxTouchPoints: 5}}],
  ["unknown touch device", {navigator: {userAgent: "Unknown Browser", maxTouchPoints: 5}}],
  ["unknown screen size", {screen: {width: 0, height: 0}}]
]) {
  test(`${name} retains the existing UI`, () => {
    const fixture = load(settings);
    assert.equal(fixture.device.isPhone(), false);
    assert.equal(fixture.device.isHandheld(), false);
    assert.equal(fixture.device.isMobileLayout(), false);
    assert.equal(fixture.device.isLandscape(), false);
    assert.equal(fixture.classes.has("js-phone-app-v2"), false);
    assert.equal(fixture.classes.has("js-handheld-landscape-v1"), false);
    assert.equal(fixture.attrs.has("data-js-phone-landscape"), false);
    fixture.classes.add("existing-desktop-layout");
    fixture.window.screen.orientation = {type: "landscape-primary"};
    fixture.window.innerWidth = 280;
    fixture.window.innerHeight = 180;
    fixture.listeners.resize();
    assert.deepEqual([...fixture.classes], ["existing-desktop-layout"]);
    assert.equal(fixture.events.length, 1, "desktop viewport or physical orientation changes do not switch layouts");
  });
}

test("positive mobile client hint requires touch evidence", () => {
  assert.equal(load({navigator: {userAgent: "Reduced Browser", userAgentData: {mobile: true}, maxTouchPoints: 5}}).device.isPhone(), true);
  assert.equal(load({navigator: {userAgent: "Reduced Browser", userAgentData: {mobile: true}, maxTouchPoints: 0}, matchMedia: () => ({matches: false})}).device.isPhone(), false);
});

test("tablet ScreenOrientation wins over legacy angle, screen shape, and viewport", () => {
  const fixture = load({
    navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5},
    screen: {width: 1180, height: 820, orientation: {type: "portrait-primary"}},
    orientation: 90, innerWidth: 1180, innerHeight: 200
  });
  assert.equal(fixture.device.isMobileLayout(), true);
  fixture.window.screen.orientation.type = "landscape-primary";
  fixture.window.orientation = 0;
  assert.equal(fixture.device.isLandscape(), true);
  delete fixture.window.screen.orientation;
  assert.equal(fixture.device.isLandscape(), false, "legacy angle takes priority over screen shape");
  delete fixture.window.orientation;
  assert.equal(fixture.device.isLandscape(), true, "physical screen is the final fallback");
});

function loadApp(initialMobileLayout = true) {
  const elements = new Map();
  const styles = new Map();
  const callbacks = new Map();
  let mobileLayout = initialMobileLayout;
  let blurCount = 0;
  let focusCount = 0;
  let inertWrites = 0;
  function element(tagName = "DIV", id = "") {
    const attributes = new Map();
    const classes = new Set();
    let inert = false;
    const node = {
      id, tagName, children: [], hidden: false, textContent: "", value: "", dataset: {}, listeners: {},
      classList: {toggle(name, active) {if (active) classes.add(name); else classes.delete(name);}},
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name) ?? null,
      hasAttribute: (name) => attributes.has(name),
      addEventListener(name, callback) {this.listeners[name] = callback;},
      appendChild(child) {this.children.push(child); elements.set(child.id, child);},
      insertBefore(child) {this.children.unshift(child); elements.set(child.id, child);},
      replaceChildren() {this.children.length = 0;},
      querySelectorAll() {return [];},
      getBoundingClientRect() {return {height: 112.2};},
      blur() {blurCount++;}, focus() {focusCount++;}
    };
    Object.defineProperty(node, "inert", {get: () => inert, set(value) {inertWrites++; inert = value;}});
    if (id) elements.set(id, node);
    return node;
  }
  const root = element("HTML");
  root.style = {setProperty: (name, value) => styles.set(name, value), removeProperty: (name) => styles.delete(name)};
  root.setAttribute("data-jsm-mobile-view", "list");
  const body = element("BODY");
  const app = element("DIV", "jsMobileAppV1");
  const header = element("HEADER");
  app.querySelector = () => header;
  const form = element("FORM", "jsMobileSearchFormV1");
  const input = element("INPUT", "jsMobileKeywordV1");
  input.value = "유지할 검색어";
  const detail = element("DIV", "detail");
  detail.textContent = "선택한 매물 상세";
  detail.hidden = false;
  element("DIV", "listToolbar");
  const list = element("DIV", "list");
  list.setAttribute("data-total-count", "7");
  body.appendChild(app);
  body.appendChild(detail);
  const document = {documentElement: root, body, readyState: "complete", activeElement: input,
    getElementById: (id) => elements.get(id) || null, createElement: (tag) => element(tag.toUpperCase())};
  const window = {
    JSPhoneDeviceV1: {isMobileLayout: () => mobileLayout, isPhone() {throw new Error("physical phone API is not a layout gate");}},
    addEventListener(name, callback) {callbacks.set(name, callback);},
    requestAnimationFrame(callback) {callback();},
    ResizeObserver: class {constructor(callback) {callbacks.set("headerResize", callback);} observe() {}},
    getActiveFilterChipsV844: () => [{key: "test", label: "검색 필터"}]
  };
  vm.runInNewContext(appSource, {window, document, MutationObserver: class {observe() {}}});
  return {window, document, root, styles, form, input, detail, elements, callbacks,
    setMobileLayout(value) {mobileLayout = value; callbacks.get("js-phone-device-change")();},
    counters: () => ({blurCount, focusCount, inertWrites})};
}

test("portrait presentation activates for tablets through the layout API", () => {
  const fixture = loadApp();
  assert.equal(fixture.styles.get("--js-phone-header-height"), "113px");
  assert.equal(fixture.elements.get("jsPhoneListCountV2").textContent, "매물 7개");
  assert.equal(fixture.elements.get("jsPhoneFilterChipsV2").hidden, false);
  assert.equal(fixture.elements.get("jsPhonePortraitGuardV2").hidden, true);
  fixture.form.listeners.submit();
  assert.equal(fixture.counters().blurCount, 1, "portrait search dismisses the keyboard");
});

test("landscape transition removes header style without blocking, refocusing, or deleting state", () => {
  const fixture = loadApp();
  const guard = fixture.elements.get("jsPhonePortraitGuardV2");
  fixture.setMobileLayout(false);
  fixture.callbacks.get("headerResize")();
  assert.equal(fixture.styles.has("--js-phone-header-height"), false);
  assert.equal(guard.hidden, true);
  assert.equal(guard.hasAttribute("aria-modal"), false);
  assert.equal(fixture.input.value, "유지할 검색어");
  assert.equal(fixture.detail.textContent, "선택한 매물 상세");
  assert.equal(fixture.detail.hidden, false);
  assert.equal(fixture.root.getAttribute("data-jsm-mobile-view"), "list");
  assert.equal(fixture.document.activeElement, fixture.input);
  fixture.form.listeners.submit();
  assert.deepEqual(fixture.counters(), {blurCount: 0, focusCount: 0, inertWrites: 0});
  fixture.setMobileLayout(true);
  assert.equal(fixture.styles.get("--js-phone-header-height"), "113px");
  assert.equal(fixture.input.value, "유지할 검색어");
  assert.equal(fixture.detail.hidden, false);
  assert.equal(guard.hidden, true);
  assert.deepEqual(fixture.counters(), {blurCount: 0, focusCount: 0, inertWrites: 0});
});

test("desktop presentation never sets mobile header style or alters auth inert state", () => {
  const fixture = loadApp(false);
  fixture.detail.inert = true;
  fixture.window.JSPhoneAppV2.sync();
  assert.equal(fixture.styles.has("--js-phone-header-height"), false);
  assert.equal(fixture.detail.inert, true);
  assert.equal(fixture.elements.get("jsPhonePortraitGuardV2").hidden, true);
  assert.deepEqual(fixture.counters(), {blurCount: 0, focusCount: 0, inertWrites: 1});
});
