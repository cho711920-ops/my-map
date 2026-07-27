const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "js", "kakao-navigation-v1.js"),
  "utf8"
);

function storage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function makeContext(userAgent) {
  const listeners = {};
  const timers = [];
  const opened = [];
  const alerts = [];
  const context = {
    console,
    navigator: { userAgent: userAgent || "" },
    localStorage: storage(),
    document: {
      hidden: false,
      addEventListener(name, callback) {
        listeners[name] = callback;
      },
      removeEventListener(name) {
        delete listeners[name];
      }
    },
    location: { href: "https://my-map-ten-roan.vercel.app/" },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    open(url) {
      opened.push(url);
    },
    alert(message) {
      alerts.push(message);
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "kakao-navigation-v1.js" });
  return { context, listeners, timers, opened, alerts };
}

{
  const { context } = makeContext("Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0");
  assert.strictEqual(
    context.JSKakaoNavigation.buildRouteTargets(null, null),
    null,
    "missing destination must never become latitude 0, longitude 0"
  );
  const targets = context.JSKakaoNavigation.buildRouteTargets(
    { lat: 36.35041, lng: 127.38455, timestamp: Date.now() },
    { lat: 36.36231, lng: 127.37891, name: "대전 서구 둔산동 1000" }
  );

  assert(targets.hasStart, "route must contain a start point");
  assert(
    targets.webUrl.includes("/link/by/car/") &&
      targets.webUrl.includes("36.3504100,127.3845500") &&
      targets.webUrl.includes("36.3623100,127.3789100"),
    "web fallback must contain both start and destination coordinates"
  );
  assert(
    targets.androidIntent.includes("sp=36.3504100,127.3845500") &&
      targets.androidIntent.includes("ep=36.3623100,127.3789100") &&
      targets.androidIntent.includes("package=net.daum.android.map"),
    "Samsung Internet intent must include start, destination, and KakaoMap package"
  );
  assert(
    targets.androidIntent.includes("S.browser_fallback_url="),
    "Android intent must contain a browser fallback"
  );
}

{
  const { context, alerts } = makeContext(
    "Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0"
  );
  context.navigator.geolocation = {
    getCurrentPosition(success) {
      success({
        coords: {
          latitude: 36.35041,
          longitude: 127.38455,
          accuracy: 12
        },
        timestamp: Date.now()
      });
    }
  };

  context.JSKakaoNavigation.open({
    lat: 36.36231,
    lng: 127.37891,
    name: "대전 서구 둔산동 1000"
  });

  assert.strictEqual(alerts.length, 0, "successful geolocation must not show an alert");
  assert(
    context.location.href.includes("intent://route?sp=36.3504100,127.3845500") &&
      context.location.href.includes("ep=36.3623100,127.3789100"),
    "Android launch must pass both coordinates"
  );
}

{
  const { context, opened } = makeContext(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  );
  context.JSKakaoNavigation.rememberPosition({
    coords: {
      latitude: 36.35041,
      longitude: 127.38455,
      accuracy: 20
    },
    timestamp: Date.now()
  });

  context.JSKakaoNavigation.open({
    lat: 36.36231,
    lng: 127.37891,
    name: "대전 서구 둔산동 1000"
  });

  assert.strictEqual(opened.length, 1, "desktop navigation must open one route");
  assert(
    opened[0].includes("/link/by/car/") &&
      opened[0].includes("36.3504100,127.3845500") &&
      opened[0].includes("36.3623100,127.3789100"),
    "desktop route must include start and destination"
  );
}

console.log("Kakao navigation tests: OK");
