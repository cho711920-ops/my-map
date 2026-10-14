const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const {performance} = require("node:perf_hooks");

const unifiedSource = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const doneStart = script.indexOf("function isDone(item)");
const doneEnd = script.indexOf("function isFavorite", doneStart);
const filterStart = script.indexOf("function readOptionalFilterNumberV1");
const filterEnd = script.indexOf("function listingRegistrationTime", filterStart);
assert.ok(doneStart >= 0 && doneEnd > doneStart && filterStart >= 0 && filterEnd > filterStart);

function harness(items) {
  const elements = Object.fromEntries([
    "keyword", "typeFilter", "sourceFilter", "floorQuickFilter", "brokerageFeeFilter", "sortFilter",
    "industryFilter", "minDeposit", "maxDeposit", "minRent", "maxRent", "minPremium", "maxPremium", "minArea", "maxArea"
  ].map(id => [id, {value:""}]));
  const context = {
    allItems:items, innerWidth:1280, favoriteOnly:false, hideDone:true, doneOnly:false,
    gongsilOnly:false, todayNewOnly:false, newListingDays:0, jsInitialFullListingsLoadingV1:false,
    map:{getBounds:() => ({contain:() => true})},
    document:{getElementById:id => elements[id] || null, addEventListener() {}},
    addEventListener() {}, matchesMultiKeyword:() => true,
    getListingTypeLabelV1:item => item.type, getItemSourceType:() => "naver",
    getItemFloorNumber:() => 1, readOptionalNumberInput:() => null,
    isFavorite:() => false, console,
    fetch() {throw new Error("Availability filtering must never make network requests");}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(unifiedSource, context, {filename:"unified-listings-v8.js"});
  vm.runInContext(script.slice(doneStart, doneEnd) + script.slice(filterStart, filterEnd), context, {filename:"actual-listing-filter.js"});
  return {context, api:context.JSUnifiedListingsV8, elements};
}

test("10,000 masters / 53,000 originals stay linear through hide, done-only and all modes", () => {
  const items = [], groups = {};
  let originalCount = 0, filterCalls = 0, scanCalls = 0, masterVisits = 0;
  for (let index = 0; index < 10_000; index += 1) {
    const id = "PERF-" + index;
    const kind = index % 8;
    const manual = kind === 3 || kind === 7;
    const master = {propertyId:id, key:"legacy-key-"+id, name:"성능 검수 "+id,
      address:"검사 전용 주소", room:"원본 키 보존", type:"상가", source:"네이버",
      state:manual?"계약완료":"active", memo:"보존 메모 "+id,
      deposit:2000, rent:90, premium:0, area:25, floor:1, tradeType:"lease", latlng:{}};
    items.push(master);
    groups[id] = Array.from({length:index<3000?6:5}, (_, adIndex) => {
      originalCount += 1;
      const live = kind === 2 || kind === 3 || kind === 1 && adIndex !== 0 || (kind === 4 || kind === 5) && adIndex === 0;
      const eligible = (kind === 0 || kind === 1 || kind === 6 || kind === 7) && adIndex === 0;
      const availabilityKind = live ? "active" : eligible ? (kind === 0 || kind === 1 ? "census_missing" : "legacy_candidate") : "legacy_unverified";
      return {propertyId:id, originalId:id+"-AD-"+adIndex, sourceId:id+"-SOURCE-"+adIndex,
        source:["네이버","당근","공실박스"][adIndex%3], active:live?1:0,
        missingCount:live?0:3, sourceUnavailable:!live,
        candidateEligible:eligible, availabilityKind,
        buildingName:master.name, address:master.address, type:master.type,
        deposit:2000,rent:90,premium:0,area:25,tradeType:"lease",
        floor:1, room:"1층", thumbnail:"", photoCount:0};
    });
  }
  assert.equal(originalCount, 53_000);
  const preserved = items.map(({propertyId,key,memo,state}) => ({propertyId,key,memo,state}));
  // Catch the actual freeze mechanism independently of wall time. The old
  // resolveMasterItem() called allItems.filter() once per master in done-only.
  Object.defineProperty(items, "filter", {value:function(predicate, thisArg) {
    filterCalls += 1;
    scanCalls += 1;
    return Array.prototype.filter.call(this, (value,index,array) => {
      masterVisits += 1;
      assert.ok(masterVisits <= 300_000, "A nested full-master scan reintroduced quadratic filtering");
      return predicate.call(thisArg,value,index,array);
    });
  }});
  Object.defineProperty(items, "forEach", {value:function(callback, thisArg) {
    scanCalls += 1;
    return Array.prototype.forEach.call(this, (value,index,array) => {
      masterVisits += 1;
      assert.ok(masterVisits <= 300_000, "A nested full-master traversal reintroduced quadratic filtering");
      return callback.call(thisArg,value,index,array);
    });
  }});
  const {context,api} = harness(items);
  const start = performance.now();
  const filterTimes = [];
  api.attach(items,{ok:true,groups,snapshotRevision:"PERF-AVAILABILITY-1"});
  for (const [mode, hideDone, doneOnly, expected] of [
    ["hide",true,false,5000], ["done-only",false,true,6250], ["all",false,false,10000]
  ]) {
    context.hideDone=hideDone;context.doneOnly=doneOnly;
    api.refreshOriginalVisibility(items);
    const filterStartAt=performance.now();
    const filtered=context.getFilteredItems();
    filterTimes.push(mode+":"+Math.round(performance.now()-filterStartAt)+"ms");
    assert.equal(filtered.length,expected,mode+" map/list master count");
    const summary=api.candidateSummary({includeRows:true});
    assert.equal(summary.ready,true);
    assert.equal(summary.candidateCount,3750,mode+" candidate masters, including mixed live/candidate masters");
    assert.equal(summary.candidateAdCount,3750,"Unverified legacy inactive ads cannot inflate candidate ad totals");
    assert.equal(summary.manualCompletedCount,2500);
    assert.equal(summary.doneCount,6250,"Manual/candidate overlap must not double count");
    assert.equal(new Set(Array.from(summary.candidates,row=>row.propertyId)).size,3750);
    for (const item of items) {
      const visible=api.visibleOriginals(item.propertyId);
      assert.ok(Array.isArray(visible));
      assert.equal(api.allOriginals(item.propertyId).length,groups[item.propertyId].length);
    }
  }
  const duration=performance.now()-start;
  assert.ok(filterCalls <= 18,"Separate candidate/manual projections may scan a few times, never once per master");
  assert.ok(scanCalls <= 30,"Indexes, projections and refreshes may use a bounded number of linear passes");
  assert.ok(duration < 30_000,"Loose 30s regression budget; nested scans have a stricter visit budget");
  assert.deepEqual(items.map(({propertyId,key,memo,state}) => ({propertyId,key,memo,state})),preserved);
  console.log("availability scale: "+items.length+" masters / "+originalCount+" originals / "+scanCalls+
    " linear master passes ("+filterCalls+" filter lookups) / "+Math.round(duration)+"ms / heap "+
    Math.round(process.memoryUsage().heapUsed/1024/1024)+" MiB / filters "+filterTimes.join(", "));
});

test("active manual prices stay protected while candidate conditions never borrow unknown prices from the master", () => {
  const items=["protected","candidate-null","candidate-empty","candidate-undefined","candidate-zero"].map(propertyId=>({
    propertyId,key:"legacy-key-"+propertyId,memo:"사용자 메모 "+propertyId,
    state:"active",source:"네이버",deposit:2000,rent:90,premium:0,area:25,latlng:{}
  }));
  const before=items.map(({propertyId,key,memo,rent})=>({propertyId,key,memo,rent}));
  const active={originalId:"manual-protected-active",source:"네이버",active:1,candidateEligible:false,
    availabilityKind:"active",deposit:2000,rent:40,premium:0,area:25,manualDisplayFields:"monthly_rent"};
  const candidate={originalId:"unprotected-candidate",source:"네이버",active:0,candidateEligible:true,
    availabilityKind:"census_missing",deposit:500,rent:40,premium:0,area:20,manualDisplayFields:"monthly_rent"};
  const noRent={...candidate};delete noRent.rent;
  const {context,api,elements}=harness(items);
  api.attach(items,{ok:true,groups:{
    protected:[active,candidate],
    "candidate-null":[{...candidate,originalId:"null-rent",rent:null}],
    "candidate-empty":[{...candidate,originalId:"empty-rent",rent:""}],
    "candidate-undefined":[{...noRent,originalId:"undefined-rent"}],
    "candidate-zero":[{...candidate,originalId:"zero-rent",rent:0}]
  }});
  let projected=context.getFilteredItems().find(item=>item.propertyId==="protected");
  assert.ok(projected);
  assert.equal(projected.rent,90,"A genuine active manual rent override wins over provider rent 40");
  assert.equal(active.rent,40,"Display protection cannot overwrite the preserved original advertisement");
  context.hideDone=false;context.doneOnly=true;api.refreshOriginalVisibility(items);
  projected=context.getFilteredItems().find(item=>item.propertyId==="protected");
  assert.ok(projected);
  assert.equal(projected.rent,40,"Candidate history uses its own rent, not the active/manual representative rent");
  assert.equal(context.getFilteredItems().length,5,"Unknown conditions stay reviewable when no rent condition is set");
  elements.maxRent.value="100";
  assert.deepEqual(Array.from(context.getFilteredItems(),item=>item.propertyId),["protected","candidate-zero"],
    "Null, empty and missing candidate rents cannot satisfy a rent bound through master fallback or zero coercion");
  elements.maxRent.value="";elements.minRent.value="80";
  assert.equal(context.getFilteredItems().some(item=>item.propertyId==="protected"),false);
  context.hideDone=true;context.doneOnly=false;api.refreshOriginalVisibility(items);
  assert.equal(context.getFilteredItems().find(item=>item.propertyId==="protected").rent,90);
  assert.deepEqual(items.map(({propertyId,key,memo,rent})=>({propertyId,key,memo,rent})),before,
    "Condition projections cannot alter master prices, legacy favorite keys or user memos");
});

test("eligible source ads stay candidates beside live siblings; legacy unverified inactive ads fail closed", () => {
  const items = [
    {propertyId:"mixed",state:"active"}, {propertyId:"ended",state:"active"},
    {propertyId:"manual-live",state:"계약완료"}, {propertyId:"manual-ended",state:"계약완료"},
    {propertyId:"manual-no-original",state:"계약완료"}, {propertyId:"no-original",state:"active"},
    {propertyId:"unverified-legacy",state:"active"}, {propertyId:"missing-annotation",state:"active"},
    {propertyId:"live-with-stale-eligibility",state:"active"},
    {propertyId:"unverified-with-stale-eligibility",state:"active"},
    {propertyId:"eligible-without-kind",state:"active"}
  ].map(item=>({key:item.propertyId,deposit:2000,rent:90,premium:0,area:25,latlng:{},...item}));
  const {context,api,elements}=harness(items);
  const live = {source:"네이버",active:1,candidateEligible:false,availabilityKind:"active",deposit:2000,rent:90,premium:0,area:25};
  const candidate = {source:"당근",active:0,candidateEligible:true,availabilityKind:"census_missing",deposit:500,rent:40,premium:0,area:20};
  const legacy = {source:"공실박스",active:0,candidateEligible:false,availabilityKind:"legacy_unverified",missingCount:3,deposit:100,rent:10,premium:0,area:5};
  const groups={
    mixed:[{...live,originalId:"live-ad"},{...candidate,originalId:"candidate-ad"},{...legacy,originalId:"old-unverified-ad"}],
    ended:[{...candidate,originalId:"ended-daangn"},{...candidate,source:"공실박스",originalId:"ended-gongsil",availabilityKind:"legacy_candidate"}],
    "manual-live":[{...live,originalId:"manual-live-ad"}],
    "manual-ended":[{...candidate,source:"네이버",originalId:"manual-ended-ad"}],
    "unverified-legacy":[{...legacy,originalId:"unverified-only"}],
    "missing-annotation":[{source:"네이버",active:0,missingCount:3,originalId:"missing-evidence"}],
    "live-with-stale-eligibility":[{...candidate,active:1,sourceUnavailable:true,originalId:"reappeared-with-stale-marker"}],
    "unverified-with-stale-eligibility":[{...candidate,availabilityKind:"legacy_unverified",originalId:"unverified-with-stale-marker"}],
    "eligible-without-kind":[{...candidate,availabilityKind:undefined,originalId:"eligible-without-policy-kind"}]
  };
  api.attach(items,{ok:true,groups:{
    ...groups
  }});
  assert.equal(api.isTransactionCandidate(items[0]),true,"A live sibling must not erase a different eligible candidate advertisement");
  assert.equal(api.isTransactionCandidate(items[1]),true);
  assert.equal(api.isTransactionCandidate(items[3]),false,"Manual complete is not counted twice");
  assert.equal(api.isTransactionCandidate(items[5]),false,"No source records is not proof of ad disappearance");
  assert.equal(api.isTransactionCandidate(items[6]),false,"Legacy active=0/missing=3 is not verified disappearance");
  assert.equal(api.isTransactionCandidate(items[7]),false,"Missing policy metadata is not candidate eligibility");
  assert.equal(api.isTransactionCandidate(items[8]),false,"Current positive presence overrides a stale candidate marker");
  assert.equal(api.isTransactionCandidate(items[9]),false,"Unverified availability kind cannot become eligible through a stale boolean");
  assert.equal(api.isTransactionCandidate(items[10]),false,"Eligibility also requires a recognized policy evidence kind");
  context.hideDone=false;context.doneOnly=true;
  api.refreshOriginalVisibility(items);
  assert.deepEqual(Array.from(context.getFilteredItems(),item=>item.propertyId),
    ["mixed","ended","manual-live","manual-ended","manual-no-original"]);
  let summary=api.candidateSummary({includeRows:true});
  assert.deepEqual([summary.candidateCount,summary.candidateAdCount,summary.manualCompletedCount,summary.doneCount],[2,3,3,5]);
  assert.deepEqual([...new Set(Array.from(summary.candidates,row=>row.propertyId))],["mixed","ended"]);
  assert.deepEqual(Array.from(api.visibleOriginals("mixed"),row=>row.originalId),["candidate-ad"]);
  // Source and money filters must match each candidate advertisement's own
  // values, never the active sibling or a stale master representative value.
  elements.sourceFilter.value="danggeun";
  summary=api.candidateSummary({includeRows:true});
  assert.deepEqual([summary.candidateCount,summary.candidateAdCount,summary.manualCompletedCount,summary.doneCount],[2,2,0,2]);
  elements.maxRent.value="50";
  let projected=context.getFilteredItems().find(item=>item.propertyId==="mixed");
  assert.ok(projected,"Candidate rent 40 qualifies even when master and live ad rent is 90");
  assert.deepEqual([projected.deposit,projected.rent],[500,40]);
  assert.deepEqual([items[0].deposit,items[0].rent],[2000,90],"View projection must not overwrite persisted master conditions");
  context.doneOnly=false;context.hideDone=true;api.refreshOriginalVisibility(items);
  assert.equal(context.getFilteredItems().some(item=>item.propertyId==="mixed"),false,"Normal view cannot borrow the ended ad's cheap rent");
  elements.sourceFilter.value="";elements.maxRent.value="";elements.minRent={value:"80"};
  assert.equal(context.getFilteredItems().some(item=>item.propertyId==="mixed"),true);
  context.hideDone=false;context.doneOnly=true;api.refreshOriginalVisibility(items);
  assert.equal(context.getFilteredItems().some(item=>item.propertyId==="mixed"),false,"Candidate view cannot borrow live ad conditions");
  elements.minRent.value="";
  Object.assign(groups.mixed[1],{active:1,candidateEligible:false,availabilityKind:"active",missingCount:0});
  api.refreshOriginalVisibility(items);
  assert.equal(api.isTransactionCandidate(items[0]),false,"Reappearance removes only the matching original candidate");
  summary=api.candidateSummary();
  assert.deepEqual([summary.candidateCount,summary.candidateAdCount],[1,2]);
  assert.equal(api.allOriginals("mixed").length,3,"Reappearance and archive exclusion never delete original identities");
});
