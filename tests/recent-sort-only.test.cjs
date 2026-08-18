const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/list-manager-v6.css", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");

const sortMenu = html.match(/<div id="sortDropdownMenu"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
assert.ok(sortMenu, "정렬 메뉴를 찾을 수 있어야 합니다.");
assert.match(html, /id="sortFilter" type="hidden" value="latest"/);
assert.match(sortMenu[0], /sort-menu-check selected[\s\S]*?aria-selected="true"[\s\S]*?data-sort-value="latest"[\s\S]*?>최근등록순<\/span>/);
assert.equal((sortMenu[0].match(/data-sort-value=/g) || []).length, 1, "정렬 항목은 최근등록순 하나만 있어야 합니다.");
assert.doesNotMatch(sortMenu[0], /addressAsc|addressDesc|floorLow|floorHigh|rentLow|rentHigh|depositLow|depositHigh/);
assert.match(css, /sort-menu-check\.selected::before[\s\S]*?display:none!important;content:none!important/);
assert.match(script, /if \(sortType === "latest"\)[\s\S]*?listingRegistrationTime\(b\) - listingRegistrationTime\(a\)/);
assert.match(script, /function listingRegistrationTime\(item\)/);
assert.match(script, /item\.registrationAt \|\| item\.regDate/);
assert.match(script, /Number\(b\.sheetRow\)[\s\S]*?Number\(a\.sheetRow\)/);
assert.match(html, /list-manager-v6\.css\?v=6\.4\.28-brokerage-filter/);

console.log("recent registration sort-only tests passed");
