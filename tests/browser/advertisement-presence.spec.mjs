import {test, expect} from "@playwright/test";
import {readFile, mkdir} from "node:fs/promises";
import ts from "typescript";

// Use production filtering/rendering/cluster declarations, substituting only
// the external SDK. No provider, account, collector or production DB is used.
const mapText = await readFile(new URL("../../js/map.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("map.js", mapText, ts.ScriptTarget.Latest, true);
const mapDeclarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node))
  .map(node => node.getText(ast)).join("\n");
const mapRefreshExports = ast.statements.filter(node => /^window\.JSListingRefreshV1(?:\.|\s*=)/.test(node.getText(ast)))
  .map(node => node.getText(ast)).join("\n");
const mixedId = "FIXTURE-LEASE-1", endedId = "FIXTURE-LEASE-2";
const picture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='120'%3E%3Crect width='100' height='120' fill='%23c9e7f5'/%3E%3C/svg%3E";
const unifiedRuntime = await readFile(new URL("../../js/unified-listings-v8.js", import.meta.url), "utf8");

function item(id, extra = {}) {
  return {propertyId:id,key:"qa-" + id,name:"검수 " + id,address:"대전 서구 괴정동 " + id.length,
    room:"1층",floor:1,type:"상가",deposit:2000,rent:90,fee:0,premium:0,area:25,
    memo:"사용자 검수 메모 " + id,state:"active",source:"네이버",regDate:"2026-10-14",
    buildingYear:"2020",tradeType:"lease",latitude:36.35,longitude:127.38,...extra};
}
function data(floors) {
  const items = [item(mixedId),item(endedId,{room:"2층",floor:2,latitude:36.3501})];
  if (floors) items.push(
    item("UNKNOWN-B03",{room:"B03호",floor:"",rent:80}),
    item("UNKNOWN-BLANK",{room:"",floor:""}),
    item("BASEMENT-B03",{room:"B03호",floor:-1}),
    item("KNOWN-SECOND",{room:"2층",floor:2}),
    item("EXPENSIVE-UNKNOWN",{room:"",floor:"",rent:150}),
    item("OTHER-SOURCE",{room:"",floor:"",source:"당근"}),
    item("FIRST-F",{room:"",floor:"1F",rent:80})
  );
  const groups = Object.fromEntries(items.map(master => [master.propertyId,
    Array.from({length:master.propertyId===mixedId?10:master.propertyId===endedId?2:1},(_,index) => {
      const ended = master.propertyId===endedId || master.propertyId===mixedId && index===9;
      return {...master,propertyId:master.propertyId,originalId:master.propertyId + "-ad-" + index,
        sourceId:master.propertyId + "-provider-" + index,buildingName:ended?"미노출 원본 " + index:"현재 광고 " + index,
        active:ended?0:1,sourceUnavailable:ended,missingCount:ended?1:0,
        candidateEligible:ended,availabilityKind:ended?(master.propertyId===mixedId?"census_missing":"legacy_candidate"):"active",
        absenceConfirmedAt:master.propertyId===mixedId&&ended?"2026-10-14T15:15:00.000Z":"",
        deposit:master.propertyId===mixedId&&ended?500:master.deposit,
        rent:master.propertyId===mixedId&&ended?40:master.rent,
        source:master.propertyId===mixedId&&ended?"당근":master.source,
        images:[picture],thumbnail:picture,photoCount:1,link:"http://127.0.0.1/original/" + master.propertyId};
    })]));
  return {items,payload:{ok:true,groups,sourceSearchIds:{},snapshotRevision:"QA-PRESENCE-1"}};
}

async function realMap(page, items, payload) {
  await page.evaluate(() => {
    document.getElementById("fixtureControls").style.display="none";
    const host=document.getElementById("map");
    function LatLng(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}
    function Point(x,y){this.x=x;this.y=y;}
    const owner={center:new LatLng(36.35,127.38),level:5,
      getCenter(){return this.center;},getLevel(){return this.level;},
      getProjection(){return {containerPointFromCoords:coords=>new Point(host.clientWidth/2+(coords.getLng()-owner.center.getLng())*100000,
        host.clientHeight/2-(coords.getLat()-owner.center.getLat())*100000),
      coordsFromContainerPoint:point=>new LatLng(owner.center.getLat()-(point.y-host.clientHeight/2)/100000,
        owner.center.getLng()+(point.x-host.clientWidth/2)/100000)};},
      getBounds(){return {contain:coords=>{const point=this.getProjection().containerPointFromCoords(coords);
        return point.x>=0&&point.x<=host.clientWidth&&point.y>=0&&point.y<=host.clientHeight;}};},
      setCenter(value){this.center=value;},setLevel(value){this.level=value;},panTo(value){this.center=value;},relayout(){}};
    function CustomOverlay(options){
      this.position=options.position;this.anchor=document.createElement("div");
      this.setContent=value=>{this.content=value;this.anchor.innerHTML=typeof value==="string"?value:"";};this.setContent(options.content);
      this.getContent=()=>this.content;this.getPosition=()=>this.position;this.setPosition=value=>{this.position=value;};
      this.setMap=map=>{if(map){const point=owner.getProjection().containerPointFromCoords(this.position);
        Object.assign(this.anchor.style,{position:"absolute",left:point.x+"px",top:point.y+"px",transform:"translate(-50%,-50%)"});
        host.appendChild(this.anchor);}else this.anchor.remove();};
    }
    const Status={OK:"OK",ZERO_RESULT:"ZERO_RESULT",ERROR:"ERROR"};
    function Places(){this.keywordSearch=(_q,cb)=>cb([],Status.ZERO_RESULT);}
    function Geocoder(){this.addressSearch=(_q,cb)=>cb([],Status.ZERO_RESULT);}
    window.map=owner;window.kakao={maps:{LatLng,Point,CustomOverlay,services:{Places,Geocoder,Status},event:{addListener(){},trigger(){}}}};
    window.geocoder=new Geocoder();
  });
  await page.addScriptTag({content:mapDeclarations + "\n" + mapRefreshExports});
  await page.evaluate(({items,payload}) => {
    allItems=items.map(item=>({...item,latlng:new kakao.maps.LatLng(item.latitude,item.longitude)}));
    jsInitialFullListingsLoadingV1=false;jsListingsCompleteBaseV1=true;
    hideDone=true;doneOnly=false;
    JSUnifiedListingsV8.attach(allItems,payload);applyFilter();
  },{items,payload});
}

async function setup(page, context, isMobile, floors=false, prepareFixture) {
  const errors=[],external=[],writes=[];
  const fixture=data(floors);
  if (prepareFixture) prepareFixture(fixture);
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.hostname==="127.0.0.1"||url.protocol==="data:") return route.continue();
    external.push(url.origin);return route.abort();
  });
  await page.route("**/api/data**",route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=="GET"){writes.push(url.pathname);return route.abort();}
    const action=url.searchParams.get("action");
    if(action==="unifiedListings") return route.fulfill({json:fixture.payload});
    if(action==="unifiedListingDetail") return route.fulfill({json:{ok:true,originals:fixture.payload.groups[url.searchParams.get("propertyId")]||[]}});
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
  await realMap(page,fixture.items,fixture.payload);
  if(isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect.poll(()=>page.evaluate(()=>JSV6ListStore.load("favorite").some(folder=>folder.id==="fixture-favorites"))).toBe(true);
  expect(errors).toEqual([]);
  return {errors,external,writes};
}
function safe(result){expect(result.errors).toEqual([]);expect(result.external).toEqual([]);expect(result.writes).toEqual([]);}
const card = (page,id) => page.locator('#list .item[data-property-id="' + id + '"]');
async function ids(page){return page.locator("#list .item").evaluateAll(cards=>cards.map(card=>card.dataset.propertyId));}
async function mapIds(page){return page.evaluate(()=>[...new Set(overlays.flatMap(overlay=>(overlay.__cluster?.items||[]).map(item=>item.propertyId)))].sort());}
async function menu(page,id){await page.locator(id).evaluate(button=>button.click());}

async function missingMetadataFixture(page, ended) {
  await page.addScriptTag({content:unifiedRuntime});
  await page.evaluate(({id,photo,ended})=>{
    // These two focused cases exercise the detail recovery path. Automatic
    // rendered-window recovery is covered independently below, not raced here.
    if(requestVisibleOriginalMetadataV1.timer)clearTimeout(requestVisibleOriginalMetadataV1.timer);
    requestVisibleOriginalMetadataV1.timer=null;
    JSListingRefreshV1.requestVisibleOriginals=()=>{};
    const master=allItems.find(item=>item.propertyId===id);
    allItems=[master];
    const access=JSDataAccessV6;
    window.JSDataAccessV6=Object.assign({},access,{read(action,params,options){
      if(action!=="unifiedListingDetail")return access.read(action,params,options);
      return Promise.resolve({ok:true,propertyId:id,originals:Array.from({length:ended?7:1},(_,index)=>({
        propertyId:id,originalId:"recovered-ad-"+index,providerSourceId:"265000000"+index,
        source:"네이버",tradeType:"lease",room:"1층",floor:1,deposit:2000,rent:90,area:25,
        active:ended?0:1,sourceUnavailable:ended,candidateEligible:ended,
        availabilityKind:ended?"legacy_candidate":"active",lastCheckedAt:"2026-10-15T03:00:00.000Z",
        buildingName:"원본 확인 사진",address:master.address,thumbnail:photo,images:[photo],photoCount:1
      }))});
    }});
    JSUnifiedListingsV8.attach(allItems);applyFilter();
  },{id:mixedId,photo:picture,ended});
}

function recoveryRows(items) {
  return items.map(value=>({title:value.name,address:value.address,room:value.room,listing_type:value.type,
    deposit:value.deposit,monthly_rent:value.rent,maintenance_fee:value.fee,premium:value.premium,area_m2:value.area,
    operating_memo:value.memo,status:value.state,first_collected_at:value.regDate,main_source:value.source,
    property_id:value.propertyId,building_year:value.buildingYear,latitude:value.latitude,longitude:value.longitude,
    trade_type:value.tradeType,source_snapshot_key:value.sourceSnapshotKey}));
}
function recoverySheet(items, revision) {
  const fields=["title","address","room","listing_type","deposit","monthly_rent","maintenance_fee","premium","area_m2",
    "landlord_phone","tenant_phone","operating_memo","status","first_collected_at","main_source","property_id",
    "source_url","contacts_json","building_year","building_elevators","building_approval_date","building_info_checked_at",
    "building_info_status","registration_at","last_collected_at","latitude","longitude","building_elevator_capacity",
    "trade_type","sale_category","sale_price","sale_details_json","source_snapshot_key"];
  const rows=recoveryRows(items);
  return {revision,body:[fields,...rows.map(value=>fields.map(field=>value[field]??""))]
    .map(values=>values.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(",")).join("\r\n")};
}

async function settleFixtureMetadataRecovery(page) {
  await page.evaluate(async()=>{
    // Mobile list activation can start a render-window read in setup(). Wait
    // for that old fixture's request before installing the next route/runtime.
    JSListingRefreshV1.requestVisibleOriginals=()=>{};
    function clearVisibleTimer(){
      if(requestVisibleOriginalMetadataV1.timer)clearTimeout(requestVisibleOriginalMetadataV1.timer);
      requestVisibleOriginalMetadataV1.timer=null;
    }
    clearVisibleTimer();
    const pending=refreshScopedOriginalsV1.pending;
    if(pending&&pending.promise)await pending.promise;
    // Its one coalesced follow-up may have been queued while it settled.
    clearVisibleTimer();
  });
}

async function failedFullMetadataFixture(page, context, isMobile, holdRecovery) {
  const result=await setup(page,context,isMobile);
  await settleFixtureMetadataRecovery(page);
  const manual=Array.from({length:52},(_,index)=>item("MANUAL-DONE-"+index,{state:"계약완료"}));
  const active=item("ACTIVE-WITH-PHOTO");
  const candidates=[item(mixedId),item(endedId)];
  const items=[...manual,active,...candidates];
  items.forEach((master,index)=>{master.sourceSnapshotKey=proofKey(index+1000);});
  const groups=Object.fromEntries(items.map(master=>[master.propertyId,[{
    ...master,originalId:master.propertyId+"-source",providerSourceId:"qa-"+master.propertyId,
    buildingName:master.name,active:candidates.includes(master)?0:1,sourceUnavailable:candidates.includes(master),
    candidateEligible:candidates.includes(master),availabilityKind:candidates.includes(master)?"census_missing":"active",
    absenceConfirmedAt:candidates.includes(master)?"2026-10-15T03:00:00Z":"",images:[picture],thumbnail:picture,photoCount:1
  }]]));
  const state={reads:[],sheetReads:0,available:false,release:null};
  const recovery=new Promise(resolve=>{state.release=resolve;});
  const revision="QA-RECOVERY-CURRENT";
  const snapshot=recoverySheet(items,revision);
  await page.route("**/api/data**",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=="GET") {result.writes.push(url.pathname);return route.abort();}
    const action=url.searchParams.get("action");
    if(action!=="unifiedListings"&&action!=="listingOriginals")return route.fallback();
    const ids=action==="listingOriginals"?(url.searchParams.get("ids")||"").split(","):[];
    state.reads.push({action,ids,force:request.headers()["x-js-force-refresh"]==="1"});
    if(action==="listingOriginals"&&holdRecovery)await recovery;
    if(!state.available)return route.fulfill({status:503,json:{ok:false,message:"검수용 원본 조회 실패"}});
    const selected=action==="listingOriginals"?items.filter(master=>ids.includes(master.propertyId)):items;
    const unified={ok:true,groups:Object.fromEntries(selected.map(master=>[master.propertyId,groups[master.propertyId]])),
      sourceSearchIds:{},sourceSnapshotKeys:Object.fromEntries(selected.map(master=>[master.propertyId,master.sourceSnapshotKey])),
      sourceSnapshotPropertyIds:Object.fromEntries(selected.map(master=>[master.propertyId,master.propertyId])),snapshotRevision:revision};
    return route.fulfill({status:200,headers:{"x-js-listings-revision":revision},
      json:action==="listingOriginals"?{ok:true,items:recoveryRows(selected),unified}:unified});
  });
  await page.route("**/api/sheet",route=>{
    state.sheetReads+=1;
    return route.fulfill({status:200,contentType:"text/csv",headers:{"x-js-listings-revision":revision},body:snapshot.body});
  });
  // Reset only the local runtime, then use the real full CSV/unified read pair.
  // No attach(payload) shortcut can supply the missing candidate information.
  await page.addScriptTag({content:unifiedRuntime});
  await page.evaluate(()=>{
    // This fixture verifies one bounded automatic full-load recovery pass and
    // one explicit retry. Render-window recovery has its own real-hook case;
    // do not race an additional visible pass against these gated assertions.
    if(requestVisibleOriginalMetadataV1.timer)clearTimeout(requestVisibleOriginalMetadataV1.timer);
    requestVisibleOriginalMetadataV1.timer=null;
    JSListingRefreshV1.requestVisibleOriginals=()=>{};
    allItems=[];currentItems=[];hideDone=false;doneOnly=true;isLoadingSheet=false;pendingAutoUpdate=false;
    jsListingsCompleteBaseV1=false;jsListingsRevisionV682="";jsInitialFullListingsLoadingV1=true;
    jsInitialFullListingsCacheHitV1=false;jsInitialFullListingsCacheItemsV1=null;
    selectedGroupKey=null;jsPinnedClusterSelectionV6515=null;jsAdministrativeListSelectionV6570=null;
    JSDataAccessV6.invalidateRead("unifiedListings");
  });
  return {...result,state,start:()=>page.evaluate(()=>loadSheet(false,true))};
}

test("failed original metadata automatically recovers all candidates and photos beyond 52 manual completions",async({page,context,isMobile})=>{
  const result=await failedFullMetadataFixture(page,context,isMobile,true);
  try {
    await result.start();
    await expect(page.locator("#list")).toHaveAttribute("data-total-count","52");
    await expect.poll(()=>result.state.reads.length).toBe(2);
    result.state.available=true;result.state.release();
    await expect.poll(()=>page.evaluate(()=>JSUnifiedListingsV8.getOriginalMetadataStatus().status)).toBe("ready");
    await expect.poll(()=>page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({
      ready:true,candidateCount:2,manualCompletedCount:52,doneCount:54
    });
    await expect(page.locator("#list")).toHaveAttribute("data-total-count","54");
    await expect(page.locator("#mapListingCountValueV825")).toHaveText("54개");
    await expect(card(page,mixedId).locator(".transaction-check-ribbon-v8135")).toContainText("거래완료 후보");
    await expect(card(page,mixedId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(page.locator("#unifiedOriginalLoadStatusV1")).toHaveCount(0);
    await menu(page,"#doneOnlyBtn");await menu(page,"#hideDoneBtn");
    await expect(card(page,"ACTIVE-WITH-PHOTO").locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(card(page,"ACTIVE-WITH-PHOTO")).not.toContainText("사진 불러오는 중");
    expect(result.state.reads.map(read=>read.action)).toEqual(["unifiedListings","listingOriginals","listingOriginals"]);
    expect(result.state.reads.slice(1).map(read=>read.ids.length)).toEqual([50,5]);
    expect(result.state.sheetReads).toBe(1);
    expect(await page.evaluate(()=>JSV6ListStore.load("favorite").some(folder=>folder.id==="fixture-favorites"))).toBe(true);
    expect(await page.evaluate(id=>allItems.find(value=>value.propertyId===id).memo,mixedId)).toContain("사용자 검수 메모");
    safe(result);
  } finally {result.state.release();}
});

test("persistent full original failures stop waiting labels and explicit retry restores candidate-only cards",async({page,context,isMobile})=>{
  const result=await failedFullMetadataFixture(page,context,isMobile,false);
  await result.start();
  await expect.poll(()=>result.state.reads.length).toBe(2);
  await expect(page.locator("#unifiedOriginalLoadStatusV1")).toContainText("사진·링크 정보 업데이트가 지연");
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","52");
  await expect(page.locator("#list .unified-thumb-v8").first()).toContainText("사진 불러오기 지연");
  await expect(page.locator("#list .unified-thumb-v8").filter({hasText:"사진 불러오는 중"})).toHaveCount(0);
  result.state.available=true;
  await page.locator("#unifiedOriginalLoadStatusV1 button").click();
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","54");
  await expect(card(page,endedId).locator(".unified-thumb-v8 img")).toHaveCount(1);
  await expect(page.locator("#unifiedOriginalLoadStatusV1")).toHaveCount(0);
  expect(result.state.reads.map(read=>read.action)).toEqual(["unifiedListings","listingOriginals","listingOriginals","listingOriginals"]);
  expect(result.state.reads.slice(2).map(read=>read.ids.length)).toEqual([50,5]);
  expect(result.state.sheetReads).toBe(1);
  safe(result);
});

test("normal list automatically recovers the visible new property's photo and link before an unrelated 250-row CSV prefix",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  const target=item("VISIBLE-AFTER-CSV-PREFIX",{name:"뷰포트 우선 검수 대상",sourceSnapshotKey:proofKey(2000),
    sourceLink:"http://127.0.0.1/original/visible-priority"});
  const prefix=Array.from({length:250},(_,index)=>item("UNRELATED-PREFIX-"+index,{sourceSnapshotKey:proofKey(index+3000)}));
  const reads=[],releases=[];
  await page.route("**/api/data**",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("action")!=="listingOriginals")return route.fallback();
    if(route.request().method()!=="GET"){result.writes.push(url.pathname);return route.abort();}
    const ids=(url.searchParams.get("ids")||"").split(",");
    reads.push(ids);
    await new Promise(resolve=>{releases.push(resolve);});
    const selected=[...prefix,target].filter(master=>ids.includes(master.propertyId));
    const groups=Object.fromEntries(selected.map(master=>[master.propertyId,[{
      ...master,originalId:"current-"+master.propertyId,providerSourceId:"provider-"+master.propertyId,
      active:1,availabilityKind:"active",candidateEligible:false,thumbnail:picture,images:[picture],photoCount:1,
      link:master.sourceLink||"http://127.0.0.1/original/"+master.propertyId
    }]]));
    return route.fulfill({json:{ok:true,items:recoveryRows(selected),unified:{ok:true,groups,
      sourceSnapshotKeys:Object.fromEntries(selected.map(master=>[master.propertyId,master.sourceSnapshotKey])),
      sourceSnapshotPropertyIds:Object.fromEntries(selected.map(master=>[master.propertyId,master.propertyId]))}}});
  });
  try {
    await page.evaluate(({prefix,target})=>{
      allItems=allItems.concat(prefix,target).map(master=>({...master,latlng:new kakao.maps.LatLng(master.latitude,master.longitude)}));
      JSUnifiedListingsV8.attach(allItems);
      document.getElementById("keyword").value="뷰포트 우선 검수 대상";
      applyFilter();
    },{prefix,target});
    await expect(card(page,target.propertyId)).toHaveCount(1);
    await expect(card(page,target.propertyId).locator(".unified-thumb-v8")).toContainText("사진 불러오기 지연");
    await expect.poll(()=>reads).toEqual([[target.propertyId]]);
    releases[0]();
    await expect(card(page,target.propertyId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(card(page,target.propertyId).locator(".item-source-link-btn")).toHaveText("링크");
    await expect(card(page,target.propertyId)).not.toContainText("원본 연결 재확인");
    expect(await page.evaluate(id=>({memo:allItems.find(master=>master.propertyId===id).memo,
      ready:JSUnifiedListingsV8.getOriginalMetadataStatus(id).ready}),target.propertyId))
      .toEqual({memo:target.memo,ready:true});
    expect(reads).toEqual([[target.propertyId]]);
    safe(result);
  } finally {releases.forEach(release=>release());}
});

const proofKey=index=>"sha256-v1:"+index.toString(16).padStart(64,"0");
async function proofRecoveryFixture(page,context,isMobile,mismatch=false) {
  const result=await setup(page,context,isMobile);
  await settleFixtureMetadataRecovery(page);
  const activeId="PROOF-ACTIVE", candidateId="PROOF-CANDIDATE", changedId="PROOF-CHANGED";
  const manual=Array.from({length:52},(_,index)=>item("PROOF-MANUAL-"+index,{state:"계약완료",sourceSnapshotKey:proofKey(index+10)}));
  const items=[...manual,item(activeId,{sourceSnapshotKey:proofKey(1)}),
    item(candidateId,{sourceSnapshotKey:proofKey(2)}),item(changedId,{sourceSnapshotKey:proofKey(3)})];
  const candidateIds=new Set([candidateId,changedId]);
  const photo=picture.replace("%23c9e7f5","%23bdd8b2");
  function original(master,fresh=false) {
    const candidate=candidateIds.has(master.propertyId);
    return {...master,originalId:master.propertyId+"-ad",providerSourceId:"provider-"+master.propertyId,
      buildingName:fresh?"변경 광고 최신 원본":master.name,active:candidate?0:1,sourceUnavailable:candidate,
      candidateEligible:candidate,availabilityKind:candidate?"census_missing":"active",
      lastCheckedAt:fresh?"2026-10-15T06:30:00Z":"2026-10-15T06:00:00Z",
      absenceConfirmedAt:candidate?"2026-10-15T05:00:00Z":"",
      images:[fresh?photo:picture],thumbnail:fresh?photo:picture,photoCount:1};
  }
  const groups={},keys={},publicIds={};
  items.forEach(master=>{
    const internal="INTERNAL-"+master.propertyId;
    groups[internal]=[{...original(master),propertyId:internal}];
    keys[internal]=mismatch&&master.propertyId===changedId?proofKey(4):master.sourceSnapshotKey;
    publicIds[internal]=master.propertyId;
  });
  const changed={...items.find(value=>value.propertyId===changedId),deposit:900,rent:45,sourceSnapshotKey:proofKey(5)};
  const state={fullReads:0,sheetReads:0,scopeReads:[],global:0,sheetRevision:"",fullRevision:"",releases:[],scopedResult:{ok:true,
    items:recoveryRows([changed]),unified:{ok:true,groups:{[changedId]:[original(changed,true)]},
      sourceSearchIds:{},sourceSnapshotKeys:{[changedId]:changed.sourceSnapshotKey},
      sourceSnapshotPropertyIds:{[changedId]:changedId}}}};
  await page.route("**/api/data**",async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get("action");
    if(request.method()!=="GET"){result.writes.push(url.pathname);return route.abort();}
    if(action==="unifiedListings") {
      state.fullReads+=1;
      state.fullRevision="GLOBAL-"+(++state.global);
      return route.fulfill({status:200,headers:{"x-js-listings-revision":state.fullRevision},
        json:{ok:true,groups,sourceSearchIds:{},sourceSnapshotKeys:keys,sourceSnapshotPropertyIds:publicIds}});
    }
    if(action==="listingOriginals") {
      state.scopeReads.push((url.searchParams.get("ids")||"").split(","));
      await new Promise(resolve=>{state.releases.push(resolve);});
      return route.fulfill({status:200,headers:{"x-js-listings-revision":"GLOBAL-"+(++state.global)},json:state.scopedResult});
    }
    if(action==="dataRevision")return route.fulfill({json:{ok:true,revision:"GLOBAL-"+(++state.global)}});
    return route.fallback();
  });
  await page.route("**/api/sheet",route=>{
    state.sheetReads+=1;
    const snapshot=recoverySheet(items,"GLOBAL-"+(++state.global));
    state.sheetRevision=snapshot.revision;
    return route.fulfill({status:200,contentType:"text/csv",headers:{"x-js-listings-revision":snapshot.revision},body:snapshot.body});
  });
  await page.addScriptTag({content:unifiedRuntime});
  await page.evaluate(()=>{
    allItems=[];currentItems=[];hideDone=false;doneOnly=true;isLoadingSheet=false;pendingAutoUpdate=false;
    jsListingsCompleteBaseV1=false;jsListingsRevisionV682="";jsInitialFullListingsLoadingV1=true;
    jsInitialFullListingsCacheHitV1=false;jsInitialFullListingsCacheItemsV1=null;
    selectedGroupKey=null;jsPinnedClusterSelectionV6515=null;jsAdministrativeListSelectionV6570=null;
    JSDataAccessV6.invalidateRead("unifiedListings");
  });
  return {...result,state,activeId,candidateId,changedId,photo,start:()=>page.evaluate(()=>loadSheet(false,true)),
    cleanup(){state.releases.forEach(release=>release());}};
}

test("property proofs restore every photo and candidate despite continuously different global revisions",async({page,context,isMobile})=>{
  const h=await proofRecoveryFixture(page,context,isMobile);
  try {
    await h.start();
    await expect(page.locator("#list")).toHaveAttribute("data-total-count","54");
    await expect(page.locator("#mapListingCountValueV825")).toHaveText("54개");
    await expect(card(page,h.candidateId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(card(page,h.changedId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(page.locator("#unifiedOriginalLoadStatusV1")).toHaveCount(0);
    expect(h.state.sheetRevision).not.toBe(h.state.fullRevision);
    expect(await page.evaluate(()=>jsListingsRevisionV682)).toBe(h.state.sheetRevision);
    expect(h.state.fullReads).toBe(1);expect(h.state.sheetReads).toBe(1);expect(h.state.scopeReads).toEqual([]);
    await menu(page,"#doneOnlyBtn");await menu(page,"#hideDoneBtn");
    await expect(card(page,h.activeId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    expect(await page.evaluate(id=>JSUnifiedListingsV8.allOriginals(id)[0].propertyId,h.activeId)).toBe(h.activeId);
    await page.evaluate(()=>loadSheet(true,true));
    await expect.poll(()=>page.evaluate(()=>JSUnifiedListingsV8.getOriginalMetadataStatus().status)).toBe("ready");
    await expect(card(page,h.activeId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(page.locator("#unifiedOriginalLoadStatusV1")).toHaveCount(0);
    expect(h.state.fullReads).toBe(2);expect(h.state.sheetReads).toBe(2);expect(h.state.scopeReads).toEqual([]);
    safe(h);
  } finally {h.cleanup();}
});

test("one changed property fetches only its own proven inventory without clearing other photos or candidates",async({page,context,isMobile})=>{
  const h=await proofRecoveryFixture(page,context,isMobile,true);
  try {
    await h.start();
    await expect.poll(()=>h.state.scopeReads).toEqual([[h.changedId]]);
    await expect(page.locator("#list")).toHaveAttribute("data-total-count","53");
    await expect(card(page,h.candidateId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    await expect(page.locator("#unifiedOriginalLoadStatusV1")).toContainText("변경된 매물 1건");
    const revision=await page.evaluate(()=>jsListingsRevisionV682);
    h.state.releases[0]();
    await expect(page.locator("#list")).toHaveAttribute("data-total-count","54");
    await expect(card(page,h.changedId).locator(".unified-thumb-v8 img")).toHaveAttribute("data-thumbnail-source-v8144",h.photo);
    await expect(card(page,h.changedId).locator(".price-main")).toContainText(/보\s*900\s*\/\s*(?:월세)?월\s*45/);
    await expect(page.locator("#unifiedOriginalLoadStatusV1")).toHaveCount(0);
    expect(await page.evaluate(()=>jsListingsRevisionV682)).toBe(revision);
    expect(h.state.fullReads).toBe(1);expect(h.state.sheetReads).toBe(1);expect(h.state.scopeReads).toEqual([[h.changedId]]);
    expect(await page.evaluate(id=>({memo:allItems.find(value=>value.propertyId===id).memo,
      ids:JSUnifiedListingsV8.allOriginals(id).map(value=>value.propertyId)}),h.changedId))
      .toEqual({memo:"사용자 검수 메모 "+h.changedId,ids:[h.changedId]});
    safe(h);
  } finally {h.cleanup();}
});

test("late scoped proofs cannot overwrite a memo edit or a newer load generation",async({page,context,isMobile})=>{
  const h=await proofRecoveryFixture(page,context,isMobile,true);
  try {
    // Keep the two manually gated replies deterministic. Automatic viewport
    // follow-up is independently checked with the production hook above.
    await page.evaluate(()=>{
      if(requestVisibleOriginalMetadataV1.timer)clearTimeout(requestVisibleOriginalMetadataV1.timer);
      requestVisibleOriginalMetadataV1.timer=null;
      JSListingRefreshV1.requestVisibleOriginals=()=>{};
    });
    await h.start();
    await expect.poll(()=>h.state.scopeReads.length).toBe(1);
    await page.evaluate(id=>{allItems.find(value=>value.propertyId===id).memo="수동 수정 메모 보존";},h.changedId);
    h.state.releases[0]();
    await expect.poll(()=>page.evaluate(()=>refreshScopedOriginalsV1.pending===null)).toBe(true);
    expect(await page.evaluate(id=>({memo:allItems.find(value=>value.propertyId===id).memo,
      originals:JSUnifiedListingsV8.allOriginals(id).length}),h.changedId)).toEqual({memo:"수동 수정 메모 보존",originals:0});
    await page.evaluate(()=>{window.__proofRecoveryPending=JSListingRefreshV1.recoverOriginals();});
    await expect.poll(()=>h.state.scopeReads.length).toBe(2);
    await page.evaluate(()=>{jsListingsLoadGenerationV1+=1;});
    h.state.releases[1]();
    await page.evaluate(()=>window.__proofRecoveryPending);
    expect(await page.evaluate(id=>({memo:allItems.find(value=>value.propertyId===id).memo,
      originals:JSUnifiedListingsV8.allOriginals(id).length}),h.changedId)).toEqual({memo:"수동 수정 메모 보존",originals:0});
    await expect(card(page,h.candidateId).locator(".unified-thumb-v8 img")).toHaveCount(1);
    expect(h.state.fullReads).toBe(1);expect(h.state.sheetReads).toBe(1);
    safe(h);
  } finally {h.cleanup();}
});

test("CSV-first photo metadata recovers on detail without false no-photo labels",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  await missingMetadataFixture(page,false);
  await expect(card(page,mixedId).locator(".unified-thumb-v8")).toContainText("사진 불러오는 중");
  await page.evaluate(id=>JSUnifiedListingsV8.open(encodeURIComponent(id)),mixedId);
  await expect(card(page,mixedId).locator(".unified-thumb-v8 img")).toHaveCount(1);
  await expect(page.locator("#unifiedDetailTitleV8")).toHaveText("원본 확인 사진");
  await expect(page.locator("#unifiedDetailBodyV8")).not.toContainText("원본매물 정보가 없습니다");
  expect(await page.evaluate(id=>allItems.find(item=>item.propertyId===id).memo,mixedId)).toContain("사용자 검수 메모");
  safe(result);
});

test("CSV-first ghost card is removed only after its seven candidate originals are confirmed",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  await missingMetadataFixture(page,true);
  await expect(card(page,mixedId)).toHaveCount(1);
  await page.evaluate(id=>JSUnifiedListingsV8.open(encodeURIComponent(id)),mixedId);
  await expect(card(page,mixedId)).toHaveCount(0);
  await expect(page.locator("#unifiedDetailBodyV8")).toContainText("미노출");
  await expect(page.locator("#unifiedDetailBodyV8")).not.toContainText("원본매물 정보가 없습니다");
  expect(await page.evaluate(id=>JSUnifiedListingsV8.allOriginals(id).length,mixedId)).toBe(7);
  expect(await page.evaluate(id=>allItems.find(item=>item.propertyId===id).state,mixedId)).toBe("active");
  safe(result);
});

test("mixed originals show nine live ads and restore only the reappearing candidate advertisement",async({page,context,isMobile},testInfo)=>{
  const result=await setup(page,context,isMobile);
  expect(await ids(page)).toEqual([mixedId]);expect(await mapIds(page)).toEqual([mixedId]);
  await expect(page.locator("#mapListingCountValueV825")).toHaveText("1개");
  await expect(card(page,mixedId).locator(".unified-expand-btn-v8")).toHaveText("동일매물 9개");
  expect(await page.evaluate(id=>JSUnifiedListingsV8.allOriginals(id).length,mixedId)).toBe(10);
  await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual(expect.arrayContaining([mixedId,endedId]));
  expect(await mapIds(page)).toEqual([mixedId,endedId]);
  await expect(page.locator("#mapListingCountValueV825")).toHaveText("2개");
  await expect(card(page,mixedId).locator(".unified-expand-btn-v8")).toHaveText("동일매물 10개");
  await expect(card(page,endedId).locator(".transaction-check-ribbon-v8135")).toContainText("원본 광고 미노출");
  await expect(card(page,endedId).locator(".done-restore-button-v1")).toHaveCount(0);
  await expect(card(page,endedId)).not.toHaveClass(/\bdone\b/);
  await mkdir("outputs/advertisement-presence-20261014",{recursive:true});
  await page.screenshot({path:"outputs/advertisement-presence-20261014/"+testInfo.project.name+"-included.png"});
  await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual([mixedId]);expect(await mapIds(page)).toEqual([mixedId]);
  await expect(card(page,mixedId).locator(".unified-expand-btn-v8")).toHaveText("동일매물 9개");
  await page.evaluate(()=>{
    const reappeared=JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").find(original=>original.originalId==="FIXTURE-LEASE-1-ad-9");
    Object.assign(reappeared,{active:1,sourceUnavailable:false,missingCount:0,candidateEligible:false,availabilityKind:"active"});
    JSUnifiedListingsV8.refreshOriginalVisibility(allItems);applyFilter();
  });
  await expect(card(page,mixedId).locator(".unified-expand-btn-v8")).toHaveText("동일매물 10개");
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({candidateCount:1,candidateAdCount:2});
  expect(await page.evaluate(id=>JSUnifiedListingsV8.allOriginals(id).length,mixedId)).toBe(10);
  // A genuinely manual completed master still owns its explicit restore UI.
  await page.evaluate(()=>{allItems.find(item=>item.propertyId==="FIXTURE-LEASE-1").state="계약완료";toggleHideDone();});
  await expect(card(page,mixedId).locator(".done-restore-button-v1")).toHaveCount(1);
  await expect(card(page,mixedId)).toHaveClass(/\bdone\b/);
  await expect(card(page,endedId).locator(".done-restore-button-v1")).toHaveCount(0);
  safe(result);
});

test("done-only projects each eligible candidate ad, matching its own price and preserving favorites and memos",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  const before=await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),
    items:allItems.map(item=>({id:item.propertyId,key:item.key,memo:item.memo,state:item.state})),
    originals:JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").map(original=>original.originalId)}));
  await menu(page,"#doneOnlyBtn");
  expect((await ids(page)).sort()).toEqual([mixedId,endedId]);expect(await mapIds(page)).toEqual([mixedId,endedId]);
  await expect(page.locator("#mapListingCountValueV825")).toHaveText("2개");
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({
    ready:true,candidateCount:2,candidateAdCount:3,manualCompletedCount:0,doneCount:2
  });
  // The original ad itself remains the candidate even with nine live siblings.
  expect(await page.evaluate(id=>JSUnifiedListingsV8.visibleOriginals(id).map(original=>original.originalId),mixedId))
    .toEqual([mixedId+"-ad-9"]);
  await expect(card(page,mixedId).locator(".price-main")).toContainText(/보\s*500\s*\/\s*(?:월세)?월\s*40/);
  await card(page,mixedId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden","false");
  await expect(page.locator("#unifiedDetailTitleV8")).toContainText("미노출 원본 9");
  await expect(page.locator("#unifiedDetailSubtitleV8")).toContainText("원본매물 1개");
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await page.evaluate(()=>{document.getElementById("maxRent").value="80";applyFilter();});
  expect(await ids(page)).toEqual([mixedId]);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({candidateCount:1,candidateAdCount:1});
  await page.evaluate(()=>{
    document.getElementById("maxRent").value="";
    document.getElementById("minFloor").value="1";document.getElementById("maxFloor").value="1";applyFilter();
  });
  expect(await ids(page)).toEqual([mixedId]);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({candidateCount:1,candidateAdCount:1});
  await page.evaluate(()=>{
    document.getElementById("minFloor").value="";document.getElementById("maxFloor").value="";
    document.getElementById("sourceFilter").value="danggeun";applyFilter();
  });
  expect(await ids(page)).toEqual([mixedId]);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({candidateCount:1,candidateAdCount:1});
  await page.evaluate(()=>{document.getElementById("sourceFilter").value="";applyFilter();});
  expect((await ids(page)).sort()).toEqual([mixedId,endedId]);
  await page.evaluate(()=>{JSV6ListStore.activateFavoriteFilter("fixture-favorites");});
  expect(await ids(page)).toEqual([mixedId]);expect(await mapIds(page)).toEqual([mixedId]);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({
    ready:true,candidateCount:1,candidateAdCount:1,manualCompletedCount:0,doneCount:1
  });
  await menu(page,"#doneOnlyBtn");await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual([mixedId]);
  await expect(card(page,mixedId).locator(".price-main")).toContainText(/보\s*2,000\s*\/\s*(?:월세)?월\s*90/);
  await page.evaluate(()=>{document.getElementById("maxRent").value="50";applyFilter();});
  expect(await ids(page)).toEqual([]);
  await menu(page,"#doneOnlyBtn");
  expect(await ids(page)).toEqual([mixedId]);
  await expect(card(page,mixedId).locator(".price-main")).toContainText(/보\s*500\s*\/\s*(?:월세)?월\s*40/);
  await page.evaluate(()=>{
    document.getElementById("maxRent").value="";document.getElementById("minRent").value="80";applyFilter();
  });
  expect(await ids(page)).toEqual([]);
  await menu(page,"#doneOnlyBtn");await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual([mixedId]);
  await page.evaluate(()=>{document.getElementById("minRent").value="";applyFilter();});
  expect(await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),
    items:allItems.map(item=>({id:item.propertyId,key:item.key,memo:item.memo,state:item.state})),
    originals:JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").map(original=>original.originalId)}))).toEqual(before);
  expect(await page.evaluate(()=>({favoriteOnly,activeFavoriteFolderId,favoriteFilterKeys})))
    .toMatchObject({favoriteOnly:true,activeFavoriteFolderId:"fixture-favorites",favoriteFilterKeys:["property:"+mixedId]});
  safe(result);
});

test("manual completion and candidate advertisements form a deduplicated master map/list union",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  await page.evaluate(()=>{
    allItems.find(item=>item.propertyId==="FIXTURE-LEASE-1").state="계약완료";
    toggleDoneOnly();
  });
  expect((await ids(page)).sort()).toEqual([mixedId,endedId]);
  expect(await mapIds(page)).toEqual([mixedId,endedId]);
  await expect(page.locator("#mapListingCountValueV825")).toHaveText("2개");
  await expect(card(page,mixedId).locator(".done-restore-button-v1")).toHaveCount(1);
  await expect(card(page,endedId).locator(".done-restore-button-v1")).toHaveCount(0);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({
    ready:true,candidateCount:1,candidateAdCount:2,manualCompletedCount:1,doneCount:2
  });
  // A manual-completed master with no remaining originals is counted once,
  // under manual completions rather than duplicated as a candidate.
  await page.evaluate(()=>{
    allItems.find(item=>item.propertyId==="FIXTURE-LEASE-2").state="계약완료";
    JSUnifiedListingsV8.refreshOriginalVisibility(allItems);applyFilter();
  });
  expect((await ids(page)).sort()).toEqual([mixedId,endedId]);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary())).toMatchObject({
    ready:true,candidateCount:0,candidateAdCount:0,manualCompletedCount:2,doneCount:2
  });
  await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual([]);expect(await mapIds(page)).toEqual([]);
  safe(result);
});

test("candidate keyword searches use its advertised floor without altering the master favorite key",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  const before=await page.evaluate(()=>allItems.find(item=>item.propertyId==="FIXTURE-LEASE-1").key);
  await page.evaluate(()=>{
    const original=JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").find(original=>original.originalId==="FIXTURE-LEASE-1-ad-9");
    Object.assign(original,{room:"3층",floor:3});
    toggleDoneOnly();
    document.getElementById("keyword").value="괴정동 3층";applyFilter();
  });
  expect(await ids(page)).toEqual([mixedId]);
  await expect(card(page,mixedId).locator(".item-room-badge")).toHaveText("3층");
  await page.evaluate(()=>{document.getElementById("keyword").value="괴정동 1층";applyFilter();});
  expect(await ids(page)).toEqual([]);
  expect(await page.evaluate(()=>{
    const master=allItems.find(item=>item.propertyId==="FIXTURE-LEASE-1");
    return {key:master.key,room:master.room};
  })).toEqual({key:before,room:"1층"});
  safe(result);
});

test("unknown floors survive numeric bounds while price, source and favorite filters remain conjunctive",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile,true);
  await page.evaluate(()=>{
    document.getElementById("minFloor").value="1";document.getElementById("maxFloor").value="1";
    document.getElementById("maxRent").value="100";document.getElementById("sourceFilter").value="naver";
    applyFilter();
  });
  const expected=[mixedId,"UNKNOWN-B03","UNKNOWN-BLANK","FIRST-F"].sort();
  expect((await ids(page)).sort()).toEqual(expected);expect(await mapIds(page)).toEqual(expected);
  await expect(page.locator("#mapListingCountValueV825")).toHaveText("4개");
  await expect(card(page,"UNKNOWN-B03").locator(".item-room-badge")).toHaveText("B03호");
  await expect(card(page,"FIRST-F").locator(".item-room-badge")).toHaveText("1층");
  await page.evaluate(()=>JSV6ListStore.activateFavoriteFilter("fixture-favorites"));
  expect(await ids(page)).toEqual([mixedId]);expect(await mapIds(page)).toEqual([mixedId]);
  await expect(page.locator("#mapListingCountValueV825")).toHaveText("1개");
  safe(result);
});

test("completed latest uses verified absence dates and opens the matching newest original on desktop and mobile",async({page,context,isMobile},testInfo)=>{
  const thirdId="FIXTURE-LEASE-3", manualId="FIXTURE-LEASE-4";
  const newPicture=picture.replace("%23c9e7f5","%23f3b7a6");
  const result=await setup(page,context,isMobile,false,fixture=>{
    fixture.items[0].regDate="2026-10-01";
    fixture.items[1].regDate="2026-12-01";
    const mixed=fixture.payload.groups[mixedId];
    const older=mixed.find(original=>original.originalId===mixedId+"-ad-9");
    older.absenceConfirmedAt="2026-10-13T01:00:00Z";
    fixture.payload.groups[mixedId].push({...older,originalId:mixedId+"-ad-latest",source:"네이버",
      buildingName:"가장 최근 미노출 광고",deposit:700,rent:60,
      absenceConfirmedAt:"2026-10-14T15:15:00.000Z",images:[newPicture],thumbnail:newPicture});
    const third=item(thirdId,{regDate:"2026-10-15"});
    const manual=item(manualId,{regDate:"2026-11-01",state:"계약완료"});
    fixture.items.push(third,manual);
    fixture.payload.groups[thirdId]=[
      {...third,originalId:thirdId+"-active",buildingName:"현재 유효 광고",active:1,
        candidateEligible:false,availabilityKind:"active",images:[picture],thumbnail:picture,photoCount:1},
      {...third,originalId:thirdId+"-candidate",buildingName:"전날 미노출 광고",active:0,sourceUnavailable:true,
        candidateEligible:true,availabilityKind:"census_missing",absenceConfirmedAt:"2026-10-14T12:00:00Z",
        deposit:900,rent:45,images:[picture],thumbnail:picture,photoCount:1}];
    fixture.payload.groups[manualId]=[{...manual,originalId:manualId+"-active",active:1,
      candidateEligible:false,availabilityKind:"active",images:[picture],thumbnail:picture,photoCount:1,
      // A stray timestamp on a live, manually completed listing is never an absence date.
      absenceConfirmedAt:"2026-10-15T05:00:00Z"}];
  });
  const before=await page.evaluate(()=>({
    canonical:allItems.map(({propertyId,key,memo,regDate,state,deposit,rent,room})=>({propertyId,key,memo,regDate,state,deposit,rent,room})),
    originalIds:JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").map(original=>original.originalId),
    favorites:JSV6ListStore.load("favorite")
  }));
  // Normal view remains registration latest, despite the opposite absence order.
  expect(await ids(page)).toEqual([thirdId,mixedId]);
  await menu(page,"#doneOnlyBtn");
  expect(await ids(page)).toEqual([mixedId,thirdId,endedId,manualId]);
  await expect(page.locator("#sortDropdownBtn .v6-sort-label")).toHaveText("미노출 최신순");
  await expect(page.locator('[data-sort-value="latest"] span:last-child')).toHaveText("미노출 최신순");
  await expect(card(page,mixedId).locator(".price-main")).toContainText(/보\s*700\s*\/\s*(?:월세)?월\s*60/);
  await expect(card(page,mixedId).locator(".unified-thumb-v8 img")).toHaveAttribute("data-thumbnail-source-v8144",newPicture);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.candidateSummary({includeRows:true}).candidates[0]))
    .toMatchObject({propertyId:mixedId,deposit:700,rent:60,thumbnail:newPicture});
  await card(page,mixedId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailTitleV8")).toHaveText("가장 최근 미노출 광고");
  const metadata=page.locator("#unifiedDetailBodyV8 .unified-detail-meta-v8");
  await expect(metadata).toContainText("등록일");
  await expect(metadata.locator(".absence-confirmed-date-v1")).toContainText("미노출 확인일26.10.15");
  expect(await metadata.evaluate(row=>{
    const bounds=row.getBoundingClientRect();
    return {overflow:row.scrollWidth>row.clientWidth,
      groups:[...row.querySelectorAll(".unified-detail-date-v1")].every(group=>{
        const rect=group.getBoundingClientRect();
        return rect.left>=bounds.left&&rect.right<=bounds.right+1;
      })};
  })).toEqual({overflow:false,groups:true});
  await mkdir("outputs/absence-confirmation-20261015",{recursive:true});
  await page.screenshot({path:"outputs/absence-confirmation-20261015/"+testInfo.project.name+"-verified-date.png"});
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  // The fresh cached detail must also open the date-selected original, not an
  // older higher-priority photo from another source in the same unit.
  await card(page,mixedId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailTitleV8")).toHaveText("가장 최근 미노출 광고");
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await card(page,endedId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailBodyV8 .absence-confirmed-date-v1")).toContainText("미확인");
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await card(page,manualId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailBodyV8 .absence-confirmed-date-v1")).toHaveCount(0);
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await page.evaluate(()=>{document.getElementById("maxRent").value="50";applyFilter();});
  expect(await ids(page)).toEqual([thirdId,mixedId]);
  await expect(card(page,mixedId).locator(".price-main")).toContainText(/보\s*500\s*\/\s*(?:월세)?월\s*40/);
  await card(page,mixedId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailTitleV8")).toHaveText("미노출 원본 9");
  await expect(page.locator("#unifiedDetailBodyV8 .absence-confirmed-date-v1")).toContainText("26.10.13");
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await page.evaluate(()=>{
    document.getElementById("maxRent").value="";document.getElementById("sourceFilter").value="danggeun";applyFilter();
  });
  expect(await ids(page)).toEqual([mixedId]);
  expect(await page.evaluate(()=>currentItems[0].unifiedAbsenceConfirmedTimeV1)).toBe(Date.parse("2026-10-13T01:00:00Z"));
  await page.evaluate(()=>{document.getElementById("sourceFilter").value="";applyFilter();});
  await menu(page,"#doneOnlyBtn");await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual([thirdId,mixedId]);
  await expect(page.locator('[data-sort-value="latest"] span:last-child')).toHaveText("최근등록순");
  expect(await page.evaluate(()=>({
    canonical:allItems.map(({propertyId,key,memo,regDate,state,deposit,rent,room})=>({propertyId,key,memo,regDate,state,deposit,rent,room})),
    originalIds:JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").map(original=>original.originalId),
    favorites:JSV6ListStore.load("favorite")
  }))).toEqual(before);
  safe(result);
});
