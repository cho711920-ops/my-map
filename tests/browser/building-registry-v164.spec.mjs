import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const p='대전광역시 서구 괴정동 6-3',q='대전광역시 서구 괴정동 6-4';
const empty=()=>({schema:164,buildings:[],contacts:[]});
const common=()=>({id:'C-1',label:'확인 임대인',parcels:[p],memberIds:['B-A','B-B','B-C'],excludedIds:[],autoParcels:[p],phone:'01012345678',baselines:[{id:'B-A',phone:'01012345678',manual:true},{id:'B-B',phone:'',manual:false},{id:'B-C',phone:'01098765432',manual:true}]});
const mapGroup=()=>({id:'G-1',label:'같은 건물',parcels:[p,q],memberIds:['B-A','B-B','B-C','B-D'],excludedIds:[],autoParcels:[p,q],anchor:{lat:36.35,lng:127.38}});
test('all markets keep the map count while removing duplicate list counts and close without empty or overlapping sticky rows',async({page,context,isMobile},info)=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#fixtureControls').evaluate(el=>el.remove());
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  for(const mode of ['lease','building_sale','land_sale','lease']){
    if(isMobile)await page.locator('[data-mobile-view="map"]').click();
    await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(mode);
    await expect(page.locator('#mapListingCountV825')).toBeVisible();
    if(isMobile)await page.locator('[data-mobile-view="list"]').click();
    await expect(page.locator('#list .item').first()).toBeVisible();
    for(const id of ['mapListTitleV1','mapListCloseV1','jsPhoneListCountV2'])await expect(page.locator('#'+id)).toBeHidden();
    if(mode==='lease'){
      await expect(page.locator('#leaseListViewV80')).toBeHidden();
      if(isMobile)await page.locator('#jsMobileSearchFormV1 [data-mobile-action="filter"]').click();
      else await page.locator('#mapQuickViewBtn').click();
      await expect(page.locator('#leaseListViewV80')).toBeVisible();
      await page.locator('[data-lease-list-view="large"]').click();await expect(page.locator('html')).toHaveAttribute('data-lease-list-view-v80','large');
      await page.locator('[data-lease-list-view="small"]').click();
      if(isMobile)await page.locator('#v6DetailSheetPortal .v6-detail-sheet-close').click();
      else await page.locator('#mapQuickViewBtn').click();
    }
    await expect(page.locator('.map-list-panel-head-v1')).toBeHidden();
    await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='scrollExtentV213';spacer.style.height='1400px';document.getElementById('list').append(spacer);});
    const scroller=isMobile?'#list':'#sidebar';await page.locator(scroller).evaluate(el=>{el.scrollTop=500;});
    await expect.poll(()=>page.locator(scroller).evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    if(!isMobile)await expect.poll(()=>page.locator('#listToolbar').evaluate(el=>{
      const side=document.getElementById('sidebar').getBoundingClientRect(),head=document.querySelector('.map-list-panel-head-v1'),expected=side.top+head.offsetHeight;
      return Math.abs(el.getBoundingClientRect().top-expected);
    })).toBeLessThanOrEqual(1);
    await page.locator(scroller).evaluate(el=>{el.scrollTop=0;});await page.locator('#scrollExtentV213').evaluate(el=>el.remove());
    if(mode==='building_sale')await page.screenshot({path:info.outputPath('building-list-header-clean-v213.png')});
  }
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await page.screenshot({path:info.outputPath('list-header-clean-v213.png')});
});
async function setup(page,context,initial=empty(),canManage=true){
  const state={data:structuredClone(initial),version:initial.buildings.length||initial.contacts.length?1:0,writes:[],propertyWrites:[],reads:[],conflict:false,readGate:null,canManage};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await context.route('**/api/data**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():null;
    if(url.searchParams.get('action')==='loadCloudState'&&url.searchParams.get('scope')==='buildingRegistryV164'){
      state.reads.push(url.searchParams.get('expectedAccountEmail'));const response={ok:true,scope:'buildingRegistryV164',recordKey:'default',canManageBuildingGroupsV172:state.canManage,found:!!state.version,version:state.version,data:structuredClone(state.data)};
      if(state.readGate)await state.readGate;return route.fulfill({json:response});
    }
    if(body?.action==='saveCloudState'&&body.scope==='buildingRegistryV164'){
      state.writes.push(body);if(state.conflict||body.expectedVersion!==state.version)return route.fulfill({status:409,json:{ok:false,message:'다른 기기에서 변경',code:'CLOUD_STATE_CONFLICT'}});
      state.data=structuredClone(body.data);state.version++;return route.fulfill({json:{ok:true,persisted:true,queued:false,scope:body.scope,recordKey:body.recordKey,version:state.version}});
    }
    if(body?.action==='updateProperty'||body?.action==='updatePropertyMemo'){
      state.propertyWrites.push(body);return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:body.key?.propertyId||body.propertyId,updated:body.updated,memo:body.memo,contacts:body.contacts,changedFields:body.action==='updateProperty'?['monthly_rent']:['operating_memo']}});
    }
    return route.fallback();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  async function install(){
    await page.locator('#fixtureControls').evaluate(el=>el.remove());
    await page.evaluate(()=>{window.kakao={maps:{load(){},LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}}};});
    await page.addScriptTag({content:await readFile('js/map.js','utf8')});
    await page.evaluate(()=>{
      const base=allItems[0];allItems=[
        {...base,propertyId:'B-A',key:'B-A',name:'건물 1층',address:'대전 서구 괴정동 6-3',room:'1층',landlordPhone:'010-1234-5678',manualFinancialFieldsV106:['landlord_phone']},
        {...base,propertyId:'B-B',key:'B-B',name:'건물 2층',address:'대전 서구 괴정동 6-3',room:'2층',landlordPhone:''},
        {...base,propertyId:'B-C',key:'B-C',name:'다른 임대인',address:'대전 서구 괴정동 6-3',room:'3층',landlordPhone:'010-9876-5432',manualFinancialFieldsV106:['landlord_phone']},
        {...base,propertyId:'B-D',key:'B-D',name:'다른 지번',address:'대전 서구 괴정동 6-4',room:'4층',landlordPhone:''},
        {...base,propertyId:'B-N',key:'B-N',name:'이웃 건물',address:'대전 서구 괴정동 6-30',room:'1층',landlordPhone:''}
      ];allItems.forEach((item,i)=>{item.latitude=36.35+i*0.00001;item.longitude=127.38+i*0.00001;item.latlng=new kakao.maps.LatLng(item.latitude,item.longitude);});
      JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,originalId:item.propertyId+'-AD',sourceId:item.propertyId+'-AD',manualDisplayFields:(item.manualFinancialFieldsV106||[]).join(','),images:[],photoCount:0}]]))});
      window.drawMapClustersOnlyV639=()=>{};window.drawItems=items=>showList(items);applyFilter();JSMapListPanelV1.open();
      map.getLevel=()=>1;map.getCenter=()=>new kakao.maps.LatLng(36.35,127.38);
      window.JSListingRefreshV1={refreshMoved:async()=>true};window.loadSheet=()=>{throw Error('No whole inventory load for building/phone saves');};
    });
    await page.evaluate(()=>JSBuildingRegistryV164.load(true));
  }
  await install();
  return {...state,state,errors,install,reload:async()=>{await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await install();}};
}
const dialog=page=>page.locator('#buildingRegistryDialogV164');
test('three selected clusters retain all 12 distinct masters even when legacy keys are missing',async({page,context})=>{
  const {state}=await setup(page,context);
  await page.evaluate(()=>{
    const base=allItems[1];allItems=Array.from({length:12},(_,i)=>({...base,propertyId:'SELECT-'+i,key:i===0||i===1||i===11?undefined:'legacy-'+i,
      name:'선택 매물 '+i,room:(i+1)+'층',address:i===0?'대전 서구 괴정동 6-4':i===11?'대전 서구 괴정동 6-5':'대전 서구 괴정동 6-3'}));
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,originalId:item.propertyId+'-AD',sourceId:item.propertyId+'-AD',images:[],photoCount:0}]]))});
    overlays=[{__cluster:{key:'one-left',items:allItems.slice(0,1)}},{__cluster:{key:'ten',items:allItems.slice(1,11)}},{__cluster:{key:'one-right',items:allItems.slice(11)}}];
    multiClusterMode=true;selectedGroupKeys=[];window.redrawSelectedMarkers=()=>{};
    openCluster('one-left');openCluster('ten');openCluster('one-right');
  });
  await expect(page.locator('#multiClusterStatus')).toContainText('매물 12개');
  await expectSelectionSummary(page);
  expect(await page.evaluate(()=>visibleListItems.map(i=>i.propertyId).sort())).toEqual(Array.from({length:12},(_,i)=>'SELECT-'+i).sort());
  const groupButton=page.getByRole('button',{name:'같은 건물로 묶기',exact:true});
  await expect(groupButton).toHaveCSS('background-color','rgb(5, 104, 232)');await groupButton.click();
  await expect(dialog(page).locator('[data-member]:checked')).toHaveCount(12);
  await expect(dialog(page).locator('[data-parcel]:checked')).toHaveCount(3);
  await expect(dialog(page).locator('[data-scope-count]')).toHaveText('적용할 매물 12개');
  await expect(dialog(page).locator('[data-save]')).toHaveText('건물로 묶기');
  await saveDialog(page);
  expect(state.data.buildings[0].memberIds).toHaveLength(12);expect(state.propertyWrites).toEqual([]);
  await page.evaluate(()=>openCluster('one-left'));
  await expect(page.locator('#multiClusterStatus')).toContainText('매물 11개');
  await page.evaluate(()=>openCluster('one-left'));
  await expect(page.locator('#multiClusterStatus')).toContainText('매물 12개');
  await page.evaluate(()=>{multiClusterMode=false;selectedGroupKeys=[];updateMultiClusterStatus();});
  await expect(page.locator('#multiClusterStatus')).not.toBeVisible();
});
async function expectSelectionSummary(page){
  if(!await page.evaluate(()=>typeof window.syncMapQuickToolGeometryV659==='function'))await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  await page.evaluate(()=>window.syncMapQuickToolGeometryV659());
  const status=page.locator('#multiClusterStatus');await expect(status).toBeVisible();
  await expect(status.locator('.multi-cluster-mode-v169')).toHaveText('다중선택');
  await expect(status.locator('strong').first()).toHaveCSS('font-size','22px');
  const bounds=await page.evaluate(()=>{
    const rect=id=>{const b=document.getElementById(id).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,height:b.height,width:b.width};};
    return {status:rect('multiClusterStatus'),sidebar:rect('sidebar'),toolbar:rect('listToolbar'),actions:rect('buildingMapActionsV164'),first:document.querySelector('#list .item').getBoundingClientRect().top};
  });
  // Transformed mobile DOMRects can report 58px as 57.999992px. Normalize
  // floating-point noise below 1/1000 CSS pixel, retaining the 58px minimum.
  expect(Math.round(bounds.status.height*1000)/1000).toBeGreaterThanOrEqual(58);expect(bounds.status.y).toBeGreaterThanOrEqual(bounds.toolbar.bottom-1);
  expect(bounds.status.x).toBeGreaterThanOrEqual(bounds.sidebar.x-1);expect(bounds.status.right).toBeLessThanOrEqual(bounds.sidebar.right+1);
  expect(bounds.status.bottom).toBeLessThanOrEqual(bounds.actions.y+1);expect(bounds.actions.bottom).toBeLessThanOrEqual(bounds.first+1);
  expect(bounds.status.y).toBeGreaterThanOrEqual(0);expect(bounds.status.bottom).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));
  expect(await status.locator('.multi-cluster-mode-v169').evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
  const before=await status.textContent();
  const scrollProof=await page.evaluate(()=>{
    const sidebar=document.getElementById('sidebar'),list=document.getElementById('list');
    const spacer=document.createElement('div');spacer.id='scrollExtentV207';spacer.style.height='2400px';spacer.setAttribute('aria-hidden','true');list.append(spacer);const scroller=getComputedStyle(sidebar).overflowY==='hidden'?list:sidebar;scroller.scrollTop=600;
    return {start:scroller.scrollTop,scroller:scroller.id};
  });
  try{
    expect(scrollProof.start).toBeGreaterThan(100);
    await expect.poll(()=>status.evaluate(el=>Math.abs(el.getBoundingClientRect().top-document.getElementById('listToolbar').getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);
    await expect(status).toHaveText(before);
    const sticky=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect(),status=rect('multiClusterStatus'),actions=rect('buildingMapActionsV164'),toolbar=rect('listToolbar');
      const button=document.querySelector('#buildingMapActionsV164 button'),b=button.getBoundingClientRect();
      return {noOverlap:status.top>=toolbar.bottom-1&&actions.top>=status.bottom-1,buttonHit:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};
    });
    expect(sticky).toEqual({noOverlap:true,buttonHit:true});
  }finally{await page.evaluate(({scroller})=>{document.getElementById(scroller).scrollTop=0;document.getElementById('scrollExtentV207').remove();},scrollProof);}

}
test('selection summary stays in the list on a touch tablet in either orientation',async({browser},testInfo)=>{
  const landscape=testInfo.project.name==='desktop',viewport=landscape?{width:1280,height:720}:{width:800,height:1280};
  const context=await browser.newContext({viewport,screen:viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13; SM-X800) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'});
  try{
    const page=await context.newPage();await setup(page,context);
    await page.evaluate(()=>{
      overlays=allItems.slice(0,4).map((item,i)=>({__cluster:{key:'tablet-'+i,items:[item]}}));multiClusterMode=true;selectedGroupKeys=[];window.redrawSelectedMarkers=()=>{};
      overlays.forEach(o=>openCluster(o.__cluster.key));
    });
    await expectSelectionSummary(page);await expect(page.locator('#multiClusterStatus')).toContainText('매물 4개');
    await page.screenshot({path:'outputs/v169-tablet-'+(landscape?'landscape':'portrait')+'.png'});
  }finally{await context.close();}
});
async function openPhone(page,id='B-A'){
  await page.evaluate(id=>openPropertyEditModalV630(encodeURIComponent('id:'+id)),id);
  // The management API retains scope/exception controls. New registrations use
  // the one-click field button, covered separately below.
  await page.evaluate(()=>JSBuildingRegistryV164.openContact(propertyEditTargetV630));
  await expect(dialog(page).locator('[data-save]')).toBeEnabled();
}
async function saveDialog(page){await dialog(page).locator('[data-save]').click();await expect(dialog(page)).not.toBeVisible();}

test('lease printing includes common, saved and exact-original contacts with four readable condition rows and no registration column',async({page,context},info)=>{
  const initial=empty();initial.contacts=[common()];const {state}=await setup(page,context,initial);
  await page.evaluate(()=>{
    const b=allItems.find(i=>i.propertyId==='B-B'),c=allItems.find(i=>i.propertyId==='B-C'),n=allItems.find(i=>i.propertyId==='B-N');
    b.rent=80;b.deposit=2000;b.fee=0;b.premium=null;b.memo='남길 사용자 메모';
    c.landlordPhone='010-5555-6666';c.manualFinancialFieldsV106=['landlord_phone'];
    n.gongsilContactCountV8=2;
    selectedPrintKeys=[b,c,n].map(actionSelectionKeyV660);updatePrintSelectedButton();
    window.__printContactReads=[];JSUnifiedListingsV8.loadContacts=async id=>{__printContactReads.push(id);return {ok:true,propertyId:id,contacts:[{role:'관리',phone:'042-123-4567'},{role:'세입자',phone:'010-2222-3333'}]};};
    const open=window.open;window.__printCalls=0;window.open=function(...args){const p=open.apply(window,args);if(p)p.print=()=>window.__printCalls++;return p;};
    window.__printBefore=JSON.stringify(allItems);
  });
  const opened=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());const popup=await opened;
  try{
    await expect(popup.locator('.js-print-table tbody tr')).toHaveCount(3);await expect.poll(()=>page.evaluate(()=>__printCalls)).toBe(1);
    const rows=popup.locator('tbody tr');await expect(rows.nth(0).locator('.col-phone')).toContainText('임대인 · 건물 공통');await expect(rows.nth(0)).toContainText('010-1234-5678');
    await expect(rows.nth(1)).toContainText('010-5555-6666');await expect(rows.nth(1)).not.toContainText('010-1234-5678');
    await expect(rows.nth(2).locator('.col-phone')).toContainText('관리042-123-4567');await expect(rows.nth(2)).toContainText('세입자010-2222-3333');await expect(rows.nth(2)).not.toContainText('010-1234-5678');
    await expect(popup.locator('th')).toHaveText(['전화번호','건물이름 · 주소','임대조건','메모']);await expect(rows.nth(0).locator('.print-price > div')).toHaveCount(4);
    await expect(rows.nth(0).locator('.print-price')).toContainText('보증금2,000만원월세80만원관리비0만원권리금미입력');await expect(rows.nth(0)).toContainText('남길 사용자 메모');
    expect(await page.evaluate(()=>__printContactReads)).toEqual(['B-N']);expect(await page.evaluate(()=>JSON.stringify(allItems)===__printBefore)).toBe(true);expect(state.propertyWrites).toEqual([]);expect(state.writes).toEqual([]);
    await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:734,height:1030});expect(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await popup.locator('.print-contact-number').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1))).toBe(true);
    await popup.screenshot({path:'outputs/v170-lease-print-'+info.project.name+'.png',fullPage:true});
    if(info.project.name==='desktop')await popup.pdf({path:'outputs/v170-lease-print.pdf',preferCSSPageSize:true,printBackground:true});
  }finally{await popup.close();}
});

test('a late contact response cannot print into another account and failed contact reads are shown explicitly',async({page,context})=>{
  await setup(page,context);
  await page.evaluate(()=>{
    const item=allItems[0];item.gongsilContactCountV8=1;selectedPrintKeys=[actionSelectionKeyV660(item)];updatePrintSelectedButton();
    window.__contactGate=new Promise(resolve=>{window.__releaseContact=resolve;});
    JSUnifiedListingsV8.loadContacts=async id=>{await __contactGate;return {ok:true,propertyId:id,contacts:[{role:'임대인',phone:'010-1111-2222'}]};};
    const open=window.open;window.__printCalls=0;window.open=function(...args){const p=open.apply(window,args);if(p)p.print=()=>__printCalls++;return p;};
  });
  let opened=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());let popup=await opened;
  await expect(popup.locator('body')).toContainText('연락처와 조건');await page.evaluate(()=>{JSAuthenticatedAccountEmail='other@example.invalid';__releaseContact();});await expect.poll(()=>popup.isClosed()).toBe(true);expect(await page.evaluate(()=>__printCalls)).toBe(0);
  await page.evaluate(()=>{JSAuthenticatedAccountEmail='browser-fixture@example.invalid';JSUnifiedListingsV8.loadContacts=async()=>{throw Error('fixture failure');};});
  opened=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());popup=await opened;
  try{await expect(popup.locator('.print-contact-warning')).toContainText('원본 연락처 조회 실패');await expect(popup.locator('.js-print-table')).toBeVisible();}finally{await popup.close();}
});
test('non-master hides building grouping controls and rejects direct opening while common contacts remain usable',async({page,context})=>{
  const {state,errors}=await setup(page,context,{schema:164,buildings:[mapGroup()],contacts:[common()]},false);
  await page.evaluate(()=>{overlays=[{__cluster:{key:'a',items:allItems.slice(0,3)}},{__cluster:{key:'b',items:[allItems[3]]}}];multiClusterMode=true;selectedGroupKeys=['a','b'];JSBuildingRegistryV164.syncMapControls();});
  await expect(page.locator('#buildingMapActionsV164')).toBeHidden();await expect(page.getByRole('button',{name:'같은 건물로 묶기',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>JSBuildingRegistryV164.openGroup())).toBe(false);
  expect(await page.evaluate(()=>JSBuildingRegistryV164.openGroup('G-1'))).toBe(false);
  await expect(page.locator('#buildingRegistryDialogV164')).toHaveCount(0);expect(await groups(page)).toHaveLength(5);
  expect(await page.evaluate(()=>JSBuildingRegistryV164.contactFor(allItems[1])?.phone)).toBe('01012345678');
  await page.evaluate(()=>JSBuildingRegistryV164.openContact(allItems[1]));await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-phone]')).toHaveValue('010-1234-5678');
  await dialog(page).getByRole('button',{name:'취소',exact:true}).click();
  expect(state.writes).toEqual([]);expect(state.propertyWrites).toEqual([]);expect(errors).toEqual([]);
});

test('master permission loss closes grouping review and removes controls without changing selection or saved data',async({page,context})=>{
  const {state,errors}=await setup(page,context,{schema:164,buildings:[mapGroup()],contacts:[]});
  await page.evaluate(()=>{overlays=[{__cluster:{key:'a',items:allItems.slice(0,3)}},{__cluster:{key:'b',items:[allItems[3]]}}];multiClusterMode=true;selectedGroupKeys=['a','b'];JSBuildingRegistryV164.syncMapControls();});
  await page.getByRole('button',{name:'같은 건물로 묶기',exact:true}).click();await expect(dialog(page)).toBeVisible();
  state.canManage=false;state.version=0;await page.evaluate(()=>JSBuildingRegistryV164.load(true));
  await expect(dialog(page)).not.toBeVisible();await expect(page.locator('#buildingMapActionsV164')).toBeHidden();
  expect(await page.evaluate(()=>selectedGroupKeys)).toEqual(['a','b']);expect(await groups(page)).toHaveLength(5);
  expect(await page.evaluate(()=>JSBuildingRegistryV164.openGroup('G-1'))).toBe(false);
  expect(state.writes).toEqual([]);expect(state.data.buildings).toHaveLength(1);expect(errors).toEqual([]);
});

test('switching accounts never inherits master-only controls from the previous account',async({page,context})=>{
  const {state,errors}=await setup(page,context);
  await page.evaluate(()=>{overlays=[{__cluster:{key:'a',items:allItems.slice(0,3)}},{__cluster:{key:'b',items:[allItems[3]]}}];multiClusterMode=true;selectedGroupKeys=['a','b'];JSBuildingRegistryV164.syncMapControls();});
  await expect(page.getByRole('button',{name:'같은 건물로 묶기',exact:true})).toBeVisible();
  await page.evaluate(()=>{JSAuthenticatedAccountEmail='non-master@example.test';JSBuildingRegistryV164.syncMapControls();});
  await expect(page.locator('#buildingMapActionsV164')).toBeHidden();
  expect(await page.evaluate(()=>JSBuildingRegistryV164.openGroup())).toBe(false);expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

async function groups(page){return page.evaluate(()=>JSBuildingRegistryV164.groupAddressGroups(allItems.map(item=>({key:item.propertyId,address:item.address,latlng:item.latlng,items:[item]}))).map(group=>({key:group.key,id:group.buildingIdV164,ids:group.items.map(item=>item.propertyId)})));}

test('existing map multiselect opens review, saves independent grouping, reloads and ungroups without changing listings',async({page,context})=>{
  const {state,errors,reload}=await setup(page,context);const before=await page.evaluate(()=>JSON.stringify(allItems));
  await page.evaluate(()=>{overlays=[{__cluster:{key:'a',items:allItems.slice(0,3)}},{__cluster:{key:'b',items:[allItems[3]]}}];multiClusterMode=true;selectedGroupKeys=['a','b'];JSBuildingRegistryV164.syncMapControls();});
  await page.getByRole('button',{name:'같은 건물로 묶기',exact:true}).click();
  await expect(dialog(page).locator('[data-member]')).toHaveCount(4);
  await dialog(page).locator('[data-label]').fill('직접 확인한 건물');await saveDialog(page);
  expect(state.writes).toHaveLength(1);expect(state.data.contacts).toEqual([]);expect(state.propertyWrites).toEqual([]);
  expect(await groups(page)).toEqual([{key:'B-N',ids:['B-N']},{key:'building-v164:'+state.data.buildings[0].id,id:state.data.buildings[0].id,ids:['B-A','B-B','B-C','B-D']}]);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await reload();expect((await groups(page)).find(g=>g.id)?.ids).toHaveLength(4);
  await page.evaluate(id=>JSBuildingRegistryV164.openGroup(id),state.data.buildings[0].id);
  await dialog(page).locator('[data-label]').fill('이름만 수정');await saveDialog(page);expect(state.data.buildings[0].anchor).toEqual({lat:36.35,lng:127.38});
  await page.evaluate(id=>JSBuildingRegistryV164.openGroup(id),state.data.buildings[0].id);
  await dialog(page).locator('[data-delete]').click();await expect(dialog(page)).not.toBeVisible();
  expect(await groups(page)).toHaveLength(5);expect(state.propertyWrites).toEqual([]);expect(errors).toEqual([]);
});

test('map group excludes unchecked units and future matches when the reviewed scope is partial',async({page,context})=>{
  const {state}=await setup(page,context);
  await page.evaluate(()=>{overlays=[{__cluster:{key:'a',items:allItems.slice(0,3)}},{__cluster:{key:'b',items:[allItems[3]]}}];multiClusterMode=true;selectedGroupKeys=['a','b'];});
  await page.evaluate(()=>JSBuildingRegistryV164.openGroup());await dialog(page).locator('[data-member="B-C"]').uncheck();await saveDialog(page);
  expect(state.data.buildings[0].autoParcels).toEqual([]);expect(state.data.buildings[0].excludedIds).toEqual(['B-C']);
  expect((await groups(page)).find(g=>g.id).ids).toEqual(['B-A','B-B','B-D']);
  expect(await page.evaluate(()=>JSBuildingRegistryV164.buildingFor({...allItems[0],propertyId:'FUTURE'}))).toBeNull();
});

test('actual zoom clustering keeps approved parcels together after pan, representative removal and new advertising',async({page,context})=>{
  const initial=empty();initial.buildings=[mapGroup()];await setup(page,context,initial);
  const observations=await page.evaluate(()=>{
    JS_MAP_CLUSTER_ENGINE_V690='world-grid';const result=[];
    for(const level of [1,2,3,4,5,6,3,1]){
      map.getLevel=()=>level;map.getCenter=()=>new kakao.maps.LatLng(36.3501+level*0.00001,127.38);
      const clusters=createClustersForCurrentZoomV655(groupByAddress(allItems));
      const containing=clusters.filter(c=>c.items.some(i=>i.propertyId==='B-A'));
      result.push({level,count:containing.length,ids:containing[0].items.map(i=>i.propertyId),total:clusters.reduce((n,c)=>n+c.items.length,0)});
    }
    const before=JSBuildingRegistryV164.buildingFor(allItems[1]);
    allItems=allItems.filter(i=>i.propertyId!=='B-A');allItems.push({...allItems[0],propertyId:'B-RELISTED',key:'B-RELISTED'});
    const clusters=createClustersForCurrentZoomV655(groupByAddress(allItems)),building=clusters.find(c=>c.buildingIdV164);
    return{result,before:before.anchor,after:{ids:building.items.map(i=>i.propertyId),lat:building.latlng.getLat(),lng:building.latlng.getLng()}};
  });
  for(const row of observations.result){expect(row.count).toBe(1);expect(row.ids).toEqual(expect.arrayContaining(['B-A','B-B','B-C','B-D']));expect(row.total).toBe(5);}
  expect(observations.after.ids.sort()).toEqual(['B-B','B-C','B-D','B-RELISTED'].sort());expect(observations.after.lat).toBe(observations.before.lat);expect(observations.after.lng).toBe(observations.before.lng);
});

test('shared landlord explicitly excludes conflicting individual phone; eligible new ads inherit and neighbors never do',async({page,context})=>{
  const {state,errors,reload}=await setup(page,context);await openPhone(page);
  await expect(dialog(page).locator('[data-member="B-A"]')).toBeChecked();await expect(dialog(page).locator('[data-member="B-B"]')).toBeChecked();await expect(dialog(page).locator('[data-member="B-C"]')).not.toBeChecked();
  await expect(dialog(page).locator('[data-auto]')).toBeDisabled();await dialog(page).locator('[data-member="B-C"]').check();await dialog(page).locator('[data-auto]').check();await saveDialog(page);
  expect(state.propertyWrites).toEqual([]);expect(state.data.buildings).toEqual([]);expect(state.data.contacts[0].autoParcels).toEqual([p]);
  const calls=await page.evaluate(()=>({blank:extractListContactsV650(allItems[1]).map(c=>c.phone.tel),different:extractListContactsV650(allItems[2]).map(c=>c.phone.tel),next:JSBuildingRegistryV164.contactFor({...allItems[1],propertyId:'NEW'}),neighbor:JSBuildingRegistryV164.contactFor(allItems[4]),raw:allItems[1].landlordPhone}));
  expect(calls.blank).toEqual(['01012345678']);expect(calls.different).toEqual(['01012345678']);expect(calls.next.phone).toBe('01012345678');expect(calls.neighbor).toBeNull();expect(calls.raw).toBe('');
  await page.evaluate(()=>closePropertyEditModalV630());await reload();await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('010-1234-5678');await expect(page.locator('#peLandlordPhoneV630')).toHaveAttribute('readonly','');expect(errors).toEqual([]);
  expect(await page.locator('.property-edit-body-v135').evaluate(body=>body.scrollHeight<=body.clientHeight+1)).toBe(true);
  await page.screenshot({path:'outputs/v164-common-edit-'+(page.viewportSize().width<500?'mobile':'desktop')+'.png'});
});

test('unrelated condition and memo saves retain raw own contacts and selected master identity',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const initial=empty();initial.contacts=[common()];const {state,errors}=await setup(page,context,initial);
  await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  await page.locator('#peRentV630').fill('80');await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
  expect(state.propertyWrites[0].key.propertyId).toBe('B-B');expect(state.propertyWrites[0].updated.landlordPhone).toBe('');expect(state.propertyWrites[0].updated.contacts).toEqual([]);expect(state.propertyWrites[0].editedFields).toEqual(['rent']);
  await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='B-B');window.__memoNeighbors=allItems.filter(i=>i!==item).map(i=>[i.propertyId,i.memo]);});
  const card=page.locator('#list .item[data-property-id="B-B"]');await card.locator('.item-memo-toggle').click();await card.getByRole('button',{name:'수정',exact:true}).click();
  await card.locator('textarea').fill('직접 쓴 메모');await card.getByRole('button',{name:'저장',exact:true}).click();
  await expect.poll(()=>state.propertyWrites.length).toBe(2);
  expect(state.propertyWrites[1].key.propertyId).toBe('B-B');expect(state.propertyWrites[1].contacts).toEqual([]);
  expect(await page.evaluate(()=>allItems.filter(i=>i.propertyId!=='B-B').map(i=>[i.propertyId,i.memo]))).toEqual(await page.evaluate(()=>__memoNeighbors));
  expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

test('a number typed into an empty field can be saved as common without copying it into an unrelated rent save',async({page,context})=>{
  const {state}=await setup(page,context);
  await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  await page.locator('#peRentV630').fill('80');await page.locator('#peLandlordPhoneV630').fill('010-4444-5555');
  await page.locator('#buildingContactControlsV164 [data-common]').click();
  await expect(page.locator('#propertyEditStatusV630')).toContainText('현재·신규 매물에 공통번호를 적용');
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.locator('#peLandlordPhoneV630')).toHaveAttribute('readonly','');await expect(page.locator('#peRentV630')).toHaveValue('80');
  expect(await page.evaluate(()=>Object.keys(propertyEditTouchedFieldsV131))).toEqual(['rent']);
  expect(state.propertyWrites).toEqual([]);await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
  expect(state.propertyWrites[0].key.propertyId).toBe('B-B');expect(state.propertyWrites[0].updated.landlordPhone).toBe('');expect(state.propertyWrites[0].editedFields).toEqual(['rent']);
});

test('one click registers all current masters and future ads at the exact parcel, even within a multi-parcel map group',async({page,context},info)=>{
  const initial=empty();initial.buildings=[mapGroup()];const {state,reload,errors}=await setup(page,context,initial);
  const raw=await page.evaluate(()=>JSON.stringify(allItems));
  await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  const phone=page.locator('#peLandlordPhoneV630'),button=page.locator('#buildingContactControlsV164 [data-common]');
  await phone.fill('010-4444-5555');
  const geometry=await button.evaluate(el=>{
    const input=document.getElementById('peLandlordPhoneV630'),b=el.getBoundingClientRect(),i=input.getBoundingClientRect(),style=getComputedStyle(input),canvas=document.createElement('canvas').getContext('2d');canvas.font=style.font;
    return {gap:i.right-b.right,top:b.top-i.top,bottom:i.bottom-b.bottom,padding:Number.parseFloat(style.paddingRight),width:b.width,inputWidth:i.width,
      contentWidth:i.width-Number.parseFloat(style.paddingLeft)-Number.parseFloat(style.paddingRight)-2,textWidth:canvas.measureText(input.value).width};
  });
  expect(geometry.gap).toBeGreaterThanOrEqual(0);expect(geometry.gap).toBeLessThanOrEqual(5);
  expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeGreaterThanOrEqual(0);
  expect(geometry.padding).toBeGreaterThan(geometry.width);expect(geometry.inputWidth-geometry.padding).toBeGreaterThan(55);
  expect(geometry.contentWidth).toBeGreaterThanOrEqual(geometry.textWidth);
  await button.click();await expect(page.locator('#propertyEditStatusV630')).toContainText('현재·신규 매물에 공통번호를 적용');
  await expect(dialog(page)).not.toBeVisible();expect(state.writes).toHaveLength(1);expect(state.propertyWrites).toEqual([]);
  const rule=state.data.contacts[0];expect(rule.parcels).toEqual([p]);expect(rule.autoParcels).toEqual([p]);expect(rule.memberIds.sort()).toEqual(['B-A','B-B','B-C']);
  expect(state.data.buildings).toEqual(initial.buildings);
  const proof=await page.evaluate(()=>({
    current:allItems.slice(0,3).map(i=>JSBuildingRegistryV164.contactFor(i)?.phone),
    future:['lease','building_sale','land_sale'].map(market=>JSBuildingRegistryV164.contactFor({...allItems[1],propertyId:'FUTURE-'+market,market})?.phone),
    collected:['네이버','당근','공실박스','gongsil'].map(source=>JSBuildingRegistryV164.contactFor({...allItems[1],propertyId:'NEW-'+source,source,landlordPhone:'010-9999-8888',manualFinancialFieldsV106:[]})?.phone),
    neighbor:JSBuildingRegistryV164.contactFor(allItems[3]),
    newIndividual:JSBuildingRegistryV164.contactFor({...allItems[1],propertyId:'OWN-NEW',landlordPhone:'010-2222-3333',manualFinancialFieldsV106:['landlord_phone']}),raw:JSON.stringify(allItems)
  }));
  expect(proof.current).toEqual(['01044445555','01044445555','01044445555']);expect(proof.future).toEqual(proof.current);
  expect(proof.collected).toEqual(['01044445555','01044445555','01044445555','01044445555']);
  expect(proof.neighbor).toBeNull();expect(proof.newIndividual).toBeNull();expect(proof.raw).toBe(raw);
  await page.screenshot({path:info.outputPath('one-click-common-phone-v221.png')});
  await page.evaluate(()=>closePropertyEditModalV630());await reload();await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  await expect(phone).toHaveValue('010-4444-5555');await expect(button).toHaveText('✓ 공통 적용');
  await expect(button).toHaveClass(/common-applied-v231/);await expect(page.locator('#buildingContactStateV231')).toHaveText('✓ 이 지번 공통 적용 중');
  expect(await button.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(24, 121, 78)');
  await page.screenshot({path:info.outputPath('common-applied-v231.png')});await button.click();
  await expect(dialog(page).locator('[data-phone]')).toHaveValue('010-4444-5555');await expect(dialog(page).locator('[data-delete]')).toBeVisible();expect(errors).toEqual([]);
});

test('one-click common phone rejects blank or invalid numbers inline without opening another dialog',async({page,context})=>{
  const {state}=await setup(page,context);await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  const phone=page.locator('#peLandlordPhoneV630'),button=page.locator('#buildingContactControlsV164 [data-common]');
  for(const value of ['','010-0000-0000','123']){
    await phone.fill(value);await button.click();await expect(phone).toBeFocused();
    await expect(page.locator('#propertyEditStatusV630')).toContainText('먼저 입력');await expect(dialog(page)).not.toBeVisible();
  }
  expect(state.writes).toEqual([]);expect(state.propertyWrites).toEqual([]);
});

test('late common settings preserve the typed phone and request review without a false applied or individual state',async({page,context})=>{
  const {state}=await setup(page,context);await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  const phone=page.locator('#peLandlordPhoneV630');await phone.fill('010-4444-5555');state.data.contacts=[common()];state.version++;
  await page.evaluate(()=>JSBuildingRegistryV164.load(true));
  await expect(phone).toHaveValue('010-4444-5555');await expect(phone).not.toHaveAttribute('readonly','');
  await expect(page.locator('#buildingContactStateV231')).toHaveText('지번 공통번호와 입력 번호 확인 필요');
  await expect(page.locator('#buildingContactControlsV164 [data-common]')).not.toHaveClass(/common-applied-v231/);
  expect(state.writes).toEqual([]);expect(state.propertyWrites).toEqual([]);
});

test('one-click registration deduplicates pending clicks and blocks unrelated condition save until acknowledgement',async({page,context})=>{
  const {state}=await setup(page,context);let release;state.readGate=new Promise(resolve=>{release=resolve;});
  await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  await page.locator('#peLandlordPhoneV630').fill('010-4444-5555');await page.locator('#peRentV630').fill('80');
  const button=page.locator('#buildingContactControlsV164 [data-common]');await button.click();await expect(button).toBeDisabled();
  await expect(button).not.toHaveClass(/common-applied-v231/);await expect(page.locator('#buildingContactStateV231')).toHaveText('공통번호 저장 확인 중');
  await button.evaluate(el=>{el.click();el.click();});await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditStatusV630')).toContainText('공통번호 저장을 확인');expect(state.propertyWrites).toEqual([]);
  release();await expect(page.locator('#propertyEditStatusV630')).toContainText('현재·신규 매물에 공통번호를 적용');
  expect(state.writes).toHaveLength(1);await expect(button).toBeEnabled();await expect(page.locator('#peRentV630')).toHaveValue('80');
  await expect(button).toHaveClass(/common-applied-v231/);await expect(page.locator('#buildingContactStateV231')).toHaveText('✓ 이 지번 공통 적용 중');
});

test('one-click conflict retains the entered phone and rent, and retry persists once without false common state',async({page,context})=>{
  const {state}=await setup(page,context);await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  const phone=page.locator('#peLandlordPhoneV630'),button=page.locator('#buildingContactControlsV164 [data-common]');
  await phone.fill('010-4444-5555');await page.locator('#peRentV630').fill('80');state.conflict=true;await button.click();
  await expect(page.locator('#propertyEditStatusV630')).toContainText('다른 기기');await expect(phone).toHaveValue('010-4444-5555');await expect(phone).not.toHaveAttribute('readonly','');
  await expect(button).not.toHaveClass(/common-applied-v231/);await expect(page.locator('#buildingContactStateV231')).toBeHidden();
  expect(state.data.contacts).toEqual([]);expect(state.propertyWrites).toEqual([]);
  state.conflict=false;await button.click();await expect(page.locator('#propertyEditStatusV630')).toContainText('현재·신규 매물에 공통번호를 적용');
  expect(state.version).toBe(1);expect(state.writes).toHaveLength(2);await expect(page.locator('#peRentV630')).toHaveValue('80');
});

test('closing or switching editors while common-phone verification waits cannot register into the next editor',async({page,context})=>{
  const {state}=await setup(page,context);let release;state.readGate=new Promise(resolve=>{release=resolve;});
  await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));await page.locator('#peLandlordPhoneV630').fill('010-4444-5555');
  await page.locator('#buildingContactControlsV164 [data-common]').click();await expect.poll(()=>state.reads.length).toBeGreaterThan(1);
  await page.evaluate(()=>{closePropertyEditModalV630();openPropertyEditModalV630(encodeURIComponent('id:B-D'));});
  release();await expect(page.locator('#peLandlordPhoneV630')).not.toHaveAttribute('readonly','');await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('');
  await expect(page.locator('#buildingContactControlsV164 [data-common]')).not.toHaveClass(/common-applied-v231/);await expect(page.locator('#buildingContactStateV231')).toBeHidden();
  await expect(page.locator('#propertyEditIdentityV630')).toContainText('6-4');
  await page.waitForTimeout(100);expect(state.writes).toEqual([]);expect(state.propertyWrites).toEqual([]);
});

test('query-mode one-click registration verifies exact master IDs and refuses a changed parcel',async({page,context})=>{
  const {state}=await setup(page,context);await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:B-B')));
  await page.evaluate(()=>{
    window.__commonMasterReads=[];window.JSQueryListingsV152={active:()=>true,navigationItems:()=>allItems,
      readMastersForBuildingV164:async ids=>{__commonMasterReads.push(ids);return ids.map(id=>({...allItems.find(i=>i.propertyId===id),address:id==='B-C'?'서구 괴정동 6-4':'서구 괴정동 6-3'}));}};
  });
  await page.locator('#peLandlordPhoneV630').fill('010-4444-5555');await page.locator('#buildingContactControlsV164 [data-common]').click();
  await expect(page.locator('#propertyEditStatusV630')).toContainText('지번이나 적용 범위');
  expect(await page.evaluate(()=>__commonMasterReads)).toEqual([['B-A','B-B','B-C']]);expect(state.writes).toEqual([]);
  await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('010-4444-5555');expect(state.propertyWrites).toEqual([]);
});

test('individual exception and common removal preserve actual original numbers and do not alter map group',async({page,context})=>{
  const initial=empty();initial.contacts=[common()];initial.buildings=[mapGroup()];const {state}=await setup(page,context,initial);
  await openPhone(page,'B-B');await dialog(page).locator('[data-individual]').click();
  await expect(page.locator('#peLandlordPhoneV630')).not.toHaveAttribute('readonly','');await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('');
  await expect(page.locator('#buildingContactStateV231')).toHaveText('이 매물은 개별번호 사용 중');await expect(page.locator('#buildingContactControlsV164 [data-common]')).not.toHaveClass(/common-applied-v231/);
  expect(state.data.contacts[0].excludedIds).toEqual(['B-B']);expect(state.data.contacts[0].autoParcels).toEqual([]);
  await page.locator('#peLandlordPhoneV630').fill('010-2222-3333');await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);expect(state.propertyWrites[0].editedFields).toEqual(['landlordPhone']);
  expect(await page.evaluate(()=>JSBuildingRegistryV164.contactFor(allItems.find(i=>i.propertyId==='B-B')))).toBeNull();
  await openPhone(page,'B-A');await dialog(page).locator('[data-delete]').click();await expect(dialog(page)).not.toBeVisible();
  expect(state.data.contacts).toEqual([]);expect(state.data.buildings).toEqual(initial.buildings);
  await expect(page.locator('#buildingContactStateV231')).toBeHidden();await expect(page.locator('#buildingContactControlsV164 [data-common]')).toHaveText('건물공통');
  expect(await page.evaluate(()=>extractListContactsV650(allItems.find(i=>i.propertyId==='B-C'))[0].phone.tel)).toBe('01098765432');
});

test('concurrent setting conflict preserves scope and phone draft without false success or listing writes',async({page,context})=>{
  const {state}=await setup(page,context);await openPhone(page);await dialog(page).locator('[data-phone]').fill('010-5555-6666');state.conflict=true;
  await dialog(page).locator('[data-save]').click();await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-status]')).toContainText(/다른.*변경|바뀌/);await expect(dialog(page).locator('[data-phone]')).toHaveValue('010-5555-6666');
  expect(state.version).toBe(0);expect(state.propertyWrites).toEqual([]);
});

test('late account response cannot publish old account groups or common phone',async({page,context})=>{
  const {state}=await setup(page,context);let release;state.data.contacts=[common()];state.version=1;state.readGate=new Promise(resolve=>{release=resolve;});
  const pending=page.evaluate(()=>JSBuildingRegistryV164.load(true));await expect.poll(()=>state.reads.length).toBeGreaterThan(1);
  await page.evaluate(()=>{JSAuthenticatedAccountEmail='another@example.invalid';window.dispatchEvent(new Event('js-auth-required'));});release();await pending;
  expect(await page.evaluate(()=>JSBuildingRegistryV164.contactFor(allItems[1]))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('js-building-registry-v164:another@example.invalid'))).toBeNull();
});

test('review dialog stays inside phone/tablet viewport and long scope scrolls without hiding save',async({page,context})=>{
  await setup(page,context);await openPhone(page);const box=await dialog(page).boundingBox(),view=page.viewportSize();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(view.height+1);
  const save=await dialog(page).locator('[data-save]').boundingBox();expect(save.y+save.height).toBeLessThanOrEqual(view.height);await expect(dialog(page).locator('[data-close]').last()).toBeVisible();
  await page.screenshot({path:'outputs/v164-scope-'+(view.width<500?'mobile':'desktop')+'.png'});
});
