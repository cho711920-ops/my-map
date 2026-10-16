import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/operations-center-v7.js", import.meta.url), "utf8");
const instrumented = source.replace(/\}\)\(\);\s*$/, "window.__candidateQaV1={state,renderDashboard,transactionCandidateCard};})();");
const original = (id, fields = {}) => ({originalId:id,providerSourceId:"provider-"+id,source:"네이버",
  tradeType:"lease",deposit:2000,rent:90,fee:0,premium:0,area:25,room:"1층",floor:1,
  link:"https://example.test/candidate/"+encodeURIComponent(id),availabilityKind:"census_missing",candidateEligible:true,...fields});
const row = (id, fields = {}) => ({propertyId:id,title:"검수 통합매물 " + id,address:"서구 괴정동 100",
  room:"1층",floor:1,tradeType:"lease",deposit:2000,rent:90,fee:0,premium:0,area:25,
  mainSource:"네이버",sources:["네이버","당근"],sourceCount:10,activeSourceCount:9,
  sourceUrl:"https://example.test/original/" + encodeURIComponent(id),memo:"사용자 메모 보존",
  candidateOriginalCount:1,candidateOriginals:[original(id+"-AD")],candidateKind:"source-candidate-group",...fields});

function fixture({count = 3, ready = true, server, cache} = {}) {
  const nodes = new Map(), listeners = new Map(), frames = [], reads = [], opens = [], summaryCalls = [];
  class Element {
    constructor(id = "") { this.id=id;this.children=[];this._html="";this.attributes={};this.classes=new Set(); }
    get innerHTML() { return this._html; }
    set innerHTML(value) { this._html=value;for (const child of this.children) child.remove();this.children=[]; }
    get classList() { return {add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),
      contains:name=>this.classes.has(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)}; }
    appendChild(child) { this.children.push(child);child.parent=this;if(child.id) nodes.set(child.id,child); }
    remove() { if(this.id)nodes.delete(this.id);if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this); }
    setAttribute(name,value) { this.attributes[name]=value; }
    scrollIntoView() {}
  }
  for (const id of ["operationsDashboardPanel","operationsCenter","operationsCenterMessage"]) nodes.set(id,new Element(id));
  const document = {getElementById:id=>nodes.get(id)||null,createElement:()=>new Element(),
    addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},body:new Element()};
  let current = {ready,candidateCount:count,candidateAdCount:count,manualCompletedCount:52,doneCount:count+52,
    scopeLabel:"현재 지도·검색조건",candidates:Array.from({length:count},(_,index)=>row("C"+String(index).padStart(4,"0")))};
  const storage = {getItem:key=>key==="js_operations_dashboard_cache_v2"&&cache?JSON.stringify(cache):null,setItem(){}};
  const window = {document,location:{href:"https://example.test/"},addEventListener:(name,listener)=>listeners.set(name,listener),
    setTimeout(){return 0;},setInterval(){return 0;},clearTimeout(){},requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    open:(url,target,options)=>{opens.push({url,target,options});return {opener:"initial"};},
    JSUnifiedListingsV8:{candidateSummary(options){summaryCalls.push(options);return current&&{...current,...(!options.includeRows?{candidates:undefined}:{})};}},
    JSDataAccessV6:{read(action){reads.push(action);return Promise.resolve(typeof server==="function"?server(action):server||{
      ok:true,advertisementPolicyVersion:3,count:2,candidateAdCount:2,candidates:[row("S1"),row("S2")]});},
      mutate(){throw new Error("Candidate UI must not write");}}};
  vm.runInNewContext(instrumented,{window,document,console,URL,Date,Promise,Set,Map,sessionStorage:storage,localStorage:storage,
    requestAnimationFrame:window.requestAnimationFrame,setTimeout:window.setTimeout,clearTimeout:window.clearTimeout});
  const qa=window.__candidateQaV1;
  const bootDashboard=qa.state.dashboard;
  qa.state.dashboard ||= {advertisementPolicyVersion:3,transactionCheckCandidates:53221,activeMaster:9641};
  return {window,qa,nodes,reads,opens,summaryCalls,bootDashboard,
    section:()=>nodes.get("operationsTransactionCandidatesV1")?.innerHTML||"",
    dashboard:()=>nodes.get("operationsDashboardPanel").innerHTML,
    summary:()=>current,setSummary:value=>{current=value;},
    event:()=>listeners.get("js-listing-availability-changed")(),
    flush:()=>{for(const callback of frames.splice(0))callback();},frames};
}

test("the dashboard and candidate list use the same current-scope integrated masters without another API request", async () => {
  const f=fixture({count:3030});
  f.qa.renderDashboard();
  assert.match(f.dashboard(),/거래확인 후보<\/span><strong>3,030<\/strong>/);
  assert.match(f.dashboard(),/현재 지도·검색조건 · 직접 계약완료 52건 별도 · 후보 광고 3,030개 · 완료만 보기 합계 3,082건/);
  assert.doesNotMatch(f.dashboard(),/53,221|3회 연속/);
  await f.window.openTransactionCandidates();
  assert.deepEqual(f.reads,[]);
  assert.match(f.section(),/현재 지도·검색조건 · 총 3,030개 통합매물/);
  assert.match(f.section(),/후보 광고가 있는 통합매물을 1건씩/);
  assert.match(f.section(),/같은 물건의 다른 정상 광고는 유지/);
  assert.match(f.section(),/직접 계약완료는 별도 집계/);
  assert.equal((f.section().match(/<article /g)||[]).length,50);
  assert.match(f.section(),/1–50 \/ 3,030개/);
  f.window.pageTransactionCandidatesV1(1);
  assert.equal((f.section().match(/<article /g)||[]).length,50);
  assert.match(f.section(),/data-property-id="C0050"/);
  assert.doesNotMatch(f.section(),/data-property-id="C0000"/);
  f.qa.state.transactionCandidatePageV1=60;f.window.pageTransactionCandidatesV1(1);
  assert.equal((f.section().match(/<article /g)||[]).length,30);
  assert.match(f.section(),/3,001–3,030 \/ 3,030개/);
});

test("a confirmed local zero never falls back to the server's unrelated whole-map total", async () => {
  const f=fixture({count:0});f.qa.renderDashboard();await f.window.openTransactionCandidates();
  assert.match(f.dashboard(),/거래확인 후보<\/span><strong>0<\/strong>/);
  assert.match(f.section(),/총 0개 통합매물/);
  assert.match(f.section(),/현재 범위의 거래확인 후보가 없습니다/);
  assert.deepEqual(f.reads,[]);
});

test("mixed groups retain nine active ads while each candidate shows its own conditions, evidence and exact URL", async () => {
  const f=fixture();f.qa.state.transactionExpandedId="P<1";
  const candidates=[original("OLD",{source:"네이버",availabilityKind:"legacy_candidate",rent:90,floor:1,area:25}),
    original("NEW",{source:"당근",rent:150,floor:2,room:"2층",area:40}),
    original("ARCHIVED",{availabilityKind:"legacy_unverified",candidateEligible:false}),
    original("LIVE",{availabilityKind:"active",candidateEligible:false})];
  const group=row("P<1",{candidateOriginalCount:2,candidateOriginals:candidates,sourceCount:11});
  const html=f.qa.transactionCandidateCard(group);
  assert.match(html,/data-property-id="P&lt;1"/);
  assert.match(html,/통합매물 P&lt;1/);assert.match(html,/연결 원본 11개 · 후보 광고 2개 · 활성 광고 9개/);
  assert.match(html,/광고번호 provider-OLD/);assert.match(html,/광고번호 provider-NEW/);
  assert.match(html,/보 2,000 \/ 월 90/);assert.match(html,/보 2,000 \/ 월 150/);assert.match(html,/>평 40<\/span>/);
  assert.match(html,/기존 화면 유지 기록 · 실제 종료 미검증/);assert.match(html,/동일 범위 전체수집에서 광고 미노출 확인/);
  assert.match(html,/같은 물건의 다른 광고는 정상일 수 있으며/);assert.match(html,/사용자 메모 보존/);
  assert.doesNotMatch(html,/provider-ARCHIVED|provider-LIVE|연결 원본이 모두 비활성|활성 광고 0개/);
  f.qa.state.transactionCandidates=[group];
  f.window.openTransactionCandidateOriginalSourceV1(encodeURIComponent("P<1"),"NEW");
  f.window.openTransactionCandidateOriginalSourceV1(encodeURIComponent("P<1"),"ARCHIVED");
  assert.deepEqual(f.opens,[{url:"https://example.test/candidate/NEW",target:"_blank",options:"noopener,noreferrer"}]);
});

test("opening a candidate from the map selects its propertyId and the correct bounded page", async () => {
  const f=fixture({count:160});
  f.window.openOperationsCenter=()=>Promise.resolve();
  await f.window.openTransactionCandidateFromListingV1("C0133");f.flush();
  assert.equal(f.qa.state.transactionExpandedId,"C0133");assert.equal(f.qa.state.transactionCandidatePageV1,2);
  assert.match(f.section(),/data-property-id="C0133" class="expanded"/);
  assert.equal((f.section().match(/<article /g)||[]).length,50);assert.deepEqual(f.reads,[]);
  f.window.openTransactionCandidateSourceV1("C0133");
  assert.deepEqual(f.opens,[{url:"https://example.test/candidate/C0133-AD",target:"_blank",options:"noopener,noreferrer"}]);
});

test("availability changes skip a closed panel and debounce a visible dashboard to one local calculation per frame", async () => {
  const f=fixture({count:70});await f.window.openTransactionCandidates();
  const before=f.summaryCalls.length;f.event();f.flush();assert.equal(f.summaryCalls.length,before);
  f.nodes.get("operationsCenter").classList.add("open");
  for(let i=0;i<30;i++)f.event();
  assert.equal(f.frames.length,1);assert.equal(f.summaryCalls.length,before);
  f.flush();assert.equal(f.summaryCalls.length,before+1);
  assert.equal((f.section().match(/<article /g)||[]).length,50);
  const next={...f.summary(),candidateCount:1,candidateAdCount:1,doneCount:53,candidates:[row("ONLY-NEW")]};f.setSummary(next);
  f.event();f.flush();
  assert.match(f.dashboard(),/거래확인 후보<\/span><strong>1<\/strong>/);
  assert.match(f.dashboard(),/후보 광고 1개/);
  assert.match(f.section(),/data-property-id="ONLY-NEW"/);assert.doesNotMatch(f.section(),/C0000/);
  f.event();f.nodes.get("operationsCenter").classList.remove("open");
  const count=f.summaryCalls.length;f.flush();assert.equal(f.summaryCalls.length,count);
  assert.deepEqual(f.reads,[]);
});

test("an unready local index uses a clearly labelled server-wide integrated candidate list", async () => {
  const f=fixture({ready:false});f.qa.renderDashboard();
  assert.match(f.dashboard(),/전체 공개 통합매물 기준/);
  await f.window.openTransactionCandidates();
  assert.deepEqual(f.reads,["transactionCandidates"]);
  assert.match(f.section(),/전체 공개 매물 · 서버 기준 · 총 2개 통합매물/);
  assert.equal((f.section().match(/<article /g)||[]).length,2);
  assert.match(f.section(),/지도 ‘계약완료만 보기’는 현재/);
});

test("server-scope dashboard fallback also separates candidate advertisements from integrated listing counts", () => {
  const f=fixture({ready:false});
  f.qa.state.dashboard={advertisementPolicyVersion:3,transactionCheckCandidates:2,candidateAdCount:17,manualCompleted:3,completedOnlyTotal:5};
  f.qa.renderDashboard();
  assert.match(f.dashboard(),/거래확인 후보<\/span><strong>2<\/strong>/);
  assert.match(f.dashboard(),/전체 공개 통합매물 · 서버 기준 · 직접 계약완료 3건 별도 · 후보 광고 17개 · 완료만 보기 합계 5건/);
});

test("a late global server response cannot overwrite a newly ready current-map summary", async () => {
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({ready:false,server:()=>pending});
  f.nodes.get("operationsCenter").classList.add("open");
  const loading=f.window.openTransactionCandidates();
  f.setSummary({...f.summary(),ready:true,candidateCount:1,doneCount:53,candidates:[row("LOCAL")]});
  f.event();f.flush();
  release({ok:true,advertisementPolicyVersion:3,count:53221,candidateAdCount:53221,candidates:[row("STALE-SERVER")]});await loading;
  assert.match(f.section(),/data-property-id="LOCAL"/);assert.doesNotMatch(f.section(),/STALE-SERVER|53,221/);
  assert.match(f.section(),/현재 지도·검색조건 · 총 1개 통합매물/);
});

test("only policy3 cached ad-state summaries are accepted, never old raw-ad or all-inactive-master policies", () => {
  const cache={at:Date.now(),dashboard:{advertisementPolicyVersion:1,transactionCheckCandidates:53221}};
  const f=fixture({ready:false,cache});
  assert.equal(f.bootDashboard,null);
  assert.equal(f.qa.state.dashboardLoaded,false);
  const allInactive=fixture({ready:false,cache:{...cache,dashboard:{advertisementPolicyVersion:2,transactionCheckCandidates:7}}});
  assert.equal(allInactive.bootDashboard,null);assert.equal(allInactive.qa.state.dashboardLoaded,false);
  const current=fixture({ready:false,cache:{...cache,dashboard:{advertisementPolicyVersion:3,transactionCheckCandidates:7}}});
  assert.equal(current.qa.state.dashboard.transactionCheckCandidates,7);assert.equal(current.qa.state.dashboardLoaded,true);
  const future=fixture({ready:false,cache:{...cache,dashboard:{advertisementPolicyVersion:4,transactionCheckCandidates:99}}});
  assert.equal(future.bootDashboard,null);assert.equal(future.qa.state.dashboardLoaded,false);
});

test("candidate-ad counts stay distinct from master counts and nested original DOM is bounded to fifty", async () => {
  const f=fixture({count:1});
  const candidates=Array.from({length:120},(_,i)=>original("AD-"+i,{rent:90+i}));
  const group=row("C0000",{candidateOriginalCount:220,candidateOriginals:candidates,candidateOriginalsHasMore:true});
  f.setSummary({...f.summary(),candidateAdCount:220,candidates:[group]});
  await f.window.openTransactionCandidates();f.window.openTransactionCandidatePropertyV1("C0000");
  assert.match(f.section(),/총 1개 통합매물 · 후보 광고 220개/);
  assert.match(f.section(),/전체 후보 광고 220개 중 120개의 원본 정보/);
  assert.equal((f.section().match(/data-original-id=/g)||[]).length,50);
  assert.match(f.section(),/data-original-id="AD-0"/);assert.doesNotMatch(f.section(),/data-original-id="AD-50"/);
  f.window.pageTransactionCandidateOriginalsV1(1);
  assert.equal((f.section().match(/data-original-id=/g)||[]).length,50);
  assert.match(f.section(),/data-original-id="AD-50"/);assert.doesNotMatch(f.section(),/data-original-id="AD-0"/);
  f.window.pageTransactionCandidateOriginalsV1(1);
  assert.equal((f.section().match(/data-original-id=/g)||[]).length,20);
});

test("missing original terms stay unknown instead of copying another ad's master price", () => {
  const f=fixture();f.qa.state.transactionExpandedId="M";
  const html=f.qa.transactionCandidateCard(row("M",{rent:999,candidateOriginals:[original("UNKNOWN",{rent:null,deposit:null,area:null})]}));
  assert.match(html,/보 미확인 \/ 월 미확인/);assert.match(html,/>평 미확인<\/span>/);
});

test("an old-policy fallback response is a confirmation error, not a fake zero or a revived old candidate count", async () => {
  const f=fixture({ready:false,server:{ok:true,advertisementPolicyVersion:2,count:53221,candidates:[row("OLD")]}});
  await f.window.openTransactionCandidates();
  assert.match(f.section(),/후보 확인 실패/);assert.match(f.section(),/광고별 후보 자료를 최신 기준으로 확인하지 못했습니다/);
  assert.doesNotMatch(f.section(),/총 0개|53,221|data-property-id="OLD"/);
});

test("summary conditions and photo come from the first eligible candidate, preserving master identity and memo", () => {
  const f=fixture();f.qa.state.transactionExpandedId="M";
  const first=original("FIRST",{rent:150,deposit:3000,fee:5,premium:7,area:40,
    thumbnail:"https://images.example.test/first-candidate.jpg"});
  const group=row("M",{title:"사용자 통합매물 제목",address:"사용자 주소",memo:"보존할 수동 메모",
    rent:999,deposit:9999,fee:999,premium:999,area:999,thumbnail:"https://images.example.test/active-master.jpg",
    candidateOriginals:[original("ARCHIVED",{availabilityKind:"legacy_unverified",candidateEligible:false}),first,
      original("SECOND",{rent:160})],candidateOriginalCount:2});
  const before=JSON.stringify(group),html=f.qa.transactionCandidateCard(group);
  assert.match(html,/보 3,000 \/ 월 150/);assert.match(html,/>관리비 5<\/span>/);assert.match(html,/>권리금 7<\/span>/);
  assert.match(html,/first-candidate\.jpg/);assert.doesNotMatch(html,/active-master\.jpg|월 999|평 999|9,999/);
  assert.match(html,/사용자 통합매물 제목/);assert.match(html,/사용자 주소/);assert.match(html,/보존할 수동 메모/);
  assert.equal(JSON.stringify(group),before);
});

test("summary unknown values never inherit a projected zero, master financials, or another canonical alias", () => {
  const f=fixture();f.qa.state.transactionExpandedId="M";
  const group=row("M",{rent:0,deposit:0,area:0,displayValuePresence:{rent:false,deposit:false,area:false},
    thumbnail:"https://images.example.test/unrelated-master.jpg",candidateOriginals:[original("UNKNOWN",{
      deposit:null,rent:null,monthlyRent:777,fee:null,premium:null,area:null,thumbnail:""})]});
  const html=f.qa.transactionCandidateCard(group);
  assert.match(html,/보 미확인 \/ 월 미확인/);assert.match(html,/>평 미확인<\/span>/);
  assert.doesNotMatch(html,/월 0|월 777|보 0|unrelated-master\.jpg/);
});

test("explicit candidate zeros remain valid and sale price unknown never copies the master's sale price", () => {
  const f=fixture();f.qa.state.transactionExpandedId="M";
  const zero=f.qa.transactionCandidateCard(row("M",{candidateOriginals:[original("ZERO",{
    deposit:0,rent:0,fee:0,premium:0,area:0})]}));
  assert.match(zero,/보 0 \/ 월 0/);assert.match(zero,/>관리비 0<\/span>/);assert.match(zero,/>평 0<\/span>/);
  const missingSale=f.qa.transactionCandidateCard(row("M",{tradeType:"sale",salePrice:50000,
    candidateOriginals:[original("SALE",{tradeType:"sale",salePrice:null})]}));
  assert.match(missingSale,/매매 미확인/);assert.doesNotMatch(missingSale,/50,000만원|미확인만원/);
});
