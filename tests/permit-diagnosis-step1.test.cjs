const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const index = read("index.html");
const css = read("css/permit-diagnosis-v1.css");
const ui = read("js/permit-diagnosis-ui.js");
const property = read("js/property-location-input.js");
const parserSource = read("js/industry-intent-parser.js");
const catalog = JSON.parse(read("data/industry-catalog.json"));

assert(index.includes("permitDiagnosisOpenBtnV1"), "PC·태블릿 입점 버튼이 필요합니다.");
assert(index.includes("permit-diagnosis-v1.css"), "전용 CSS 연결이 필요합니다.");
assert(index.includes("permit-diagnosis-ui.js"), "전용 UI 연결이 필요합니다.");
assert(css.includes("@media (max-width: 768px)"), "모바일 미노출 규칙이 필요합니다.");
assert(css.includes("#permitDiagnosisModalV1"), "모바일에서 팝업도 차단해야 합니다.");
assert(ui.includes("업종 알아보기"), "기본 업종 알아보기 탭이 필요합니다.");
assert(ui.includes("고객·매물에 대입"), "고객·매물 대입 탭이 필요합니다.");
assert(ui.includes("현재 선택 매물 불러오기"), "선택 매물 불러오기가 필요합니다.");
assert(ui.includes('id="permitPublicDataBtnV1"'), "공공데이터 조회 버튼이 필요합니다.");
assert(property.includes("3.305785"), "평을 제곱미터로 안전하게 변환해야 합니다.");
assert(property.includes('(floorMatch ? "" : room)'), "층만 있는 값을 호실로 잘못 입력하면 안 됩니다.");
assert(property.includes("getSelectedPrintItems"), "목록 체크박스로 선택한 매물도 불러와야 합니다.");
assert(catalog.industries.length >= 10, "초기 참고 업종이 충분해야 합니다.");
assert(catalog.industries.some((item) => item.id === "internet-computer-game"), "PC방 공식 업종이 필요합니다.");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(parserSource, context);
const results = context.window.PermitIndustryIntentParserV1.interpret(
  "성인만 이용하는 PC방에 컴퓨터 40대를 설치하고 음료도 판매합니다.",
  catalog.industries,
  4
);
assert(results.length > 0, "자연어에서 후보를 반환해야 합니다.");
assert.strictEqual(results[0].industry.id, "internet-computer-game", "PC방 요청은 인터넷컴퓨터게임시설제공업이 우선이어야 합니다.");

const propertyContext = {
  window: {
    selectedItemKey: "active-key",
    allItems: [
      { key: "active-key", name: "활성매물", address: "대전 서구 A", room: "2층", area: 10, propertyId: "P-1" },
      { key: "checked-key", name: "체크매물", address: "대전 서구 B", room: "1층 101호", area: 20, propertyId: "P-2" }
    ]
  }
};
propertyContext.window.getSelectedPrintItems = () => [propertyContext.window.allItems[1]];
vm.createContext(propertyContext);
vm.runInContext(property, propertyContext);
const locationApi = propertyContext.window.PermitPropertyLocationInputV1;
assert.strictEqual(locationApi.getSelectedItem().key, "checked-key", "체크한 한 건을 활성 매물보다 우선해야 합니다.");
const loaded = locationApi.fromItem(locationApi.getSelectedItem());
assert.strictEqual(loaded.floor, "1층", "층을 분리해 불러와야 합니다.");
assert.strictEqual(loaded.unit, "101호", "호실을 분리해 불러와야 합니다.");
assert.strictEqual(loaded.listingId, "P-2", "매물번호를 불러와야 합니다.");
assert.strictEqual(loaded.area, "66.12", "평수를 제곱미터로 변환해야 합니다.");
propertyContext.window.getSelectedPrintItems = () => propertyContext.window.allItems;
assert.strictEqual(locationApi.getSelectedItemResult().count, 2, "여러 건 체크는 단일 진단으로 불러오면 안 됩니다.");

console.log("permit diagnosis step1 tests: ok");
