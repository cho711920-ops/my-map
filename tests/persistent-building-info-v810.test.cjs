const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");
const building = fs.readFileSync(path.join(root, "js", "building-register-v6.js"), "utf8");
const map = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const code = fs.readFileSync(
  path.join(projectRoot, "outputs", "JS부동산_Code.gs_v6.5.4_연락처6개_안전작업대기열_최종본.gs"),
  "utf8"
);
const integrated = fs.readFileSync(
  path.join(projectRoot, "outputs", "JS부동산_통합운영시스템_v7.gs"),
  "utf8"
);

assert.match(integrated, /var MM_VERSION = "8\.1\.1"/);
assert.match(integrated, /var MM_BUILDING_INFO_SHEET = "JS_건물정보"/);
assert.match(integrated, /"지번주소키",\s*"지번주소"[\s\S]*?"준공년도"[\s\S]*?"승강기합계"[\s\S]*?"확인일시"/);
assert.match(integrated, /function mmCacheBuildingRegisterSummary_\(result, request\)/);
assert.match(integrated, /if \(previous && mmText_\(previous\[15\]\) === "확인완료" && !force\)/);
assert.match(integrated, /function mmBuildingInfoMapForAddresses_\(addresses\)/);
assert.match(integrated, /function mmSetupBuildingInfoCache\(\)/);
assert.match(integrated, /function mmBuildingInfoBackfillStatus\(\)/);
assert.match(integrated, /mmEnsureBuildingInfoSheet_\(spreadsheet\);/);

assert.match(code, /address: params\.address/);
assert.match(code, /result\.buildingInfoCache = mmCacheBuildingRegisterSummary_\(result, buildingRegisterRequest\)/);
assert.match(code, /csvRow\.push\("준공년도", "엘리베이터수", "사용승인일", "건물정보확인일", "건물정보상태"\)/);
assert.match(code, /const buildingInfo = buildingInfoByAddress\[addressKey\] \|\| \{\}/);

assert.match(map, /buildingYear: clean\(c\[18\]\)/);
assert.match(map, /buildingElevators: Number\(clean\(c\[19\]\)\) \|\| 0/);
assert.match(map, /buildingInfoStatus: clean\(c\[22\]\)/);
assert.doesNotMatch(map, /JSBuildingRegisterBadges\.prefetchMissing\(rawItems\)/);

assert.match(building, /function persistentBadgeFromItemV810\(item\)/);
assert.match(building, /String\(item\.buildingInfoStatus \|\| ""\)\.trim\(\) !== "확인완료"/);
assert.match(building, /var BUILDING_INFO_PREFETCH_CONCURRENCY_V810 = 2/);
assert.match(building, /requestBadgeData\(item, parcel, true\)/);
assert.match(building, /if \(persistToServer && \(!data\.buildingInfoCache \|\| !data\.buildingInfoCache\.ok\)\)/);
assert.match(building, /"address=" \+ encodeURIComponent\(item && item\.address \|\| parcel\.lotAddress \|\| ""\)/);
assert.match(building, /prefetchMissing: prefetchMissingBuildingInfoV810/);
assert.match(building, /BUILDING_CLIENT_VERSION_V811 = "8\.1\.1"/);

console.log("persistent building info v8.1.0 tests passed");
