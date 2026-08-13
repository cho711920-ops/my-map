const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const window = {
  innerWidth: 1280,
  addEventListener() {}
};
const context = {
  window,
  console,
  URLSearchParams,
  fetch() { throw new Error("network must not be used in this test"); }
};

vm.createContext(context);
vm.runInContext(source, context);

const items = [{propertyId: "MASTER-1", sourceLink: ""}];
window.JSUnifiedListingsV8.attach(items, {
  groups: {
    "MASTER-1": [
      {originalId: "NAVER-1", propertyId: "MASTER-1", source: "Naver", thumbnail: "naver.jpg"},
      {originalId: "GONGSIL-1", propertyId: "MASTER-1", source: "Gongsil", thumbnail: "gongsil.jpg"},
      {originalId: "DAANGN-1", propertyId: "MASTER-1", source: "Daangn", thumbnail: "daangn.jpg"},
      {originalId: "DAANGN-2", propertyId: "MASTER-1", source: "Karrot", thumbnail: "daangn-2.jpg"}
    ]
  }
});

assert.deepEqual(
  Array.from(items[0].unifiedOriginalsV8, original => original.originalId),
  ["DAANGN-1", "DAANGN-2", "NAVER-1", "GONGSIL-1"]
);
assert.equal(items[0].thumbnailV8, "daangn.jpg");

const card = window.JSUnifiedListingsV8.cardParts(items[0]);
assert.match(card.thumbnail, /daangn\.jpg/);
assert.doesNotMatch(card.thumbnail, /naver\.jpg/);

const naverOnlyItems = [{propertyId: "MASTER-2", sourceLink: ""}];
window.JSUnifiedListingsV8.attach(naverOnlyItems, {
  groups: {
    "MASTER-2": [
      {originalId: "NAVER-NO-PHOTO", propertyId: "MASTER-2", source: "Naver", thumbnail: ""},
      {originalId: "NAVER-WITH-PHOTO", propertyId: "MASTER-2", source: "Naver", thumbnail: "naver-photo.jpg"},
      {originalId: "GONGSIL-NO-PHOTO", propertyId: "MASTER-2", source: "Gongsil", thumbnail: ""}
    ]
  }
});

assert.deepEqual(
  Array.from(naverOnlyItems[0].unifiedOriginalsV8, original => original.originalId),
  ["NAVER-WITH-PHOTO", "NAVER-NO-PHOTO", "GONGSIL-NO-PHOTO"]
);
assert.equal(naverOnlyItems[0].thumbnailV8, "naver-photo.jpg");
assert.match(window.JSUnifiedListingsV8.cardParts(naverOnlyItems[0]).thumbnail, /naver-photo\.jpg/);

const daangnPhotoItems = [{propertyId: "MASTER-3", sourceLink: ""}];
window.JSUnifiedListingsV8.attach(daangnPhotoItems, {
  groups: {
    "MASTER-3": [
      {originalId: "DAANGN-NO-PHOTO", propertyId: "MASTER-3", source: "Daangn", thumbnail: ""},
      {originalId: "DAANGN-WITH-PHOTO", propertyId: "MASTER-3", source: "Karrot", thumbnail: "daangn-photo.jpg"},
      {originalId: "NAVER-WITH-PHOTO-2", propertyId: "MASTER-3", source: "Naver", thumbnail: "naver-photo-2.jpg"}
    ]
  }
});

assert.deepEqual(
  Array.from(daangnPhotoItems[0].unifiedOriginalsV8, original => original.originalId),
  ["DAANGN-WITH-PHOTO", "DAANGN-NO-PHOTO", "NAVER-WITH-PHOTO-2"]
);
assert.equal(daangnPhotoItems[0].thumbnailV8, "daangn-photo.jpg");

const preservedDaangnItems = [{propertyId: "MASTER-4", sourceLink: ""}];
window.JSUnifiedListingsV8.attach(preservedDaangnItems, {
  groups: {
    "MASTER-4": [
      {originalId: "GONGSIL-PRIMARY", propertyId: "MASTER-4", source: "Gongsil", thumbnail: ""},
      {originalId: "DAANGN-PRESERVED", propertyId: "MASTER-4", source: "Daangn",
        thumbnail: "daangn-preserved.jpg", preserveRepresentative: true}
    ]
  }
});

assert.deepEqual(
  Array.from(preservedDaangnItems[0].unifiedOriginalsV8, original => original.originalId),
  ["DAANGN-PRESERVED", "GONGSIL-PRIMARY"]
);
assert.equal(preservedDaangnItems[0].thumbnailV8, "daangn-preserved.jpg");

console.log("unified listing daangn priority tests passed");
