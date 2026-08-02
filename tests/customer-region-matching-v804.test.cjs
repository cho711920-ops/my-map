const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(
  "C:\\Users\\USER\\Documents\\Codex\\2026-07-17\\sork\\outputs\\JS부동산_통합운영시스템_v7.gs",
  "utf8"
);

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction("mmText_"),
  extractFunction("mmDesiredRegionTokens_"),
  extractFunction("mmAddressMatchesDesiredRegions_")
].join("\n"), context);

const shortDongs = context.mmDesiredRegionTokens_("괴정, 용문, 탄방");
assert.deepEqual(JSON.parse(JSON.stringify(shortDongs)), ["괴정", "용문", "탄방"]);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.mmDesiredRegionTokens_("괴정동\n용문동/탄방동"))),
  ["괴정동", "용문동", "탄방동"]
);
assert.equal(context.mmAddressMatchesDesiredRegions_("대전광역시 서구 괴정동 95-19", shortDongs), true);
assert.equal(context.mmAddressMatchesDesiredRegions_("대전광역시 서구 둔산동 100", shortDongs), false);

const fullDongs = context.mmDesiredRegionTokens_("괴정동,용문동,탄방동");
assert.equal(context.mmAddressMatchesDesiredRegions_("서구 용문동 219-8", fullDongs), true);

const districts = context.mmDesiredRegionTokens_("서구, 유성구");
assert.equal(context.mmAddressMatchesDesiredRegions_("유성구 봉명동 10", districts), true);
assert.equal(context.mmAddressMatchesDesiredRegions_("중구 문화동 10", districts), false);
assert.equal(context.mmAddressMatchesDesiredRegions_("서구 괴정동 괴정상가", ["괴정"]), true);
assert.equal(context.mmAddressMatchesDesiredRegions_("서구 둔산동 괴정빌딩", ["괴정"]), false);

assert.match(source, /var MM_VERSION = "8\.0\.4"/);
assert.match(source, /regions: mmDesiredRegionTokens_\(customer\[3\]\)/);
assert.match(source, /mmAddressMatchesDesiredRegions_\(masterProfile\.address, regions\)/);

console.log("customer desired region v8.0.4 tests passed");
