const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const workspace = path.resolve(repo, "..");
const operationsPath = path.join(
  workspace,
  "outputs",
  "JS부동산_통합운영시스템_v7.gs"
);

const script = fs.readFileSync(path.join(repo, "js", "script.js"), "utf8");
const css = fs.readFileSync(path.join(repo, "css", "style.css"), "utf8");
const index = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const operations = fs.readFileSync(operationsPath, "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} is missing`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${name} body is incomplete`);
}

const cardStart = script.indexOf("function addListItem");
const headStart = script.indexOf('<div class="item-compact-head-v650">', cardStart);
const priceStart = script.indexOf('<div class="price-line item-compact-price-v650">', headStart);
const sourcePosition = script.indexOf("sourceLabel +", priceStart);
const pyeongPosition = script.indexOf("pyeongMiniBadge +", priceStart);

assert(headStart >= 0 && priceStart > headStart, "compact card rows are missing");
assert(sourcePosition > priceStart, "임장가자 badge must be in the second row");
assert(sourcePosition < pyeongPosition, "임장가자 badge must be first in the second row");
assert(
  script.slice(headStart, priceStart).indexOf("sourceLabel +") < 0,
  "임장가자 badge must not remain in the first row"
);

assert(css.includes("width: min(570px, calc(100vw - 16px)) !important;"));
assert(css.includes("width: clamp(570px, 34vw, 600px) !important;"));
assert(css.includes("width: min(640px, calc(100vw - 16px)) !important;"));
assert(index.includes("style.css?v=6.5.6-list-density"));

[
  "mmForceCreateReviewItem_",
  "mmExcludeReviewItem_",
  "mmHoldReviewItem_",
  "mmForceMergeReviewItem_"
].forEach((name) => {
  const body = functionBody(operations, name);
  assert(!body.includes("mmLoadState_"), `${name} must not reload all operational sheets`);
});

const applyBody = functionBody(operations, "mmApplyReviewFromWeb_");
assert(applyBody.includes("mmDeleteReviewRowFast_"));
const deleteBody = functionBody(operations, "mmDeleteReviewRowFast_");
assert(deleteBody.includes("clearContent()"));
assert(deleteBody.includes("setValues(lastValues)"));
assert(operations.includes('var MM_VERSION = "7.16.3";'));

console.log("List density and review speed tests: OK");
