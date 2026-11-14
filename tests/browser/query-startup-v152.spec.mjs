import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {snapshotTransfer} from '../../cloudflare/src/snapshot-transfer.js';
import {fixtureItems} from './fixture-server.mjs';
import {buildQueryRuntimeV151} from '../../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {createListingQueryRuntimeV151:make}=await import('../../cloudflare/generated/query-runtime-v151.js');
const {queryWireV151,numericCatalogPacketV177}=await import('../../cloudflare/src/query-worker-v151.js');
const {queryDeltaV160}=await import('../../cloudflare/src/query-delta-v160.js');
const hash=number=>'sha256-v1:'+String(number).padStart(64,'0');
const errorsByPage=new WeakMap();
test.afterEach(async({page})=>{expect(errorsByPage.get(page)||[],'No uncaught startup/runtime errors').toEqual([]);});

test('v182 query summary upgrades open the exact duplicate originals and never collapse to zero',async({page,context,isMobile})=>{
  const state=await setup(page,context),id='FIXTURE-BUILDING',ad=state.ads.get(id)[0];
  const building=state.masters.find(item=>item.propertyId===id);
  building.saleDetails={...building.saleDetails,scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true};
  ad.saleSummary={...building.saleDetails};ad.saleDetails={...building.saleDetails};
  state.ads.get(id).push({...ad,originalId:'V182-SECOND-AD',providerSourceId:'v182-second',salePrice:60000});
  await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');});await state.load();
  if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
  const card=page.locator('#list .item[data-property-id="'+id+'"]');
  await expect(card).not.toHaveAttribute('data-query-summary-v157','');
  const button=card.locator('.item-source-link-btn');await expect(button).toContainText('2개');
  if(isMobile){
    await card.locator('.unified-thumb-v8').click();
    await expect(page.locator('#unifiedDetailDrawerV8')).toBeVisible();
    await expect(page.locator('#unifiedDetailDrawerV8 .unified-original-row-v8')).toHaveCount(2);
  }else{
    await button.click();
    await expect(card.locator('.unified-inline-originals-v8 .unified-original-row-v8')).toHaveCount(2);
    await button.click();await expect(button).toContainText('2개');
    await button.click();await expect(card.locator('.unified-inline-originals-v8 .unified-original-row-v8')).toHaveCount(2);
  }
  expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
});
test('v182 grouped building duplicates retain exact filtered originals across delayed summary hydration',async({page,context,isMobile})=>{
  const state=await setup(page,context),id='FIXTURE-BUILDING',building=state.masters.find(item=>item.propertyId===id),ad=state.ads.get(id)[0];
  const detail={...building.saleDetails,scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true};
  building.saleDetails={...detail};ad.saleSummary={...detail};ad.saleDetails={...detail};
  state.ads.get(id).push({...ad,originalId:'V182-MATCHED',providerSourceId:'v182-matched',salePrice:60000},
    {...ad,originalId:'V182-EXCLUDED',providerSourceId:'v182-excluded',salePrice:200000});
  const sibling={...structuredClone(building),propertyId:'V182-SIBLING',sheetRow:99,salePrice:80000};state.masters.push(sibling);
  state.ads.set(sibling.propertyId,[{...structuredClone(ad),propertyId:sibling.propertyId,originalId:'V182-SIBLING-AD',providerSourceId:'v182-sibling',salePrice:80000}]);
  await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');document.getElementById('minDeposit').value='40000';document.getElementById('maxDeposit').value='100000';});
  const release=state.holdPoints(()=>true),loading=state.load();
  try{
    if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
    const card=page.locator('#list .item[data-property-id="'+id+'"]');await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-query-summary-v157','');
    await expect(card.locator('.item-source-link-btn')).toContainText('3개');
    if(isMobile)await card.locator('.unified-thumb-v8').click();else await card.locator('.item-source-link-btn').click();
    release();await loading;
    const rows=isMobile?page.locator('#unifiedDetailDrawerV8 .unified-original-row-v8'):card.locator('.unified-inline-originals-v8 .unified-original-row-v8');
    await expect(rows).toHaveCount(3);
    expect((await rows.evaluateAll(nodes=>nodes.map(node=>node.dataset.originalId))).sort()).toEqual([id+'-ORIGINAL','V182-MATCHED','V182-SIBLING-AD'].sort());
    if(!isMobile){
      const button=card.locator('.item-source-link-btn');await button.click();await expect(button).toHaveText('동일매물 3개');
      await button.click();await expect(rows).toHaveCount(3);
      await card.screenshot({path:'outputs/v182-expanded-building-desktop.png'});
    }
    expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
  }finally{release();await loading;}
});

async function setup(page,context,settings={}){
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  errorsByPage.set(page,pageErrors);
  let armed=false,fail=false,queryGate=null,revisionGate=null,afterQuery=null,pointGate=null,pointPredicate=null,mediaGate=null,mediaPredicate=null,photoGate=null,photoPredicate=null;const requests=[],full=[],points=[],mediaReads=[],photoReads=[];
  const masters=fixtureItems.map((item,index)=>{const value=structuredClone(item);delete value.key;return {...value,sheetRow:index+2,sourceSnapshotKey:hash(1)};});
  let revision='query-initial',phoneGate=null,phonePredicate=null,phoneFailure=false,catalogGate=null;const sentPackets=new Map(),transfers=[],mutations=[],phoneReads=[],rangeReads=[];
  const ads=new Map(masters.map(item=>[item.propertyId,[{...structuredClone(item),originalId:item.propertyId+'-ORIGINAL',
    active:1,availabilityKind:'active',floor:item.tradeType==='sale'?null:Number.parseInt(item.room)||null,
    source:'네이버',providerSourceId:'source-'+item.propertyId,photoCount:3,revision:'fixture-1'}]]));
  function original(id,origin){return ads.get(id).map(original=>({...original,propertyId:id,link:origin+'/original/'+id,
    thumbnail:original.thumbnail||origin+'/__query/photo-'+id+'-1.svg',images:original.images||[1,2,3].map(n=>origin+'/__query/photo-'+id+'-'+n+'.svg')}));}
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
    if(url.pathname.endsWith('.svg')){photoReads.push(url.pathname);if(photoGate&&photoPredicate(url.pathname))await photoGate;return route.fulfill({contentType:'image/svg+xml',headers:{'cache-control':'public, max-age=3600'},
      body:`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="${url.pathname.includes('-2.svg')?'#15803d':'#2563eb'}"/></svg>`});
    }
    return route.fulfill({status:404,body:'fixture'});
  });
  await context.route('**/api/sheet**',route=>{if(!armed)return route.fallback();full.push('csv');return route.fulfill({status:500,json:{ok:false}});});
  await context.route('**/api/data**',async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('action');
    if(!armed)return route.fallback();
    if(request.method()==='POST'){
      const body=request.postDataJSON();
      mutations.push(structuredClone(body));
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
    if(action==='listingQueryMedia'){
      const ids=url.searchParams.get('ids').split(',');mediaReads.push(ids);if(mediaGate&&mediaPredicate(ids))await mediaGate;
      const spec=JSON.parse(url.searchParams.get('spec')),runtime=make(structuredClone(masters),unified(masters.map(item=>item.propertyId),url.origin));
      const rows=runtime.query({...spec,ignoreMapBounds:true,includeUnlocated:true,deferFinalize:true}).filter(item=>ids.includes(item.propertyId)).map(item=>{
        const selected=item.unifiedDisplayOriginalsV2[0];return [item.propertyId,item.sourceSnapshotKey,selected?.thumbnail||null,selected?.originalId||null,selected?.photoCount??null];
      });
      return route.fulfill({json:{ok:true,version:159,revision,fields:['propertyId','sourceSnapshotKey','thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'],rows,requestedIds:ids,missingIds:ids.filter(id=>!rows.some(row=>row[0]===id))}});
    }
    if(action==='listingQuery'){
      const spec=JSON.parse(url.searchParams.get('spec'));requests.push(spec.mode);if(queryGate)await queryGate;
      if(catalogGate&&!['217','228'].includes(url.searchParams.get('navigation')))await catalogGate;
      if(fail)return route.fulfill({status:503,json:{ok:false,message:'fixture query unavailable'}});
      const items=structuredClone(masters),ids=items.map(item=>item.propertyId),runtime=make(items,unified(ids,url.origin));
      const numericGroups=new Map();
      const capture=(settings.numericCatalog||settings.deltaQueries)&&!Object.entries(spec.filters||{}).some(([k,v])=>v&&k!=='sortFilter')?item=>{
        const selected=item.unifiedOriginalsV8[0];if(!selected)return;const values=numericGroups.get(item.propertyId)||[];values.push({...item,unifiedDisplayOriginalsV2:[selected],queryMatchedOriginalCountV152:1,unifiedOriginalCountV8:1,unifiedCandidateOriginalCountV2:0,unifiedAbsenceConfirmedTimeV1:0,thumbnailV8:runtime.firstThumbnail(selected)});numericGroups.set(item.propertyId,values);}:null;
      const rows=runtime.query({...spec,deferFinalize:true,ignoreMapBounds:true,includeUnlocated:true},capture).map(item=>({...item,
        queryGroupKeyV152:runtime.groupKey(item.propertyId),...runtime.visitFlags(item),
        queryMatchedOriginalCountV152:item.unifiedDisplayOriginalsV2.length}));
      const finalized=runtime.finalize(rows,{...spec,individualQueryV152:true});
      const packet=capture?numericCatalogPacketV177(finalized,numericGroups,revision,spec.mode):queryWireV151(finalized,revision);
      if(settings.numericCatalog&&!capture)packet.numericCatalogDeferredV220=true;
      if(settings.legacyPacket){
        const keep=packet.fields.map((field,index)=>['thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'].includes(field)?-1:index).filter(index=>index>=0);
        packet.fields=keep.map(index=>packet.fields[index]);packet.rows=packet.rows.map(row=>keep.map(index=>row[index]));delete packet.cardProjectionV157;
      }
      const previous=sentPackets.get(url.searchParams.get('since'));sentPackets.set(revision,structuredClone(packet));
      if(settings.deltaQueries&&previous&&url.searchParams.get('fields')===JSON.stringify(packet.fields)){
        if(previous.revision===revision){transfers.push('unchanged');return route.fulfill({json:{ok:true,version:160,queryDeltaV160:true,baseRevision:revision,revision,unchanged:true}});}
        const at=packet.fields.indexOf('propertyId'),prior=new Map(previous.rows.map(row=>[row[at],row])),current=new Map(packet.rows.map(row=>[row[at],row]));
        const changed=[...new Set([...prior.keys(),...current.keys()])].filter(id=>JSON.stringify(prior.get(id))!==JSON.stringify(current.get(id)));
        transfers.push('delta');return route.fulfill({json:await queryDeltaV160({state:{revision},since:previous.revision,changes:()=>changed,loadPacket:async()=>packet})});

      }
      if(settings.navigationFirst&&['217','228'].includes(url.searchParams.get('navigation'))){
        transfers.push('navigation');return route.fulfill({json:{...packet,numericCatalogV177:undefined,numericCatalogDeferredV217:true}});
      }
      if(settings.ranges&&spec.mode!=='lease'&&!url.searchParams.has('since')){
        const bytes=gzipSync(JSON.stringify(packet)),headers=request.headers(),kind=headers['x-js-snapshot-mode'];
        if(kind){
          rangeReads.push({mode:spec.mode,kind});
          const meta={httpEtag:'"'+spec.mode+'-'+revision+'"',etag:spec.mode+'-'+revision,size:bytes.length,httpMetadata:{contentType:'application/json',contentEncoding:'gzip'},customMetadata:{revision}};
          const media={async head(){return meta;},async get(_key,{range,onlyIf}){if(onlyIf.etagMatches!==meta.etag)return null;return {...meta,range,body:new Blob([bytes.subarray(range.offset,range.offset+range.length)]).stream()};}};
          const result=await snapshotTransfer({MEDIA:media},'query',0,new Request(request.url(),{headers}),revision);
          return route.fulfill({status:result.response.status,headers:Object.fromEntries(result.response.headers),body:Buffer.from(await result.response.arrayBuffer())});
        }
      }
      transfers.push('full');
      if(afterQuery){const run=afterQuery;afterQuery=null;run();}
      return route.fulfill({json:packet});
    }
    if(action==='unifiedListingContacts'&&url.searchParams.get('card')==='171'){
      const id=url.searchParams.get('propertyId'),item=masters.find(item=>item.propertyId===id);
      phoneReads.push(id);if(phoneGate&&phonePredicate(id))await phoneGate;
      if(phoneFailure)return route.fulfill({status:503,json:{ok:false,message:'연락처 확인 지연'}});
      return route.fulfill({json:{ok:true,propertyId:id,contacts:item.collectedContactsV227||[],contactCount:(item.collectedContactsV227||[]).length,cardV171:{propertyId:id,name:item.name,address:item.address,room:item.room,
        source:item.source,memo:item.memo,landlordPhone:item.landlordPhone||'',tenantPhone:item.tenantPhone||'',contactListRaw:JSON.stringify(item.contacts||[]),sourceSnapshotKey:item.sourceSnapshotKey,
        manualFinancialFieldsV106:(ads.get(id)[0].manualDisplayFields||'').split(',')}}});
    }
    if(action==='listingOriginals'){
      const ids=url.searchParams.get('ids').split(',');points.push(ids);
      if(pointGate&&pointPredicate(ids))await pointGate;
      return route.fulfill({json:{ok:true,requestedIds:ids,missingIds:ids.filter(id=>!masters.some(item=>item.propertyId===id)),items:masters.filter(item=>ids.includes(item.propertyId)).map(raw),
        unified:unified(ids.filter(id=>masters.some(item=>item.propertyId===id)),url.origin)}});
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
    await page.addScriptTag({url:'/js/query-collection-v152.js'});await page.addScriptTag({url:'/js/query-preview-v154.js'});await page.addScriptTag({url:'/js/query-thumbnails-v159.js'});await page.addScriptTag({url:'/js/query-numeric-v177.js'});await page.addScriptTag({url:'/js/query-startup-v152.js'});
    await page.evaluate(()=>{
      window.drawItems=items=>{
        jsLastRenderedItemsV639=items.slice();
        const pinned=getPinnedClusterItemsV6515();showList(pinned.length?pinned:getAdministrativeListItemsV6570(items));updateMapListingCountV825(items);
      };window.clearPinnedClusterSelectionV6515=()=>{};
      allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();document.getElementById('fixtureControls')?.remove();
      window.JSQueryListingsEnabledV152=true;
    });armed=true;
  }
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await install();
  return {requests,full,points,mediaReads,photoReads,phoneReads,masters,ads,pageErrors,transfers,mutations,rangeReads,packets:sentPackets,pointFor:ids=>{const present=ids.filter(id=>masters.some(i=>i.propertyId===id));return {ok:true,requestedIds:ids,missingIds:ids.filter(id=>!present.includes(id)),items:masters.filter(i=>present.includes(i.propertyId)).map(raw),unified:unified(present,new URL(page.url()).origin)};},load:()=>page.evaluate(()=>loadSheet(false,false)),
    failPhones:value=>{phoneFailure=value;},
    holdPhones(predicate){let release;phonePredicate=predicate;phoneGate=new Promise(resolve=>{release=resolve;});return()=>{phoneGate=null;release();};},
    setRevision:value=>{revision=value;},fail:value=>{fail=value;},afterNextQuery:run=>{afterQuery=run;},
    hold(){let release;queryGate=new Promise(resolve=>{release=resolve;});return()=>{queryGate=null;release();};},
    holdCatalog(){let release;catalogGate=new Promise(resolve=>{release=resolve;});return()=>{catalogGate=null;release();};},
    holdRevision(){let release;revisionGate=new Promise(resolve=>{release=resolve;});return()=>{revisionGate=null;release();};},
    holdPoints(predicate){let release;pointPredicate=predicate;pointGate=new Promise(resolve=>{release=resolve;});return()=>{pointGate=null;release();};},
    holdMedia(predicate){let release;mediaPredicate=predicate;mediaGate=new Promise(resolve=>{release=resolve;});return()=>{mediaGate=null;release();};},
    holdPhotos(predicate){let release;photoPredicate=predicate;photoGate=new Promise(resolve=>{release=resolve;});return()=>{photoGate=null;release();};},
    async reload(){armed=false;await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await install();}};
}

test('phone numbers display without waiting for writable masters or source photos',async({page,context})=>{
  if(test.info().project.name==='mobile')await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context);state.masters[0].landlordPhone='010-1234-5678';
  state.ads.get('FIXTURE-LEASE-1')[0].manualDisplayFields='landlord_phone';
  const release=state.holdPoints(()=>true),loading=state.load();
  try{
    const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
    await expect(card).toHaveAttribute('data-query-summary-v157','');
    if(await page.evaluate(()=>isPhoneListingV2()))await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
    expect(state.phoneReads).toEqual([]);
    const started=Date.now();
    await card.locator('.item-contact-button-v654').click();
    await expect(page.locator('#listContactBodyV654 a[href="tel:01012345678"]')).toBeVisible({timeout:700});
    expect(Date.now()-started).toBeLessThan(700);
    await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
    await card.locator('.item-contact-button-v654').click();
    await expect(page.locator('#listContactBodyV654 a')).toHaveCount(1);expect(state.phoneReads).toEqual(['FIXTURE-LEASE-1']);
    expect(await page.evaluate(()=>allItems.length)).toBe(0);expect(state.mutations).toEqual([]);
  }finally{release();await loading;}
});

test('contact green stays consistent through summary/full rendering without extra master reads',async({page,context})=>{
  await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context),item=state.masters.find(i=>i.propertyId==='FIXTURE-LEASE-1');
  item.memo='[26.11.13]임01012345678';
  const release=state.holdPoints(()=>true),loading=state.load();
  try{
    const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]'),button=card.locator('.item-contact-button-v654');
    await expect(card).toHaveAttribute('data-query-summary-v157','');
    await expect(button).toHaveClass(/no-contacts/);
    expect(state.phoneReads).toEqual([]);const initialPoints=structuredClone(state.points);
    await button.click();await expect(page.locator('#listContactBodyV654 a[href="tel:01012345678"]')).toBeVisible();
    await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
    await expect(button).toHaveClass(/has-contacts/);
    await page.evaluate(()=>{for(let i=0;i<5;i++)showList(currentItems);});
    await expect(card.locator('.item-contact-button-v654')).toHaveClass(/has-contacts/);
    expect(state.phoneReads).toEqual(['FIXTURE-LEASE-1']);expect(state.points).toEqual(initialPoints);expect(state.mutations).toEqual([]);
  }finally{release();await loading;}
  await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-contact-button-v654')).toHaveClass(/has-contacts/);
});

test('contact presence follows a new exact-parent proof without waiting for phone or editable master reads',async({page,context})=>{
  await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context),item=state.masters.find(i=>i.propertyId==='FIXTURE-LEASE-1');
  item.memo='임01012345678';item.displayValuePresence={...item.displayValuePresence,contactsV224:true};
  const release=state.holdPoints(()=>true),releasePhones=state.holdPhones(()=>true),loading=state.load();
  try{
    const button=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-contact-button-v654');
    await expect(button).toHaveClass(/has-contacts/);
    state.setRevision('R2');item.sourceSnapshotKey=hash(224);
    await page.evaluate(()=>{window.__contactReloadV224=JSQueryListingsV152.load(true,true).catch(()=>false);});
    await expect.poll(()=>button.evaluate(el=>el.closest('.item').__listItemV132.sourceSnapshotKey)).toBe(hash(224));
    await expect(button).toHaveClass(/has-contacts/);
    state.setRevision('R3');item.sourceSnapshotKey=hash(225);item.memo='메모에서 번호 삭제';item.displayValuePresence.contactsV224=false;
    await page.evaluate(()=>{window.__contactReloadV224=JSQueryListingsV152.load(true,true).catch(()=>false);});
    await expect.poll(()=>button.evaluate(el=>el.closest('.item').__listItemV132.sourceSnapshotKey)).toBe(hash(225));
    await expect(button).toHaveClass(/no-contacts/);
    expect(state.phoneReads.every(id=>id==='FIXTURE-LEASE-1')).toBe(true);expect(state.mutations).toEqual([]);
  }finally{releasePhones();release();await loading;await page.evaluate(()=>window.__contactReloadV224);}
});

test('late phone reads cannot replace a different listing, closed dialog, or changed account',async({page,context})=>{
  await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();
  const slow=state.holdPhones(id=>id==='FIXTURE-LEASE-1');
  try{
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);
    state.masters[0].landlordPhone='010-1234-5678';state.masters[1].landlordPhone='010-9876-5432';
    for(const id of ['FIXTURE-LEASE-1','FIXTURE-LEASE-2'])state.ads.get(id)[0].manualDisplayFields='landlord_phone';
    await page.evaluate(()=>{JSUnifiedListingsV8.getCachedContacts=()=>({ok:true,contactCount:1,contacts:[{role:'임대인',phone:'010-0000-9999'}]});});
    const click=id=>page.locator(`#list .item[data-property-id="${id}"] .item-contact-button-v654`).click();
    await click('FIXTURE-LEASE-1');await expect.poll(()=>state.phoneReads.length).toBe(1);
    await expect(page.locator('#listContactBodyV654 a')).toHaveCount(0);
    await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
    await click('FIXTURE-LEASE-2');await expect(page.locator('#listContactBodyV654 a[href="tel:01098765432"]')).toBeVisible();
    slow();await expect(page.locator('#listContactBodyV654 a')).toHaveCount(1);
    await expect(page.locator('#listContactBodyV654')).not.toContainText('1234');
    await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
    const gate=state.holdPhones(()=>true);
    await page.evaluate(()=>{window.JSAuthenticatedAccountEmail='different@example.test';});
    await click('FIXTURE-LEASE-1');await expect.poll(()=>state.phoneReads.length).toBe(3);
    await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));
    gate();await expect(page.locator('#listContactModalV654')).not.toBeVisible();
    expect(state.mutations).toEqual([]);
  }finally{slow();release();await loading;}
});

test('failed phone reads stay retryable and never become a cached empty-contact success',async({page,context})=>{
  await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();
  try{
    state.masters[0].landlordPhone='010-1234-5678';state.ads.get('FIXTURE-LEASE-1')[0].manualDisplayFields='landlord_phone';
    state.failPhones(true);const button=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-contact-button-v654');
    await button.click();await expect(page.locator('#listContactBodyV654 .list-contact-error-v8')).toContainText('연락처 확인 지연');
    await expect(page.locator('#listContactBodyV654 .list-contact-empty-v654')).toHaveCount(0);
    await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
    state.failPhones(false);await button.click();await expect(page.locator('#listContactBodyV654 a')).toHaveCount(1);
    expect(state.phoneReads).toEqual(['FIXTURE-LEASE-1','FIXTURE-LEASE-1']);expect(state.mutations).toEqual([]);
  }finally{release();await loading;}
});

test('phone projection rejects a different source proof and untrusted broker phone fields',async({page,context})=>{
  await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();
  try{
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);
    state.masters[0].landlordPhone='010-1234-5678';state.masters[0].memo='부동산 문의 010-1111-2222';
    const button=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-contact-button-v654');
    await button.click();await expect(page.locator('#listContactBodyV654 .list-contact-empty-v654')).toBeVisible();
    await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
    await page.evaluate(()=>{window.JSAuthenticatedAccountEmail='proof-test@example.test';});
    state.masters[0].sourceSnapshotKey=hash(2);state.ads.get('FIXTURE-LEASE-1')[0].manualDisplayFields='landlord_phone';
    await button.click();await expect(page.locator('#listContactBodyV654 .list-contact-error-v8')).toBeVisible();
    await expect(page.locator('#listContactBodyV654 a')).toHaveCount(0);expect(state.mutations).toEqual([]);
  }finally{release();await loading;}
});

test('known manual phones display immediately while linked contacts are held; closure cancels late repaint',async({page,context})=>{
  await page.setViewportSize({width:900,height:600});
  const state=await setup(page,context);state.masters[0].landlordPhone='010-1234-5678';
  state.masters[0].collectedContactsV227=[{role:'관리인',phone:'010-9876-5432'}];
  const release=state.holdPhones(()=>true);
  state.ads.get('FIXTURE-LEASE-1')[0].manualDisplayFields='landlord_phone';await state.load();
  await page.evaluate(()=>{
    allItems.find(item=>item.propertyId==='FIXTURE-LEASE-1').gongsilContactCountV8=1;
  });
  await page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-contact-button-v654').click();
  await expect(page.locator('#listContactBodyV654 a[href="tel:01012345678"]')).toBeVisible({timeout:700});
  await expect(page.locator('#listContactBodyV654 .list-contact-loading-v8')).toBeVisible();
  await page.locator('#listContactModalV654').getByRole('button',{name:'닫기',exact:true}).click();
  const before=await page.locator('#listContactBodyV654').innerHTML();
  release();
  await expect(page.locator('#listContactModalV654')).not.toBeVisible();
  expect(await page.locator('#listContactBodyV654').innerHTML()).toBe(before);
  await page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-contact-button-v654').click();
  await expect(page.locator('#listContactBodyV654 a')).toHaveCount(2);expect(state.mutations).toEqual([]);
});

test('query startup renders full actionable cards without full CSV/original downloads or a fake complete cache',async({page,context})=>{
  const state=await setup(page,context);expect(await state.load()).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(2);
  expect(state.full).toEqual([]);expect(state.points.flat().sort()).toEqual(['FIXTURE-LEASE-1','FIXTURE-LEASE-2']);
  expect(await page.evaluate(()=>({whole:jsListingsCompleteBaseV1,fullModels:allItems.every(item=>!item.queryRowV152),count:allItems.length})))
    .toEqual({whole:false,fullModels:true,count:2});
  expect(await page.evaluate(()=>JSInitialListingsCacheV1.read())).toBeNull();
});

test('building phone review forces exact writable masters without blocking already visible cards/photos',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  state.masters[0].landlordPhone='010-1234-5678';state.masters[0].sourceSnapshotKey=hash(2);
  state.ads.get('FIXTURE-LEASE-1')[0].manualDisplayFields='landlord_phone';
  const release=state.holdPoints(()=>true),reads=state.points.length;
  const opening=page.evaluate(()=>JSBuildingRegistryV164.openContact(allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1')));
  try{
    await expect.poll(()=>state.points.length).toBeGreaterThan(reads);
    await expect(page.locator('#list .item')).toHaveCount(2);
    expect(await page.locator('#list .item img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await expect(page.locator('#buildingRegistryDialogV164 [data-save]')).toBeDisabled();
    release();await opening;
    await expect(page.locator('#buildingRegistryDialogV164 [data-phone]')).toHaveValue('010-1234-5678');
    await expect(page.locator('#buildingRegistryDialogV164 [data-save]')).toBeEnabled();
    expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{release();await opening;}
});

test('late building master review after cancellation cannot reopen or replace another draft',async({page,context})=>{
  const state=await setup(page,context);await state.load();const release=state.holdPoints(()=>true),reads=state.points.length;
  const opening=page.evaluate(()=>JSBuildingRegistryV164.openContact(allItems[0]));
  try{
    await expect.poll(()=>state.points.length).toBeGreaterThan(reads);
    await page.locator('#buildingRegistryDialogV164 [data-close]').first().click();
    release();await opening;await expect(page.locator('#buildingRegistryDialogV164')).not.toBeVisible();expect(state.mutations).toEqual([]);
  }finally{release();await opening;}
});

test('first list and real photos display while every writable master read is held',async({page,context})=>{
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();
  try{
    await expect(page.locator('#list .item')).toHaveCount(2);
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);
    await expect.poll(()=>page.locator('#list .item img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    expect(await page.evaluate(()=>allItems.length)).toBe(0);
    expect(await page.evaluate(()=>jsListingsCompleteBaseV1)).toBe(false);
  }finally{release();await loading;}
  await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(0);
});

test('checkboxes respond before writable masters arrive and retain the exact selection through hydration',async({page,context})=>{
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();
  try{
    await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);
    if(await page.evaluate(()=>isPhoneListingV2()))await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
    const first=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .action-select-check');
    await first.evaluate(input=>{window.__selectedCheckboxV162=input;window.__selectedPhotoV162=input.closest('.item').querySelector('img');});
    await first.click();
    await expect(first).toBeChecked({timeout:700});
    await expect(page.locator('#selectionActionCount')).toHaveText('1건 선택');
    const second=page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"] .action-select-check');
    await second.locator('..').click({position:{x:2,y:2}});
    await expect(second).toBeChecked();await expect(page.locator('#selectionActionCount')).toHaveText('2건 선택');
    await first.focus();await first.press('Space');await expect(first).not.toBeChecked();
    expect(await page.locator('#listMasterCheckbox').evaluate(input=>input.indeterminate)).toBe(true);
    await page.locator('#listToolbar .list-master-select').click();await expect(first).toBeChecked();await expect(second).toBeChecked();
    await page.locator('#selectionActionBar .selection-clear-btn').click();await expect(first).not.toBeChecked();await expect(second).not.toBeChecked();
    await first.locator('..').click({position:{x:2,y:2}});await expect(first).toBeChecked();
    expect(await first.evaluate(input=>input===__selectedCheckboxV162&&input.closest('.item').querySelector('img')===__selectedPhotoV162)).toBe(true);
    const sizes=await first.evaluate(input=>({box:input.getBoundingClientRect().width,hit:input.parentElement.getBoundingClientRect().width}));
    expect(sizes.box).toBeGreaterThanOrEqual(22);expect(sizes.hit).toBeGreaterThanOrEqual(32);
    expect(await page.evaluate(()=>allItems.length)).toBe(0);
    expect(state.mutations).toEqual([]);
    release();await loading;
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(0);
    await expect(first).toBeChecked();
    expect(await page.evaluate(()=>getSelectedPrintItems().map(item=>item.propertyId))).toEqual(['FIXTURE-LEASE-1']);
    await first.uncheck();await expect(first).not.toBeChecked();
  }finally{release();await loading;}
});

test('an immediate selected action keeps its captured ID when selection changes before the save receipt',async({page,context})=>{
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();let releaseAck;const gate=new Promise(resolve=>{releaseAck=resolve;}),writes=[];
  await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body?.action!=='updateProperty')return route.fallback();writes.push(body);await gate;return route.fallback();});
  let releaseQuery;
  try{
    await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);releaseQuery=state.hold();
    if(await page.evaluate(()=>isPhoneListingV2()))await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
    const first=page.locator('#list [data-property-id="FIXTURE-LEASE-1"] .action-select-check'),second=page.locator('#list [data-property-id="FIXTURE-LEASE-2"] .action-select-check');
    await first.check();await page.locator('#selectionActionBar .selection-hold-btn-v160').click();
    await expect(page.locator('#list [data-property-id="FIXTURE-LEASE-1"] [data-state-saving-v225]')).toHaveText('보류 저장 중');expect(writes).toHaveLength(1);expect(writes[0].key).toEqual({propertyId:'FIXTURE-LEASE-1'});
    await first.uncheck();await second.check();releaseAck();await expect.poll(()=>state.mutations.length).toBe(1);
    await expect(second).toBeChecked();expect(state.masters[1].state).toBe('active');expect(writes).toHaveLength(1);
    await page.locator('#selectionActionBar .selection-hold-btn-v160').click();await expect.poll(()=>state.mutations.length).toBe(2);
    expect(writes.map(b=>b.key.propertyId)).toEqual(['FIXTURE-LEASE-1','FIXTURE-LEASE-2']);expect(state.masters.map(i=>i.state).slice(0,2)).toEqual(['보류','보류']);
  }finally{releaseAck();releaseQuery?.();release();await loading;}
});

test('repeated selected actions publish immediately and send one state-only write per captured ID',async({page,context})=>{
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();let releaseAck;const gate=new Promise(resolve=>{releaseAck=resolve;}),writes=[];
  await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body?.action!=='updateProperty')return route.fallback();writes.push(body);await gate;return route.fallback();});
  let releaseQuery;
  try{
    await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);releaseQuery=state.hold();
    if(await page.evaluate(()=>isPhoneListingV2()))await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
    await page.locator('#listToolbar .list-master-select').click();await expect(page.locator('#selectionActionCount')).toHaveText('2건 선택');
    const hold=page.locator('#selectionActionBar .selection-hold-btn-v160');await hold.click();await hold.click();
    await expect(page.locator('#list [data-state-saving-v225]')).toHaveCount(2);expect(writes).toHaveLength(2);
    state.masters[0].rent=80;state.masters[0].sourceSnapshotKey=hash(2);state.ads.get('FIXTURE-LEASE-1')[0].rent=80;
    releaseAck();await expect.poll(()=>state.mutations.length).toBe(2);
    expect(writes.map(value=>value.key.propertyId).sort()).toEqual(['FIXTURE-LEASE-1','FIXTURE-LEASE-2']);
    expect(writes.every(value=>JSON.stringify(value.editedFields)==='["state"]'&&Object.keys(value.updated).join(',')==='state')).toBe(true);expect(state.masters[0].rent).toBe(80);
  }finally{releaseAck();releaseQuery?.();release();await loading;}
});

test('selected print opens during the gesture and waits for the complete selected masters without printing a subset',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const state=await setup(page,context),release=state.holdPoints(()=>true),loading=state.load();let popup;
  try{
    await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(2);
    if(await page.evaluate(()=>isPhoneListingV2()))await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
    await page.locator('#listToolbar .list-master-select').click();
    await page.evaluate(()=>{const open=window.open;window.open=function(...args){const popup=open.apply(window,args);if(popup)popup.print=()=>{};return popup;};});
    const opened=context.waitForEvent('page');await page.locator('#selectionActionBar').getByRole('button',{name:'선택인쇄',exact:true}).click();popup=await opened;
    await expect(popup.locator('body')).toContainText('선택한 매물 정보를 확인하고 있습니다');
    await expect(popup.locator('.js-print-table')).toHaveCount(0);
    release();await loading;
    await expect(popup.locator('.js-print-table')).toContainText('괴정동 1-1');
    await expect(popup.locator('.js-print-table')).toContainText('탄방동 2-2');
    expect(state.mutations).toEqual([]);
  }finally{release();await loading;if(popup&&!popup.isClosed())await popup.close();}
});

test('refresh reuses a current verified index without transferring the full listing packet and applies exact changed conditions',async({page,context})=>{
  const state=await setup(page,context,{deltaQueries:true});await state.load();await state.reload();await state.load();
  expect(state.transfers).toEqual(['full','unchanged']);
  await expect(page.locator('html')).toHaveAttribute('data-query-transfer-v160','unchanged');
  state.masters[0].rent=80;state.masters[0].sourceSnapshotKey=hash(2);state.ads.get(state.masters[0].propertyId)[0].rent=80;
  state.setRevision('changed-one');await page.evaluate(()=>JSQueryListingsV152.poll());
  expect(state.transfers.at(-1)).toBe('delta');await expect(page.locator('html')).toHaveAttribute('data-query-transfer-v160','delta');
  expect(await page.evaluate(()=>visibleListItems.find(item=>item.propertyId==='FIXTURE-LEASE-1').rent)).toBe(80);
  expect(await page.evaluate(()=>visibleListItems.find(item=>item.propertyId==='FIXTURE-LEASE-2').rent)).toBe(150);
});

test('hold saves only the selected master state, survives reload and can return to confirmed or unconfirmed',async({page,context})=>{
  const state=await setup(page,context,{deltaQueries:true});await state.load();
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  const phone=await page.evaluate(()=>isPhoneListingV2());
  if(phone)await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
  const beforeMemo=state.masters[0].memo,beforeOther=structuredClone(state.masters[1]);
  await page.locator('#list [data-property-id="FIXTURE-LEASE-1"] .action-select-check').check();
  const bar=page.locator('#selectionActionBar');await expect(bar).toBeVisible();
  await bar.getByRole('button',{name:'보류',exact:true}).click();
  await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .verification-held-v160')).toBeVisible();
  await expect.poll(()=>state.masters[0].state).toBe('보류');expect(state.masters[0].memo).toBe(beforeMemo);
  expect(state.mutations.at(-1).updated).toEqual({state:'보류'});expect(state.masters[1]).toEqual(beforeOther);
  expect(await page.evaluate(()=>getFieldVisitClusterClassV684({items:[{state:'보류'}]},false))).toBe(' verification-held-v160');
  const orange=await page.evaluate(()=>{
    const cluster={key:'held-color-check',items:[{state:'보류'}],worldGrid:true},host=document.createElement('div');
    host.innerHTML=buildClusterOverlayContentV655(cluster,getFieldVisitClusterClassV684(cluster,false));document.getElementById('map').append(host);
    const marker=host.firstElementChild,result={color:getComputedStyle(marker).backgroundColor,count:marker.dataset.heldCountV160};host.remove();return result;
  });
  expect(orange.color).toContain('251, 146, 60');expect(orange.count).toBeUndefined();
  const mixed=await page.evaluate(()=>{
    const held={state:'보류',memo:'(임장가자)'},confirmed=()=>({state:'확인',memo:'(확인매물)'});
    return ['address','grid','region'].map(mode=>{
      const cluster={key:'held-mixed-'+mode,items:[confirmed(),confirmed(),confirmed(),held],worldGrid:mode==='grid',regionMode:mode==='region'?'dong':null,regionLabel:'검수동'},host=document.createElement('div');
      host.innerHTML=buildClusterOverlayContentV655(cluster,getFieldVisitClusterClassV684(cluster,false));document.getElementById('map').append(host);
      const marker=host.firstElementChild,style=getComputedStyle(marker),pseudo=getComputedStyle(marker,'::after');
      const result={mode,confirmed:marker.classList.contains('visit-confirmed-v89'),color:style.backgroundColor,
        count:marker.dataset.heldCountV160,pseudo:pseudo.content,text:marker.textContent};host.remove();return result;
    });
  });
  for(const marker of mixed){expect(marker.confirmed).toBe(true);expect(marker.count).toBeUndefined();expect(['none','normal','""']).toContain(marker.pseudo);expect(marker.text).toContain('4');}
  expect(mixed[0].color).toBe(await page.evaluate(()=>{
    const host=document.createElement('div');host.innerHTML=buildClusterOverlayContentV655({key:'confirmed-color',items:[{state:'확인'}]},' visit-confirmed-v89');document.getElementById('map').append(host);const color=getComputedStyle(host.firstElementChild).backgroundColor;host.remove();return color;
  }));
  expect(await page.evaluate(()=>getFieldVisitClusterClassV684({items:[{state:'보류'},{memo:'(임장가자)'}]},false))).toBe(' source-gongsil');
  await state.reload();await state.load();
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  if(phone)await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
  await expect(page.locator('.verification-held-v160.gongsil-source-badge')).toBeVisible();
  await page.locator('#list [data-property-id="FIXTURE-LEASE-1"] .action-select-check').check();
  await page.evaluate(()=>markSelectedAsVisited());await expect.poll(()=>state.masters[0].state).toBe('확인');
  expect(await page.evaluate(()=>isConfirmedVisitItem(JSQueryListingsV152.filtered({ignoreMapBounds:true,includeUnlocated:true}).find(item=>item.propertyId==='FIXTURE-LEASE-1')))).toBe(true);
  await expect(page.locator('#list [data-property-id="FIXTURE-LEASE-1"] .verification-done-v661')).toHaveText('확인');
  const item=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
  if(phone){
    await page.locator('#list [data-property-id="FIXTURE-LEASE-1"] .action-select-check').check();
    await bar.getByRole('button',{name:'미확인',exact:true}).click();
  }else{
    await item.getByRole('button',{name:'임대조건 수정',exact:true}).click();
    await page.locator('#peStateV630').selectOption('미확인');await page.locator('#propertyEditModalV630').getByRole('button',{name:'저장',exact:true}).click();
  }
  await expect.poll(()=>state.masters[0].state).toBe('미확인');await state.reload();await state.load();
  expect(await page.evaluate(()=>{const item=JSQueryListingsV152.navigationItems().find(item=>item.propertyId==='FIXTURE-LEASE-1');return{held:isHeldListingV160(item),pending:isFieldVisitItem(item)};})).toEqual({held:false,pending:true});
  expect(state.masters[1]).toEqual(beforeOther);expect(state.masters[0].memo).toBe(beforeMemo);
});

test('a ready scoped index redraws clusters on repeated zoom and pan without waiting for a legacy complete catalog',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  const initialOrder=await page.evaluate(()=>JSQueryListingsV152.navigationItems().map(item=>item.propertyId));
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
    expect(await page.evaluate(()=>__navigationFramesV155.at(-1))).toEqual({level,ids:east?[]:initialOrder});
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
  // Finish hydrating the previous window before fixing its synthetic start.
  // Its late card upgrade may legitimately reflow the reading anchor to74.
  const previousCard=page.locator('#list .item[data-list-index-v1="80"]');
  await expect(previousCard).toHaveCount(1);
  await expect(previousCard).not.toHaveAttribute('data-query-summary-v157','');
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
  const selectedIds=new Set(ids),release=state.holdPoints(batch=>batch.some(id=>selectedIds.has(id))),before=state.points.length;
  try{
    await page.getByRole('button',{name:'검사 클러스터 선택',exact:true}).click();
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id',ids[0]);
    const shown=await page.locator('#list .item').evaluateAll(cards=>cards.map(card=>card.dataset.propertyId));
    expect(shown).toEqual(ids.slice(0,firstCount));
    expect(state.points.slice(before).find(batch=>batch.includes(ids[0]))).toEqual(ids.slice(0,firstCount));
    expect(await page.evaluate(()=>listRenderStart)).toBe(0);
    expect(await page.evaluate(()=>visibleListItems.slice(0,innerWidth<=768?4:6).every(item=>item.queryRowV152))).toBe(true);
    expect(await page.locator('#list .item[data-query-summary-v157]').count()).toBe(firstCount);
    expect(await page.evaluate(ids=>allItems.some(item=>ids.includes(item.propertyId)),ids)).toBe(false);
    await expect.poll(()=>page.locator('#list .item img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    const thumb=await page.locator('#list .item img').first().getAttribute('src');
    await page.locator('#list .item img').first().evaluate(img=>{window.__instantThumbnailV157=img;});
    const phone=await page.evaluate(()=>isPhoneListingV2());
    if(phone)await page.locator('#list .item').first().click();
    else await page.locator('#list .item').first().getByRole('button',{name:'임대조건 수정',exact:true}).click();
    await expect(page.locator('#propertyEditModalV630.open')).toHaveCount(0);
    release();
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(0);
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id',ids[0]);
    await expect(page.locator('#list .item img').first()).toHaveAttribute('src',thumb);
    expect(await page.locator('#list .item img').first().evaluate(img=>img===window.__instantThumbnailV157)).toBe(true);
    if(phone){
      await expect(page.locator('#unifiedDetailDrawerV8.open')).toBeVisible();
      await expect(page.locator('#unifiedDetailDrawerV8')).toContainText(ids[0]);
    }else{
      await expect(page.locator('#propertyEditModalV630.open')).toBeVisible();
      await expect(page.locator('#peRentV630')).toHaveValue('90');
      await page.locator('#propertyEditModalV630').getByRole('button',{name:'취소',exact:true}).click();
    }
    expect(state.full).toEqual([]);
  }finally{release();}
});

test('restored older query caches switch clusters immediately after zoom and pan while previous point reads and the new query are delayed',async({page,context})=>{
  const settings={legacyPacket:true},state=await setup(page,context,settings);
  for(let n=0;n<120;n++){
    const id='OLD-CACHE-'+String(n).padStart(3,'0'),item={...structuredClone(state.masters[0]),propertyId:id,name:id};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);
  }
  await state.load();await state.reload();settings.legacyPacket=false;
  const releaseQuery=state.hold(),releasePoints=state.holdPoints(batch=>batch.some(id=>id.startsWith('OLD-CACHE-')&&Number(id.slice(10))>=40));
  try{
    await page.evaluate(()=>{window.__delayedReloadV158=loadSheet(false,false);});
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','checking');
    await page.evaluate(()=>{
      window.__zoomLevelV158=6;map.getLevel=()=>__zoomLevelV158;map.getCenter=()=>new kakao.maps.LatLng(36.35+__zoomLevelV158/1000,127.38);
      window.drawMapClustersOnlyV639=items=>{
        const rows=items.filter(item=>item.propertyId.startsWith('OLD-CACHE-'));
        overlays=[40,60,80].map(start=>({__cluster:{key:'rapid-'+start,items:rows.slice(start,start+12),latlng:new kakao.maps.LatLng(36.35,127.38)},setContent(){},setZIndex(){}}));
      };
    });
    for(const [level,start] of [[6,40],[5,60],[4,80],[6,40]]){
      await page.evaluate(level=>{__zoomLevelV158=level;clearPinnedClusterSelectionV6515(false);selectedGroupKey=null;jsLastIdleViewportKeyV638='';scheduleMapIdleRefreshV638();},level);
      await expect.poll(()=>page.evaluate(()=>jsMapIdleTimerV638)).toBeNull();
      const frame=await page.evaluate(start=>{
        const expected=overlays.find(o=>o.__cluster.key==='rapid-'+start).__cluster.items.slice(0,getListRenderChunkSize()).map(item=>item.propertyId);
        openCluster('rapid-'+start);
        return {expected,shown:Array.from(document.querySelectorAll('#list .item')).slice(0,expected.length).map(card=>card.dataset.propertyId)};
      },start);
      expect(frame.shown,'The selected list must change before ANY held source/master response arrives').toEqual(frame.expected);
      await expect(page.locator('html')).toHaveAttribute('data-cluster-list-paint-pending-v158','false');
      expect(Number(await page.locator('html').getAttribute('data-cluster-list-paint-ms-v158'))).toBeLessThan(250);
      await expect(page.locator('html')).toHaveAttribute('data-cluster-photos-pending-v159','false');
      expect(Number(await page.locator('html').getAttribute('data-cluster-photo-count-v159'))).toBeGreaterThan(0);
      expect(Number(await page.locator('html').getAttribute('data-cluster-photos-ready-ms-v159'))).toBeLessThan(500);
      const actualPhotos=await page.locator('#list .item').evaluateAll(cards=>cards.map(card=>({id:card.dataset.propertyId,
        src:card.querySelector('img')?.getAttribute('src'),ready:!!card.querySelector('img')?.naturalWidth})));
      for(const photo of actualPhotos){expect(photo.ready).toBe(true);expect(photo.src).toContain('photo-'+photo.id+'-1.svg');}
    }
    expect(await page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
    expect(await page.evaluate(()=>allItems.some(item=>/^OLD-CACHE-0[4-9]/.test(item.propertyId)))).toBe(false);
    expect(await page.locator('#list .item[data-query-summary-v157]').count()).toBeGreaterThan(0);
    expect(state.mediaReads.length,'Old caches receive photo URLs without unblocking any full master reads').toBeGreaterThan(0);
    expect(await page.locator('#list .item').first().innerText()).not.toContain('사진 없음');
    const selected=await page.locator('#list .item').first().getAttribute('data-property-id');
    const phone=await page.evaluate(()=>isPhoneListingV2());
    if(phone)await page.locator('#list .item').first().click();
    else await page.locator('#list .item').first().getByRole('button',{name:'임대조건 수정',exact:true}).click();
    await expect(page.locator('#propertyEditModalV630.open,#unifiedDetailDrawerV8.open')).toHaveCount(0);
    releasePoints();
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(0);
    await expect.poll(()=>page.locator('#list .item img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id',selected);
    await expect(page.locator(phone?'#unifiedDetailDrawerV8.open':'#propertyEditModalV630.open')).toBeVisible();
    if(!phone)await expect(page.locator('#peRentV630')).toHaveValue('90');
    expect(state.full).toEqual([]);
  }finally{releasePoints();releaseQuery();}
});

for(const ready of [false,true])test('cluster adopts the '+(ready?'decoded':'in-flight')+' prepared exact thumbnail through full master hydration',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<24;n++){
    const id='PHOTO-WARM-'+n,item={...structuredClone(state.masters[0]),propertyId:id,name:id};state.masters.push(item);
    state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);
  }
  await state.load();const releasePoints=state.holdPoints(ids=>ids.includes('PHOTO-WARM-20'));
  const releasePhotos=state.holdPhotos(path=>path.includes('PHOTO-WARM-20'));
  try{
    await page.evaluate(()=>{
      const rows=JSQueryListingsV152.navigationItems().filter(item=>item.propertyId==='PHOTO-WARM-20');
      window.__warmClusterV159={key:'photo-warm',items:rows,latlng:new kakao.maps.LatLng(36.35,127.38)};
      overlays=[{__cluster:__warmClusterV159,setContent(){},setZIndex(){}}];
      const RealImage=window.Image;window.__warmImageV159=null;
      window.Image=function(){const image=new RealImage();window.__warmImageV159=image;return image;};
      JSQueryListingsV152.warmClustersV159([__warmClusterV159]);
    });
    await expect.poll(()=>state.photoReads.filter(path=>path.includes('PHOTO-WARM-20-1.svg')).length).toBe(1);
    await page.evaluate(()=>{window.__preparedNodeV159=__warmImageV159;});
    if(ready){releasePhotos();await expect.poll(()=>page.evaluate(()=>__preparedNodeV159?.dataset.thumbnailDecodedV159)).toBe('true');}
    await page.evaluate(()=>openCluster('photo-warm'));
    await expect(page.locator('#list .item')).toHaveCount(1);
    const image=page.locator('#list .item img');expect(await image.evaluate(img=>({same:img===__preparedNodeV159,old:__preparedNodeV159?.outerHTML,current:img.outerHTML}))).toMatchObject({same:true});
    if(!ready)expect(await image.evaluate(img=>img.complete)).toBe(false);
    releasePoints();await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(0);
    expect(await image.evaluate(img=>img===__preparedNodeV159),'Hydration must preserve a pending download, not replace its image node').toBe(true);
    releasePhotos();await expect(page.locator('html')).toHaveAttribute('data-cluster-photos-pending-v159','false');
    await expect(image).toHaveAttribute('src',/PHOTO-WARM-20-1.svg/);expect(await image.evaluate(img=>img.naturalWidth)).toBe(960);
    expect(state.photoReads.filter(path=>path.includes('PHOTO-WARM-20-1.svg'))).toHaveLength(1);
    if(ready)expect(Number(await page.locator('html').getAttribute('data-cluster-photos-ready-ms-v159'))).toBeLessThan(500);
  }finally{releasePhotos();releasePoints();}
});

test('authenticated early query warmup is consumed once and does not start the legacy catalog downloads',async({page,context})=>{
  const state=await setup(page,context,{early:true});
  await expect.poll(()=>state.requests.length).toBe(1);
  expect(await page.evaluate(()=>Object.isFrozen(JSInitialListingsCacheV1))).toBe(true);
  expect(state.pageErrors).toEqual([]);expect(await state.load()).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(2);expect(state.requests).toHaveLength(1);expect(state.full).toEqual([]);
});

test('an administrative click uses the complete selected neighborhood on its first frame and retains an early action through passive hydration',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<24;n++){
    const id='ADMIN-SCOPE-'+n,item={...structuredClone(state.masters[0]),propertyId:id,name:id,address:(n<4?'대전 서구 갈마동 ':'대전 유성구 관평동 ')+(n+1)};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);
  }
  const release=state.holdPoints(batch=>batch.some(id=>id.startsWith('ADMIN-SCOPE-')&&Number(id.slice(12))>=4));
  try{
    await state.load();
    const result=await page.evaluate(()=>{
      // The map's viewport contains only the older tail. An administrative
      // selection intentionally includes the whole neighborhood immediately.
      const all=JSQueryListingsV152.navigationItems().filter(item=>item.address.includes('관평동'));
      const cluster={key:'admin-full-scope',items:all.slice(10),regionMode:'neighborhood',regionLabel:'관평동',districtLabel:'유성구',latlng:new kakao.maps.LatLng(36.35,127.38)};
      overlays=[{__cluster:cluster,setContent(){},setZIndex(){}}];openAdministrativeClusterV655(cluster.key);
      return {wanted:all.map(item=>item.propertyId),actual:visibleListItems.map(item=>item.propertyId),first:document.querySelector('#list .item')?.dataset.propertyId};
    });
    expect(result.actual).toEqual(result.wanted);expect(result.first).toBe(result.wanted[0]);
    const phone=await page.evaluate(()=>isPhoneListingV2());
    if(phone)await page.locator('#list .item').first().click();
    else await page.locator('#list .item').first().getByRole('button',{name:'임대조건 수정',exact:true}).click();
    release();
    await expect(page.locator(phone?'#unifiedDetailDrawerV8.open':'#propertyEditModalV630.open')).toBeVisible();
    expect(await page.evaluate(()=>visibleListItems.map(item=>item.propertyId))).toEqual(result.wanted);
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id',result.first);
  }finally{release();}
});

test('an early summary action cannot open or edit an old cluster after another cluster is selected',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<24;n++){
    const id='SUMMARY-'+n,item={...structuredClone(state.masters[0]),propertyId:id,name:id,address:'대전 유성구 관평동 '+(n+1)};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);
  }
  const release=state.holdPoints(batch=>batch.some(id=>id.startsWith('SUMMARY-')&&Number(id.slice(8))>=4));
  try{
    await state.load();
    await page.evaluate(()=>{
      window.__switchSummaryV157=JSQueryListingsV152.navigationItems().filter(item=>item.propertyId.startsWith('SUMMARY-')).slice(4,20);
      overlays=[0,8].map(start=>({__cluster:{key:'switch-'+start,items:__switchSummaryV157.slice(start,start+8),latlng:new kakao.maps.LatLng(36.35,127.38)},setContent(){},setZIndex(){}}));
      openCluster('switch-0');
    });
    const first=await page.locator('#list .item').first().getAttribute('data-property-id');
    expect(await page.locator('#list .item').first().getAttribute('data-query-summary-v157')).not.toBeNull();
    const phone=await page.evaluate(()=>isPhoneListingV2());
    if(phone)await page.locator('#list .item').first().click();
    else await page.locator('#list .item').first().getByRole('button',{name:'임대조건 수정',exact:true}).click();
    await page.evaluate(()=>openCluster('switch-8'));
    const next=await page.locator('#list .item').first().getAttribute('data-property-id');
    expect(next).not.toBe(first);release();
    await expect(page.locator('#list .item[data-query-summary-v157]')).toHaveCount(0);
    await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id',next);
    await expect(page.locator('#propertyEditModalV630.open,#unifiedDetailDrawerV8.open')).toHaveCount(0);
    expect(state.full).toEqual([]);
  }finally{release();}
});

test('an exact account/build/default-viewport cache paints real photos before controls unlock without a redundant recent-list control',async({page,context})=>{
  const state=await setup(page,context,{early:true});
  await page.evaluate(()=>{map.getCenter=()=>new kakao.maps.LatLng(36.3504,127.3845);map.getLevel=()=>7;});
  await state.load();await state.reload();
  await page.evaluate(()=>{document.documentElement.classList.add('auth-pending');document.getElementById('wrap').inert=true;});
  await expect(page.locator('#list .item')).toHaveCount(0);
  expect(await page.evaluate(()=>JSQueryListingsV152.paintCachedPreview(()=>true))).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(2);
  await expect(page.locator('#mapListTitleV1')).toHaveText('매물 목록');
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
  const results=await page.evaluate(async()=>{
    const database=await new Promise(resolve=>{const open=indexedDB.open('js-query-scopes-v152',1);open.onsuccess=()=>resolve(open.result);});
    const value=await new Promise(resolve=>{const read=database.transaction('views').objectStore('views').get(JSAuthenticatedAccountEmail+'|lease');read.onsuccess=()=>resolve(read.result);});
    database.close();
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

test('v229 prepared markets paint exact lists and decoded photos without rereading a blocked disk cache',async({page,context})=>{
  const state=await setup(page,context);
  for(const mode of ['lease','building_sale','land_sale']){
    state.setRevision('v229-'+mode);
    await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();
  }
  const release=state.hold();
  await page.evaluate(()=>{
    window.v229GetBefore=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(){return {};};
  });
  try{
    for(const [mode,expected] of [['lease',['FIXTURE-LEASE-1','FIXTURE-LEASE-2']],['building_sale',['FIXTURE-BUILDING']],['land_sale',['FIXTURE-LAND']]]){
      const result=await page.evaluate(async({mode,expected})=>{
        const start=performance.now();JSListingTradeV1.setMode(mode);
        while(performance.now()-start<250){
          const ids=Array.from(document.querySelectorAll('#list .item')).map(card=>card.dataset.propertyId);
          if(JSON.stringify(ids.slice().sort())===JSON.stringify(expected.slice().sort()))break;
          await new Promise(requestAnimationFrame);
        }
        const ids=Array.from(document.querySelectorAll('#list .item')).map(card=>card.dataset.propertyId),paint=performance.now()-start;
        const images=Array.from(document.querySelectorAll('#list img[src]'));
        await Promise.all(images.map(img=>img.decode()));
        return {ids,paint,photo:performance.now()-start,decoded:images.length>0&&images.every(img=>img.complete&&img.naturalWidth>0),fresh:document.documentElement.dataset.queryFreshV152};
      },{mode,expected});
      expect(result.ids.slice().sort()).toEqual(expected.slice().sort());
      expect(result.paint).toBeLessThanOrEqual(250);expect(result.photo).toBeLessThanOrEqual(500);
      expect(result.decoded).toBe(true);expect(result.fresh).toBe('checking');
    }
    expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{
    await page.evaluate(()=>{IDBObjectStore.prototype.get=window.v229GetBefore;delete window.v229GetBefore;});release();
  }
});

for(const mode of ['lease','building_sale','land_sale'])test('v216 '+mode+' navigation and first frame persist before optional points, apart from the full filter catalog',async({page,context})=>{
  const state=await setup(page,context,{deltaQueries:true});
  const releasePoints=state.holdPoints(()=>true);
  if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
  const loading=state.load(),count=mode==='lease'?2:1;
  try{
    await expect(page.locator('#list .item')).toHaveCount(count);
    await expect.poll(()=>page.evaluate(async mode=>{
      const database=await new Promise(resolve=>{const read=indexedDB.open('js-query-scopes-v152',1);read.onsuccess=()=>resolve(read.result);});
      const key=JSAuthenticatedAccountEmail+'|'+mode,read=name=>new Promise(resolve=>{const req=database.transaction('views').objectStore('views').get(name);req.onsuccess=()=>resolve(req.result);});
      const [core,catalog,frame]=await Promise.all([read(key),read(key+'|numeric-v216'),read(key+'|first-frame-v216')]);database.close();
      return {core:!!core&&!core.packet.numericCatalogV177&&core.packet.numericStoredV216===true,optionalPoints:core?.points.length,
        catalog:catalog?.revision===core?.packet.revision&&catalog?.catalog.marketV215===mode,
        frame:frame?.firstFrameV216===true&&frame.packet.total===frame.preview.ids.length&&!frame.packet.numericCatalogV177,
        privateFields:JSON.stringify(frame?.points||[]).includes('memo')};
    },mode)).toEqual({core:true,optionalPoints:0,catalog:true,frame:true,privateFields:false});
  }finally{releasePoints();await loading;}
  await state.reload();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
  await state.load();await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
  expect(state.transfers).toContain('unchanged');expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
});

for(const mode of ['lease','building_sale','land_sale'])test('v217 cold '+mode+' paints the complete navigation and actual photos while the heavy catalog is held',async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true}),release=state.holdCatalog();
  if(mode==='building_sale'){
    state.masters.find(item=>item.propertyId==='FIXTURE-BUILDING').address='서구 괴정동 56-29';
    state.ads.get('FIXTURE-BUILDING').forEach(ad=>ad.address='서구 괴정동 56-29');
  }
  const started=Date.now();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
  const loading=state.load();
  try{
    await expect(page.locator('#list .item')).toHaveCount(mode==='lease'?2:1,{timeout:1000});
    await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.some(img=>img.complete&&img.naturalWidth>0)),{timeout:1000}).toBe(true);
    expect(Date.now()-started).toBeLessThanOrEqual(1000);
    expect(await page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','preparing');
    expect(state.transfers).toContain('navigation');expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{release();await loading;}
  await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
  if(mode==='building_sale'){
    const before=state.requests.length,releaseQuery=state.hold();
    try{
      // Exact parcel navigation must also work when the optional advertisement
      // predicate cannot evaluate a filter and hands it back to the base index.
      await page.evaluate(()=>{JSQueryNumericV177.filter=()=>null;});
      for(const [keyword,expected] of [['987-654',[]],['56-29',['FIXTURE-BUILDING']]]){
        const frame=await page.evaluate(async keyword=>{const start=performance.now();document.getElementById('keyword').value=keyword;applyFilter();await new Promise(requestAnimationFrame);return{ms:performance.now()-start,ids:Array.from(document.querySelectorAll('#list .item')).map(el=>el.dataset.propertyId)};},keyword);
        expect(frame.ms).toBeLessThan(250);expect(frame.ids).toEqual(expected);expect(state.requests.length).toBe(before);
      }
    }finally{releaseQuery();}
  }
  await state.reload();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();
  await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
});

for(const mode of ['lease','building_sale','land_sale'])test('v228 saved navigation stays complete and responsive when its revision has expired and optional catalog transfer is blocked '+mode,async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true});
  if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
  await state.load();await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
  await expect.poll(()=>page.evaluate(async mode=>{const d=await new Promise(resolve=>{const r=indexedDB.open('js-query-scopes-v152',1);r.onsuccess=()=>resolve(r.result);});
    const value=await new Promise(resolve=>{const r=d.transaction('views').objectStore('views').get(JSAuthenticatedAccountEmail+'|'+mode);r.onsuccess=()=>resolve(r.result);});d.close();return!!value;},mode)).toBe(true);
  await state.reload();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
  state.setRevision('new-unknown-history-v228');const queries=[];page.on('request',request=>{const u=new URL(request.url());if(u.searchParams.get('action')==='listingQuery')queries.push({since:u.searchParams.get('since'),nav:u.searchParams.get('navigation')});});
  const release=state.holdCatalog(),started=Date.now(),loading=state.load();
  try{
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','verified',{timeout:1000});
    await expect(page.locator('#list .item')).toHaveCount(mode==='lease'?2:1);
    await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.some(image=>image.complete&&image.naturalWidth>0)),{timeout:500}).toBe(true);
    expect(Date.now()-started).toBeLessThanOrEqual(1000);expect(queries.some(query=>query.since==='query-initial'&&query.nav==='228')).toBe(true);
    expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{release();await loading;}
});

for(const [before,after] of [['lease','building_sale'],['building_sale','land_sale'],['land_sale','lease']])test('v228 changing markets aborts the previous large optional download but preserves the new complete list and photo '+before,async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true}),cancelled=[],started=[];
  page.on('request',request=>{const u=new URL(request.url());if(u.searchParams.get('action')==='listingQuery'&&!u.searchParams.has('navigation'))started.push(JSON.parse(u.searchParams.get('spec')).mode);});
  page.on('requestfailed',request=>{const u=new URL(request.url());if(u.searchParams.get('action')==='listingQuery')cancelled.push(JSON.parse(u.searchParams.get('spec')).mode);});
  const release=state.holdCatalog();if(before!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),before);
  try{
    await state.load();await expect.poll(()=>started.includes(before)).toBe(true);
    const start=Date.now();await page.evaluate(mode=>JSListingTradeV1.setMode(mode),after);await state.load();
    await expect(page.locator('#list .item')).toHaveCount(after==='lease'?2:1,{timeout:1000});
    await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.some(image=>image.complete&&image.naturalWidth>0)),{timeout:500}).toBe(true);
    expect(Date.now()-start).toBeLessThanOrEqual(1000);await expect.poll(()=>cancelled.includes(before)).toBe(true);expect(cancelled).not.toContain(after);
    expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{release();}
  await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
});

test('v228 leaving an unfinished foreground navigation aborts its body instead of competing with the new market',async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true});let release,oldStarted=false,cancelled=false;
  const gate=new Promise(resolve=>{release=resolve;});
  page.on('requestfailed',request=>{const u=new URL(request.url());if(u.searchParams.get('action')==='listingQuery'&&JSON.parse(u.searchParams.get('spec')).mode==='lease')cancelled=true;});
  await page.route('**/api/data**',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')==='listingQuery'&&JSON.parse(u.searchParams.get('spec')).mode==='lease'){oldStarted=true;await gate;}return route.fallback();});
  const old=state.load();try{
    await expect.poll(()=>oldStarted).toBe(true);await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
    await expect(page.locator('#list .item')).toHaveCount(1);await expect.poll(()=>cancelled).toBe(true);
    expect(await page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);expect(state.mutations).toEqual([]);
  }finally{release();await old;}
});
test('v220 cards and filters keep prepared originals read-only until an exact-master editor opens',async({page,context,isMobile})=>{
  if(isMobile)await page.setViewportSize({width:930,height:530});
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true});
  state.afterNextQuery(()=>{const item=state.masters[0];item.rent=80;item.sourceSnapshotKey=hash(3);state.ads.get(item.propertyId).forEach(ad=>{ad.manualDisplayFields='monthly_rent';});});
  await state.load();await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
  if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
  expect(state.points.flat().every(id=>['FIXTURE-LEASE-1','FIXTURE-LEASE-2'].includes(id))).toBe(true);expect(await page.evaluate(()=>allItems.length)).toBe(0);
  const release=state.hold();
  try{
    await page.evaluate(()=>{document.getElementById('minRent').value='140';applyFilter();});
    await expect(page.locator('#list .item')).toHaveCount(1);
    await page.evaluate(()=>{document.getElementById('minRent').value='';applyFilter();});
    const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');await expect(card).toBeVisible();
    await expect.poll(()=>card.locator('img').first().evaluate(i=>i.complete&&i.naturalWidth>0),{timeout:500}).toBe(true);
    expect(state.points.flat().every(id=>['FIXTURE-LEASE-1','FIXTURE-LEASE-2'].includes(id))).toBe(true);
    await card.getByRole('button',{name:'임대조건 수정',exact:true}).click();
    await expect(page.locator('#propertyEditModalV630')).toHaveClass(/open/);
    await expect(page.locator('#peRentV630')).toHaveValue('80');
    expect(state.points.flat()).toContain('FIXTURE-LEASE-1');expect(state.masters[1].rent).toBe(150);expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
    await page.locator('#propertyEditModalV630').getByRole('button',{name:'취소',exact:true}).click();
  }finally{release();}
});

for(const mode of ['lease','building_sale','land_sale'])test('v220 '+mode+' retains a catalog completed after filter selection and paints successive filters without server waits',async({page,context,isMobile})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true}),catalog=state.holdCatalog(),points=state.holdPoints(()=>true);
  if(mode!=='lease')await page.evaluate(m=>JSListingTradeV1.setMode(m),mode);
  const initial=state.load();let release;
  try{
    await expect.poll(()=>state.requests.length).toBeGreaterThanOrEqual(2);
    if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
    release=state.hold();
    await page.evaluate(m=>{document.getElementById(m==='lease'?'minRent':'minDeposit').value=m==='lease'?'140':m==='building_sale'?'50001':'30001';applyFilter();},mode);
    await expect.poll(()=>state.requests.length).toBeGreaterThanOrEqual(3);
    // Deliberately wait before readiness: diagnostics must include the whole
    // user's wait, rather than restart the timer on local resumption.
    await page.waitForTimeout(300);
    catalog();
    await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
    const expected=mode==='lease'?['FIXTURE-LEASE-2']:[];
    await expect.poll(()=>page.locator('#list .item').evaluateAll(nodes=>nodes.map(n=>n.dataset.propertyId))).toEqual(expected);
    await expect.poll(async()=>Number(await page.locator('html').getAttribute('data-query-filter-list-ms-v220'))).toBeGreaterThanOrEqual(300);
    await expect.poll(()=>page.evaluate(async mode=>{
      const database=await new Promise(resolve=>{const r=indexedDB.open('js-query-scopes-v152',1);r.onsuccess=()=>resolve(r.result);});
      const saved=await new Promise(resolve=>{const r=database.transaction('views').objectStore('views').get(JSAuthenticatedAccountEmail+'|'+mode+'|numeric-v216');r.onsuccess=()=>resolve(r.result);});database.close();
      return saved?.catalog?.marketV215===mode;
    },mode)).toBe(true);
    const before=state.requests.length;
    for(const enabled of [false,true,false]){
      const frame=await page.evaluate(async({mode,enabled})=>{const start=performance.now();document.getElementById(mode==='lease'?'minRent':'minDeposit').value=enabled?(mode==='lease'?'140':mode==='building_sale'?'50001':'30001'):'';applyFilter();await new Promise(requestAnimationFrame);
        return{ms:performance.now()-start,ids:[...document.querySelectorAll('#list .item')].map(n=>n.dataset.propertyId),map:jsLastRenderedItemsV639.map(n=>n.propertyId)};},{mode,enabled});
      const ids=enabled?expected:mode==='lease'?['FIXTURE-LEASE-1','FIXTURE-LEASE-2']:[mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND'];
      expect(frame.ms).toBeLessThan(250);expect(frame.ids.sort()).toEqual(ids.slice().sort());expect(frame.map.sort()).toEqual(ids.slice().sort());
      if(ids.length)await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),{timeout:500}).toBe(true);
      if(ids.length){await expect(page.locator('html')).toHaveAttribute('data-query-filter-paint-v220','decoded');
        expect(Number(await page.locator('html').getAttribute('data-query-filter-list-ms-v220'))).toBeLessThan(250);
        expect(Number(await page.locator('html').getAttribute('data-query-filter-photos-ms-v220'))).toBeLessThan(500);}
    }
    expect(state.requests.length).toBe(before);expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{catalog();release?.();points();await initial;}
});

for(const mode of ['lease','building_sale','land_sale'])test('v220 '+mode+' prepares its complete basis after a filtered first response instead of staying on remote queries',async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true});
  await page.evaluate(mode=>{JSListingTradeV1.setMode(mode);document.getElementById(mode==='lease'?'minRent':'minDeposit').value=mode==='lease'?'140':mode==='building_sale'?'40000':'20000';},mode);
  await state.load();await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
  const before=state.requests.length,release=state.hold();
  try{
    const frame=await page.evaluate(async mode=>{const start=performance.now();document.getElementById(mode==='lease'?'minRent':'minDeposit').value='';applyFilter();await new Promise(requestAnimationFrame);return{ms:performance.now()-start,ids:[...document.querySelectorAll('#list .item')].map(n=>n.dataset.propertyId)};},mode);
    expect(frame.ms).toBeLessThan(250);expect(frame.ids.length).toBe(mode==='lease'?2:1);expect(state.requests.length).toBe(before);
    await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),{timeout:500}).toBe(true);
    expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{release();}
});

for(const change of ['account','save','market'])test('v220 a late prepared catalog cannot cross the '+change+' boundary',async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true}),release=state.holdCatalog(),loading=state.load();let query;
  try{
    await expect.poll(()=>state.requests.length).toBeGreaterThanOrEqual(2);query=state.hold();
    await page.evaluate(change=>{
      if(change==='account')window.JSAuthenticatedAccountEmail='other@example.invalid';
      else if(change==='save')localStorage.setItem('js-query-epoch-v152:'+JSAuthenticatedAccountEmail,'v220-saved-new-fence');
      else JSListingTradeV1.setMode('building_sale');
    },change);
    release();await loading;
    expect(await page.locator('html').getAttribute('data-query-numeric-state-v177')).not.toBe('ready');
    expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
  }finally{release();query?.();await loading;}
});

for(const mode of ['lease','building_sale','land_sale'])test('v217 '+mode+' stores a completed deferred filter catalog while optional points still wait',async({page,context})=>{
  const state=await setup(page,context,{navigationFirst:true,numericCatalog:true,deltaQueries:true}),release=state.holdPoints(()=>true);
  if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
  const loading=state.load();
  try{
    await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
    await expect.poll(()=>page.evaluate(async mode=>{
      const database=await new Promise(resolve=>{const req=indexedDB.open('js-query-scopes-v152',1);req.onsuccess=()=>resolve(req.result);});
      const key=JSAuthenticatedAccountEmail+'|'+mode,read=name=>new Promise(resolve=>{const req=database.transaction('views').objectStore('views').get(name);req.onsuccess=()=>resolve(req.result);});
      const [core,catalog]=await Promise.all([read(key),read(key+'|numeric-v216')]);database.close();
      return !!core?.packet.numericStoredV216&&catalog?.revision===core.packet.revision&&catalog?.catalog.marketV215===mode&&core.points.length===0;
    },mode)).toBe(true);
  }finally{release();await loading;}
  await state.reload();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();
  expect(state.transfers).toContain('unchanged');expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
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
    await expect(page.locator('#queryFreshnessV152')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'최근 확인 목록',exact:true})).toHaveCount(0);
    expect(state.full).toEqual([]);state.fail(true);release();
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','unverified');
    await expect(page.locator('#queryFreshnessV152')).toHaveText('최신 확인 지연');
    expect(await page.locator('#queryFreshnessV152').evaluate(node=>node.tagName)).toBe('SPAN');
    await expect(page.locator('#list .item')).toHaveCount(2);
    state.fail(false);await state.load();
    await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','verified');
    await expect(page.locator('#queryFreshnessV152')).toHaveCount(0);
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

test('a distant virtual list window displays exact projected cards before its bounded masters arrive',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<250;n++){const id='VIRTUAL-'+String(n).padStart(3,'0'),item={...structuredClone(state.masters[0]),propertyId:id,name:id};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);}
  await state.load();expect(await page.evaluate(()=>allItems.length)).toBeLessThan(150);
  const release=state.holdPoints(batch=>batch.some(id=>id.startsWith('VIRTUAL-')));
  try{
    const frame=await page.evaluate(()=>{
      const wanted=visibleListItems.slice(200,228).map(item=>item.propertyId);renderListWindowV2(200,228);
      return {wanted,rendered:Array.from(document.querySelectorAll('#list .item'),card=>card.dataset.propertyId),start:listRenderStart};
    });
    expect(frame.start).toBe(200);expect(frame.rendered).toEqual(frame.wanted);
    expect(await page.evaluate(ids=>allItems.some(item=>ids.includes(item.propertyId)),frame.wanted)).toBe(false);
    release();
    await expect.poll(()=>page.evaluate(ids=>ids.every(id=>allItems.some(item=>item.propertyId===id&&!item.queryRowV152)),frame.wanted)).toBe(true);
    expect(state.full).toEqual([]);expect(await page.evaluate(()=>allItems.length)).toBeLessThan(200);
  }finally{release();}
});

test('favorite lookups coalesce exact missing masters and bulk actions expose only hydrated writable models',async({page,context})=>{
  const state=await setup(page,context);
  for(let n=0;n<100;n++){const id='FAVORITE-'+String(n).padStart(3,'0'),item={...structuredClone(state.masters[0]),propertyId:id,name:id};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id}]);}
  await state.load();
  const ids=await page.evaluate(()=>{const ids=visibleListItems.slice(90,95).map(item=>item.propertyId);
    ids.forEach(id=>JSQueryListingsV152.lookup('property:'+id));return ids;});
  await expect.poll(()=>page.evaluate(ids=>ids.every(id=>allItems.some(item=>item.propertyId===id&&!item.queryRowV152)),ids)).toBe(true);
  expect(state.points.some(batch=>ids.every(id=>batch.includes(id)))).toBe(true);
  await page.evaluate(()=>selectAllVisibleItems());
  expect(await page.evaluate(()=>selectedPrintKeys.length)).toBe(102);
  await page.evaluate(()=>{if(!JSQueryListingsV152.guardSelected(()=>{window.__bulkModelsV162=getSelectedPrintItems().length;}))window.__bulkModelsV162=getSelectedPrintItems().length;});
  await expect.poll(()=>page.evaluate(()=>window.__bulkModelsV162)).toBe(102);
  await expect.poll(()=>page.evaluate(()=>getSelectedPrintItems().length)).toBe(102);
  expect(await page.evaluate(()=>getSelectedPrintItems().every(item=>!item.queryRowV152&&item.memo==='브라우저 검사 전용 가상 자료'))).toBe(true);
  expect(state.full).toEqual([]);
});

test('floor menu orders actual projected floors including basements and unknowns without another listing query',async({page,context})=>{
  const state=await setup(page,context);
  for(const [id,room,floor,address] of [['SORT-B2','지하2층',-2,'대전 서구 괴정동 10'],['SORT-B1','B1',-1,'대전 서구 괴정동 11'],
    ['SORT-TEN','3층',10,'대전 서구 괴정동 12'],['SORT-UNKNOWN','',null,'대전 서구 괴정동 99']]){
    const item={...structuredClone(state.masters[0]),propertyId:id,name:id,room,floor,address};
    state.masters.push(item);state.ads.set(id,[{...structuredClone(state.ads.get('FIXTURE-LEASE-1')[0]),propertyId:id,originalId:'ad-'+id,room,floor}]);
  }
  await state.load();
  const phone=await page.evaluate(()=>isPhoneListingV2());
  if(phone)await page.getByRole('button',{name:/현재 범위 매물.*보기/}).click();
  const before=state.requests.length,ids=()=>page.evaluate(()=>visibleListItems.map(item=>item.propertyId)),menu=page.locator(phone?'#v6MobileMenuBody':'#sortDropdownMenu');
  await page.locator('#sortDropdownBtn').click();
  await menu.getByRole('option',{name:'층수 오름순',exact:true}).click();
  expect(await ids()).toEqual(['SORT-B2','SORT-B1','FIXTURE-LEASE-1','FIXTURE-LEASE-2','SORT-TEN','SORT-UNKNOWN']);
  await page.locator('#sortDropdownBtn').click();
  await menu.getByRole('option',{name:'층수 내림순',exact:true}).click();
  expect(await ids()).toEqual(['SORT-TEN','FIXTURE-LEASE-2','FIXTURE-LEASE-1','SORT-B1','SORT-B2','SORT-UNKNOWN']);
  await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id','SORT-TEN');
  await expect(page.locator('#sortDropdownMenu [data-sort-value="floorHigh"]')).toHaveAttribute('aria-selected','true');
  await page.locator('#sortDropdownBtn').click();
  await menu.getByRole('option',{name:'최근등록순',exact:true}).click();
  await expect(page.locator('#sortFilter')).toHaveValue('latest');
  expect(state.requests.length).toBe(before);expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
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

test('building query filters send every field and exclude out-of-range originals',async({page,context})=>{
  const state=await setup(page,context);await state.load();
  await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));
  await expect(page.locator('#list .item')).toHaveCount(1);
  for(const [min,max,count]of [['50000','120000',1],['50001','120000',0],['50,000','120,000',1],['','',1]]){
    await page.evaluate(([min,max])=>{document.getElementById('minDeposit').value=min;document.getElementById('maxDeposit').value=max;applyFilter();},[min,max]);
    await expect.poll(()=>page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
    await expect(page.locator('#list .item'),'Both price bounds must finish and display the exact matching cards').toHaveCount(count);
  }
  for(const [field,value] of [['minDeposit','60000'],['maxDeposit','40,000'],['saleLandMin','101'],['saleLandMax','99'],['saleGrossMin','201'],['saleGrossMax','199'],['saleYieldMin','6'],['saleYieldMax','5'],['saleCategoryFilter','house']]){
    await page.evaluate(([field,value])=>{document.getElementById(field).value=value;applyFilter();},[field,value]);
    await expect.poll(()=>page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
    await expect(page.locator('#list .item'),field).toHaveCount(0);
    await page.evaluate(field=>{document.getElementById(field).value='';applyFilter();},field);
    await expect.poll(()=>page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
    await expect(page.locator('#list .item')).toHaveCount(1);
  }
  expect(state.mutations).toEqual([]);
});


test('prepared building catalog paints the FIRST new range without any filter network or point-read wait',async({page,context})=>{
  page.on('console',message=>{if(message.type()==='warning')console.log('numeric warning',message.text());});
  const state=await setup(page,context,{numericCatalog:true});
  const ad=state.ads.get('FIXTURE-BUILDING')[0];state.ads.get('FIXTURE-BUILDING').push({...ad,originalId:'ALTERNATE-BUILDING',salePrice:100000,thumbnail:new URL('/__query/photo-alternate-2.svg',page.url()).href});
  await state.load();await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));
  await expect.poll(()=>page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
  await expect(page.locator('#list .item img').first()).toBeVisible();
  await expect.poll(()=>page.locator('#list .item img').first().evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  const before=state.requests.length,release=state.hold(),releasePoints=state.holdPoints(()=>true);
  try{
    for(const [min,max,count]of [['50001','120000',1],['100001','120000',0],['50,000','120,000',1],['','',1]]){
      const ms=await page.evaluate(async([min,max,count])=>{
        document.getElementById('minDeposit').value=min;document.getElementById('maxDeposit').value=max;
        const start=performance.now();applyFilter();
        while(!JSQueryListingsV152.hasCurrentData()||document.querySelectorAll('#list .item').length!==count){if(performance.now()-start>1000)throw Error('Filter did not paint '+JSON.stringify({state:document.documentElement.dataset,current:JSQueryListingsV152.hasCurrentData(),count:document.querySelectorAll('#list .item').length,types:typeof JSQueryNumericV177,filters:Array.from(document.querySelectorAll('#minDeposit,#maxDeposit')).map(e=>e.value)}));await new Promise(requestAnimationFrame);}
        return performance.now()-start;
      },[min,max,count]);
      expect(ms,'First and successive numeric ranges paint without remote query').toBeLessThan(250);
      if(count){const image=page.locator('#list .item img').first();await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0),{timeout:500}).toBe(true);
        expect(await image.getAttribute('src')).toContain(min==='50001'?'alternate-2.svg':'FIXTURE-BUILDING-1.svg');}
    }
    expect(state.requests.length).toBe(before);expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
  }finally{release();releasePoints();}
});

for(const mode of ['lease','building_sale','land_sale'])test('v215 '+mode+' filter Apply paints the first and successive conditions with decoded photos while query and point reads stall',async({page,context,isMobile},info)=>{
 const state=await setup(page,context,{numericCatalog:true,deltaQueries:true});
 if(mode==='lease'){
  state.ads.get('FIXTURE-LEASE-1').push({...state.ads.get('FIXTURE-LEASE-1')[0],originalId:'LEASE-SECOND-FLOOR',floor:2,room:'2층',rent:110,premium:300,area:30,thumbnail:new URL('/__query/photo-lease-alternate-2.svg',page.url()).href});
  state.ads.get('FIXTURE-LEASE-2')[0].floor=3;state.ads.get('FIXTURE-LEASE-2')[0].room='3층';
 }
 await page.evaluate(m=>JSListingTradeV1.setMode(m),mode);await state.load();
 const saved=state.masters.find(item=>mode==='lease'?item.propertyId==='FIXTURE-LEASE-1':mode==='building_sale'?item.propertyId==='FIXTURE-BUILDING':item.propertyId==='FIXTURE-LAND');
 saved.sourceSnapshotKey=hash(9);state.setRevision('v215-after-saved-change');await page.evaluate(()=>JSQueryListingsV152.poll());
 await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','v215-after-saved-change');
 expect(state.transfers.at(-1)).toBe('delta');
 await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
 if(isMobile)await page.locator('[data-mobile-view="list"]').click();
 const before=state.requests.length,release=state.hold(),releasePoints=state.holdPoints(()=>true);
 const trigger=page.locator(isMobile?'#jsMobileSearchFormV1 [data-mobile-action="filter"]':'#detailBtn');
 const steps=mode==='lease'?[
  [{minFloor:'1',maxFloor:'1'},['FIXTURE-LEASE-1'],'FIXTURE-LEASE-1-1.svg'],
  [{minFloor:'2',maxFloor:'2'},['FIXTURE-LEASE-1'],'lease-alternate-2.svg'],
  [{minFloor:'3',maxFloor:'3'},['FIXTURE-LEASE-2'],'FIXTURE-LEASE-2-1.svg'],
  [{minFloor:'',maxFloor:'',minRent:'140',maxRent:'160'},['FIXTURE-LEASE-2'],'FIXTURE-LEASE-2-1.svg'],
  [{minRent:'',maxRent:'',minDeposit:'2,000',maxDeposit:'2,000'},['FIXTURE-LEASE-1'],'FIXTURE-LEASE-1-1.svg'],
  [{minDeposit:'',maxDeposit:''},['FIXTURE-LEASE-1','FIXTURE-LEASE-2'],null]
 ]:mode==='building_sale'?[[{minDeposit:'50001'},[],null],[{minDeposit:'50,000',maxDeposit:'120,000'},['FIXTURE-BUILDING'],'FIXTURE-BUILDING-1.svg'],[{minDeposit:'',maxDeposit:''},['FIXTURE-BUILDING'],'FIXTURE-BUILDING-1.svg']]:[[{minDeposit:'30001'},[],null],[{minDeposit:'30,000',maxDeposit:'30,000'},['FIXTURE-LAND'],'FIXTURE-LAND-1.svg'],[{minDeposit:'',maxDeposit:''},['FIXTURE-LAND'],'FIXTURE-LAND-1.svg']];
 try{
  for(const [values,ids,photo]of steps){
   await trigger.click();
   for(const [id,value]of Object.entries(values))await page.locator(isMobile?'#v6DetailSheet_'+id:'#'+id).fill(value);
   const apply=page.locator(isMobile?'#v6DetailSheetPortal :is(.v6-detail-sheet-apply,.js-phone-filter-apply):visible':'#detailFilter .apply-btn');
   await apply.evaluate(node=>node.addEventListener('click',()=>{window.v215ApplyStarted=performance.now();},{once:true}));
   await apply.click();
   const ms=await page.evaluate(async ids=>{while(!JSQueryListingsV152.hasCurrentData()||JSON.stringify([...document.querySelectorAll('#list .item')].map(e=>e.dataset.propertyId).sort())!==JSON.stringify(ids.slice().sort())){if(performance.now()-v215ApplyStarted>1000)throw Error('Filter Apply did not paint');await new Promise(requestAnimationFrame);}return performance.now()-v215ApplyStarted;},ids);
   expect(ms,'Apply to correct actual list').toBeLessThan(250);
   if(photo){const image=page.locator('#list .item img').first();await expect.poll(()=>image.evaluate(i=>i.complete&&i.naturalWidth>0),{timeout:500}).toBe(true);expect(await image.getAttribute('src')).toContain(photo);}

  }
  await page.screenshot({path:info.outputPath('v215-'+mode+'-filters.png')});
  expect(state.requests.length).toBe(before);expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
 }finally{release();releasePoints();}
});


test('a verified building index survives refresh even when its first editable point read never finishes',async({page,context})=>{
  const state=await setup(page,context,{numericCatalog:true});
  await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));
  // Finish the baseline load before holding point reads for a different publication.
  await state.load();
  await expect.poll(()=>page.evaluate(()=>JSQueryListingsV152.hasCurrentData())).toBe(true);
  // Start a new publication whose points have never been hydrated.
  state.masters.forEach(item=>{item.sourceSnapshotKey=hash(8);});state.setRevision('new-packet-before-points');
  const releasePoints=state.holdPoints(()=>true);
  await page.evaluate(()=>{JSQueryListingsV152.poll();});
  await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','new-packet-before-points');
  await expect.poll(()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('js-query-scopes-v152',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return new Promise(resolve=>{const r=db.transaction('views','readonly').objectStore('views').get(JSAuthenticatedAccountEmail+'|building_sale');r.onsuccess=()=>resolve(r.result?.packet?.revision);r.onerror=()=>resolve(null);});})).toBe('new-packet-before-points');
  const releaseQuery=state.hold();
  try{await state.reload();await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');loadSheet(false,false);});
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','new-packet-before-points');
    expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
  }finally{releasePoints();releaseQuery();}
});

for(const mode of ['building_sale','land_sale'])test('v189 '+mode+' accepts only completed range packets and keeps rapid market changes exact',async({page,context,isMobile})=>{
  const state=await setup(page,context,{ranges:true});
  await page.evaluate(value=>JSListingTradeV1.setMode(value),mode);await state.load();
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const expected=mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND';
  await expect(page.locator('#list .item')).toHaveCount(1);await expect(page.locator('#list .item')).toHaveAttribute('data-property-id',expected);
  expect(state.rangeReads.some(r=>r.mode===mode&&r.kind==='manifest-v128')).toBe(true);expect(state.rangeReads.some(r=>r.mode===mode&&r.kind==='chunk-v128')).toBe(true);
  for(const market of ['lease',mode,'lease',mode]){await page.evaluate(value=>JSListingTradeV1.setMode(value),market);await state.load();}
  await expect(page.locator('#list .item')).toHaveCount(1);await expect(page.locator('#list .item')).toHaveAttribute('data-property-id',expected);
  const image=page.locator('#list .item .unified-thumb-v8 img');await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
});


test('v193 numeric-only building parcels switch complete lists on the first frame without another query or point wait',async({page,context})=>{
 const state=await setup(page,context,{numericCatalog:true});
 const original=state.masters.find(item=>item.propertyId==='FIXTURE-BUILDING');
 original.address='대전 서구 괴정동 56-29';state.ads.get(original.propertyId).forEach(a=>a.address=original.address);
 for(const [id,address,memo] of [['PARCEL-SECOND','대전 중구 선화동 56-29',''],['PARCEL-OTHER','대전 서구 괴정동 99-7',''],
   ['PARCEL-LEADING','대전 서구 괴정동 156-29',''],['PARCEL-TRAILING','대전 서구 괴정동 56-290',''],['PARCEL-MEMO','대전 서구 괴정동 2-3','다른 매물 56-29 참고']]){
  const item={...structuredClone(original),propertyId:id,key:id,address,memo};state.masters.push(item);
  state.ads.set(id,[{...structuredClone(state.ads.get(original.propertyId)[0]),propertyId:id,originalId:id+'-AD',address,memo}]);
 }
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
 const before=state.requests.length,release=state.hold(),releasePoints=state.holdPoints(()=>true);
 try{
  for(const [keyword,expected] of [['56-29',['FIXTURE-BUILDING','PARCEL-SECOND']],['괴정동 56-29',['FIXTURE-BUILDING']],
    ['56-29,99-7',['FIXTURE-BUILDING','PARCEL-SECOND','PARCEL-OTHER']],['987-654',[]],['56-29',['FIXTURE-BUILDING','PARCEL-SECOND']]]){
   const frame=await page.evaluate(async keyword=>{const started=performance.now();document.getElementById('keyword').value=keyword;applyFilter();await new Promise(requestAnimationFrame);
    return {elapsed:performance.now()-started,ids:[...document.querySelectorAll('#list .item')].map(e=>e.dataset.propertyId)};},keyword);
   expect(frame.elapsed).toBeLessThan(250);expect(frame.ids.slice().sort()).toEqual(expected.slice().sort());
   expect(state.requests.length).toBe(before);
   if(expected.length)await expect.poll(()=>page.locator('#list .item img').first().evaluate(e=>e.complete&&e.naturalWidth>0),{timeout:500}).toBe(true);
  }
  expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
 }finally{release();releasePoints();}
});


test('v193 pre-fix broad numeric parcel cache never flashes a different parcel during fresh verification',async({page,context})=>{
 const state=await setup(page,context,{numericCatalog:true}),original=state.masters.find(i=>i.propertyId==='FIXTURE-BUILDING');
 original.address='서구 괴정동 56-29';state.ads.get(original.propertyId).forEach(a=>a.address=original.address);
 const wrong={...structuredClone(original),propertyId:'OLD-PARCEL-WRONG',address:'서구 괴정동 156-29',memo:'56-29 참고'};
 state.masters.push(wrong);state.ads.set(wrong.propertyId,[{...structuredClone(state.ads.get(original.propertyId)[0]),propertyId:wrong.propertyId,originalId:wrong.propertyId+'-AD',address:wrong.address}]);
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 await page.evaluate(()=>{document.getElementById('keyword').value='56-29';return applyFilter();});
 await expect(page.locator('#list .item')).toHaveCount(1);
 await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('js-query-scopes-v152',1);req.onerror=reject;req.onsuccess=()=>{
  const db=req.result,tx=db.transaction('views','readwrite'),store=tx.objectStore('views'),account=JSAuthenticatedAccountEmail.toLowerCase();
  const base=store.get(account+'|building_sale'),old=store.get(account+'|building_sale|filtered');let n=0;
  function update(){if(++n!==2)return;const value=old.result;value.packet.rows=base.result.packet.rows;value.packet.total=value.packet.rows.length;value.points=[];delete value.parcelSearchV193;store.put(value,account+'|building_sale|filtered');}
  base.onsuccess=update;old.onsuccess=update;tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;
 }}));
 const release=state.hold();
 try{
  await state.reload();await page.evaluate(()=>{document.getElementById('keyword').value='56-29';JSListingTradeV1.setMode('building_sale');void loadSheet(false,false);});
  await page.waitForTimeout(650);await expect(page.locator('#list [data-property-id="OLD-PARCEL-WRONG"]')).toHaveCount(0);
  release();await expect(page.locator('#list .item')).toHaveCount(1);await expect(page.locator('#list .item')).toHaveAttribute('data-property-id','FIXTURE-BUILDING');
 }finally{release();}
});


test('v193 a newer exact-master price keeps parcel lookup immediate after numeric-catalog invalidation',async({page,context})=>{
 const state=await setup(page,context,{numericCatalog:true}),item=state.masters.find(i=>i.propertyId==='FIXTURE-BUILDING');
 item.address='서구 괴정동 56-29';state.ads.get(item.propertyId).forEach(a=>a.address=item.address);
 state.afterNextQuery(()=>{item.salePrice=71000;item.sourceSnapshotKey=hash(3);state.ads.get(item.propertyId).forEach(a=>a.manualDisplayFields='sale_price');});
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 // A complete display projection no longer reads editable originals merely
 // to paint a card. Request this exact master as an explicit detail action.
 await page.evaluate(()=>{JSQueryListingsV152.prepare(JSQueryListingsV152.navigationItems(),()=>{});});
 await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','per-property');
 await expect(page.locator('#list .item[data-property-id="FIXTURE-BUILDING"]')).toContainText('7억1,000');
 const before=state.requests.length,release=state.hold(),releasePoints=state.holdPoints(()=>true);
 try{
  for(const keyword of ['56-29','괴정동56-29','987-654','56-29']){
   const frame=await page.evaluate(async keyword=>{const started=performance.now();document.getElementById('keyword').value=keyword;applyFilter();await new Promise(requestAnimationFrame);
    return {elapsed:performance.now()-started,ids:[...document.querySelectorAll('#list .item')].map(e=>e.dataset.propertyId),text:document.getElementById('list').textContent};},keyword);
   expect(frame.elapsed).toBeLessThan(250);expect(frame.ids).toEqual(keyword==='987-654'?[]:['FIXTURE-BUILDING']);
   if(frame.ids.length)expect(frame.text).toContain('7억1,000');expect(state.requests.length).toBe(before);
  }
 }finally{release();releasePoints();}
});


test('v193 a parcel cache from a previous account cannot bypass a pending new-account query',async({page,context})=>{
 const state=await setup(page,context),item=state.masters.find(i=>i.propertyId==='FIXTURE-BUILDING');
 item.address='서구 괴정동 56-29';state.ads.get(item.propertyId).forEach(a=>a.address=item.address);
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 const before=state.requests.length,release=state.hold();
 try{
  const frame=await page.evaluate(async()=>{window.savedAccountV193=JSAuthenticatedAccountEmail;JSAuthenticatedAccountEmail='another-parcel@example.invalid';
   document.getElementById('keyword').value='56-29';applyFilter();await new Promise(requestAnimationFrame);return document.querySelectorAll('#list .item').length;});
  expect(frame).toBe(0);await expect.poll(()=>state.requests.length).toBeGreaterThan(before);await expect(page.locator('#list .item')).toHaveCount(0);
 }finally{await page.evaluate(()=>{JSAuthenticatedAccountEmail=savedAccountV193;});release();}
});


test('v193 forced parcel refresh cannot reuse a default packet after its validation cache was cleared',async({page,context})=>{
 const state=await setup(page,context,{numericCatalog:true}),item=state.masters.find(i=>i.propertyId==='FIXTURE-BUILDING');
 item.address='서구 괴정동 56-29';state.ads.get(item.propertyId).forEach(a=>a.address=item.address);
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 item.salePrice=95000;item.sourceSnapshotKey=hash(4);state.ads.get(item.propertyId).forEach(a=>a.manualDisplayFields='sale_price');state.setRevision('force-parcel-new-v193');
 const release=state.hold();
 try{
  const frame=await page.evaluate(async()=>{document.getElementById('keyword').value='56-29';void JSQueryListingsV152.load(true,true);await new Promise(requestAnimationFrame);return document.querySelectorAll('#list .item').length;});
  expect(frame).toBe(0);release();await expect(page.locator('#list .item')).toHaveCount(1);await expect(page.locator('#list .item')).toContainText('9억5,000');
 }finally{release();}
});


test('v193 a late old-account parcel response never seeds a new-account base cache',async({page,context})=>{
 const state=await setup(page,context),item=state.masters.find(i=>i.propertyId==='FIXTURE-BUILDING');
 item.address='\uad34\uc815\ub3d9 56-29';state.ads.get(item.propertyId).forEach(a=>a.address=item.address);
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 const before=state.requests.length,releaseOld=state.hold();let releaseNew=()=>{};
 try{
  await page.evaluate(()=>{document.getElementById('keyword').value='56-29';window.oldParcelLoadV193=JSQueryListingsV152.load(true,true);});
  await expect.poll(()=>state.requests.length).toBeGreaterThan(before);
  await page.evaluate(()=>{window.savedAccountV193=JSAuthenticatedAccountEmail;JSAuthenticatedAccountEmail='new-after-late-parcel@example.invalid';});
  releaseOld();await page.evaluate(()=>oldParcelLoadV193);
  const prior=state.requests.length;releaseNew=state.hold();
  await page.evaluate(()=>{void JSQueryListingsV152.load(false,true);});
  await expect.poll(()=>state.requests.length).toBeGreaterThan(prior);await expect(page.locator('#list .item')).toHaveCount(0);
 }finally{await page.evaluate(()=>{JSAuthenticatedAccountEmail=savedAccountV193;});releaseOld();releaseNew();}
});


test('v210 twelve bulk holds keep visible decoded cards and coalesce saved-state refresh into one query',async({page,context})=>{
 const state=await setup(page,context,{deltaQueries:true});
 const base=structuredClone(state.masters[0]),ad=structuredClone(state.ads.get(base.propertyId)[0]);
 for(let n=0;n<12;n++){const id='HOLD-V210-'+n;state.masters.push({...structuredClone(base),propertyId:id,name:'보류 검수 '+n,address:'서구 검수동 '+(n+1),sheetRow:n+50});state.ads.set(id,[{...structuredClone(ad),propertyId:id,originalId:id+'-ad',providerSourceId:id+'-source'}]);}
 await state.load();await page.evaluate(async()=>{await JSQueryListingsV152.readMastersForBuildingV164(Array.from({length:12},(_,n)=>'HOLD-V210-'+n));});
 const beforeQueries=state.requests.length;
 await page.evaluate(()=>{selectedPrintKeys=allItems.filter(i=>i.propertyId.startsWith('HOLD-V210-')).map(actionSelectionKeyV660);updatePrintSelectedButton();window.holdRunV210=markSelectedVerificationV160('보류');});
 await expect.poll(()=>state.mutations.filter(m=>m.action==='updateProperty').length).toBe(12);await page.evaluate(()=>holdRunV210);
 await expect.poll(()=>state.requests.length).toBe(beforeQueries+1);
 await expect.poll(()=>page.evaluate(()=>JSQueryListingsV152.hasCurrentData()&&!isLoadingSheet)).toBe(true);
 expect(state.masters.filter(i=>i.propertyId.startsWith('HOLD-V210-')).every(i=>i.state==='보류')).toBe(true);
 expect(state.full).toEqual([]);await expect(page.locator('#list .item')).not.toHaveCount(0);
 const result=await page.evaluate(()=>({held:allItems.filter(i=>i.propertyId.startsWith('HOLD-V210-')&&i.state==='보류').length,decoded:[...document.querySelectorAll('#list img')].filter(i=>i.complete&&i.naturalWidth>0).length}));expect(result.held).toBe(12);expect(result.decoded).toBeGreaterThan(0);
 const before=state.requests.length;await state.reload();await state.load();expect(state.masters.filter(i=>i.propertyId.startsWith('HOLD-V210-')).every(i=>i.state==='보류')).toBe(true);expect(state.requests.length).toBeGreaterThanOrEqual(before);
});


for(const delivery of ['receipt','point-read'])test('v211 grouped sale-card merge includes every selected member and point-paints one surviving card while old/global queries are blocked '+delivery,async({page,context,isMobile})=>{
 const state=await setup(page,context),base=state.masters.find(i=>i.propertyId==='FIXTURE-BUILDING'),baseAd=structuredClone(state.ads.get(base.propertyId)[0]);
 const whole={...base.saleDetails,scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true};
 Object.assign(base,{address:'서구 가장동 56-29',room:'전체',saleCategory:'mixed_house',saleDetails:whole});
 state.ads.set(base.propertyId,[{...baseAd,address:base.address,room:'전체',saleCategory:'mixed_house',saleDetails:whole,saleSummary:whole}]);
 for(const [id,unit] of [['MERGE-MEMBER-V211',false],['MERGE-PRIMARY-V211',true],['NEIGHBOR-V211',true]]){
  const item={...structuredClone(base),propertyId:id,sheetRow:state.masters.length+2,name:id,saleCategory:'building'};state.masters.push(item);
  const detail=unit?{...whole,scope:'unit',saleExtent:'unit',wholeBuildingGroupEligibleV55:false}:whole;
  state.ads.set(id,[{...structuredClone(baseAd),propertyId:id,originalId:id+'-AD',providerSourceId:id,address:base.address,room:'전체',saleCategory:'building',saleDetails:detail,saleSummary:detail}]);
 }
 state.ads.get('MERGE-PRIMARY-V211').push({...structuredClone(state.ads.get('MERGE-PRIMARY-V211')[0]),originalId:'PRIMARY-SECOND-V211',providerSourceId:'second-v211'});
 await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
 await page.addScriptTag({url:'/js/selected-listing-merge-v99.js'});
 if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
 await expect(page.locator('#list .item')).toHaveCount(3);
 const group=await page.evaluate(()=>visibleListItems.find(i=>i.wholeBuildingMembersV55?.includes('MERGE-MEMBER-V211')).propertyId);
 await page.evaluate(group=>{selectedPrintKeys=[group,'MERGE-PRIMARY-V211'].map(id=>actionSelectionKeyV660(allItems.find(i=>i.propertyId===id)));updatePrintSelectedButton();},group);
 await page.locator('#mergeSelectedListingsBtnV99').click();const dialog=page.locator('#selectedMergeDialogV99');
 await expect(dialog).toBeVisible();await expect(dialog.locator('label')).toHaveCount(2);await expect(dialog).toContainText('원장 3개');
 await dialog.locator('input[value="MERGE-PRIMARY-V211"]').check();
 const oldPacket=structuredClone(state.packets.get('query-initial'));let releaseOld,oldStarted=false;
 const oldGate=new Promise(resolve=>{releaseOld=resolve;});
 await page.route('**/api/data?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('action')!=='listingQuery'||oldStarted)return route.fallback();
  oldStarted=true;await oldGate;return route.fulfill({json:oldPacket});
 });
 await page.evaluate(()=>{window.preMergeQueryV211=JSQueryListingsV152.load(true,true);});await expect.poll(()=>oldStarted).toBe(true);
 const writes=[];
 await page.route('**/api/data',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();if(body.action!=='consolidateExistingMasters')return route.fallback();writes.push(body);
  const ids=[body.primaryMasterId,...body.duplicateMasterIds],primary=state.masters.find(i=>i.propertyId===body.primaryMasterId);
  const originals=ids.flatMap(id=>state.ads.get(id));state.ads.set(primary.propertyId,originals.map(ad=>({...ad,propertyId:primary.propertyId})));
  primary.sourceSnapshotKey=hash(7);primary.memo='(확인매물) / 사용자 메모 보존';state.masters.splice(0,state.masters.length,...state.masters.filter(i=>!body.duplicateMasterIds.includes(i.propertyId)));
  await page.evaluate(()=>{
   window.mergeStartV211=performance.now();window.mergePaintV211={};
   const frame=()=>{const cards=document.querySelectorAll('#list .item'),card=document.querySelector('#list .item[data-property-id="MERGE-PRIMARY-V211"]');
    if(cards.length===2&&card?.querySelector('.item-source-link-btn')?.textContent.includes('4개')){
     if(window.mergePaintV211.card==null)window.mergePaintV211.card=performance.now()-window.mergeStartV211;
     if([...card.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0)){window.mergePaintV211.photo=performance.now()-window.mergeStartV211;return;}
    }requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  state.setRevision('merged-v211');await route.fulfill({json:{ok:true,persisted:true,selectedMerge:true,primaryPropertyId:primary.propertyId,duplicatePropertyIds:body.duplicateMasterIds,affectedPropertyIds:ids,primaryOperatingMemo:primary.memo,keyMap:{},...(delivery==='receipt'?{pointResultV211:state.pointFor(ids)}:{})}});
 });
 const releaseNew=state.hold(),releaseMergePoints=state.holdPoints(ids=>ids.includes('MERGE-PRIMARY-V211')),queriesBeforeMerge=state.requests.length,pointsBeforeMerge=state.points.length;
 try{
  await dialog.locator('[data-submit]').click();await expect(dialog).not.toBeVisible();
  if(delivery==='point-read'){
   await page.evaluate(async()=>{for(let n=0;n<4;n++){await JSQueryListingsV152.load(true,true);await JSQueryListingsV152.load(true,false);}await JSQueryListingsV152.poll();});
   expect(state.requests.length).toBe(queriesBeforeMerge);
   // Isolate actual paint time from the deliberately blocked point transfer.
   await page.evaluate(()=>{window.mergeStartV211=performance.now();});releaseMergePoints();
  }else expect(state.points.length).toBe(pointsBeforeMerge);
  await expect(page.locator('#list .item')).toHaveCount(2);
  expect(writes).toHaveLength(1);expect(writes[0].primaryMasterId).toBe('MERGE-PRIMARY-V211');expect(writes[0].duplicateMasterIds.sort()).toEqual(['FIXTURE-BUILDING','MERGE-MEMBER-V211']);
  const survivor=page.locator('#list .item[data-property-id="MERGE-PRIMARY-V211"]');await expect(survivor.locator('.item-source-link-btn')).toContainText('4개');
  await expect.poll(()=>survivor.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  const paint=await page.evaluate(()=>window.mergePaintV211);expect(paint.card).toBeLessThan(250);expect(paint.photo).toBeLessThan(500);
  releaseOld();await page.evaluate(()=>preMergeQueryV211);await expect(page.locator('#list .item')).toHaveCount(2);await expect(survivor.locator('.item-source-link-btn')).toContainText('4개');
  expect(await page.evaluate(()=>jsLastRenderedItemsV639.map(i=>i.propertyId).sort())).toEqual(['MERGE-PRIMARY-V211','NEIGHBOR-V211']);
  expect(state.full).toEqual([]);if(delivery==='point-read')expect(state.points.at(-1).slice().sort()).toEqual(['FIXTURE-BUILDING','MERGE-MEMBER-V211','MERGE-PRIMARY-V211']);
 }finally{releaseOld();releaseNew();releaseMergePoints();}
 await expect.poll(()=>page.evaluate(()=>!isLoadingSheet)).toBe(true);await expect(page.locator('#list .item')).toHaveCount(2);
 await state.reload();await state.load();await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();await expect(page.locator('#list .item')).toHaveCount(2);
 await expect(page.locator('#list .item[data-property-id="MERGE-PRIMARY-V211"] .item-source-link-btn')).toContainText('4개');
});


test('v211 failed committed-merge point read immediately starts authoritative query recovery',async({page,context})=>{
 const state=await setup(page,context);await state.load();const deleted='FIXTURE-LEASE-1',primary='FIXTURE-LEASE-2';
 state.masters.splice(0,state.masters.length,...state.masters.filter(i=>i.propertyId!==deleted));state.setRevision('recovery-after-merge');
 let blocked=0;await page.route('**/api/data?*',route=>{if(new URL(route.request().url()).searchParams.get('action')!=='listingOriginals')return route.fallback();blocked++;return route.fulfill({status:503,json:{ok:false,message:'synthetic exact-point unavailable'}});});
 const before=state.requests.length;
 const failed=await page.evaluate(async({deleted,primary})=>{try{await JSQueryListingsV152.afterMutation({selectedMerge:true,persisted:true,affectedPropertyIds:[primary,deleted]});return false;}catch{return true;}},{deleted,primary});
 expect(failed).toBe(true);expect(blocked).toBeGreaterThan(0);await expect.poll(()=>state.requests.length).toBeGreaterThan(before);
 await expect(page.locator('#list .item[data-property-id="'+deleted+'"]')).toHaveCount(0);await expect(page.locator('#list .item[data-property-id="'+primary+'"]')).toHaveCount(1);expect(state.full).toEqual([]);
});


for(const mode of ['lease','building_sale','land_sale'])test('v225 status actions paint immediately from read-only rows while detail, save ACK and global refresh wait '+mode,async({page,context,isMobile})=>{
 const state=await setup(page,context,{numericCatalog:true}),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND';
 await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});const releasePoints=state.holdPoints(()=>true);await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());const card=page.locator('#list .item[data-property-id="'+id+'"]');await expect(card).toBeVisible();await expect(card).toHaveAttribute('data-query-summary-v157','');
 const beforePoints=state.points.length,photo=await card.locator('img').first().getAttribute('src');
 let releaseAck;const ack=new Promise(resolve=>{releaseAck=resolve;}),writes=[];
 await page.route('**/api/data',async route=>{if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();if(body.action!=='updateProperty')return route.fallback();writes.push(body);await ack;
  const item=state.masters.find(row=>row.propertyId===body.key.propertyId);item.state=body.updated.state;item.sourceSnapshotKey=hash(225);state.setRevision('v225-state-'+mode);
  return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:item.propertyId,updated:body.updated,changedFields:['status']}});
 });
 const releaseQuery=state.hold();
 try{
  await card.locator('input[type=checkbox]').first().check();
  await page.evaluate(()=>{const button=document.querySelector('#selectionActionBar .selection-hold-btn-v160');window.statePaintV225={};button.addEventListener('click',()=>{const started=performance.now();const frame=()=>{if(document.querySelector('[data-state-saving-v225]')){window.statePaintV225.ms=performance.now()-started;return;}requestAnimationFrame(frame);};requestAnimationFrame(frame);},{once:true});});
  await page.locator('#selectionActionBar .selection-hold-btn-v160').click();
  await expect(card.locator('[data-state-saving-v225]')).toHaveText('보류 저장 중');await expect(card).toHaveAttribute('aria-busy','');
  expect((await page.evaluate(()=>statePaintV225)).ms).toBeLessThan(250);expect(writes).toHaveLength(1);expect(writes[0].key).toEqual({propertyId:id});expect(writes[0].editedFields).toEqual(['state']);expect(state.points.length-beforePoints).toBeLessThanOrEqual(6);expect(state.points.flat().every(id=>state.masters.some(row=>row.propertyId===id))).toBe(true);
  await expect(card.locator('img').first()).toHaveAttribute('src',photo);expect(await card.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  releaseAck();await expect(card.locator('[data-state-saving-v225]')).toHaveCount(0);await expect(card).toContainText('보류');expect(state.masters.find(row=>row.propertyId===id).state).toBe('보류');
  await page.evaluate(()=>applyFilter());await expect(card).toContainText('보류');expect(state.points.length-beforePoints).toBeLessThanOrEqual(6);expect(state.points.flat().every(id=>state.masters.some(row=>row.propertyId===id))).toBe(true);expect(state.full).toEqual([]);
 }finally{releaseAck();releasePoints();releaseQuery();}
 await expect.poll(()=>page.evaluate(()=>!isLoadingSheet)).toBe(true);await state.reload();await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}await expect(page.locator('#list .item[data-property-id="'+id+'"]')).toContainText('보류');
});

test('v225 partial status failure rolls back only failed ID and keeps it selected without undoing saved neighbors',async({page,context,isMobile})=>{
 const state=await setup(page,context,{numericCatalog:true});await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});await state.load();if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
 const failed='FIXTURE-LEASE-2',saved='FIXTURE-LEASE-1';await page.route('**/api/data',route=>{if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();if(body.action==='updateProperty'&&body.key.propertyId===failed)return route.fulfill({status:409,json:{ok:false,message:'synthetic same-master conflict'}});return route.fallback();});
 await page.locator('#list .item[data-property-id="'+saved+'"] input[type=checkbox]').first().check();await page.locator('#list .item[data-property-id="'+failed+'"] input[type=checkbox]').first().check();
 await page.locator('#selectionActionBar .selection-hold-btn-v160').click();await expect.poll(()=>dialogs.length).toBe(1);
 await expect(page.locator('#list .item[data-property-id="'+saved+'"]')).toContainText('보류');await expect(page.locator('#list .item[data-property-id="'+failed+'"]')).not.toContainText('보류');
 expect(await page.evaluate(()=>selectedPrintKeys.map(key=>key.replace(/\|row:\d+$/,'')))).toEqual(['property:'+failed]);expect(state.masters.find(i=>i.propertyId===saved).state).toBe('보류');expect(state.masters.find(i=>i.propertyId===failed).state).not.toBe('보류');expect(state.full).toEqual([]);
});

for(const action of ['separate','move-one','whole'])test('v225 committed source operation paints exact added/removed masters, photos and cluster inventory without another point/global wait '+action,async({page,context})=>{
 const state=await setup(page,context),source='FIXTURE-LEASE-1',target='FIXTURE-LEASE-2',added='V225-SEPARATED',moving=structuredClone(state.ads.get(source)[0]);
 state.ads.get(source).push({...structuredClone(moving),originalId:'V225-SECOND',providerSourceId:'V225-second'});await state.load();await page.evaluate(async ids=>JSQueryListingsV152.readMastersForBuildingV164(ids),[source,target]);
 const pointsBefore=state.points.length,releasePoints=state.holdPoints(()=>true),releaseQuery=state.hold();
 try{
  if(action==='separate'){
   state.ads.set(source,[state.ads.get(source)[1]]);const base=structuredClone(state.masters.find(i=>i.propertyId===source));state.masters.push({...base,propertyId:added,sourceSnapshotKey:hash(227),sheetRow:99});state.ads.set(added,[{...moving,propertyId:added}]);
  }else{
   const movingAds=action==='whole'?state.ads.get(source):[moving];state.ads.set(target,state.ads.get(target).concat(movingAds.map(ad=>({...ad,propertyId:target}))));
   if(action==='whole')state.masters.splice(0,state.masters.length,...state.masters.filter(i=>i.propertyId!==source));else state.ads.set(source,[state.ads.get(source)[1]]);
  }
  for(const row of state.masters)if([source,target].includes(row.propertyId))row.sourceSnapshotKey=hash(226);
  state.setRevision('v225-'+action);const ids=action==='separate'?[source,added]:[source,target],packet=state.pointFor(ids);
  await page.evaluate(async({ids,packet})=>{window.sourcePaintStartV225=performance.now();await JSQueryListingsV152.afterMutation({ok:true,persisted:true,sourceMutationV225:true,affectedPropertyIds:ids,pointResultV211:packet});window.sourcePaintMsV225=performance.now()-sourcePaintStartV225;},{ids,packet});
  const expected=action==='separate'?[source,target,added].sort():action==='whole'?[target]:[source,target].sort();
  expect(await page.evaluate(()=>jsLastRenderedItemsV639.map(i=>i.propertyId).sort())).toEqual(expected);
  expect(state.points.length).toBe(pointsBefore);expect(state.full).toEqual([]);expect(await page.evaluate(()=>sourcePaintMsV225)).toBeLessThan(250);
  await expect.poll(()=>page.locator('#list img').evaluateAll(imgs=>imgs.filter(img=>img.complete&&img.naturalWidth>0).length)).toBeGreaterThan(0);
  const inventory=await page.evaluate(ids=>ids.map(id=>({id,count:JSUnifiedListingsV8.allOriginals(id).length})),expected);
  expect(inventory.find(i=>i.id===(action==='separate'?added:target)).count).toBe(action==='whole'?3:action==='move-one'?2:1);
 }finally{releasePoints();releaseQuery();}
 await expect.poll(()=>page.evaluate(()=>!isLoadingSheet)).toBe(true);
});


for(const pinned of [false,true,'temporary'])for(const success of [true,false])test('v225 separate button publishes a reversible read-only split before the save response '+success+' pinned='+pinned,async({page,context,isMobile})=>{
 const state=await setup(page,context),source='FIXTURE-LEASE-1',neighbor='FIXTURE-LEASE-2',added='V225-SAVED-SPLIT',origin=new URL(page.url()).origin;
 const second={...structuredClone(state.ads.get(source)[0]),originalId:'V225-SECOND-AD',providerSourceId:'V225-second-ad',thumbnail:origin+'/__query/photo-second-1.svg',rent:71};state.ads.get(source).push(second);
 await state.load();await page.evaluate(async id=>JSQueryListingsV152.readMastersForBuildingV164([id]),source);if(pinned)await page.evaluate(id=>{const identity='property:'+id;jsPinnedClusterSelectionV6515={spatialKey:getMapSpatialKeyV6515(),itemIdentities:[identity],snapshot:{...captureClusterSelectionSnapshotV638(),singleItemIds:[identity],multiItemIdGroups:[]}};applyFilter();},source);if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
 await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();},second.thumbnail);
 page.on('dialog',dialog=>dialog.accept());let releaseAck;const gate=new Promise(resolve=>{releaseAck=resolve;}),writes=[];
 await page.route('**/api/data',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();if(body.action!=='moveOriginalListing')return route.fallback();writes.push(body);await gate;
  if(!success)return route.fulfill({status:409,json:{ok:false,message:'synthetic split revision conflict'}});
  const moving=state.ads.get(source)[0],parent=state.masters.find(item=>item.propertyId===source);state.ads.set(source,[second]);parent.sourceSnapshotKey=hash(228);state.masters.push({...structuredClone(parent),propertyId:added,sourceSnapshotKey:hash(229),rent:moving.rent,sheetRow:99});state.ads.set(added,[{...moving,propertyId:added}]);state.setRevision('v225-split-saved');
  return route.fulfill({json:{ok:true,persisted:true,separated:true,sourceMutationV225:true,originalId:body.originalId,sourceMasterId:source,targetMasterId:added,propertyId:added,affectedPropertyIds:[source,added],pointResultV211:state.pointFor([source,added])}});
 });
 const beforePoints=state.points.length,releasePoints=state.holdPoints(()=>true),releaseQuery=state.hold();
 try{
  await page.evaluate(id=>{window.splitStartV225=performance.now();window.splitPaintV225={};const frame=()=>{if(document.querySelector('#list .item[data-property-id^="pending-"]')){splitPaintV225.ms=performance.now()-splitStartV225;return;}requestAnimationFrame(frame);};requestAnimationFrame(frame);window.splitRunV225=JSUnifiedListingsV8.separate(encodeURIComponent(id+'-ORIGINAL'),1);},source);
  const preview=page.locator('#list .item[data-property-id^="pending-"]');await expect(preview).toHaveCount(1);await expect(preview).toHaveAttribute('inert','');await expect(preview.locator('[data-state-saving-v225]')).toHaveText('분리 저장 중');expect((await page.evaluate(()=>splitPaintV225)).ms).toBeLessThan(250);
  if(pinned==='temporary')await page.evaluate(()=>{const item=visibleListItems.find(i=>String(i.propertyId).startsWith('pending-')),identity='property:'+item.propertyId;jsPinnedClusterSelectionV6515={spatialKey:getMapSpatialKeyV6515(),itemIdentities:[identity],snapshot:{...captureClusterSelectionSnapshotV638(),singleItemIds:[identity],multiItemIdGroups:[]}};applyFilter();});
  expect(writes).toHaveLength(1);expect(writes[0].originalId).toBe(source+'-ORIGINAL');expect(writes[0].targetMasterId).toBe('NEW');expect(state.points.length).toBe(beforePoints);expect(await page.evaluate(()=>allItems.some(i=>i.propertyId.startsWith('pending-')))).toBe(false);
  if(!pinned)await expect(page.locator('#list .item[data-property-id="'+neighbor+'"]')).toBeVisible();else await expect(page.locator('#list .item')).toHaveCount(pinned==='temporary'?1:2);releaseAck();await page.evaluate(()=>splitRunV225);
  if(success){await expect(page.locator('#list .item[data-property-id="'+added+'"]')).toHaveCount(1);await expect(preview).toHaveCount(0);if(pinned!=='temporary')await expect(page.locator('#list .item[data-property-id="'+source+'"] img').first()).toHaveAttribute('src',second.thumbnail);if(pinned)expect(await page.evaluate(id=>jsPinnedClusterSelectionV6515.itemIdentities.includes('property:'+id),added)).toBe(true);}
  else{await expect(preview).toHaveCount(0);await expect(page.locator('#list .item')).toHaveCount(pinned?1:2);expect(state.ads.get(source)).toHaveLength(2);await expect(page.locator('#unifiedMergeNoticeV8139')).toContainText('synthetic split');}
  expect(state.points.length).toBe(beforePoints);expect(state.full).toEqual([]);
 }finally{releaseAck();releasePoints();releaseQuery();}
});

for(const mode of ['lease','building_sale','land_sale'])for(const success of [true,false])test('v225 condition edits paint exact values before ACK and retain drafts on conflict '+mode+' '+success,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context);await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 const id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',card=page.locator('#list .item[data-property-id="'+id+'"]');
 await page.evaluate(id=>openPropertyEditModalV630(encodeURIComponent(allItems.find(i=>i.propertyId===id).key)),id);
 const field=mode==='lease'?page.locator('#peRentV630'):page.locator('[data-sale-edit="salePrice"]');await expect(field).toBeVisible();await field.fill(mode==='lease'?'80':'60000');
 let releaseAck;const gate=new Promise(resolve=>{releaseAck=resolve;});const writes=[];
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body?.action!=='updateProperty')return route.fallback();writes.push(body);await gate;
  if(!success)return route.fulfill({status:409,json:{ok:false,message:'PROPERTY_EDIT_CONFLICT'}});
  if(mode==='lease')return route.fallback();
  const item=state.masters.find(i=>i.propertyId===id);item.salePrice=body.saleEdit.patch.salePrice;item.sourceSnapshotKey=hash(231);state.ads.get(id).forEach(ad=>{ad.manualDisplayFields='sale_price';});state.setRevision('v225-condition');
  return route.fulfill({json:{ok:true,persisted:true,propertyId:id,updated:{salePrice:item.salePrice},changedFields:['sale_price']}});
 });
 const releaseQuery=state.hold(),releasePoints=state.holdPoints(()=>true);
 try{
  const button=mode==='lease'?page.locator('#propertyEditSaveBtnV630'):page.locator('[data-sale-edit-save]');await button.evaluate(el=>el.addEventListener('click',()=>{window.editPaintV225={start:performance.now()};const frame=()=>{if(document.querySelector('[data-state-saving-v225]')){editPaintV225.ms=performance.now()-editPaintV225.start;return;}requestAnimationFrame(frame);};requestAnimationFrame(frame);},{once:true}));await button.click();
  await expect(card.locator('[data-state-saving-v225]')).toHaveText('조건 수정 저장 중');await expect(card).toContainText(mode==='lease'?'월 80':'6억원');expect((await page.evaluate(()=>editPaintV225)).ms).toBeLessThan(250);
  expect(writes).toHaveLength(1);expect(writes[0].key.propertyId).toBe(id);expect(await page.evaluate(id=>{const i=allItems.find(i=>i.propertyId===id);return i.tradeType==='lease'?i.rent:i.salePrice;},id)).toBe(mode==='lease'?90:mode==='building_sale'?50000:30000);
  releaseAck();
  if(success){await expect(card.locator('[data-state-saving-v225]')).toHaveCount(0);await expect(card).toContainText(mode==='lease'?'월 80':'6억원');}
  else{await expect(card.locator('[data-state-saving-v225]')).toHaveCount(0);await expect(field).toHaveValue(mode==='lease'?'80':'60000');await expect(card).toContainText(mode==='lease'?'월 90':mode==='building_sale'?'5억원':'3억원');}
  expect(state.full).toEqual([]);
 }finally{releaseAck();releasePoints();releaseQuery();}
});

for(const whole of [true,false])for(const success of [true,false])test('v225 target checkbox starts a reversible source move without waiting for target detail '+whole+' '+success,async({page,context,isMobile})=>{
 const state=await setup(page,context,{numericCatalog:true}),source='FIXTURE-LEASE-1',target='FIXTURE-LEASE-2';
 if(!whole)state.ads.get(source).push({...structuredClone(state.ads.get(source)[0]),originalId:'V225-REMAIN',providerSourceId:'v225-remain'});
 await state.load();if(!whole)await page.evaluate(async id=>JSQueryListingsV152.readMastersForBuildingV164([id]),source);if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());page.on('dialog',d=>d.accept());
 let releaseAck;const gate=new Promise(r=>{releaseAck=r;}),writes=[];
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(!['consolidateExistingMasters','moveOriginalListing'].includes(body?.action))return route.fallback();writes.push(body);await gate;if(!success)return route.fulfill({status:409,json:{ok:false,message:'synthetic target conflict'}});
  const moved=whole?state.ads.get(source):state.ads.get(source).slice(0,1),remaining=whole?[]:state.ads.get(source).slice(1);state.ads.set(target,state.ads.get(target).concat(moved.map(ad=>({...ad,propertyId:target}))));state.ads.set(source,remaining);state.masters.find(i=>i.propertyId===target).sourceSnapshotKey=hash(235);if(whole)state.masters.splice(state.masters.findIndex(i=>i.propertyId===source),1);else state.masters.find(i=>i.propertyId===source).sourceSnapshotKey=hash(236);state.setRevision('v225-target');
  return route.fulfill({json:{ok:true,persisted:true,sourceMutationV225:true,selectedMerge:whole,consolidated:whole?1:0,sourceMasterId:source,targetMasterId:target,primaryPropertyId:target,propertyId:target,duplicatePropertyIds:whole?[source]:[],affectedPropertyIds:[source,target],keyMap:{},pointResultV211:state.pointFor([source,target])}});
 });
 const before=state.points.length,releasePoints=state.holdPoints(()=>true),releaseQuery=state.hold();try{
  await page.evaluate(({source,whole})=>{if(whole)JSUnifiedListingsV8.startWholeMasterMove(encodeURIComponent(source));else JSUnifiedListingsV8.startMove(encodeURIComponent(source+'-ORIGINAL'),1);}, {source,whole});
  const card=page.locator('#list .item[data-property-id="'+target+'"]');await card.locator('input[type=checkbox]').first().evaluate(el=>el.ownerDocument.addEventListener('click',()=>{window.targetPaintV225={start:performance.now()};const frame=()=>{if(document.querySelector('[data-state-saving-v225]')){targetPaintV225.ms=performance.now()-targetPaintV225.start;return;}requestAnimationFrame(frame);};requestAnimationFrame(frame);},{capture:true,once:true}));
  await card.locator('input[type=checkbox]').first().click();await expect(card.locator('[data-state-saving-v225]')).toHaveText(whole?'병합 저장 중':'원본 이동 저장 중');expect((await page.evaluate(()=>targetPaintV225)).ms).toBeLessThan(250);expect(writes).toHaveLength(1);expect(state.points.length-before).toBeLessThanOrEqual(2);expect(state.points.flat().every(id=>[source,target].includes(id))).toBe(true);expect(await page.evaluate(id=>JSQueryListingsV152.ready(JSQueryListingsV152.mutationRowV225(id)),target)).toBe(false);expect(writes[0].expectedAccountEmail).toBe('browser-fixture@example.invalid');
  await expect(page.locator('#list .item[data-property-id="'+source+'"]')).toHaveCount(whole?0:1);releaseAck();
  if(success){await expect(card.locator('[data-state-saving-v225]')).toHaveCount(0);await expect(page.locator('#list .item[data-property-id="'+source+'"]')).toHaveCount(whole?0:1);await expect(card.locator('.item-source-link-btn')).toContainText('2개');}
  else{await expect(card.locator('[data-state-saving-v225]')).toHaveCount(0);await expect(page.locator('#list .item')).toHaveCount(2);await expect(page.locator('#unifiedMergeNoticeV8139')).toContainText('synthetic target');}
  // Bounded read-only preparation may already be in flight, or resume after ACK.
  // The 250ms/write assertion above still runs while the target master is held.
  expect(state.points.length-before).toBeLessThanOrEqual(2);expect(state.points.flat().every(id=>[source,target].includes(id))).toBe(true);expect(state.full).toEqual([]);
 }finally{releaseAck();releasePoints();releaseQuery();}
});

test('v225 hydrated cards change confirmed and completed state before ACK and restore only the failed completion',async({page,context,isMobile})=>{
 const state=await setup(page,context);await state.load();if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());page.on('dialog',d=>d.accept());let releaseAck,gate=new Promise(r=>{releaseAck=r;});
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body?.action!=='updateProperty')return route.fallback();await gate;return route.fulfill({status:409,json:{ok:false,message:'state conflict'}});});
 const releaseQuery=state.hold(),releasePoints=state.holdPoints(()=>true),id='FIXTURE-LEASE-1';try{
  await page.evaluate(id=>{window.fullStateV225=JSQueryListingsV152.setSelectedStateV225('확인',[id]);},id);await expect(page.locator('#list .item[data-property-id="'+id+'"] .verification-done-v661')).toContainText('확인');releaseAck();await page.evaluate(()=>fullStateV225);
  gate=new Promise(r=>{releaseAck=r;});await page.evaluate(id=>{window.completedStartV225=performance.now();window.fullStateV225=JSQueryListingsV152.setSelectedStateV225('계약완료',[id]);},id);await expect(page.locator('#list .item[data-property-id="'+id+'"]')).toHaveCount(0);expect(await page.evaluate(()=>performance.now()-completedStartV225)).toBeLessThan(250);releaseAck();await page.evaluate(()=>fullStateV225);await expect(page.locator('#list .item[data-property-id="'+id+'"]')).toHaveCount(1);expect(state.full).toEqual([]);
 }finally{releaseAck();releasePoints();releaseQuery();}
});


test('v225 consecutive state edits use the accepted baseline while the global query waits and restore the last saved state on conflict',async({page,context,isMobile})=>{
 const state=await setup(page,context,{numericCatalog:true});await state.load();if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());page.on('dialog',d=>d.accept());const id='FIXTURE-LEASE-1',item=state.masters.find(i=>i.propertyId===id),writes=[];
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body?.action!=='updateProperty')return route.fallback();writes.push(body);expect(body.originalValues[12]).toBe(item.state||'');if(body.updated.state==='미확인')return route.fulfill({status:409,json:{ok:false,message:'state conflict'}});item.state=body.updated.state;item.sourceSnapshotKey=hash(240+writes.length);return route.fulfill({json:{ok:true,persisted:true,propertyId:id,updated:body.updated,changedFields:['status']}});});
 const releaseQuery=state.hold(),releasePoints=state.holdPoints(()=>true);try{
  for(const next of ['보류','확인','미확인'])await page.evaluate(({id,next})=>JSQueryListingsV152.setSelectedStateV225(next,[id]),{id,next});
  expect(writes).toHaveLength(3);expect(writes.map(b=>b.originalValues[12])).toEqual(['active','보류','확인']);await expect(page.locator('#list .item[data-property-id="'+id+'"] .verification-done-v661')).toContainText('확인');expect(state.full).toEqual([]);
 }finally{releasePoints();releaseQuery();}
});


test('v225 selecting another listing while the previous save waits immediately submits only the new ID',async({page,context,isMobile})=>{
 const state=await setup(page,context,{numericCatalog:true});await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});await state.load();if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());let releaseFirst;const gate=new Promise(r=>{releaseFirst=r;}),writes=[];
 await page.route('**/api/data',async route=>{const b=route.request().postDataJSON();if(b?.action!=='updateProperty')return route.fallback();writes.push(b);if(b.key.propertyId==='FIXTURE-LEASE-1')await gate;return route.fallback();});
 const releaseQuery=state.hold(),releasePoints=state.holdPoints(()=>true);try{
  const first=page.locator('#list [data-property-id="FIXTURE-LEASE-1"]'),second=page.locator('#list [data-property-id="FIXTURE-LEASE-2"]'),hold=page.locator('#selectionActionBar .selection-hold-btn-v160');
  await first.locator('.action-select-check').check();await hold.click();await expect(first.locator('[data-state-saving-v225]')).toHaveText('보류 저장 중');
  await second.locator('.action-select-check').check();await hold.click();await expect.poll(()=>writes.length).toBe(2);expect(writes.map(b=>b.key.propertyId)).toEqual(['FIXTURE-LEASE-1','FIXTURE-LEASE-2']);
  await expect.poll(()=>state.masters.find(i=>i.propertyId==='FIXTURE-LEASE-2').state).toBe('보류');await expect(first.locator('[data-state-saving-v225]')).toHaveText('보류 저장 중');
  releaseFirst();await expect(first.locator('[data-state-saving-v225]')).toHaveCount(0);expect(writes).toHaveLength(2);expect(state.full).toEqual([]);
 }finally{releaseFirst();releasePoints();releaseQuery();}
});

test('v225 separate gestures share one three-request limit while all queued states paint immediately',async({page,context,isMobile})=>{
 const state=await setup(page,context,{numericCatalog:true});for(let n=0;n<4;n++){const id='V225-QUEUED-'+n,base=state.masters[0];state.masters.push({...structuredClone(base),propertyId:id,name:id,sheetRow:n+90});state.ads.set(id,[{...structuredClone(state.ads.get(base.propertyId)[0]),propertyId:id,originalId:id+'-ORIGINAL'}]);}await state.load();if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
 let releaseAck;const gate=new Promise(r=>{releaseAck=r;}),writes=[];let inFlight=0,maxFlight=0;
 await page.route('**/api/data',async route=>{const b=route.request().postDataJSON();if(b?.action!=='updateProperty')return route.fallback();writes.push(b);inFlight++;maxFlight=Math.max(maxFlight,inFlight);await gate;inFlight--;return route.fallback();});
 const releaseQuery=state.hold(),releasePoints=state.holdPoints(()=>true);try{
  await page.evaluate(()=>{const ids=JSQueryListingsV152.filtered({ignoreMapBounds:true,includeUnlocated:true}).map(i=>i.propertyId);window.queuedWritesV225=ids.map(id=>JSQueryListingsV152.setSelectedStateV225('보류',[id]));window.queuePaintV225={start:performance.now()};const frame=()=>{if(document.querySelectorAll('[data-state-saving-v225]').length===6){queuePaintV225.ms=performance.now()-queuePaintV225.start;return;}requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  await expect(page.locator('#list [data-state-saving-v225]')).toHaveCount(6);expect((await page.evaluate(()=>queuePaintV225)).ms).toBeLessThan(250);await expect.poll(()=>writes.length).toBe(3);expect(maxFlight).toBe(3);
  releaseAck();await page.evaluate(()=>Promise.all(queuedWritesV225));expect(writes).toHaveLength(6);expect(new Set(writes.map(b=>b.key.propertyId)).size).toBe(6);expect(maxFlight).toBeLessThanOrEqual(3);await expect(page.locator('#list [data-state-saving-v225]')).toHaveCount(0);expect(state.full).toEqual([]);
 }finally{releaseAck();releasePoints();releaseQuery();}
});

for(const next of ['detail','move'])test('v225 delayed source receipt preserves an unrelated newer '+next,async({page,context,isMobile})=>{
 if(isMobile)await page.setViewportSize({width:930,height:530});
 const state=await setup(page,context),source='FIXTURE-LEASE-1',neighbor='FIXTURE-LEASE-2',added='V225-NEXT-SPLIT';
 const second={...structuredClone(state.ads.get(source)[0]),originalId:'V225-KEPT',providerSourceId:'v225-kept'};state.ads.get(source).push(second);await state.load();page.on('dialog',d=>d.accept());
 let releaseAck;const gate=new Promise(r=>{releaseAck=r;});
 await page.route('**/api/data',async route=>{const b=route.request().postDataJSON();if(b?.action!=='moveOriginalListing')return route.fallback();await gate;
  const moving=state.ads.get(source)[0],parent=state.masters.find(i=>i.propertyId===source);state.ads.set(source,[second]);parent.sourceSnapshotKey=hash(250);state.masters.push({...structuredClone(parent),propertyId:added,sheetRow:99,sourceSnapshotKey:hash(251)});state.ads.set(added,[{...moving,propertyId:added}]);state.setRevision('v225-newer-ui');
  return route.fulfill({json:{ok:true,persisted:true,separated:true,sourceMutationV225:true,sourceMasterId:source,targetMasterId:added,propertyId:added,affectedPropertyIds:[source,added],pointResultV211:state.pointFor([source,added])}});
 });
 const releaseQuery=state.hold();try{
  await page.evaluate(id=>{window.splitNewerUiV225=JSUnifiedListingsV8.separate(encodeURIComponent(id+'-ORIGINAL'),1);},source);await expect(page.locator('#list [data-property-id^="pending-"]')).toHaveCount(1);
  await page.evaluate(id=>JSUnifiedListingsV8.open(id),neighbor);const gallery=page.locator('#unifiedDetailDrawerV8 .unified-detail-gallery-v8');await expect(gallery).toBeVisible();await gallery.locator('.unified-detail-photo-nav-v8.next').click();const photo=gallery.locator('.unified-detail-hero-v8 img');await expect(photo).toHaveAttribute('src',/-2\.svg/);const src=await photo.getAttribute('src');
  if(next==='move')await page.evaluate(id=>JSUnifiedListingsV8.startWholeMasterMove(encodeURIComponent(id)),neighbor);
  releaseAck();await page.evaluate(()=>splitNewerUiV225);await expect(page.locator('#list [data-property-id="'+added+'"]')).toHaveCount(1);
  if(next==='detail'){await expect(page.locator('#unifiedDetailDrawerV8.open')).toBeVisible();await expect(photo).toHaveAttribute('src',src);expect(await photo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);}
  else{await expect(page.locator('#unifiedMoveBannerV8')).toBeVisible();expect(await page.evaluate(()=>JSUnifiedListingsV8.hasPendingMoveV225())).toBe(true);}
  expect(state.full).toEqual([]);
 }finally{releaseAck();releaseQuery();}
});

for(const mode of ['lease','building_sale','land_sale'])test('v226 labelled memo fills historically empty phone columns while protecting edits '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id);
 item.memo='01011112222 (임대인) / 세입자 01033334444';item.landlordPhone='';item.tenantPhone='';state.ads.get(id)[0].manualDisplayFields='landlord_phone,tenant_phone';
 await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 await page.evaluate(id=>openPropertyEditModalV630(encodeURIComponent(allItems.find(i=>i.propertyId===id).key)),id);
 const owner=page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]'),memo=page.locator(mode==='lease'?'#peMemoV630':'[data-sale-edit="memo"]');
 await expect(owner).toHaveValue('010-1111-2222');if(mode!=='land_sale')await expect(page.locator(mode==='lease'?'#peTenantPhoneV630':'[data-sale-edit="tenantPhone"]')).toHaveValue('010-3333-4444');
 await owner.fill('010-7777-8888');await memo.fill('임대인 01099990000');await expect(owner).toHaveValue('010-7777-8888');await owner.fill('');await memo.fill('임대인 01066667777');await expect(owner).toHaveValue('');expect(state.mutations).toEqual([]);
});

for(const mode of ['lease','building_sale','land_sale'])for(const success of [true,false])test('v226 condition save releases the editor before ACK and preserves a newer draft '+mode+' '+success,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context);await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 const id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',neighbor='V226-NEIGHBOR';
 const base=state.masters.find(i=>i.propertyId===id);state.masters.push({...structuredClone(base),propertyId:neighbor,sheetRow:99,name:'다른 매물'});state.ads.set(neighbor,state.ads.get(id).map(a=>({...structuredClone(a),propertyId:neighbor,originalId:neighbor+'-ORIGINAL'})));state.setRevision('v226-editor');await state.load();
 let release;const gate=new Promise(r=>{release=r;});const writes=[];
 await page.route('**/api/data',async route=>{const b=route.request().postDataJSON();if(b?.action!=='updateProperty')return route.fallback();writes.push(b);await gate;if(!success)return route.fulfill({status:409,json:{ok:false,message:'PROPERTY_EDIT_CONFLICT'}});if(mode==='lease')return route.fallback();
  base.salePrice=b.saleEdit.patch.salePrice;base.sourceSnapshotKey=hash(260);return route.fulfill({json:{ok:true,persisted:true,propertyId:id,updated:{salePrice:base.salePrice},changedFields:['sale_price']}});
 });
 await page.evaluate(id=>openPropertyEditModalV630(encodeURIComponent(allItems.find(i=>i.propertyId===id).key)),id);const field=page.locator(mode==='lease'?'#peRentV630':'[data-sale-edit="salePrice"]');await field.fill(mode==='lease'?'80':'60000');
 const save=page.locator(mode==='lease'?'#propertyEditSaveBtnV630':'[data-sale-edit-save]');await save.click();await expect(page.locator(mode==='lease'?'#propertyEditModalV630.open':'.sale-property-edit-v1[open]')).toHaveCount(0,{timeout:250});
 await page.evaluate(id=>openPropertyEditModalV630(encodeURIComponent(allItems.find(i=>i.propertyId===id).key)),neighbor);const memo=page.locator(mode==='lease'?'#peMemoV630':'[data-sale-edit="memo"]');await memo.fill('다른 매물에서 쓰는 중');
 release();await expect(page.locator('#list [data-property-id="'+id+'"] [data-state-saving-v225]')).toHaveCount(0);await expect(memo).toHaveValue('다른 매물에서 쓰는 중');expect(writes).toHaveLength(1);expect(writes[0].key.propertyId).toBe(id);
 if(!success){await expect(page.locator('#propertyEditRecoveryV226')).toContainText('저장 안 된 입력 열기');await page.getByRole('button',{name:'취소',exact:true}).click();await page.getByRole('button',{name:'저장 안 된 입력 열기',exact:true}).click();await expect(field).toHaveValue(mode==='lease'?'80':'60000');}
 expect(state.full).toEqual([]);
});

for(const retained of [true,false])test('v226 unchanged navigation verifies before an optional catalog read '+retained,async({page,context})=>{
 const state=await setup(page,context,{navigationFirst:true,numericCatalog:true,deltaQueries:true});await state.load();await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');
 if(!retained)await page.evaluate(async()=>{const d=await new Promise(r=>{const q=indexedDB.open('js-query-scopes-v152',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const t=d.transaction('views','readwrite');t.objectStore('views').delete(JSAuthenticatedAccountEmail+'|lease|numeric-v216');t.oncomplete=r;});d.close();});
 let deltas=0,full=0;await page.route('**/api/data**',route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')==='listingQuery'){
  if(u.searchParams.has('since')){deltas++;return route.fulfill({json:{ok:true,version:160,queryDeltaV160:true,baseRevision:u.searchParams.get('since'),revision:u.searchParams.get('since'),unchanged:true}});}full++;
 }return route.fallback();});
 const release=state.holdCatalog();try{await state.reload();await page.evaluate(()=>{window.navRefreshV226=JSQueryListingsV152.load(true,false);});
  await expect(page.locator('html')).toHaveAttribute('data-query-fresh-v152','verified',{timeout:1000});await expect(page.locator('#list .item')).toHaveCount(2);await expect.poll(()=>page.locator('#list img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth>0).length)).toBe(2);expect(deltas).toBeGreaterThan(0);
  if(retained){await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','ready');expect(full).toBe(0);}else{await expect.poll(()=>full).toBeGreaterThan(0);await expect(page.locator('html')).toHaveAttribute('data-query-numeric-state-v177','preparing');}
  expect(state.full).toEqual([]);expect(state.mutations).toEqual([]);
 }finally{release();await page.evaluate(()=>navRefreshV226);}
});

for(const invalid of [false,true])test('v226 sale editor reuses only its exact current account baseline '+invalid,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context);await state.load();await page.evaluate(()=>JSListingTradeV1.setMode('building_sale'));await state.load();
 const id='FIXTURE-BUILDING';await page.evaluate(async({id,invalid})=>{await JSQueryListingsV152.readMastersForBuildingV164([id]);if(invalid)allItems.find(i=>i.propertyId===id).editBaselineV226.account='wrong@example.invalid';},{id,invalid});
 let reads=0,release;const gate=new Promise(r=>{release=r;});await page.route('**/api/data**',async route=>{if(new URL(route.request().url()).searchParams.get('action')==='listingChanges'){reads++;await gate;}return route.fallback();});
 try{await page.locator('#list [data-property-id="'+id+'"] .item-edit-btn-v630').click();const field=page.locator('[data-sale-edit="salePrice"]');
  if(invalid){await expect.poll(()=>reads).toBe(1);await expect(field).toHaveCount(0);release();await expect(field).toBeVisible();}
  else{await expect(field).toBeVisible({timeout:250});expect(reads).toBe(0);}expect(state.mutations).toEqual([]);
 }finally{release();}
});

for(const mode of ['lease','building_sale','land_sale'])test('v227 memo reads and reopens its exact private note while all original hydration is held '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true}),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND';
 state.masters.find(i=>i.propertyId===id).memo='현장에서 직접 적은 메모 · 임대인 01011112222';
 if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
 const release=state.holdPoints(()=>true);try{
  await state.load();const card=page.locator('#list [data-property-id="'+id+'"]'),button=card.locator('.item-memo-toggle');
  await button.click();await expect(card.locator('.item-memo-panel')).toContainText('현장에서 직접 적은 메모',{timeout:1000});
  expect(await page.evaluate(()=>allItems.some(i=>i.propertyId===JSQueryListingsV152.memoItemV227('property:'+document.querySelector('#list .item').dataset.propertyId)?.propertyId))).toBe(false);
  await button.click();await page.route('**/api/data**',route=>new URL(route.request().url()).searchParams.get('action')==='listingChanges'?new Promise(()=>{}):route.fallback());
  await button.click();await expect(card.locator('.item-memo-panel')).toBeVisible({timeout:250});
  expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
 }finally{release();}
});

test('v227 private memo cache survives reload only with the same account, fence and exact master proof',async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true}),id='FIXTURE-LEASE-1';
 state.masters[0].memo='저장된 원장의 메모';await state.load();const card=page.locator('#list [data-property-id="'+id+'"]');await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toContainText('저장된 원장의 메모');
 await expect.poll(()=>page.evaluate(async()=>{const r=indexedDB.open('js-query-scopes-v152',1);const d=await new Promise(resolve=>{r.onsuccess=()=>resolve(r.result);});return new Promise(resolve=>{const t=d.transaction('views','readonly'),q=t.objectStore('views').getAllKeys();q.onsuccess=()=>resolve(q.result.some(k=>k.includes('|memo-v227|')));});})).toBe(true);
 await state.reload();await state.load();let release;const gate=new Promise(r=>{release=r;});await page.route('**/api/data**',async route=>{if(new URL(route.request().url()).searchParams.get('action')==='listingChanges')await gate;return route.fallback();});
 try{await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toContainText('저장된 원장의 메모',{timeout:250});
  await card.locator('.item-memo-toggle').click();state.masters[0].memo='새 원장의 메모';state.masters[0].sourceSnapshotKey=hash(227);state.setRevision('memo-new-proof');await page.evaluate(()=>JSQueryListingsV152.load(true,true));await expect(page.locator('html')).toHaveAttribute('data-query-revision-v152','memo-new-proof');
  await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toHaveCount(0);release();await expect(card.locator('.item-memo-panel')).toContainText('새 원장의 메모');
 }finally{release();}
});

test('v227 wrong-master memo response stays retryable and never creates a private editor master',async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true});state.masters[0].memo='올바른 메모';const releasePoints=state.holdPoints(()=>true);let wrong=true;
 await page.route('**/api/data**',route=>{if(new URL(route.request().url()).searchParams.get('action')!=='listingChanges'||!wrong)return route.fallback();return route.fulfill({json:{ok:true,items:[{property_id:'OTHER',status:'active',source_snapshot_key:hash(1),operating_memo:'다른 매물의 메모'}]}});});
 await state.load();const card=page.locator('#list [data-property-id="FIXTURE-LEASE-1"]');await card.locator('.item-memo-toggle').click();await expect(page.locator('#status')).toContainText('최신 메모를 확인하지 못했습니다');await expect(card.locator('.item-memo-panel')).toHaveCount(0);
 wrong=false;await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toContainText('올바른 메모');expect(state.mutations).toEqual([]);releasePoints();
});

for(const mode of ['lease','building_sale','land_sale'])test('v227 compound memo roles populate the exact edit fields in all markets '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id);
 item.memo='임대인(사모) 01011112222\n세입자(사장) 01033334444';item.landlordPhone='';item.tenantPhone='';
 await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 await page.locator('#list [data-property-id="'+id+'"] .item-edit-btn-v630').click();
 await expect(page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]')).toHaveValue('010-1111-2222');
 if(mode!=='land_sale')await expect(page.locator(mode==='lease'?'#peTenantPhoneV630':'[data-sale-edit="tenantPhone"]')).toHaveValue('010-3333-4444');
 expect(state.mutations).toEqual([]);
});

for(const boundary of ['account','fence'])test('v227 memo private storage never reuses another '+boundary,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true});const releasePoints=state.holdPoints(()=>true);try{state.masters[0].memo='이전 경계의 메모';await state.load();const card=page.locator('#list [data-property-id="FIXTURE-LEASE-1"]');
 await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toContainText('이전 경계의 메모');await card.locator('.item-memo-toggle').click();
 await page.evaluate(boundary=>{if(boundary==='account')JSAuthenticatedAccountEmail='second@example.invalid';else localStorage.setItem('js-query-epoch-v152:'+JSAuthenticatedAccountEmail,'new-fence-v227');},boundary);
 state.masters[0].memo='현재 경계의 메모';await page.evaluate(()=>JSQueryListingsV152.load(true,true));let release;const gate=new Promise(r=>{release=r;});
 await page.route('**/api/data**',async route=>{if(new URL(route.request().url()).searchParams.get('action')==='listingChanges')await gate;return route.fallback();});
 try{await card.locator('.item-memo-toggle').click();await expect(card).not.toContainText('이전 경계의 메모');release();await expect(card.locator('.item-memo-panel')).toContainText('현재 경계의 메모');}finally{release();}
 }finally{releasePoints();}
});

for(const mode of ['lease','building_sale'])test('v227 opened memo checkpoints only its verified master so the next refresh edit needs no original wait '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true}),id=mode==='lease'?'FIXTURE-LEASE-1':'FIXTURE-BUILDING';state.masters.find(i=>i.propertyId===id).memo='임대인(사모) 01011112222';
 if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();const card=page.locator('#list [data-property-id="'+id+'"]');await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toContainText('임대인(사모)');
 await expect.poll(()=>page.evaluate(id=>JSQueryListingsV152.ready({propertyId:id}),id)).toBe(true);
 await expect.poll(()=>page.evaluate(async id=>{const r=indexedDB.open('js-query-scopes-v152',1),d=await new Promise(resolve=>{r.onsuccess=()=>resolve(r.result);});return new Promise(resolve=>{const t=d.transaction('views','readonly'),q=t.objectStore('views').getAll();q.onsuccess=()=>resolve(q.result.some(value=>value.points?.some(point=>point.row.property_id===id)));});},id)).toBe(true);
 await state.reload();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);const release=state.holdPoints(()=>true);try{await state.load();await card.locator('.item-edit-btn-v630').click();await expect(page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]')).toHaveValue('010-1111-2222',{timeout:250});expect(state.mutations).toEqual([]);}finally{release();}
});

test('v227 a blocked private memo disk read never delays the live small read or materializes raw sources',async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true});state.masters[0].memo='디스크가 응답하지 않아도 읽는 최신 메모';
 await page.evaluate(()=>{const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){return String(key).includes('|memo-v227|')?{}:get.call(this,key);};});
 const release=state.holdPoints(()=>true);try{await state.load();const card=page.locator('#list [data-property-id="FIXTURE-LEASE-1"]');await card.locator('.item-memo-toggle').click();await expect(card.locator('.item-memo-panel')).toContainText('최신 메모',{timeout:1000});expect(state.mutations).toEqual([]);}finally{release();}
});

test('v227 authoritative empty memo opens honestly instead of timing out or inventing content',async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true});state.masters[0].memo=null;const release=state.holdPoints(()=>true);
 try{await state.load();const card=page.locator('#list [data-property-id="FIXTURE-LEASE-1"]');await card.locator('.item-memo-toggle').click();await expect(card.locator('.memo-empty')).toHaveText('메모가 없습니다.',{timeout:1000});expect(state.mutations).toEqual([]);}finally{release();}
});

for(const cover of [false,true])test('v230 first detail reuses only the decoded same-ad first photo, excluding personal covers '+cover,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});await page.route('http://127.0.0.1:4179/',async route=>{const response=await route.fetch(),headers={...response.headers()};headers['content-security-policy']=headers['content-security-policy'].replace("img-src 'self' data:","img-src 'self' data: https://img.kr.gcp-karroter.net");return route.fulfill({response,headers});});const state=await setup(page,context,{numericCatalog:true}),id='FIXTURE-LEASE-1',url='https://img.kr.gcp-karroter.net/realty/realty/articles/v230-photo.jpg?q=95&s=1440x1440&t=inside',ad=state.ads.get(id)[0];
 ad.source='당근';ad.thumbnail=url;ad.images=[url,'http://127.0.0.1:4179/__query/photo-'+id+'-2.svg'];let release;const high=new Promise(r=>{release=r;});
 await page.route('https://img.kr.gcp-karroter.net/**',async route=>{const small=route.request().url().includes('320x320');if(!small)await high;await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="'+(small?320:1440)+'" height="200"><rect width="100%" height="100%" fill="blue"/></svg>',headers:{'cache-control':'public,max-age=3600'}});});
 try{await state.load();const card=page.locator('#list [data-property-id="'+id+'"]');await expect.poll(()=>card.locator('img').first().evaluate(i=>i.complete&&i.naturalWidth)).toBe(320);
  if(cover)await page.evaluate(()=>{const original=JSListingCoverV85.urlFor;JSListingCoverV85.urlFor=()=>'/personal-cover-v230.svg';window.restoreCoverV230=()=>{JSListingCoverV85.urlFor=original;};});
  await card.locator('.unified-thumb-v8').click();const hero=page.locator('#unifiedDetailDrawerV8 .unified-detail-hero-v8 img');await expect(page.locator('#unifiedDetailDrawerV8.open')).toBeVisible();
  if(cover){await expect(hero).not.toHaveAttribute('data-first-photo-resolution-v230','preview');}else{
   await expect.poll(()=>hero.evaluate(i=>i.complete&&i.naturalWidth),{timeout:500}).toBe(320);await expect(hero).toHaveAttribute('data-first-photo-resolution-v230','preview');await expect(hero).toHaveAttribute('data-detail-source-v8144',url);
   await page.locator('#unifiedDetailDrawerV8 [aria-label="다음 사진"]').click();await expect(hero).toHaveAttribute('src',/-2\.svg/);const source=await hero.getAttribute('src');release();await page.waitForTimeout(150);await expect(hero).toHaveAttribute('src',source);expect(await hero.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  }expect(state.mutations).toEqual([]);
 }finally{release();if(cover)await page.evaluate(()=>window.restoreCoverV230?.());}
});

for(const changed of [false,true])test('v230 first editor click survives only an identical query verification '+changed,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true}),release=state.holdPoints(()=>true);await state.load();
 const card=page.locator('#list [data-property-id="FIXTURE-LEASE-1"]');await card.locator('.item-edit-btn-v630').click();await expect(page.locator('#propertyEditModalV630.open')).toHaveCount(0);
 await page.waitForTimeout(300);await page.evaluate(changed=>{if(changed)document.getElementById('minRent').value='140';return JSQueryListingsV152.load(true,true);},changed);
 release();if(changed){await expect(page.locator('#list [data-property-id="FIXTURE-LEASE-1"]')).toHaveCount(0);await page.waitForTimeout(300);await expect(page.locator('#propertyEditModalV630.open')).toHaveCount(0);}else{await expect(page.locator('#propertyEditModalV630.open')).toBeVisible();await expect(page.locator('#peAddressV630')).toHaveValue(state.masters[0].address);await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.interactionStateV230)).toBe('content');expect(await page.evaluate(()=>Number(document.documentElement.dataset.interactionMsV230))).toBeGreaterThanOrEqual(300);}
 expect(state.mutations).toEqual([]);
});

for(const mode of ['lease','building_sale','land_sale'])test('v230 painted cards prepare exact notes contacts editors and decoded detail before their first touch '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true,navigationFirst:true}),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id);
 item.displayValuePresence={...item.displayValuePresence,contactsV224:true};item.memo='처음 누르는 매물의 현장 메모';item.collectedContactsV227=[{role:'사모',phone:'01011112222'},{role:'세입자',phone:'01033334444'}];
 if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
 const metadata=page.waitForResponse(r=>r.url().includes('action=listingOriginals')&&new URL(r.url()).searchParams.get('ids')===id);
 const started=Date.now();await state.load();await (await metadata).finished();
 await expect.poll(()=>page.evaluate(id=>document.querySelector('#list [data-property-id="'+id+'"] .item-contact-button-v654')?.classList.contains('has-contacts'),id),{timeout:1000}).toBe(true);
 expect(Date.now()-started).toBeLessThanOrEqual(1000);expect(await page.evaluate(()=>allItems.length)).toBe(0);
 await page.route('**/api/data**',route=>['listingChanges','listingOriginals','unifiedListingContacts','unifiedListingDetail'].includes(new URL(route.request().url()).searchParams.get('action'))?new Promise(()=>{}):route.fallback());
 const card=page.locator('#list [data-property-id="'+id+'"]');
 async function gesture(selector,ready){const value=await page.evaluate(async({selector,ready})=>{
   const start=performance.now();document.querySelector(selector).click();
   while(performance.now()-start<250&&!document.querySelector(ready))await new Promise(requestAnimationFrame);
   return performance.now()-start;
 },{selector,ready});expect(value).toBeLessThanOrEqual(250);await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.interactionStateV230)).toBe('content');expect(await page.evaluate(()=>Number(document.documentElement.dataset.interactionMsV230))).toBeLessThanOrEqual(250);}
 await gesture('#list [data-property-id="'+id+'"] .item-memo-toggle','#list .item-memo-panel');await expect(card.locator('.item-memo-panel')).toContainText(item.memo);await card.locator('.item-memo-toggle').click();
 await gesture('#list [data-property-id="'+id+'"] .item-contact-button-v654','#listContactBodyV654 a[href="tel:01011112222"]');await expect(page.locator('#listContactBodyV654')).toContainText('010-3333-4444');await page.evaluate(()=>closeListContactPopupV654());
 await gesture('#list [data-property-id="'+id+'"] .item-edit-btn-v630',mode==='lease'?'#propertyEditModalV630.open':'dialog[open] [data-sale-edit="salePrice"]');
 await expect(page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]')).toHaveValue('010-1111-2222');
 await page.locator(mode==='lease'?'#propertyEditModalV630 button[aria-label="닫기"]':'dialog[open] [data-sale-edit-cancel]').click();
 const timing=await page.evaluate(async id=>{const start=performance.now();document.querySelector('#list [data-property-id="'+id+'"] .unified-thumb-v8').click();
   while(performance.now()-start<500){const img=document.querySelector('#unifiedDetailDrawerV8.open img');if(img?.complete&&img.naturalWidth>0)return {ms:performance.now()-start,decoded:true};await new Promise(requestAnimationFrame);}
   return {ms:performance.now()-start,decoded:false};},id);
 expect(timing.decoded).toBe(true);expect(timing.ms).toBeLessThanOrEqual(500);await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.interactionStateV230)).toBe('content');expect(await page.evaluate(()=>Number(document.documentElement.dataset.interactionMsV230))).toBeLessThanOrEqual(500);
 await expect(page.locator('#unifiedDetailDrawerV8')).toContainText(item.address);expect(state.mutations).toEqual([]);expect(state.full).toEqual([]);
});

for(const mode of ['lease','building_sale','land_sale'])test('v230 persisted and linked Gongsilbox contacts match the popup in each editor '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true}),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id);
 item.source='공실박스';item.memo='세01055556666';item.contacts=[{role:'여',phone:'01011112222'},{role:'세',phone:'01033334444'},{role:'세',phone:'01055556666'}];item.collectedContactsV227=[item.contacts[0]];
 state.ads.get(id)[0].source='공실박스';state.ads.get(id)[0].contactCount=1;
 if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();
 const card=page.locator('#list [data-property-id="'+id+'"]');await card.locator('.item-contact-button-v654').click();await expect(page.locator('#listContactBodyV654 a[href^="tel:"]')).toHaveCount(3);await page.evaluate(()=>closeListContactPopupV654());await card.locator('.item-edit-btn-v630').click();
 const contacts=page.locator(mode==='lease'?'#propertyEditMemoContactsV224':'[data-memo-contacts-v224]');for(const phone of ['010-1111-2222','010-3333-4444','010-5555-6666'])await expect(contacts).toContainText(phone);
 await expect(page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]')).toHaveValue('010-1111-2222');if(mode!=='land_sale')await expect(page.locator(mode==='lease'?'#peTenantPhoneV630':'[data-sale-edit="tenantPhone"]')).toHaveValue('010-5555-6666');expect(state.mutations).toEqual([]);
});

for(const mode of ['lease','building_sale','land_sale'])test('v230 mixed-provider phone popup and editor retain every collected role even with no summary Gongsil count '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context,{numericCatalog:true}),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id);
 item.memo='직접 쓴 관리 메모';item.landlordPhone='';item.tenantPhone='';item.source='네이버';
 item.collectedContactsV227=[{role:'사모',phone:'01011112222'},{role:'사장',phone:'01033334444'},{role:'세입자',phone:'01055556666'},{role:'세입자',phone:'01077778888'}];
 state.ads.get(id)[0].source='네이버';state.ads.get(id)[0].contactCount=0;
 await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 const card=page.locator('#list [data-property-id="'+id+'"]');await card.locator('.item-contact-button-v654').click();
 await expect(page.locator('#listContactBodyV654')).toContainText('010-3333-4444');await page.evaluate(()=>closeListContactPopupV654());
 await card.locator('.item-edit-btn-v630').click();
 const contacts=page.locator(mode==='lease'?'#propertyEditMemoContactsV224':'[data-memo-contacts-v224]');
 for(const number of ['010-1111-2222','010-3333-4444','010-5555-6666','010-7777-8888'])await expect(contacts).toContainText(number);
 await expect(page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]')).toHaveValue('010-3333-4444');
 if(mode!=='land_sale')await expect(page.locator(mode==='lease'?'#peTenantPhoneV630':'[data-sale-edit="tenantPhone"]')).toHaveValue('010-5555-6666');
 expect(state.mutations).toEqual([]);
});

for(const mode of ['lease','building_sale','land_sale'])test('v227 collected Gongsilbox contacts fill editor without requiring a memo phone '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id);
 item.memo='번호를 적지 않은 관리 메모';item.landlordPhone='';item.tenantPhone='';item.collectedContactsV227=[{role:'주인',phone:'01011112222'},{role:'세입자',phone:'01033334444'}];state.ads.get(id)[0].source='공실박스';state.ads.get(id)[0].contactCount=2;
 await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}
 const card=page.locator('#list [data-property-id="'+id+'"]');await card.locator('.item-contact-button-v654').click();await expect(page.locator('#listContactBodyV654')).toContainText('010-1111-2222');
 await page.evaluate(()=>closeListContactPopupV654());const reads=state.phoneReads.length;
 await card.locator('.item-edit-btn-v630').click();await expect(page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]')).toHaveValue('010-1111-2222');
 if(mode!=='land_sale')await expect(page.locator(mode==='lease'?'#peTenantPhoneV630':'[data-sale-edit="tenantPhone"]')).toHaveValue('010-3333-4444');
 expect(state.phoneReads.length).toBe(reads);expect(state.mutations).toEqual([]);
});

for(const mode of ['lease','building_sale'])test('v227 slow collected contacts protect direct typing and explicit deletion '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context),id=mode==='lease'?'FIXTURE-LEASE-1':'FIXTURE-BUILDING',item=state.masters.find(i=>i.propertyId===id);
 item.memo='번호 없는 메모';item.landlordPhone='';item.tenantPhone='';item.collectedContactsV227=[{role:'임대인',phone:'01011112222'},{role:'세입자',phone:'01033334444'}];state.ads.get(id)[0].source='공실박스';state.ads.get(id)[0].contactCount=2;
 await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}const release=state.holdPhones(()=>true);
 try{await page.locator('#list [data-property-id="'+id+'"] .item-edit-btn-v630').click();const owner=page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]'),tenant=page.locator(mode==='lease'?'#peTenantPhoneV630':'[data-sale-edit="tenantPhone"]');
 await expect(owner).toBeVisible();await owner.fill('01055556666');await owner.fill('');await tenant.fill('01077778888');release();
 await expect(page.locator(mode==='lease'?'#propertyEditMemoContactsV224':'[data-memo-contacts-v224]')).toContainText('공실박스');await expect(owner).toHaveValue('');await expect(tenant).toHaveValue('01077778888');
 expect(state.mutations).toEqual([]);}finally{release();}
});

for(const boundary of ['account','fence'])test('v227 collected contacts never fill an editor after its private '+boundary+' changes',async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context),item=state.masters[0],id=item.propertyId;item.memo='';item.landlordPhone='';item.collectedContactsV227=[{role:'주인',phone:'01011112222'}];state.ads.get(id)[0].source='공실박스';state.ads.get(id)[0].contactCount=1;
 await state.load();const release=state.holdPhones(()=>true);try{await page.locator('#list [data-property-id="'+id+'"] .item-edit-btn-v630').click();await expect(page.locator('#peLandlordPhoneV630')).toBeVisible();
 await expect.poll(()=>state.phoneReads.length).toBeGreaterThan(0);await page.evaluate(boundary=>{if(boundary==='account')JSAuthenticatedAccountEmail='different@example.invalid';else localStorage.setItem('js-query-epoch-v152:'+JSAuthenticatedAccountEmail,'other-fence');},boundary);release();
 await page.waitForTimeout(200);await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('');expect(state.mutations).toEqual([]);
 }finally{release();}
});

for(const mode of ['lease','building_sale','land_sale'])test('v227 collected phone autofill saves only its exact master and survives reopening '+mode,async({page,context})=>{
 await page.setViewportSize({width:930,height:700});const state=await setup(page,context),id=mode==='lease'?'FIXTURE-LEASE-1':mode==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND',item=state.masters.find(i=>i.propertyId===id),other=structuredClone(state.masters.find(i=>i.propertyId!==id));
 item.memo='원래 관리 메모';item.landlordPhone='';item.tenantPhone='';item.collectedContactsV227=[{role:'주인',phone:'01011112222'},{role:'세입자',phone:'01033334444'}];state.ads.get(id)[0].source='공실박스';state.ads.get(id)[0].contactCount=2;
 await state.load();if(mode!=='lease'){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();}const edit=page.locator('#list [data-property-id="'+id+'"] .item-edit-btn-v630');
 await edit.click();const owner=page.locator(mode==='lease'?'#peLandlordPhoneV630':'[data-sale-edit="landlordPhone"]');await expect(owner).toHaveValue('010-1111-2222');expect(state.mutations).toEqual([]);
 await page.locator(mode==='lease'?'#propertyEditSaveBtnV630':'[data-sale-edit-save]').click();await expect.poll(()=>state.mutations.length).toBe(1);expect(state.mutations[0].key.propertyId).toBe(id);expect(state.mutations[0].updated.landlordPhone).toBe('010-1111-2222');
 if(mode!=='land_sale')expect(state.mutations[0].updated.tenantPhone).toBe('010-3333-4444');expect(state.masters.find(i=>i.propertyId===other.propertyId)).toEqual(other);
 await expect(page.locator(mode==='lease'?'#propertyEditModalV630.open':'.sale-property-edit-v1[open]')).toHaveCount(0);await state.reload();if(mode!=='lease')await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await state.load();await edit.click();await expect(owner).toHaveValue('010-1111-2222');
});
