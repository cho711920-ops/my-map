const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const favorites = fs.readFileSync("js/unified-favorites-v7.js", "utf8");
const favoritesCss = fs.readFileSync("css/unified-favorites-v7.css", "utf8");
const listManager = fs.readFileSync("js/list-manager-v6.js", "utf8");
const aiVisit = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");
const main = fs.readFileSync("js/script.js", "utf8");

assert.match(html, /unified-favorites-v7\.css\?v=7\.0\.11-balanced-circle/);
assert.match(html, /unified-favorites-v7\.js\?v=7\.0\.11-balanced-circle/);
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
assert.match(favorites, /class="unified-favorite-close-v7" type="button" aria-label="찜목록 닫기"/);
assert.match(favorites, /type="submit"/);
assert.match(favorites, /reconcileSavedFolder\(list\)/);
assert.match(favorites, /api\.remove\("visit", visit\.id, \[\]\)/);
assert.match(favorites, /clearSavedSelection\(\)/);
assert.match(favorites, /global\.clearSelectedPrintItems\(\)/);
assert.match(favorites, /api\.remove\("favorite", id, lists\)/);
assert.doesNotMatch(favorites, /찜폴더를 삭제할까요/);
assert.match(favorites, /js-v6-list-store-change/);
assert.match(favorites, /dialog\.style\.height = height \+ "px"/);
assert.match(favorites, /var left = Math\.max\(16, \(global\.innerWidth - width\) \/ 2\)/);
assert.match(favorites, /Math\.min\(1120, Math\.max\(760, global\.innerWidth \* 0\.84\)\)/);
assert.match(favorites, /Math\.min\(620, Math\.max\(500, global\.innerWidth \* 0\.5\)\)/);
assert.match(favorites, /var verticalGap = Math\.max\(16, Math\.min\(68, \(global\.innerHeight - 500\) \/ 2\)\)/);
assert.match(favorites, /var height = Math\.max\(500, global\.innerHeight - \(verticalGap \* 2\)\)/);
assert.doesNotMatch(favorites, /customerMatch|customers/);
assert.match(favorites, /item && item\.thumbnailV8/);
assert.match(favorites, /item\.unifiedOriginalsV8/);
assert.match(favorites, /loading="lazy" decoding="async" referrerpolicy="no-referrer"/);
assert.match(favorites, /openUnifiedFavoriteItemV7/);
assert.match(favorites, /JSUnifiedListingsV8\.open\(encodeURIComponent\(propertyId\)\)/);
assert.match(favorites, /unifiedFavoriteDetailHostV7/);
assert.match(favorites, /dialog\.classList\.add\("has-detail-v7"\)/);
assert.match(favorites, /host\.appendChild\(drawer\)/);
assert.match(favorites, /releaseFavoriteDetailV7\(\)/);

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
    innerWidth: 700,
    allItems: [
      { propertyId: "M-first", key: "중소형사무실|서구 괴정동 423-4|5층|사무실" },
      { propertyId: "M-second", key: "중소형사무실|서구 괴정동 423-4|5층|사무실" }
    ],
    JSV6ListStore: {
      load: () => [{ id: "fav-one", name: "찜", itemKeys: ["property:M-first"] }]
    },
    JSUnifiedListingsV8: {
      open: (propertyId) => { context.openedPropertyId = propertyId; }
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
context.window.openUnifiedFavoriteItemV7(encodeURIComponent("property:M-first"));
assert.equal(context.openedPropertyId, "M-first");

assert.match(favoritesCss, /\.unified-favorite-dialog-v7\{position:fixed/);
assert.match(favoritesCss, /max-width:1120px;min-height:500px/);
assert.match(favoritesCss, /\.selection-action-bar \.selection-favorite-btn/);
assert.match(favoritesCss, /\.unified-favorite-folder-actions-v7 button\.visit/);
assert.match(favoritesCss, /\.unified-favorite-open-v7\{/);
assert.match(favoritesCss, /\.unified-favorite-dialog-v7\.has-detail-v7 \.unified-favorite-layout-v7/);
assert.match(favoritesCss, /grid-template-columns:minmax\(360px,1\.08fr\) minmax\(360px,\.92fr\)/);
assert.match(favoritesCss, /\.unified-favorite-detail-host-v7 \.unified-detail-drawer-v8/);
assert.match(favoritesCss, /\.unified-favorite-close-v7\{[^}]*width:40px;[^}]*border-radius:50%;[^}]*background:#eef2f7/);
assert.match(favoritesCss, /\.unified-favorite-close-v7:hover\{[^}]*transform:scale\(1\.04\)/);

console.log("unified favorites v7 tests passed");
