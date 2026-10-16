import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const source=await readFile(new URL("../../js/map.js",import.meta.url),"utf8");
const ast=ts.createSourceFile("map.js",source,ts.ScriptTarget.Latest,true);
const names=new Set(["isAdministrativeClusterSelectedV1","setAdministrativeListSelectionV6570","clearAdministrativeListSelectionV6570","getAdministrativeListStatusV6570","getPremiumClusterSizeClassV635","buildClusterOverlayContentV655","getCustomerMatchClusterClassV764","getFieldVisitClusterClassV684","redrawSelectedMarkers","openAdministrativeClusterV655","clearPinnedClusterSelectionV6515"]);
const runtime=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join("\n");
test.beforeEach(async ({context})=>context.route("**/*",r=>new URL(r.request().url()).hostname==="127.0.0.1"?r.continue():r.abort()));

test("clicked region stays distinct through redraw, switching, and reset without mutating listings",async({page,context,isMobile},info)=>{
  const writes=[];
  page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/")&&r.method()!=="GET")writes.push(r.method());});
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
  await page.locator("#fixtureControls").evaluate(el=>el.hidden=true);
  await page.addScriptTag({content:runtime});
  await page.evaluate(()=>{
    document.documentElement.classList.add("js-world-grid-clusters-v690");
    window.jsAdministrativeListSelectionV6570=null;
    window.jsClusterSelectionMemoryV638={singleItemIds:[],multiItemIdGroups:[]};
    window.closeOpenListingDetailsForMapSelectionV6525=()=>{};
    const host=document.getElementById("map");
    window.adminSelectionFixture={changes:0,clusters:[
      {key:"서구:괴정동",regionMode:"neighborhood",regionLabel:"괴정동",districtLabel:"서구",items:[allItems[0]]},
      {key:"서구:탄방동",regionMode:"neighborhood",regionLabel:"탄방동",districtLabel:"서구",items:[allItems[1]]},
      {key:"유성구:괴정동",regionMode:"neighborhood",regionLabel:"괴정동",districtLabel:"유성구",items:[allItems[2]]}
    ]};
    window.paintAdminSelectionFixture=()=>{
      host.querySelectorAll(".admin-test-host").forEach(el=>el.remove());
      window.overlays=adminSelectionFixture.clusters.map((cluster,index)=>{
        const el=document.createElement("div");el.className="admin-test-host";
        el.style.cssText="position:absolute;top:210px;left:"+(20+index*115)+"px";
        host.appendChild(el);
        const content=buildClusterOverlayContentV655(cluster,"");el.innerHTML=content;
        return {__cluster:cluster,__adminRegionContentV1:content,
          setContent(value){el.innerHTML=value;adminSelectionFixture.changes++;},setZIndex(value){el.style.zIndex=value;}};
      });
      redrawSelectedMarkers();
    };
    paintAdminSelectionFixture();
  });
  const regions=page.locator(".admin-test-host button");
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  await regions.nth(0).click();
  await expect(regions.nth(0)).toHaveAttribute("aria-pressed","true");
  await expect(regions.nth(0)).toHaveCSS("background-color","rgb(5, 104, 232)");
  await expect(regions.nth(0).locator("strong")).toHaveCSS("color","rgb(255, 255, 255)");
  await expect(page.locator(".admin-region-selection-badge-v1")).toHaveCount(0);
  await expect(regions.nth(2)).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#list .item")).toHaveCount(1);
  const changes=await page.evaluate(()=>adminSelectionFixture.changes);
  await page.evaluate(()=>redrawSelectedMarkers());
  expect(await page.evaluate(()=>adminSelectionFixture.changes)).toBe(changes,"unchanged regions retain their DOM");
  await page.evaluate(()=>paintAdminSelectionFixture());
  await expect(regions.nth(0)).toHaveAttribute("aria-pressed","true");
  if(isMobile) await page.locator('[data-mobile-view="map"]').click();
  await regions.nth(1).click();
  await expect(regions.nth(0)).toHaveAttribute("aria-pressed","false");
  await expect(regions.nth(1)).toHaveAttribute("aria-pressed","true");
  await expect(page.locator('.admin-test-host [aria-pressed="true"]')).toHaveCount(1);
  if(isMobile) {
    const session=await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride",{width:930,height:530,screenWidth:1100,screenHeight:720,mobile:true,deviceScaleFactor:1,screenOrientation:{type:"landscapePrimary",angle:90}});
    await expect(page.locator("html")).toHaveClass(/js-landscape-desktop-fit-v1/);
    await expect(regions.nth(1)).toHaveCSS("background-color","rgb(5, 104, 232)");
    await expect(regions.nth(1)).toBeVisible();
  }
  if(!isMobile) await page.screenshot({path:info.outputPath("selected-dong.png")});
  await page.evaluate(()=>clearAdministrativeListSelectionV6570());
  await expect(page.locator('.admin-test-host [aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(".admin-region-selection-badge-v1")).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  expect(writes).toEqual([]);
});
