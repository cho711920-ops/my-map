const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/unified-favorites-v7.js", "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function createApp() {
  const elements = new Map();
  const calls = { confirm: [], save: [], filter: [], focus: 0 };
  let folders = [
    { id: "folder-a", name: "광택세차", itemKeys: ["property:A", "property:B"], updatedAt: "2026-09-22T00:00:00Z" },
    { id: "folder-b", name: "다른 고객", itemKeys: ["property:A", "property:C"], updatedAt: "2026-09-22T00:00:00Z" }
  ];
  let acceptSave = true;
  let confirmResult = true;
  let duringConfirm = () => {};
  class Element {
    constructor(id = "") {
      this.id = id;
      this.attrs = {};
      this.style = {};
      this._html = "";
      this.textContent = "";
      const classes = new Set();
      this.classList = {
        add: (...values) => values.forEach((value) => classes.add(value)),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
        contains: (value) => classes.has(value),
        toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
      };
      if (id) elements.set(id, this);
    }
    set innerHTML(value) {
      this._html = value;
      for (const match of value.matchAll(/\bid="([^"]+)"/g)) {
        const child = elements.get(match[1]) || new Element(match[1]);
        child.parentNode = this;
      }
    }
    get innerHTML() { return this._html; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    querySelector() { return null; }
    appendChild(child) { child.parentNode = this; if (child.id) elements.set(child.id, child); }
    addEventListener() {}
    remove() { elements.delete(this.id); }
  }
  const document = {
    documentElement: new Element(),
    body: new Element(),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    createElement: () => new Element()
  };
  const window = {
    JSAuthenticatedAccountEmail: "agent@example.com",
    favoriteOnly: true,
    activeFavoriteFolderId: "folder-a",
    activeFavoriteFolderName: "광택세차",
    favoriteFilterKeys: folders[0].itemKeys.slice(),
    allItems: [
      { propertyId: "A", key: "legacy-a", name: "일반상가", address: "서구 갈마동 337-14", room: "1층" },
      { propertyId: "B", key: "legacy-b", name: "일반상가", address: "서구 갈마동 337-14", room: "1층" },
      { propertyId: "C", key: "legacy-c", name: "일반상가", address: "중구 중촌동 9-8", room: "1층" },
      { key: "legacy-only", name: "구형 매물", address: "동구 삼성동 387-7", room: "1층" }
    ],
    document,
    JSV6ListStore: {
      load: (type) => type === "favorite" ? folders : [],
      save: (type, next) => {
        calls.save.push({ type, next, review: window.jsFavoriteMapRemovalInProgressV1 });
        if (!acceptSave) return false;
        folders = next;
        return true;
      },
      getItem: (ref) => window.allItems.find((item) => item.key === ref) || null
    },
    confirm: (message) => {
      calls.confirm.push(message);
      duringConfirm();
      return confirmResult;
    },
    applyFilter: () => calls.filter.push({ review: window.jsFavoriteMapRemovalInProgressV1 }),
    JSDialogFocusV1: { activate: () => { calls.focus += 1; } },
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame: (callback) => callback(),
    addEventListener() {}
  };
  vm.runInNewContext(source, { window, document, console, Date, Number });
  return {
    window, document, calls, elements,
    get folders() { return folders; },
    set folders(next) { folders = next; },
    set acceptSave(value) { acceptSave = value; },
    set confirmResult(value) { confirmResult = value; },
    set duringConfirm(callback) { duringConfirm = callback; },
    context(item = window.allItems[0]) { return window.getFavoriteMapRemovalContextV1(item); },
    remove(folder = "folder-a", ref = "property:A") {
      return window.removeFavoriteMapItemV1(encodeURIComponent(folder), encodeURIComponent(ref));
    }
  };
}

test("removal context requires an active favorite folder and membership, not an ordinary list", () => {
  const app = createApp();
  assert.deepEqual(plain(app.context()), { folderId: "folder-a", folderName: "광택세차", ref: "property:A" });
  app.window.favoriteOnly = false;
  assert.equal(app.context(), null);
  assert.equal(app.remove(), false);
  app.window.favoriteOnly = true;
  app.window.activeFavoriteFolderId = "";
  assert.equal(app.context(), null);
  assert.equal(app.remove(), false);
  app.window.activeFavoriteFolderId = "missing-folder";
  assert.equal(app.context(), null);
  assert.equal(app.remove(), false);
  app.window.activeFavoriteFolderId = "folder-a";
  assert.equal(app.context(app.window.allItems[2]), null);
  assert.equal(app.remove("folder-a", "property:C"), false);
  assert.equal(app.context({ name: "unidentified" }), null);
  assert.equal(app.calls.confirm.length, 0);
  assert.equal(app.calls.save.length, 0);
});

test("canonical and legacy references resolve to the same property without matching another property at the same address", () => {
  const app = createApp();
  app.folders[0].itemKeys = ["legacy-a", "property:A"];
  assert.equal(app.context().ref, "property:A");
  assert.equal(app.context(app.window.allItems[1]), null);
  assert.equal(app.remove("folder-a", "property:B"), false);
  assert.equal(app.remove("folder-a", "legacy-a"), true);
  assert.deepEqual(Array.from(app.folders[0].itemKeys), []);
  assert.deepEqual(Array.from(app.folders[1].itemKeys), ["property:A", "property:C"]);
});

test("a legacy-only listing can be removed without a property ID", () => {
  const app = createApp();
  app.folders[0].itemKeys.push("legacy-only");
  assert.equal(app.context(app.window.allItems[3]).ref, "legacy-only");
  assert.equal(app.remove("folder-a", "legacy-only"), true);
  assert.deepEqual(Array.from(app.folders[0].itemKeys), ["property:A", "property:B"]);
});

test("cancel leaves all folders, active scope, and original listings unchanged", () => {
  const app = createApp();
  app.confirmResult = false;
  const before = plain(app.folders);
  const originalItems = plain(app.window.allItems);
  assert.equal(app.remove(), false);
  assert.deepEqual(plain(app.folders), before);
  assert.deepEqual(plain(app.window.allItems), originalItems);
  assert.deepEqual(app.window.favoriteFilterKeys, ["property:A", "property:B"]);
  assert.equal(app.calls.confirm.length, 1);
  assert.equal(app.calls.save.length, 0);
  assert.equal(app.calls.filter.length, 0);
});

test("confirm removes from exactly the displayed folder, retains same-address property and other folders, and does not open a modal", () => {
  const app = createApp();
  const originals = plain(app.window.allItems);
  const otherFolder = app.folders[1];
  const oldFolder = app.folders[0];
  assert.equal(app.elements.has("unifiedFavoriteModalV7"), false);
  assert.equal(app.remove(), true);
  assert.equal(app.calls.save.length, 1);
  assert.equal(app.calls.save[0].type, "favorite");
  assert.equal(app.calls.save[0].review, true);
  assert.deepEqual(Array.from(app.folders[0].itemKeys), ["property:B"]);
  assert.deepEqual(oldFolder.itemKeys, ["property:A", "property:B"], "cached input snapshot was not mutated");
  assert.equal(app.folders[1], otherFolder);
  assert.deepEqual(otherFolder.itemKeys, ["property:A", "property:C"]);
  assert.deepEqual(plain(app.window.allItems), originals);
  assert.deepEqual(Array.from(app.window.favoriteFilterKeys), ["property:B"]);
  assert.equal(app.window.activeFavoriteFolderId, "folder-a");
  assert.equal(app.window.favoriteOnly, true);
  assert.match(app.calls.confirm[0], /"광택세차" 폴더/);
  assert.match(app.calls.confirm[0], /서구 갈마동 337-14 · 1층/);
  assert.match(app.calls.confirm[0], /현재 폴더에서만 제거/);
  assert.match(app.calls.confirm[0], /매물 원본과 다른 찜폴더는 유지/);
  assert.deepEqual(app.calls.filter, [{ review: true }]);
  assert.equal(app.window.jsFavoriteMapRemovalInProgressV1, undefined);
  assert.equal(app.elements.get("unifiedFavoriteModalV7").classList.contains("open"), false);
  assert.equal(app.document.body.classList.contains("lm-modal-open"), false);
  assert.equal(app.calls.focus, 0);
});

test("a stale row cannot remove from a different active folder even when that folder contains the same listing", () => {
  const app = createApp();
  app.window.activeFavoriteFolderId = "folder-b";
  assert.equal(app.remove("folder-a", "property:A"), false);
  assert.equal(app.calls.confirm.length, 0);
  assert.equal(app.calls.save.length, 0);
  assert.deepEqual(app.folders[1].itemKeys, ["property:A", "property:C"]);
});

test("changed or cleared account rejects a stale removal before asking for confirmation", () => {
  for (const nextEmail of ["other@example.com", ""]) {
    const app = createApp();
    app.window.JSAuthenticatedAccountEmail = nextEmail;
    assert.equal(app.context(), null, `account ${JSON.stringify(nextEmail)} is not the original account`);
    assert.equal(app.remove(), false);
    assert.equal(app.calls.confirm.length, 0);
    assert.equal(app.calls.save.length, 0);
  }
});

test("account comparison is normalized for case and surrounding whitespace", () => {
  const app = createApp();
  app.window.JSAuthenticatedAccountEmail = "  AGENT@EXAMPLE.COM  ";
  assert.notEqual(app.context(), null);
  assert.equal(app.remove(), true);
});

test("folder, filter, account and membership are rechecked after confirmation", () => {
  const changes = [
    (app) => { app.window.activeFavoriteFolderId = "folder-b"; },
    (app) => { app.window.favoriteOnly = false; },
    (app) => { app.window.JSAuthenticatedAccountEmail = "other@example.com"; },
    (app) => { app.window.JSAuthenticatedAccountEmail = ""; },
    (app) => { app.folders = app.folders.filter((folder) => folder.id !== "folder-a"); },
    (app) => { app.folders[0].itemKeys = ["property:B"]; }
  ];
  for (const change of changes) {
    const app = createApp();
    let expectedAfterChange;
    app.duringConfirm = () => { change(app); expectedAfterChange = plain(app.folders); };
    assert.equal(app.remove(), false);
    assert.equal(app.calls.confirm.length, 1);
    assert.equal(app.calls.save.length, 0);
    assert.equal(app.calls.filter.length, 0);
    assert.deepEqual(plain(app.folders), expectedAfterChange);
  }
});

test("malformed URI arguments and missing targets fail without throwing or changing folders", () => {
  const app = createApp();
  const before = plain(app.folders);
  for (const args of [["%", "property%3AA"], ["folder-a", "%E0%A4%A"], ["", ""], ["folder-a", "property%3Amissing"]]) {
    assert.equal(app.window.removeFavoriteMapItemV1(...args), false);
  }
  assert.deepEqual(plain(app.folders), before);
  assert.equal(app.calls.confirm.length, 0);
  assert.equal(app.calls.save.length, 0);
});

test("save returning false leaves live cached folders and filter keys untouched", () => {
  const app = createApp();
  app.acceptSave = false;
  const liveFolders = app.folders;
  const liveFolder = app.folders[0];
  const liveRefs = liveFolder.itemKeys;
  const before = plain(app.folders);
  app.window.jsFavoriteMapRemovalInProgressV1 = "previous-value";
  assert.equal(app.remove(), false);
  assert.equal(app.folders, liveFolders);
  assert.equal(app.folders[0], liveFolder);
  assert.equal(app.folders[0].itemKeys, liveRefs);
  assert.deepEqual(plain(app.folders), before);
  assert.deepEqual(app.window.favoriteFilterKeys, ["property:A", "property:B"]);
  assert.equal(app.calls.save.length, 1);
  assert.equal(app.calls.filter.length, 0);
  assert.equal(app.window.jsFavoriteMapRemovalInProgressV1, "previous-value");
  assert.match(app.elements.get("unifiedFavoriteToastV7").textContent, /저장하지 못했습니다/);
});

test("removing the last folder item keeps that empty folder active instead of showing other favorites", () => {
  const app = createApp();
  app.folders[0].itemKeys = ["property:A"];
  app.window.favoriteFilterKeys = ["property:A"];
  assert.equal(app.remove(), true);
  assert.equal(app.folders.length, 2);
  assert.deepEqual(Array.from(app.folders[0].itemKeys), []);
  assert.equal(app.window.activeFavoriteFolderId, "folder-a");
  assert.equal(app.window.favoriteOnly, true);
  assert.deepEqual(Array.from(app.window.favoriteFilterKeys), []);
  assert.deepEqual(app.folders[1].itemKeys, ["property:A", "property:C"]);
  assert.equal(app.remove(), false, "a second click on the stale removed row does nothing");
  assert.equal(app.calls.confirm.length, 1);
  assert.equal(app.calls.save.length, 1);
});

function installSelectedDetail(app, propertyId) {
  const detail = { openPropertyId: propertyId, selectedPropertyId: propertyId, closeCount: 0, clearCount: 0 };
  app.window.JSUnifiedListingsV8 = {
    isOpenForProperty: (id) => detail.openPropertyId === id,
    close: () => { detail.openPropertyId = ""; detail.closeCount += 1; }
  };
  app.window.isLinkedListingSelectedV845 = (item) => detail.selectedPropertyId === item.propertyId;
  app.window.clearLinkedListingSelectionV845 = () => {
    detail.selectedPropertyId = "";
    detail.clearCount += 1;
  };
  return detail;
}

test("cancel and failed save preserve the currently inspected detail and linked selection", () => {
  for (const outcome of ["cancel", "save-failure"]) {
    const app = createApp();
    const detail = installSelectedDetail(app, "A");
    if (outcome === "cancel") app.confirmResult = false;
    else app.acceptSave = false;
    assert.equal(app.remove(), false);
    assert.deepEqual(detail, { openPropertyId: "A", selectedPropertyId: "A", closeCount: 0, clearCount: 0 }, outcome);
    assert.deepEqual(app.folders[0].itemKeys, ["property:A", "property:B"]);
    assert.equal(app.calls.filter.length, 0);
  }
});

test("successful map removal closes only the removed property's detail before filtering; another property and ordinary modal removal stay open", () => {
  for (const scenario of ["matching-detail", "another-detail", "ordinary-modal"]) {
    const app = createApp();
    const inspectedId = scenario === "another-detail" ? "B" : "A";
    const detail = installSelectedDetail(app, inspectedId);
    let stateAtFilter;
    app.window.applyFilter = () => { stateAtFilter = { ...detail }; };
    const result = scenario === "ordinary-modal"
      ? app.window.removeUnifiedFavoriteItemV7("folder-a", encodeURIComponent("property:A"))
      : app.remove();
    assert.equal(result, true);
    assert.deepEqual(Array.from(app.folders[0].itemKeys), ["property:B"]);
    const expected = scenario === "matching-detail"
      ? { openPropertyId: "", selectedPropertyId: "", closeCount: 1, clearCount: 1 }
      : { openPropertyId: inspectedId, selectedPropertyId: inspectedId, closeCount: 0, clearCount: 0 };
    assert.deepEqual(detail, expected, scenario);
    assert.deepEqual(stateAtFilter, expected, "cleanup happens before map redraw can capture stale selection");
  }
});
