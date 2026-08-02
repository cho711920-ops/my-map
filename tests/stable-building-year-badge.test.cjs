const assert = require("node:assert/strict");
const fs = require("node:fs");

const building = fs.readFileSync("js/building-register-v6.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(
  building,
  /function getCachedBadge\(item\) \{[\s\S]*?readParcelCache\(item\)[\s\S]*?readCache\(cachedParcel\) \|\| readBadgeCache\(cachedParcel\)[\s\S]*?badgeFromData\(cachedData, item\)/
);
assert.match(building, /function itemAddressParcelKey\(item\)/);
assert.match(
  building,
  /var keys = \[itemParcelKey\(item\), itemAddressParcelKey\(item\)\]\.filter\(Boolean\)/
);
assert.match(building, /getCached: getCachedBadge/);
assert.match(building, /var badgeMemoryV6520 = Object\.create\(null\)/);
assert.match(
  building,
  /function applyBadgeToCard\(card, badge\) \{[\s\S]*?rememberBadgeV810\(badgeItem, badge\)/
);
assert.match(
  building,
  /function getCachedBadge\(item\) \{[\s\S]*?badgeMemoryV6520\[itemKey\][\s\S]*?return badgeMemoryV6520\[itemKey\]/
);
assert.match(
  script,
  /var cachedBuildingBadgeV6519 =[\s\S]*?JSBuildingRegisterBadges\.getCached\(item\)/
);
assert.match(
  script,
  /cachedBuildingBadgeV6519 && cachedBuildingBadgeV6519\.year[\s\S]*?"준" \+ cachedBuildingBadgeV6519\.year/
);
assert.equal(
  (script.match(/escapeHtml\(cachedBuildingYearTextV6519\)/g) || []).length,
  2
);
assert.match(script, /var listCardReusePoolV6521 = null/);
assert.match(script, /fragment\.appendChild\(reusableCard\)/);
assert.match(html, /building-register-v6\.js\?v=8\.1\.0-persistent-building-info/);
assert.match(html, /script\.js\?v=6\.5\.59-stable-naver-roadview/);

console.log("stable building year badge tests passed");
