const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const storageSource = read("js/diagnosis-storage.js");
const step2Source = read("js/permit-diagnosis-step2.js");
const step5Source = read("js/permit-diagnosis-step5.js");
const index = read("index.html");

assert(index.includes("diagnosis-storage.js"), "진단 저장 모듈을 연결해야 합니다.");
assert(index.includes("diagnosis-report.js"), "진단 변경 보고서를 연결해야 합니다.");
assert(index.includes("permit-diagnosis-step6.js"), "STEP 6 UI를 연결해야 합니다.");
assert(step2Source.includes("permit:facility-checks-updated-v1"), "시설 체크결과를 저장 단계로 전달해야 합니다.");
assert(step2Source.includes("permit:diagnosis-loaded-v1"), "저장된 시설 체크결과를 복원해야 합니다.");
assert(step5Source.includes("permit:call-result-updated-v1"), "통화 결과를 저장 단계로 전달해야 합니다.");

const store = new Map();
const context = {
  window: {
    localStorage: {
      setItem: (key, value) => store.set(key, value),
      getItem: (key) => store.get(key) || null
    }
  },
  fetch: () => Promise.reject(new Error("not used"))
};
vm.createContext(context);
vm.runInContext(storageSource, context);
const storage = context.window.PermitDiagnosisStorageV1;

const input = {
  listingId: "M-123",
  address: "대전 서구 탄방동 1283",
  floor: "1",
  unit: "101",
  area: "76.03"
};
const first = storage.buildRecord({
  industry: { id: "internet-computer-game", officialName: "인터넷컴퓨터게임시설제공업" },
  diagnosis: {
    input,
    record: { use: "제1종 근린생활시설", level: "호실", floor: "1", unit: "101" },
    building: { name: "테스트빌딩" },
    parking: 2,
    elevators: 1,
    violationStatus: "",
    queriedAt: "2026-07-29T01:00:00.000Z"
  },
  procedureResult: {
    currentUse: "제1종 근린생활시설",
    targetType: { label: "제2종 근린생활시설" },
    procedure: { code: "LEDGER_CHANGE", label: "기재내용 변경 검토" },
    ruleVersion: "test-v1"
  },
  facilityChecks: { entrance: "UNKNOWN" },
  diagnosisStatus: "ORANGE",
  callResults: { building: { confirmed: false, note: "" } }
});

assert(first.recordKey.startsWith("internet-computer-game_"), "업종별 저장키여야 합니다.");
assert.strictEqual(first.listingId, "M-123");
assert.strictEqual(first.publicDataSnapshot.currentUse, "제1종 근린생활시설");
assert.strictEqual(first.history.length, 0);

const otherIndustryKey = storage.makeRecordKey(input, "general-restaurant");
assert.notStrictEqual(first.recordKey, otherIndustryKey, "같은 매물도 업종별로 분리해야 합니다.");
const externalKey = storage.makeRecordKey({
  address: "대전 서구 탄방동 1283", floor: "1", unit: "101"
}, "internet-computer-game");
assert(externalKey, "외부 주소도 저장키를 만들 수 있어야 합니다.");

const second = storage.buildRecord({
  industry: { id: "internet-computer-game", officialName: "인터넷컴퓨터게임시설제공업" },
  diagnosis: {
    input,
    record: { use: "제2종 근린생활시설", level: "호실" },
    parking: 3,
    elevators: 1,
    violationStatus: "UNKNOWN",
    queriedAt: "2026-07-30T01:00:00.000Z"
  },
  procedureResult: {
    currentUse: "제2종 근린생활시설",
    targetType: { label: "제2종 근린생활시설" },
    procedure: { code: "NO_CHANGE", label: "변경 불필요" },
    ruleVersion: "test-v2"
  },
  diagnosisStatus: "YELLOW",
  previous: first
});

assert.strictEqual(second.history.length, 1, "이전 진단 요약을 이력으로 남겨야 합니다.");
assert(second.lastChanges.some((change) => change.field === "currentBuildingUse"), "용도 변경을 비교해야 합니다.");
assert(second.lastChanges.some((change) => change.field === "expectedProcedure.code"), "절차 변경을 비교해야 합니다.");
assert(second.lastChanges.some((change) => change.field === "publicDataSnapshot.parking"), "공공데이터 변경을 비교해야 합니다.");
assert(!JSON.stringify(second).includes("proxySecret"), "보안키를 진단 데이터에 저장하면 안 됩니다.");

console.log("permit diagnosis step6 tests: ok");
