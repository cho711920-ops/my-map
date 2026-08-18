const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("js/script.js", "utf8");
const propertyEdit = fs.readFileSync("js/property-edit-v648.js", "utf8");
const style = fs.readFileSync("css/style.css", "utf8");
const overrides = fs.readFileSync("css/app-final-overrides-v690.css", "utf8");
const unifiedCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const parser = fs.readFileSync("js/parser.js", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");

test("the August 18 module split loads extracted code in dependency order", () => {
  const styleIndex = html.indexOf("css/style.css?v=6.10.0-module-split");
  const overrideIndex = html.indexOf("css/app-final-overrides-v690.css?v=1.0.0");
  const mainIndex = html.indexOf("js/script.js?v=6.10.1-brokerage-fee-filter");
  const propertyEditIndex = html.indexOf("js/property-edit-v648.js?v=1.0.0");

  assert.ok(styleIndex >= 0 && styleIndex < overrideIndex);
  assert.ok(mainIndex >= 0 && mainIndex < propertyEditIndex);
  assert.doesNotMatch(main, /var propertyEditTargetV630/);
  assert.match(main, /property-edit-v648\.js에서 이어서 로드합니다/);
  assert.match(propertyEdit, /var propertyEditTargetV630/);
  assert.match(propertyEdit, /function openPropertyEditModalV630/);
  assert.doesNotMatch(style, /\/\* v6\.5\.10/);
  assert.match(style, /app-final-overrides-v690\.css에서 이어서 로드합니다/);
  assert.match(overrides, /\/\* v6\.5\.10/);
  assert.match(overrides, /\.map-quick-tools/);
});

test("compact cards hide elevator decorations while register details retain them", () => {
  assert.doesNotMatch(main, /buildListElevatorIconV650/);
  assert.doesNotMatch(style, /\.item-elevator-v650/);
  assert.doesNotMatch(unifiedCss, /\.item-elevator-v650/);
  assert.match(html, /unified-listings-v8\.css\?v=8\.0\.42-card-elevator-hidden/);
});

test("quick add waits for a confirmed D1 persistence result before clearing input", () => {
  const sendStart = parser.indexOf("function sendQuickAddMutationV6418(");
  const submitStart = parser.indexOf("function submitQuickAddRequestV636(", sendStart);
  const sendMutation = parser.slice(sendStart, submitStart);

  assert.ok(sendStart >= 0 && submitStart > sendStart);
  assert.match(html, /parser\.js\?v=6\.4\.18-quick-add-response/);
  assert.match(parser, /function sendQuickAddMutationV6418\(values, forceDuplicate\)/);
  assert.match(parser, /JSDataAccessV6\.mutate\("quickAdd", payload,/);
  assert.match(parser, /result\.persisted !== true/);
  assert.match(parser, /매물 등록이 완료됐습니다[\s\S]*clearQuickAddForm\(\)/);
  assert.doesNotMatch(sendMutation, /mode:\s*"no-cors"/);
  assert.match(d1, /async function quickAdd\(env, user, body\)/);
  assert.match(d1, /return \{ ok: true, persisted: true, queued: false, propertyId,/);
});

test("all recovered August 18 cache versions are active", () => {
  for (const asset of [
    "js/unified-listings-v8.js?v=8.1.31-shared-data-only",
    "js/list-manager-v6.js?v=6.4.35-shared-data-only",
    "js/operations-center-v7.js?v=7.22.5-shared-data-only",
    "js/operations-collection-v8.js?v=7.25.8-shared-data-only",
    "js/operations-admin-v1.js?v=1.0.5-shared-data-only",
    "js/commercial-brokerage-v1.js?v=1.0.0",
    "css/list-manager-v6.css?v=6.4.28-brokerage-filter",
    "css/mobile-app-v1.css?v=1.0.6-brokerage-no-floor"
  ]) {
    assert.ok(html.includes(asset), `${asset} must be loaded`);
  }
});
