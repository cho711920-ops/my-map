const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "announcement-v1.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "announcement-readable-v1.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(script, /function formatAnnouncementContent\(/);
assert.match(script, /js-announcement-step/);
assert.match(script, /<br><br>/);
assert.match(css, /\.js-announcement-step\s*\{/);
assert.match(html, /announcement-v1\.js\?v=1\.0\.2-data-access/);
assert.match(html, /announcement-v1\.css\?v=1\.0\.1-readable-steps/);
assert.match(html, /announcement-readable-v1\.css\?v=1\.0\.0/);

console.log("announcement-v1 tests passed");
