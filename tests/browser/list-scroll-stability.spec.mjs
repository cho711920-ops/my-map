import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const mapSource=readFileSync(new URL('../../js/map.js',import.meta.url),'utf8');
function mapFunction(name){
  const start=mapSource.indexOf('function '+name+'(');
  return mapSource.slice(start,mapSource.indexOf('\n}',start)+2);
}
test.use({launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}});

async function prepare(page,context,isMobile){
  const errors=[],writes=[],reads=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1'&&url.protocol!=='data:')return route.abort();
    if(url.pathname==='/api/data'){
      reads.push(url.searchParams.get('action'));
      if(route.request().method()!=='GET')writes.push(url.pathname);
      if(url.searchParams.get('action')==='operationsDashboard')return route.fulfill({json:{ok:true,advertisementPolicyVersion:3,activeMaster:240,raw:240,pendingReview:0,history:0}});
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.evaluate(()=>{
    document.getElementById('fixtureControls').style.display='none';
    const base=allItems[0];
    allItems=Array.from({length:240},(_,i)=>({...base,propertyId:'SCROLL-'+i,key:'scroll-'+i,
      name:'스크롤 검사 '+i,address:'대전 서구 검사동 '+i,source:'직접등록',memo:'',room:'1층'}));
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(item=>[item.propertyId,[]]))});
    showList(allItems);
  });
  const scroller=page.locator(isMobile?'#list':'#sidebar');
  return {errors,writes,reads,scroller};
}
const snapshot=el=>({top:el.scrollTop,height:el.scrollHeight,viewport:el.clientHeight,
  start:Number(document.getElementById('list').dataset.renderedStart),end:Number(document.getElementById('list').dataset.renderedEnd),
  count:document.querySelectorAll('#list .item').length});
function safe(h){expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);}

for(const market of ['lease','building_sale','land_sale'])test(market+' selected actions stay reachable below the filters throughout deep scrolling',async({page,context,isMobile},info)=>{
  const h=await prepare(page,context,isMobile);
  if(isMobile){
    await page.setViewportSize({width:930,height:530});
    const session=await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride',{width:930,height:530,screenWidth:1100,screenHeight:720,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  }
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  if(market!=='lease')await page.evaluate(market=>{
    allItems=allItems.map(item=>({...item,tradeType:'sale',saleCategory:market==='land_sale'?'land':'building',salePrice:50000,saleDetails:{landAreaM2:330,grossAreaM2:660}}));
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(item=>[item.propertyId,[]]))});
  },market);
  await page.locator('#listingTradeModeSelectV1').selectOption(market);
  await page.locator('#list .item .action-select-check').first().check();
  await page.locator('#list .item .action-select-check').nth(1).check();
  await page.locator('#list .item .action-select-check').nth(2).check();
  const bar=page.locator('#selectionActionBar'),scroller=page.locator('#sidebar');
  await expect(bar).toContainText('3건 선택');
  const keys=await page.evaluate(()=>selectedPrintKeys.slice());
  for(const ratio of [.35,.8,.15]){
    await scroller.evaluate((el,r)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*r;},ratio);
    await page.waitForTimeout(100);
    const filters=await page.locator('#listToolbar').boundingBox(),actions=await bar.boundingBox(),bounds=await scroller.boundingBox();
    expect(actions.y).toBeGreaterThanOrEqual(filters.y+filters.height-1);
    expect(actions.y+actions.height).toBeLessThan(bounds.y+bounds.height);
    for(const label of ['매물찜하기','계약완료','임장완료','선택인쇄','선택해제'])await expect(bar.getByRole('button',{name:label,exact:true})).toBeInViewport({ratio:1});
    if(market!=='lease'){
      const layout=await page.locator('#saleListLayoutV8').boundingBox();
      expect(layout.y).toBeGreaterThanOrEqual(actions.y+actions.height-1);
    }
  }
  expect(await page.evaluate(()=>selectedPrintKeys)).toEqual(keys);
  if(market!=='lease'){
    const oldStyle=await scroller.getAttribute('style');
    await scroller.evaluate(el=>{for(const property of ['width','min-width','max-width'])el.style.setProperty(property,'420px','important');});
    await expect.poll(()=>bar.evaluate(el=>el.offsetHeight)).toBeGreaterThan(60);
    const wrapped=await bar.boundingBox(),below=await page.locator('#saleListLayoutV8').boundingBox();
    expect(below.y).toBeGreaterThanOrEqual(wrapped.y+wrapped.height-1);
    await expect(bar.getByRole('button',{name:'선택해제',exact:true})).toBeInViewport({ratio:1});
    await scroller.evaluate((el,style)=>el.setAttribute('style',style||''),oldStyle);
    await page.locator('#saleListLayoutV8 [data-sale-layout="table"]').click();
    const layout=await page.locator('#saleListLayoutV8').boundingBox(),head=await page.locator('#saleTableHeadV10').boundingBox();
    expect(head.y).toBeGreaterThanOrEqual(layout.y+layout.height-1);
    await page.locator('#saleListLayoutV8 [data-sale-layout="card"]').click();
  }
  await page.screenshot({path:info.outputPath(market+'-sticky-selected-actions.png')});
  const before=await scroller.evaluate(el=>el.scrollTop);
  await bar.getByRole('button',{name:'선택해제',exact:true}).click();
  await expect(bar).toBeHidden();
  expect(await scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(before-150);
  expect(await page.evaluate(()=>selectedPrintKeys.length)).toBe(0);
  safe(h);
});

test('passive refresh preserves the visible card through reorder, insertion and removal',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile);
  await h.scroller.evaluate(el=>{el.scrollTop=el.scrollHeight*.65;});
  await page.waitForTimeout(150);
  const result=await h.scroller.evaluate(el=>{
    const top=el.getBoundingClientRect().top;
    const card=[...document.querySelectorAll('#list .item')].find(c=>c.getBoundingClientRect().bottom>top);
    const id=card.getAttribute('data-list-card-id-v681'),offset=card.getBoundingClientRect().top-top;
    const first=allItems[0];
    // A changed sort result and a newly exposed advertisement during hydration.
    const next=[{...first,propertyId:'NEW',key:'new'},...allItems.slice(8).reverse()];
    preserveActionSelectionDuringRender=true;
    try{showList(next);}finally{preserveActionSelectionDuringRender=false;}
    const restored=[...document.querySelectorAll('#list .item')].find(c=>c.getAttribute('data-list-card-id-v681')===id);
    return {delta:restored?restored.getBoundingClientRect().top-top-offset:null,
      count:document.querySelectorAll('#list .item').length,visible:visibleListItems.length};
  });
  expect(result.delta).not.toBeNull();
  expect(Math.abs(result.delta)).toBeLessThanOrEqual(2);
  expect(result.count).toBeLessThanOrEqual(isMobile?28:36);
  expect(result.visible).toBe(233);
  await page.waitForTimeout(150);
  expect(await h.scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(1000);
  // Explicitly selecting a different result set still starts at its beginning.
  await page.evaluate(()=>showList(allItems.slice(0,10)));
  expect(await h.scroller.evaluate(el=>el.scrollTop)).toBe(0);
  safe(h);
});

test('passive CSV row renumbering keeps the same property in place when the total grows',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile);
  const checked=await page.evaluate(()=>{
    selectedPrintKeys=[actionSelectionKeyV660(allItems[0])];showList(allItems);
    return getSelectedPrintItems()[0].propertyId;
  });
  await h.scroller.evaluate(el=>{el.scrollTop=el.scrollHeight*.65;});await page.waitForTimeout(120);
  const result=await h.scroller.evaluate(el=>{
    const top=el.getBoundingClientRect().top,card=[...document.querySelectorAll('#list .item')].find(c=>c.getBoundingClientRect().bottom>top);
    const property=card.dataset.propertyId,offset=card.getBoundingClientRect().top-top;
    const additions=Array.from({length:100},(_,n)=>({...allItems[0],propertyId:'ADDED-'+n,key:'added-'+n}));
    const next=additions.concat(allItems).map((item,n)=>({...item,sheetRow:n+1001}));
    allItems=next;
    preserveActionSelectionDuringRender=true;try{showList(next);}finally{preserveActionSelectionDuringRender=false;}
    const restored=[...document.querySelectorAll('#list .item')].find(c=>c.dataset.propertyId===property);
    return {delta:restored?restored.getBoundingClientRect().top-top-offset:null,top:el.scrollTop,count:visibleListItems.length};
  });
  expect(result.delta).not.toBeNull();expect(Math.abs(result.delta)).toBeLessThanOrEqual(2);expect(result.top).toBeGreaterThan(1000);expect(result.count).toBe(340);safe(h);
  expect(await page.evaluate(()=>getSelectedPrintItems().map(i=>i.propertyId))).toEqual([checked]);
  expect(await page.evaluate(()=>selectedPrintKeys.length)).toBe(1);
});

test('passive removal of the whole rendered window stays near the reading position without retaining removed rows',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile);
  await h.scroller.evaluate(el=>{el.scrollTop=el.scrollHeight*.6;});await page.waitForTimeout(120);
  const result=await h.scroller.evaluate(el=>{
    const top=el.getBoundingClientRect().top,cards=[...document.querySelectorAll('#list .item')];
    const first=cards.find(c=>c.getBoundingClientRect().bottom>top),offset=first.getBoundingClientRect().top-top;
    const oldIndex=allItems.findIndex(i=>i.propertyId===first.dataset.propertyId),removed=new Set(cards.map(c=>c.dataset.propertyId));
    selectedPrintKeys=[actionSelectionKeyV660(allItems[oldIndex])];
    const next=allItems.filter(i=>!removed.has(i.propertyId)),nearest=next[Math.min(oldIndex,next.length-1)];
    preserveActionSelectionDuringRender=true;try{showList(next);}finally{preserveActionSelectionDuringRender=false;}
    const restored=[...document.querySelectorAll('#list .item')].find(c=>c.dataset.propertyId===nearest.propertyId);
    return {delta:restored?restored.getBoundingClientRect().top-top-offset:null,top:el.scrollTop,
      retained:visibleListItems.some(i=>removed.has(i.propertyId)),count:visibleListItems.length,expected:next.length};
  });
  expect(result.delta).not.toBeNull();expect(Math.abs(result.delta)).toBeLessThanOrEqual(2);
  expect(result.top).toBeGreaterThan(1000);expect(result.retained).toBe(false);expect(result.count).toBe(result.expected);safe(h);
  expect(await page.evaluate(()=>selectedPrintKeys.length)).toBe(0);
});

test('scroll range stays stable while wheel input crosses virtual windows',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile),initial=await h.scroller.evaluate(snapshot),box=await h.scroller.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  for(const direction of [1,-1])for(let i=0;i<20;i++){
    const before=await h.scroller.evaluate(snapshot);
    await page.mouse.wheel(0,direction*260);await page.waitForTimeout(40);
    const after=await h.scroller.evaluate(snapshot);
    expect(direction*(after.top-before.top)).toBeGreaterThanOrEqual(-1);
    expect(Math.abs(after.height-initial.height)).toBeLessThanOrEqual(1);
    expect(after.count).toBeLessThanOrEqual(isMobile?28:36);
  }
  safe(h);
});

test('metadata refresh and later touch or wheel input do not restore an obsolete scroll offset',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile);
  await page.addScriptTag({content:['captureAutoUpdateViewState','restoreAutoUpdateViewState','refreshOriginalMetadataPresentationV1'].map(mapFunction).join('\n')});
  await page.evaluate(()=>{
    window.captureClusterSelectionSnapshotV638=()=>null;
    window.redrawSelectedMarkers=()=>{};
  });
  await h.scroller.evaluate(el=>{el.scrollTop=el.scrollHeight*.6;});
  await page.waitForTimeout(100);
  const result=await h.scroller.evaluate(el=>{
    const anchor=captureListReadingAnchorV29();
    window.applyFilter=()=>{
      const next=allItems.slice(3);
      next.unshift({...allItems[0],propertyId:'METADATA-NEW',key:'metadata-new'});
      showList(next);
    };
    refreshOriginalMetadataPresentationV1();
    const after=captureListReadingAnchorV29();
    // Simulate a new input before the next animation frame.
    el.scrollTop+=300;
    return {anchor,after,inputTop:el.scrollTop};
  });
  expect(result.after.id).toBe(result.anchor.id);
  expect(Math.abs(result.after.offset-result.anchor.offset)).toBeLessThanOrEqual(2);
  await page.waitForTimeout(120);
  expect(Math.abs(await h.scroller.evaluate(el=>el.scrollTop)-result.inputTop)).toBeLessThanOrEqual(2);
  safe(h);
});

test('scrollbar can seek directly near the end and return without blank cards',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile),initial=await h.scroller.evaluate(snapshot);
  for(const ratio of [.95,.5,.03]){
    await h.scroller.evaluate((el,r)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*r;},ratio);
    await page.waitForTimeout(100);
    const state=await h.scroller.evaluate(snapshot);
    expect(state.height).toBe(initial.height);
    const visible=await h.scroller.evaluate(el=>{
      const bounds=el.getBoundingClientRect();
      return [...document.querySelectorAll('#list .item')].filter(card=>{
        const r=card.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom;
      }).length;
    });
    expect(visible).toBeGreaterThan(0);
    expect(Math.abs(state.top-(state.height-state.viewport)*ratio)).toBeLessThan(2);
  }
  safe(h);
});

test('native PC scrollbar drag keeps its speed across an appended window',async({page,context,isMobile})=>{
  test.skip(isMobile,'Native PC scrollbar check');
  const h=await prepare(page,context,isMobile),box=await h.scroller.boundingBox(),initial=await h.scroller.evaluate(snapshot);
  const thumb=Math.max(17,initial.viewport*initial.viewport/initial.height),x=box.x+box.width-7,y=box.y+17+thumb/2;
  await page.mouse.move(x,y);await page.mouse.down();
  const deltas=[];
  for(let i=1;i<=14;i++){
    const before=await h.scroller.evaluate(snapshot);
    await page.mouse.move(x,y+i*10);await page.waitForTimeout(50);
    const after=await h.scroller.evaluate(snapshot);deltas.push(after.top-before.top);
    expect(after.height).toBe(initial.height);expect(after.top).toBeGreaterThanOrEqual(before.top);
  }
  await page.mouse.up();
  expect(deltas.every(delta=>delta>0)).toBe(true);
  expect(Math.max(...deltas)/Math.min(...deltas)).toBeLessThan(1.15);
  safe(h);
});

test('operations dashboard stays available without customer UI or startup customer reads',async({page,context,isMobile})=>{
  const h=await prepare(page,context,isMobile);
  await page.addScriptTag({url:'/js/operations-center-v7.js'});
  await page.evaluate(()=>openOperationsCenter('dashboard'));
  await expect(page.locator('#operationsCenterTitle')).toHaveText('매물관리');
  await expect(page.locator('#operationsDashboardPanel')).toContainText('거래확인 후보');
  await expect(page.locator('#operationsDashboardPanel')).toContainText('활성 통합매물');
  expect(await page.locator('#operationsTabCustomers,#operationsCustomersPanel,#customerEditorModal,[data-mobile-view="customers"]').count()).toBe(0);
  await page.waitForTimeout(1300);
  expect(h.reads.filter(action=>/customer/i.test(action||''))).toEqual([]);
  safe(h);
});
