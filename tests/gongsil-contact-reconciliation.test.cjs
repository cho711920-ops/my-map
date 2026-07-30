const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const collector = fs.readFileSync(
  path.join(root, "js", "gongsil-collector.js"),
  "utf8"
);
const backend = fs.readFileSync(
  path.join(root, "..", "outputs", "JS부동산_통합운영시스템_v7.gs"),
  "utf8"
);

const collectPhones = collector.slice(
  collector.indexOf("async function collectPhones("),
  collector.indexOf("function isTenantLabel(")
);
assert.match(
  collectPhones,
  /var candidates = listingCandidates;/,
  "해당 매물 상세 연락처만 교체 자료로 사용해야 합니다."
);
assert.doesNotMatch(
  collectPhones,
  /bilinfo\.tels|item\.Btel|buildingCandidates/,
  "건물 공용 연락처는 다른 매물 번호가 섞일 수 있어 사용하면 안 됩니다."
);
assert.match(
  collector,
  /throw new Error\(\s*"공실박스 연락처 역할 확인 실패:/,
  "역할 미확인 연락처를 기타로 통과시키면 안 됩니다."
);
assert.match(
  collector,
  /contactList: phones\.contacts/,
  "공실박스 역할 연락처는 구조화된 목록으로 서버에 전달해야 합니다."
);
assert.match(
  backend,
  /contactList: record\.contactList/,
  "레거시 공실박스 수집 API도 구조화 연락처를 보존해야 합니다."
);
assert.match(
  backend,
  /function mmReconcileGongsilContactsForSession_\(sessionId\)/,
  "완전수집 연락처 재정리 함수가 필요합니다."
);
assert.match(
  backend,
  /if \(complete && source === "공실박스"\) \{\s*contactReconciliation = mmReconcileGongsilContactsForSession_\(sessionId\);/,
  "오류 없는 공실박스 완전수집에서만 연락처를 교체해야 합니다."
);
assert.doesNotMatch(
  backend.slice(
    backend.indexOf("function mmPropagateGongsilEnrichment_(state, item)"),
    backend.indexOf("function mmBackfillGongsilBuildingNames()")
  ),
  /mmMergeContactPhones_\(/,
  "주소 단위 보강에서 연락처를 합치면 다른 매물 연락처가 섞입니다."
);
assert.match(
  backend,
  /row\[18\] = mmGongsilContactListJson_\(contacts\);/,
  "역할 연락처는 연락처목록 열에 원본 역할 그대로 저장해야 합니다."
);
assert.match(
  backend,
  /throw new Error\("공실박스 연락처 역할을 확인할 수 없습니다: " \+ phone\);/,
  "역할을 알 수 없는 공실박스 번호는 기타로 저장하거나 누락하지 말고 전체수집을 중단해야 합니다."
);
assert.match(
  backend,
  /throw new Error\("공실박스 연락처를 연결할 대표매물을 찾지 못했습니다: " \+ sourceId\);/,
  "원본 연락처가 대표매물에 연결되지 않으면 조용히 누락하지 말고 전체수집을 중단해야 합니다."
);

console.log("gongsil contact reconciliation tests passed");
