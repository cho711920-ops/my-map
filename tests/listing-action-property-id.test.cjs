const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const propertyEdit = fs.readFileSync(path.join(root, "js", "property-edit-v648.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function sourceBetweenIn(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert(startIndex >= 0, `${start} was not found`);
  assert(endIndex > startIndex, `${end} was not found after ${start}`);
  return source.slice(startIndex, endIndex);
}

function sourceBetween(start, end) {
  return sourceBetweenIn(script, start, end);
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
  script.includes("buildListContactButtonV654(item, encodedEditTargetV648, false)"),
  "action-row contact buttons must carry the property ID target"
);
assert(
  script.includes("togglePrintSelection(\\'' + encodedActionSelectionKeyV660 + '\\')"),
  "card checkboxes must carry the property ID selection target"
);
assert(
  html.includes("script.js?v=6.10.4-filter-chips-selection"),
  "the production page must load the fixed script cache version"
);

const helperBlock = sourceBetweenIn(
  propertyEdit,
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

const selectionBlock = sourceBetween(
  "function actionSelectionKeyV660(",
  "function clearSelectedPrintItems("
);
const selectedItemsBlock = sourceBetween(
  "function getSelectedPrintItems(",
  "function toggleGongsilOnly("
);
const duplicateItems = [
  { key: "same-building|same-address|1F|store", propertyId: "M-FIRST", sheetRow: 101 },
  { key: "same-building|same-address|1F|store", propertyId: "M-SECOND", sheetRow: 102 },
  { key: "same-building|same-address|1F|store", propertyId: "M-THIRD", sheetRow: 103 }
];
const selectionContext = {
  allItems: duplicateItems,
  visibleListItems: duplicateItems,
  selectedPrintKeys: [],
  decodeURIComponent,
  showList() {}
};
selectionContext.window = selectionContext;
vm.createContext(selectionContext);
vm.runInContext(selectionBlock + selectedItemsBlock, selectionContext);

const firstSelectionKey = selectionContext.actionSelectionKeyV660(duplicateItems[0]);
const secondSelectionKey = selectionContext.actionSelectionKeyV660(duplicateItems[1]);
selectionContext.togglePrintSelection(encodeURIComponent(firstSelectionKey));
assert.deepEqual(Array.from(selectionContext.selectedPrintKeys), ["property:M-FIRST|row:101"]);
assert.deepEqual(
  Array.from(selectionContext.getSelectedPrintItems(), (item) => item.propertyId),
  ["M-FIRST"]
);

selectionContext.togglePrintSelection(encodeURIComponent(secondSelectionKey));
assert.deepEqual(
  Array.from(selectionContext.getSelectedPrintItems(), (item) => item.propertyId),
  ["M-FIRST", "M-SECOND"]
);

const samePropertyIdItems = [
  { key: "same-building|same-address|1F|store", propertyId: "M-SHARED", sheetRow: 201 },
  { key: "same-building|same-address|1F|store", propertyId: "M-SHARED", sheetRow: 202 },
  { key: "same-building|same-address|1F|store", propertyId: "M-SHARED", sheetRow: 203 }
];
selectionContext.allItems = samePropertyIdItems;
selectionContext.visibleListItems = samePropertyIdItems;
selectionContext.selectedPrintKeys = [];
selectionContext.togglePrintSelection(encodeURIComponent(
  selectionContext.actionSelectionKeyV660(samePropertyIdItems[1])
));
assert.deepEqual(
  Array.from(selectionContext.getSelectedPrintItems(), (item) => item.sheetRow),
  [202],
  "even duplicate property IDs must remain separate card selections"
);

console.log("listing actions keep same-address same-floor cards independently selectable");
