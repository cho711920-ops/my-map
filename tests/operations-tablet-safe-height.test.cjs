const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "css", "operations-center-v7.css"), "utf8");
const collectionCss = fs.readFileSync(path.join(root, "css", "operations-collection-v8.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(
  css,
  /height:min\(940px,calc\(100dvh - 20px\)\)/,
  "desktop/tablet operations dialog must use the dynamic viewport height"
);
assert.match(
  css,
  /@media\(min-width:769px\) and \(max-height:900px\)\{[\s\S]*?top:max\(8px,env\(safe-area-inset-top\)\);[\s\S]*?bottom:max\(42px,calc\(env\(safe-area-inset-bottom\) \+ 12px\)\);[\s\S]*?height:auto;[\s\S]*?transform:translateX\(-50%\)/,
  "short tablet viewports must reserve visible top and bottom space"
);
assert.match(
  html,
  /operations-center-v7\.css\?v=7\.17\.2-tablet-safe-height/,
  "the operations stylesheet cache key must be updated"
);
assert.match(
  collectionCss,
  /@media\(min-width:769px\) and \(max-width:1366px\)\{[\s\S]*?top:max\(8px,env\(safe-area-inset-top\)\);[\s\S]*?bottom:max\(42px,calc\(env\(safe-area-inset-bottom\) \+ 12px\)\)/,
  "the later tablet collection stylesheet must preserve the same safe top and bottom space"
);
assert.match(
  html,
  /operations-collection-v8\.css\?v=7\.23\.1-rental-colors-only/,
  "the collection stylesheet cache key must be updated"
);

console.log("operations tablet safe height tests passed");
