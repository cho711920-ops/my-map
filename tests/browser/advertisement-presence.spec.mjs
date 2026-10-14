import {test, expect} from "@playwright/test";
import {readFile, mkdir} from "node:fs/promises";
import ts from "typescript";

// Use production filtering/rendering/cluster declarations, substituting only
// the external SDK. No provider, account, collector or production DB is used.
const mapText = await readFile(new URL("../../js/map.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("map.js", mapText, ts.ScriptTarget.Latest, true);
const mapDeclarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node))
  .map(node => node.getText(ast)).join("\n");
const mixedId = "FIXTURE-LEASE-1", endedId = "FIXTURE-LEASE-2";
const picture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='120'%3E%3Crect width='100' height='120' fill='%23c9e7f5'/%3E%3C/svg%3E";

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
  await page.addScriptTag({content:mapDeclarations});
  await page.evaluate(({items,payload}) => {
    allItems=items.map(item=>({...item,latlng:new kakao.maps.LatLng(item.latitude,item.longitude)}));
    jsInitialFullListingsLoadingV1=false;jsListingsCompleteBaseV1=true;
    hideDone=true;doneOnly=false;
    JSUnifiedListingsV8.attach(allItems,payload);applyFilter();
  },{items,payload});
}

async function setup(page, context, isMobile, floors=false) {
  const errors=[],external=[],writes=[];
  const fixture=data(floors);
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

test("mixed 9-live/1-ended originals stay 9 or 10 while all-ended masters hide from both real map and list",async({page,context,isMobile},testInfo)=>{
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
  // A genuinely manual completed master still owns its explicit restore UI.
  await page.evaluate(()=>{allItems.find(item=>item.propertyId==="FIXTURE-LEASE-1").state="계약완료";toggleHideDone();});
  await expect(card(page,mixedId).locator(".done-restore-button-v1")).toHaveCount(1);
  await expect(card(page,mixedId)).toHaveClass(/\bdone\b/);
  await expect(card(page,endedId).locator(".done-restore-button-v1")).toHaveCount(0);
  safe(result);
});

test("done-only selects the ended sibling, preserving favorite IDs, original IDs, memos and manual master states",async({page,context,isMobile})=>{
  const result=await setup(page,context,isMobile);
  const before=await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),
    items:allItems.map(item=>({id:item.propertyId,key:item.key,memo:item.memo,state:item.state})),
    originals:JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").map(original=>original.originalId)}));
  await menu(page,"#doneOnlyBtn");
  expect(await ids(page)).toEqual(expect.arrayContaining([mixedId,endedId]));
  expect(await page.evaluate(id=>JSUnifiedListingsV8.visibleOriginals(id).map(original=>original.originalId),mixedId))
    .toEqual([mixedId+"-ad-9"]);
  await card(page,mixedId).locator(".unified-thumb-v8").click();
  await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden","false");
  await expect(page.locator("#unifiedDetailTitleV8")).toContainText("미노출 원본 9");
  await expect(page.locator("#unifiedDetailSubtitleV8")).toContainText("원본매물 1개");
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await page.evaluate(()=>{JSV6ListStore.activateFavoriteFilter("fixture-favorites");});
  expect(await ids(page)).toEqual([mixedId]);
  await menu(page,"#doneOnlyBtn");await menu(page,"#hideDoneBtn");
  expect(await ids(page)).toEqual([mixedId]);
  expect(await page.evaluate(()=>({favorites:JSV6ListStore.load("favorite"),
    items:allItems.map(item=>({id:item.propertyId,key:item.key,memo:item.memo,state:item.state})),
    originals:JSUnifiedListingsV8.allOriginals("FIXTURE-LEASE-1").map(original=>original.originalId)}))).toEqual(before);
  expect(await page.evaluate(()=>({favoriteOnly,activeFavoriteFolderId,favoriteFilterKeys})))
    .toMatchObject({favoriteOnly:true,activeFavoriteFolderId:"fixture-favorites",favoriteFilterKeys:["property:"+mixedId]});
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
