const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const source = fs.readFileSync("js/commercial-brokerage-v1.js", "utf8");
const mainSource = fs.readFileSync("js/script.js", "utf8");
const desktopCss = fs.readFileSync("css/list-manager-v6.css", "utf8");
const mobileCss = fs.readFileSync("css/mobile-app-v1.css", "utf8");

function brokerageApi() {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.JSCommercialBrokerageV1;
}

test("the restored brokerage filter replaces the quick floor control", () => {
  assert.match(html, /id="brokerageFeeFilter"/);
  assert.match(html, /<option value="lte100">100 이하<\/option>/);
  assert.match(html, /<option value="lte500">500 이하<\/option>/);
  assert.match(html, /<option value="gt500">500 초과<\/option>/);
  assert.doesNotMatch(html, /id="floorQuickFilter"/);
  assert.ok(
    html.indexOf("js/commercial-brokerage-v1.js?v=1.0.0") <
      html.indexOf("js/script.js?v=6.10.1-brokerage-fee-filter"),
    "brokerage calculations must load before the main list filter"
  );
});

test("commercial lease fees use the 0.9 percent maximum rate", () => {
  const api = brokerageApi();
  const result = api.calculateMaximumFee({ deposit: "3,000", rent: "150" });

  assert.equal(api.maximumRate, 0.009);
  assert.equal(result.transactionAmount, 18000);
  assert.equal(result.maximumFee, 162);
  assert.equal(result.rentMultiplier, 100);
});

test("low-value commercial leases use the restored 70-times rent rule", () => {
  const result = brokerageApi().calculateMaximumFee({ deposit: 1000, rent: 30 });

  assert.equal(result.transactionAmount, 3100);
  assert.equal(result.maximumFee, 27.9);
  assert.equal(result.rentMultiplier, 70);
});

test("brokerage fee bands include and exclude listings correctly", () => {
  const api = brokerageApi();
  const fee162 = { deposit: 3000, rent: 150 };
  const fee540 = { deposit: 10000, rent: 500 };

  assert.equal(api.matchesFilter(fee162, "lte100"), false);
  assert.equal(api.matchesFilter(fee162, "lte200"), true);
  assert.equal(api.matchesFilter(fee162, "lte500"), true);
  assert.equal(api.matchesFilter(fee162, "gt500"), false);
  assert.equal(api.matchesFilter(fee540, "gt500"), true);
  assert.equal(api.matchesFilter({}, "lte100"), false);
  assert.equal(api.matchesFilter({}, ""), true);
});

test("the main list applies and resets the restored filter on desktop and mobile", () => {
  assert.match(mainSource, /selectedBrokerageFee/);
  assert.match(mainSource, /JSCommercialBrokerageV1\.matchesFilter\(item, selectedBrokerageFee\)/);
  assert.match(mainSource, /matchSource && matchBrokerageFee && matchIndustry/);
  assert.match(mainSource, /if \(brokerageFeeFilter\) brokerageFeeFilter\.value = ""/);
  assert.match(desktopCss, /#listToolbar > \.list-brokerage-control/);
  assert.match(mobileCss, /\.list-brokerage-control > #brokerageFeeFilter/);
  assert.doesNotMatch(mobileCss, /\.list-floor-control > #floorQuickFilter/);
});
