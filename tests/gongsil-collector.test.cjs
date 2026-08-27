const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "gongsil-collector.js"),
  "utf8"
);

assert.match(source, /var VERSION = "2\.2\.3";/);
assert.match(source, /var LIST_RETRY_DELAYS = \[0, 800, 2000\];/);
assert.match(source, /var SAVE_BATCH_SIZE = 8;/);
assert.match(source, /var MIN_SAVE_BATCH_SIZE = 1;/);
assert.match(source, /var MAX_SAVE_BATCH_SIZE = 8;/);
assert.match(source, /runAutomatic: runAutomatic/);
assert.match(source, /data-action="auto-register"/);
assert.match(
  source,
  /complete: isCompleteGongsilCapture\(selectedCount, items\.length\)/,
  "공실박스 완전수집 판정은 선택 수와 최종 목록 수가 정확히 같을 때만 인정하면 안 됩니다."
);
assert.match(
  source,
  /async function fetchGongsilListWithRetry\([\s\S]*?LIST_RETRY_DELAYS\.length[\s\S]*?공실박스 목록 연결을 자동 복구 중입니다\./,
  "공실박스 전체 목록 조회는 일시적인 네트워크·응답 오류를 자동 재시도해야 합니다."
);
assert.match(
  source,
  /async function loadSelectedChunkWithFallback\([\s\S]*?state\.listFailures\.push[\s\S]*?entries\.slice\(0, middle\)[\s\S]*?entries\.slice\(middle\)/,
  "반복 실패한 목록 묶음은 작은 단위로 분할하고 단일 실패만 격리해야 합니다."
);
assert.match(source, /if \(byId\[id\]\) return;[\s\S]*?entries\.push/);
assert.match(
  source,
  /complete: isCompleteGongsilCapture\(selectedCount, items\.length\) &&\s*listFailures\.length === 0/,
  "목록조회 제외가 있으면 완전수집 판정으로 기존 매물을 숨기면 안 됩니다."
);
assert.match(source, /data-metric="conditionUpdated"/);
assert.match(source, /data-metric="refreshed"/);
assert.match(source, /data-metric="detailedDuplicates"/);
assert.match(source, /data-metric="skippedUnchanged"/);
assert.match(
  source,
  /function pollMutationStatus\(requestId, collectorKey\)[\s\S]*?var maxWaitMs = 7 \* 60 \* 1000;[\s\S]*?function canRetry\(\)[\s\S]*?if \(canRetry\(\)\)/,
  "공실박스 대량 저장은 Apps Script 장기 처리 결과를 충분히 기다려야 합니다."
);
assert.match(
  source,
  /var BUSY_RETRY_DELAYS = \[3000, 6000, 10000, 15000, 20000, 30000\];/
);
assert.match(
  source,
  /var detailItems = items\.filter\([\s\S]*?classification\.needs\[id\] \|\| classification\.refresh\[id\]/
);
const collectPhonesSource = source.slice(
  source.indexOf("async function collectPhones("),
  source.indexOf("function isTenantLabel(")
);
assert.ok(
  /appendNestedContactFields\(listingCandidates,\s*detail && detail\.floorinfo/.test(collectPhonesSource) &&
    /appendNestedContactFields\(buildingCandidates,\s*detail && detail\.bilinfo/.test(collectPhonesSource) &&
    /contacts:\s*uniqueContacts\.map/.test(collectPhonesSource),
  "공실박스의 호실·건물 연락처를 모두 수집하고 contactList에 누락 없이 보존해야 합니다."
);
assert.match(
  source,
  /var CONTACT_PHONE_KEYS = \[[\s\S]*?"MobileNo", "mobileNo"[\s\S]*?function appendContactValue\(target, value, inheritedRole\)/
);
assert.match(
  source,
  /appendNestedContactFields\(listingCandidates, detail && detail\.floorinfo, "", 0\)/,
  "해당 공실박스 원본의 floorinfo 내부 연락처를 중첩 구조에서도 찾아야 합니다."
);
assert.match(
  source,
  /async function ensureDetailAuth\(\)[\s\S]*?state\.detailAuth\.guest !== true[\s\S]*?saveDetailAuth\(null\)/,
  "비로그인 guest 상세응답으로 연락처 없는 매물을 저장하면 안 됩니다."
);
assert.match(
  source,
  /phones = await collectPhones\(item, requestBody, addressData, detail\);/,
  "공실박스 원본 연락처는 역할 확인에 성공했을 때 저장해야 합니다."
);
assert.match(
  source.slice(source.indexOf("async function transformItem("), source.indexOf("function collectMediaUrls(")),
  /catch \(contactError\)[\s\S]*?record\.preserveContacts = true;[\s\S]*?record\.contactCaptureStatus = "deferred";/,
  "연락처 조회 실패 시 매물은 저장하되 기존 연락처를 보존해야 합니다."
);
assert.match(
  source,
  /var retryDelays = \[0, 600, 1600\];/,
  "일시적인 상세조회 오류는 제한적으로 재시도해야 합니다."
);

const nestedContactSource = source.slice(
  source.indexOf("var CONTACT_PHONE_KEYS"),
  source.indexOf("async function collectPhones(")
);
const appendNestedContactFields = new Function(`
  function text(value) { return value == null ? "" : String(value).trim(); }
  function pick(source, keys) {
    source = source || {};
    for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
    return "";
  }
  function normalizePhone(value) {
    const digits = text(value).replace(/\\D/g, "");
    return digits.length >= 9 && digits.length <= 12 ? digits : "";
  }
  ${nestedContactSource}
  return appendNestedContactFields;
`)();
const nestedContacts = [];
appendNestedContactFields(nestedContacts, {
  wrapper: { Ty: "J", contacts: [{ telNo: "010-1111-2222" }] }
}, "", 0);
assert.ok(nestedContacts.length >= 1);
assert.ok(nestedContacts.some(contact =>
  contact.telNo === "010-1111-2222" && contact.Role === "J"
));
assert.match(
  source,
  /"Ty2", "ty2", "Ty1", "ty1",\s*"TelType", "telType"/
);
assert.match(
  source,
  /detailedDuplicates: result\.detailedDuplicates !== undefined[\s\S]*?skippedUnchanged: unchangedItemCount/
);
assert.match(
  source,
  /"개, 상세중복 " \+ totals\.duplicate \+[\s\S]*?"개, 기존 동일 생략 " \+ Number\(metadata\.unchanged \|\| 0\)/
);
assert.match(
  collectPhonesSource,
  /if \(!uniqueContacts\.length\) \{\s*throw new Error\(/,
  "공실박스 연락처가 비어 있으면 역할 검증 실패를 상위 변환 흐름에 알려야 합니다."
);
assert.match(source, /data-metric="contactDeferred"/);
assert.match(source, /requiredFieldRejected: Number\(metadata\.rejectedCount \|\| 0\)/);
assert.match(source, /contactDeferred: Number\(metadata\.contactDeferredCount \|\| 0\)/);
assert.match(
  source,
  /function importItemTotal\(records, metadata\)[\s\S]*?Math\.max\([\s\S]*?Number\(metadata\.found \|\| 0\)/
);
assert.match(
  source,
  /async function sendToAppsScript\(records, metadata, suppliedCollectorKey\)[\s\S]*?var itemsLength = importItemTotal\(records, metadata\);/
);

const helperSource = source.match(
  /function importItemTotal\(records, metadata\) \{[\s\S]*?\n  \}/
)[0];
const importItemTotal = new Function(
  `${helperSource}\nreturn importItemTotal;`
)();

const getRoomSource = source.match(
  /function getRoom\(item\) \{[\s\S]*?\n  \}/
)[0];
const getRoom = new Function(`
  function text(value) { return value == null ? "" : String(value).trim(); }
  function pick(item, keys) {
    for (const key of keys) if (item && item[key] !== undefined && item[key] !== null) return item[key];
    return "";
  }
  ${getRoomSource}
  return getRoom;
`)();

assert.equal(getRoom({ Ho: "1층" }), "1층");
assert.equal(getRoom({ Ho: "지하1층" }), "지하1층");
assert.equal(getRoom({ Ho: "102" }), "102호");
assert.equal(getRoom({ BfFloor: 2 }), "2층");

assert.equal(
  importItemTotal(new Array(2354), {
    found: 2486,
    unchanged: 0,
    rejectedCount: 132
  }),
  2486
);
assert.equal(
  importItemTotal(new Array(300), {
    found: 2486,
    unchanged: 2050,
    rejectedCount: 136
  }),
  2486
);

const completeCaptureSource = source.match(
  /function isCompleteGongsilCapture\(selectedCount, capturedCount\) \{[\s\S]*?\n  \}/
)[0];
const isCompleteGongsilCapture = new Function(
  `${completeCaptureSource}\nreturn isCompleteGongsilCapture;`
)();

assert.equal(isCompleteGongsilCapture(2490, 2504), true);
assert.equal(isCompleteGongsilCapture(2504, 2490), false);
assert.equal(isCompleteGongsilCapture(1999, 2504), false);

assert.match(
  source,
  /Boolean\(metadata\.complete\)[\s\S]*?!stopped[\s\S]*?Number\(totals\.failed \|\| 0\) === 0 &&[\s\S]*?Number\(metadata\.rejectedCount \|\| 0\) === 0,/
);

const saveFunction = source.slice(
  source.indexOf("async function sendToAppsScript("),
  source.indexOf("async function sendAppsScriptBatch(")
);
const offsetPosition = saveFunction.indexOf("offset += batch.length;");
const checkpointPosition = saveFunction.indexOf(
  "localStorage.setItem(SAVE_PROGRESS_KEY",
  offsetPosition
);
const dashboardPosition = saveFunction.indexOf(
  "updateDashboard({",
  offsetPosition
);
const failedBatchPosition = saveFunction.indexOf(
  "if (failedInBatch > 0)"
);
assert.ok(offsetPosition >= 0);
assert.ok(failedBatchPosition >= 0);
assert.ok(failedBatchPosition < offsetPosition);
assert.ok(checkpointPosition > offsetPosition);
assert.ok(dashboardPosition > checkpointPosition);
assert.match(
  saveFunction,
  /if \(failedInBatch > 0\)[\s\S]*?addImportResult\(totals, result\);[\s\S]*?saveFailureReasons\.push[\s\S]*?offset \+= batch\.length;[\s\S]*?continue;/,
  "단일 저장 실패는 기록한 뒤 나머지 매물 저장을 계속해야 합니다."
);
assert.match(
  saveFunction,
  /Boolean\(metadata\.complete\)[\s\S]*?!stopped[\s\S]*?Number\(totals\.failed \|\| 0\) === 0 &&[\s\S]*?Number\(metadata\.rejectedCount \|\| 0\) === 0/
);
assert.match(source, /collectorVersion: VERSION/);
assert.match(source, /validationVersion: 2/);
assert.match(
  source,
  /function isBusyMutationResult\(result\)[\s\S]*?function isBusyMutationError\(error\)/
);
assert.match(
  source,
  /async function classifyGongsilManifest\([\s\S]*?if \(isBusyMutationResult\(result\)\)[\s\S]*?offset -= chunkSize;[\s\S]*?continue;/
);
assert.match(
  source,
  /async function sendAppsScriptBatch\([\s\S]*?busyError\.isCollectorBusy = true/
);
assert.match(
  source,
  /async function finalizeGongsilSession\([\s\S]*?return finalizeGongsilSession\(metadata, collectorKey, complete, stopped\);/
);

console.log("gongsil collector tests passed");
