import {test, expect} from "@playwright/test";
import {readFile, mkdir} from "node:fs/promises";
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
  return {property_id:id,title:"오늘 신규 " + id,address:"대전 서구 괴정동 " + (100 + id.length),
    room:"1층",listing_type:"상가",deposit:2000,monthly_rent:90,maintenance_fee:0,premium:0,area_m2:25,
    first_collected_at:rangeStart,registration_at:rangeStart,last_collected_at:rangeStart,
    status:"active",main_source:"네이버",building_year:"2020",latitude:36.35,longitude:127.38,
    trade_type:"lease",sale_price:null,sale_details_json:"",...extra};
}
function payload(rows, market="lease", revision="TODAY-1", extra={}) {
  const fields = ["originalId","source","thumbnail","photoCount","room","tradeType","saleCategory","salePrice"];
  return {ok:true,days:1,market,day,rangeStart,rangeEnd,items:rows,snapshotRevision:revision,hasMore:false,nextCursor:"",
    unified:{ok:true,version:2,format:"compact-v2",fields,
      groups:Object.fromEntries(rows.map(item=>[item.property_id,[[item.property_id + "-original",item.main_source,thumbnail,1,item.room,item.trade_type,item.sale_category || "",item.sale_price]]])),
      sourceSearchIds:Object.fromEntries(rows.map(item=>[item.property_id,["n:" + item.property_id]])),snapshotRevision:revision},...extra};
}
function sheet(rows, revision) {
  const fields=["title","address","room","listing_type","deposit","monthly_rent","maintenance_fee","premium","area_m2",
    "landlord_phone","tenant_phone","operating_memo","status","first_collected_at","main_source","property_id",
    "source_url","contacts_json","building_year","building_elevators","building_approval_date","building_info_checked_at",
    "building_info_status","registration_at","last_collected_at","latitude","longitude","building_elevator_capacity",
    "trade_type","sale_category","sale_price","sale_details_json"];
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
      const body=state.status===200?payload(rows,market,state.revision):{ok:false,message:"Synthetic unavailable"};
      return route.fulfill({status:state.status,contentType:"application/json",body:JSON.stringify(body)});
    }
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
  await expect(page.locator("#todayListingStatusV1")).toContainText("오늘 신규 3건");
  await expect(page.locator('#list .unified-thumb-v8 img')).toHaveCount(3);
  await mkdir("outputs/today-new-fix-20261013",{recursive:true});
  await page.screenshot({path:"outputs/today-new-fix-20261013/today-"+testInfo.project.name+".png"});
  safe(h);
});

test("loading, failed confirmation and confirmed zero are visibly different and retry never writes",async({page,context,isMobile},testInfo)=>{
  const h=await setup(page,context,isMobile,testInfo);
  h.state.hold=deferred();h.state.status=503;
  await today(page);
  await expect(page.locator("#todayListingStatusV1")).toContainText("최신 확인 중");
  await expect(page.locator("#todayListingStatusV1 button")).toBeDisabled();
  h.state.hold.resolve();h.state.hold=null;
  await expect.poll(()=>page.evaluate(()=>JSTodayListingsV1.state().phase)).toBe("error");
  await expect(page.locator("#todayListingStatusV1")).toContainText("최신 확인 실패");
  await expect(page.locator("#todayListingStatusV1")).not.toContainText("오늘 신규 0건");
  h.state.status=200;h.state.rows=[];
  await page.locator("#todayListingStatusV1 button").click();await ready(page);
  await expect(page.locator("#todayListingStatusV1")).toContainText("오늘 신규 0건");
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
  await expect(page.locator("#todayListingStatusV1")).toContainText("오늘 신규 4건");
  expect(h.calls).toHaveLength(2);
  safe(h);
});
