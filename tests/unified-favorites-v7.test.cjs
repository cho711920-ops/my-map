const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const favorites = fs.readFileSync("js/unified-favorites-v7.js", "utf8");
const favoritesCss = fs.readFileSync("css/unified-favorites-v7.css", "utf8");
const listManager = fs.readFileSync("js/list-manager-v6.js", "utf8");
const aiVisit = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");
const main = fs.readFileSync("js/script.js", "utf8");

assert.match(html, /unified-favorites-v7\.css\?v=7\.0\.2-reliable-submit/);
assert.match(html, /unified-favorites-v7\.js\?v=7\.0\.5-property-id-only/);
assert.match(html, /list-manager-v6\.js\?v=6\.4\.35-shared-data-only/);
assert.match(html, /class="selection-favorite-btn"[^>]+openSelectedFavoritesManagerV7/);
assert.match(html, /id="mapQuickListBtn"[\s\S]*?openListManager\('favorite'\)[\s\S]*?<span>찜목록<\/span>/);
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
assert.match(favorites, /unifiedFavoriteAddV7/);
assert.match(favorites, /unifiedFavoriteCreateFormV7/);
assert.match(favorites, /type="submit"/);
assert.match(favorites, /reconcileSavedFolder\(list\)/);
assert.match(favorites, /api\.remove\("visit", visit\.id, \[\]\)/);
assert.match(favorites, /clearSavedSelection\(\)/);
assert.match(favorites, /global\.clearSelectedPrintItems\(\)/);
assert.match(favorites, /api\.remove\("favorite", id, lists\)/);
assert.doesNotMatch(favorites, /찜폴더를 삭제할까요/);
assert.match(favorites, /js-v6-list-store-change/);
assert.match(favorites, /dialog\.style\.height = height \+ "px"/);
assert.match(favorites, /Math\.min\(1040, Math\.max\(520, rect\.width - 68\)\)/);
assert.doesNotMatch(favorites, /customerMatch|customers/);

assert.match(listManager, /var propertyPrefix = "property:"/);
assert.match(listManager, /new CustomEvent\("js-v6-list-store-change"/);
assert.match(listManager, /return saveLists\(type === "visit" \? "visit" : "favorite", lists\)/);
assert.match(listManager, /var memoryLists = \{ favorite: null, visit: null \}/);
assert.match(listManager, /var deletedListIds = \{ favorite: null, visit: null \}/);
assert.match(listManager, /excludeDeletedLists\(type, result\.data\)/);
assert.match(listManager, /markDeletedListId\(type, id\)/);
assert.match(listManager, /memoryLists\[type\] = lists/);
assert.match(listManager, /기기 저장을 건너뛰고 계정 동기화를 계속합니다/);
assert.match(listManager, /pendingCloudSave\[type\] \|\| localStorage\.getItem/);
assert.match(listManager, /migrationComplete = localStorage\.getItem/);
assert.match(listManager, /기존 찜 표시용 기기 저장을 건너뜁니다/);
assert.match(favorites, /try \{ localStorage\.setItem\("favoriteKeys"/);
assert.match(aiVisit, /window\.JSV6ListStore\.load\("favorite"\)/);
assert.match(aiVisit, /js_favorite_lists_v6/);
assert.match(main, /var favoriteHeaderButtonV661 = "";/);
assert.match(main, /favoriteKeys\.includes\(propertyRef\)/);
assert.match(main, /var favoriteRefV821 = item\.propertyId[\s\S]*?"property:" \+ String\(item\.propertyId\)\.trim\(\)/);
assert.match(main, /openItemListDestinationPicker\([^\n]+encodedFavoriteRefV821/);
assert.doesNotMatch(favorites, /filterKeys\.push\(item\.key\)/);

const stored = new Map();
const favoriteButton = { classList: { add() {} } };
const context = {
  console,
  localStorage: { setItem: (key, value) => stored.set(key, value) },
  document: { getElementById: (id) => id === "favoriteBtn" ? favoriteButton : null },
  requestAnimationFrame: (callback) => callback(),
  window: {
    allItems: [
      { propertyId: "M-first", key: "중소형사무실|서구 괴정동 423-4|5층|사무실" },
      { propertyId: "M-second", key: "중소형사무실|서구 괴정동 423-4|5층|사무실" }
    ],
    JSV6ListStore: {
      load: () => [{ id: "fav-one", name: "찜", itemKeys: ["property:M-first"] }]
    },
    addEventListener() {},
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame: (callback) => callback(),
    applyFilter() {}
  }
};
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
vm.runInNewContext(favorites, context);
context.window.showUnifiedFavoriteOnMapV7("fav-one");
assert.deepEqual(Array.from(context.window.favoriteKeys), ["property:M-first"]);
assert.deepEqual(JSON.parse(stored.get("favoriteKeys")), ["property:M-first"]);

assert.match(favoritesCss, /\.unified-favorite-dialog-v7\{position:fixed/);
assert.match(favoritesCss, /max-width:1040px;min-height:500px/);
assert.match(favoritesCss, /\.selection-action-bar \.selection-favorite-btn/);
assert.match(favoritesCss, /\.unified-favorite-folder-actions-v7 button\.visit/);

console.log("unified favorites v7 tests passed");
