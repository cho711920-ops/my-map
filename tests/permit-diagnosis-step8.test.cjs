const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

(async function main() {
  const moduleSource = fs.readFileSync("api/_lib/permit-open-data.js", "utf8")
    .replace(/export async function /g, "async function ")
    .replace(/export function /g, "function ")
    .replace(/export const permitOpenDataInternals[\s\S]*$/m, "");
  const context = {
    URL,
    console,
    process: { env: {} },
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(moduleSource + "\nthis.__test={parseXmlRows,compactAddress,normalizePermit,normalizeBusiness,INDUSTRY_ENDPOINTS};", context);

  const api = context.__test;
  assert.strictEqual(api.compactAddress("대전 서구 둔산동 123-4"), "대전서구둔산동1234");
  assert.ok(api.INDUSTRY_ENDPOINTS["internet-computer-game"].path.includes("pc_bangs"));
  assert.ok(api.INDUSTRY_ENDPOINTS["mixed-game-provider"].path.includes("mixed_game_providers"));

  const permit = api.normalizePermit({
    platPlc: "대전 서구 둔산동 1",
    mainPurpsCdNm: "제2종근린생활시설",
    pmsDay: "20260102",
    useAprDay: "20260405"
  });
  assert.strictEqual(permit.siteAddress, "대전 서구 둔산동 1");
  assert.strictEqual(permit.mainUse, "제2종근린생활시설");
  assert.strictEqual(permit.approvalDate, "20260405");

  const business = api.normalizeBusiness({
    bplcNm: "테스트PC방",
    trdStateNm: "영업",
    siteWhlAddr: "대전 서구 둔산동 1"
  }, { label: "인터넷컴퓨터게임시설제공업" });
  assert.strictEqual(business.businessName, "테스트PC방");
  assert.strictEqual(business.status, "영업");

  const rows = api.parseXmlRows("<response><items><item><name><![CDATA[테스트]]></name><state>영업</state></item></items></response>");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, "테스트");
  assert.strictEqual(rows[0].state, "영업");

  const serverSource = fs.readFileSync("api/permit-public-data.js", "utf8");
  assert.match(serverSource, /Promise\.allSettled/);
  assert.match(serverSource, /buildingPermitHistory/);
  assert.match(serverSource, /industryPermitHistory/);
  assert.match(serverSource, /landUseActivities/);
  assert.doesNotMatch(serverSource, /[A-Za-z0-9%+\/]{80,}={0,2}/);

  const adapterSource = fs.readFileSync("js/building-data-adapter.js", "utf8");
  assert.match(adapterSource, /industryId/);
  assert.match(adapterSource, /건축 인허가 이력/);
  assert.match(adapterSource, /동일 주소 영업 인허가 이력/);
  assert.match(adapterSource, /토지이용행위 규제 확인/);

  console.log("permit diagnosis step8 tests: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
