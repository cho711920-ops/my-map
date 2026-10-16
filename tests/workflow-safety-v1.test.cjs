const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = (name) => fs.readFileSync("js/" + name, "utf8");

test("unified originals preserve successful data on failure, then retry successfully", async () => {
  let fail = false, count = 0;
  const document = {getElementById() {return null;}, addEventListener() {}};
  const window = {document, addEventListener() {}, setTimeout() {}, clearTimeout() {}, innerWidth:1200,
    JSDataAccessV6:{read:async()=> {count++; if(fail) throw Error("network"); return {ok:true,groups:{P1:[]},sourceSearchIds:{P1:["n:123456"]}};}}};
  vm.runInNewContext(source("unified-listings-v8.js"),{window,document,console:{error(){},warn(){}},URL,Promise});
  const api = window.JSUnifiedListingsV8;
  const initial = await api.load(); fail = true;
  const failed = await api.load(true); assert.equal(failed.ok,false); assert.equal(failed.groups,initial.groups); assert.deepEqual(Array.from(failed.sourceSearchIds.P1),["n:123456"]);
  fail = false; assert.equal((await api.load(true)).ok,true); assert.equal(count,3);
});
test("initial original failure remains retryable instead of caching an empty success", async () => {
  let fail = true, count = 0;
  const document = {getElementById() {return null;}, addEventListener() {}};
  const window = {document, addEventListener() {}, setTimeout() {}, clearTimeout() {}, innerWidth:1200,
    JSDataAccessV6:{read:async()=> {count++; if(fail) throw Error("network"); return {ok:true,groups:{P1:[]}};}}};
  vm.runInNewContext(source("unified-listings-v8.js"),{window,document,console:{error(){},warn(){}},URL,Promise});
  const api = window.JSUnifiedListingsV8; assert.equal((await api.load()).ok,false); fail = false;
  assert.equal((await api.load()).ok,true); assert.equal(count,2);
});

function favoriteDeletion(approved = true) {
  let lists = [{id:"old-id",name:"고객찜",itemKeys:["property:P1"]}], removed = [];
  const context = {deletedFolderUndoV1:null, favoriteAccountV1:"a@test.invalid", state:{expanded:{}},
    load:() => structuredClone(lists), save:(value) => {lists = structuredClone(value); return true;},
    store:() => ({remove:(_, id, value) => {removed.push(id); lists = structuredClone(value); return true;}}),
    render() {}, showToast() {}, nowIso:()=>new Date().toISOString(), uid:()=>"new-id",
    global:{confirm:()=>approved, JSAuthenticatedAccountEmail:"a@test.invalid"}, console};
  const code = source("unified-favorites-v7.js");
  const start = code.indexOf("global.deleteUnifiedFavoriteFolderV7"), end = code.indexOf("global.showUnifiedFavoriteOnMapV7", start);
  const undoStart = code.indexOf("function undoFavoriteFolderDeletionV1"), undoEnd = code.indexOf("global.startUnifiedFavoriteVisitV7", undoStart);
  vm.runInNewContext(code.slice(start,end) + code.slice(undoStart,undoEnd),context);
  return {context, lists:()=>lists, removed};
}
test("folder deletion requires confirmation and undo creates a new identifier, keeping the old tombstone", () => {
  const canceled = favoriteDeletion(false); canceled.context.global.deleteUnifiedFavoriteFolderV7("old-id");
  assert.equal(canceled.lists().length,1); assert.equal(canceled.removed.length,0);
  const approved = favoriteDeletion(); approved.context.global.deleteUnifiedFavoriteFolderV7("old-id");
  assert.equal(approved.lists().length,0); assert.deepEqual(approved.removed,["old-id"]);
  approved.context.undoFavoriteFolderDeletionV1();
  assert.equal(approved.lists()[0].id,"new-id"); assert.deepEqual(approved.lists()[0].itemKeys,["property:P1"]);
  assert.deepEqual(approved.removed,["old-id"]);
});
test("folder undo expires and cannot restore data into another account", () => {
  const other = favoriteDeletion(); other.context.global.deleteUnifiedFavoriteFolderV7("old-id");
  other.context.global.JSAuthenticatedAccountEmail = "b@test.invalid"; other.context.undoFavoriteFolderDeletionV1();
  assert.equal(other.lists().length,0);
  const expired = favoriteDeletion(); expired.context.global.deleteUnifiedFavoriteFolderV7("old-id");
  expired.context.deletedFolderUndoV1.expiresAt = 0; expired.context.undoFavoriteFolderDeletionV1();
  assert.equal(expired.lists().length,0);
});
