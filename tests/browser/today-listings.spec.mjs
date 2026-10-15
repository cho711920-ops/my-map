import {test, expect} from "@playwright/test";
import {readFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import ts from "typescript";

const mapText = await readFile(new URL("../../js/map.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("map.js", mapText, ts.ScriptTarget.Latest, true);
const declarations = ast.statements.filter(statement => ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement))
  .map(statement => statement.getText(ast)).join("\n");
const publicRefresh = ast.statements.filter(statement => /^window\.JSListingRefreshV1(?:\.|\s*=)/.test(statement.getText(ast)))
  .map(statement => statement.getText(ast)).join("\n");
if (!publicRefresh.includes("applyScoped")) throw new Error("The real listing-refresh export is missing");

const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10);
const rangeStart = new Date(day + "T00:00:00+09:00").toISOString();
const rangeEnd = new Date(Date.parse(rangeStart) + 86400000).toISOString();
const thumbnail = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='120'%3E%3Crect width='100' height='120' fill='%23b9ddf5'/%3E%3Ctext x='8' y='62' font-size='14'%3EFixture%3C/text%3E%3C/svg%3E";
function row(id, extra={}) {
  const item={property_id:id,title:"오늘 신규 " + id,address:"대전 서구 괴정동 " + (100 + id.length),
    room:"1층",listing_type:"상가",deposit:2000,monthly_rent:90,maintenance_fee:0,premium:0,area_m2:25,
    first_collected_at:rangeStart,registration_at:rangeStart,last_collected_at:rangeStart,
    status:"active",main_source:"네이버",building_year:"2020",latitude:36.35,longitude:127.38,
    trade_type:"lease",sale_price:null,sale_details_json:"",...extra};
  if(!item.source_snapshot_key)item.source_snapshot_key="sha256-v1:"+createHash("sha256").update(JSON.stringify(item)).digest("hex");
  return item;
}
function payload(rows, market="lease", revision="TODAY-1", extra={}) {
  const fields = ["originalId","source","thumbnail","photoCount","room","tradeType","saleCategory","salePrice",
    "active","deposit","rent","area","address","buildingName","firstSeen"];
  return {ok:true,todayPolicy:"first-observed-property-v1",days:1,market,day,rangeStart,rangeEnd,items:rows,snapshotRevision:revision,hasMore:false,nextCursor:"",
    dataRevision:revision,snapshotConsistency:"per-property-v1",
    todayOriginalIds:Object.fromEntries(rows.map(item=>[item.property_id,[item.property_id+"-original"]])),todayAdCount:rows.length,
    unified:{ok:true,version:2,format:"compact-v2",fields,snapshotConsistency:"per-property-v1",
      groups:Object.fromEntries(rows.map(item=>[item.property_id,[[item.property_id + "-original",item.main_source,thumbnail,1,
        item.room,item.trade_type,item.sale_category || "",item.sale_price,1,item.deposit,item.monthly_rent,item.area_m2,
        item.address,item.title,item.first_collected_at]]])),
      sourceSearchIds:Object.fromEntries(rows.map(item=>[item.property_id,["n:" + item.property_id]])),
      sourceSnapshotKeys:Object.fromEntries(rows.map(item=>[item.property_id,item.source_snapshot_key])),
      sourceSnapshotPropertyIds:Object.fromEntries(rows.map(item=>[item.property_id,item.property_id])),snapshotRevision:revision},...extra};
}
function sheet(rows, revision) {
  const fields=["title","address","room","listing_type","deposit","monthly_rent","maintenance_fee","premium","area_m2",
    "landlord_phone","tenant_phone","operating_memo","status","first_collected_at","main_source","property_id",
    "source_url","contacts_json","building_year","building_elevators","building_approval_date","building_info_checked_at",
    "building_info_status","registration_at","last_collected_at","latitude","longitude","building_elevator_capacity",
    "trade_type","sale_category","sale_price","sale_details_json","source_snapshot_key"];
  return {revision,body:[fields,...rows.map(item=>fields.map(field=>item[field] ?? ""))]
    .map(values=>values.map(value=>'"' + String(value).replaceAll('"','""') + '"').join(',')).join('\r\n')};
}
function deferred() {let resolve;const promise=new Promise(value=>{resolve=value;});return {promise,resolve};}

async function installMapBoundary(page) {
  await page.evaluate(() => {
    document.getElementById("fixtureControls").style.display="none";
    const host=document.getElementById("map");
    host.style.background="repeating-linear-gradient(0deg,#f0f7fa,#f0f7fa 59px,#d8e7ef 60px)";
    const attached=new Set();
    function LatLng(lat,lng) {this.getLat=()=>lat;this.getLng=()=>lng;}
    function Point(x,y) {this.x=x;this.y=y;}
    const map={
      center:new LatLng(36.35,127.38),level:5,
      getCenter(){return this.center;},getLevel(){return this.level;},
      getProjection(){return {containerPointFromCoords(coords){return new Point(host.clientWidth/2+(coords.getLng()-map.center.getLng())*100000,
        host.clientHeight/2-(coords.getLat()-map.center.getLat())*100000);},
      coordsFromContainerPoint(point){return new LatLng(map.center.getLat()-(point.y-host.clientHeight/2)/100000,map.center.getLng()+(point.x-host.clientWidth/2)/100000);}};},
      getBounds(){return {contain(coords){const point=map.getProjection().containerPointFromCoords(coords);
        return point.x>=0 && point.x<=host.clientWidth && point.y>=0 && point.y<=host.clientHeight;}};},
      setCenter(value){this.center=value;},setLevel(value){this.level=value;},panTo(value){this.center=value;},relayout(){}
    };
    function CustomOverlay(options) {
      this.position=options.position;this.content=options.content;this.anchor=document.createElement("div");
      this.setContent=content=>{this.content=content;this.anchor.innerHTML=typeof content==="string"?content:"";};
      this.setContent(options.content);
      this.getContent=()=>this.content;this.getPosition=()=>this.position;
      this.setPosition=value=>{this.position=value;};
      this.setMap=owner=>{if(owner){const point=map.getProjection().containerPointFromCoords(this.position);
        Object.assign(this.anchor.style,{position:"absolute",left:point.x+"px",top:point.y+"px",transform:"translate(-50%,-50%)"});
        host.appendChild(this.anchor);attached.add(this);}else {this.anchor.remove();attached.delete(this);}};
    }
    const Status={OK:"OK",ZERO_RESULT:"ZERO_RESULT",ERROR:"ERROR"};
    function Places(){this.keywordSearch=(_keyword,callback)=>callback([],Status.ZERO_RESULT);}
    function Geocoder(){this.addressSearch=(_address,callback)=>callback([],Status.ZERO_RESULT);}
    window.map=map;window.kakao={maps:{LatLng,Point,CustomOverlay,services:{Places,Geocoder,Status},event:{addListener(){},trigger(){}}}};
    window.geocoder=new Geocoder();
  });
  await page.addScriptTag({content:declarations + "\n" + publicRefresh});
  await page.evaluate(() => {
    jsListingsCompleteBaseV1=true;
    jsInitialFullListingsLoadingV1=false;
    allItems.forEach(item=>{item.buildingYear="2020";item.latlng=new kakao.maps.LatLng(item.latitude,item.longitude);});
    applyFilter();
  });
}

async function setup(page, context, isMobile, testInfo) {
  const calls=[],writes=[],errors=[],external=[];
  const state={rows:[row("NEW-NEAR"),row("NEW-OUTSIDE",{latitude:37,longitude:128}),row("NEW-UNLOCATED",{latitude:null,longitude:null})],
    revision:"TODAY-1",status:200,hold:null,sheet:null,blockFull:false,fullGate:deferred()};
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.hostname==="127.0.0.1" || url.protocol==="data:") return route.continue();
    external.push(url.origin);return route.abort();
  });
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/data**",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==="POST") {writes.push(request.postDataJSON());return route.continue();}
    const action=url.searchParams.get("action");
    if(action==="newListingPeriod") {
      calls.push({url:request.url(),params:Object.fromEntries(url.searchParams)});
      if(state.hold) await state.hold.promise;
      const market=url.searchParams.get("market");
      const rows=market==="lease"?state.rows:[row(market==="building_sale"?"SALE-BUILDING":"SALE-LAND",{
        trade_type:"sale",sale_category:market==="building_sale"?"building":"land",sale_price:50000,
        listing_type:market==="building_sale"?"건물":"토지",monthly_rent:0})];
      let body=state.status===200?payload(rows,market,state.revision):{ok:false,message:"Synthetic unavailable"};
      if(state.status===200&&state.responseBuilder)body=state.responseBuilder(body,market);
      return route.fulfill({status:state.status,contentType:"application/json",body:JSON.stringify(body)});
    }
    if(action==="unifiedListings"&&state.fullPayload)return route.fulfill({status:200,
      headers:{"x-js-listings-revision":state.fullPayload.snapshotRevision},json:state.fullPayload});
    if(action==="unifiedListingDetail"&&state.fullPayload)return route.fulfill({json:{ok:true,
      originals:state.fullPayload.groups[url.searchParams.get("propertyId")]||[]}});
    if(action==="unifiedListings" && state.blockFull) {
      await state.fullGate.promise;
      return route.fulfill({status:200,contentType:"application/json",headers:{"x-js-listings-revision":state.revision},
        body:JSON.stringify({ok:true,groups:{},sourceSearchIds:{}})}).catch(()=>{});
    }
    return route.continue();
  });
  await page.route("**/api/sheet",route=>{
    const result=state.sheet || sheet([],"EMPTY-FIXTURE");
    return route.fulfill({status:200,contentType:"text/csv",headers:{"x-js-listings-revision":result.revision},body:result.body});
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
  await installMapBoundary(page);
  if(isMobile) await page.locator('[data-mobile-view="list"]').click();
  testInfo.dataCleanup=()=>{state.hold?.resolve();state.fullGate.resolve();};
  return {state,calls,writes,errors,external};
}
async function today(page) {
  // Invoke the real menu button, including its inline toggle and close handlers.
  await page.locator("#todayNewBtn").evaluate(button=>button.click());
}
async function ready(page) {await expect.poll(()=>page.evaluate(()=>JSTodayListingsV1.state().phase)).toBe("ready");}
async function cardIds(page) {return page.locator("#list .item").evaluateAll(cards=>cards.map(card=>card.getAttribute("data-property-id")));}
function safe(h) {expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);expect(h.external).toEqual([]);}

test.afterEach(async ({page},testInfo)=>{testInfo.dataCleanup?.();});

test("Today queries only its real scoped URL and shows outside/unlocated new cards despite a stalled full original read",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  expect(await cardIds(page)).toHaveLength(2);
  h.state.blockFull=true;
  h.state.sheet=sheet([row("YESTERDAY",{first_collected_at:new Date(Date.parse(rangeStart)-3600000).toISOString()})],"OLD-BASE");
  await page.evaluate(()=>loadSheet(true,true));
  h.state.revision="TODAY-1";
  await today(page);await ready(page);
  expect(await cardIds(page)).toEqual(expect.arrayContaining(["NEW-NEAR","NEW-OUTSIDE","NEW-UNLOCATED"]));
  await expect(page.locator("#list .item")).toHaveCount(3);
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].params).toMatchObject({action:"newListingPeriod",days:"1",market:"lease"});
  expect(h.calls[0].params).not.toHaveProperty("cursor");expect(h.calls[0].params).not.toHaveProperty("revision");
  expect(h.calls[0].url).not.toContain("undefined");
  await expect(page.locator("#todayListingStatusV1")).toBeHidden();
  await expect(page.locator("#todayListingStatusV1")).toBeEmpty();
  await expect(page.locator('#todayListingStatusV1 button')).toHaveCount(0);
  await expect(page.locator('#activeFilterChipsV844')).toContainText('오늘 신규매물');
  await expect(page.locator('#list .unified-thumb-v8 img')).toHaveCount(3);
  await mkdir("outputs/today-property-policy-20261015",{recursive:true});
  await page.screenshot({path:"outputs/today-property-policy-20261015/today-"+testInfo.project.name+".png"});
  safe(h);
});

test("loading, failed confirmation and confirmed zero are visibly different and retry never writes",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  h.state.hold=deferred();h.state.status=503;
  await today(page);
  await expect(page.locator("#todayListingStatusV1")).toContainText("최신 확인 중");
  await expect(page.locator("#todayListingStatusV1 button")).toHaveCount(0);
  h.state.hold.resolve();h.state.hold=null;
  await expect.poll(()=>page.evaluate(()=>JSTodayListingsV1.state().phase)).toBe("error");
  await expect(page.locator("#todayListingStatusV1")).toContainText("최신 확인 실패");
  await expect(page.locator("#todayListingStatusV1")).not.toContainText("오늘 신규매물 0건");
  await expect(page.locator("#todayListingStatusV1 button")).toHaveText("다시 시도");
  h.state.status=200;h.state.rows=[];
  await page.locator("#todayListingStatusV1 button").click();await ready(page);
  await expect(page.locator("#todayListingStatusV1")).toBeHidden();
  await expect(page.locator("#todayListingStatusV1")).toBeEmpty();
  await expect(page.locator("#list .item")).toHaveCount(0);
  await expect(page.locator("#list")).toContainText("검색 결과가 없습니다");
  expect(h.calls).toHaveLength(2);safe(h);
});

test("source, price, keyword and favorite folder survive Today refresh and still constrain its cards",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  h.state.rows=[row("NEW-NEAR"),row("EXPENSIVE",{monthly_rent:200}),row("OTHER-SOURCE",{main_source:"당근"})];
  await page.evaluate(()=>{
    favoriteOnly=true;activeFavoriteFolderId="review-folder";activeFavoriteFolderName="검수 찜";
    favoriteFilterKeys=["property:NEW-NEAR","property:EXPENSIVE","property:OTHER-SOURCE"];
    document.getElementById("sourceFilter").value="naver";
    document.getElementById("maxRent").value="100";
    document.getElementById("keyword").value="괴정";
  });
  await today(page);await ready(page);
  expect(await cardIds(page)).toEqual(["NEW-NEAR"]);
  expect(await page.evaluate(()=>({favoriteOnly,activeFavoriteFolderId,favoriteFilterKeys,
    keyword:document.getElementById("keyword").value,source:document.getElementById("sourceFilter").value,maxRent:document.getElementById("maxRent").value})))
    .toMatchObject({favoriteOnly:true,activeFavoriteFolderId:"review-folder",keyword:"괴정",source:"naver",maxRent:"100"});
  safe(h);
});

test("yesterday's pinned cluster cannot override the fresh Today list",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  await page.evaluate(()=>{
    jsPinnedClusterSelectionV6515={itemIdentities:[getStableItemIdentityV638(allItems[0])],snapshot:{}};
    selectedGroupKey="yesterday-pin";
    jsAdministrativeListSelectionV6570={mode:"neighborhood",regionLabel:"탄방동",districtLabel:"서구"};
    applyFilter();
  });
  await expect(page.locator("#list .item")).toHaveCount(1);
  await today(page);await ready(page);
  await expect(page.locator("#list .item")).toHaveCount(3);
  expect(await page.evaluate(()=>({pin:jsPinnedClusterSelectionV6515,admin:jsAdministrativeListSelectionV6570}))).toEqual({pin:null,admin:null});
  safe(h);
});

test("lease, building and land remain separate when switching market with Today enabled",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  await today(page);await ready(page);
  await page.evaluate(()=>JSListingTradeV1.setMode("building_sale"));await ready(page);
  expect(await cardIds(page)).toEqual(["SALE-BUILDING"]);
  await page.evaluate(()=>JSListingTradeV1.setMode("land_sale"));await ready(page);
  expect(await cardIds(page)).toEqual(["SALE-LAND"]);
  expect(h.calls.map(call=>call.params.market)).toEqual(["lease","building_sale","land_sale"]);
  safe(h);
});

test("a later complete CSV introduces the next new ID while Today stays enabled without waiting for full metadata",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  await today(page);await ready(page);
  h.state.rows=[...h.state.rows,row("NEXT-COLLECTION")];h.state.revision="TODAY-2";
  h.state.sheet=sheet(h.state.rows,"TODAY-2");h.state.blockFull=true;
  await page.evaluate(()=>loadSheet(true,true));
  await ready(page);
  expect(await cardIds(page)).toEqual(expect.arrayContaining(["NEXT-COLLECTION"]));
  await expect(page.locator("#list .item")).toHaveCount(4);
  await expect(page.locator("#todayListingStatusV1")).toBeHidden();
  await expect(page.locator("#todayListingStatusV1")).toBeEmpty();
  expect(h.calls).toHaveLength(2);
  safe(h);
});

const newAdPhoto=thumbnail.replace("%23b9ddf5","%23c2e9bb");
function dateScenario() {
  const yesterday=new Date(Date.parse(rangeStart)-86400000).toISOString();
  const beforeStart=new Date(Date.parse(rangeStart)-1).toISOString();
  const rows=[
    row("OLD-PUBLICATION",{first_collected_at:yesterday,registration_at:rangeStart,operating_memo:"기존 게시광고 메모"}),
    row("OLD-REAPPEARED",{first_collected_at:yesterday,registration_at:yesterday,last_collected_at:rangeStart}),
    row("OLD-MASTER-NEW-AD",{first_collected_at:yesterday,registration_at:yesterday,operating_memo:"기존 통합매물 사용자 메모"}),
    row("OLD-MASTER-EXPENSIVE-NEW",{first_collected_at:yesterday,registration_at:yesterday}),
    row("KST-JUST-BEFORE",{first_collected_at:beforeStart,registration_at:rangeStart}),
    row("KST-EXACT-START"),
    row("MANUAL-TODAY",{main_source:"직접등록",operating_memo:"직접등록 사용자 메모"}),
    row("TODAY-FIRST-AFFORDABLE",{operating_memo:"오늘 신규매물 사용자 메모"}),
    row("TODAY-FIRST-EXPENSIVE")
  ];
  rows.forEach((master,index)=>{master.source_snapshot_key="sha256-v1:"+(index+1).toString(16).padStart(64,"0");});
  function original(master,id,firstSeen,patch={}) {
    return {propertyId:master.property_id,originalId:id,providerSourceId:"provider-"+id,source:master.main_source,
      buildingName:master.title,address:master.address,room:master.room,floor:1,deposit:master.deposit,rent:master.monthly_rent,
      area:master.area_m2,tradeType:master.trade_type,firstSeen,registrationAt:rangeStart,lastSeen:rangeStart,
      active:1,sourceUnavailable:false,candidateEligible:false,availabilityKind:"active",lastCheckedAt:rangeStart,
      thumbnail,images:[thumbnail],photoCount:1,...patch};
  }
  const groups=Object.fromEntries(rows.map(master=>[master.property_id,master.main_source==="직접등록"?[]:
    [original(master,master.property_id+"-old",master.first_collected_at)]]));
  groups["OLD-MASTER-NEW-AD"]=[
    original(rows[2],"OLD-MASTER-NEW-AD-old",yesterday,{source:"당근",buildingName:"어제 수집 기존 광고",deposit:8000,rent:450}),
    original(rows[2],"OLD-MASTER-NEW-AD-today",rangeStart,{buildingName:"오늘 처음 수집한 광고",deposit:1000,rent:60,area:30,
      thumbnail:newAdPhoto,images:[newAdPhoto]})
  ];
  groups["OLD-MASTER-EXPENSIVE-NEW"]=[
    original(rows[3],"OLD-MASTER-EXPENSIVE-NEW-old",yesterday,{deposit:500,rent:40}),
    original(rows[3],"OLD-MASTER-EXPENSIVE-NEW-today",rangeStart,{deposit:5000,rent:200,area:40,thumbnail:newAdPhoto,images:[newAdPhoto]})
  ];
  groups["TODAY-FIRST-AFFORDABLE"]=[
    original(rows[7],"TODAY-FIRST-AFFORDABLE-withdrawn",rangeStart,{source:"당근",deposit:500,rent:10,
      active:0,sourceUnavailable:true,availabilityKind:"withdrawn"}),
    original(rows[7],"TODAY-FIRST-AFFORDABLE-live",rangeStart,{buildingName:"오늘 처음 수집한 물건",deposit:1000,rent:60,area:30,
      thumbnail:newAdPhoto,images:[newAdPhoto]})
  ];
  groups["TODAY-FIRST-EXPENSIVE"]=[
    original(rows[8],"TODAY-FIRST-EXPENSIVE-withdrawn",rangeStart,{deposit:500,rent:40,
      active:0,sourceUnavailable:true,availabilityKind:"withdrawn"}),
    original(rows[8],"TODAY-FIRST-EXPENSIVE-live",rangeStart,{deposit:5000,rent:200,area:40,
      thumbnail:newAdPhoto,images:[newAdPhoto]})
  ];
  const todayOriginalIds={"TODAY-FIRST-AFFORDABLE":["TODAY-FIRST-AFFORDABLE-live"],
    "TODAY-FIRST-EXPENSIVE":["TODAY-FIRST-EXPENSIVE-live"],
    "KST-EXACT-START":["KST-EXACT-START-old"],"MANUAL-TODAY":[]};
  const eligible=rows.filter(master=>Object.hasOwn(todayOriginalIds,master.property_id));
  return {rows,groups,todayOriginalIds,eligible,yesterday};
}

async function sourceDateFixture(page,context,isMobile,testInfo) {
  const h=await setup(page,context,isMobile,testInfo),scenario=dateScenario();
  h.state.rows=scenario.eligible;
  h.state.revision="SOURCE-FIRST-SEEN-TODAY";
  h.state.sheet=sheet(scenario.rows,"SOURCE-DATE-BASE");
  const keys=Object.fromEntries(scenario.rows.map(master=>[master.property_id,master.source_snapshot_key]));
  const mapping=Object.fromEntries(scenario.rows.map(master=>[master.property_id,master.property_id]));
  h.state.fullPayload={ok:true,groups:scenario.groups,sourceSearchIds:{},sourceSnapshotKeys:keys,
    sourceSnapshotPropertyIds:mapping,snapshotRevision:"SOURCE-DATE-BASE"};
  h.state.responseBuilder=(body,market)=>market!=="lease"?body:{...body,
    todayOriginalIds:scenario.todayOriginalIds,todayAdCount:3,
    unified:{ok:true,groups:Object.fromEntries(scenario.eligible.map(master=>[master.property_id,scenario.groups[master.property_id]])),
      sourceSearchIds:{},sourceSnapshotKeys:Object.fromEntries(scenario.eligible.map(master=>[master.property_id,keys[master.property_id]])),
      sourceSnapshotPropertyIds:Object.fromEntries(scenario.eligible.map(master=>[master.property_id,master.property_id])),
      snapshotConsistency:body.snapshotConsistency,snapshotRevision:body.snapshotRevision}};
  await page.evaluate(()=>loadSheet(true,true));
  await expect.poll(()=>page.evaluate(()=>isLoadingSheet)).toBe(false);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","9");
  await expect.poll(()=>page.evaluate(()=>JSV6ListStore.load("favorite").some(folder=>folder.id==="fixture-favorites"))).toBe(true);
  return {...h,scenario};
}

test("Today first-observed-property policy excludes old parents with new ads, publication and reappearance while retaining KST-start and manual entries",async({page,context,isMobile},testInfo)=>{
  const h=await sourceDateFixture(page,context,isMobile,testInfo);
  const before=await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),items:allItems.map(value=>({
    id:value.propertyId,key:value.key,memo:value.memo,regDate:value.regDate,state:value.state
  }))}));
  await today(page);await ready(page);
  expect((await cardIds(page)).sort()).toEqual(Object.keys(h.scenario.todayOriginalIds).sort());
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","4");
  expect(await page.evaluate(()=>allItems.find(value=>value.propertyId==="MANUAL-TODAY").memo)).toBe("직접등록 사용자 메모");
  await expect(page.locator('#list .item[data-property-id="KST-EXACT-START"] .unified-thumb-v8 img')).toHaveCount(1);
  for(const id of ["OLD-PUBLICATION","OLD-REAPPEARED","OLD-MASTER-NEW-AD","OLD-MASTER-EXPENSIVE-NEW","KST-JUST-BEFORE"])
    await expect(page.locator('#list .item[data-property-id="'+id+'"]')).toHaveCount(0);
  expect(await page.evaluate(()=>JSTodayListingsV1.state())).toMatchObject({phase:"ready",day,count:4,adCount:3});
  await expect(page.locator("#todayListingStatusV1")).toBeHidden();
  await expect(page.locator("#todayListingStatusV1")).toBeEmpty();
  h.state.hold=deferred();
  await page.evaluate(()=>loadSheet(true,true));
  await expect(page.locator("#todayListingStatusV1")).toContainText("최신 확인 중");
  expect((await cardIds(page)).sort()).toEqual(Object.keys(h.scenario.todayOriginalIds).sort());
  h.state.hold.resolve();h.state.hold=null;
  await ready(page);
  expect(await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),items:allItems.map(value=>({
    id:value.propertyId,key:value.key,memo:value.memo,regDate:value.regDate,state:value.state
  }))}))).toEqual(before);
  await today(page);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","9");
  await expect(page.locator('#list .item[data-property-id="OLD-MASTER-NEW-AD"]')).toHaveCount(1);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals("OLD-MASTER-NEW-AD").map(value=>value.originalId)))
    .toEqual(expect.arrayContaining(["OLD-MASTER-NEW-AD-old","OLD-MASTER-NEW-AD-today"]));
  await page.evaluate(()=>{
    document.getElementById("sourceFilter").value="naver";
    document.getElementById("maxRent").value="80";document.getElementById("minArea").value="30";applyFilter();
  });
  const known=page.locator('#list .item[data-property-id="OLD-MASTER-NEW-AD"]');
  await expect(known).toHaveCount(1);
  await expect(known.locator(".price-main")).toContainText(/보\s*1,000\s*\/\s*(?:월세)?월\s*60/);
  await expect(known.locator(".unified-thumb-v8 img")).toHaveAttribute("data-thumbnail-source-v8144",newAdPhoto);
  safe(h);
});

test("Today filters first-observed properties by live advertisement conditions/photos without including old properties or withdrawn siblings",async({page,context,isMobile},testInfo)=>{
  const h=await sourceDateFixture(page,context,isMobile,testInfo);
  await page.evaluate(()=>{
    document.getElementById("maxRent").value="80";document.getElementById("maxDeposit").value="2000";
    document.getElementById("minArea").value="30";document.getElementById("maxArea").value="45";
    document.getElementById("sourceFilter").value="naver";
    JSV6ListStore.load("favorite").push({id:"source-date-review",name:"오늘 신규매물 검수",
      itemKeys:["property:TODAY-FIRST-AFFORDABLE","property:TODAY-FIRST-EXPENSIVE","property:OLD-MASTER-NEW-AD","property:OLD-MASTER-EXPENSIVE-NEW"]});
    JSV6ListStore.activateFavoriteFilter("source-date-review",{silent:true});
  });
  await today(page);await ready(page);
  expect(await cardIds(page)).toEqual(["TODAY-FIRST-AFFORDABLE"]);
  const projectedIds=await page.evaluate(()=>{
    const project=JSUnifiedListingsV8.filterItemForView,ids=[];
    JSUnifiedListingsV8.filterItemForView=function(master,...rest){ids.push(master.propertyId);return project(master,...rest);};
    try {getFilteredItems();} finally {JSUnifiedListingsV8.filterItemForView=project;}
    return ids;
  });
  expect(projectedIds.sort()).toEqual(Object.keys(h.scenario.todayOriginalIds).sort());
  const card=page.locator('#list .item[data-property-id="TODAY-FIRST-AFFORDABLE"]');
  await expect(card.locator(".price-main")).toContainText(/보\s*1,000\s*\/\s*(?:월세)?월\s*60/);
  await expect(card.locator(".unified-thumb-v8 img")).toHaveAttribute("data-thumbnail-source-v8144",newAdPhoto);
  await card.locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailTitleV8")).toHaveText("오늘 처음 수집한 물건");
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  expect(await page.evaluate(()=>({folder:activeFavoriteFolderId,
    memo:allItems.find(value=>value.propertyId==="TODAY-FIRST-AFFORDABLE").memo,
    regDate:allItems.find(value=>value.propertyId==="TODAY-FIRST-AFFORDABLE").regDate,
    originals:JSUnifiedListingsV8.allOriginals("TODAY-FIRST-AFFORDABLE").length})))
    .toEqual({folder:"source-date-review",memo:"오늘 신규매물 사용자 메모",regDate:rangeStart,originals:2});
  await page.evaluate(()=>{document.getElementById("maxRent").value="250";document.getElementById("maxDeposit").value="6000";applyFilter();});
  expect((await cardIds(page)).sort()).toEqual(["TODAY-FIRST-AFFORDABLE","TODAY-FIRST-EXPENSIVE"]);
  await expect(page.locator('#list .item[data-property-id="TODAY-FIRST-EXPENSIVE"] .price-main'))
    .toContainText(/보\s*5,000\s*\/\s*(?:월세)?월\s*200/);
  await page.evaluate(()=>{document.getElementById("maxArea").value="35";applyFilter();});
  expect(await cardIds(page)).toEqual(["TODAY-FIRST-AFFORDABLE"]);
  await page.evaluate(()=>{document.getElementById("minArea").value="35";document.getElementById("maxArea").value="45";applyFilter();});
  expect(await cardIds(page)).toEqual(["TODAY-FIRST-EXPENSIVE"]);
  await page.evaluate(()=>{document.getElementById("sourceFilter").value="danggeun";applyFilter();});
  expect(await cardIds(page)).toEqual([]);
  await page.evaluate(()=>{document.getElementById("sourceFilter").value="naver";applyFilter();});
  expect(await cardIds(page)).toEqual(["TODAY-FIRST-EXPENSIVE"]);
  safe(h);
});

async function pagedTodayFixture(page,context,isMobile,testInfo,pageSize=2) {
  const h=await setup(page,context,isMobile,testInfo);
  const rows=Array.from({length:6},(_,index)=>row("PAGED-TODAY-"+(index+1),{operating_memo:"페이지 검수 메모 "+index}));
  const batches=Array.from({length:Math.ceil(rows.length/pageSize)},(_,index)=>rows.slice(index*pageSize,(index+1)*pageSize));
  const gates={first:deferred(),second:deferred(),third:deferred(),coalescedSecond:deferred()};
  batches.forEach((_,index)=>{gates["page"+index]=deferred();});
  const calls=[];
  const state={calls,holdFirst:false,holdSecond:true,holdThird:true,holdEach:false,holdCoalesced:false,revision:0,occurrences:{},gates};
  h.state.sheet=sheet(rows,"PAGED-BASE");
  h.state.fullPayload=payload(rows,"lease","PAGED-BASE").unified;
  await page.route("**/api/data**",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.searchParams.get("action")!=="newListingPeriod")return route.fallback();
    if(request.method()!=="GET"){h.writes.push(request.postDataJSON());return route.abort();}
    const params=Object.fromEntries(url.searchParams),market=params.market,cursor=params.cursor||"";
    calls.push(params);
    const occurrence=(state.occurrences[market+":"+cursor]||0)+1;
    state.occurrences[market+":"+cursor]=occurrence;
    if(market!=="lease")return route.fulfill({json:payload([row("PAGED-"+market,{
      trade_type:"sale",sale_category:market==="land_sale"?"land":"building",sale_price:50000,monthly_rent:0
    })],market,"OTHER-MARKET-"+(++state.revision))});
    const index=cursor?Number(cursor.slice(5))-1:0;
    if(index===0&&occurrence===1&&state.holdFirst)await gates.first.promise;
    if(index>0&&occurrence===1&&state.holdEach)await gates["page"+index].promise;
    if(index===1&&occurrence===1&&state.holdSecond&&!state.holdEach)await gates.second.promise;
    if(index===2&&occurrence===1&&state.holdThird&&!state.holdEach)await gates.third.promise;
    if(index===1&&occurrence===2&&state.holdCoalesced)await gates.coalescedSecond.promise;
    const revision="COLLECTION-PAGE-"+(++state.revision);
    return route.fulfill({json:payload(batches[index],market,revision,{hasMore:index<batches.length-1,
      nextCursor:index<batches.length-1?"PAGE-"+(index+2):""})}).catch(()=>{});
  });
  await page.evaluate(()=>loadSheet(true,true));
  await expect.poll(()=>page.evaluate(()=>isLoadingSheet)).toBe(false);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","6");
  await expect.poll(()=>page.evaluate(()=>JSV6ListStore.load("favorite").some(folder=>folder.id==="fixture-favorites"))).toBe(true);
  const cleanup=testInfo.dataCleanup;
  testInfo.dataCleanup=()=>{Object.values(gates).forEach(gate=>gate.resolve());cleanup();};
  async function churn(revision) {
    h.state.sheet=sheet(rows,revision);
    h.state.fullPayload=payload(rows,"lease",revision).unified;
    await page.evaluate(()=>loadSheet(true,true));
    await expect.poll(()=>page.evaluate(()=>isLoadingSheet)).toBe(false);
  }
  return {...h,pages:state,rows,churn};
}

test("three Today pages publish verified cards progressively and finish through collection churn without restarting cursors",async({page,context,isMobile},testInfo)=>{
  const h=await pagedTodayFixture(page,context,isMobile,testInfo);
  h.pages.holdFirst=true;
  h.pages.holdCoalesced=true;
  const before=await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),memos:allItems.map(value=>[value.propertyId,value.memo])}));
  await today(page);
  await expect.poll(()=>h.pages.calls.length).toBe(1);
  await expect(page.locator("#list")).not.toContainText("검색 결과가 없습니다");
  await expect(page.locator("#list")).toContainText("오늘 신규매물을 확인하고 있습니다");
  h.pages.gates.first.resolve();
  await expect.poll(()=>h.pages.calls.length).toBe(2);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","2");
  await expect(page.locator("#list .unified-thumb-v8 img")).toHaveCount(2);
  await expect(page.locator("#list")).not.toContainText("검색 결과가 없습니다");
  expect(await page.evaluate(()=>JSTodayListingsV1.state())).toMatchObject({phase:"loading",partial:true,confirmedPages:1,progressCount:2,progressAdCount:2});
  await h.churn("FULL-COLLECTION-CHURN-1");
  expect(h.pages.calls.map(call=>call.cursor||"")).toEqual(["","PAGE-2"]);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","2");
  h.pages.gates.second.resolve();
  await expect.poll(()=>h.pages.calls.length).toBe(3);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","4");
  await h.churn("FULL-COLLECTION-CHURN-2");
  expect(h.pages.calls.map(call=>call.cursor||"")).toEqual(["","PAGE-2","PAGE-3"]);
  h.pages.gates.third.resolve();
  await expect.poll(()=>h.pages.calls.length).toBe(5);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","6");
  await h.churn("FULL-COLLECTION-CHURN-3");
  h.pages.gates.coalescedSecond.resolve();
  await ready(page);
  expect(h.pages.calls.map(call=>call.cursor||"")).toEqual(["","PAGE-2","PAGE-3","","PAGE-2","PAGE-3"]);
  expect(h.pages.calls.every(call=>!Object.hasOwn(call,"revision"))).toBe(true);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","6");
  await expect(page.locator("#list .unified-thumb-v8 img")).toHaveCount(6);
  await expect(page.locator("#todayListingStatusV1")).toBeHidden();
  await expect(page.locator("#todayListingStatusV1")).toBeEmpty();
  expect(await page.evaluate(()=>JSTodayListingsV1.state())).toMatchObject({phase:"ready",count:6,adCount:6});
  expect(await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),memos:allItems.map(value=>[value.propertyId,value.memo])}))).toEqual(before);
  safe(h);
});

test("Today deadline is not extended by full-snapshot events and timeout retains every verified page",async({page,context,isMobile},testInfo)=>{
  const h=await pagedTodayFixture(page,context,isMobile,testInfo,1);
  h.pages.holdEach=true;
  const noon=new Date(day+"T12:00:00+09:00");
  await page.clock.install({time:noon});
  await page.clock.pauseAt(new Date(noon.getTime()+100));
  await today(page);
  await expect.poll(()=>h.pages.calls.length).toBe(2);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","1");
  // Every individual read finishes inside its real 15-second deadline. Only
  // the total 45-second budget must expire, despite confirmed progress/churn.
  for(let index=1;index<=4;index++) {
    await page.clock.fastForward(10000);
    await page.evaluate(index=>notifyListingsSnapshotV1("full","DEADLINE-CHURN-"+index),index);
    h.pages.gates["page"+index].resolve();
    await expect.poll(()=>h.pages.calls.length).toBe(index+2);
    await expect(page.locator("#list")).toHaveAttribute("data-total-count",String(index+1));
  }
  expect(h.pages.calls).toHaveLength(6);
  await page.clock.fastForward(6000);
  await expect.poll(()=>page.evaluate(()=>JSTodayListingsV1.state().phase)).toBe("error");
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","5");
  await expect(page.locator("#list .unified-thumb-v8 img")).toHaveCount(5);
  await expect(page.locator("#list")).not.toContainText("검색 결과가 없습니다");
  await expect(page.locator("#todayListingStatusV1")).toContainText("실패");
  await expect(page.locator("#todayListingStatusV1 button")).toBeEnabled();
  expect(h.pages.calls).toHaveLength(6);
  safe(h);
});

test("a late lease page cannot replace the current market after switching Today to a sale market",async({page,context,isMobile},testInfo)=>{
  const h=await pagedTodayFixture(page,context,isMobile,testInfo);
  await today(page);
  await expect.poll(()=>h.pages.calls.length).toBe(2);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","2");
  await page.evaluate(()=>JSListingTradeV1.setMode("building_sale"));
  await ready(page);
  expect(await cardIds(page)).toEqual(["PAGED-building_sale"]);
  h.pages.gates.second.resolve();
  await expect.poll(()=>page.evaluate(()=>JSTodayListingsV1.state())).toMatchObject({phase:"ready",market:"building_sale",count:1});
  expect(await cardIds(page)).toEqual(["PAGED-building_sale"]);
  expect(h.pages.calls.filter(call=>call.market==="lease")).toHaveLength(2);
  await expect(page.locator("#list .unified-thumb-v8 img")).toHaveCount(1);
  safe(h);
});

test("leaving a cold partial Today result restores the complete normal list instead of keeping only page one",async({page,context,isMobile},testInfo)=>{
  const h=await pagedTodayFixture(page,context,isMobile,testInfo);
  await page.evaluate(()=>{
    allItems=[];currentItems=[];jsListingsCompleteBaseV1=false;jsListingsRevisionV682="";
    JSUnifiedListingsV8.attach(allItems);applyFilter();
  });
  await today(page);
  await expect.poll(()=>h.pages.calls.length).toBe(2);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","2");
  expect(await page.evaluate(()=>jsListingsCompleteBaseV1)).toBe(false);
  await today(page);
  await expect.poll(()=>page.evaluate(()=>jsListingsCompleteBaseV1)).toBe(true);
  await expect(page.locator("#list")).toHaveAttribute("data-total-count","6");
  await expect(page.locator("#list .unified-thumb-v8 img")).toHaveCount(6);
  expect(await page.evaluate(()=>({active:newListingDays,phase:JSTodayListingsV1.state().phase}))).toEqual({active:0,phase:"idle"});
  expect(h.pages.calls).toHaveLength(2);
  safe(h);
});
