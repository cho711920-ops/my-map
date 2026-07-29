const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const aliases = JSON.parse(
  fs.readFileSync(path.join(root, "data", "brand-industry-aliases.json"), "utf8")
);
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "data", "industry-catalog.json"), "utf8")
);
const master = JSON.parse(
  fs.readFileSync(path.join(root, "data", "industry-master.json"), "utf8")
);
const industryIds = new Set(
  [...catalog.industries, ...master.industries].map((industry) => industry.id)
);

assert(aliases.brands.length >= 60, "대표 브랜드 사전이 60개 미만입니다.");
const normalizedAliases = new Set();
aliases.brands.forEach((brand) => {
  assert(brand.name);
  assert(brand.businessType);
  assert(Array.isArray(brand.industryIds) && brand.industryIds.length);
  brand.industryIds.forEach((id) => {
    assert(industryIds.has(id), `${brand.name}: 존재하지 않는 업종 ID ${id}`);
  });
  [brand.name, ...(brand.aliases || [])].forEach((alias) => {
    const normalized = alias.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    assert(!normalizedAliases.has(normalized), `중복 브랜드 별칭: ${alias}`);
    normalizedAliases.add(normalized);
  });
});

const sandbox = {
  window: {},
  fetch: async () => ({ ok: true, json: async () => aliases }),
  Promise,
  String,
  RegExp
};
sandbox.window.window = sandbox.window;
vm.runInNewContext(
  fs.readFileSync(path.join(root, "js", "brand-industry-resolver.js"), "utf8"),
  sandbox
);
const resolver = sandbox.window.PermitBrandIndustryResolverV1;
assert(resolver);

const mega = resolver.findAlias("메가커피를 창업하고 싶습니다", aliases);
assert.strictEqual(mega.brandName, "메가MGC커피");
assert.deepStrictEqual([...mega.industryIds], ["cafe", "rest-restaurant"]);

const kimbap = resolver.findAlias("김가네 프랜차이즈 운영", aliases);
assert.deepStrictEqual([...kimbap.industryIds], [
  "general-restaurant",
  "rest-restaurant"
]);

assert.deepStrictEqual(
  [...resolver.mapPlaceCategories([
    { place_name: "테스트", category_name: "음식점 > 카페 > 커피전문점" }
  ])],
  ["cafe", "rest-restaurant"]
);

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "js", "permit-diagnosis-ui.js"), "utf8");
assert(index.includes("brand-industry-resolver.js?v=1.0.0"));
assert(index.includes("permit-diagnosis-ui.js?v=2.3.1"));
assert(ui.includes("permitBrandEvidenceV1"));
assert(ui.includes("업종·업태를 확인하고 있습니다."));
assert(ui.includes("dedupeOfficialCandidates"));

console.log("brand industry resolver tests: ok");
