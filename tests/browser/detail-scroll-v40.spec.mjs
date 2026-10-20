import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.emulateMedia({reducedMotion:'reduce'});
});
async function open(page,isMobile,market){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item-building-name').first().click();
  await expect(page.locator('#unifiedDetailDrawerV8')).toHaveAttribute('aria-hidden','false');
}
async function addHistory(page){await page.evaluate(()=>{
  const panel=document.querySelector('[data-sale-section="publicland"]');
  JSLandPriceHistoryV39.mount(panel,'3017010800100030003',async()=>({ok:true,pnu:'3017010800100030003',address:'검수용 필지',fetchedAt:new Date().toISOString(),records:Array.from({length:37},(_,i)=>({baseYear:1990+i,baseMonth:1,wonPerM2:200000+i*20000}))}),()=>true);
});await expect(page.locator('.land-price-history-v39 svg')).toHaveCount(1);}

for(const graph of [false,true])test('sale scroll avoids repeated layout scans and unchanged menu writes'+(graph?' with history':''),async({page,isMobile},info)=>{
  await open(page,isMobile,'building_sale');
  if(graph)await addHistory(page);
  await page.locator('#unifiedDetailBodyV8').evaluate(async root=>{
    // A long advertisement is representative of the reported reading path.
    const description=root.querySelector('.unified-detail-summary-v8');
    const text=document.createElement('p');text.textContent='검수용 매물 설명과 현장 확인 정보. '.repeat(500);description.append(text);
    root.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const before=(await cdp.send('Performance.getMetrics')).metrics;
  await page.evaluate(()=>{
    const root=document.getElementById('unifiedDetailBodyV8'),nav=document.querySelector('.sale-dossier-nav-v3');
    window.__scrollAudit={rectReads:0,menuWrites:0,events:0};
    const original=Element.prototype.getBoundingClientRect;
    window.__restoreRect=()=>Element.prototype.getBoundingClientRect=original;
    Element.prototype.getBoundingClientRect=function(){if(this===root||this.hasAttribute('data-sale-section')&&root.contains(this))window.__scrollAudit.rectReads++;return original.call(this);};
    root.addEventListener('scroll',()=>window.__scrollAudit.events++,{passive:true});
    new MutationObserver(records=>window.__scrollAudit.menuWrites+=records.length).observe(nav,{subtree:true,attributes:true,attributeFilter:['aria-current']});
  });
  // Real wheel input, followed by a continuous reading pass in animation frames.
  const bounds=await page.locator('#unifiedDetailBodyV8').boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,200);
  await page.locator('#unifiedDetailBodyV8').evaluate(async root=>{
    for(let i=0;i<70;i++){root.scrollTop+=8;await new Promise(resolve=>requestAnimationFrame(resolve));}
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  const audit=await page.evaluate(()=>{window.__restoreRect();return window.__scrollAudit;});
  const after=(await cdp.send('Performance.getMetrics')).metrics;
  const metrics=Object.fromEntries(['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration'].map(name=>[name,after.find(m=>m.name===name).value-before.find(m=>m.name===name).value]));
  console.log(JSON.stringify({project:info.project.name,graph,...audit,...metrics}));
  await info.attach('scroll-audit',{body:JSON.stringify({audit,metrics}),contentType:'application/json'});
  expect(audit.events).toBeGreaterThan(35);
  expect(audit.menuWrites).toBeLessThan(16);
  expect(audit.rectReads).toBeLessThan(80);
});

test('history hover does not rebuild unchanged point information while the pointer moves',async({page,isMobile})=>{
  await open(page,isMobile,'land_sale');await addHistory(page);
  const chart=page.locator('.land-price-history-v39');await chart.locator('[data-history-range="all"]').click();
  const point=chart.locator('[data-history-point]').nth(18);await point.scrollIntoViewIfNeeded();
  const bounds=await point.boundingBox(),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  await page.mouse.move(x,y);await expect(chart.locator('[data-history-tip]')).toBeVisible();
  await chart.evaluate(el=>{window.__historyWrites=0;new MutationObserver(records=>window.__historyWrites+=records.length).observe(el,{subtree:true,childList:true,attributes:true});});
  await page.mouse.move(x+1,y,{steps:24});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>window.__historyWrites)).toBeLessThan(5);
  await page.mouse.move(x+40,y);await expect(chart.locator('[data-history-tip]')).not.toContainText('2008.01');
  await page.mouse.move(0,0);await expect(chart.locator('[data-history-tip]')).toBeHidden();
});

test('a phone swipe over the history graph scrolls the detail while a tap still selects a price',async({page,isMobile})=>{
  test.skip(!isMobile,'Touch scrolling is exercised on the phone project.');
  await open(page,isMobile,'land_sale');await addHistory(page);
  const svg=page.locator('.land-price-history-v39 svg');await svg.scrollIntoViewIfNeeded();
  const bounds=await svg.boundingBox(),body=page.locator('#unifiedDetailBodyV8'),top=await body.evaluate(el=>el.scrollTop);
  const cdp=await page.context().newCDPSession(page),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*12}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(top+30);
  await expect(page.locator('[data-history-tip]')).toBeHidden();
  await svg.locator('[data-history-point]').last().tap();
  await expect(page.locator('[data-history-tip]')).toBeVisible();
  await expect(page.locator('[data-history-tip]')).toContainText('2026.01');
});

for(const market of ['building_sale','land_sale'])test(market+' navigation stays accurate after disclosure, late content, resize and reopening',async({page,isMobile})=>{
  await open(page,isMobile,market);
  const body=page.locator('#unifiedDetailBodyV8'),nav=page.locator('#unifiedDetailDrawerV8 > .sale-dossier-nav-v3');
  await body.evaluate(root=>{const disclosure=document.createElement('details');disclosure.innerHTML='<summary>검수용 추가 설명</summary><p style="height:700px">늦게 표시된 설명</p>';root.querySelector('.unified-detail-summary-v8').append(disclosure);disclosure.open=true;});
  await page.setViewportSize({width:isMobile?360:1500,height:800});
  await nav.getByRole('button',{name:'공적자료',exact:true}).click();
  await expect(nav.getByRole('button',{name:'공적자료',exact:true})).toHaveAttribute('aria-current','location');
  await expect(body.locator('[data-sale-section="register"] > header, [data-sale-section="publicland"] > header').first()).toBeInViewport();
  await nav.getByRole('button',{name:'매입검토',exact:true}).click();
  await expect(nav.getByRole('button',{name:'매입검토',exact:true})).toHaveAttribute('aria-current','location');
  await expect(body.locator('.sale-evidence-calculation-v36 > header')).toBeInViewport();
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  await expect(page.locator('.sale-dossier-nav-v3')).toHaveCount(0);
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-BUILDING'));
  await expect(page.locator('.sale-dossier-nav-v3')).toHaveCount(1);
  await expect(page.locator('#unifiedDetailBodyV8')).toHaveJSProperty('scrollTop',0);
});
