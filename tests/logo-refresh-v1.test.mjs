import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mobile = fs.readFileSync(new URL("../js/mobile-app-v1.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

test("desktop and mobile JS real-estate logos reload the current app", () => {
  assert.match(html, /class="header"[\s\S]*?onclick="window\.location\.reload\(\)"/);
  assert.match(html, /style\.css\?v=6\.5\.35-tablet-logo-touch/);
  assert.match(html, /mobile-app-v1\.js\?v=1\.0\.5-tablet-logo-reload/);
  assert.match(mobile, /class="jsm-brand-v1" onclick="window\.location\.reload\(\)"/);
  assert.match(css, /\.header\[role="button"\][\s\S]*?touch-action:manipulation/);
});
