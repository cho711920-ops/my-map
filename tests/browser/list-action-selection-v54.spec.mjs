import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile('js/map.js','utf8');
const ast=ts.createSourceFile('map.js',source,ts.ScriptTarget.Latest,true);
const selector=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='selectListingOnMapV844').getText(ast);
const card=(page,id)=>page.locator('#list .item[data-property-id="'+id+'"]');
test.beforeEach(async({page,context,isMobile})=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  if(isMobile){
    // This scenario uses the list beside an open detail. Portrait phones use
    // a covering full-screen detail, so exercise their supported wide layout.
    await page.setViewportSize({width:930,height:530});
    await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
    await page.evaluate(()=>JSMapListPanelV1.open());
  }
  await page.locator('#fixtureControls').evaluate(el=>el.remove());
  await page.addScriptTag({content:selector});
  await page.evaluate(()=>{
    window.overlays=allItems.map(item=>({__cluster:{key:'cluster-'+item.propertyId,items:[item]}}));
    window.multiClusterMode=false;window.redrawSelectedMarkers=()=>{};
    window.__lastRoadviewKey=null;window.openKakaoRoadview=key=>{window.__lastRoadviewKey=decodeURIComponent(key);};
  });
});
async function selectFirst(page){
  await card(page,'FIXTURE-LEASE-1').click({position:{x:220,y:25}});
  await expect(card(page,'FIXTURE-LEASE-1')).toHaveClass(/\bselected\b/);
  await expect(page.locator('#unifiedDetailDrawerV8')).toHaveClass(/open/);
  await expect(page.locator('#unifiedDetailSubtitleV8')).toContainText('원본');
}
test('another card memo becomes the highlighted target and closes the old detail without a new detail read',async({page})=>{
  await selectFirst(page);
  const reads=[];page.on('request',r=>{if(r.url().includes('/api/data')&&r.url().includes('unifiedListingDetail'))reads.push(r.url());});
  const before=await page.evaluate(()=>({count:visibleListItems.length,checks:selectedPrintKeys.slice(),sidebar:document.getElementById('sidebar').scrollTop}));
  await card(page,'FIXTURE-LEASE-2').getByRole('button',{name:'메모 열기',exact:true}).click();
  await expect(card(page,'FIXTURE-LEASE-2')).toHaveClass(/\bselected\b/);
  await expect(card(page,'FIXTURE-LEASE-1')).not.toHaveClass(/\bselected\b/);
  await expect(page.locator('#unifiedDetailDrawerV8')).not.toHaveClass(/open/);
  await expect(card(page,'FIXTURE-LEASE-2').locator('.item-memo-panel')).toBeVisible();
  expect(await page.evaluate(()=>({count:visibleListItems.length,checks:selectedPrintKeys.slice(),sidebar:document.getElementById('sidebar').scrollTop}))).toEqual(before);
  expect(reads).toEqual([]);
  expect(await page.evaluate(()=>selectedGroupKey)).toBe('cluster-FIXTURE-LEASE-2');
});
test('roadview and navigation buttons move highlight before their own handler runs; a re-render retains the target',async({page})=>{
  await selectFirst(page);
  await card(page,'FIXTURE-LEASE-2').getByRole('button',{name:'로드뷰',exact:true}).click();
  expect(await page.evaluate(()=>({key:__lastRoadviewKey,selected:selectedListCardIdV845}))).toEqual({key:'fixture-lease-2',selected:'property:FIXTURE-LEASE-2'});
  await expect(card(page,'FIXTURE-LEASE-2')).toHaveClass(/\bselected\b/);
  await expect(page.locator('#unifiedDetailDrawerV8')).not.toHaveClass(/open/);
  await page.evaluate(()=>{showList(visibleListItems);window.openKakaoNavigation=key=>{window.__navigationSelected=selectedListCardIdV845;};});
  await expect(card(page,'FIXTURE-LEASE-2')).toHaveClass(/\bselected\b/);
  await card(page,'FIXTURE-LEASE-1').getByRole('button',{name:'카카오내비',exact:true}).click();
  expect(await page.evaluate(()=>__navigationSelected)).toBe('property:FIXTURE-LEASE-1');
  await expect(card(page,'FIXTURE-LEASE-2')).not.toHaveClass(/\bselected\b/);
});
test('checkbox selection stays independent and repeat memo toggles do not toggle or fetch details',async({page})=>{
  await selectFirst(page);
  await card(page,'FIXTURE-LEASE-2').locator('input[type="checkbox"]').check();
  await expect(card(page,'FIXTURE-LEASE-1')).toHaveClass(/\bselected\b/);
  const checked=await page.evaluate(()=>selectedPrintKeys.slice());
  await card(page,'FIXTURE-LEASE-2').getByRole('button',{name:'메모 열기',exact:true}).click();
  await card(page,'FIXTURE-LEASE-2').getByRole('button',{name:'메모 닫기',exact:true}).click();
  await expect(card(page,'FIXTURE-LEASE-2')).toHaveClass(/\bselected\b/);
  await expect(card(page,'FIXTURE-LEASE-2').locator('input[type="checkbox"]')).toBeChecked();
  expect(await page.evaluate(()=>selectedPrintKeys)).toEqual(checked);
  await expect(page.locator('#unifiedDetailDrawerV8')).not.toHaveClass(/open/);
});
test('same-key listings are highlighted by their exact card identity and actions do not affect another surface',async({page})=>{
  await page.evaluate(()=>{
    allItems[1].key=allItems[0].key;showList(allItems.filter(item=>item.tradeType==='lease'));
    var holder=document.createElement('div');holder.id='other-surface';holder.style.cssText='position:fixed;top:130px;left:20px;width:500px;background:white;z-index:99999';document.body.append(holder);addListItem(allItems[0],holder);
  });
  await card(page,'FIXTURE-LEASE-2').getByRole('button',{name:'메모 열기',exact:true}).click();
  await expect(card(page,'FIXTURE-LEASE-2')).toHaveClass(/\bselected\b/);
  await expect(card(page,'FIXTURE-LEASE-1')).not.toHaveClass(/\bselected\b/);
  await page.locator('#other-surface .item-roadview-btn').click();
  await expect(card(page,'FIXTURE-LEASE-2')).toHaveClass(/\bselected\b/);
});

for(const category of ['building','land'])test(category+' sale actions use the same highlight without changing the market or checks',async({page})=>{
  await page.evaluate(category=>{
    var items=allItems.filter(item=>item.tradeType==='sale');
    items.forEach(item=>{item.saleCategory=category;item.saleDetails={...item.saleDetails,scope:category==='land'?'land':'whole_building'};});
    var groups=Object.fromEntries(items.map(item=>[item.propertyId,[{...item,originalId:item.propertyId+'-ORIGINAL',sourceId:item.propertyId,buildingName:item.name,images:[],photoCount:0}]]));
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups});
    JSListingTradeV1.setMode(category==='land'?'land_sale':'building_sale');showList(items);
    selectListingOnMapV844(items[0]);
  },category);
  await card(page,'FIXTURE-LAND').getByRole('button',{name:'메모 열기',exact:true}).click();
  await expect(card(page,'FIXTURE-LAND')).toHaveClass(/\bselected\b/);
  await expect(card(page,'FIXTURE-BUILDING')).not.toHaveClass(/\bselected\b/);
  expect(await page.evaluate(()=>selectedPrintKeys.length)).toBe(0);
  expect(await page.locator('#list .item').count()).toBe(2);
});
