import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fixtureItems} from './fixture-server.mjs';
import {buildQueryRuntimeV151} from '../../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {createListingQueryRuntimeV151:make}=await import('../../cloudflare/generated/query-runtime-v151.js');
const {queryWireV151}=await import('../../cloudflare/src/query-worker-v151.js');
const hash=number=>'sha256-v1:'+String(number).padStart(64,'0');
const errorsByPage=new WeakMap();
test.afterEach(async({page})=>{expect(errorsByPage.get(page)||[],'No uncaught startup/runtime errors').toEqual([]);});
async function setup(page,context,settings={}){
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  errorsByPage.set(page,pageErrors);
  let armed=false,fail=false,queryGate=null,revisionGate=null,afterQuery=null,pointGate=null,pointPredicate=null;const requests=[],full=[],points=[];
  const masters=fixtureItems.map(item=>{const value=structuredClone(item);delete value.key;return {...value,sourceSnapshotKey:hash(1)};});
  let revision='query-initial';
  const ads=new Map(masters.map(item=>[item.propertyId,[{...structuredClone(item),originalId:item.propertyId+'-ORIGINAL',
    active:1,availabilityKind:'active',floor:item.tradeType==='sale'?null:Number.parseInt(item.room)||null,
    source:'네이버',providerSourceId:'source-'+item.propertyId,photoCount:3,revision:'fixture-1'}]]));
  function original(id,origin){return ads.get(id).map(original=>({...original,propertyId:id,link:origin+'/original/'+id,
    thumbnail:origin+'/__query/photo-'+id+'-1.svg',images:[1,2,3].map(n=>origin+'/__query/photo-'+id+'-'+n+'.svg')}));}
  function unified(ids,origin){return {ok:true,format:'expanded-v2',groups:Object.fromEntries(ids.map(id=>[id,original(id,origin)])),
    sourceSnapshotKeys:Object.fromEntries(ids.map(id=>[id,masters.find(item=>item.propertyId===id).sourceSnapshotKey])),
    sourceSnapshotPropertyIds:Object.fromEntries(ids.map(id=>[id,id]))};}
  function raw(item){return {id:'internal-'+item.propertyId,property_id:item.propertyId,title:item.name,address:item.address,room:item.room,
    listing_type:item.type,status:item.state,main_source:item.source,deposit:item.deposit,monthly_rent:item.rent,maintenance_fee:item.fee,
    premium:item.premium,area_m2:item.area,operating_memo:item.memo,trade_type:item.tradeType,sale_category:item.saleCategory||'',
    sale_price:item.salePrice??null,sale_details_json:JSON.stringify(item.saleDetails||null),latitude:item.latitude,longitude:item.longitude,
    landlord_phone:item.landlordPhone||'',tenant_phone:item.tenantPhone||'',
    contacts_json:JSON.stringify(item.contacts||[]),
    source_snapshot_key:item.sourceSnapshotKey,source_availability_v129:'active',registration_at:'2026-11-09'};}
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/__query/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname.endsWith('.svg'))return route.fulfill({contentType:'image/svg+xml',headers:{'cache-control':'public, max-age=3600'},
      body:`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="${url.pathname.includes('-2.svg')?'#15803d':'#2563eb'}"/></svg>`});
    return route.fulfill({status:404,body:'fixture'});
  });
  await context.route('**/api/sheet**',route=>{if(!armed)return route.fallback();full.push('csv');return route.fulfill({status:500,json:{ok:false}});});
  await context.route('**/api/data**',async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('action');
    if(!armed)return route.fallback();
    if(request.method()==='POST'){
      const body=request.postDataJSON();
      if(body.action==='updateProperty'){
        const id=body.key.propertyId,item=masters.find(item=>item.propertyId===id);Object.assign(item,body.updated);
        item.sourceSnapshotKey=hash(2);revision='after-save';
        const fields={rent:'monthly_rent',room:'room',fee:'maintenance_fee',premium:'premium',area:'area_m2',deposit:'deposit',landlordPhone:'landlord_phone'};
        const manual=(body.editedFields||[]).map(field=>fields[field]).filter(Boolean);
        ads.get(id).forEach(original=>{original.manualDisplayFields=manual.join(',');if(manual.includes('room')){original.room=item.room;original.floor=/지하|^-/.test(item.room)?-1:parseInt(item.room)||null;original.hasManualRoomOverride=true;}});
        return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:id,updated:body.updated,changedFields:manual}});
      }
      if(body.action==='updatePropertyMemo'){
        const id=body.key?.propertyId||body.propertyId,item=masters.find(item=>item.propertyId===id);item.memo=body.memo;item.contacts=body.contacts||[];
        item.sourceSnapshotKey=hash(2);revision='after-memo';
        return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:id,memo:item.memo,contacts:item.contacts}});
      }
      return route.fallback();
    }
    if(action==='unifiedListings'){full.push('originals');return route.fulfill({status:500,json:{ok:false}});}
    if(action==='dataRevision'){if(revisionGate)await revisionGate;return route.fulfill({json:{ok:true,revision}});}
    if(action==='listingChanges'){
      const ids=url.searchParams.get('ids').split(',');return route.fulfill({json:{ok:true,items:masters.filter(item=>ids.includes(item.propertyId)).map(raw)}});
    }
    if(action==='listingQuery'){
      const spec=JSON.parse(url.searchParams.get('spec'));requests.push(spec.mode);if(queryGate)await queryGate;
      if(fail)return route.fulfill({status:503,json:{ok:false,message:'fixture query unavailable'}});
      const items=structuredClone(masters),ids=items.map(item=>item.propertyId),runtime=make(items,unified(ids,url.origin));
      const rows=runtime.query({...spec,deferFinalize:true,ignoreMapBounds:true,includeUnlocated:true}).map(item=>({...item,
        queryGroupKeyV152:runtime.groupKey(item.propertyId),...runtime.visitFlags(item),
        queryMatchedOriginalCountV152:item.unifiedDisplayOriginalsV2.length}));
      const packet=queryWireV151(runtime.finalize(rows,{...spec,individualQueryV152:true}),revision);
      if(afterQuery){const run=afterQuery;afterQuery=null;run();}
      return route.fulfill({json:packet});
    }
    if(action==='listingOriginals'){
      const ids=url.searchParams.get('ids').split(',');points.push(ids);
      if(pointGate&&pointPredicate(ids))await pointGate;
      return route.fulfill({json:{ok:true,requestedIds:ids,missingIds:[],items:masters.filter(item=>ids.includes(item.propertyId)).map(raw),
        unified:unified(ids,url.origin)}});
    }
    if(action==='unifiedListingDetail'){
      const id=url.searchParams.get('propertyId');return route.fulfill({json:{ok:true,propertyId:id,originals:original(id,url.origin)}});
    }
    return route.fallback();
  });
  async function install(){
    await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
    await page.evaluate(()=>{window.kakao={maps:{load(){},LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}}};});
    await page.addScriptTag({content:await readFile('js/map.js','utf8')});
    await page.evaluate(()=>{map.getCenter=()=>new kakao.maps.LatLng(36.3504,127.3845);map.getLevel=()=>7;});
    if(settings.early){armed=true;await page.evaluate(()=>{window.JSQueryListingsEnabledV152=true;});}
    await page.addScriptTag({url:'/js/query-collection-v152.js'});await page.addScriptTag({url:'/js/query-preview-v154.js'});await page.addScriptTag({url:'/js/query-startup-v152.js'});
    await page.evaluate(()=>{
      window.drawItems=items=>{showList(items);updateMapListingCountV825(items);};window.clearPinnedClusterSelectionV6515=()=>{};
      allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();document.getElementById('fixtureControls')?.remove();
      window.JSQueryListingsEnabledV152=true;
    });armed=true;
  }
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await install();
  return {requests,full,points,masters,ads,pageErrors,load:()=>page.evaluate(()=>loadSheet(false,false)),
    setRevision:value=>{revision=value;},fail:value=>{fail=value;},afterNextQuery:run=>{afterQuery=run;},
    hold(){let release;queryGate=new Promise(resolve=>{release=resolve;});return()=>{queryGate=null;release();};},
    holdRevision(){let release;revisionGate=new Promise(resolve=>{release=resolve;});return()=>{revisionGate=null;release();};},
    holdPoints(predicate){let release;pointPredicate=predicate;pointGate=new Promise(resolve=>{release=resolve;});return()=>{pointGate=null;release();};},
    async reload(){armed=false;await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await install();}};
}

test('query startup renders full actionable cards without full CSV/original downloads or a fake complete cache',async({page,context})=>{
  const state=await setup(page,context);expect(await state.load()).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(2);
  expect(state.full).toEqual([]);expect(state.points.flat().sort()).toEqual(['FIXTURE-LEASE-1','FIXTURE-LEASE-2']);
  expect(await page.evaluate(()=>({whole:jsListingsCompleteBaseV1,fullModels:allItems.every(item=>!item.queryRowV152),count:allItems.length})))
    .toEqual({whole:false,fullModels:true,count:2});
  expect(await page.evaluate(()=>JSInitialListingsCacheV1.read())).toBeNull();
});

test('a ready scoped index redraws clusters on repeated zoom and pan without waiting for a legacy complete catalog',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  await page.evaluate(()=>{
    window.__navigationFramesV155=[];
    window.drawMapClustersOnlyV639=items=>__navigationFramesV155.push({level:map.getLevel(),ids:items.map(item=>item.propertyId)});
    window.getAdministrativeListItemsV6570=items=>items;
    window.getAdministrativeListStatusV6570=()=>'';
    window.__mapLevelV155=7;window.__mapEastV155=false;
    map.getLevel=()=>__mapLevelV155;
    map.getCenter=()=>new kakao.maps.LatLng(36.3504,__mapEastV155?127.39:127.3845);
    map.getBounds=()=>({contain:()=>!__mapEastV155});
    jsLastIdleViewportKeyV638='';
  });
  for(const [level,east] of [[6,false],[5,false],[4,true],[7,false]]){
    const before=await page.evaluate(()=>__navigationFramesV155.length);
    await page.evaluate(({level,east})=>{__mapLevelV155=level;__mapEastV155=east;scheduleMapIdleRefreshV638();},{level,east});
    await expect.poll(()=>page.evaluate(()=>__navigationFramesV155.length)).toBe(before+1);
    expect(await page.evaluate(()=>__navigationFramesV155.at(-1))).toEqual({level,ids:east?[]:['FIXTURE-LEASE-1','FIXTURE-LEASE-2']});
  }
  expect(state.requests).toHaveLength(1);expect(state.full).toEqual([]);
  expect(await page.evaluate(()=>jsListingsCompleteBaseV1)).toBe(false);
});

test('map idle does not redraw old market clusters while the selected scope is still loading',async({page,context})=>{
  const state=await setup(page,context);await state.load();const release=state.hold();
  try{
    await page.evaluate(()=>{
      window.__blockedNavigationFramesV155=0;
      window.drawMapClustersOnlyV639=()=>__blockedNavigationFramesV155++;
      JSListingTradeV1.setMode('building_sale');
      jsLastIdleViewportKeyV638='';scheduleMapIdleRefreshV638();
    });
    await expect(page.locator('#list .item')).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>jsMapIdleTimerV638)).toBeNull();
    expect(await page.evaluate(()=>__blockedNavigationFramesV155)).toBe(0);
  }finally{release();}
});

for(const kind of ['grid','administrative'])test('cluster '+kind+' shows the first real cards without waiting for offscreen originals or the previous scroll window',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<250;n++){const id='CLUSTER-'+String(n).padStart(3,'0'),item={...structuredClone(state.masters[0]),propertyId:id,name:id,
    ...(n>=190?{address:'대전 유성구 관평동 '+(n+1)+'-1'}:{})};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);}
  await state.load();
  await page.evaluate(()=>renderListWindowV2(80,92));
  await expect.poll(()=>page.evaluate(()=>listRenderStart)).toBe(80);
  const firstCount=await page.evaluate(()=>innerWidth<=768?4:6);
  const ids=await page.evaluate(kind=>{
    window.__clusterItemsV156=JSQueryListingsV152.navigationItems().filter(item=>item.address.includes('관평동'));
    const cluster={key:'test-cluster-v156',items:__clusterItemsV156,latlng:new kakao.maps.LatLng(36.35,127.38),
      ...(kind==='administrative'?{regionMode:'neighborhood',regionLabel:'관평동',districtLabel:'유성구'}:{})};
    overlays=[{__cluster:cluster,setContent(){},setZIndex(){}}];
    const button=document.createElement('button');button.textContent='검사 클러스터 선택';button.style.cssText='position:fixed;left:4px;top:4px;z-index:999999';
    button.onclick=()=>kind==='administrative'?openAdministrativeClusterV655(encodeURIComponent(cluster.key)):openCluster(encodeURIComponent(cluster.key));
    document.body.append(button);return __clusterItemsV156.map(item=>item.propertyId);
  },kind);
  expect(ids.length).toBeGreaterThan(20);
  const tail=new Set(ids.slice(firstCount)),release=state.holdPoints(batch=>batch.some(id=>tail.has(id))),before=state.points.length;
  try{
    await page.getByRole('button',{name:'검사 클러스터 선택',exact:true}).click();
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id',ids[0]);
    const shown=await page.locator('#list .item').evaluateAll(cards=>cards.map(card=>card.dataset.propertyId));
    expect(shown).toEqual(ids.slice(0,firstCount));
    expect(state.points.slice(before).find(batch=>batch.includes(ids[0]))).toEqual(ids.slice(0,firstCount));
    expect(await page.evaluate(()=>listRenderStart)).toBe(0);
    expect(await page.evaluate(()=>visibleListItems.slice(0,innerWidth<=768?4:6).every(item=>!item.queryRowV152))).toBe(true);
    await expect.poll(()=>page.locator('#list .item img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    expect(state.full).toEqual([]);
  }finally{release();}
});

test('authenticated early query warmup is consumed once and does not start the legacy catalog downloads',async({page,context})=>{
  const state=await setup(page,context,{early:true});
  await expect.poll(()=>state.requests.length).toBe(1);
  expect(await page.evaluate(()=>Object.isFrozen(JSInitialListingsCacheV1))).toBe(true);
  expect(state.pageErrors).toEqual([]);expect(await state.load()).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(2);expect(state.requests).toHaveLength(1);expect(state.full).toEqual([]);
});

test('an exact account/build/default-viewport cache paints real photos before controls unlock, with an explicit recent-data label',async({page,context})=>{
  const state=await setup(page,context,{early:true});
  await page.evaluate(()=>{map.getCenter=()=>new kakao.maps.LatLng(36.3504,127.3845);map.getLevel=()=>7;});
  await state.load();await state.reload();
  await page.evaluate(()=>{document.documentElement.classList.add('auth-pending');document.getElementById('wrap').inert=true;});
  await expect(page.locator('#list .item')).toHaveCount(0);
  expect(await page.evaluate(()=>JSQueryListingsV152.paintCachedPreview(()=>true))).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(2);
  await expect(page.locator('#mapListTitleV1')).toContainText('최근 확인 목록');
  expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(true);
  expect(await page.locator('#list .item button').evaluateAll(buttons=>buttons.every(button=>button.disabled))).toBe(true);
  expect(await page.locator('#list script,#list [onclick],#list textarea').count()).toBe(0);
  await page.evaluate(()=>JSQueryPreviewV154.clear());await expect(page.locator('html')).not.toHaveClass(/query-cache-preview-v154/);
  await page.evaluate(()=>{document.documentElement.classList.remove('auth-pending');document.getElementById('wrap').inert=false;});
  await state.load();await expect(page.locator('#list [data-query-preview-v154]')).toHaveCount(0);
  expect(await page.locator('#list .item').evaluateAll(cards=>cards.every(card=>!card.inert))).toBe(true);
  expect(state.pageErrors).toEqual([]);
});

test('only a matching persisted receipt fences the scoped cache through the frozen cache API',async({page,context})=>{
  const state=await setup(page,context);await state.load();const release=state.hold();
  try{
    const result=await page.evaluate(async()=>{
      const item=allItems.find(item=>item.propertyId==='FIXTURE-LEASE-1'),key='js-query-epoch-v152:'+JSAuthenticatedAccountEmail.toLowerCase();
      const before=localStorage.getItem(key);
      await JSInitialListingsCacheV1.commitItem(item,{persisted:true,propertyId:'FIXTURE-LEASE-2'});
      await JSInitialListingsCacheV1.commitItem(item,{persisted:true,queued:true,propertyId:item.propertyId});
      const rejectedUnchanged=localStorage.getItem(key)===before;
      await JSInitialListingsCacheV1.commitItem(item,{persisted:true,queued:false,propertyId:item.propertyId});
      return {frozen:Object.isFrozen(JSInitialListingsCacheV1),rejectedUnchanged,ids:JSON.parse(localStorage.getItem(key)).ids};
    });
    expect(result).toEqual({frozen:true,rejectedUnchanged:true,ids:['FIXTURE-LEASE-1']});
  }finally{release();}
});

test('default overview capture permits actual SDK sub-pixel rounding but rejects a moved map',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  const results=await page.evaluate(()=>{
    const value={signature:JSON.stringify({mode:'lease',hideDone:true,filters:{}})};
    map.getLevel=()=>7;map.getCenter=()=>new kakao.maps.LatLng(36.350422,127.3845);
    const rounded=!!JSQueryPreviewV154.capture(value);
    map.getCenter=()=>new kakao.maps.LatLng(36.3514,127.3845);const outside=JSQueryPreviewV154.capture(value);
    map.getCenter=()=>new kakao.maps.LatLng(36.3504,127.3845);jsMapUserNavigationIntentUntilV6525=Date.now();
    return {rounded,outside,moved:JSQueryPreviewV154.capture(value)};
  });
  expect(results).toEqual({rounded:true,outside:null,moved:null});
});

for(const fault of ['account','receipt','build','proof','viewport'])test('cached preview stays private and blank when its '+fault+' fence differs',async({page,context})=>{
  const state=await setup(page,context,{early:true});
  await page.evaluate(()=>{map.getCenter=()=>new kakao.maps.LatLng(36.3504,127.3845);map.getLevel=()=>7;});await state.load();
  const accepted=await page.evaluate(fault=>new Promise(resolve=>{const request=indexedDB.open('js-query-scopes-v152',1);request.onsuccess=()=>{
    const read=request.result.transaction('views').objectStore('views').get(JSAuthenticatedAccountEmail+'|lease');read.onsuccess=()=>{
      const value=read.result;document.querySelector('#list').replaceChildren();document.documentElement.classList.add('auth-pending');document.querySelector('#wrap').inert=true;
      if(fault==='account')value.account='other@example.invalid';
      if(fault==='receipt')value.cacheEpochV152='saved-in-other-tab';
      if(fault==='build')value.preview.build='old-release';
      if(fault==='proof')value.points[0].row.source_snapshot_key='sha256-v1:'+'b'.repeat(64);
      if(fault==='viewport')value.preview.width++;
      resolve(JSQueryPreviewV154.show(value,value.signature,()=>true));
    };};}),fault);
  expect(accepted).toBe(false);await expect(page.locator('#list .item')).toHaveCount(0);
});
test('market switches retain separate results and hydrate exact building and land masters',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await expect(page.locator('#list')).toContainText('테스트 건물매매');
  await expect(page.locator('#list .item')).toHaveCount(1);
  await page.evaluate(()=>JSListingTradeV1.setMode('land_sale'));await expect(page.locator('#list')).toContainText('테스트 토지매매');
  await page.evaluate(()=>JSListingTradeV1.setMode('lease'));await expect(page.locator('#list .item')).toHaveCount(2);
  expect(state.full).toEqual([]);
});
test('a verified empty query removes the previous cards without erasing other known masters',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  await page.evaluate(()=>{document.getElementById('keyword').value='없는매물-검수';applyFilter();});
  await expect(page.locator('#list .item')).toHaveCount(0);
  expect(await page.evaluate(()=>allItems.length)).toBe(2);expect(state.full).toEqual([]);
});

test('a slow or failed market switch never displays the previous market or treats its masters as usable results',async({page,context})=>{
  const state=await setup(page,context);await state.load();const release=state.hold();
  try{
    await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));
    await expect(page.locator('#list .item')).toHaveCount(0);
    await expect(page.locator('#mapListingCountValueV825')).toHaveText('불러오는 중');
    expect(await page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(false);
    state.fail(true);release();await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','error');
    await expect(page.locator('#jsListingsLoadStatusV65 button')).toHaveText('다시 불러오기');
    state.fail(false);await page.evaluate(()=>JSQueryListingsV152.load(true,true));
    await expect(page.locator('#list')).toContainText('테스트 건물매매');
    expect(await page.evaluate(()=>allItems.some(item=>item.propertyId==='FIXTURE-LEASE-1'))).toBe(true);
  }finally{release();}
});
test('a scoped refresh cache restores usable cards while the latest query is delayed',async({page,context})=>{
  const state=await setup(page,context);await state.load();await state.reload();const release=state.hold();
  try{
    await page.evaluate(()=>{void loadSheet(false,false);});
    await expect(page.locator('#list .item')).toHaveCount(2,{timeout:1500});
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','checking');
    expect(state.full).toEqual([]);release();await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','verified');
  }finally{release();}
});

test('searching a recent cache stays unverified until the revision check and cannot evict the default refresh cache',async({page,context})=>{
  const state=await setup(page,context);await state.load();await state.reload();
  const release=state.hold(),releaseRevision=state.holdRevision();
  try{
    await page.evaluate(()=>{void loadSheet(false,false);});await expect(page.locator('#list .item')).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','checking');
    await page.evaluate(()=>{document.getElementById('keyword').value='괴정동 1-1';applyFilter();});
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','checking');
    releaseRevision();await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','verified');
    await state.reload();await page.evaluate(()=>{void loadSheet(false,false);});
    await expect(page.locator('#list .item')).toHaveCount(2,{timeout:1500});
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','checking');
  }finally{release();releaseRevision();}
});
test('full photo lists are ready with the card and next image displays the decoded second photo',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  const gallery=page.locator('.unified-detail-gallery-v8');
  await expect.poll(()=>gallery.locator('.unified-detail-hero-v8 img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await page.waitForTimeout(150);
  await gallery.locator('.unified-detail-photo-nav-v8.next').click();
  await expect(gallery.locator('.unified-detail-hero-v8 img')).toHaveAttribute('src',/-2\.svg/);
  expect(await gallery.locator('.unified-detail-hero-v8 img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  expect(state.full).toEqual([]);
});
test('rent, basement and owner contact save on the exact master and survive a fresh query',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const state=await setup(page,context);await state.load();
  const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
  await card.getByRole('button',{name:'임대조건 수정',exact:true}).click();
  await page.locator('#peRentV630').fill('80');await page.locator('#peRoomV630').fill('지하1층');
  await page.locator('#peLandlordPhoneV630').fill('010-0000-1234');await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
  await expect(card.locator('.price-main')).toContainText('80');
  await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','after-save');
  await expect(card).toContainText('지하1층');
  const values=await page.evaluate(()=>allItems.map(item=>[item.propertyId,item.rent,item.room,item.landlordPhone||'']));
  expect(values.find(row=>row[0]==='FIXTURE-LEASE-1')).toEqual(['FIXTURE-LEASE-1',80,'지하1층','010-0000-1234']);
  expect(values.find(row=>row[0]==='FIXTURE-LEASE-2').slice(1,3)).toEqual([150,'2층']);
  await state.reload();await state.load();await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .price-main')).toContainText('80');
});

test('refresh immediately after saving retains the accepted rent and memo while the new catalog query is still delayed',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const state=await setup(page,context);await state.load();const release=state.hold();
  try{
    const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
    await card.getByRole('button',{name:'임대조건 수정',exact:true}).click();
    await page.locator('#peRentV630').fill('80');await page.locator('#peRoomV630').fill('지하1층');
    await page.locator('#peLandlordPhoneV630').fill('010-0000-1234');
    await page.locator('#peMemoV630').fill('저장 직후 새로고침해도 유지할 현장 메모');
    await page.locator('#propertyEditSaveBtnV630').click();await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
    await expect(card.locator('.price-main')).toContainText('80');
    await card.getByRole('button',{name:'메모 열기',exact:true}).click();
    await card.getByRole('button',{name:'추가하기',exact:true}).click();await card.locator('textarea').fill('추가 임장 확인');
    await card.getByRole('button',{name:'저장',exact:true}).click();await expect(card.locator('.item-memo-content')).toContainText('추가 임장 확인');
    await state.reload();await page.evaluate(()=>{void loadSheet(false,false);});
    await expect(card.locator('.price-main')).toContainText('80',{timeout:1500});await expect(card).toContainText('지하1층');
    expect(await page.evaluate(()=>allItems.find(item=>item.propertyId==='FIXTURE-LEASE-1').landlordPhone)).toBe('010-0000-1234');
    const memo=await page.evaluate(()=>allItems.find(item=>item.propertyId==='FIXTURE-LEASE-1').memo);
    expect(memo).toContain('저장 직후 새로고침해도 유지할 현장 메모');expect(memo).toContain('추가 임장 확인');
    await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"] .price-main')).toContainText('150');
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','checking');
  }finally{release();}
});
test('a collection refresh retains the memo editor, Korean composition and caret',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const state=await setup(page,context);await state.load();
  const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
  await card.getByRole('button',{name:'메모 열기',exact:true}).click();await card.getByRole('button',{name:'수정',exact:true}).click();
  const editor=card.locator('textarea');await editor.fill('긴 메모 첫 줄\n둘째 줄 작성 중입니다');
  await editor.evaluate(element=>{window.__queryEditor=element;element.focus();element.setSelectionRange(8,11,'backward');
    element.dispatchEvent(new CompositionEvent('compositionstart',{data:'가',bubbles:true}));});
  state.setRevision('collector-revision');await page.evaluate(()=>JSQueryListingsV152.poll());
  await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','collector-revision');
  expect(await editor.evaluate(element=>({same:element===__queryEditor,focused:document.activeElement===element,start:element.selectionStart,end:element.selectionEnd})))
    .toEqual({same:true,focused:true,start:8,end:11});
  await editor.evaluate(element=>element.dispatchEvent(new CompositionEvent('compositionend',{data:'가',bubbles:true})));
  await page.keyboard.type('계속');expect(await editor.inputValue()).toContain('계속');
});

test('edited and appended memos remain on their exact master after query refresh and reopening',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const state=await setup(page,context);await state.load();const neighbor=state.masters[1].memo;
  const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
  await card.getByRole('button',{name:'메모 열기',exact:true}).click();
  await card.getByRole('button',{name:'수정',exact:true}).click();await card.locator('textarea').fill('현장에서 직접 확인한 메모');
  await card.getByRole('button',{name:'저장',exact:true}).click();
  await expect(card.locator('.item-memo-content')).toContainText('현장에서 직접 확인한 메모');
  await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','after-memo');
  await card.getByRole('button',{name:'추가하기',exact:true}).click();await card.locator('textarea').fill('새로운 현장 기록');
  await card.getByRole('button',{name:'저장',exact:true}).click();
  await expect(card.locator('.item-memo-content')).toContainText('새로운 현장 기록');
  await state.reload();await state.load();await card.getByRole('button',{name:'메모 열기',exact:true}).click();
  await expect(card.locator('.item-memo-content')).toContainText('현장에서 직접 확인한 메모');
  await expect(card.locator('.item-memo-content')).toContainText('새로운 현장 기록');
  expect(state.masters[1].memo).toBe(neighbor);expect(state.full).toEqual([]);
});

test('a live coherent point newer than the published query is reconciled without a retry loop or sibling overwrite',async({page,context})=>{
  const state=await setup(page,context);
  state.afterNextQuery(()=>{const item=state.masters[0];item.rent=80;item.sourceSnapshotKey=hash(3);
    state.ads.get(item.propertyId).forEach(ad=>{ad.manualDisplayFields='monthly_rent';});});
  expect(await state.load()).toBe(true);
  await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .price-main')).toContainText('80');
  await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"] .price-main')).toContainText('150');
  await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','per-property');
  await page.evaluate(()=>JSQueryListingsV152.poll());expect(state.requests).toHaveLength(1);
  await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','per-property');
});

test('exact-parcel search, sorting and unchanged revision polls reuse the verified index without replacing photo nodes',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  await page.evaluate(()=>{window.__firstPhoto=document.querySelector('#list .item img');});
  await page.evaluate(()=>JSQueryListingsV152.poll());
  expect(await page.evaluate(()=>document.querySelector('#list .item img')===__firstPhoto)).toBe(true);
  await page.evaluate(()=>{document.getElementById('keyword').value='괴정동 1-1';applyFilter();});
  await expect(page.locator('#list .item')).toHaveCount(1);expect(state.requests).toHaveLength(1);
  await page.evaluate(()=>{document.getElementById('keyword').value='';document.getElementById('sortFilter').value='rentHigh';applyFilter();});
  await expect(page.locator('#list .item')).toHaveCount(2);expect(state.requests).toHaveLength(1);
  await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id','FIXTURE-LEASE-2');
});

test('a distant virtual list window hydrates only its exact masters before replacing cards',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<250;n++){const id='VIRTUAL-'+String(n).padStart(3,'0'),item={...structuredClone(state.masters[0]),propertyId:id,name:id};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);}
  await state.load();expect(await page.evaluate(()=>allItems.length)).toBeLessThan(150);
  const wanted=await page.evaluate(()=>{const ids=visibleListItems.slice(200,228).map(item=>item.propertyId);renderListWindowV2(200,228);return ids;});
  await expect.poll(()=>page.evaluate(()=>listRenderStart)).toBe(200);
  const rendered=await page.locator('#list .item').evaluateAll(cards=>cards.map(card=>card.dataset.propertyId));
  expect(rendered).toEqual(wanted);expect(state.full).toEqual([]);
  expect(await page.evaluate(()=>allItems.length)).toBeLessThan(200);
});

test('favorite lookups coalesce exact missing masters and bulk selection exposes only hydrated writable models',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<100;n++){const id='FAVORITE-'+String(n).padStart(3,'0'),item={...structuredClone(state.masters[0]),propertyId:id,name:id};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);}
  await state.load();
  const ids=await page.evaluate(()=>{const ids=visibleListItems.slice(90,95).map(item=>item.propertyId);
    ids.forEach(id=>JSQueryListingsV152.lookup('property:'+id));return ids;});
  await expect.poll(()=>page.evaluate(ids=>ids.every(id=>allItems.some(item=>item.propertyId===id&&!item.queryRowV152)),ids)).toBe(true);
  expect(state.points.some(batch=>ids.every(id=>batch.includes(id)))).toBe(true);
  await page.evaluate(()=>selectAllVisibleItems());
  await expect.poll(()=>page.evaluate(()=>getSelectedPrintItems().length)).toBe(102);
  expect(await page.evaluate(()=>getSelectedPrintItems().every(item=>!item.queryRowV152&&item.memo==='브라우저 검사 전용 가상 자료'))).toBe(true);
  expect(state.full).toEqual([]);
});

test('an automatic query row renumber preserves checked exact masters and their decoded photo nodes',async({page,context})=>{
  const state=await setup(page,context);state.masters[0].sheetRow=100;state.masters[1].sheetRow=200;await state.load();
  await expect.poll(()=>page.locator('#list .item img').first().evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await page.evaluate(()=>{selectAllVisibleItems();window.__checkedPhoto=document.querySelector('#list .item img');});
  state.masters[0].sheetRow=110;state.masters[1].sheetRow=210;state.setRevision('same-parents-renumbered');
  await page.evaluate(()=>JSQueryListingsV152.poll());
  expect(await page.evaluate(()=>getSelectedPrintItems().map(item=>[item.propertyId,item.sheetRow]).sort())).toEqual([['FIXTURE-LEASE-1',110],['FIXTURE-LEASE-2',210]]);
  expect(await page.evaluate(()=>document.querySelector('#list .item img')===__checkedPhoto)).toBe(true);
});
