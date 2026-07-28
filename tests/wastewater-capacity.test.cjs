const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const rules = JSON.parse(read("data/wastewater-capacity-rules.json"));
const source = read("js/wastewater-capacity-engine.js");

assert.strictEqual(rules.effectiveDate, "2025-10-01");
assert.strictEqual(rules.industries["rest-restaurant"].personsPerSquareMeter, 0.175);
assert.strictEqual(rules.industries["rest-restaurant"].litersPerSquareMeterDay, 35);
assert.strictEqual(rules.industries["general-restaurant"].litersPerSquareMeterDay, 60);

const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const engine = context.window.PermitWastewaterCapacityEngineV1;

let result = engine.calculate("rest-restaurant", { area: 100 });
assert.strictEqual(result.targetPersons, 17.5);
assert.strictEqual(result.dailyLiters, 3500);
assert.strictEqual(result.dailyTons, 3.5);
assert.strictEqual(result.status, "UNKNOWN");

result = engine.calculate("general-restaurant", {
  area: 100,
  totalCapacity: 50,
  existingLoad: 20
});
assert.strictEqual(result.targetPersons, 17.5);
assert.strictEqual(result.dailyLiters, 6000);
assert.strictEqual(result.remaining, 12.5);
assert.strictEqual(result.status, "ENOUGH");

result = engine.calculate("general-restaurant", {
  area: 100,
  totalCapacity: 30,
  existingLoad: 20
});
assert.strictEqual(result.remaining, -7.5);
assert.strictEqual(result.status, "SHORT");

assert.strictEqual(engine.calculate("rest-restaurant", { area: "" }).status, "UNKNOWN");
console.log("wastewater capacity tests: ok");
