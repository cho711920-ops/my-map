const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jsSource = fs.readFileSync(path.join(root, "js", "ai-visit-session-v6.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "css", "ai-visit-v6.css"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(
  jsSource,
  /document\.documentElement\.clientWidth \|\| window\.innerWidth/
);
assert.match(
  jsSource,
  /document\.documentElement\.clientHeight \|\| window\.innerHeight/
);
assert.match(jsSource, /var gap = metrics\.width >= 769 \? 0 : 6;/);
assert.doesNotMatch(
  jsSource,
  /Math\.min\(\s*Number\(window\.innerWidth[\s\S]*?Number\(metrics\.width/
);

assert.match(
  cssSource,
  /@media \(min-width: 769px\)[\s\S]*?#roadviewModal\.roadview-modal\.open \.roadview-modal-dialog[\s\S]*?inset: 0 !important;[\s\S]*?width: 100vw !important;[\s\S]*?height: 100dvh !important;/
);
assert.match(indexSource, /css\/ai-visit-v6\.css\?v=6\.4\.34-roadview-viewport/);
assert.match(indexSource, /js\/ai-visit-session-v6\.js\?v=6\.4\.38-storage-fallback/);

console.log("roadview viewport fit tests passed");
