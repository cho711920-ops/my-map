import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../../js/map.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('map.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['getAddressAdminRegionV655','getAdministrativeClusterModeV655','createAdministrativeClustersV655',
  'createClustersForCurrentZoomV655','getPremiumClusterSizeClassV635','buildClusterOverlayContentV655',
  'isAdministrativeClusterSelectedV1','setAdministrativeListSelectionV6570','getAdministrativeListItemsV6570',
  'getAdministrativeListStatusV6570','openAdministrativeClusterV655']);
const runtime=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');

test('a road-only ad remains visible, resolves to its legal dong and survives selection/filter refresh with its original identity',async({page,context,isMobile})=>{
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
    const r=route.request(),url=new URL(r.url());
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(url.pathname.startsWith('/api/')&&r.method()!=='GET')writes.push(r.method());
    return route.continue();
  });
  await page.goto('/?mapFirst=1');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#fixtureControls').evaluate(el=>el.hidden=true);
  await page.addScriptTag({content:runtime});
  await page.evaluate(()=>{
    const road='대덕구 중리북로 46';
    allItems=[{...allItems[0],address:road}];currentItems=allItems;
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{[allItems[0].propertyId]:[]}});
    window.roadAuditBefore=JSON.stringify(allItems);window.roadAuditCalls=[];
    window.jsAdministrativeListSelectionV6570=null;window.isRendering=false;
    window.map={getLevel:()=>7,getBounds:()=>({contain:()=>true})};window.kakao={maps:{LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;},services:{Status:{OK:'OK'},AnalyzeType:{EXACT:'exact'}}}};
    window.geocoder={addressSearch(query,done){roadAuditCalls.push(query);window.resolveRoadAudit=()=>done([{road_address:{address_name:'대전광역시 '+road},address:{address_name:'대전 대덕구 법동 280-2'}}],'OK');}};
    window.jsLastRenderedItemsV639=allItems;window.shouldUseWorldGridClustersV690=()=>true;
    window.filterClustersToMapViewportV690=rows=>rows;window.resolveAdministrativeClusterPositionsV656=rows=>rows;
    window.createWorldGridClustersV690=groups=>groups.map(g=>({key:'road-pending',worldGrid:true,items:g.items}));
    window.closeOpenListingDetailsForMapSelectionV6525=()=>{};window.clearPinnedClusterSelectionV6515=()=>{};
    window.redrawSelectedMarkers=()=>{};
    window.drawMapClustersOnlyV639=()=>{
      document.querySelectorAll('.road-audit-overlay').forEach(el=>el.remove());
      window.overlays=createClustersForCurrentZoomV655([{address:road,latlng:new kakao.maps.LatLng(36.35,127.4),items:allItems}]).map(cluster=>{
        const host=document.createElement('div');host.className='road-audit-overlay';host.style.cssText='position:absolute;top:240px;left:90px';
        host.innerHTML=buildClusterOverlayContentV655(cluster,'');document.getElementById('map').append(host);return {__cluster:cluster};
      });
    };
    drawMapClustersOnlyV639();showList(allItems);
  });
  await expect(page.locator('.road-audit-overlay .circle-marker')).toHaveText('1');
  expect(await page.evaluate(()=>roadAuditCalls)).toEqual(['대전광역시 대덕구 중리북로 46']);
  await page.evaluate(()=>resolveRoadAudit());
  await expect(page.locator('.road-audit-overlay strong')).toHaveText('법동');
  expect(await page.locator('.road-audit-overlay').textContent()).not.toContain('대덕구');
  await page.locator('.road-audit-overlay button').click();
  await expect(page.locator('#list .item')).toHaveCount(1);
  await expect(page.locator('#mapListTitleV1')).toContainText('법동');
  await page.evaluate(()=>{showList(getAdministrativeListItemsV6570(allItems));});
  await expect(page.locator('#list .item')).toHaveCount(1);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(await page.evaluate(()=>roadAuditBefore));
  // The successful local cache survives a full application reload without an SDK lookup.
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  expect(await page.evaluate(()=>JSMapAddressRegionV1.read('대덕구 중리북로 46'))).toBe('대전 대덕구 법동 280-2');
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});
