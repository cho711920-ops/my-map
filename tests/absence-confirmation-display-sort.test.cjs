const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const unifiedSource = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const doneStart = script.indexOf("function isDone(item)");
const doneEnd = script.indexOf("function isFavorite", doneStart);
const filterStart = script.indexOf("function readOptionalFilterNumberV1");
const filterEnd = script.indexOf("function getCoordinateDistanceMetersV658", filterStart);
const sortStart = script.indexOf("function updateSortDropdownUI()");
const sortEnd = script.indexOf("function selectSortOption", sortStart);

function master(propertyId, regDate, extra = {}) {
  return {propertyId, key:"saved-key-" + propertyId, name:propertyId, address:"검수 주소 " + propertyId,
    room:"기존 찜 키", memo:"사용자 메모", state:"active", regDate, sheetRow:1,
    source:"네이버", type:"상가", deposit:1000, rent:50, premium:0, area:20, latlng:{}, ...extra};
}
function candidate(originalId, absenceConfirmedAt, extra = {}) {
  return {originalId, source:"네이버", active:0, candidateEligible:true, availabilityKind:"census_missing",
    deposit:1000, rent:50, premium:0, area:20, floor:1, absenceConfirmedAt, ...extra};
}
function harness(items = []) {
  const elements = Object.fromEntries([
    "keyword", "typeFilter", "sourceFilter", "floorQuickFilter", "brokerageFeeFilter", "sortFilter",
    "industryFilter", "minDeposit", "maxDeposit", "minRent", "maxRent", "minPremium", "maxPremium", "minArea", "maxArea"
  ].map(id => [id, {value:""}]));
  elements.sortFilter.value = "latest";
  let parseCalls = 0;
  class CountedDate extends Date { static parse(raw) { parseCalls += 1; return Date.parse(raw); } }
  const context = {
    allItems:items, innerWidth:1280, favoriteOnly:false, hideDone:false, doneOnly:true,
    gongsilOnly:false, newListingDays:0, jsInitialFullListingsLoadingV1:false,
    map:{getBounds:() => ({contain:() => true})},
    document:{getElementById:id => elements[id] || null, addEventListener() {}},
    addEventListener() {}, matchesMultiKeyword:() => true,
    getListingTypeLabelV1:item => item.type, getItemSourceType:() => "naver",
    getItemFloorNumber:() => 1, readOptionalNumberInput:() => null,
    compareNaturalAddress:(a,b) => a.address.localeCompare(b.address),
    isFavorite:() => false, formatListRegistrationDate:value => value, Date:CountedDate, console,
    fetch() { throw new Error("Date display and sorting must not request a network resource"); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(unifiedSource.replace("global.JSUnifiedListingsV8 = {", `
    global.__absenceTest = {absenceConfirmationTime:absenceConfirmationTime, state:state,
      detailOriginals:detailOriginals,
      absenceConfirmationDate:absenceConfirmationDate, detailDateMetadata:detailDateMetadata};
    global.JSUnifiedListingsV8 = {`), context);
  vm.runInContext(script.slice(doneStart,doneEnd) + script.slice(filterStart,filterEnd), context);
  return {context, api:context.JSUnifiedListingsV8, helpers:context.__absenceTest, elements,
    parseCalls:() => parseCalls};
}

test("only an eligible census candidate displays its own absence date, converted to KST", () => {
  const {helpers} = harness();
  const original = candidate("today", "2026-10-14T15:01:00.000Z");
  assert.equal(helpers.absenceConfirmationDate(original), "26.10.15");
  assert.equal(helpers.absenceConfirmationDate(candidate("offset", "2026-10-15T00:01:00+09:00")), "26.10.15");
  const html = helpers.detailDateMetadata({regDate:"26.10.09"}, original);
  assert.match(html, /등록일<\/span><b>26\.10\.09/);
  assert.match(html, /미노출 확인일<\/span><b>26\.10\.15/);
  assert.match(html, /unified-detail-date-v1/);
  assert.doesNotMatch(html, /광고종료일/);
  const legacy = candidate("legacy", "2026-10-15T10:00:00Z", {availabilityKind:"legacy_candidate"});
  assert.match(helpers.detailDateMetadata({regDate:"26.10.09"}, legacy), /미노출 확인일<\/span><b>미확인/);
  assert.match(helpers.detailDateMetadata({}, legacy), /미노출 확인일/,
    "A missing registration date must not suppress the candidate's date row");
  const active = {...original, active:1};
  assert.doesNotMatch(helpers.detailDateMetadata({regDate:"26.10.09"}, active), /미노출 확인일/);
  assert.equal(helpers.detailDateMetadata({}, active), "");
});

test("missing or invalid evidence never borrows end, update, manual-completion or sibling dates", () => {
  const {helpers} = harness();
  for (const absenceConfirmedAt of ["", null, "invalid", "2026-10-15", "2026-10-15T10:00:00", "<script>alert(1)</script>"]) {
    const original = candidate("unknown", absenceConfirmedAt, {
      endedAt:"2026-10-15T10:00:00Z", updatedAt:"2026-10-15T10:00:00Z", completionDate:"2026-10-15"
    });
    assert.equal(helpers.absenceConfirmationTime(original), 0);
    assert.match(helpers.detailDateMetadata({regDate:"26.10.09"}, original), /미노출 확인일<\/span><b>미확인/);
  }
  for (const override of [{active:1}, {candidateEligible:false}, {availabilityKind:"legacy_unverified"}]) {
    const original = candidate("not-eligible", "2026-10-15T10:00:00Z", override);
    assert.equal(helpers.absenceConfirmationTime(original), 0);
    assert.doesNotMatch(helpers.detailDateMetadata({}, original), /미노출 확인일/);
  }
  assert.equal(helpers.absenceConfirmationDate(candidate("selected", "")), "",
    "The selected original never acquires a sibling candidate's confirmation day");
});

test("completed latest sorts by matching candidates only, unknown and manual records below dated candidates", () => {
  const items = [master("legacy","2026-12-01"), master("manual","2026-11-01",{state:"계약완료"}),
    master("older","2026-10-14"), master("newer","2026-01-01")];
  const groups = {
    legacy:[candidate("legacy-ad", "", {availabilityKind:"legacy_candidate"})],
    manual:[candidate("manual-ad", "2026-10-15T10:00:00Z")],
    older:[candidate("older-ad", "2026-10-14T14:00:00Z")],
    newer:[candidate("newer-ad", "2026-10-15T01:00:00Z")]
  };
  const saved = JSON.stringify(items);
  const {context,api} = harness(items);
  api.attach(items,{ok:true,groups});
  const originalSaved = JSON.stringify(groups);
  const rows = context.getFilteredItems();
  assert.deepEqual(Array.from(rows,row => row.propertyId), ["newer","older","legacy","manual"]);
  assert.equal(rows.find(row=>row.propertyId==="manual").unifiedAbsenceConfirmedTimeV1, 0,
    "A manual completion is not the source advertisement's end time");
  // Attach legitimately adds display metadata; none of the canonical values change.
  assert.deepEqual(items.map(({propertyId,key,memo,state,regDate,deposit,rent,room}) => ({propertyId,key,memo,state,regDate,deposit,rent,room})),
    JSON.parse(saved).map(({propertyId,key,memo,state,regDate,deposit,rent,room}) => ({propertyId,key,memo,state,regDate,deposit,rent,room})));
  assert.equal(JSON.stringify(groups), originalSaved);
});

test("source and rent filters constrain which candidate timestamp contributes to completed order", () => {
  const items = [master("mixed","2026-10-14"), master("other","2026-10-01")];
  const {context,api,elements} = harness(items);
  api.attach(items,{ok:true,groups:{
    mixed:[candidate("live-sibling","2026-12-01T01:00:00Z",{active:1}),
      candidate("naver-cheap","2026-10-14T01:00:00Z"),
      candidate("naver-expensive","2026-10-15T01:00:00Z",{rent:150}),
      candidate("daangn-new","2026-10-16T01:00:00Z",{source:"당근"})],
    other:[candidate("other-ad","2026-10-14T05:00:00Z")]
  }});
  assert.deepEqual(Array.from(context.getFilteredItems(),row=>row.propertyId),["mixed","other"]);
  elements.sourceFilter.value="naver"; elements.maxRent.value="80";
  const filtered = context.getFilteredItems();
  assert.deepEqual(Array.from(filtered,row=>row.propertyId),["other","mixed"]);
  assert.deepEqual(Array.from(filtered[1].unifiedDisplayOriginalsV2,row=>row.originalId),["naver-cheap"]);
  assert.equal(filtered[1].unifiedAbsenceConfirmedTimeV1, Date.parse("2026-10-14T01:00:00Z"));
});

test("normal latest stays registration-based and an explicit price sort is respected in completed view", () => {
  const items = [master("old","2026-01-01"),master("new","2026-10-15")];
  const {context,api,elements} = harness(items);
  api.attach(items,{ok:true,groups:{
    old:[candidate("old-candidate","2026-10-15T01:00:00Z",{rent:100}),
      candidate("old-active","",{active:1,candidateEligible:false,availabilityKind:"active"})],
    new:[candidate("new-candidate","2026-10-14T01:00:00Z",{rent:40}),
      candidate("new-active","",{active:1,candidateEligible:false,availabilityKind:"active"})]
  }});
  elements.sortFilter.value="rentLow";
  assert.deepEqual(Array.from(context.getFilteredItems(),row=>row.propertyId),["new","old"]);
  context.doneOnly=false; context.hideDone=true; elements.sortFilter.value="latest";
  assert.deepEqual(Array.from(context.getFilteredItems(),row=>row.propertyId),["new","old"]);
  assert.ok(context.getFilteredItems().every(row=>row.unifiedAbsenceConfirmedTimeV1===0));
});

test("absence timestamps are parsed once per matching advertisement, not in sort comparisons", () => {
  const items = Array.from({length:100},(_,index)=>master("linear-"+index,"2026-10-14"));
  const groups = Object.fromEntries(items.map((item,index)=>[item.propertyId,[candidate("ad-"+index,
    "2026-10-15T01:" + String(index%60).padStart(2,"0") + ":00Z")]]));
  const {context,api,parseCalls} = harness(items);
  api.attach(items,{ok:true,groups});
  const before = parseCalls();
  assert.equal(context.getFilteredItems().length,100);
  assert.equal(parseCalls()-before,100);
});

test("the newest matching candidate owns card conditions, photo, cached detail default and local summary", () => {
  const items = [master("multiple", "2026-10-14")];
  const oldest = candidate("oldest", "2026-10-13T01:00:00Z", {source:"당근", rent:30, thumbnail:"old-photo"});
  const newest = candidate("newest", "2026-10-14T15:01:00Z", {rent:50, thumbnail:"new-photo"});
  const tied = candidate("tied", "2026-10-14T15:01:00Z", {rent:70, thumbnail:"tie-photo"});
  const unknown = candidate("unknown", "", {availabilityKind:"legacy_candidate", rent:90});
  const groups = {multiple:[oldest,newest,tied,unknown]};
  const {context,api,helpers,elements} = harness(items);
  api.attach(items,{ok:true,groups});
  const canonicalIds = Array.from(api.allOriginals("multiple"),original=>original.originalId);
  const savedOriginals = JSON.stringify(groups);
  const filtered = context.getFilteredItems();
  const projected = filtered[0];
  context.currentItems = filtered;
  assert.equal(projected.unifiedFilterOriginalV2.originalId, "newest");
  assert.equal(projected.rent,50); assert.equal(projected.thumbnailV8,"new-photo");
  assert.deepEqual(Array.from(projected.unifiedDisplayOriginalsV2,original=>original.originalId), ["newest","oldest","tied","unknown"]);
  assert.match(api.cardParts(projected).thumbnail,/new-photo/);
  const detail = helpers.detailOriginals([unknown,tied,oldest,newest], "multiple");
  assert.equal(detail[0].originalId,"newest", "A cached detail cannot reset the selected candidate to the older photo priority");
  assert.match(helpers.detailDateMetadata({regDate:"26.10.14"},detail[0]),/미노출 확인일<\/span><b>26\.10\.15/);
  const summary = api.candidateSummary({includeRows:true}).candidates[0];
  assert.equal(summary.rent,50); assert.equal(summary.thumbnail,"new-photo");
  assert.equal(summary.candidateOriginals[0].originalId,"newest");
  elements.maxRent.value="40";
  const onlyOld = context.getFilteredItems()[0];
  assert.equal(onlyOld.unifiedFilterOriginalV2.originalId,"oldest");
  assert.equal(onlyOld.rent,30); assert.equal(onlyOld.thumbnailV8,"old-photo");
  assert.deepEqual(Array.from(api.allOriginals("multiple"),original=>original.originalId),canonicalIds);
  assert.equal(JSON.stringify(groups),savedOriginals);
  assert.equal(items[0].key,"saved-key-multiple"); assert.equal(items[0].memo,"사용자 메모");
});

test("sort menu labels follow completed mode without changing the chosen sort option", () => {
  const {context,elements} = harness();
  const label={textContent:""}, optionLabel={textContent:""};
  const option={getAttribute:()=>"latest",classList:{toggle(){}},setAttribute(){},querySelector:()=>optionLabel};
  elements.sortDropdownBtn={querySelector:()=>label};
  elements.sortDropdownMenu={querySelectorAll:()=>[option]};
  context.SORT_LABELS={rentLow:"월세↑"};
  vm.runInContext(script.slice(sortStart,sortEnd),context);
  context.updateSortDropdownUI();
  assert.equal(label.textContent,"미노출 최신순"); assert.equal(optionLabel.textContent,"미노출 최신순");
  elements.sortFilter.value="rentLow";
  context.updateSortDropdownUI();
  assert.equal(label.textContent,"월세↑"); assert.equal(elements.sortFilter.value,"rentLow");
  context.doneOnly=false; elements.sortFilter.value="latest";
  context.updateSortDropdownUI();
  assert.equal(label.textContent,"정렬"); assert.equal(optionLabel.textContent,"최근등록순");
});
