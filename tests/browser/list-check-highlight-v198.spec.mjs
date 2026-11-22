import {test,expect} from '@playwright/test';

const card=(page,id)=>page.locator('#list .item[data-property-id="'+id+'"]');
const paint=locator=>locator.evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor}));
const blue={background:'rgb(238, 246, 255)',border:'rgb(5, 104, 232)'};
async function expectNeutral(locator){const p=await paint(locator);expect(p.background).toBe('rgb(255, 255, 255)');expect(p.border).not.toBe(blue.border);}

test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#fixtureControls').evaluate(el=>el.remove());
});

for(const market of ['lease','building_sale','land_sale'])test(market+' checks paint the exact master, not the previously opened same-address card',async({page,isMobile},info)=>{
  await page.evaluate(market=>{
    const base=allItems.find(i=>i.propertyId===(market==='lease'?'FIXTURE-LEASE-1':market==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND'));
    const items=['A','B','C'].map((id,index)=>({...base,key:'same-key-v198',propertyId:'CHECK-V198-'+id,sheetRow:19800+index,
      address:'대전 서구 괴정동 87-65',name:'선택 검사 '+id,room:'1층',area:8.9+index,
      memo:'유지할 수동 메모 '+id,source:'직접등록',unifiedOriginalsV8:[],unifiedAllOriginalsV1:[]}));
    window.allItems=items;window.visibleListItems=items;window.__businessBeforeV198=JSON.stringify(items);
    window.JSListingTradeV1.setMode(market);window.showList(items);
    window.selectedItemKey=items[0].key;window.selectedListCardIdV845=actionSelectionKeyV660(items[0]);window.showList(items);
  },market);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const a=card(page,'CHECK-V198-A'),b=card(page,'CHECK-V198-B'),c=card(page,'CHECK-V198-C');
  await expect(a).toHaveClass(/\bselected\b/);
  const originalPaint=await paint(a);
  const requests=[];page.on('request',r=>requests.push(r.method()+' '+r.url()));
  const bNode=await b.evaluate(el=>{el.__v198Identity='retained';return el.getAttribute('data-list-card-id-v681');});
  await b.locator('.action-select-check').check();
  await expect(b.locator('.action-select-check')).toBeChecked();await expect(a.locator('.action-select-check')).not.toBeChecked();
  await expectNeutral(a);expect(await paint(b)).toEqual(blue);await expectNeutral(c);
  expect(await page.evaluate(()=>getSelectedPrintItems().map(i=>i.propertyId))).toEqual(['CHECK-V198-B']);
  expect(await b.evaluate(el=>el.__v198Identity)).toBe('retained');
  await c.locator('.action-select-check').check();expect(await paint(b)).toEqual(blue);expect(await paint(c)).toEqual(blue);await expectNeutral(a);
  await page.evaluate(()=>{preserveActionSelectionDuringRender=true;try{showList(visibleListItems.slice().reverse());}finally{preserveActionSelectionDuringRender=false;}});
  expect(await paint(b)).toEqual(blue);expect(await paint(c)).toEqual(blue);await expectNeutral(a);
  expect(await b.getAttribute('data-list-card-id-v681')).toBe(bNode);
  await page.screenshot({path:info.outputPath(market+'-checked-targets.png'),animations:'disabled'});
  await b.locator('.action-select-check').uncheck();await expectNeutral(b);expect(await paint(c)).toEqual(blue);
  await c.locator('.action-select-check').uncheck();await expect.poll(()=>paint(a)).toEqual(originalPaint);
  expect(await page.evaluate(()=>getSelectedPrintItems())).toEqual([]);
  expect(await page.evaluate(()=>JSON.stringify(allItems)===__businessBeforeV198)).toBe(true);
  expect(requests.filter(x=>x.startsWith('POST '))).toEqual([]);
});

test('checking preserves the independently open detail and makes no additional requests',async({page,isMobile})=>{
  if(isMobile){await page.setViewportSize({width:930,height:530});await page.evaluate(()=>JSMapListPanelV1.open());}
  const a=card(page,'FIXTURE-LEASE-1'),b=card(page,'FIXTURE-LEASE-2');
  await a.locator('.item-building-name').click();await expect(page.locator('#unifiedDetailDrawerV8')).toHaveClass(/open/);
  const before=await page.evaluate(()=>({selected:selectedListCardIdV845,keys:selectedPrintKeys.slice(),detail:document.getElementById('unifiedDetailSubtitleV8').innerText}));
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await b.locator('.action-select-check').check();
  await expectNeutral(a);expect(await paint(b)).toEqual(blue);
  await expect(page.locator('#unifiedDetailDrawerV8')).toHaveClass(/open/);
  expect(await page.evaluate(()=>({selected:selectedListCardIdV845,detail:document.getElementById('unifiedDetailSubtitleV8').innerText}))).toEqual({selected:before.selected,detail:before.detail});
  expect(requests).toEqual([]);
});

for(const market of ['lease','building_sale','land_sale'])test('v264 tablet touch keeps only checked cards blue without relational selector support: '+market,async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:1280,height:800},screen:{width:1280,height:800},hasTouch:true,isMobile:false});
  try{
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
      if(url.pathname==='/css/map-professional-v1.css'){
        const response=await route.fetch(),css=await response.text();
        // Unsupported :has() invalidates the whole rule, including comma groups.
        return route.fulfill({response,body:css.replace(/[^{}]*:has\(\.item\.print-selected\)[^{}]*\{[^{}]*\}/g,'')});
      }
      return route.continue();
    });
    const page=await context.newPage();await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    await page.locator('#fixtureControls').evaluate(el=>el.remove());
    await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    await page.evaluate(market=>{
      const base=allItems.find(i=>i.propertyId===(market==='lease'?'FIXTURE-LEASE-1':market==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND'));
      const items=['A','B','C'].map((id,index)=>({...base,key:'tablet-touch-'+id,propertyId:'TOUCH-V264-'+id,sheetRow:26400+index,name:'터치 검사 '+id,address:'대전 서구 괴정동 '+(264+index),room:'1층',source:'직접등록',memo:'원장 보존 '+id}));
      window.allItems=items;JSUnifiedListingsV8.attach(items,{ok:true,groups:Object.fromEntries(items.map(item=>[item.propertyId,[{...item,originalId:item.propertyId+'-AD',images:['/icons/js-192.png'],photoCount:1}]]))});
      JSListingTradeV1.setMode(market);window.selectedItemKey=items[0].key;window.selectedListCardIdV845=actionSelectionKeyV660(items[0]);showList(items);window.__touchBeforeV264=JSON.stringify(allItems);
    },market);
    const a=card(page,'TOUCH-V264-A'),b=card(page,'TOUCH-V264-B'),c=card(page,'TOUCH-V264-C');
    async function tapCheck(target){await target.evaluate(el=>el.scrollIntoView({block:'center'}));await target.locator('.action-select-check').tap();}
    await expect.poll(()=>page.evaluate(()=>document.querySelector('#mapQuickTools').getBoundingClientRect().right-document.querySelector('#sidebar').getBoundingClientRect().left)).toBeLessThanOrEqual(1);
    await expect(a).toHaveClass(/\bselected\b/);const original=await paint(a);
    const identity=await page.evaluate(()=>{document.querySelectorAll('#list .unified-thumb-v8 img').forEach(img=>img.__touchPhotoV264=true);return selectedListCardIdV845;});
    const writes=[];page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
    await tapCheck(b);await expectNeutral(a);expect(await paint(b)).toEqual(blue);await expectNeutral(c);
    await expect(b.locator('.action-select-check')).toBeChecked();await expect(a.locator('.action-select-check')).not.toBeChecked();
    expect(await page.evaluate(()=>getSelectedPrintItems().map(item=>item.propertyId))).toEqual(['TOUCH-V264-B']);
    expect(await a.evaluate(el=>getComputedStyle(el).webkitTapHighlightColor)).toBe('rgba(0, 0, 0, 0)');
    await tapCheck(c);await expectNeutral(a);expect(await paint(b)).toEqual(blue);expect(await paint(c)).toEqual(blue);
    await page.evaluate(()=>{preserveActionSelectionDuringRender=true;try{showList(visibleListItems.slice().reverse());}finally{preserveActionSelectionDuringRender=false;}});
    await expectNeutral(a);expect(await paint(b)).toEqual(blue);expect(await paint(c)).toEqual(blue);
    expect(await page.evaluate(()=>[...document.querySelectorAll('#list .unified-thumb-v8 img')].every(img=>img.__touchPhotoV264))).toBe(true);
    await page.evaluate(()=>renderListWindowV2(2,3));await expectNeutral(a);await expect(page.locator('#list .item.print-selected')).toHaveCount(0);
    expect(await page.evaluate(()=>getSelectedPrintItems().map(item=>item.propertyId).sort())).toEqual(['TOUCH-V264-B','TOUCH-V264-C']);
    await page.evaluate(()=>renderListWindowV2(0,3));await expectNeutral(a);expect(await paint(b)).toEqual(blue);expect(await paint(c)).toEqual(blue);
    await page.screenshot({path:info.outputPath(market+'-tablet-checked.png')});
    await tapCheck(b);await expectNeutral(b);expect(await paint(c)).toEqual(blue);await expectNeutral(a);
    await tapCheck(c);await expect.poll(()=>paint(a)).toEqual(original);
    await tapCheck(b);await page.locator('#listToolbar .list-master-select').tap();
    expect(await page.evaluate(()=>selectedPrintKeys)).toEqual([]);await expectNeutral(b);await expectNeutral(c);
    await page.locator('#listToolbar .list-master-select').tap();await expect(page.locator('#list .action-select-check:checked')).toHaveCount(3);
    await page.locator('#listToolbar .list-master-select').tap();await expect(page.locator('#list .action-select-check:checked')).toHaveCount(0);
    expect(await page.evaluate(()=>selectedListCardIdV845)).toBe(identity);expect(await page.evaluate(()=>JSON.stringify(allItems)===__touchBeforeV264)).toBe(true);expect(writes).toEqual([]);
  }finally{await context.close();}
});

for(const market of ['lease','building_sale','land_sale'])test('v267 master clears any selection and selects the current list only when empty: '+market,async({page,isMobile},info)=>{
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  await page.evaluate(market=>{
    const base=allItems.find(i=>i.propertyId===(market==='lease'?'FIXTURE-LEASE-1':market==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND'));
    const items=['A','B','C'].map((id,index)=>({...base,key:'same-key-v267',propertyId:'MASTER-V267-'+id,sheetRow:26700+index,address:'대전 서구 괴정동 267-1',name:'선택 검사 '+id,source:'직접등록',memo:'원장 보존 '+id}));
    window.allItems=items;window.__masterItemsV267=items;JSListingTradeV1.setMode(market);showList(items);
    window.__masterBeforeV267=JSON.stringify(allItems);
    document.querySelectorAll('#list .item').forEach(el=>el.__retainedMasterV267=true);
  },market);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const master=page.locator('#listMasterCheckbox'),control=page.locator('#listToolbar .list-master-select');
  const a=card(page,'MASTER-V267-A'),b=card(page,'MASTER-V267-B'),c=card(page,'MASTER-V267-C');
  const activate=()=>isMobile?control.tap():control.click();
  const changes=[];page.on('request',r=>{if(r.method()!=='GET')changes.push(r.method()+' '+r.url());});
  await expect(master).toHaveAccessibleName('현재 목록 전체선택');await expect(control).toBeVisible();
  const sizes=await control.evaluate(el=>{const r=el.getBoundingClientRect(),mark=el.querySelector('.list-master-checkmark').getBoundingClientRect(),toolbar=el.closest('#listToolbar').getBoundingClientRect();return {w:r.width,h:r.height,mark:mark.width,contained:r.top>=toolbar.top-1&&r.bottom<=toolbar.bottom+1,right:r.right,view:innerWidth};});
  expect(sizes.w).toBeGreaterThanOrEqual(43.99);expect(sizes.h).toBeGreaterThanOrEqual(43.99);expect(sizes.mark).toBeGreaterThanOrEqual(27.99);expect(sizes.contained).toBe(true);expect(sizes.right).toBeLessThanOrEqual(sizes.view+1);
  await b.locator('.action-select-check').check();
  await expect(master).toHaveAccessibleName('전체 선택해제');expect(await master.evaluate(el=>el.indeterminate)).toBe(true);
  if(market!=='lease')await page.getByRole('button',{name:'선택 작업 더보기',exact:true}).click();
  await expect(page.locator('#selectionMoreV242 .selection-clear-btn')).toHaveCount(0);
  const print=market==='lease'?page.locator('#selectionActionBar > .selection-print-btn-v283'):page.locator('#selectionMoreV242').getByRole('button',{name:'선택인쇄',exact:true});
  await expect(print).toBeVisible();
  await activate();
  await expect(a.locator('.action-select-check')).not.toBeChecked();await expect(b.locator('.action-select-check')).not.toBeChecked();await expect(c.locator('.action-select-check')).not.toBeChecked();
  expect(await page.evaluate(()=>selectedPrintKeys)).toEqual([]);await expect(page.locator('#selectionActionBar')).toBeHidden();await expect(page.locator('#selectionMoreV242')).not.toHaveAttribute('open');
  await expect(master).toHaveAccessibleName('현재 목록 전체선택');
  await activate();await expect(page.locator('#list .action-select-check:checked')).toHaveCount(3);await expect(master).toBeChecked();
  expect(await page.evaluate(()=>getSelectedPrintItems().map(i=>i.propertyId).sort())).toEqual(['MASTER-V267-A','MASTER-V267-B','MASTER-V267-C']);
  expect(await page.evaluate(()=>[...document.querySelectorAll('#list .item')].every(el=>el.__retainedMasterV267))).toBe(true);
  await page.screenshot({path:info.outputPath(market+'-master-all.png')});
  await activate();await expect(page.locator('#list .action-select-check:checked')).toHaveCount(0);
  await b.locator('.action-select-check').check();
  await page.evaluate(()=>renderListWindowV2(0,1));
  await expect(page.locator('#list .action-select-check:checked')).toHaveCount(0);await expect(master).toHaveAccessibleName('전체 선택해제');expect(await master.evaluate(el=>el.indeterminate)).toBe(true);
  await activate();expect(await page.evaluate(()=>selectedPrintKeys)).toEqual([]);await expect(a.locator('.action-select-check')).not.toBeChecked();
  await page.evaluate(()=>renderListWindowV2(0,3));
  await master.focus();await master.press('Space');await expect(page.locator('#list .action-select-check:checked')).toHaveCount(3);
  await master.press('Space');await expect(page.locator('#list .action-select-check:checked')).toHaveCount(0);
  await c.locator('.action-select-check').check();await master.focus();await master.press('Space');await expect(page.locator('#list .action-select-check:checked')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(allItems)===__masterBeforeV267)).toBe(true);expect(changes).toEqual([]);
});
