const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = (name) => fs.readFileSync("js/" + name, "utf8");

function drafts(account, shared = new Map(), approve = true) {
  const input = {id:"memo", value:"", getAttribute() { return ""; }};
  const events = {}, globalEvents = {};
  const modal = {hidden:false, querySelectorAll() { return [input]; }, querySelector() { return null; }, setAttribute() {}, addEventListener(name, fn) { events[name] = fn; }};
  const window = {JSAuthenticatedAccountEmail:account, document:{getElementById() { return modal; }},
    confirm:() => approve, addEventListener(name, fn) { globalEvents[name] = fn; },
    sessionStorage:{getItem:key=>shared.get(key)||null, setItem:(key,value)=>shared.set(key,value), removeItem:key=>shared.delete(key), key:i=>[...shared.keys()][i], get length() { return shared.size; }} };
  vm.runInNewContext(source("customer-draft-safety-v1.js"), {window, console});
  return {api:window.JSCustomerDraftSafetyV1, input, events, globalEvents, modal, window, shared};
}
test("customer draft survives reopen in same account but never crosses accounts", () => {
  const a = drafts("a@test.invalid");
  a.api.begin("editor", "customer:1", "input"); a.input.value = "미저장 상담"; a.events.input();
  assert.equal(a.shared.size, 1);
  const b = drafts("b@test.invalid", a.shared); b.api.begin("editor", "customer:1", "input"); assert.equal(b.input.value, "");
  const again = drafts("a@test.invalid", a.shared); again.api.begin("editor", "customer:1", "input"); assert.equal(again.input.value, "미저장 상담");
  again.api.saved("editor"); assert.equal(a.shared.size, 0);
});
test("unsaved close can be canceled; expired drafts and logout do not restore personal data", () => {
  const a = drafts("a@test.invalid", new Map(), false); a.api.begin("editor", "one", "input");
  a.input.value = "연락처와 상담"; assert.equal(a.api.canClose("editor"), false);
  const key = [...a.shared.keys()][0], expired = JSON.parse(a.shared.get(key)); expired.at = Date.now() - 13*3600000; a.shared.set(key, JSON.stringify(expired));
  const again = drafts("a@test.invalid", a.shared); again.api.begin("editor", "one", "input"); assert.equal(again.input.value, "");
  a.api.clearAll(); assert.equal(a.input.value, ""); assert.equal(a.modal.hidden, true); assert.equal(a.shared.size, 0);
});
test("draft storage failure warns before closing and topmost CRM is tracked independently", () => {
  const a = drafts("a@test.invalid", new Map(), false);
  a.window.sessionStorage.setItem = () => { throw Error("quota"); };
  a.api.begin("editor", "one", "input"); a.input.value = "새내용";
  assert.equal(a.api.canClose("editor"), false); assert.equal(a.api.top(), "editor");
  a.api.begin("activity", "two", "input"); assert.equal(a.api.top(), "activity");
  a.api.closed("activity"); assert.equal(a.api.top(), "editor");
});
test("customer filter includes every linked source; search keeps input and respects IME", () => {
  const code = source("operations-center-v7.js"), start = code.indexOf("function matchPropertySourceV719"), end = code.indexOf("function matchPropertyFloorV719", start);
  const includes = new Function("text", code.slice(start, end) + ";return matchPropertyIncludesSourceV1;")((v) => String(v||"").trim());
  const property = {sourceTypesV8:["danggeun","naver"]};
  assert.equal(includes(property,"naver"),true); assert.equal(includes(property,"danggeun"),true); assert.equal(includes(property,"gongsil"),false);
  assert.match(code, /event\.isComposing \|\| searchInput\._composingV1/);
  assert.doesNotMatch(code, /next\.setSelectionRange\(next\.value\.length/);
  assert.match(code, /current\.replaceWith\(next\)/);
});
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
