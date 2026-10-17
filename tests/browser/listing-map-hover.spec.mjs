import {test, expect} from '@playwright/test';

async function prepare(page, context) {
  const errors=[], requests=[];
  page.on('pageerror', e=>errors.push(e.message));
  await context.route('**/*', route=>{
    const request=route.request(), url=new URL(request.url());
    requests.push({path:url.pathname,method:request.method()});
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#fixtureControls').evaluate(el=>el.hidden=true);
  await page.evaluate(()=>{
    const host=document.getElementById('map');
    host.style.background='repeating-linear-gradient(0deg,#f3f8fb,#f3f8fb 59px,#d6e4ed 60px)';
    window.hoverAudit={created:0,pans:0,zooms:0,layouts:0,positions:[]};
    function LatLng(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}
    window.map={getBounds:()=>({contain:p=>p.getLat()>36.3&&p.getLat()<36.4&&p.getLng()>127.3&&p.getLng()<127.5}),
      getCenter:()=>({lat:36.35,lng:127.38}),getLevel:()=>6,
      setCenter(){hoverAudit.pans++;},panTo(){hoverAudit.pans++;},setLevel(){hoverAudit.zooms++;},relayout(){hoverAudit.layouts++;}};
    window.kakao={maps:{LatLng,CustomOverlay:class{
      constructor(options){hoverAudit.created++;this.wrapper=document.createElement('div');
        this.wrapper.style.cssText='position:absolute;transform:translate(-50%,-50%);z-index:'+options.zIndex;
        this.wrapper.append(options.content);}
      setPosition(p){hoverAudit.positions.push([p.getLat(),p.getLng()]);
        this.wrapper.style.left=(220+(p.getLng()-127.38)*100000)+'px';this.wrapper.style.top='280px';}
      setMap(target){if(target)host.append(this.wrapper);else this.wrapper.remove();}
    }}};
    // Existing detail prefetch is separate from the new coordinate-only preview.
    JSUnifiedListingsV8.prefetch=()=>{};
    allItems=allItems.map((item,i)=>({...item,latlng:new LatLng(36.3504,127.38+i*.002)}));
    showList(allItems);
    selectedGroupKey='clicked-cluster';selectedItemKey='clicked-item';selectedListCardIdV845='clicked-card';
    document.getElementById('maxRent').value='130';
  });
  await page.waitForTimeout(30);
  return {errors, requests};
}

async function state(page){return page.evaluate(()=>({
  key:selectedGroupKey,item:selectedItemKey,card:selectedListCardIdV845,prints:selectedPrintKeys.slice(),
  filter:document.getElementById('maxRent').value,scroll:document.getElementById('sidebar').scrollTop,
  center:map.getCenter(),level:map.getLevel(),data:JSON.stringify(allItems)
}));}

test('desktop hover reuses one exact-location overlay and preserves selection, viewport, list, filters and data',async({page,context,isMobile},info)=>{
  test.skip(isMobile,'Real mouse hover is desktop-only');
  const h=await prepare(page,context), before=await state(page), requests=h.requests.length;
  const first=page.locator('#list .item').nth(0),second=page.locator('#list .item').nth(1);
  await first.locator('.item-building-name').hover();
  await expect(page.locator('.js-listing-hover-pin-v1')).toHaveCount(1);
  await expect(page.locator('.js-listing-hover-pin-v1')).toHaveCSS('pointer-events','none');
  await expect(page.locator('.js-listing-hover-pin-v1').locator('..')).toHaveCSS('pointer-events','none');
  await first.locator('.item-roadview-btn').hover();
  await second.locator('.item-building-name').hover();
  expect(await state(page)).toEqual(before);
  expect(await page.evaluate(()=>hoverAudit)).toEqual({created:1,pans:0,zooms:0,layouts:0,
    positions:[[36.3504,127.38],[36.3504,127.38+.002]]});
  // The existing idle startup may warm the Naver roadview SDK independently.
  expect(h.requests.slice(requests).filter(r=>r.path!=='/api/naver-maps-config'||r.method!=='GET')).toEqual([]);
  await page.screenshot({path:info.outputPath('desktop-hover-and-tool-groups.png')});
  await page.mouse.move(10,65);await expect(page.locator('.js-listing-hover-pin-v1')).toHaveCount(0);
  expect(h.errors).toEqual([]);
});

test('hover clears on scrolling, card replacement, pointer press, panel close and leaving the window',async({page,context,isMobile})=>{
  test.skip(isMobile,'Desktop cleanup paths');
  const h=await prepare(page,context),name=page.locator('#list .item .item-building-name').first();
  for(const action of ['scroll','replace','pointerdown','blur','close']){
    await page.mouse.move(10,65);await name.hover();
    await expect(page.locator('.js-listing-hover-pin-v1')).toHaveCount(1);
    await page.evaluate(action=>{
      if(action==='scroll')document.getElementById('sidebar').dispatchEvent(new Event('scroll'));
      if(action==='replace')showList(visibleListItems);
      if(action==='pointerdown')document.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse'}));
      if(action==='blur')window.dispatchEvent(new Event('blur'));
      if(action==='close')JSMapListPanelV1.close();
    },action);
    await expect(page.locator('.js-listing-hover-pin-v1'),action).toHaveCount(0);
  }
  expect(h.errors).toEqual([]);
});

test('offscreen, missing and recycled mismatched coordinates never trigger preview or map movement',async({page,context,isMobile})=>{
  test.skip(isMobile,'Desktop boundary cases');
  const h=await prepare(page,context);
  for(const reason of ['offscreen','missing','mismatch']){
    await page.evaluate(reason=>{
      if(reason==='offscreen')visibleListItems[0].latlng=new kakao.maps.LatLng(37.5,127.38);
      if(reason==='missing')visibleListItems[0].latlng=null;
      if(reason==='mismatch')document.querySelector('#list .item').setAttribute('data-listing-key','stale-row');
    },reason);
    await page.mouse.move(10,65);await page.locator('#list .item').first().hover();
    await expect(page.locator('.js-listing-hover-pin-v1')).toHaveCount(0);
  }
  expect(await page.evaluate(()=>hoverAudit)).toEqual({created:0,pans:0,zooms:0,layouts:0,positions:[]});
  expect(h.errors).toEqual([]);
});

test('touch and pen do not enable hover, including a fitted handheld landscape',async({page,context,isMobile})=>{
  const h=await prepare(page,context);
  if(isMobile){
    await page.setViewportSize({width:930,height:530});
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:930,height:530,screenWidth:1100,screenHeight:720,
      mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
    await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  }
  for(const pointerType of isMobile?['touch','pen','mouse']:['touch','pen']){
    await page.locator('#list .item').first().dispatchEvent('pointermove',{pointerType,bubbles:true});
    await expect(page.locator('.js-listing-hover-pin-v1')).toHaveCount(0);
  }
  expect(await page.evaluate(()=>hoverAudit.created)).toBe(0);expect(h.errors).toEqual([]);
});

test('two subtle separators preserve toolbar order and all measurement controls on desktop and fitted landscape',async({page,context,isMobile},info)=>{
  const h=await prepare(page,context);
  if(isMobile){
    await page.setViewportSize({width:930,height:530});
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:930,height:530,screenWidth:1100,screenHeight:720,
      mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
    await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  }
  const lines=page.locator('.map-quick-group-divider-v1');await expect(lines).toHaveCount(2);
  for(const line of await lines.all())await expect(line).toBeVisible();
  const order=await page.locator('.map-quick-tools-inner').evaluate(el=>[...el.children].map(child=>
    child.classList.contains('map-quick-group-divider-v1')?'separator':child.id||child.querySelector('button')?.id).filter(Boolean));
  expect(order.slice(0,9)).toEqual(['mapQuickViewBtn','mapRoadviewSelectBtn','separator','mapQuickListBtn',
    'multiClusterBtn','separator','mapDistanceBtn','mapRadiusBtn','mapPolygonBtn']);
  for(const id of ['mapQuickViewBtn','mapRoadviewSelectBtn','mapQuickListBtn','multiClusterBtn','mapDistanceBtn','mapRadiusBtn','mapPolygonBtn'])
    await expect(page.locator('#'+id)).toBeInViewport();
  await page.screenshot({path:info.outputPath(isMobile?'landscape-tool-groups.png':'desktop-tool-groups.png')});
  expect(h.errors).toEqual([]);
});
