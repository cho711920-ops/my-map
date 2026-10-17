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
    if(request.method()==="GET" && sdkHosts.has(target.hostname))return route.continue();
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
    return {dx:box.x+box.width/2-host.x-expected.x,dy:box.y+box.height/2-host.y-expected.y,
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
