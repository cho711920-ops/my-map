const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const scriptSource = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const mapSource = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
const gasPath = path.resolve(
  root,
  "..",
  "outputs",
  "JS부동산_Code.gs_v6.5.4_연락처6개_안전작업대기열_최종본.gs"
);
const gasSource = fs.readFileSync(gasPath, "utf8");

const frontendStart = scriptSource.indexOf("var LIST_CONTACT_ROLE_META_V650");
const frontendEnd = scriptSource.indexOf("function listDisplayValueV650");
assert(frontendStart >= 0 && frontendEnd > frontendStart, "연락처 프론트 함수 범위를 찾지 못했습니다.");

const frontendContext = { window: {} };
vm.createContext(frontendContext);
vm.runInContext(
  scriptSource.slice(frontendStart, frontendEnd),
  frontendContext
);

const extracted = frontendContext.extractListContactsV650({
  landlordPhone: "01058481962",
  tenantPhone: "010-1111-2222",
  contactListRaw: JSON.stringify([
    { role: "관", phone: "042-123-4567" },
    { role: "주", phone: "010-5848-1962" }
  ]),
  memo: "사장) 010-3333-4444 / 연락 01055556666"
});
assert.strictEqual(extracted.length, 5, "J·K·S·메모의 모든 번호를 합쳐야 합니다.");
assert.strictEqual(
  extracted.filter((contact) => contact.phone.key === "01058481962").length,
  1,
  "같은 번호는 형식이 달라도 한 번만 표시해야 합니다."
);
assert(
  extracted.some((contact) => contact.role === "기" && contact.phone.key === "01055556666"),
  "역할 없는 메모 번호도 기타 연락처로 보존해야 합니다."
);

const spouseContact = frontendContext.extractListContactsV650({
  contactListRaw: JSON.stringify([
    { role: "\uAE30", phone: "010-9138-9139" }
  ]),
  memo: "\uC0AC\uBAA8: \u00B7 \uCD94\uAC00\uC5F0\uB77D\uCC98 010-9138-9139"
});
assert.strictEqual(spouseContact.length, 1);
assert.strictEqual(
  spouseContact[0].role,
  "\uC5EC",
  "사모 추가연락처는 기타가 아니라 사모 역할로 승격해야 합니다."
);

const sevenContacts = frontendContext.extractListContactsV650({
  contactListRaw: JSON.stringify([
    ["주", "010-0000-0001"],
    ["주", "010-0000-0002"],
    ["주", "010-0000-0003"],
    ["주", "010-0000-0004"],
    ["주", "010-0000-0005"],
    ["주", "010-0000-0006"],
    ["주", "010-0000-0007"]
  ].map(([role, phone]) => ({ role, phone })))
});
assert.strictEqual(sevenContacts.length, 6, "화면에는 최대 6개까지만 표시해야 합니다.");

assert(
  /customerMatchControls \? headerContactButtonV654 : ''/.test(scriptSource),
  "고객 매물지도 연락처 버튼은 등록일 앞 헤더에 배치해야 합니다."
);
assert(
  /\(!customerMatchControls \? actionContactButtonV654 : ''\)/.test(scriptSource),
  "기본 매물목록 연락처 버튼은 작업 버튼줄 첫 칸에 배치해야 합니다."
);
assert(
  /\.item-contact-button-v654\.has-contacts[\s\S]*background:\s*#10b981/.test(cssSource),
  "연락처가 있으면 눈에 띄는 초록 배경이어야 합니다."
);
assert(
  /\.item-contact-button-v654\.no-contacts[\s\S]*background:\s*#334155/.test(cssSource),
  "연락처가 없으면 어두운 배경이어야 합니다."
);
assert(/contactListRaw:\s*clean\(c\[17\]\)/.test(mapSource), "S열 연락처 JSON을 읽어야 합니다.");

const gasStart = gasSource.indexOf("function normalizeText_");
const gasEnd = gasSource.indexOf("function normalizeBuildingNameV638_");
assert(gasStart >= 0 && gasEnd > gasStart, "Apps Script 연락처 함수 범위를 찾지 못했습니다.");
const gasContext = {
  PROPERTY_CONTACT_LIST_COLUMN: 19
};
vm.createContext(gasContext);
vm.runInContext(gasSource.slice(gasStart, gasEnd), gasContext);

const row = new Array(19).fill("");
row[9] = "01058481962";
row[10] = "010-1111-2222";
row[11] = "문의는 관리) 042-123-4567, 주차 가능. 연락 010-3333-4444";
row[15] = "JS-test";
const plan = gasContext.buildContactStorageV654_(row, [], row[11]);
assert.strictEqual(plan.ok, true);
assert.strictEqual(plan.contacts.length, 4);
assert(!/042-123-4567|010-3333-4444/.test(plan.cleanedMemo), "저장할 번호만 메모에서 제거해야 합니다.");
assert(/문의는|주차 가능|연락/.test(plan.cleanedMemo), "전화번호 외 메모 내용은 보존해야 합니다.");

const spouseRow = new Array(19).fill("");
spouseRow[11] = "\uC0AC\uBAA8: \u00B7 \uCD94\uAC00\uC5F0\uB77D\uCC98 010-9138-9139";
spouseRow[18] = JSON.stringify([{role: "\uAE30", phone: "010-9138-9139"}]);
const spousePlan = gasContext.buildContactStorageV654_(
  spouseRow,
  [],
  spouseRow[11]
);
assert.strictEqual(spousePlan.ok, true);
assert.strictEqual(spousePlan.contacts.length, 1);
assert.strictEqual(spousePlan.contacts[0].role, "\uC5EC");
assert.strictEqual(spousePlan.cleanedMemo, "");
assert(
  !/idCounts\[propertyId\]\s*!==\s*1/.test(gasSource),
  "동일 매물ID 행도 전화번호가 정확히 일치하면 역할 복구 대상에서 제외하면 안 됩니다."
);

const overflowRow = new Array(19).fill("");
overflowRow[11] = [
  "010-0000-0001", "010-0000-0002", "010-0000-0003", "010-0000-0004",
  "010-0000-0005", "010-0000-0006", "010-0000-0007"
].join(" ");
const overflowPlan = gasContext.buildContactStorageV654_(overflowRow, [], overflowRow[11]);
assert.strictEqual(overflowPlan.ok, false);
assert.strictEqual(overflowPlan.overflow, true);
assert.strictEqual(overflowRow[11].includes("010-0000-0007"), true, "6개 초과 시 원본 메모를 보존해야 합니다.");

assert(
  /setValue\(contactPlan\.json\)[\s\S]*SpreadsheetApp\.flush\(\)[\s\S]*getDisplayValue\(\)[\s\S]*cleanedMemo/.test(gasSource),
  "연락처 저장 후 재확인한 뒤에만 메모를 정리해야 합니다."
);
assert(
  /CONTACT_MIGRATION_BACKUP_SHEET_NAME\s*=\s*"JS_연락처이전백업"/.test(gasSource),
  "메모 정리 전 복구용 백업 시트를 사용해야 합니다."
);
assert(
  /function contactRoleRecoveryMapV655_[\s\S]*role === "기"[\s\S]*result\[propertyId\]\[phoneKey\]/.test(gasSource),
  "기타로 잘못 저장된 번호는 백업 원문에서 명시된 역할만 복구해야 합니다."
);
assert(
  /contactRoleRecoveryMapV655_\(spreadsheet\)[\s\S]*buildContactStorageV654_\([\s\S]*recoveryContacts/.test(gasSource),
  "연락처 재이전 때 매물ID·전화번호가 일치하는 백업 역할을 적용해야 합니다."
);

console.log("listing contacts v6.5.4 tests passed");
