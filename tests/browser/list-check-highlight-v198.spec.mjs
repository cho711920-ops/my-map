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
