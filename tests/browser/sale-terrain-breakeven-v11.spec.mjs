import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value,view='list'){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="'+view+'"]').click();}
async function mapSpy(page,terrain=true){await page.evaluate(hasTerrain=>{
  window.__terrainCalls=[];window.kakao=window.kakao||{};window.kakao.maps=window.kakao.maps||{};kakao.maps.MapTypeId={ROADMAP:1,HYBRID:3,USE_DISTRICT:8,...(hasTerrain?{TERRAIN:4}:{})};let type=1;
  Object.assign(map,{getCenter:()=>({toString:()=>'36.35,127.38'}),getMapTypeId:()=>type,setMapTypeId:n=>{type=n;__terrainCalls.push(['base',n]);},addOverlayMapTypeId:n=>__terrainCalls.push(['add',n]),removeOverlayMapTypeId:n=>__terrainCalls.push(['remove',n])});
},terrain);}
test('terrain is opt-in on land only and restores overlays without moving clusters or modifying listings',async({page,isMobile},info)=>{
  await mapSpy(page);await mode(page,isMobile,'land_sale','map');await page.locator(isMobile?'#saleMapViewsPhoneBtnV45':'#saleMapViewsBtnV45').click();const controls=page.locator('#saleMapViewsV3'),terrain=controls.locator('[data-sale-map-view="terrain"]');await expect(terrain).toBeVisible();expect(await page.evaluate(()=>__terrainCalls.length)).toBe(0);
  const before=await page.evaluate(()=>JSON.stringify({items:allItems,center:map.getCenter().toString(),level:map.getLevel(),keys:overlays.map(o=>o.__cluster.key)}));
  await terrain.click();await expect(terrain).toHaveAttribute('aria-pressed','true');await expect(controls.locator('[data-sale-terrain-note]')).toBeVisible();
  await controls.locator('[data-sale-map-view="district"]').click();await controls.locator('[data-sale-map-view="satellite"]').click();await expect(terrain).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>JSON.stringify({items:allItems,center:map.getCenter().toString(),level:map.getLevel(),keys:overlays.map(o=>o.__cluster.key)}))).toBe(before);
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await controls.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
  await page.screenshot({path:info.outputPath('land-terrain.png'),animations:'disabled'});
  await terrain.click();await expect(terrain).toHaveAttribute('aria-pressed','false');await terrain.click();await mode(page,isMobile,'building_sale','map');await expect(terrain).toBeHidden();await expect(controls.locator('[data-sale-terrain-note]')).toBeHidden();
  const calls=await page.evaluate(()=>JSON.stringify(__terrainCalls));await page.evaluate(()=>JSSalePropertyWorkspaceV3.choose('terrain'));expect(await page.evaluate(()=>JSON.stringify(__terrainCalls))).toBe(calls);
  await mode(page,isMobile,'land_sale','map');await expect(terrain).toHaveAttribute('aria-pressed','false');await mode(page,isMobile,'lease','map');
  await expect(controls).toBeHidden();expect(await page.evaluate(()=>__terrainCalls)).toEqual([['add',4],['add',8],['base',3],['remove',4],['add',4],['remove',4],['remove',8],['base',1]]);
});
test('unavailable terrain support shows a retry message and never pretends the layer is active',async({page,isMobile})=>{
  await mapSpy(page,false);await mode(page,isMobile,'land_sale','map');await page.locator(isMobile?'#saleMapViewsPhoneBtnV45':'#saleMapViewsBtnV45').click();const controls=page.locator('#saleMapViewsV3');await controls.locator('[data-sale-map-view="terrain"]').click();await expect(controls.locator('[data-sale-map-status]')).toContainText('지형도를 준비하지 못했습니다');await expect(controls.locator('[data-sale-map-view="terrain"]')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>__terrainCalls.length)).toBe(0);
  await mode(page,isMobile,'building_sale','map');await expect(controls.locator('[data-sale-map-status]')).toBeEmpty();
});
test('building break-even rates update independently, keep assumptions untouched and stay absent on land',async({page,isMobile},info)=>{
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))writes++;});
  await mode(page,isMobile,'building_sale');const before=await page.evaluate(()=>JSON.stringify(allItems));await page.locator('#list .item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');await drawer.locator('[data-sale-action="worksheet"]').click();const dialog=page.locator('#saleWorkbenchDialogV1');
  for(const [key,value] of Object.entries({price:'50000',deposit:'5000',income:'250',loan:'12000',interest:'4',vacancy:'5',expense:'10',acquisition:'1000'}))await dialog.locator('[data-calc="'+key+'"]').fill(value);
  const section=dialog.locator('.sale-break-even-v11');await expect(section.locator('[data-break-even="vacancy"] strong')).toHaveText('80%');await expect(section.locator('[data-break-even="interest"] strong')).toHaveText('22.75%');await expect(dialog.locator('[data-calc-result]')).toContainText('187.5만원');
  await dialog.locator('[data-calc="interest"]').fill('6');await expect(section.locator('[data-break-even="vacancy"] strong')).toHaveText('72%');await expect(section.locator('[data-break-even="interest"] strong')).toHaveText('22.75%');await expect(dialog.locator('[data-calc="vacancy"]')).toHaveValue('5');
  await dialog.locator('[data-calc="vacancy"]').fill('10');await expect(section.locator('[data-break-even="interest"] strong')).toHaveText('21.5%');await expect(dialog.locator('[data-calc="interest"]')).toHaveValue('6');
  if(isMobile)await page.setViewportSize({width:320,height:720});await section.scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('building-break-even.png')});
  expect(writes).toBe(0);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await dialog.locator('[data-sale-close]').click();await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();await mode(page,isMobile,'land_sale');await page.locator('#list .item-building-name').click();await drawer.locator('[data-sale-action="worksheet"]').click();await expect(page.locator('.sale-break-even-v11')).toHaveCount(0);
});
test('zero, negative, out-of-range and incomplete assumptions cannot leave misleading threshold numbers',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');await page.locator('#list .item-building-name').click();await page.locator('[data-sale-action="worksheet"]').click();const d=page.locator('#saleWorkbenchDialogV1');
  for(const [key,value] of Object.entries({loan:'0',income:'200',interest:'6',vacancy:'10',expense:'150'}))await d.locator('[data-calc="'+key+'"]').fill(value);
  await expect(d.locator('[data-break-even="interest"]')).toContainText('대출금 0원');await d.locator('[data-calc="loan"]').fill('12000');await expect(d.locator('[data-break-even="vacancy"]')).toContainText('공실 0%여도 월적자');await expect(d.locator('[data-break-even="interest"] strong')).toHaveText('3%');
  await d.locator('[data-calc="income"]').fill('0');await expect(d.locator('[data-break-even="vacancy"]')).toContainText('월 임대수입 0원');await expect(d.locator('[data-break-even="interest"]')).toContainText('금리 0%여도 월적자');
  await d.locator('[data-calc="income"]').fill('');await expect(d.locator('.sale-break-even-v11')).toHaveCount(0);await d.locator('[data-calc="income"]').fill('200');await d.locator('[data-calc="loan"]').fill('100');await d.locator('[data-calc="expense"]').fill('0');await d.locator('[data-calc="vacancy"]').fill('0');await expect(d.locator('[data-break-even="interest"]')).toContainText('0~100% 범위 내 손익분기 없음');
});
