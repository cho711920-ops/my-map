import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mobile = fs.readFileSync(new URL("../js/mobile-app-v1.js", import.meta.url), "utf8");

test("desktop and mobile JS real-estate logos reload the current app", () => {
  assert.match(html, /class="header"[\s\S]*?onclick="reloadJSMapAppV1\(\)"/);
  assert.match(html, /mobile-app-v1\.js\?v=1\.0\.4-logo-reload/);
  assert.match(mobile, /class="jsm-brand-v1" data-mobile-action="reload"/);
  assert.match(mobile, /if \(action === "reload"\) reloadApp\(\)/);
  assert.match(mobile, /global\.location\.reload\(\)/);
  assert.match(mobile, /global\.reloadJSMapAppV1 = reloadApp/);
});
