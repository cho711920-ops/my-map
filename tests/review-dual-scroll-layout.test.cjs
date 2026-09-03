const assert = require("node:assert/strict");
const fs = require("node:fs");

const css = fs.readFileSync("css/operations-collection-v8.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(
  css,
  /@media\(min-width:769px\)\{[\s\S]*?#operationsReviewsPanel \.review-detail\{[\s\S]*?display:grid;[\s\S]*?min-width:0;[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[\s\S]*?grid-template-rows:auto minmax\(0,1fr\) auto;/,
  "desktop and tablet review detail must use two side-by-side panes"
);
assert.match(
  css,
  /#operationsReviewsPanel \.review-existing-panel\{[\s\S]*?grid-column:1;[\s\S]*?grid-row:2;/,
  "existing listings must stay in the left pane"
);
assert.match(
  css,
  /#operationsReviewsPanel \.review-new-panel\{[\s\S]*?grid-column:2;[\s\S]*?grid-row:2;/,
  "newly collected listings must stay in the right pane"
);
assert.match(
  css,
  /#operationsReviewsPanel \.review-existing-list,[\s\S]*?#operationsReviewsPanel \.review-new-list\{[\s\S]*?overflow-y:auto;[\s\S]*?overscroll-behavior:contain;/,
  "both review lists must scroll independently"
);
assert.match(
  css,
  /#operationsReviewsPanel \.review-action-buttons\{[\s\S]*?grid-column:1\/-1;[\s\S]*?grid-row:3;/,
  "review actions must remain below both panes"
);
assert.match(
  css,
  /v7\.23\.12[\s\S]*?#operationsReviewsPanel \.review-new-list\{[\s\S]*?grid-auto-rows:max-content;[\s\S]*?#operationsReviewsPanel \.review-new-panel \.review-item-compact\{[\s\S]*?height:auto!important;[\s\S]*?min-height:76px!important;/,
  "new review cards must keep their own height instead of overlapping"
);
assert.match(
  html,
  /operations-collection-v8\.css\?v=7\.26\.1-review-audit/,
  "the split-pane stylesheet cache key must be deployed"
);

console.log("review dual scroll layout tests passed");
