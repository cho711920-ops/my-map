const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const favorites = fs.readFileSync("js/unified-favorites-v7.js", "utf8");
const favoritesCss = fs.readFileSync("css/unified-favorites-v7.css", "utf8");
const listManager = fs.readFileSync("js/list-manager-v6.js", "utf8");
const aiVisit = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");
const main = fs.readFileSync("js/script.js", "utf8");

assert.match(html, /unified-favorites-v7\.css\?v=7\.0\.0-account-folders/);
assert.match(html, /unified-favorites-v7\.js\?v=7\.0\.0-account-folders/);
assert.match(html, /class="selection-favorite-btn"[^>]+openSelectedFavoritesManagerV7/);
assert.match(html, /id="mapQuickListBtn"[\s\S]*?openListManager\('favorite'\)[\s\S]*?<span>찜♡<\/span>/);
assert.doesNotMatch(html, /openListManager\('visit'\)/);

assert.match(favorites, /api\.save\("favorite", lists\)/);
assert.match(favorites, /var visits = load\("visit"\)/);
assert.match(favorites, /migrateVisitFolders\(\)/);
assert.match(favorites, /"property:" \+ propertyId/);
assert.match(favorites, /내 계정에만 저장·동기화됩니다/);
assert.match(favorites, /showUnifiedFavoriteOnMapV7/);
assert.match(favorites, /startUnifiedFavoriteVisitV7/);
assert.match(favorites, /removeUnifiedFavoriteItemV7/);
assert.match(favorites, /deleteUnifiedFavoriteFolderV7/);
assert.doesNotMatch(favorites, /customerMatch|customers/);

assert.match(listManager, /var propertyPrefix = "property:"/);
assert.match(aiVisit, /window\.JSV6ListStore\.load\("favorite"\)/);
assert.match(aiVisit, /js_favorite_lists_v6/);
assert.match(main, /var favoriteHeaderButtonV661 = "";/);
assert.match(main, /favoriteKeys\.includes\(propertyRef\)/);

assert.match(favoritesCss, /\.unified-favorite-dialog-v7\{position:fixed/);
assert.match(favoritesCss, /\.selection-action-bar \.selection-favorite-btn/);
assert.match(favoritesCss, /\.unified-favorite-folder-actions-v7 button\.visit/);

console.log("unified favorites v7 tests passed");
