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
  await page.addScriptTag({content:mapDeclarations});
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
