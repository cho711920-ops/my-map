const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function sourceBetween(start, end) {
  const startIndex = script.indexOf(start);
  const endIndex = script.indexOf(end, startIndex);
  assert(startIndex >= 0, `${start} was not found`);
  assert(endIndex > startIndex, `${end} was not found after ${start}`);
  return script.slice(startIndex, endIndex);
}

const sourceLinkBlock = sourceBetween(
  "function openPropertySourceLink(",
  "function openKakaoRoadviewAtPosition("
);
const contactPopupBlock = sourceBetween(
  "function openListContactPopupV654(",
  "function addListItem("
);

assert(
  sourceLinkBlock.includes("getPropertyByEncodedKeyV630(encodedTarget)"),
  "source links must resolve the exact property ID target"
);
assert(
  contactPopupBlock.includes("getPropertyByEncodedKeyV630(encodedTarget)"),
  "contact popups must resolve the exact property ID target"
);
assert(
  script.includes("openPropertySourceLink(\\'' + encodedEditTargetV648 + '\\')"),
  "list link buttons must carry the property ID target"
);
assert(
  script.includes("buildListContactButtonV654(item, encodedEditTargetV648, false)") &&
    script.includes("buildListContactButtonV654(item, encodedEditTargetV648, true)"),
  "list contact buttons must carry the property ID target"
);
assert(
  html.includes("script.js?v=6.5.45-photo-prefetch"),
  "the production page must load the fixed script cache version"
);

const helperBlock = sourceBetween(
  "function getPropertyByEncodedKeyV630(",
  "function ensurePropertyEditModalV630("
);
const openedUrls = [];
const alerts = [];
const context = {
  allItems: [
    {
      key: "same-building|same-address|1F|store",
      propertyId: "M-FIRST",
      sourceLink: "https://realty.daangn.com/?article_id=FIRST"
    },
    {
      key: "same-building|same-address|1F|store",
      propertyId: "M-SECOND",
      sourceLink: "https://realty.daangn.com/?article_id=SECOND"
    }
  ],
  decodeURIComponent,
  alert(message) {
    alerts.push(message);
  },
  window: {
    open(url) {
      openedUrls.push(url);
      return { opener: "initial" };
    }
  }
};
vm.createContext(context);
vm.runInContext(helperBlock + sourceLinkBlock, context);

context.openPropertySourceLink(encodeURIComponent("id:M-FIRST"));
context.openPropertySourceLink(encodeURIComponent("id:M-SECOND"));

assert.deepEqual(openedUrls, [
  "https://realty.daangn.com/?article_id=FIRST",
  "https://realty.daangn.com/?article_id=SECOND"
]);
assert.deepEqual(alerts, []);

console.log("listing actions resolve duplicate display keys by property ID");
