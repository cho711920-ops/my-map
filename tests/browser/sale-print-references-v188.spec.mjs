import {test,expect} from '@playwright/test';
const pnu='3017010800100030003',address='대전광역시 서구 괴정동 3-3';
const building={ok:true,action:'buildingRegister',parcel:{sigunguCd:'30170',bjdongCd:'10800',platGbCd:'0',bun:'0003',ji:'0003'},source:'국토교통부 건축HUB · 검수자료',fetchedAt:new Date().toISOString(),partial:true,detailsPending:true,recordCounts:{buildings:1},buildings:[{lotAddress:address,buildingName:'본동',mainUse:'단독주택',otherUse:'단독주택,제2종근린생활시설',siteArea:331,buildingArea:180,totalArea:650,approvalDate:'20160701',groundFloors:4,undergroundFloors:1}]};
const land={ok:true,action:'saleParcelFacts',pnu,address,source:'토지이음 공개 열람 · 검수자료',fetchedAt:new Date().toISOString(),complete:true,landUse:'대',areaM2:331,price:{available:true,wonPerM2:2500000,baseYear:2026,baseMonth:1},regulations:[{label:'국토계획법에 따른 지역·지구',available:true,complete:true,items:[{label:'제2종일반주거지역'},{label:'지구단위계획구역'}]},{label:'다른 법령에 따른 지역·지구',available:true,complete:true,items:[{label:'교육환경보호구역'}]}]};
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(({pnu,address})=>{
    window.__v188Reads=0;window.__v188Prints=0;const open=window.open;window.open=function(...args){const p=open.apply(window,args);if(p)p.print=()=>window.__v188Prints++;return p;};
    document.getElementById('fixtureControls').hidden=true;
    JSParcelExternalLinksV1.resolve=async()=>{window.__v188Reads++;return {pnu,address};};
    JSUnifiedListingsV8.printItem=async item=>({...item,memo:'내가 직접 작성한 메모',saleDetails:{...item.saleDetails,totalDeposit:5000,monthlyIncome:200}});
    window.extractListContactsV650=()=>[{role:'임',phone:{display:'010-1111-2222'}},{role:'관',phone:{display:'042-123-4567'}},{role:'기',phone:{display:'010-3333-4444'}}];
  },{pnu,address});
});
async function print(page,context,isMobile){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item .action-select-check').first().check();
  const wait=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());const popup=await wait;
  await expect.poll(()=>page.evaluate(()=>window.__v188Prints)).toBe(1);return popup;
}
async function routes(page,register=building,parcel=land){
  const reads=[];
  await page.route('**/api/data?*',route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action');
    if(!['buildingRegister','saleParcelFacts'].includes(action))return route.continue();
    reads.push(url);expect(route.request().method()).toBe('GET');expect(url.searchParams.has('propertyId')).toBe(false);
    return route.fulfill({json:action==='buildingRegister'?register:parcel});
  });return reads;
}
test('selected print shows separate ad/register/land evidence with date and horizontal contacts, without changing data',async({page,context,isMobile},info)=>{
  const reads=await routes(page);expect(reads.length).toBe(0);expect(await page.evaluate(()=>window.__v188Reads)).toBe(0);
  const before=await page.evaluate(()=>JSON.stringify(allItems));const popup=await print(page,context,isMobile);
  const ad=popup.locator('.sale-print-advertised'),official=popup.locator('.sale-print-official');
  await expect(popup.locator('.sale-print-note')).toHaveCount(0);
  await expect(ad).toContainText('200만원');await expect(ad).toContainText('661.16㎡');await expect(ad).toContainText('대장 확인값이 아닙니다');
  await expect(official).toHaveCount(2);await expect(official.nth(0)).toContainText('단독주택,제2종근린생활시설');await expect(official.nth(0)).toContainText('650㎡');await expect(official.nth(0)).toContainText('표기 차이');
  await expect(official.nth(1)).toContainText('2,500,000원/㎡');await expect(official.nth(1)).toContainText('2026.01 기준');await expect(official.nth(1)).toContainText('교육환경보호구역');
  await expect(popup.locator('.sale-print-source')).toContainText(['매매가','국토교통부','필지번호','토지이음']);
  await expect(popup.locator('.sale-print-memo')).toContainText('내가 직접 작성한 메모');
  expect(reads.length).toBe(2);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:794,height:1123});
  const phones=await popup.locator('.sale-print-contact .print-contact').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width})));
  expect(phones.length).toBe(3);expect(Math.abs(phones[0].y-phones[1].y)).toBeLessThan(2);expect(phones[1].x).toBeGreaterThan(phones[0].x+phones[0].width);
  expect(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await popup.screenshot({path:info.outputPath('sale-print-references-v188.png'),fullPage:true});
  if(!isMobile)await popup.pdf({path:info.outputPath('sale-print-references-v188.pdf'),preferCSSPageSize:true,printBackground:true});
});
test('unavailable public data stays visibly unavailable while ad values still print',async({page,context,isMobile})=>{
  await routes(page,{ok:false,message:'대장 조회 실패'},{ok:false,message:'토지이음 조회 실패'});
  const popup=await print(page,context,isMobile);await expect(popup.locator('.sale-print-advertised')).toContainText('661.16㎡');
  await expect(popup.locator('.sale-print-official').nth(0)).toContainText('대장 조회 실패');await expect(popup.locator('.sale-print-official').nth(1)).toContainText('토지이음 조회 실패');
  await expect(popup.locator('.sale-print-official .sale-print-facts')).toHaveCount(0);
});
test('multiple buildings are individually identified and incomplete lookup is flagged',async({page,context,isMobile})=>{
  await routes(page,{...building,incomplete:true,buildings:[building.buildings[0],{...building.buildings[0],buildingName:'별동',totalArea:80}],recordCounts:{buildings:2}});
  const popup=await print(page,context,isMobile),register=popup.locator('.sale-print-official').first();
  await expect(register).toContainText('2개 건물 각각 표시, 합산하지 않음');await expect(register.locator('h4')).toHaveCount(2);await expect(register).toContainText('80㎡');await expect(register).toContainText('일부 대장 자료');
  await expect(register).not.toContainText('730㎡');
});

test('each complete building prints on one A4 with a repeated header and no map status colors',async({page,context,isMobile},info)=>{
  await page.evaluate(({building,land})=>{
    const base=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
    window.__v200Memos=[12,90,300].map((count,index)=>'직접 작성한 매물 '+index+' 시작\n'+('층별 임대 현황: 1층 보증금 2000만원 월세 80만원, 2층 보증금 1000만원 월세 60만원. 실제 현장 확인 내용은 모두 보존합니다.\n').repeat(count)+'\n메모끝'+index);
    const items=__v200Memos.map((memo,index)=>({...base,propertyId:'PRINT-V200-'+index,key:'print-v200-'+index,name:'A4 검수 건물 '+index,memo}));
    window.allItems=items;JSUnifiedListingsV8.attach(items,{ok:true,groups:Object.fromEntries(items.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',buildingName:i.name,images:[],photoCount:0}]]))});
    JSUnifiedListingsV8.printItem=async item=>({...item});
    JSSalePublicReviewV6.referencesForPrint=async()=>({building:{data:building},land:{data:land}});
  },{building,land});
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator('#list .action-select-check')).toHaveCount(3);
  for(const checkbox of await page.locator('#list .action-select-check').all())await checkbox.check();
  await page.evaluate(()=>{window.isFieldVisitItem=()=>true;window.isDone=()=>true;});
  const before=await page.evaluate(()=>JSON.stringify(allItems)),writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  const pending=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(el=>el.click());const popup=await pending;
  await expect.poll(()=>page.evaluate(()=>__v188Prints)).toBe(1);
  await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:794,height:1123});
  const sheets=popup.locator('.sale-print-page-v200');await expect(sheets).toHaveCount(3);
  const memos=await page.evaluate(()=>__v200Memos);
  for(let i=0;i<3;i++){
    const sheet=sheets.nth(i),card=sheet.locator('.sale-print-card');
    await expect(sheet.locator('.js-print-title')).toHaveText('JS부동산 건물매매 검토목록');await expect(sheet.locator('.js-print-meta')).toContainText('선택 3건');
    await expect(sheet).toHaveAttribute('data-print-fits-v200','true');
    await expect(sheet.locator('.sale-print-memo>div')).toHaveText(memos[i]);
    await expect(card).not.toHaveClass(/print-row-(visit|done)/);await expect(card).toHaveCSS('background-color','rgb(255, 255, 255)');
    const bounds=await sheet.evaluate(el=>{const a=el.querySelector('.sale-print-area-v200').getBoundingClientRect(),c=el.querySelector('.sale-print-content-v200').getBoundingClientRect(),h=el.querySelector('.js-print-header').getBoundingClientRect();return {bottom:c.bottom<=a.bottom+1,right:c.right<=a.right+1,header:h.bottom<=a.top+1,scale:Number(el.dataset.printScaleV200),clip:getComputedStyle(el.querySelector('.sale-print-area-v200')).overflow};});
    expect(bounds.bottom&&bounds.right&&bounds.header).toBe(true);expect(bounds.scale).toBe(1);expect(bounds.clip).toBe('visible');
  }
  if(!isMobile){
    const bytes=await popup.pdf({path:info.outputPath('building-a4-one-page-v200.pdf'),preferCSSPageSize:true,printBackground:true});
    expect([...bytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length).toBe(3);
  }
  await popup.screenshot({path:info.outputPath('building-a4-one-page-v200.png'),fullPage:true});
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);await popup.close();
});

test('five selected buildings retain long land regulations below their labels without clipped print content',async({page,context,isMobile},info)=>{
  const parcel={...land,complete:false,regulations:[
    {label:'국토계획법에 따른 지역·지구',available:true,complete:true,items:[{label:'제2종일반주거지역'},{label:'지구단위계획구역(장기 도시관리계획 결정 및 지형도면 고시)'}]},
    {label:'다른 법령에 따른 지역·지구',available:true,complete:true,items:[{label:'가축사육제한구역(2017-12-20)<전부제한구역><가축분뇨의 관리 및 이용에 관한 법률>'},{label:'상대보호구역(학교환경위생정화구역)<교육환경 보호에 관한 법률>'}]},
    {label:'그 밖의 확인사항',available:false,complete:false,items:[]}
  ]};
  await page.evaluate(({building,parcel})=>{
    const base=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
    const items=Array.from({length:5},(_,index)=>({...base,propertyId:'PRINT-V212-'+index,key:'print-v212-'+index,name:'공적자료 배열 검수 '+index,memo:'직접 작성한 매물 '+index+'\n1층 상가 보증금 2000만원 월세 80만원.\n2층 주택 보증금 1000만원 월세 60만원.\n공적자료와 현장 메모 마지막까지 보존.'}));
    window.allItems=items;JSUnifiedListingsV8.attach(items,{ok:true,groups:Object.fromEntries(items.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',buildingName:i.name,images:[],photoCount:0}]]))});
    JSUnifiedListingsV8.printItem=async item=>({...item});
    JSSalePublicReviewV6.referencesForPrint=async()=>({building:{data:building},land:{data:parcel}});
  },{building,parcel});
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const checks=page.locator('#list .action-select-check');await expect(checks).toHaveCount(5);
  for(const check of await checks.all())await check.check();
  const before=await page.evaluate(()=>JSON.stringify(allItems)),writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  const pending=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(el=>el.click());const popup=await pending;
  await expect.poll(()=>page.evaluate(()=>__v188Prints)).toBe(1);
  await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:794,height:1123});
  const sheets=popup.locator('.sale-print-page-v200');await expect(sheets).toHaveCount(5);
  for(let i=0;i<5;i++){
    const sheet=sheets.nth(i);
    await expect(sheet.locator('h2')).toHaveText('공적자료 배열 검수 '+i);
    await expect(sheet.locator('.js-print-meta')).toContainText('선택 5건');
    await expect(sheet).toHaveAttribute('data-print-fits-v200','true');
    const official=sheet.locator('.sale-print-official').nth(1);
    for(const row of parcel.regulations)for(const item of row.items)await expect(official).toContainText(item.label);
    await expect(official).toContainText('일부 또는 미확인');await expect(official).toContainText('일부 토지정보 미확인');
    await expect(sheet.locator('.sale-print-memo')).toContainText('공적자료와 현장 메모 마지막까지 보존.');
    const layout=await sheet.evaluate(el=>{
      const area=el.querySelector('.sale-print-area-v200').getBoundingClientRect(),content=el.querySelector('.sale-print-content-v200').getBoundingClientRect();
      const zones=[...el.querySelectorAll('.sale-print-zone')].map(zone=>{
        const box=zone.getBoundingClientRect(),label=zone.querySelector('b').getBoundingClientRect(),value=zone.querySelector('span').getBoundingClientRect();
        const range=document.createRange();range.selectNodeContents(zone.querySelector('span'));
        return {stacked:label.bottom<=value.top+.5,fullWidth:value.width>=box.width-1,visible:[...range.getClientRects()].every(r=>r.left>=box.left-.5&&r.right<=box.right+.5&&r.top>=box.top-.5&&r.bottom<=box.bottom+.5)};
      });
      return {zones,scale:Number(el.dataset.printScaleV200),withinSheet:content.bottom<=area.bottom+1&&content.right<=area.right+1};
    });
    expect(layout.zones).toHaveLength(3);expect(layout.zones.every(z=>z.stacked&&z.fullWidth&&z.visible)).toBe(true);
    expect(layout.withinSheet).toBe(true);expect(layout.scale).toBe(1);
  }
  if(!isMobile){
    const bytes=await popup.pdf({path:info.outputPath('five-buildings-land-layout-v212.pdf'),preferCSSPageSize:true,printBackground:true});
    expect([...bytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length).toBe(5);
  }
  await popup.screenshot({path:info.outputPath('five-buildings-land-layout-v212.png'),fullPage:true});
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);await popup.close();
});
