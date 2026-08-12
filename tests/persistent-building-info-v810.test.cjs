const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const building = read("js", "building-register-v6.js");
const map = read("js", "map.js");
const buildingApi = read("cloudflare", "src", "building-register-api.js");
const d1 = read("cloudflare", "src", "d1-api.js");

assert.match(map, /buildingYear:\s*clean\(c\[18\]\)/);
assert.match(map, /buildingElevators:\s*Number\(clean\(c\[19\]\)\) \|\| 0/);
assert.match(map, /buildingInfoStatus:\s*clean\(c\[22\]\)/);
assert.doesNotMatch(map, /JSBuildingRegisterBadges\.prefetchMissing\(rawItems\)/);

assert.match(building, /function persistentBadgeFromItemV810\(item\)/);
assert.match(building, /var BUILDING_INFO_PREFETCH_CONCURRENCY_V810 = 2/);
assert.match(building, /requestBadgeData\(item, parcel, true\)/);
assert.match(building, /if \(persistToServer && \(!data\.buildingInfoCache \|\| !data\.buildingInfoCache\.ok\)\)/);
assert.match(building, /"address=" \+ encodeURIComponent\(item && item\.address \|\| parcel\.lotAddress \|\| ""\)/);
assert.match(building, /prefetchMissing:\s*prefetchMissingBuildingInfoV810/);
assert.match(building, /BUILDING_CLIENT_VERSION_V811 = "8\.2\.7"/);

assert.match(buildingApi, /UPDATE listings SET building_year=\?1/);
assert.match(buildingApi, /building_elevators=MAX\(/);
assert.match(buildingApi, /building_info_status='확인완료'/);
assert.match(buildingApi, /building_info_checked_at=\?6/);
assert.match(d1, /contacts_json, building_year, building_elevators/);
assert.match(d1, /building_approval_date, building_info_checked_at, building_info_status/);

console.log("persistent building info in D1 tests passed");
