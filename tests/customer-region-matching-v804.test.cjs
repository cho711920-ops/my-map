const assert = require("node:assert/strict");
const fs = require("node:fs");

const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");

assert.match(d1, /function splitRequirement\(value\)/);
assert.ok(d1.includes('return clean(value).split(/[,/|]/)'));
assert.match(d1, /const regions = splitRequirement\(requirements\.regions\)/);
assert.match(d1, /const searchable = \[row\.title, row\.address, row\.road_address, row\.building_name/);
assert.match(d1, /if \(regions\.length && !regions\.some\(\(item\) => searchable\.includes\(item\.toLowerCase\(\)\)\)\) return null/);
assert.match(d1, /if \(regions\.length\) score \+= 8/);
assert.match(d1, /regions:\s*clean\(input\["희망지역"\] \?\? previous\.regions\)/);
assert.match(operations, /희망지역/);

const splitRequirement = (value) => String(value || "").trim().split(/[,/|]/).map((item) => item.trim()).filter(Boolean);
assert.deepEqual(splitRequirement("관저, 둔산 / 유성|도안"), ["관저", "둔산", "유성", "도안"]);

console.log("customer desired region D1 matching tests passed");
