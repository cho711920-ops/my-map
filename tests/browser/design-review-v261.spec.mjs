import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
test('v261 list reading order and grouped lease facts are visible while the same real photos and actions remain usable',async({page,isMobile},info)=>{
  const writes=[];page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
  await page.route('**/__v261-photo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="#607d8b"/></svg>'}));
  await page.route('**/api/data?**',async route=>{
    if(!['unifiedListings','unifiedListingDetail'].includes(new URL(route.request().url()).searchParams.get('action')))return route.fallback();
    const response=await route.fetch(),data=await response.json();for(const original of data.groups?Object.values(data.groups).flat():data.originals||[])Object.assign(original,{images:['/__v261-photo.svg'],photoCount:1});
    return route.fulfill({response,json:data});
  });
  await page.evaluate(()=>{
    const groups=Object.fromEntries(allItems.map(item=>[item.propertyId,JSUnifiedListingsV8.allOriginals(item.propertyId).map(original=>({...original,images:['/__v261-photo.svg'],photoCount:1}))]));
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups});JSMapListPanelV1.open();document.getElementById('fixtureControls')?.remove();
  });
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  for(const mode of ['lease','building_sale','land_sale']){
    await page.evaluate(mode=>{JSListingTradeV1.setMode(mode);JSMapListPanelV1.open();applyFilter();},mode);
    const card=page.locator('#list .item').first(),image=card.locator('.unified-thumb-v8 img');
    await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth===960)).toBe(true);
    if(mode!=='lease'){
      const geometry=await card.evaluate(card=>{const box=selector=>{const r=card.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom};};return {price:box('.price-main'),address:box('.item-address-room-v650'),area:box('.sale-list-metrics-v16')};});
      expect(geometry.address.top).toBeGreaterThanOrEqual(geometry.price.bottom-1);expect(geometry.area.top).toBeGreaterThanOrEqual(geometry.address.bottom-1);
    }else{
      const room=card.locator('.item-address-room-v650');await expect(room.locator('.price-area')).toHaveCount(0);await expect(room.locator('.item-room-badge')).toBeVisible();await expect(card.locator('.item-price-values-v652>.price-area')).toBeVisible();
      expect(await card.locator('.item-price-values-v652').evaluate(el=>[...el.children].filter(node=>node.matches('.price-main,.price-area,.price-fee,.price-premium')).map(node=>node.className))).toEqual(['price-main','price-area','price-fee','price-premium']);
      await expect(card.locator('.pyeong-mini-badge')).toHaveCount(0);
      const emphasis=await card.evaluate(card=>{const price=card.querySelector('.price-main'),room=card.querySelector('.item-room-badge'),address=card.querySelector('.item-address-text'),bounds=card.getBoundingClientRect(),r=price.getBoundingClientRect();return {price:parseFloat(getComputedStyle(price).fontSize),room:parseFloat(getComputedStyle(room).fontSize),address:parseFloat(getComputedStyle(address).fontSize),weight:Number(getComputedStyle(room).fontWeight),priceInside:r.right<=bounds.right+1};});
      expect(emphasis.price).toBeGreaterThanOrEqual(isMobile?20:26);expect(emphasis.room).toBeGreaterThanOrEqual(16);expect(emphasis.room).toBeGreaterThan(emphasis.address);expect(emphasis.weight).toBeGreaterThanOrEqual(750);expect(emphasis.priceInside).toBe(true);
      if(isMobile)expect(await room.evaluate(el=>el.parentElement.classList.contains('item-compact-head-v650'))).toBe(true);
      await expect(card.locator(isMobile?'.phone-favorite-state-v261':'.lease-favorite-state-v262')).toBeVisible();
      await expect(card.locator(isMobile?'.phone-favorite-state-v261':'.lease-favorite-state-v262')).toHaveText('찜됨 ✓');
      if(!isMobile){const badge=await card.locator('.lease-favorite-state-v262').boundingBox(),thumb=await card.locator('.unified-thumb-v8').boundingBox();expect(badge.height).toBeLessThanOrEqual(22);expect(badge.width).toBeLessThanOrEqual(thumb.width-4);}
      if(!isMobile){
        const geometry=await card.evaluate(card=>{const rect=s=>card.querySelector(s).getBoundingClientRect().toJSON();return {head:rect('.item-compact-head-v650'),address:rect('.item-address-room-v650'),price:rect('.price-line'),actions:rect('.item-action-row'),thumb:rect('.unified-thumb-v8'),card:card.getBoundingClientRect().toJSON()};});
        expect(geometry.address.top).toBeGreaterThanOrEqual(geometry.head.bottom-1);expect(geometry.price.top).toBeGreaterThanOrEqual(geometry.address.bottom-1);expect(geometry.actions.top).toBeGreaterThanOrEqual(geometry.price.bottom-1);
        expect(geometry.card.height).toBeLessThanOrEqual(128);expect(geometry.thumb.height).toBeGreaterThanOrEqual(106);expect(geometry.thumb.width).toBeGreaterThanOrEqual(90);
      }
      expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      if(!isMobile)expect(await card.evaluate(card=>{const bounds=card.getBoundingClientRect();return [...card.querySelectorAll('.item-action-row button')].filter(b=>b.getBoundingClientRect().width>0).every(b=>{const r=b.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom+1&&r.right<=bounds.right+1;});})).toBe(true);
    }
    await page.screenshot({path:info.outputPath(mode+'-list.png')});
    await card.locator('.item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toBeVisible();
    const hero=drawer.locator('.unified-detail-hero-v8 img');await expect.poll(()=>hero.evaluate(img=>img.complete&&img.naturalWidth===960)).toBe(true);
    if(mode==='lease'){
      const photo=await hero.boundingBox();expect(photo.width).toBeGreaterThanOrEqual(isMobile?320:400);
      const facts=drawer.locator('.wide-detail-lease-v26');await expect(facts.locator('dd')).toHaveCount(4);
      const height=await facts.evaluate(el=>el.getBoundingClientRect().height);expect(height).toBeLessThan(isMobile?190:160);
      const media=await drawer.locator('.wide-detail-media-v26').boundingBox(),conditions=await facts.boundingBox();expect(conditions.y).toBeGreaterThanOrEqual(media.y+media.height-1);
      expect(Math.abs(conditions.width-media.width)).toBeLessThanOrEqual(2);
      if(!isMobile)for(const width of [1794,1280]){
        await page.setViewportSize({width,height:1000});
        expect(await facts.locator('.wide-detail-prices-v26 strong').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1))).toBe(true);
        const geometry=await drawer.evaluate(drawer=>{const r=s=>drawer.querySelector(s).getBoundingClientRect().toJSON();return{card:drawer.getBoundingClientRect().toJSON(),media:r('.wide-detail-media-v26'),facts:r('.wide-detail-lease-v26'),primary:r('.wide-detail-primary-v26'),metadata:[...drawer.querySelectorAll('.unified-detail-source-row-v827>*:not(:empty),.unified-detail-source-address-v827>.unified-detail-meta-v8')].map(el=>el.getBoundingClientRect().toJSON()),rows:[...drawer.querySelectorAll('.wide-detail-prices-v26>div,.wide-detail-facts-v26>div')].map(el=>el.getBoundingClientRect().toJSON()),fonts:[...drawer.querySelectorAll('.wide-detail-facts-v26 dd')].map(el=>parseFloat(getComputedStyle(el).fontSize))};});
        if(width===1794){expect(geometry.card.width).toBeGreaterThanOrEqual(858);expect(geometry.card.width).toBeLessThanOrEqual(862);expect(geometry.media.width).toBeGreaterThanOrEqual(620);expect(geometry.facts.left).toBeGreaterThanOrEqual(geometry.media.right+10);expect(Math.abs(geometry.facts.top-geometry.media.top)).toBeLessThanOrEqual(2);for(let i=1;i<geometry.rows.length;i++)expect(geometry.rows[i].top).toBeGreaterThanOrEqual(geometry.rows[i-1].bottom);for(const rect of geometry.metadata){expect(rect.left).toBeGreaterThanOrEqual(geometry.primary.left-1);expect(rect.right).toBeLessThanOrEqual(geometry.primary.right+1);}expect(geometry.fonts.every(size=>size>=16)).toBe(true);}
        else{expect(geometry.facts.top).toBeGreaterThanOrEqual(geometry.media.bottom-1);expect(Math.abs(geometry.facts.width-geometry.media.width)).toBeLessThanOrEqual(2);}
      }
    }
    await page.screenshot({path:info.outputPath(mode+'-detail.png')});await drawer.locator('header button[aria-label="상세매물보기 닫기"]').click();
  }
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);
});
test('v261 lease comma input marks changes, removes reverted marks, rejects invalid grouping and cancels without writes',async({page},info)=>{
  const before=await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1');openPropertyEditModalV630(encodeURIComponent('id:'+item.propertyId));return JSON.stringify(allItems);});
  const money=page.locator('#peDepositV630');await expect(money).toHaveValue('2,000');await expect(money).not.toHaveClass(/review-changed/);
  await money.fill('3,000');await expect(money).toHaveClass(/review-changed/);await money.fill('2000');await expect(money).not.toHaveClass(/review-changed/);
  await money.fill('1,00');expect(await money.evaluate(el=>el.checkValidity())).toBe(false);
  await page.locator('#propertyEditSaveBtnV630').click();expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await money.fill('.5');expect(await money.evaluate(el=>el.checkValidity())).toBe(true);expect(await money.evaluate(el=>JSDesignReviewV261.moneyNumber(el.value))).toBe(0.5);
  await money.fill('3000.25');await page.locator('#peMemoV630').click();await expect(money).toHaveValue('3,000.25');
  await page.screenshot({path:info.outputPath('lease-edit.png')});await page.locator('#propertyEditModalV630 button[aria-label="닫기"]').click();
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
});
test('v261 building comma basis calculates and saves exact numeric values only to its selected master',async({page},info)=>{
  await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');JSMapListPanelV1.open();window.schedulePropertyEditReloadV634=()=>{};});
  const row=await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');return {property_id:item.propertyId,title:item.name,address:item.address,room:item.room,listing_type:item.type,status:'active',trade_type:'sale',sale_category:'building',sale_price:270000,sale_details_json:JSON.stringify({totalDeposit:155800,loanAmount:55000,investmentAmount:null,manualSaleFieldsV1:['investmentAmount']})};});
  const writes=[];await page.route('**/api/data**',route=>{
    const request=route.request(),body=request.method()==='POST'?request.postDataJSON():{},action=body.action||new URL(request.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);return route.fulfill({status:503,json:{ok:false,message:'가상 저장 실패'}});}return route.fallback();
  });
  await page.locator('#list .item[data-property-id="FIXTURE-BUILDING"] .item-edit-btn-v630').click();
  const dialog=page.locator('.sale-property-edit-v1'),price=dialog.locator('[data-sale-edit="salePrice"]');
  await expect(price).toHaveValue('270,000');await expect(dialog.locator('[data-sale-edit="investmentAmount"]')).toHaveValue('59,200');
  await price.fill('280,000');await expect(dialog.locator('[data-sale-money-preview="investmentAmount"]')).toHaveText('6억 9,200만원');
  await page.screenshot({path:info.outputPath('building-edit.png')});await dialog.locator('[data-sale-edit-save]').click();
  await expect.poll(()=>writes.length).toBe(1);expect(writes[0].key.propertyId).toBe('FIXTURE-BUILDING');
  expect(writes[0].saleEdit.patch).toMatchObject({salePrice:280000,totalDeposit:155800,loanAmount:55000,investmentAmount:69200});
  expect(writes[0].saleEdit.investmentCalculationV235).toMatchObject({salePrice:'280000',totalDeposit:'155800',loanAmount:'55000'});
  await expect(dialog).toBeVisible();await expect(price).toHaveValue('280,000');
});
test('v261 contact groups keep landlord-side roles together and every original telephone target',async({page},info)=>{
  await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1');item.memo='임대인 01011112222 / 사모 01033334444 / 관리 0421234567 / 세입자 01055556666';openListContactPopupV654(encodeURIComponent('id:'+item.propertyId));});
  const popup=page.locator('#listContactBodyV654');await expect(popup.locator('.list-contact-group-v261')).toHaveText(['임대인측 2명','관리 1명','세입자 1명']);
  expect(await popup.locator('a').evaluateAll(links=>links.map(a=>a.getAttribute('href')).sort())).toEqual(['tel:01011112222','tel:01033334444','tel:01055556666','tel:0421234567'].sort());
  await page.screenshot({path:info.outputPath('contact-groups.png')});
});
test('v261 search highlights literal space-insensitive comma terms, clears marks and never edits names, memo or images',async({page})=>{
  const result=await page.evaluate(()=>{
    JSMapListPanelV1.open();const item=allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1');item.name='검색 <표시> 상가';item.memo='메모 <표시> 그대로';item.address='서구 가장동 61-2';
    const before=JSON.stringify(item);jsLastAppliedKeywordV1='<표시>';showList([item]);
    const card=document.querySelector('#list .item'),marks=Array.from(card.querySelectorAll('mark.search-match-v261')).map(mark=>mark.textContent),photo=card.querySelector('img');
    const originalPhoto=photo?.currentSrc||photo?.src||'',cases=[];
    for(const keyword of ['가장동61-2','가장동61-2, <표시>','가장동,가장동61-2']){jsLastAppliedKeywordV1=keyword;JSDesignReviewV261.list(document.getElementById('list'));cases.push([...card.querySelectorAll('mark.search-match-v261')].map(mark=>mark.textContent));}
    jsLastAppliedKeywordV1='';JSDesignReviewV261.list(document.getElementById('list'));
    return {before,after:JSON.stringify(item),marks,cases,remaining:card.querySelectorAll('mark.search-match-v261').length,photo:originalPhoto,afterPhoto:photo?.currentSrc||photo?.src||''};
  });
  expect(result.marks).toEqual(['<표시>']);expect(result.remaining).toBe(0);expect(result.after).toBe(result.before);expect(result.afterPhoto).toBe(result.photo);
  expect(result.cases).toEqual([['가장동 61-2'],['<표시>','가장동 61-2'],['가장동 61-2']]);
});
test('v261 availability selection is exclusive, persists and reselecting the active mode does no work',async({page})=>{
  const result=await page.evaluate(()=>{
    let calls=0;const real=refreshDoneViewFilterV656;window.refreshDoneViewFilterV656=function(){calls++;real();};
    const values=[];for(const mode of ['all','only','hide']){JSDesignReviewV261.view(mode);JSDesignReviewV261.view(mode);values.push({hide:hideDone,only:doneOnly,saved:localStorage.getItem(doneViewStorageKeyV656)});}
    return {calls,values};
  });
  expect(result.calls).toBe(3);expect(result.values).toEqual([{hide:false,only:false,saved:'all'},{hide:false,only:true,saved:'only'},{hide:true,only:false,saved:'hide'}]);
});
test('v261 memo save and cancel precede the same draft textarea without changing its contents',async({page},info)=>{
  const before=await page.evaluate(()=>{JSMapListPanelV1.open();const item=allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1');showList([item]);beginMemoEdit(encodeURIComponent(memoItemKeyV104(item)));return item.memo;});
  const panel=page.locator('#list .item-memo-panel.editing');await expect(panel.locator('textarea')).toHaveValue(before);
  expect(await panel.evaluate(el=>el.querySelector('.item-memo-actions').compareDocumentPosition(el.querySelector('textarea'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await page.screenshot({path:info.outputPath('memo-buttons.png')});await panel.getByRole('button',{name:'취소',exact:true}).click();
  expect(await page.evaluate(()=>allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1').memo)).toBe(before);
});
test('v263 original rows restore compact pre-review conditions and still open the exact original',async({page,isMobile},info)=>{
  const groups=await page.evaluate(()=>Object.fromEntries(allItems.map(item=>[item.propertyId,JSUnifiedListingsV8.allOriginals(item.propertyId)])));
  const first=groups['FIXTURE-LEASE-1'][0];groups['FIXTURE-LEASE-1']=[{...first,originalId:'V261-ONE',sourceId:'v261-one',providerSourceId:'v261-one',link:first.link+'?ad=one',deposit:2000,rent:90,area:25},{...first,originalId:'V261-TWO',sourceId:'v261-two',providerSourceId:'v261-two',link:first.link+'?ad=two',deposit:2000,rent:110,area:35}];
  await page.route('**/api/data**',route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action');
    if(action==='unifiedListings')return route.fulfill({json:{ok:true,groups,sourceSearchIds:{}}});
    if(action==='unifiedListingDetail')return route.fulfill({json:{ok:true,originals:groups[url.searchParams.get('propertyId')]||[]}});return route.fallback();
  });
  await page.evaluate(async()=>{const result=await JSUnifiedListingsV8.load(true);JSUnifiedListingsV8.attach(allItems,result);JSMapListPanelV1.open();applyFilter();JSUnifiedListingsV8.open(encodeURIComponent('FIXTURE-LEASE-1'),encodeURIComponent('V261-ONE'));});
  const rows=page.locator('#unifiedDetailDrawerV8 .unified-detail-originals-v8');await expect(rows.locator('.unified-original-row-v8')).toHaveCount(2);
  await expect(rows.locator('.original-conditions-v261,[data-compare-key-v261],.different-v261')).toHaveCount(0);
  await expect(rows.locator('.unified-original-row-v8').first()).toContainText('보 2,000 / 월 90 · 관 0 · 권 0 · 평 25');
  await expect(rows.locator('.unified-original-row-v8').nth(1)).toContainText('보 2,000 / 월 110 · 관 0 · 권 0 · 평 35');
  await page.screenshot({path:info.outputPath('original-comparison.png')});await rows.locator('[data-original-id="V261-TWO"]').click();
  await expect(page.locator('#unifiedDetailDrawerV8 .wide-detail-prices-v26')).toContainText('110만원');
  expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals('FIXTURE-LEASE-1').map(i=>i.originalId))).toEqual(['V261-ONE','V261-TWO']);
  if(!isMobile){
    await page.locator('#unifiedDetailDrawerV8 header button[aria-label="상세매물보기 닫기"]').click();
    await page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]').getByRole('button',{name:'동일매물 2개',exact:true}).click();
    const inline=page.locator('#list .unified-inline-originals-v8');await expect(inline.locator('[data-compare-key-v261]')).toHaveCount(0);await expect(inline).toContainText('보 2,000 / 월 90 · 관 0 · 권 0 · 평 25');
  }
});
test('v261 all market filters keep visible labels and an application footer within short screens',async({page,isMobile},info)=>{
  for(const mode of ['lease','building_sale','land_sale']){
    await page.evaluate(mode=>{JSListingTradeV1.setMode(mode);JSMapListPanelV1.open();toggleDetailFilter();},mode);
    const root=page.locator(isMobile?'#v6DetailSheetPortal.open':'#detailFilter.open');await expect(root).toBeVisible();
    if(!isMobile)expect(await root.locator('input[aria-label$="최대"]').first().evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el;})).toBe(true);
    const result=await root.evaluate(root=>{
      const buttons=Array.from(root.querySelectorAll('button')).filter(button=>button.textContent==='필터 적용'&&button.getBoundingClientRect().width>0),button=buttons[0];
      const scroller=root.querySelector('.v6-detail-sheet-body,.detail-filter-fields-v261');scroller.scrollTop=scroller.scrollHeight;
      const rect=button.getBoundingClientRect();return {visible:rect.top>=0&&rect.bottom<=innerHeight,scrolls:scroller.scrollHeight>=scroller.clientHeight,overflows:scroller.scrollWidth>scroller.clientWidth+1};
    });expect(result.visible).toBe(true);expect(result.scrolls).toBe(true);expect(result.overflows).toBe(false);
    await expect(root.locator('.review-range-name-v263').first()).toContainText(mode==='lease'?'보증금':'매매가');await expect(root.locator('.review-range-name-v263').first()).toContainText('만원');
    const alignment=await root.evaluate(root=>[...root.querySelectorAll('.review-range-row-v263')].filter(row=>row.getBoundingClientRect().width>0&&!row.classList.contains('review-range-single-v263')).map(row=>{const fields=[...row.querySelectorAll('input')],label=row.querySelector('.review-range-name-v263'),a=fields[0].getBoundingClientRect(),b=fields[1].getBoundingClientRect(),n=label.getBoundingClientRect();return{min:a.left,max:b.left,topDelta:Math.abs(a.top-b.top),nameBefore:n.right<=a.left+1,unit:!!label.querySelector('small')};}));
    expect(alignment.length).toBeGreaterThanOrEqual(mode==='lease'?5:3);for(const row of alignment){expect(row.nameBefore).toBe(true);expect(row.unit).toBe(true);expect(row.topDelta).toBeLessThanOrEqual(1);expect(Math.abs(row.min-alignment[0].min)).toBeLessThanOrEqual(1);expect(Math.abs(row.max-alignment[0].max)).toBeLessThanOrEqual(1);}
    await page.screenshot({path:info.outputPath(mode+'-filter.png')});
    await page.keyboard.press('Escape');
  }
});
