const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/unified-favorites-v7.js", "utf8");
const css = fs.readFileSync("css/phone-favorites-v2.css", "utf8");

function createApp({ phone = true, width = 390, hasMap = true } = {}) {
  const elements = new Map();
  const events = [];
  const listeners = {};
  const calls = [];
  let folders = [
    { id: "folder-a", name: "치킨집 후보", itemKeys: ["property:A", "property:B"], updatedAt: "2026-09-22T00:00:00Z" },
    { id: "folder-b", name: "비교 매물", itemKeys: ["property:C"], updatedAt: "2026-09-22T00:00:00Z" }
  ];
  class Element {
    constructor(id = "") {
      this.id = id;
      this.attrs = {};
      this.scrollTop = 0;
      this.hidden = false;
      this.style = {};
      this.value = "";
      this._html = "";
      const classes = new Set();
      this.classList = {
        add: (...values) => values.forEach((value) => classes.add(value)),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
        contains: (value) => classes.has(value),
        toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
      };
      if (id) elements.set(id, this);
    }
    set innerHTML(html) {
      this._html = html;
      if (this.id === "unifiedFavoriteBodyV7" && html.includes('id="phoneFavoriteIndexV2"')) {
        new Element("phoneFavoriteIndexV2");
        new Element("phoneFavoriteFolderScreenV2");
      }
    }
    get innerHTML() { return this._html; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    querySelector(selector) { return selector === ".unified-favorite-dialog-v7" ? dialog : null; }
    appendChild(element) { element.parentNode = this; if (element.id) elements.set(element.id, element); }
    insertBefore(element) { this.appendChild(element); }
    addEventListener() {}
    contains() { return false; }
    focus() {}
    remove() { elements.delete(this.id); }
  }
  const root = new Element();
  if (phone) root.classList.add("js-phone-app-v2");
  const body = new Element();
  const modal = new Element("unifiedFavoriteModalV7");
  modal.setAttribute("aria-hidden", "true");
  const dialog = new Element();
  const favoriteBody = new Element("unifiedFavoriteBodyV7");
  favoriteBody.parentNode = new Element();
  new Element("unifiedFavoriteSelectedV7");
  new Element("unifiedFavoriteNameV7");
  new Element("unifiedFavoriteDetailHostV7");
  new Element("favoriteBtn");
  const document = {
    documentElement: root,
    body,
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => selector === ".unified-favorite-dialog-v7" ? dialog : null,
    createElement: () => new Element()
  };
  const point = (lat, lng) => ({ getLat: () => lat, getLng: () => lng });
  const window = {
    document,
    innerWidth: width,
    innerHeight: 844,
    JSAuthenticatedAccountEmail: "test@example.com",
    allItems: [
      { propertyId: "A", name: "일반상가", address: "서구 둔산동 2002", deposit: 2000, rent: 70, area: 19.7, latlng: point(36.35, 127.38) },
      { propertyId: "B", name: "일반상가", address: "서구 탄방동 66-5", deposit: 2000, rent: 80, area: 14.5, latlng: point(36.34, 127.39) },
      { propertyId: "C", name: "좌표 없는 매물", latlng: point(NaN, 127.39) }
    ],
    JSV6ListStore: {
      load: (type) => type === "visit" ? [] : folders,
      save: (type, next) => { folders = next; return true; },
      activateFavoriteFilter: (id) => {
        const folder = folders.find((entry) => entry.id === id);
        window.activeFavoriteFolderId = id;
        window.favoriteOnly = true;
        window.favoriteFilterKeys = folder.itemKeys.slice();
      }
    },
    JSUnifiedListingsV8: { open: (id) => calls.push(["detail", id]) },
    JSMobileAppV1: { setView: (view) => calls.push(["view", view]) },
    JSDialogFocusV1: { activate: () => calls.push(["focus-activate"]), deactivate() {} },
    CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options.detail; },
    dispatchEvent: (event) => events.push(event),
    addEventListener: (type, handler) => { listeners[type] = handler; },
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame: (callback) => callback(),
    applyFilter: () => calls.push(["filter"]),
    confirm: () => true
  };
  if (hasMap) {
    window.map = {
      relayout: () => calls.push(["map-relayout"]),
      setCenter: (point) => calls.push(["map-center", point.getLat(), point.getLng()]),
      setLevel: (level) => calls.push(["map-level", level]),
      setBounds: (bounds) => calls.push(["map-bounds", bounds.points.length])
    };
    window.kakao = { maps: { LatLngBounds: function Bounds() { this.points = []; this.extend = (point) => this.points.push(point); } } };
  }
  vm.runInNewContext(source, { window, document, console, Number, Date });
  return { window, elements, root, modal, dialog, favoriteBody, events, listeners, calls, get folders() { return folders; } };
}

test("phone favorites is a dedicated folder index without AI visits and does not trap shared navigation", () => {
  const app = createApp();
  app.window.openListManager("favorite");
  assert.equal(app.dialog.getAttribute("role"), "region");
  assert.equal(app.dialog.getAttribute("aria-modal"), "false");
  assert.match(app.elements.get("phoneFavoriteIndexV2").innerHTML, /치킨집 후보/);
  assert.match(app.elements.get("phoneFavoriteIndexV2").innerHTML, /매물 2개/);
  assert.doesNotMatch(app.elements.get("phoneFavoriteIndexV2").innerHTML, /AI임장|startUnifiedFavoriteVisit/);
  assert.equal(app.elements.get("phoneFavoriteFolderScreenV2").hidden, true);
  assert.equal(app.window.JSPhoneFavoritesV2.isOpen(), true);
  assert.equal(app.events.at(-1).detail.open, true);
  assert.equal(app.calls.some(([name]) => name === "focus-activate"), false);
});

test("folder screen identity survives refresh, detail and return; folder and index have independent scroll", () => {
  const app = createApp();
  app.window.openListManager("favorite");
  app.favoriteBody.scrollTop = 140;
  app.window.JSPhoneFavoritesV2.showFolder("folder-a");
  const screen = app.elements.get("phoneFavoriteFolderScreenV2");
  assert.equal(screen.hidden, false);
  assert.match(screen.innerHTML, /저장 매물 2개/);
  assert.match(screen.innerHTML, /지도 보기/);
  assert.doesNotMatch(screen.innerHTML, /AI임장|startUnifiedFavoriteVisit/);
  app.favoriteBody.scrollTop = 350;
  app.window.openUnifiedFavoriteItemV7(encodeURIComponent("property:A"));
  assert.deepEqual(app.calls.at(-1), ["detail", "A"]);
  assert.equal(app.modal.classList.contains("open"), true);
  assert.equal(app.window.JSPhoneFavoritesV2.getState().folderId, "folder-a");
  assert.equal(app.favoriteBody.scrollTop, 350);
  app.listeners["js-v6-list-store-change"]({ detail: { type: "favorite" } });
  assert.equal(app.elements.get("phoneFavoriteFolderScreenV2"), screen);
  assert.equal(app.favoriteBody.scrollTop, 350);
  assert.equal(app.window.JSPhoneFavoritesV2.back(), true);
  assert.equal(app.favoriteBody.scrollTop, 140);
  assert.equal(screen.hidden, true);
  app.window.JSPhoneFavoritesV2.showFolder("folder-a");
  assert.equal(app.favoriteBody.scrollTop, 350);
  app.window.JSPhoneFavoritesV2.back();
  app.window.JSPhoneFavoritesV2.back();
  assert.equal(app.window.JSPhoneFavoritesV2.isOpen(), false);
});

test("folder map applies exact stored references, activates map and preserves folder scope on return", () => {
  const app = createApp();
  app.window.openListManager("favorite");
  app.window.JSPhoneFavoritesV2.showFolder("folder-a");
  app.favoriteBody.scrollTop = 280;
  app.window.showUnifiedFavoriteOnMapV7("folder-a");
  assert.equal(app.window.JSPhoneFavoritesV2.isOpen(), false);
  assert.equal(app.elements.get("phoneFavoriteFolderScreenV2").hidden, true);
  assert.equal(app.window.activeFavoriteFolderId, "folder-a");
  assert.deepEqual(app.window.favoriteFilterKeys, ["property:A", "property:B"]);
  assert.equal(app.window.favoriteOnly, true);
  assert.ok(app.calls.some(([name, value]) => name === "view" && value === "map"));
  assert.ok(app.calls.some(([name, value]) => name === "map-bounds" && value === 2));
  app.favoriteBody.scrollTop = 0; // A hidden scrollport may be reset by the browser.
  app.window.openListManager("favorite");
  assert.equal(app.window.JSPhoneFavoritesV2.getState().folderId, "folder-a");
  assert.equal(app.favoriteBody.scrollTop, 280);
});

test("map fitting skips invalid coordinates and tolerates missing map SDK", () => {
  const app = createApp();
  app.window.showUnifiedFavoriteOnMapV7("folder-b");
  assert.equal(app.calls.some(([name]) => name === "map-bounds" || name === "map-center"), false);
  const withoutSdk = createApp({ hasMap: false });
  assert.doesNotThrow(() => withoutSdk.window.showUnifiedFavoriteOnMapV7("folder-a"));
  assert.equal(withoutSdk.window.activeFavoriteFolderId, "folder-a");
});

test("removal and cloud deletion keep normal save behavior and safely return missing folders to index", () => {
  const app = createApp();
  app.window.openListManager("favorite");
  app.window.JSPhoneFavoritesV2.showFolder("folder-a");
  app.window.removeUnifiedFavoriteItemV7("folder-a", encodeURIComponent("property:A"));
  assert.deepEqual(Array.from(app.folders[0].itemKeys), ["property:B"]);
  assert.equal(app.window.JSPhoneFavoritesV2.getState().folderId, "folder-a");
  app.window.deleteUnifiedFavoriteFolderV7("folder-a");
  assert.equal(app.window.JSPhoneFavoritesV2.getState().folderId, "");
  assert.equal(app.elements.get("phoneFavoriteFolderScreenV2").hidden, true);
  assert.match(app.elements.get("phoneFavoriteIndexV2").innerHTML, /비교 매물/);
});

test("narrow tablet or desktop without phone class retains the existing favorites UI and flow", () => {
  const app = createApp({ phone: false, width: 700 });
  app.window.openListManager("favorite");
  assert.match(app.favoriteBody.innerHTML, /AI임장하기/);
  assert.match(app.favoriteBody.innerHTML, /unified-favorite-folder-grid-v7/);
  assert.equal(app.elements.has("phoneFavoriteFolderScreenV2"), false);
  assert.equal(app.window.JSPhoneFavoritesV2.isOpen(), false);
  assert.equal(app.window.JSPhoneFavoritesV2.showFolder("folder-a"), false);
  app.window.openUnifiedFavoriteItemV7(encodeURIComponent("property:A"));
  assert.equal(app.modal.classList.contains("open"), false);
  assert.deepEqual(app.calls.at(-1), ["detail", "A"]);
});

test("every new style selector is smartphone class scoped, with no width-only activation", () => {
  assert.doesNotMatch(css, /@media/);
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of withoutComments.split("}")) {
    if (!block.includes("{")) continue;
    const selectors = block.slice(0, block.indexOf("{")).trim().split(",");
    for (const selector of selectors) assert.match(selector.trim(), /^\.js-phone-app-v2\s/);
  }
  assert.match(css, /min-height: 44px/);
  assert.match(css, /font-size: 16px/);
});
