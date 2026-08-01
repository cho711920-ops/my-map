const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("js/operations-center-v7.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(source, /function readCustomerAlertDismissal\(key\)/);
assert.match(source, /function isCustomerAlertDismissed\(key, fingerprint, counts\)/);
assert.match(
  source,
  /if \(!force && isCustomerAlertDismissed\(key, fingerprint, counts\)\) return;/
);
assert.match(
  source,
  /window\.closeCustomerWorkAlert = function\(\)[\s\S]*?dismissedAt: new Date\(\)\.toISOString\(\)[\s\S]*?localStorage\.setItem\(key, JSON\.stringify\(payload\)\)/
);
assert.match(
  source,
  /return counts\.every\(function\(count, index\)[\s\S]*?count <= number\(dismissed\.counts\[index\]\)/
);
assert.match(
  source,
  /if \(alerts && forcePopup === true\) showCustomerWorkAlert\(data, true\);/
);
assert.match(source, /refreshCustomerAlertBadge\(false\);/);
assert.match(
  html,
  /operations-center-v7\.js\?v=7\.18\.8-compact-map-status/
);

console.log("customer work alert dismissal tests passed");
