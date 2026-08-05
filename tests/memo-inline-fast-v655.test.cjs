const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
const backendPath = fs.readdirSync(path.resolve(root, "..", "outputs"))
  .filter((name) => name.startsWith("JS부동산_Code.gs"))
  .map((name) => path.resolve(root, "..", "outputs", name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const backend = fs.readFileSync(backendPath, "utf8");

function functionBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert(startIndex >= 0, `${start} 함수가 필요합니다.`);
  assert(endIndex > startIndex, `${start} 함수 범위를 찾지 못했습니다.`);
  return source.slice(startIndex, endIndex);
}

const memoUiBlock = functionBlock(
  script,
  "function toggleItemMemo(",
  "function memoDateLabel("
);
const memoSaveBlock = functionBlock(
  script,
  "function saveItemMemo(",
  "function getCustomerMatchStatus("
);
const memoBackendBlock = functionBlock(
  backend,
  "function updatePropertyMemoFromBody_(",
  "function applyPropertyDoneFontColor_("
);

assert(
  !memoUiBlock.includes("showList("),
  "메모 열기·수정·추가는 전체 매물목록을 다시 그리면 안 됩니다."
);
assert(
  script.includes('card.insertAdjacentHTML("beforeend", buildMemoPanelMarkupV655(item))'),
  "메모 패널은 해당 카드 한 장에만 즉시 반영해야 합니다."
);
assert(
  !memoSaveBlock.includes("loadSheet(") && !memoSaveBlock.includes("showList("),
  "메모 저장 성공 뒤 전체 시트 재조회·전체 목록 렌더링을 실행하면 안 됩니다."
);
assert(
  memoSaveBlock.includes('postSafeMutationV654("updatePropertyMemo", payload)') &&
    memoSaveBlock.includes("result.persisted !== true"),
  "메모 전용 저장과 서버 read-back 확인이 필요합니다."
);
assert(
  memoSaveBlock.includes("memoDraftValuesV655[key] = pending.enteredMemo") &&
    memoSaveBlock.includes("refreshMemoCardV655(key, true)"),
  "저장 실패 시 입력내용을 잃지 않고 같은 카드 편집창을 복구해야 합니다."
);
assert(
  memoBackendBlock.includes("findItemRowByPropertyId_") &&
    !memoBackendBlock.includes("verifyPropertyIdentityAtRow_"),
  "메모 저장 대상은 매물ID로만 식별해야 합니다."
);
assert(
  memoBackendBlock.includes("lock.tryLock(4000)") &&
    memoBackendBlock.includes("retryable: true"),
  "잠금 충돌은 긴 대기 없이 동일 요청번호 재시도로 넘겨야 합니다."
);
assert(
  /setValue\(contactPlan\.json\)[\s\S]*setValue\(contactPlan\.cleanedMemo\)[\s\S]*storedMemo[\s\S]*verifiedContactJson/.test(
    memoBackendBlock
  ),
  "연락처와 메모 저장 뒤 실제 시트값을 모두 재확인해야 합니다."
);
assert(
  memoBackendBlock.includes("mmAppendHistoryFast_") &&
    memoBackendBlock.includes('"매물리스트 메모버튼"') &&
    memoBackendBlock.includes("persisted: true"),
  "메모 변경 전후 이력을 남긴 뒤에만 저장완료를 응답해야 합니다."
);
assert(
  html.includes("style.css?v=6.5.33-admin-count-confirmed") &&
  html.includes("script.js?v=6.5.64-naver-map-auth-fallback"),
  "운영 브라우저가 새 메모 UI를 즉시 받도록 캐시 버전을 올려야 합니다."
);
assert(
  css.includes(".memo-inline-status.saving") &&
    css.includes(".memo-inline-status.success") &&
    css.includes(".memo-inline-status.error"),
  "카드 안에서 저장중·완료·실패 상태를 구분해 보여야 합니다."
);

console.log("fast inline memo v6.5.5 tests passed");
