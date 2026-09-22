import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/phone-device-v1.js", import.meta.url), "utf8");
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
  assert.equal(fixture.device.isLandscape(), false);
  assert.ok(fixture.classes.has("js-phone-app-v2"));
  assert.equal(fixture.attrs.has("data-js-phone-landscape"), false);
  assert.equal(fixture.events[0].type, "js-phone-device-change");
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
  assert.equal(fixture.attrs.get("data-js-phone-landscape"), "true");
  fixture.window.screen.width = 390;
  fixture.window.screen.height = 844;
  fixture.window.screen.orientation.type = "portrait-primary";
  fixture.listeners.orientationchange();
  assert.equal(fixture.attrs.has("data-js-phone-landscape"), false);
  assert.equal(fixture.events.length, 3);
});

test("portrait keyboard shrink and unchanged resizes never signal landscape or discard state", () => {
  const fixture = load();
  fixture.window.innerHeight = 240;
  fixture.listeners.resize();
  fixture.listeners.resize();
  assert.equal(fixture.device.isLandscape(), false);
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
  ["narrowed desktop", {navigator: {userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0", maxTouchPoints: 0, userAgentData: {mobile: false}}, screen: {width: 1920, height: 1080}, innerWidth: 390, matchMedia: () => ({matches: false})}],
  ["touch laptop with narrow reported display", {navigator: {userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0", maxTouchPoints: 10, userAgentData: {mobile: false}}}],
  ["small Android tablet without Mobile token", {navigator: {userAgent: "Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/131.0 Safari/537.36", maxTouchPoints: 5}}],
  ["unknown touch device", {navigator: {userAgent: "Unknown Browser", maxTouchPoints: 5}}],
  ["unknown screen size", {screen: {width: 0, height: 0}}]
]) {
  test(`${name} retains the existing UI`, () => {
    const fixture = load(settings);
    assert.equal(fixture.device.isPhone(), false);
    assert.equal(fixture.classes.has("js-phone-app-v2"), false);
    assert.equal(fixture.attrs.has("data-js-phone-landscape"), false);
  });
}

test("positive mobile client hint requires touch evidence", () => {
  assert.equal(load({navigator: {userAgent: "Reduced Browser", userAgentData: {mobile: true}, maxTouchPoints: 5}}).device.isPhone(), true);
  assert.equal(load({navigator: {userAgent: "Reduced Browser", userAgentData: {mobile: true}, maxTouchPoints: 0}, matchMedia: () => ({matches: false})}).device.isPhone(), false);
});
