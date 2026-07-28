const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const roleMap = JSON.parse(read("data/agency-role-map.json"));
const resolverSource = read("js/agency-contact-resolver.js");
const generatorSource = read("js/call-script-generator.js");
const step4Source = read("js/permit-diagnosis-step4.js");
const index = read("index.html");

assert(index.includes("agency-contact-resolver.js"), "관할기관 판별 엔진을 연결해야 합니다.");
assert(index.includes("call-script-generator.js"), "전화 질문 생성기를 연결해야 합니다.");
assert(index.includes("permit-diagnosis-step5.js"), "STEP 5 UI를 연결해야 합니다.");
assert(step4Source.includes("permit:procedure-diagnosed-v1"), "STEP 4 판정 결과를 STEP 5로 전달해야 합니다.");

const context = { window: {}, fetch: () => Promise.reject(new Error("not used")) };
vm.createContext(context);
vm.runInContext(resolverSource, context);
vm.runInContext(generatorSource, context);
const resolver = context.window.PermitAgencyContactResolverV1;
const generator = context.window.PermitCallScriptGeneratorV1;

const expected = {
  "대전 동구": "042-251-4114",
  "대전 중구": "042-606-6114",
  "대전 서구": "042-288-2114",
  "대전 유성구": "042-611-2114",
  "대전 대덕구": "042-608-6114"
};

Object.keys(expected).forEach((jurisdiction) => {
  const district = jurisdiction.split(" ")[1];
  assert.strictEqual(
    resolver.detectJurisdiction(`대전광역시 ${district} 테스트동 1-1`),
    jurisdiction,
    `${district} 관할을 정확히 판별해야 합니다.`
  );
  const result = resolver.resolve(`대전 ${district} 테스트동 1-1`, roleMap);
  const building = result.contacts.find((contact) => contact.id === "building-use");
  assert.strictEqual(building.representativePhone, expected[jurisdiction], "다른 구청 번호를 섞으면 안 됩니다.");
});

assert.strictEqual(resolver.detectJurisdiction("서울 서구 테스트동 1-1"), null, "대전 외 주소를 대전 서구로 오인하면 안 됩니다.");
assert.strictEqual(resolver.resolve("대전 테스트동 1-1", roleMap).contacts.length, 0, "관할 미확인 시 임의 기관을 만들면 안 됩니다.");

Object.values(roleMap.jurisdictions).forEach((jurisdiction) => {
  assert(jurisdiction.districtOffice.officialUrl.startsWith("https://"), "공식 출처 URL이 필요합니다.");
});

const resolved = resolver.resolve("대전 서구 탄방동 1283", roleMap);
assert(resolved.contacts.every((contact) => contact.directPhone === ""), "확인하지 않은 직통번호를 만들면 안 됩니다.");
const buildingContact = resolved.contacts.find((contact) => contact.id === "building-use");
const script = generator.generate(buildingContact, {
  input: { address: "대전 서구 탄방동 1283", floor: "1", unit: "101", area: "76.03" },
  industry: { officialName: "인터넷컴퓨터게임시설제공업" },
  currentUse: "제1종 근린생활시설",
  procedure: { label: "용도변경 신고 검토" }
});
["대전 서구 탄방동 1283", "1층", "101호", "76.03㎡", "인터넷컴퓨터게임시설제공업",
  "제1종 근린생활시설", "용도변경 신고 검토"].forEach((value) => {
  assert(script.includes(value), `전화 질문에 ${value} 정보가 포함되어야 합니다.`);
});

console.log("permit diagnosis step5 tests: ok");
