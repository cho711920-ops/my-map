const assert = require("node:assert/strict");
const fs = require("node:fs");

const building = fs.readFileSync("js/building-register-v6.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(
  building,
  /function getCachedBadge\(item\) \{[\s\S]*?readParcelCache\(item\)[\s\S]*?readCache\(cachedParcel\) \|\| readBadgeCache\(cachedParcel\)[\s\S]*?badgeFromData\(cachedData, item\)/
);
assert.match(building, /getCached: getCachedBadge/);
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
assert.match(html, /building-register-v6\.js\?v=6\.5\.19-stable-list-badge/);
assert.match(html, /script\.js\?v=6\.5\.19-stable-list-badge/);

console.log("stable building year badge tests passed");
