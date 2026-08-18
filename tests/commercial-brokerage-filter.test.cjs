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
  assert.match(html, /<option value="fee0to100">0~100 이하<\/option>/);
  assert.match(html, /<option value="fee100to200">100 초과~200 이하<\/option>/);
  assert.match(html, /<option value="fee300to500">300 초과~500 이하<\/option>/);
  assert.match(html, /<option value="feeOver500">500 초과<\/option>/);
  assert.doesNotMatch(html, /id="floorQuickFilter"/);
  assert.ok(
    html.indexOf("js/commercial-brokerage-v1.js?v=1.1.0-exclusive-bands") <
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
  const filters = ["fee0to100", "fee100to200", "fee200to300", "fee300to500", "feeOver500"];
  const samples = [
    [{ deposit: 10000, rent: 0 }, "fee0to100"],
    [{ deposit: 20000, rent: 0 }, "fee100to200"],
    [{ deposit: 30000, rent: 0 }, "fee200to300"],
    [{ deposit: 50000, rent: 0 }, "fee300to500"],
    [{ deposit: 60000, rent: 0 }, "feeOver500"]
  ];

  for (const [item, expected] of samples) {
    assert.deepEqual(filters.filter((filter) => api.matchesFilter(item, filter)), [expected]);
  }
  assert.equal(api.matchesFilter({ deposit: 3000, rent: 150 }, "fee100to200"), true);
  assert.equal(api.matchesFilter({}, "fee0to100"), false);
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
