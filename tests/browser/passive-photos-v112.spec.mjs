import {test,expect} from '@playwright/test';

test('unchanged photos keep their decoded image nodes through passive redraws, edits and same-address reorder',async({page,context})=>{
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/original/photo-v112*',route=>{
   requests.push(route.request().url());return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="orange"/></svg>'});
 });
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{
   document.getElementById('fixtureControls').remove();
   allItems=allItems.filter(item=>item.tradeType==='lease');
   allItems.forEach(item=>{item.address='대전 서구 검수동 1-1';});
   window.__v112Groups=Object.fromEntries(allItems.map((item,i)=>[item.propertyId,[{
     ...item,originalId:'photo-original-'+i,thumbnail:location.origin+'/original/photo-v112?id='+i,photoCount:1
   }]]));
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__v112Groups});applyFilter();
 });
 const images=page.locator('#list .unified-thumb-v8 img');
 await expect(images).toHaveCount(2);
 await expect.poll(()=>images.evaluateAll(nodes=>nodes.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
 await page.evaluate(()=>{window.__v112Images=new Map([...document.querySelectorAll('#list .item')].map(card=>[
   card.dataset.propertyId,card.querySelector('.unified-thumb-v8 img')]));window.__v112Loads=0;
   __v112Images.forEach(image=>image.addEventListener('load',()=>__v112Loads++));
 });
 const before=requests.length;
 for(let i=0;i<4;i++)await page.evaluate(()=>applyFilter());
 expect(await page.evaluate(()=>[...document.querySelectorAll('#list .item')].every(card=>
   __v112Images.get(card.dataset.propertyId)===card.querySelector('.unified-thumb-v8 img')))).toBe(true);
 await page.evaluate(()=>{
   allItems=allItems.map(item=>({...item,premium:350,manualFields:['premium']})).reverse();
   JSUnifiedListingsV8.attach(allItems);showList(allItems);
 });
 expect(await page.evaluate(()=>[...document.querySelectorAll('#list .item')].every(card=>
   __v112Images.get(card.dataset.propertyId)===card.querySelector('.unified-thumb-v8 img')))).toBe(true);
 expect(requests.length).toBe(before);expect(await page.evaluate(()=>__v112Loads)).toBe(0);
 await expect(page.locator('#list .item').first()).toContainText('350');
 // A genuinely changed photograph must replace only its own image.
 const changed=await page.evaluate(()=>{
   const id=allItems[0].propertyId;__v112Groups[id][0].thumbnail=location.origin+'/original/photo-v112?id=changed';
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__v112Groups});applyFilter();return id;
 });
 await expect.poll(()=>page.locator('[data-property-id="'+changed+'"] .unified-thumb-v8 img').getAttribute('src')).toContain('id=changed');
 expect(await page.evaluate(id=>document.querySelector('[data-property-id="'+id+'"] .unified-thumb-v8 img')!==__v112Images.get(id),changed)).toBe(true);
 expect(await page.evaluate(id=>[...document.querySelectorAll('#list .item')].filter(card=>card.dataset.propertyId!==id).every(card=>
   __v112Images.get(card.dataset.propertyId)===card.querySelector('.unified-thumb-v8 img')),changed)).toBe(true);
 expect(errors).toEqual([]);
});

test('a personal building cover is retained only while its exact cover URL is unchanged',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/original/cover-v112*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="blue"/></svg>'}));
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{
   document.getElementById('fixtureControls').remove();window.__v112Cover=location.origin+'/original/cover-v112?id=first';
   JSListingCoverV85.urlFor=item=>item.propertyId==='FIXTURE-BUILDING'?__v112Cover:'';
   JSListingTradeV1.setMode('building_sale',{apply:false});applyFilter();
 });
 const image=page.locator('[data-property-id="FIXTURE-BUILDING"] .unified-thumb-v8 img');
 await expect.poll(()=>image.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
 await page.evaluate(()=>{window.__v112CoverImage=document.querySelector('[data-property-id="FIXTURE-BUILDING"] .unified-thumb-v8 img');applyFilter();});
 expect(await image.evaluate(node=>node===__v112CoverImage)).toBe(true);
 await page.evaluate(()=>{__v112Cover=location.origin+'/original/cover-v112?id=second';applyFilter();});
 await expect(image).toHaveAttribute('data-cover-image-v85',/id=second$/);
 expect(await image.evaluate(node=>node!==__v112CoverImage)).toBe(true);
 await expect.poll(()=>image.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
});
