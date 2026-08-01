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

console.log("unified listing daangn priority tests passed");
