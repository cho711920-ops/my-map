const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const css = fs.readFileSync(
  path.join(root, "css", "unified-listings-v8.css"),
  "utf8"
);

assert.match(
  html,
  /id="naverRoadviewTabBtn"[\s\S]*?id="naverRoadviewHistoryBtn"[\s\S]*?과거사진 보기 ↗[\s\S]*?id="roadviewTabBtn"/,
  "과거사진 버튼은 네이버맵과 카카오맵 사이에 있어야 합니다."
);
assert.match(html, /id="naverRoadviewHistoryBtn"[\s\S]*?disabled/);
assert.match(html, /onclick="openNaverPastRoadviewV666\(\)"/);
assert.match(css, /\.roadview-history-button-v666/);
assert.match(css, /\.roadview-history-button-v666:disabled/);
assert.match(html, /script\.js\?v=6\.10\.6-naver-history-deeplink/);
assert.match(html, /unified-listings-v8\.css\?v=8\.0\.45-naver-history-button/);

const start = script.indexOf("function setNaverRoadviewHistoryReadyV666");
const end = script.indexOf("function updateNaverPanoramaInfoV653", start);
assert.ok(start >= 0 && end > start, "과거사진 링크 함수 범위를 찾을 수 있어야 합니다.");

const button = {
  disabled: true,
  title: "",
  attributes: {},
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
};
const openedLinks = [];
const alerts = [];
const context = {
  document: {
    getElementById(id) {
      return id === "naverRoadviewHistoryBtn" ? button : null;
    }
  },
  window: {
    open(url, target, features) {
      const popup = { opener: "unsafe" };
      openedLinks.push({ url, target, features, popup });
      return popup;
    }
  },
  alert(message) {
    alerts.push(message);
  },
  currentRoadviewMode: "naver",
  naverRoadviewInstanceV653: {
    getPanoId() {
      return "abc+/==";
    },
    getPov() {
      return { pan: 162.345, tilt: 10.204, fov: 80 };
    }
  },
  Boolean,
  Number,
  String,
  Math,
  isFinite,
  encodeURIComponent
};

vm.createContext(context);
vm.runInContext(script.slice(start, end), context);

context.setNaverRoadviewHistoryReadyV666(true);
assert.equal(button.disabled, false);
assert.equal(button.attributes["aria-disabled"], "false");

const expected =
  "https://map.naver.com/p?c=17.00,0,0,0,adh&p=abc%2B%2F%3D%3D,162.35,10.2,80,Float";
assert.equal(context.buildNaverRoadviewHistoryUrlV666(), expected);

context.openNaverPastRoadviewV666();
assert.deepEqual(openedLinks[0], {
  url: expected,
  target: "_blank",
  features: "noopener,noreferrer",
  popup: { opener: null }
});
assert.equal(alerts.length, 0);

context.currentRoadviewMode = "kakao";
context.setNaverRoadviewHistoryReadyV666(true);
assert.equal(button.disabled, true, "네이버 탭이 아닐 때는 버튼을 비활성화해야 합니다.");

context.naverRoadviewInstanceV653 = null;
context.openNaverPastRoadviewV666();
assert.equal(openedLinks.length, 1, "거리뷰가 준비되지 않으면 지도 화면을 대신 열지 않습니다.");
assert.equal(alerts[0], "네이버 거리뷰가 준비된 후 다시 눌러 주세요.");

console.log("NAVER historical roadview deep-link v6.6.6 tests passed");
