import {test, expect} from "@playwright/test";
import {readFile,writeFile} from "node:fs/promises";

// Run complete production HTML + authentication loader + real Kakao SDK, not
// the normal UI fixture's synthetic map. The registered origin document and
// every app asset/API response are fulfilled locally; no production account,
// listing data, cookies or writes are used. Only public SDK/tile GETs pass.
const sdkHosts=new Set(["dapi.kakao.com","t1.kakaocdn.net","mts.kakaocdn.net","t1.daumcdn.net","t2.daumcdn.net","t3.daumcdn.net","t4.daumcdn.net","mts.daumcdn.net","map.daumcdn.net","map0.daumcdn.net","map1.daumcdn.net","map2.daumcdn.net","map3.daumcdn.net","map4.daumcdn.net"]);
const url="https://js-map.com/__startup-csp-fixture";

test.beforeEach(({isMobile},testInfo)=>{
  test.skip(process.env.JS_FIELD_REAL_SDK!=="1","Set JS_FIELD_REAL_SDK=1 to verify the current public Kakao SDK against production CSP.");
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
    const json=body=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    if(request.method()==="GET" && sdkHosts.has(target.hostname))return route.continue();
    // Do not make an unrelated external font dependency part of map startup.
    if(target.hostname==="cdn.jsdelivr.net")return route.fulfill({status:200,contentType:"text/css",body:""});
    if(target.hostname!=="js-map.com"){forbidden.push(target.hostname+target.pathname);return route.abort();}
    if(target.href===url)return route.fulfill({status:200,headers:{"Content-Security-Policy":csp},contentType:"text/html; charset=utf-8",body:index});
    if(target.pathname==="/api/session")return json({ok:true,email:"startup-fixture@example.invalid",role:"owner"});
    if(target.pathname==="/api/sheet")return route.fulfill({status:200,contentType:"text/csv",body:csv});
    if(target.pathname.startsWith("/api/")){
      const action=target.searchParams.get("action") || request.postDataJSON()?.action;
      if(action==="unifiedListings")return json({ok:true,groups:{},sourceSearchIds:{}});
      if(action==="loadCloudState")return json({ok:true,found:true,version:1,data:[],deletedIds:{}});
      if(action==="listingsRevision")return json({ok:true,revision:"fixture-boot-1"});
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
  await expect(page.locator("#status")).toHaveText("매물 1개 불러옴");
  await expect(page.locator("#map .circle-marker")).toHaveCount(1);
  await expect.poll(()=>page.locator('#map img[src*="/tile/"]').evaluateAll(images=>images.filter(img=>img.complete && img.naturalWidth>0).length),{timeout:20000}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>!!window.JSFieldMapCameraV1)).toBe(true);
  expect(await page.evaluate(()=>typeof window.map.getCenter)).toBe("function");
  // The SDK still catches eval("document.namespaces") as an old IE feature
  // probe. Keep unsafe-eval blocked; only that SDK's handled eval probe is
  // tolerated. No application script, SDK resource or tile may be blocked.
  const violations=await page.evaluate(()=>window.__startupCspViolations);
  expect(violations.filter(entry=>!(entry.uri==="eval" && /^https:\/\/t1\.(?:kakaocdn\.net|daumcdn\.net)\/mapjsapi\/js\/main\/[^/]+\/kakao\.js$/.test(entry.source)))).toEqual([]);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
  await page.screenshot({path:testInfo.outputPath("fixed-csp-full-startup.png")});
});

test("full production loader and real Kakao cycle 20/30m cards, 50m clusters and long-press OFF",async({page},testInfo)=>{
  test.setTimeout(45000);
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,"geolocation",{configurable:true,value:{
      watchPosition(success){window.__fieldGpsSuccess=success;return 123;}, clearWatch(){},
      getCurrentPosition(success){success({coords:{latitude:36.3504,longitude:127.3841,accuracy:5,speed:0},timestamp:Date.now()});}
    }});
  });
  const boundary=await startFullApplication(page);
  await expect(page.locator("#list .item")).toHaveCount(1,{timeout:20000});
  await expect.poll(()=>page.evaluate(()=>!!window.JSFieldModeV1 && !!window.JSFieldLeaseCardsV1)).toBe(true);
  const toggle=page.locator("#mapFieldModeToggleV1");
  const panel=page.locator("#mapFieldModeControlsV1");
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.JSFieldModeV1.state().scale)).toBe(20);
  await page.evaluate(()=>{
    window.__fieldGpsSuccess({coords:{latitude:36.3504,longitude:127.3841,accuracy:5,heading:90,speed:3},timestamp:Date.now()});
  });
  await expect.poll(()=>page.evaluate(()=>window.map.getLevel())).toBe(1);
  await toggle.click();
  await expect.poll(()=>page.evaluate(()=>window.map.getLevel())).toBe(2);
  const card=page.locator("#map .field-lease-card-v1");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".field-lease-top-v1")).toHaveText("1층 · 25평");
  await expect(card.locator(".field-lease-price-v1")).toHaveText("보 2,000 / 월 90");
  await expect(card).toHaveCSS("rotate","90deg");
  await expect(page.locator("#map .circle-marker")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("live-sdk-field-lease-30m.png")});
  await toggle.click();
  await expect.poll(()=>page.evaluate(()=>window.map.getLevel())).toBe(3);
  await expect(card).toHaveCount(0);
  await expect(page.locator("#map .circle-marker")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-pressed","true");
  await toggle.click();
  await expect.poll(()=>page.evaluate(()=>window.map.getLevel())).toBe(1);
  await expect(card).toHaveCount(1);
  await toggle.click({delay:3100});
  await expect(toggle).toHaveAttribute("aria-pressed","false");
  await expect(card).toHaveCount(0);
  await expect(page.locator("#map .circle-marker")).toHaveCount(1);
  expect(await page.evaluate(()=>window.allItems.length)).toBe(1);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
});

test("full production loader and real Kakao preserve tablet portrait/landscape field mode",async({page},testInfo)=>{
  test.setTimeout(60000);
  const session=await page.context().newCDPSession(page);
  // Keep the viewport dimensions aligned with the physical CDP screen.
  await page.setViewportSize({width:820,height:1180});
  await session.send("Emulation.setDeviceMetricsOverride",{
    width:820,height:1180,screenWidth:820,screenHeight:1180,mobile:true,deviceScaleFactor:1,
    screenOrientation:{type:"portraitPrimary",angle:0}
  });
  await session.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,"userAgent",{configurable:true,value:"Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"});
    Object.defineProperty(navigator,"platform",{configurable:true,value:"Linux armv8l"});
    Object.defineProperty(navigator,"maxTouchPoints",{configurable:true,value:5});
    Object.defineProperty(navigator,"userAgentData",{configurable:true,value:{mobile:false,platform:"Android"}});
    window.__tabletFieldGps={watchCalls:0,clearCalls:0,active:[]};
    Object.defineProperty(navigator,"geolocation",{configurable:true,value:{
      watchPosition(success){
        const state=window.__tabletFieldGps,id=++state.watchCalls;
        state.active.push(id);window.__fieldGpsSuccess=success;return id;
      },
      clearWatch(id){const state=window.__tabletFieldGps;state.clearCalls++;state.active=state.active.filter(value=>value!==id);},
      getCurrentPosition(success){success({coords:{latitude:36.3504,longitude:127.3841,accuracy:5,speed:0},timestamp:Date.now()});}
    }});
  });
  const boundary=await startFullApplication(page);
  await expect(page.locator("#list .item")).toHaveCount(1,{timeout:20000});
  await expect.poll(()=>page.evaluate(()=>!!window.JSFieldModeV1 && !!window.JSFieldLeaseCardsV1 && !!window.JSFieldMapCameraV1)).toBe(true);
  const compact=page.locator("#mapFieldModeCompactToggleV1");
  const main=page.locator("#mapFieldModeToggleV1");
  const card=page.locator("#map .field-lease-card-v1");
  await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
  await expect(page.locator("html")).not.toHaveClass(/js-handheld-landscape-v1/);
  await expect(compact).toBeVisible();
  await expect(main).toBeHidden();
  expect(await page.evaluate(()=>({phone:JSPhoneDeviceV1.isPhone(),handheld:JSPhoneDeviceV1.isHandheld(),mobile:JSPhoneDeviceV1.isMobileLayout()}))).toEqual({phone:false,handheld:true,mobile:true});
  await compact.click();
  await expect.poll(()=>page.evaluate(()=>JSFieldModeV1.state().scale)).toBe(20);
  await expect(compact).toHaveAttribute("aria-pressed","true");
  await expect(page.locator("#mapFieldModeCompactControlsV1")).toBeHidden();
  await compact.click();
  await expect.poll(()=>page.evaluate(()=>JSFieldModeV1.state().scale)).toBe(30);
  await page.evaluate(()=>window.__fieldGpsSuccess({coords:{latitude:36.3504,longitude:127.3841,accuracy:5,heading:90,speed:3},timestamp:Date.now()}));

  async function expectPreservedFieldMode(){
    await expect.poll(()=>page.evaluate(()=>({enabled:JSFieldModeV1.state().enabled,scale:JSFieldModeV1.state().scale,level:map.getLevel()}))).toEqual({enabled:true,scale:30,level:2});
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(card.locator(".field-lease-top-v1")).toHaveText("1층 · 25평");
    await expect(card.locator(".field-lease-price-v1")).toHaveText("보 2,000 / 월 90");
    await expect(card).toHaveCSS("rotate","90deg");
    await expect(page.locator("#map .circle-marker")).toHaveCount(0);
    await expect.poll(()=>page.locator('#map img[src*="/tile/"]').evaluateAll(images=>images.filter(img=>img.complete && img.naturalWidth>0).length),{timeout:20000}).toBeGreaterThan(0);
    expect(await page.evaluate(()=>window.__tabletFieldGps)).toEqual({watchCalls:1,clearCalls:0,active:[1]});
    expect(await page.evaluate(()=>({body:document.body.inert,wrap:document.getElementById("wrap").inert}))).toEqual({body:false,wrap:false});
    await expect(page.locator("#jsPhonePortraitGuardV2")).toBeHidden();
    expect(await page.evaluate(()=>window.allItems.length)).toBe(1);
  }
  async function capturePhysicalScreen(name){
    // page.screenshot() restores desktop-project ScreenOrientation during its
    // capture, causing a false rotation. Native CDP capture leaves it intact.
    const {data}=await session.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
    await writeFile(testInfo.outputPath(name),Buffer.from(data,"base64"));
  }
  await expectPreservedFieldMode();
  await expect(compact.locator(".map-field-mode-indicator-v1")).toHaveText("30m");
  await capturePhysicalScreen("live-sdk-tablet-portrait-field-30m.png");
  await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);

  await page.setViewportSize({width:1280,height:800});
  await session.send("Emulation.setDeviceMetricsOverride",{
    width:1280,height:800,screenWidth:1280,screenHeight:800,mobile:true,deviceScaleFactor:1,
    screenOrientation:{type:"landscapePrimary",angle:90}
  });
  await expect(page.locator("html")).toHaveClass(/js-handheld-landscape-v1/);
  await expect(page.locator("html")).not.toHaveClass(/js-phone-app-v2|js-mobile-app-v1/);
  await expect(compact).toBeHidden();
  await expect(main).toBeVisible();
  await expect(main).toHaveAttribute("aria-pressed","true");
  await expect(main.locator(".map-field-mode-indicator-v1")).toHaveText("30m");
  await expectPreservedFieldMode();
  await capturePhysicalScreen("live-sdk-tablet-landscape-field-30m.png");

  await page.setViewportSize({width:820,height:1180});
  await session.send("Emulation.setDeviceMetricsOverride",{
    width:820,height:1180,screenWidth:820,screenHeight:1180,mobile:true,deviceScaleFactor:1,
    screenOrientation:{type:"portraitPrimary",angle:0}
  });
  await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
  await expect(page.locator("html")).not.toHaveClass(/js-handheld-landscape-v1/);
  await expect(compact).toBeVisible();
  await expect(main).toBeHidden();
  await expect(compact.locator(".map-field-mode-indicator-v1")).toHaveText("30m");
  await expectPreservedFieldMode();
  await capturePhysicalScreen("live-sdk-tablet-portrait-return-field-30m.png");
  await expect(page.locator("html")).toHaveClass(/js-phone-app-v2/);
  const violations=await page.evaluate(()=>window.__startupCspViolations);
  expect(violations.filter(entry=>!(entry.uri==="eval" && /^https:\/\/t1\.(?:kakaocdn\.net|daumcdn\.net)\/mapjsapi\/js\/main\/[^/]+\/kakao\.js$/.test(entry.source)))).toEqual([]);
  expect(boundary.errors).toEqual([]);
  expect(boundary.forbidden).toEqual([]);
});
