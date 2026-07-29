const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const queue = fs.readFileSync(path.join(root, "js", "async-mutation-queue-v1.js"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const operations = fs.readFileSync(path.join(root, "js", "operations-center-v7.js"), "utf8");
const reviews = fs.readFileSync(path.join(root, "js", "operations-collection-v8.js"), "utf8");
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

ok(script.includes('postSafeMutationV654("toggleDone"'), "매물 메모·상태 저장은 대기열을 사용해야 합니다.");
ok(script.includes('postSafeMutationV654("updateProperty"'), "매물수정은 대기열을 사용해야 합니다.");
ok(operations.includes('"updateCustomerMatch", "addCustomerActivity"'), "고객매칭·상담기록은 대기열을 사용해야 합니다.");
ok(reviews.includes('action === "applyReviewBatch"'), "매물검증 일괄처리는 대기열을 사용해야 합니다.");

ok(backend.includes('const WORK_QUEUE_SHEET_NAME = "JS_작업대기열"'), "영구 작업대기열 시트가 필요합니다.");
ok(backend.includes('["대기", "처리중", "재시도"]'), "같은 대상의 순서 보장이 필요합니다.");
ok(backend.includes("leaseExpiredBefore"), "중단된 처리중 작업의 자동 복구가 필요합니다.");
ok(backend.includes("job.storedResult || dispatchQueuedMutationV654_"), "검증 재시도 때 작업을 중복 실행하면 안 됩니다.");
ok(backend.includes("recordQueueExecutionResultV654_"), "실행 결과를 검증 전에 영구 저장해야 합니다.");
ok(backend.includes("실제 저장값 확인 완료"), "최종 완료 전 실제 시트 검증이 필요합니다.");
ok(backend.includes("job.attempts < 3"), "실패 작업만 제한적으로 재시도해야 합니다.");
ok(backend.includes('case "updateCustomerMatch"') && backend.includes("고객매칭 상태 불일치"), "고객매칭 read-back 검증이 필요합니다.");
ok(backend.includes('case "applyReviewBatch"') && backend.includes("대기행"), "매물검증 read-back 검증이 필요합니다.");

console.log("async mutation queue v6.5.4 tests passed");
