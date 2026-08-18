import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mobile = fs.readFileSync(new URL("../js/mobile-app-v1.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

test("desktop and mobile JS real-estate logos reload the current app", () => {
  assert.match(html, /class="header"[\s\S]*?onclick="window\.location\.reload\(\)"/);
  assert.match(html, /style\.css\?v=6\.10\.0-module-split/);
  assert.match(html, /class="js-brand-mark-v1">JS<\/b><strong class="js-brand-name-v1">JS부동산<\/strong>/);
  assert.match(html, /mobile-app-v1\.js\?v=1\.0\.5-tablet-logo-reload/);
  assert.match(mobile, /class="jsm-brand-v1" onclick="window\.location\.reload\(\)"/);
  assert.match(css, /\.header\[role="button"\][\s\S]*?touch-action:manipulation/);
  assert.match(css, /\.header \.js-brand-mark-v1[\s\S]*?linear-gradient\(145deg,#1489fa,#0562cf\)/);
  assert.match(css, /\.header \.js-brand-mark-v1[\s\S]*?width:42px;[\s\S]*?font-size:17px/);
  assert.match(css, /\.header \.js-brand-name-v1[\s\S]*?color:#15233a;[\s\S]*?font-size:22px/);
});
