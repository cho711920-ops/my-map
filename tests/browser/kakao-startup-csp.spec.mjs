import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

// Run complete production HTML + authentication loader + real Kakao SDK, not
// the normal UI fixture's synthetic map. The registered origin document and
// every app asset/API response are fulfilled locally; no production account,
// listing data, cookies or writes are used. Only public SDK/tile GETs pass.
const sdkHosts=new Set(["dapi.kakao.com","t1.kakaocdn.net","mts.kakaocdn.net","t1.daumcdn.net","t2.daumcdn.net","t3.daumcdn.net","t4.daumcdn.net","mts.daumcdn.net","map.daumcdn.net","map0.daumcdn.net","map1.daumcdn.net","map2.daumcdn.net","map3.daumcdn.net","map4.daumcdn.net"]);
const url="https://js-map.com/__startup-csp-fixture";

test.beforeEach(({isMobile},testInfo)=>{
  test.skip(process.env.JS_MAP_REAL_SDK!=="1","Set JS_MAP_REAL_SDK=1 to verify the current public Kakao SDK against production CSP.");
  test.skip(isMobile || testInfo.project.name!=="desktop","The live SDK contract runs once from desktop.");
});

async function startFullApplication(page,{oldCsp=false}={}) {
  const [index,headerSource]=await Promise.all([
    readFile(new URL("../../index.html",import.meta.url),"utf8"),
    readFile(new URL("../../_headers",import.meta.url),"utf8")
  ]);
  let csp=headerSource.match(/Content-Security-Policy: ([^\r\n]+)/)?.[1];
  expect(csp).toBeTruthy();
  expect(csp).toContain("https://t1.kakaocdn.net");
  if(oldCsp)csp=csp.replace(/ https:\/\/t1\.kakaocdn\.net/g,"");
  const csv=[Array.from({length:32},(_,i)=>"field"+i),
    ["검수 가상상가","대전 서구 탄방동 1","1층","상가",2000,90,0,0,25,"","","가상 자료","active","2026-10-06","네이버","FIXTURE-BOOT-1","","",2000,0,"20200101","2026-10-06","ok","2026-10-06","2026-10-06",36.3504,127.3845,0,"lease","","",""]
  ].map(row=>row.join(",")).join("\n");
  const errors=[],forbidden=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__startupCspViolations=[];
    document.addEventListener("securitypolicyviolation",event=>window.__startupCspViolations.push({directive:event.effectiveDirective,uri:event.blockedURI,source:event.sourceFile,line:event.lineNumber,column:event.columnNumber}));
  });
  await page.route("**/*",async route=>{
    const request=route.request(),target=new URL(request.url());
    const json=body=>route.fulfill({status:200,headers:{"x-js-listings-revision":"fixture-boot-1"},contentType:"application/json",body:JSON.stringify(body)});
    if(request.method()==="GET" && (sdkHosts.has(target.hostname)||/\.(?:daumcdn|kakaocdn)\.net$/.test(target.hostname)))return route.continue();
    // Do not make an unrelated external font dependency part of map startup.
    if(target.hostname==="cdn.jsdelivr.net")return route.fulfill({status:200,contentType:"text/css",body:""});
    if(target.hostname!=="js-map.com"){forbidden.push(target.hostname+target.pathname);return route.abort();}
    if(target.href===url)return route.fulfill({status:200,headers:{"Content-Security-Policy":csp},contentType:"text/html; charset=utf-8",body:index});
    if(target.pathname==="/api/session")return json({ok:true,email:"startup-fixture@example.invalid",role:"owner"});
    if(target.pathname==="/api/sheet")return route.fulfill({status:200,headers:{"x-js-listings-revision":"fixture-boot-1"},contentType:"text/csv",body:csv});
    if(target.pathname.startsWith("/api/")){
      const action=target.searchParams.get("action") || request.postDataJSON()?.action;
      if(action==="unifiedListings")return json({ok:true,groups:{},sourceSearchIds:{}});
      if(action==="loadCloudState")return json({ok:true,found:true,version:1,data:[],deletedIds:{}});
      if(action==="dataRevision")return json({ok:true,revision:"fixture-boot-1",changeIds:[],fullReload:false});
      if(action==="geocodeCache")return json({ok:true,entries:{}});
      return json({ok:true,rows:[],items:[],jobs:[],pending:0,processing:0,failed:0,completed:0});
    }
    const path=target.pathname.slice(1);
    if(request.method()!=="GET" || path.includes("..") || !/^(?:favicon\.svg|manifest\.webmanifest|(?:js|css|icons|data|assets)\/[\w./-]+\.(?:js|css|svg|png|json|webp|woff2))$/.test(path)){
      forbidden.push(target.pathname);return route.abort();
    }
    const ext=path.match(/\.[^.]+$/)?.[0];
    const types={".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".json":"application/json",".webmanifest":"application/manifest+json"};
    const body=await readFile(new URL("../../"+path,import.meta.url));
    return route.fulfill({status:200,contentType:types[ext]||"application/octet-stream",body});
  });
  await page.goto(url);
  await expect(page.locator("html")).not.toHaveClass(/auth-pending/);
  await expect(page.locator("#jsAuthGate")).toHaveCount(0);
  return {errors,forbidden};
}

test('land parcel boundary uses real SDK polygons with holes and preserves original listing data',async({page},testInfo)=>{
  test.setTimeout(45000);const checked=await startFullApplication(page);
  await expect(page.locator('#map .circle-marker')).toHaveCount(1);
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url()),action=u.searchParams.get('action');
    if(action==='saleParcelBoundaryConfig')return route.fulfill({json:{ok:true,available:true}});
    if(action==='saleParcelBoundary')return route.fulfill({json:{ok:true,pnu:'3017010800100030003',geometry:{type:'MultiPolygon',coordinates:[[
      [[127.3835,36.3498],[127.3855,36.3498],[127.3855,36.351],[127.3835,36.351],[127.3835,36.3498]],
      [[127.3842,36.3502],[127.3848,36.3502],[127.3848,36.3506],[127.3842,36.3506],[127.3842,36.3502]]
    ]]}}});return route.fallback();
  });
  await page.evaluate(()=>{
    window.__boundaryBefore=JSON.stringify(allItems);window.__nativeParcelPolygons=[];
    const NativePolygon=kakao.maps.Polygon;kakao.maps.Polygon=function(options){const polygon=new NativePolygon(options);__nativeParcelPolygons.push(polygon);return polygon;};
    JSListingTradeV1.setMode('land_sale');
    JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3017010800100030003',links:{}});
    const root=document.createElement('div');root.id='nativeParcelPanel';root.style='position:fixed;top:130px;left:15px;z-index:1000;background:white;width:330px';document.body.append(root);
    JSSaleParcelBoundaryV23.mount(root,{tradeType:'sale',saleCategory:'land',address:'대전 서구 괴정동 3-3',saleDetails:{landAreaM2:330}});
  });
  await page.locator('[data-boundary-single]').click();await expect(page.locator('.sale-parcel-map-v23')).toBeVisible();await page.locator('#nativeParcelPanel').evaluate(el=>el.remove());
  await expect(page.locator('.sale-parcel-badge-v23')).toBeVisible();expect(await page.evaluate(()=>__nativeParcelPolygons[0].getPath().length)).toBe(2);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(await page.evaluate(()=>__boundaryBefore));
  await page.locator('.sale-parcel-badge-v23').click();await expect(page.locator('[data-boundary-row="1"]')).toHaveClass('selected');
  await page.screenshot({path:testInfo.outputPath('native-parcel-hole.png')});
  await page.locator('.sale-parcel-map-v23 button').first().click();await expect(page.locator('.sale-parcel-badge-v23')).toHaveCount(0);
  expect(await page.evaluate(()=>__nativeParcelPolygons[0].getMap())).toBe(null);expect(checked.errors).toEqual([]);expect(checked.forbidden).toEqual([]);
});

test('parking overlays and detail coexist with real Kakao clusters without moving or selecting listings',async({page},testInfo)=>{
  test.setTimeout(45000);
  const boundary=await startFullApplication(page);
  await expect(page.locator('#map .circle-marker')).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
    // Only place-search responses are synthetic; map, projection and overlay input are the real SDK.
    kakao.maps.services.Places=function(){this.categorySearch=function(category,callback){callback([],kakao.maps.services.Status.ZERO_RESULT,{hasNextPage:false});};};
    window.parkingNativeBefore={center:map.getCenter().toString(),level:map.getLevel(),key:selectedGroupKey,
      count:overlays.reduce((sum,overlay)=>sum+overlay.__cluster.items.length,0),data:JSON.stringify(allItems)};
  });
  await page.locator('#mapParkingBtnV1').click();
  await expect.poll(()=>page.locator('.parking-pin-v1').count()).toBeGreaterThan(0);
  const id=await page.locator('.parking-pin-v1').evaluateAll(nodes=>{
    const host=document.getElementById('map').getBoundingClientRect();
    return nodes.find(el=>{const r=el.getBoundingClientRect();return r.left>host.left+340&&r.right<host.right-70&&r.top>host.top+30&&r.bottom<host.bottom-30;})?.dataset.parkingId;
  });
  expect(id).toBeTruthy();const pin=page.locator('[data-parking-id="'+id+'"]');
  await pin.click();
  await expect(page.locator('.parking-detail-v1')).toBeVisible();
  const placement=await pin.evaluate(el=>{
    const rect=el.getBoundingClientRect(),host=document.getElementById('map').getBoundingClientRect();
    const overlay=el.closest('div');return {inMap:rect.left>=host.left-30&&rect.right<=host.right+30,clickable:!!overlay};
  });
  expect(placement).toEqual({inMap:true,clickable:true});
  await page.screenshot({path:testInfo.outputPath('native-parking-layer.png')});
  expect(await page.evaluate(()=>({center:map.getCenter().toString(),level:map.getLevel(),key:selectedGroupKey,
    count:overlays.reduce((sum,overlay)=>sum+overlay.__cluster.items.length,0),data:JSON.stringify(allItems)}))).toEqual(await page.evaluate(()=>parkingNativeBefore));
  await page.locator('#mapParkingBtnV1').click();await expect(page.locator('.parking-pin-v1')).toHaveCount(0);
  await expect(page.locator('#map .circle-marker')).toHaveCount(1);
  expect(boundary.errors).toEqual([]);expect(boundary.forbidden).toEqual([]);
});

test('sale-only satellite and cadastral views use the real SDK and restore the lease map',async({page},testInfo)=>{
  test.setTimeout(60000);
  const boundary=await startFullApplication(page);
  await expect(page.locator('#map .circle-marker')).toHaveCount(1);
  const saleDetail={scope:'land',landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'중로한면',parcelShape:'장방형',descriptionText:'검수용 가상 광고입니다. 실제 운영 매물이 아닙니다.'};
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({json:{ok:true,originals:[{propertyId:'FIXTURE-NATIVE-LAND',originalId:'FIXTURE-NATIVE-LAND-ORIGINAL',source:'직접등록',buildingName:'검수용 가상 토지',address:'대전 서구 탄방동 1',tradeType:'sale',saleCategory:'land',salePrice:30000,saleDetails:saleDetail,images:[],photoCount:0}]}}):route.fallback());
  await page.evaluate(detail=>{
    const sale={...allItems[0],propertyId:'FIXTURE-NATIVE-LAND',key:'native-land',name:'검수용 가상 토지',room:'',type:'토지',source:'직접등록',tradeType:'sale',saleCategory:'land',salePrice:30000,saleDetails:detail};
    allItems.push(sale);JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{'FIXTURE-NATIVE-LAND':[{...sale,originalId:'FIXTURE-NATIVE-LAND-ORIGINAL',buildingName:sale.name}]}});applyFilter();
    window.saleBusinessSnapshotV3=()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.key,i.address,i.tradeType,i.saleCategory,i.salePrice,i.deposit,i.rent]));
  },saleDetail);
  const before=await page.evaluate(()=>({type:map.getMapTypeId(),center:map.getCenter().toString(),level:map.getLevel(),data:saleBusinessSnapshotV3()}));
  await page.locator('#listingTradeModeSelectV1').selectOption('land_sale');
  await expect(page.locator('#saleMapViewsV3')).toBeVisible();
  const listingBefore=await page.evaluate(()=>({center:map.getCenter().toString(),level:map.getLevel(),ids:overlays.map(o=>o.__cluster.key),data:saleBusinessSnapshotV3()}));
  await page.locator('[data-sale-map-view="satellite"]').click();
  expect(await page.evaluate(()=>map.getMapTypeId()===kakao.maps.MapTypeId.HYBRID)).toBe(true);
  await page.locator('[data-sale-map-view="district"]').click();
  await expect(page.locator('[data-sale-map-note]')).toBeVisible();
  await page.evaluate(()=>{
    window.terrainNativeCallsV11=[];const add=map.addOverlayMapTypeId,remove=map.removeOverlayMapTypeId;
    map.addOverlayMapTypeId=function(type){if(type===kakao.maps.MapTypeId.TERRAIN)terrainNativeCallsV11.push('add');return add.call(this,type);};
    map.removeOverlayMapTypeId=function(type){if(type===kakao.maps.MapTypeId.TERRAIN)terrainNativeCallsV11.push('remove');return remove.call(this,type);};
  });
  await page.locator('[data-sale-map-view="terrain"]').click();
  await expect(page.locator('[data-sale-map-view="terrain"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-sale-terrain-note]')).toBeVisible();
  expect(await page.evaluate(()=>({center:map.getCenter().toString(),level:map.getLevel(),ids:overlays.map(o=>o.__cluster.key),data:saleBusinessSnapshotV3()}))).toEqual(listingBefore);
  await page.screenshot({path:testInfo.outputPath('sale-satellite-cadastral-native.png')});
  await page.evaluate(()=>JSMapListPanelV1.open());
  const viewRect=await page.locator('#saleMapViewsV3').boundingBox(),mapRect=await page.locator('#map').boundingBox();
  expect(viewRect.x+viewRect.width).toBeLessThanOrEqual(mapRect.x+mapRect.width+1);
  await page.locator('#list .item-building-name').click();
  await expect(page.locator('.sale-dossier-nav-v3')).toBeVisible();
  await expect(page.locator('#unifiedDetailBodyV8')).not.toContainText('원본 최신 조회에 실패');
  await page.screenshot({path:testInfo.outputPath('sale-dossier-native-preview.png'),animations:'disabled'});
  await page.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await page.locator('#listingTradeModeSelectV1').selectOption('lease');
  await expect(page.locator('#saleMapViewsV3')).toBeHidden();
  expect(await page.evaluate(()=>terrainNativeCallsV11)).toEqual(['add','remove']);
  expect(await page.evaluate(()=>({type:map.getMapTypeId(),center:map.getCenter().toString(),level:map.getLevel(),data:saleBusinessSnapshotV3()}))).toEqual(before);
  expect(boundary.errors).toEqual([]);expect(boundary.forbidden).toEqual([]);
});

test('building sale cards, sorting and comparison work with the production shell and real SDK',async({page},testInfo)=>{
  const boundary=await startFullApplication(page);
  await page.evaluate(()=>{
    const items=[100,200,0].map((income,n)=>({...allItems[0],propertyId:'FIXTURE-NATIVE-BUILDING-'+n,key:'native-building-'+n,name:'검수용 가상 건물 '+(n+1),room:'전체',type:'건물',source:'직접등록',tradeType:'sale',saleCategory:'building',salePrice:50000+n*1000,
      saleDetails:{landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:5000,monthlyIncome:income,buildingUse:'제2종근린생활시설'}}));
    allItems.push(...items);JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(items.map(item=>[item.propertyId,[{...item,originalId:item.propertyId+'-ORIGINAL',buildingName:item.name,photoCount:0,images:[]}]]))});
    window.buildingDataBeforeV5=JSON.stringify(allItems);
    window.buildingBusinessSnapshotV5=()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.key,i.address,i.latitude,i.longitude,i.tradeType,i.saleCategory,i.salePrice,i.deposit,i.rent,i.area,i.room,i.memo,i.source,i.saleDetails]));
    window.buildingBusinessBeforeV5=buildingBusinessSnapshotV5();applyFilter();
  });
  await page.locator('#listingTradeModeSelectV1').selectOption('building_sale');
  await page.evaluate(()=>JSMapListPanelV1.open());
  await page.locator('#sortDropdownBtn').click();
  await page.getByText('단순 수익률 높은순',{exact:true}).click();
  await expect(page.locator('#list .listing-building-card-v5')).toHaveCount(3);
  await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id','FIXTURE-NATIVE-BUILDING-1');
  await page.screenshot({path:testInfo.outputPath('building-sale-native-v5.png'),animations:'disabled'});
  await page.locator('#list [data-property-id="FIXTURE-NATIVE-BUILDING-1"] .action-select-check').check();
  await page.locator('#list [data-property-id="FIXTURE-NATIVE-BUILDING-0"] .action-select-check').check();
  await page.locator('#saleComparisonTrayV5 [data-sale-compare]').click();
  await expect(page.locator('.sale-comparison-dialog-v2 .sale-compare-different-v5')).not.toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('building-comparison-native-v5.png'),animations:'disabled'});
  const changedFields=await page.evaluate(()=>{
    const before=JSON.parse(window.buildingDataBeforeV5);
    return allItems.flatMap((item,n)=>Object.keys(item).filter(key=>JSON.stringify(item[key])!==JSON.stringify(before[n][key])));
  });
  await testInfo.attach('display-cache-fields',{body:JSON.stringify([...new Set(changedFields)]),contentType:'application/json'});
  expect(await page.evaluate(()=>buildingBusinessSnapshotV5()===window.buildingBusinessBeforeV5)).toBe(true);
  expect(boundary.errors).toEqual([]);expect(boundary.forbidden).toEqual([]);
});

test("old CSP reproduces the post-login blank map and zero listings when the current Kakao SDK changes CDN",async({page},testInfo)=>{
  test.setTimeout(45000);
  const boundary=await startFullApplication(page,{oldCsp:true});
  await expect.poll(()=>page.evaluate(()=>window.__startupCspViolations.some(entry=>entry.directive==="script-src-elem" && entry.uri.startsWith("https://t1.kakaocdn.net/")))).toBe(true);
  await expect(page.locator("#mapQuickTools")).toBeVisible();
  await expect(page.locator("#list .item")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("전체 매물 한 번에 준비 중");
  expect(await page.evaluate(()=>typeof window.map)).toBe("undefined");
  await expect(page.locator('#map img[src*="/tile/"]')).toHaveCount(0);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
  await page.screenshot({path:testInfo.outputPath("old-csp-blank-map.png")});
});

test("current production CSP permits full authenticated startup, live Kakao map and fixture listings",async({page},testInfo)=>{
  test.setTimeout(45000);
  const boundary=await startFullApplication(page);
  await expect(page.locator("#list .item")).toHaveCount(1,{timeout:20000});
  await expect(page.locator("#status")).toHaveText(/^(?:매물 1개 불러옴|검색 결과 1개|현재 지도 매물 1개)$/);
  await expect(page.locator("#map .circle-marker")).toHaveCount(1);
  await expect.poll(()=>page.locator('#map img[src*="/tile/"]').evaluateAll(images=>images.filter(img=>img.complete && img.naturalWidth>0).length),{timeout:20000}).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.getElementById("mapFieldModeToggleV1"))).toBeNull();
  expect(await page.evaluate(()=>typeof window.map.getCenter)).toBe("function");
  await page.locator('#map .circle-marker').click();
  // The real map's existing 120ms idle refresh rebuilds the selected list once.
  // Wait for that normal startup/selection refresh before measuring hover.
  await page.waitForTimeout(500);
  const hoverBefore=await page.evaluate(()=>({center:map.getCenter().toString(),level:map.getLevel(),
    key:selectedGroupKey,item:selectedItemKey,scroll:document.getElementById('sidebar').scrollTop}));
  await page.locator('#list .item .item-building-name').first().hover();
  await expect(page.locator('#map .js-listing-hover-pin-v1')).toHaveCount(1);
  const hoverLocation=await page.locator('#map .js-listing-hover-pin-v1').evaluate(el=>{
    const box=el.getBoundingClientRect(),host=document.getElementById('map').getBoundingClientRect();
    const expected=map.getProjection().containerPointFromCoords(visibleListItems[0].latlng);
    return {dx:box.x+box.width/2-host.x-expected.x,dy:box.bottom-host.y-expected.y,
      events:getComputedStyle(el.parentElement).pointerEvents};
  });
  expect(Math.abs(hoverLocation.dx)).toBeLessThan(2);expect(Math.abs(hoverLocation.dy)).toBeLessThan(2);
  expect(hoverLocation.events).toBe('none');
  expect(await page.evaluate(()=>({center:map.getCenter().toString(),level:map.getLevel(),
    key:selectedGroupKey,item:selectedItemKey,scroll:document.getElementById('sidebar').scrollTop}))).toEqual(hoverBefore);
  await page.screenshot({path:testInfo.outputPath('native-map-list-hover.png')});
  await expect(page.locator('#map .js-listing-hover-pin-v1')).toHaveCount(1);
  await page.mouse.move(10,65);await expect(page.locator('#map .js-listing-hover-pin-v1')).toHaveCount(0);
  const clusterReuse=await page.evaluate(()=>{
    window.nativeOverlayBeforeV1=overlays[0];window.nativeElementBeforeV1=document.querySelector('#map .circle-marker');
    const identity=JSON.stringify(jsLastRenderedItemsV639);
    for(let i=0;i<5;i++)drawMapClustersOnlyV639(jsLastRenderedItemsV639);
    return {overlay:overlays[0]===nativeOverlayBeforeV1,element:document.querySelector('#map .circle-marker')===nativeElementBeforeV1,
      unchanged:JSON.stringify(jsLastRenderedItemsV639)===identity};
  });
  expect(clusterReuse).toEqual({overlay:true,element:true,unchanged:true});
  await page.evaluate(()=>{
    const center=map.getCenter();map.setCenter(new kakao.maps.LatLng(center.getLat()+.0001,center.getLng()));
  });
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>overlays[0]===nativeOverlayBeforeV1&&document.querySelector('#map .circle-marker')===nativeElementBeforeV1)).toBe(true);
  await page.evaluate(()=>map.setLevel(6));
  await expect.poll(()=>page.evaluate(()=>overlays.map(o=>o.__cluster.key))).toEqual([expect.stringMatching(/^world-grid:/)]);
  expect(await page.evaluate(()=>overlays.reduce((sum,o)=>sum+o.__cluster.items.length,0))).toBe(1);
  await page.evaluate(()=>map.setLevel(7));
  await expect.poll(()=>page.evaluate(()=>overlays.map(o=>o.__cluster.regionMode))).toEqual(['neighborhood']);
  await expect(page.locator('#map .circle-marker')).toContainText('탄방동');
  expect(await page.evaluate(()=>overlays.reduce((sum,o)=>sum+o.__cluster.items.length,0))).toBe(1);
  // The SDK still catches eval("document.namespaces") as an old IE feature
  // probe. Keep unsafe-eval blocked; only that SDK's handled eval probe is
  // tolerated. No application script, SDK resource or tile may be blocked.
  const violations=await page.evaluate(()=>window.__startupCspViolations);
  expect(violations.filter(entry=>!(entry.uri==="eval" && /^https:\/\/t1\.(?:kakaocdn\.net|daumcdn\.net)\/mapjsapi\/js\/main\/[^/]+\/kakao\.js$/.test(entry.source)))).toEqual([]);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
  await page.screenshot({path:testInfo.outputPath("fixed-csp-full-startup.png")});
});
