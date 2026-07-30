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
  /var candidates = isCollectiveItem\(item,\s*detail\)\s*\?\s*listingCandidates\s*:\s*listingCandidates\.concat\(buildingCandidates\);/,
  "일반건물과 집합건물의 연락처 범위를 분리해야 합니다."
);
assert.match(
  collectPhones,
  /appendContactFields\(buildingCandidates,\s*detail && detail\.bilinfo[\s\S]*?appendContactFields\(buildingCandidates,\s*item/,
  "일반·다가구 건물은 공실박스 건물 연락처도 복구해야 합니다."
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
  /function mmReconcileGongsilContactsForSession_\(sessionId, options\)/,
  "수집회차별 연락처 재정리 함수가 필요합니다."
);
assert.match(
  backend,
  /if \(source === "공실박스" && !body\.stopped\) \{[\s\S]*?contactReconciliation = mmReconcileGongsilContactsForSession_\(sessionId, \{[\s\S]*?requireAllLinked: complete/,
  "공실박스 연락처 복구는 거래완료용 완전수집과 분리해야 합니다."
);
assert.match(
  backend,
  /function mmRestoreGongsilContactsForSession\(sessionId\) \{[\s\S]*?requireAllLinked: false/,
  "완전수집 여부와 무관하게 정상 원본만 안전 복구하는 실행 함수가 필요합니다."
);
assert.match(
  backend,
  /function mmRestoreLatestGongsilContacts\(\) \{[\s\S]*?mmIsExternalCollectionActive_\(\)[\s\S]*?mmRestoreGongsilContactsForSession\(sessionId\)/,
  "진행 중 수집을 건드리지 않고 최신 완료 회차를 복구하는 실행 함수가 필요합니다."
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
  /function mmMergeExactGongsilContacts_\(row, item\)[\s\S]*?mmMasterSource_\(row\) === "직접등록"[\s\S]*?row\[18\] = mmGongsilContactListJson_\(contacts\);/,
  "부분수집에서도 출처ID로 연결된 매물 자신의 연락처만 안전하게 보강해야 합니다."
);
assert.match(
  backend,
  /if \(Array\.isArray\(body\.observedSourceIds\) && body\.observedSourceIds\.length\) \{[\s\S]*?row\[5\] = mmMergeSourceIds_\(body\.observedSourceIds\)\.length;/,
  "수집회차 건수는 최종 고유 목록 수로 바로잡아 중복 집계를 막아야 합니다."
);
assert.match(
  backend,
  /throw new Error\("공실박스 연락처 역할을 확인할 수 없습니다: " \+ phone\);/,
  "역할을 알 수 없는 공실박스 번호는 기타로 저장하거나 누락하지 말고 전체수집을 중단해야 합니다."
);
assert.match(
  backend,
  /if \(skippedUnlinked\.length && options\.requireAllLinked === true\) \{[\s\S]*?throw new Error\("공실박스 연락처를 연결할 대표매물을 찾지 못했습니다:/,
  "완전수집에서는 원본 연락처가 대표매물에 연결되지 않으면 중단해야 합니다."
);
assert.match(
  backend,
  /skippedEmpty\.push\(sourceId\);[\s\S]*?skippedUnlinked: skippedUnlinked\.length/,
  "부분 복구에서는 빈 원본과 미연결 건을 보존하고 결과에 집계해야 합니다."
);
assert.match(
  backend,
  /"공실박스연락처재구축"[\s\S]*?historyRows\.length[\s\S]*?MM_HISTORY_HEADERS\.length/,
  "대량 연락처 교체 전후 값은 매물이력에 남겨 복구 가능해야 합니다."
);

const exactMerge = backend.slice(
  backend.indexOf("function mmMergeExactGongsilContacts_(row, item)"),
  backend.indexOf("function mmMergeItemIntoMaster_")
);
assert.doesNotMatch(
  exactMerge,
  /mmNormalizeGongsilContactList_\(row\[18\]\)/,
  "현재 공실박스 연락처 복구 시 예전의 잘못된 연락처 JSON을 다시 합치면 안 됩니다."
);
assert.match(
  exactMerge,
  /incoming\.forEach\(function\(contact\)/,
  "연결된 공실박스 매물의 현재 역할 연락처로 정확히 교체해야 합니다."
);

assert.match(
  backend,
  /function mmRestoreAllGongsilContactsFromHistory\(\) \{[\s\S]*?useHistoryFallback: true[\s\S]*?console\.log\(JSON\.stringify\(result\)\)/,
  "historical recovery must restore roles missing from the latest session"
);
assert.match(
  backend,
  /if \(!useHistoryFallback && mmText_\(row\[5\]\) !== sessionId\) return;[\s\S]*?contactsBySourceId\[sourceId\] = contacts;/,
  "the latest valid contacts for each GongSil source id must win"
);

console.log("gongsil contact reconciliation tests passed");
