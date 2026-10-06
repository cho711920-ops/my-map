const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/map-field-orientation-v1.js"), "utf8");

function eventTarget(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatchEvent(event) { for (const callback of [...(listeners.get(event.type) || [])]) callback(event); },
    listenerCount(type) { return type ? (listeners.get(type)?.size || 0) : [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  });
}

function harness(options = {}) {
  const origin = Date.parse("2026-10-06T03:00:00Z");
  let now = origin + 100;
  let nextId = 1;
  const timers = new Map();
  class ClockDate extends Date { static now() { return now; } }
  const document = eventTarget({ hidden: !!options.hidden, visibilityState: options.hidden ? "hidden" : "visible" });
  const screenOrientation = eventTarget({ angle: options.screenAngle || 0 });
  const window = eventTarget({
    isSecureContext: options.secure !== false,
    screen: { orientation: screenOrientation },
    performance: { timeOrigin: origin },
    DeviceOrientationEvent: options.unsupported ? undefined : function DeviceOrientationEvent() {},
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  });
  if (options.permission) window.DeviceOrientationEvent.requestPermission = options.permission;
  vm.runInNewContext(source, { window, document, Date: ClockDate, Math, Number, Promise });
  const readings = [];
  const statuses = [];
  return {
    window, document, screenOrientation, readings, statuses, timers,
    api: window.JSFieldOrientationV1,
    get now() { return now; },
    start() { return window.JSFieldOrientationV1.start((value) => readings.push(value), (value) => statuses.push(value)); },
    sample(overrides = {}) {
      window.dispatchEvent({ type: "deviceorientationabsolute", absolute: true, alpha: 0, beta: 0, gamma: 0, timeStamp: now - origin, ...overrides });
    },
    advance(milliseconds) {
      const end = now + milliseconds;
      let loops = 0;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        assert.ok(loops++ < 1000, "timers must remain bounded");
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
    hide(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      document.dispatchEvent({ type: "visibilitychange" });
    }
  };
}

function near(actual, expected, message = "heading") {
  assert.equal(typeof actual, "number", message);
  const difference = Math.abs((actual - expected + 540) % 360 - 180);
  assert.ok(difference < 1e-7, `${message}: expected ${expected}, got ${actual}`);
}

test("compass module is completely inactive until field mode starts", () => {
  const h = harness();
  assert.equal(h.api.state().running, false);
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.document.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
  h.sample();
  assert.equal(h.readings.length, 0);
});

test("horizontal portrait and all screen quadrants preserve compass cardinal directions", () => {
  const heading = harness().api.headingFromAngles;
  for (const alpha of [0, 90, 180, 270]) {
    for (const angle of [0, 90, 180, 270, -90, 450]) near(heading(alpha, 0, 0, angle), (360 - alpha + angle + 360) % 360);
  }
});

test("screen compensation uses the 3D device frame, including natural-landscape tablets", () => {
  const heading = harness().api.headingFromAngles;
  near(heading(0, 45, 30, 90), Math.atan2(Math.cos(Math.PI / 6), Math.sin(Math.PI / 4) * Math.sin(Math.PI / 6)) * 180 / Math.PI);
  near(heading(90, 45, 30, 90), 337.7923457014035);
  near(heading(0, 45, 30, 270), 247.7923457014035);
  near(heading(270, 45, -30, 90), 202.20765429859648);
});

test("tilt-aware headings agree with independent sequential vector rotations", () => {
  const heading = harness().api.headingFromAngles;
  const rad = (value) => value * Math.PI / 180;
  for (const alpha of [5, 113, 301]) for (const beta of [-35, 15, 48]) for (const gamma of [-25, 0, 32]) for (const angle of [0, 90, 180, 270]) {
    const vector = [Math.sin(rad(angle)), Math.cos(rad(angle)), 0];
    const yaw = [vector[0] * Math.cos(rad(gamma)), vector[1], -vector[0] * Math.sin(rad(gamma))];
    const pitch = [yaw[0], yaw[1] * Math.cos(rad(beta)) - yaw[2] * Math.sin(rad(beta)), yaw[1] * Math.sin(rad(beta)) + yaw[2] * Math.cos(rad(beta))];
    const earth = [pitch[0] * Math.cos(rad(alpha)) - pitch[1] * Math.sin(rad(alpha)), pitch[0] * Math.sin(rad(alpha)) + pitch[1] * Math.cos(rad(alpha))];
    near(heading(alpha, beta, gamma, angle), (Math.atan2(earth[0], earth[1]) * 180 / Math.PI + 360) % 360);
  }
});

test("invalid Euler data, near-vertical singularities and face-down poses are rejected", () => {
  const heading = harness().api.headingFromAngles;
  for (const values of [[null, 0, 0, 0], [NaN, 0, 0, 0], [360, 0, 0, 0], [-1, 0, 0, 0], [0, Infinity, 0, 0], [0, 181, 0, 0], [0, 0, 91, 0], [0, 0, null, 0], [0, 0, 0, NaN], [0, 90, 0, 0], [0, 78, 0, 0], [0, 0, 89, 90], [0, 180, 0, 0], [0, -160, 0, 0]]) {
    assert.equal(heading(...values), null, JSON.stringify(values));
  }
  near(heading(45, 60, 15, 0), 315);
});

test("start listens to absolute Android and absolute generic events without extra permission APIs", async () => {
  const h = harness();
  assert.equal(await h.start(), true);
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
  assert.equal(h.window.listenerCount("deviceorientation"), 1);
  h.sample({ alpha: 270 });
  near(h.readings[0].heading, 90);
  assert.equal(h.readings[0].source, "compass");
  assert.equal(h.readings[0].accuracy, null);
  assert.equal(h.api.state().status, "ready");
  h.advance(1000);
  h.sample({ type: "deviceorientation", alpha: 265 });
  near(h.readings.at(-1).heading, 95);
});

test("relative alpha cannot overwrite a valid absolute bearing", async () => {
  const h = harness();
  await h.start();
  h.sample({ alpha: 270 });
  h.advance(300);
  h.sample({ absolute: false, alpha: 90 });
  h.sample({ absolute: undefined, alpha: 90 });
  assert.equal(h.readings.length, 1);
  near(h.api.state().heading, 90);
  assert.equal(h.api.state().status, "ready");
});

test("Safari's magnetic heading is accepted independently of arbitrary relative alpha", async () => {
  const h = harness();
  await h.start();
  h.sample({ type: "deviceorientation", absolute: false, alpha: 117, beta: 40, gamma: 12, webkitCompassHeading: 92, webkitCompassAccuracy: 8 });
  near(h.readings[0].heading, 92);
  assert.equal(h.readings[0].accuracy, 8);
});

test("Safari landscape correction uses tilt geometry rather than adding a fixed 90 degrees", async () => {
  const h = harness({ screenAngle: 90 });
  await h.start();
  h.sample({ absolute: false, alpha: 210, beta: 45, gamma: 30, webkitCompassHeading: 30, webkitCompassAccuracy: 12 });
  near(h.readings[0].heading, 97.7923457014035);
});

test("invalid or uncalibrated Safari compass data never rotates the map", async () => {
  for (const invalid of [{ webkitCompassHeading: -1 }, { webkitCompassHeading: 360 }, { webkitCompassAccuracy: -1 }, { webkitCompassAccuracy: 26 }, { webkitCompassAccuracy: null }, { webkitCompassAccuracy: NaN }]) {
    const h = harness();
    await h.start();
    h.sample({ absolute: false, webkitCompassHeading: 90, webkitCompassAccuracy: 10, ...invalid });
    assert.equal(h.readings.length, 0);
    assert.equal(h.api.state().status, "uncalibrated");
  }
});

test("Safari requires usable tilt data instead of trusting a bearing at a vertical singularity", async () => {
  const h = harness();
  await h.start();
  h.sample({ absolute: false, beta: 90, webkitCompassHeading: 90, webkitCompassAccuracy: 10 });
  assert.equal(h.api.state().status, "tilted");
  assert.equal(h.readings.length, 0);
});

test("start requests absolute sensor permission synchronously in the user gesture", async () => {
  let requested = null;
  const h = harness({ permission(value) { requested = value; return Promise.resolve("granted"); } });
  const promise = h.start();
  assert.equal(requested, true, "requestPermission must be invoked before yielding the gesture");
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 0);
  assert.equal(await promise, true);
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
});

test("permission denial, rejection and synchronous failure leave sensor listeners absent", async () => {
  for (const permission of [() => Promise.resolve("denied"), () => Promise.reject(new Error("denied")), () => { throw new Error("denied"); }]) {
    const h = harness({ permission });
    assert.equal(await h.start(), false);
    assert.equal(h.api.state().status, "denied");
    assert.equal(h.window.listenerCount("deviceorientationabsolute"), 0);
    h.api.stop();
    assert.equal(h.window.listenerCount(), 0);
    assert.equal(h.document.listenerCount(), 0);
  }
});

test("late permission after OFF cannot revive sensors or invoke stale callbacks", async () => {
  let resolve;
  const h = harness({ permission: () => new Promise((done) => { resolve = done; }) });
  const promise = h.start();
  h.api.stop();
  resolve("granted");
  assert.equal(await promise, false);
  assert.equal(h.api.state().running, false);
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.document.listenerCount(), 0);
  assert.equal(h.statuses.at(-1), "off");
});

test("an older start permission cannot affect a newer ON session", async () => {
  const answers = [];
  const h = harness({ permission: () => new Promise((done) => answers.push(done)) });
  const first = h.start();
  const second = h.start();
  answers[0]("granted");
  assert.equal(await first, false);
  assert.equal(h.api.state().listening, false);
  answers[1]("granted");
  assert.equal(await second, true);
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
});

test("unsupported and non-secure environments fall back without listeners or timers", async () => {
  for (const options of [{ unsupported: true }, { secure: false }]) {
    const h = harness(options);
    assert.equal(await h.start(), false);
    assert.equal(h.api.state().status, "unavailable");
    assert.equal(h.window.listenerCount(), 0);
    assert.equal(h.document.listenerCount(), 0);
    assert.equal(h.timers.size, 0);
  }
});

test("stop removes every owned listener, expiry and trailing callback", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(10);
  h.sample({ alpha: 350 });
  assert.ok(h.timers.size > 0);
  h.api.stop();
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.document.listenerCount(), 0);
  assert.equal(h.screenOrientation.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
  h.advance(10000);
  h.sample();
  assert.equal(h.readings.length, 1);
  assert.equal(h.api.state().heading, null);
});

test("repeated ON and OFF sessions do not accumulate listeners", async () => {
  const h = harness();
  for (let i = 0; i < 8; i++) {
    await h.start();
    assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
    assert.equal(h.screenOrientation.listenerCount("change"), 1);
  }
  h.api.stop();
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.document.listenerCount(), 0);
});

test("high-rate sensor samples are coalesced to the latest sample at four updates per second", async () => {
  const h = harness();
  await h.start();
  h.sample();
  for (let i = 1; i <= 20; i++) { h.advance(10); h.sample({ alpha: 360 - i }); }
  assert.equal(h.readings.length, 1);
  h.advance(50);
  assert.equal(h.readings.length, 2);
  near(h.readings[1].heading, 20);
});

test("small magnetic jitter is suppressed but stable readings refresh freshness once per second", async () => {
  const h = harness();
  await h.start();
  h.sample();
  for (let i = 0; i < 9; i++) { h.advance(100); h.sample({ alpha: 359 }); }
  assert.equal(h.readings.length, 1);
  h.advance(100);
  h.sample({ alpha: 359 });
  assert.equal(h.readings.length, 2);
  near(h.readings[1].heading, 1);
});

test("returning to the previous bearing cancels an older trailing turn", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(50);
  h.sample({ alpha: 340 });
  h.advance(50);
  h.sample();
  h.advance(200);
  assert.equal(h.readings.length, 1);
  near(h.api.state().heading, 0);
});

test("callback rate is measured from delivery time, not an older coalesced sample time", async () => {
  const h = harness();
  const deliveries = [];
  await h.api.start(() => deliveries.push(h.now));
  for (let i = 0; i < 100; i++) { h.sample({ alpha: (360 - i) % 360 }); h.advance(20); }
  assert.ok(deliveries.length <= 9);
  for (let i = 1; i < deliveries.length; i++) assert.ok(deliveries[i] - deliveries[i - 1] >= 250);
});

test("crossing 359 to 1 degrees does not look like a 358 degree magnetic jump", async () => {
  const h = harness();
  await h.start();
  h.sample({ alpha: 1 });
  h.advance(250);
  h.sample({ alpha: 359 });
  assert.equal(h.readings.length, 2);
  near(h.readings[1].heading, 1);
});

test("a single large magnetic spike is held and a confirmed genuine turn is accepted", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(300);
  h.sample({ alpha: 180 });
  assert.equal(h.readings.length, 1);
  h.advance(100);
  h.sample({ alpha: 181 });
  assert.equal(h.readings.length, 1);
  h.advance(25);
  h.sample({ alpha: 182 });
  assert.equal(h.readings.length, 2);
  near(h.readings[1].heading, 178);
});

test("a transient magnetic spike cannot leak through a later normal sample", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(300);
  h.sample({ alpha: 180 });
  h.advance(150);
  h.sample({ alpha: 358 });
  assert.equal(h.readings.length, 2);
  near(h.readings[1].heading, 2);
});

test("five seconds without a usable compass sample expires it instead of using it indefinitely", async () => {
  const h = harness();
  await h.start();
  h.sample({ alpha: 90 });
  h.advance(4999);
  assert.equal(h.api.state().status, "ready");
  h.advance(1);
  assert.equal(h.api.state().status, "stale");
  assert.equal(h.api.state().heading, null);
  assert.equal(h.timers.size, 0);
  h.sample({ alpha: 180 });
  assert.equal(h.api.state().status, "ready");
  near(h.readings.at(-1).heading, 180);
});

test("no sensor events reports unavailable after a bounded startup wait", async () => {
  const h = harness();
  await h.start();
  h.advance(5000);
  assert.equal(h.api.state().status, "unavailable");
  assert.equal(h.timers.size, 0);
});

test("valid identical events keep the compass alive without endlessly rescheduling timers", async () => {
  const h = harness();
  await h.start();
  for (let i = 0; i < 15; i++) { h.sample(); h.advance(1000); }
  assert.equal(h.api.state().status, "ready");
  assert.ok(h.timers.size <= 1);
  h.advance(5000);
  assert.equal(h.api.state().status, "stale");
});

test("hidden pages detach sensor listeners and resume only with fresh samples", async () => {
  const h = harness();
  await h.start();
  h.sample({ alpha: 90 });
  const oldStamp = h.now;
  h.hide(true);
  assert.equal(h.api.state().status, "hidden");
  assert.equal(h.api.state().heading, null);
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 0);
  assert.equal(h.timers.size, 0);
  h.advance(10000);
  h.hide(false);
  assert.equal(h.api.state().status, "waiting");
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
  h.sample({ alpha: 180, timeStamp: oldStamp });
  assert.equal(h.readings.length, 1);
  h.sample({ alpha: 180 });
  assert.equal(h.readings.length, 2);
});

test("permission resolved while hidden does not activate sensors until visible", async () => {
  let resolve;
  const h = harness({ permission: () => new Promise((done) => { resolve = done; }) });
  const promise = h.start();
  h.hide(true);
  resolve("granted");
  assert.equal(await promise, true);
  assert.equal(h.api.state().status, "hidden");
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 0);
  h.hide(false);
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
});

test("a denied compass remains denied after hiding and returning to the page", async () => {
  const h = harness({ permission: () => Promise.resolve("denied") });
  await h.start();
  h.hide(true);
  h.hide(false);
  assert.equal(h.api.state().status, "denied");
  assert.equal(h.api.state().listening, false);
  assert.equal(h.timers.size, 0);
});

test("starting while hidden waits for visibility without activating sensors", async () => {
  const h = harness({ hidden: true });
  await h.start();
  assert.equal(h.api.state().status, "hidden");
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 0);
  assert.equal(h.timers.size, 0);
  h.hide(false);
  assert.equal(h.api.state().status, "waiting");
  assert.equal(h.window.listenerCount("deviceorientationabsolute"), 1);
});

test("pagehide and pageshow handle bfcache without a background sensor listener", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.window.dispatchEvent({ type: "pagehide" });
  assert.equal(h.api.state().status, "hidden");
  assert.equal(h.api.state().listening, false);
  h.window.dispatchEvent({ type: "pageshow" });
  assert.equal(h.api.state().status, "waiting");
  assert.equal(h.api.state().heading, null);
});

test("screen rotation discards cached geometry until a new orientation sample arrives", async () => {
  const h = harness();
  await h.start();
  h.sample({ alpha: 90 });
  h.screenOrientation.angle = 90;
  h.screenOrientation.dispatchEvent({ type: "change" });
  assert.equal(h.api.state().status, "waiting");
  assert.equal(h.api.state().heading, null);
  h.sample({ alpha: 90 });
  near(h.readings.at(-1).heading, 0);
});

test("legacy screen orientation compensation is supported when ScreenOrientation is unavailable", async () => {
  const h = harness();
  h.window.screen.orientation = undefined;
  h.window.orientation = -90;
  await h.start();
  h.sample({ alpha: 270 });
  near(h.readings[0].heading, 0);
});

test("old, out-of-order and far-future event timestamps are rejected", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(300);
  h.sample({ alpha: 350, timeStamp: h.now - 2000 });
  h.sample({ alpha: 350, timeStamp: h.now + 2000 });
  assert.equal(h.readings.length, 1);
  h.sample({ alpha: 350 });
  assert.equal(h.readings.length, 2);
  h.advance(300);
  h.sample({ alpha: 345, timeStamp: h.now - 400 });
  assert.equal(h.readings.length, 2);
});

test("new invalid tilt cancels an already queued update and invalidates cached compass", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(10);
  h.sample({ alpha: 350 });
  h.sample({ beta: 90 });
  h.advance(300);
  assert.equal(h.readings.length, 1);
  assert.equal(h.api.state().heading, null);
  assert.equal(h.api.state().status, "tilted");
});

test("a recovered compass immediately delivers a fresh reading even at the prior bearing", async () => {
  const h = harness();
  await h.start();
  h.sample();
  h.advance(10);
  h.sample({ beta: 90 });
  h.advance(10);
  h.sample();
  assert.equal(h.readings.length, 2);
  assert.equal(h.api.state().status, "ready");
  assert.equal(h.readings[1].timestamp, h.now);
});

test("callback errors cannot prevent sensor cleanup or create a timer loop", async () => {
  const h = harness();
  await h.api.start(() => { throw new Error("UI failure"); }, () => { throw new Error("UI failure"); });
  assert.doesNotThrow(() => h.sample());
  assert.doesNotThrow(() => h.api.stop());
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test("callback and state objects cannot mutate internal readings", async () => {
  const h = harness();
  await h.start();
  h.sample({ alpha: 270 });
  h.readings[0].heading = 300;
  h.api.state().heading = 210;
  near(h.api.state().heading, 90);
});

test("compass helper never adds GPS watchers, network requests, storage or sensor listeners at load time", () => {
  assert.doesNotMatch(source, /watchPosition\s*\(|getCurrentPosition\s*\(|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|sendBeacon/);
});
