const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const frontendSource = fs.readFileSync(
  path.join(root, "js", "building-register-v6.js"),
  "utf8"
);
const frontendContext = {
  window: {},
  document: {},
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  console,
  URLSearchParams,
  fetch() {
    return Promise.reject(new Error("network disabled in unit test"));
  },
  setTimeout,
  clearTimeout
};
vm.runInNewContext(frontendSource, frontendContext, {
  filename: "building-register-v6.js"
});

const diagnostic = frontendContext.window.JSBuildingRegisterDiagnosticsV652;
assert(diagnostic, "frontend diagnostics are missing");

const apartmentBuildings = [
  {
    managementKey: "title-main",
    buildingName: "은하수아파트",
    dongName: "101동",
    registerType: "집합 · 표제부",
    mainUse: "공동주택"
  },
  {
    managementKey: "title-shop",
    buildingName: "은하수아파트",
    dongName: "상가동",
    registerType: "집합 · 표제부",
    mainUse: "제2종근린생활시설",
    otherUse: "아파트단지내상가"
  }
];
const apartmentUnits = [
  { managementKey: "unit-a", buildingName: "은하수아파트", dongName: "101동", floorNo: 1, roomName: "101호" },
  { managementKey: "unit-b", buildingName: "은하수아파트", dongName: "101동", floorNo: 1, roomName: "102호" },
  { managementKey: "unit-c", buildingName: "은하수아파트", dongName: "상가동", floorNo: 1, roomName: "101호" },
  { managementKey: "unit-d", buildingName: "은하수아파트", dongName: "상가동", floorNo: 1, roomName: "102호" }
];
const apartmentData = { buildings: apartmentBuildings, units: apartmentUnits };
const commercialItem = { name: "은하수아파트 상가동", type: "상가점포", room: "101호" };
assert.strictEqual(
  diagnostic.bestBuildingIndex(apartmentData, commercialItem),
  1,
  "commercial listing must default to the apartment retail building"
);
assert.deepStrictEqual(
  diagnostic.unitEntriesForBuilding(apartmentBuildings[1], apartmentUnits, apartmentBuildings)
    .map((entry) => entry.row.dongName),
  ["상가동", "상가동"],
  "selected retail building must not contain apartment residential units"
);

const shopWithoutUnits = {
  managementKey: "title-shop-empty",
  buildingName: "다모아아파트",
  dongName: "상가동",
  registerType: "집합 · 표제부",
  mainUse: "제2종근린생활시설"
};
const mixedParcelBuildings = [apartmentBuildings[0], shopWithoutUnits];
assert.strictEqual(
  diagnostic.unitEntriesForBuilding(
    shopWithoutUnits,
    apartmentUnits.filter((row) => row.dongName === "101동"),
    mixedParcelBuildings
  ).length,
  0,
  "an empty retail building must never fall back to another apartment building"
);

const sharkBuildings = [
  {
    managementKey: "shark-general",
    buildingName: "샤크존",
    registerType: "일반 · 일반건축물",
    mainUse: "자동차관련시설"
  },
  {
    managementKey: "shark-collective",
    buildingName: "샤크존",
    dongName: "상가동",
    registerType: "집합 · 표제부",
    mainUse: "판매시설"
  }
];
const sharkUnits = [
  { managementKey: "shark-unit", buildingName: "샤크존", dongName: "상가동", floorNo: 3, roomName: "315호" }
];
assert.strictEqual(
  diagnostic.bestBuildingIndex(
    { buildings: sharkBuildings, units: sharkUnits },
    { name: "샤크존", type: "집합상가", room: "315호" }
  ),
  1,
  "collective mall title with the listing room must beat a general title"
);

const backendPath = path.resolve(
  root,
  "..",
  "outputs",
  "JS부동산_Code.gs_v6.4.19_집합건물표제부_전유부_보강_최종본.gs"
);
const backendContext = { console };
vm.createContext(backendContext);
vm.runInContext(fs.readFileSync(backendPath, "utf8"), backendContext, {
  filename: path.basename(backendPath)
});

const firstArea = {
  buildingName: "은하수아파트",
  dongName: "상가동",
  floorType: "지상",
  floorNo: 1,
  roomName: "101호",
  areaType: "전유",
  area: 25
};
const sameRoomPublicArea = {
  ...firstArea,
  areaType: "공용",
  area: 9
};
const differentBuildingSameRoom = {
  ...firstArea,
  dongName: "101동",
  areaType: "전유",
  area: 84
};
assert.strictEqual(
  backendContext.buildingRegisterUnitMatchKey_(firstArea),
  backendContext.buildingRegisterUnitMatchKey_(sameRoomPublicArea),
  "exclusive and common area rows of one room must share a unit key"
);
assert.notStrictEqual(
  backendContext.buildingRegisterUnitMatchKey_(firstArea),
  backendContext.buildingRegisterUnitMatchKey_(differentBuildingSameRoom),
  "same room number in another building must have a different unit key"
);
assert.strictEqual(
  backendContext.buildingRegisterSameUnit_(firstArea, differentBuildingSameRoom),
  false,
  "same room number in another apartment building must not be merged"
);
assert.strictEqual(
  backendContext.buildingRegisterSameUnit_(firstArea, sameRoomPublicArea),
  true,
  "one room's exclusive and common area rows must be merged"
);
assert.strictEqual(
  backendContext.buildingRegisterSameBuilding_(
    apartmentBuildings[1],
    { buildingName: "은하수아파트", dongName: "101동" },
    2
  ),
  false,
  "floor rows from another apartment building must be excluded"
);

console.log("building register v10 tests: OK");
