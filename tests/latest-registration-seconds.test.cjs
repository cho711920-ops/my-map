const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const map = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const backend = fs.readFileSync(
  path.join(root, "..", "outputs", "JS부동산_Code.gs_v6.5.4_연락처6개_안전작업대기열_최종본.gs"),
  "utf8"
);
const integrated = fs.readFileSync(
  path.join(root, "..", "outputs", "JS부동산_통합운영시스템_v7.gs"),
  "utf8"
);

const timeFunction = script.match(
  /function listingRegistrationTime\(item\) \{[\s\S]*?\n\}/
);
assert.ok(timeFunction, "초 단위 등록시각 변환 함수를 찾을 수 있어야 합니다.");
const listingRegistrationTime = new Function(
  `${timeFunction[0]}\nreturn listingRegistrationTime;`
)();

assert.ok(
  listingRegistrationTime({ registrationAt: "2026-08-03 7:03:44" }) >
    listingRegistrationTime({ registrationAt: "2026-08-03 1:56:02" }),
  "한 자리 시각을 포함해 시·분·초 순서가 정확해야 합니다."
);
assert.ok(
  listingRegistrationTime({ registrationAt: "2026-08-03 11:12:18" }) >
    listingRegistrationTime({ regDate: "2026.08.03" }),
  "최초수집일시가 있으면 날짜 전용 등록일보다 우선해야 합니다."
);

assert.match(map, /registrationAt:\s*clean\(c\[23\]\)/);
assert.match(map, /lastCollectedAt:\s*clean\(c\[24\]\)/);
assert.match(backend, /PROPERTY_FIRST_COLLECTED_AT_COLUMN\s*=\s*23/);
assert.match(backend, /PROPERTY_LAST_COLLECTED_AT_COLUMN\s*=\s*24/);
assert.match(backend, /"최초수집일시",\s*"최종수집일시"/);
assert.match(integrated, /serverConfirmedGongsilFull/);
assert.match(integrated, /Math\.max\(mmNumber_\(row\[5\]\)[\s\S]*?observedCount\)\s*>=\s*2000/);
assert.match(integrated, /requireAllLinked:\s*false/);

console.log("second-resolution latest registration tests passed");
