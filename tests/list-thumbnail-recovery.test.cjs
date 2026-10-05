const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/unified-listings-v8.js"), "utf8");
const original = "https://landthumb-phinf.pstatic.net/20261005/listing.jpg?type=m180&quality=80";
const proxyFor = (url) => "/api/listing-image?url=" + encodeURIComponent(new URL(url).toString());

function classList(...initial) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

function imageNode(url, attribute = "data-thumbnail-source-v8144") {
  const attributes = new Map([["src", url], [attribute, url]]);
  const writes = [];
  let display = "", displayPriority = "";
  const style = {
    setProperty(name, value, priority = "") {
      assert.equal(name, "display");
      display = String(value);
      displayPriority = String(priority);
    },
    getPropertyPriority(name) { return name === "display" ? displayPriority : ""; }
  };
  Object.defineProperty(style, "display", {
    enumerable: true,
    get() { return display; },
    set(value) { display = String(value); displayPriority = ""; }
  });
  const image = {
    style, writes,
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    remove() {
      const parent = this.parentElement;
      if (parent) parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
    }
  };
  Object.defineProperty(image, "src", {
    get() { return attributes.get("src"); },
    set(value) { writes.push(String(value)); attributes.set("src", String(value)); }
  });
  return image;
}

function thumbnail(url = original) {
  const image = imageNode(url);
  const ribbon = { kind: "transaction-ribbon", textContent: "광고 미노출 확인 필요" };
  const checkbox = { kind: "visit-checkbox", checked: true };
  const parent = {
    classList: classList("unified-thumb-v8", "has-photo", "selected"),
    children: [image, ribbon, checkbox],
    querySelector(selector) {
      if (selector === "[data-thumbnail-error-v8144]") {
        return this.children.find((child) => child.kind === "thumbnail-error") || null;
      }
      return null;
    },
    insertAdjacentHTML(position, html) {
      assert.equal(position, "beforeend");
      assert.match(html, /data-thumbnail-error-v8144/);
      const label = {
        kind: "thumbnail-error", textContent: html.replace(/<[^>]*>/g, ""),
        remove() { parent.children.splice(parent.children.indexOf(this), 1); }
      };
      this.children.push(label);
    }
  };
  image.parentElement = parent;
  return { image, parent, ribbon, checkbox };
}

function runtime(images = []) {
  let scans = 0;
  const document = {
    getElementById() { return null; },
    addEventListener() {},
    querySelectorAll(selector) {
      assert.equal(selector, ".unified-thumb-v8 img[data-thumbnail-source-v8144]");
      scans += 1;
      return images;
    }
  };
  const forbidden = () => { throw new Error("thumbnail recovery must not reload listings or write data"); };
  const selected = { propertyId: "P1", name: "원본 매물", selected: true };
  const window = {
    document, innerWidth: 1280, location: { href: "https://js-map.com/" },
    addEventListener() {}, setTimeout() {}, clearTimeout() {},
    allItems: [selected], currentItems: [selected], selectedItemKey: "P1",
    JSDataAccessV6: { read: forbidden, write: forbidden },
    renderList: forbidden, loadSheet: forbidden, fetch: forbidden
  };
  vm.runInNewContext(source, { window, document, URL, Promise, console, fetch: forbidden });
  return { api: window.JSUnifiedListingsV8, window, selected, scans: () => scans };
}

test("healthy thumbnails issue no recovery request or document scan", () => {
  const card = thumbnail();
  const { api, scans } = runtime([card.image]);
  api.thumbnailImageLoaded(card.image);
  assert.deepEqual(card.image.writes, []);
  assert.equal(scans(), 0);
  assert.equal(card.parent.classList.contains("has-photo"), true);
  assert.equal(card.parent.classList.contains("no-photo"), false);
  assert.equal(card.image.getAttribute("data-thumbnail-source-v8144"), original);
});

test("first failed thumbnail uses the authenticated image proxy exactly once", () => {
  const card = thumbnail();
  const { api } = runtime([card.image]);
  api.thumbnailImageError(card.image);
  assert.deepEqual(card.image.writes, [proxyFor(original)]);
  assert.equal(card.image.getAttribute("data-thumbnail-source-v8144"), original);
  assert.equal(card.image.parentElement, card.parent);
  assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]"), null);

  for (let index = 0; index < 8; index += 1) api.thumbnailImageError(card.image);
  assert.deepEqual(card.image.writes, [proxyFor(original)]);
  assert.equal(card.image.style.display, "none");
  assert.equal(card.image.style.getPropertyPriority("display"), "important");
  assert.equal(card.parent.classList.contains("no-photo"), true);
  assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]").textContent, "사진 불러오기 실패");
  assert.equal(card.parent.children.filter((child) => child.kind === "thumbnail-error").length, 1);
  assert.equal(card.parent.children.includes(card.image), true);
});

test("all four supported image providers use a bounded proxy retry", () => {
  for (const host of ["img.kr.gcp-karroter.net", "landthumb-phinf.pstatic.net", "dnvefa72aowie.cloudfront.net", "file1.gongsilbox.com"]) {
    const url = "https://" + host + "/images/a.jpg?x=1&y=2";
    const card = thumbnail(url);
    const { api } = runtime([card.image]);
    api.thumbnailImageError(card.image);
    api.thumbnailImageError(card.image);
    assert.deepEqual(card.image.writes, [proxyFor(url)], host);
  }
});

test("untrusted, non-HTTPS, credentialed, custom-port and malformed sources never reach the proxy", () => {
  const rejected = [
    "http://landthumb-phinf.pstatic.net/photo.jpg",
    "https://landthumb-phinf.pstatic.net.evil.invalid/photo.jpg",
    "https://sub.landthumb-phinf.pstatic.net/photo.jpg",
    "https://landthumb-phinf.pstatic.net@evil.invalid/photo.jpg",
    "https://user:secret@landthumb-phinf.pstatic.net/photo.jpg",
    "https://landthumb-phinf.pstatic.net:8443/photo.jpg",
    "https://127.0.0.1/photo.jpg", "//landthumb-phinf.pstatic.net/photo.jpg",
    "/photo.jpg", "data:image/png;base64,AAAA", "javascript:alert(1)", "not a URL", ""
  ];
  const { api } = runtime();
  for (const url of rejected) {
    const card = thumbnail(url);
    api.thumbnailImageError(card.image);
    api.thumbnailImageError(card.image);
    assert.deepEqual(card.image.writes, [], url);
    assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]").textContent, "사진 불러오기 실패", url);
  }
});

test("successful late load restores only photo presentation, preserving ribbon and selection", () => {
  const card = thumbnail();
  const { api, window, selected } = runtime([card.image]);
  api.thumbnailImageError(card.image);
  api.thumbnailImageError(card.image);
  api.thumbnailImageLoaded(card.image);
  api.thumbnailImageLoaded(card.image);

  assert.equal(card.image.style.display, "");
  assert.equal(card.image.style.getPropertyPriority("display"), "");
  assert.equal(card.parent.classList.contains("has-photo"), true);
  assert.equal(card.parent.classList.contains("no-photo"), false);
  assert.equal(card.parent.classList.contains("selected"), true);
  assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]"), null);
  assert.deepEqual(card.parent.children, [card.image, card.ribbon, card.checkbox]);
  assert.equal(card.checkbox.checked, true);
  assert.equal(window.allItems[0], selected);
  assert.equal(window.currentItems[0], selected);
  assert.equal(window.selectedItemKey, "P1");
  assert.equal(card.image.getAttribute("data-thumbnail-source-v8144"), original);
  assert.deepEqual(card.image.writes, [proxyFor(original)]);
});

test("a working detail image repairs only failed list thumbnails with the exact canonical source", () => {
  const matching = thumbnail();
  const matchingSecond = thumbnail();
  const healthy = thumbnail();
  const differentPhoto = thumbnail(original.replace("listing.jpg", "listing2.jpg"));
  const differentQuery = thumbnail(original + "&other=1");
  const cards = [matching, matchingSecond, healthy, differentPhoto, differentQuery];
  const { api } = runtime(cards.map((card) => card.image));
  for (const card of [matching, matchingSecond, differentPhoto, differentQuery]) {
    api.thumbnailImageError(card.image);
    api.thumbnailImageError(card.image);
  }
  const detail = imageNode(original, "data-detail-source-v8144");
  api.detailImageLoaded(detail);
  for (const card of [matching, matchingSecond]) {
    assert.deepEqual(card.image.writes, [proxyFor(original), original]);
    api.thumbnailImageLoaded(card.image);
    assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]"), null);
  }
  assert.deepEqual(healthy.image.writes, []);
  assert.equal(differentPhoto.image.writes.length, 1);
  assert.equal(differentQuery.image.writes.length, 1);
});

test("detail recovery accepts the verified proxy display URL but not an unrelated replacement", () => {
  const card = thumbnail();
  const { api, scans } = runtime([card.image]);
  api.thumbnailImageError(card.image);
  api.thumbnailImageError(card.image);
  const detail = imageNode(original, "data-detail-source-v8144");
  detail.src = "https://evil.invalid/other-listing.jpg";
  api.detailImageLoaded(detail);
  assert.equal(scans(), 0);
  assert.deepEqual(card.image.writes, [proxyFor(original)]);

  detail.src = proxyFor(original);
  api.detailImageLoaded(detail);
  assert.deepEqual(card.image.writes, [proxyFor(original), proxyFor(original)]);
  api.thumbnailImageLoaded(card.image);
  assert.equal(card.image.style.display, "");
  assert.equal(card.parent.classList.contains("has-photo"), true);
});

test("repeated detail load events cannot start unbounded retries after the same recovery fails", () => {
  const card = thumbnail();
  const { api } = runtime([card.image]);
  api.thumbnailImageError(card.image);
  api.thumbnailImageError(card.image);
  const detail = imageNode(original, "data-detail-source-v8144");
  for (let index = 0; index < 8; index += 1) {
    api.detailImageLoaded(detail);
    api.thumbnailImageError(card.image);
  }
  assert.deepEqual(card.image.writes, [proxyFor(original), original]);
  detail.src = proxyFor(original);
  for (let index = 0; index < 8; index += 1) {
    api.detailImageLoaded(detail);
    api.thumbnailImageError(card.image);
  }
  assert.deepEqual(card.image.writes, [proxyFor(original), original, proxyFor(original)]);
  assert.equal(card.image.style.display, "none");
  assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]").textContent, "사진 불러오기 실패");
});

test("detail success while the first retry is pending can recover the original without removing the list card", () => {
  const card = thumbnail();
  const { api } = runtime([card.image]);
  api.thumbnailImageError(card.image);
  const detail = imageNode(original, "data-detail-source-v8144");
  api.detailImageLoaded(detail);
  api.thumbnailImageLoaded(card.image);
  assert.deepEqual(card.image.writes, [proxyFor(original), original]);
  assert.equal(card.image.parentElement, card.parent);
  assert.equal(card.parent.classList.contains("has-photo"), true);
  assert.equal(card.parent.querySelector("[data-thumbnail-error-v8144]"), null);
});

test("missing image URLs still render true photo absence; photo cards wire recovery without eager proxying", () => {
  const { api } = runtime();
  const empty = api.cardParts({ propertyId: "EMPTY" }).thumbnail;
  assert.match(empty, /no-photo/);
  assert.match(empty, /<span>사진 없음<\/span>/);
  assert.doesNotMatch(empty, /<img|thumbnailImageError|listing-image/);

  api.attach([], { ok: true, groups: { P1: [{ source: "naver", thumbnail: original, sourceUnavailable: true }] } });
  const populated = api.cardParts({ propertyId: "P1" }).thumbnail;
  assert.match(populated, /data-thumbnail-source-v8144=/);
  assert.match(populated, /onload="JSUnifiedListingsV8\.thumbnailImageLoaded\(this\)"/);
  assert.match(populated, /onerror="JSUnifiedListingsV8\.thumbnailImageError\(this\)"/);
  assert.match(populated, /transaction-check-ribbon-v8135/);
  assert.doesNotMatch(populated, /listing-image|사진 없음/);
  assert.match(source, /onload="JSUnifiedListingsV8\.detailImageLoaded\(this\)"/);
});

test("null, detached images and detail nodes without a source are harmless", () => {
  const { api, scans } = runtime();
  for (const image of [null, imageNode(original)]) {
    assert.doesNotThrow(() => api.thumbnailImageError(image));
    assert.doesNotThrow(() => api.thumbnailImageLoaded(image));
  }
  assert.doesNotThrow(() => api.detailImageLoaded(null));
  assert.doesNotThrow(() => api.detailImageLoaded(imageNode("", "data-detail-source-v8144")));
  assert.equal(scans(), 0);
});
