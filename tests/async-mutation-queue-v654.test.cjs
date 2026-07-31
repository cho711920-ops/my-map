const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const queue = fs.readFileSync(path.join(root, "js", "async-mutation-queue-v1.js"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const operations = fs.readFileSync(path.join(root, "js", "operations-center-v7.js"), "utf8");
const reviews = fs.readFileSync(path.join(root, "js", "operations-collection-v8.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
const backendPath = fs.readdirSync(path.resolve(root, "..", "outputs"))
  .filter((name) => name.startsWith("JS부동산_Code.gs"))
  .map((name) => path.resolve(root, "..", "outputs", name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const backend = fs.readFileSync(backendPath, "utf8");

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

ok(queue.includes("js_async_mutation_outbox_v1"), "브라우저 종료 후 유지되는 outbox가 필요합니다.");
ok(queue.includes("js_async_mutation_active_v1"), "접수된 원격 작업 추적 저장소가 필요합니다.");
ok(queue.includes('keepalive: true'), "페이지 종료 중에도 접수 요청을 유지해야 합니다.");
ok(queue.includes('js-async-mutation-finished'), "실제 완료·실패 이벤트가 필요합니다.");
ok(queue.includes("완료 ") && queue.includes("저장 중") && queue.includes("실패 "), "상태 건수 표시가 필요합니다.");
ok(html.indexOf('id="asyncMutationStatusV1"') < html.indexOf('class="quick-add-btn'), "저장상태는 빠른등록 바로 왼쪽에 있어야 합니다.");
ok(html.includes("async-mutation-queue-v1.js?v=1.0.3-compact-status"), "새 저장상태 UI 캐시 버전이 필요합니다.");
ok(css.includes("grid-column: 5 !important") && css.includes("@media (max-width: 768px)"), "태블릿·PC 상단 배치와 모바일 숨김 규칙이 필요합니다.");
ok(css.includes(".v6-toolbar-secondary.v6-command-bar > .async-mutation-status-v1") && css.includes("display: none !important"), "모바일에서 저장상태를 숨겨야 합니다.");
ok(queue.includes("<small>완료</small>") && queue.includes("<small>저장중</small>") && queue.includes("<small>실패</small>"), "좁은 화면에서도 잘리지 않는 3칸 상태 표시가 필요합니다.");

ok(script.includes('postSafeMutationV654("updatePropertyMemo"'), "매물 메모 전용 저장 경로가 필요합니다.");
ok(script.includes('postSafeMutationV654("toggleDone"'), "매물 상태 저장 경로가 필요합니다.");
ok(script.includes('postSafeMutationV654("updateProperty"'), "매물수정 저장 경로가 필요합니다.");
ok(script.includes("persisted: true"), "매물 저장은 실제 서버 성공을 확인해야 합니다.");
ok(script.includes('"web-save-" + Date.now()') && script.includes("retryDelays"), "직접 저장에는 고유 요청번호와 제한 재시도가 필요합니다.");
ok(script.includes("result.retryable === true") && script.includes("networkRetry"), "잠금·일시 네트워크 오류만 재시도해야 합니다.");
ok(!operations.includes("return window.JSAsyncMutations.enqueue("), "고객 수정은 실제 시트 저장 전 완료 처리하면 안 됩니다.");
ok(!reviews.includes("return window.JSAsyncMutations.enqueue("), "매물검증은 실제 시트 저장 전 목록에서 제거하면 안 됩니다.");
ok(reviews.includes('if (!response.ok) throw new Error("매물검증 저장에 실패했습니다.'), "매물검증 HTTP 실패를 사용자에게 알려야 합니다.");

ok(backend.includes('const WORK_QUEUE_SHEET_NAME = "JS_작업대기열"'), "영구 작업대기열 시트가 필요합니다.");
ok(backend.includes('["대기", "처리중", "재시도"]'), "같은 대상의 순서 보장이 필요합니다.");
ok(backend.includes("leaseExpiredBefore"), "중단된 처리중 작업의 자동 복구가 필요합니다.");
ok(backend.includes("job.storedResult || dispatchQueuedMutationV654_"), "검증 재시도 때 작업을 중복 실행하면 안 됩니다.");
ok(backend.includes("recordQueueExecutionResultV654_"), "실행 결과를 검증 전에 영구 저장해야 합니다.");
ok(backend.includes("실제 저장값 확인 완료"), "최종 완료 전 실제 시트 검증이 필요합니다.");
ok(
  /"toggleDone",\s*"updatePropertyMemo",\s*"updateProperty",\s*"deleteProperty"/.test(backend),
  "직접 저장 재시도 시 메모 전용 저장을 포함한 성공 요청을 중복 실행하면 안 됩니다."
);
ok(backend.includes("lock.tryLock(4000)") && backend.includes("retryable: true"), "잠금 충돌은 짧게 반환하여 동일 요청으로 재시도해야 합니다.");
const toggleDoneFunction = backend.slice(
  backend.indexOf("function updateDoneStatus_(body)"),
  backend.indexOf("function applyPropertyDoneFontColor_")
);
ok(
  toggleDoneFunction.includes("lock.tryLock(4000)") &&
    toggleDoneFunction.includes("retryable: true") &&
    !toggleDoneFunction.includes("lock.waitLock("),
  "메모·연락처 저장 자체가 긴 잠금 대기로 끝나지 않고 안전 재시도되어야 합니다."
);
ok(backend.includes("job.attempts < 3"), "실패 작업만 제한적으로 재시도해야 합니다.");
ok(backend.includes('case "updateCustomerMatch"') && backend.includes("고객매칭 상태 불일치"), "고객매칭 read-back 검증이 필요합니다.");
ok(backend.includes('case "applyReviewBatch"') && backend.includes("대기행"), "매물검증 read-back 검증이 필요합니다.");

console.log("async mutation queue v6.5.4 tests passed");
