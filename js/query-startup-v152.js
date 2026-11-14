/* Bounded query startup adapter. allItems contains actual editable masters
 * only; the complete read-only navigation index lives in this controller. */
(function(global){
  'use strict';
  var controller=null,indexView=null,history=new Map(),loading=null,preparing=new Map(),confirmed=new Set(),lookupPending=new Set(),actionIntent=0,unscopedKnown=new Map(),baseViews=new Map(),saveTimer=0,receiptMarks=new Map(),initialWarm=null;
  var inputs=['keyword','typeFilter','sourceFilter','floorQuickFilter','brokerageFeeFilter','sortFilter','industryFilter',
    'minDeposit','maxDeposit','minRent','maxRent','minPremium','maxPremium','minArea','maxArea','minFloor','maxFloor',
    'saleLandMin','saleLandMax','saleGrossMin','saleGrossMax','saleYieldMin','saleYieldMax','saleUnitPriceMin','saleUnitPriceMax',
    'saleCategoryFilter','saleLandUseFilter','saleZoningFilter'];
  var retryTimer=0,retries=0,initialCacheWarm=null,previewWarm=null,publishedSignature='';
  var lookupQueue=new Set(),lookupTimer=0;
  var receiptPatches=new Map(),patchRunning=false,patchBaseline='',patchTimer=0;
  var mediaPendingV159=new WeakMap();
  var parcelOwnersV193=new WeakMap();
  var selectedActionIntentV162=0;
  var filterPaintV220=null;
  var projectionReadsV228=new Map();
  var navigationReadsV228=new Set();
  function cancelOtherMarketProjectionV228(mode){projectionReadsV228.forEach(function(job){
    if(job.mode!==mode||job.account!==owner()||job.fence!==storageEpoch())job.controller.abort();
  });navigationReadsV228.forEach(function(job){if(job.mode!==mode||job.account!==owner()||job.fence!==storageEpoch())job.controller.abort();});}
  var stateChangesV225=new Map();
  var sourceChangesV225=new Map();
  var previewIdsV225=new Set();
  var stateWritesV225=0,stateWaitersV225=[];
  function stateSlotV225(){return new Promise(function(resolve){function start(){stateWritesV225++;var released=false;resolve(function(){if(released)return;released=true;stateWritesV225--;stateWaitersV225.shift()?.();});}if(stateWritesV225<3)start();else stateWaitersV225.push(start);});}
  function paintMutationV225(){var before=global.preserveActionSelectionDuringRender;global.preserveActionSelectionDuringRender=true;try{global.applyFilter();}finally{global.preserveActionSelectionDuringRender=before;}paintStatePendingV225();}
  function sourcePreviewV225(row){var change=sourceChangesV225.get(row?.previewOperationV225);return change?.account===owner()&&change.rows.some(function(value){return value.propertyId===row.propertyId;})?change:null;}
  function previewByIdV225(id){var found=null;sourceChangesV225.forEach(function(change){if(change.account===owner())found=change.rows.find(function(row){return String(row.propertyId)===String(id);})||found;});return found;}
  function overlaySourcesV225(rows){
    sourceChangesV225.forEach(function(change){if(change.account!==owner()||change.signature!==JSON.stringify(spec()))return;
      var replacements=new Map(change.rows.map(function(row){return[String(row.propertyId),row];})),extra=change.rows.filter(function(row){return !change.ids.includes(String(row.propertyId));}),inserted=false;
      rows=rows.flatMap(function(row){if(!change.ids.includes(String(row.propertyId)))return[row];var next=replacements.has(String(row.propertyId))?[replacements.get(String(row.propertyId))]:[];if(!inserted){inserted=true;next=next.concat(extra);}return next;});
    });return rows;
  }
  function beginPropertyEditV225(item,updated,fields){
    if(!active())return null;
    var id=String(item.propertyId),view=controller.snapshot(),nav=view.byId.get(id),who=owner(),token='edit-preview-'+global.crypto.randomUUID();
    if(!nav||stateChangesV225.get(id)?.pending||Array.from(sourceChangesV225.values()).some(function(change){return change.account===who&&change.ids.includes(id);}))return null;
    var columns={name:'title',room:'room',deposit:'deposit',rent:'monthly_rent',fee:'maintenance_fee',premium:'premium',area:'area_m2',landlordPhone:'landlord_phone',tenantPhone:'tenant_phone',salePrice:'sale_price',saleDetails:'sale_details_json'};
    var draft=Object.assign({},master(id)||item,updated,{manualFinancialFieldsV106:Array.from(new Set((item.manualFinancialFieldsV106||[]).concat((fields||Object.keys(updated)).map(function(key){return columns[key];}).filter(Boolean)))),displayValuePresence:Object.assign({},item.displayValuePresence)});
    ['deposit','rent','fee','premium','area'].forEach(function(key){if(Object.hasOwn(updated,key))draft.displayValuePresence[key]=updated[key]!=null&&updated[key]!=='';});
    var rows=global.getFilteredItems({items:[draft],queryLegacyV152:true,ignoreMapBounds:true,includeUnlocated:true}).map(function(row){return Object.assign({},row,{queryRowV152:true,previewOperationV225:token,queryGroupKeyV152:'',wholeBuildingMembersV55:undefined,queryMatchedOriginalCountV152:nav.queryMatchedOriginalCountV152});});
    var change={account:who,mode:view.spec.mode,signature:view.signature,ids:[id],rows:rows,proofs:new Map([[id,nav.sourceSnapshotKey]]),label:'조건 수정',saved:false};
    sourceChangesV225.set(token,change);paintMutationV225();
    function finish(){sourceChangesV225.delete(token);if(who===owner()){paintMutationV225();}}
    return {finish:finish,accepted:function(){if(who!==owner()){sourceChangesV225.delete(token);return;}var current=controller.snapshot();reconcile(current,{items:[{property_id:id}],missingIds:[]});finish();}};
  }
  function beginSourceMutationV225(settings){
    if(!active())return null;
    var view=controller.snapshot(),who=owner(),token='source-preview-'+global.crypto.randomUUID(),target=String(settings.targetId||''),ids=(settings.sourceIds||[]).map(String);
    if(!ids.length&&settings.originalId){var found=(global.allItems||[]).find(function(item){return(item.unifiedAllOriginalsV1||[]).some(function(ad){return ad.originalId===settings.originalId;});});if(found)ids=[String(found.propertyId)];}
    if(!ids.length||ids.some(function(id){return !view.byId.has(id);})||target!=='NEW'&&!view.byId.has(target))return null;
    var affected=Array.from(new Set(ids.concat(target==='NEW'?[]:[target])));
    if(affected.some(function(id){return stateChangesV225.get(id)?.pending;})||Array.from(sourceChangesV225.values()).some(function(change){return change.account===who&&change.ids.some(function(id){return affected.includes(id);});}))throw new Error('이 매물의 이전 변경을 저장 중입니다.');
    var preview=[];
    function row(value,id){return Object.assign({},overlayStateV225(value),{propertyId:id,key:'property:'+id,queryRowV152:true,previewOperationV225:token,queryGroupKeyV152:'',wholeBuildingMembersV55:undefined});}
    if(settings.whole){
      var primary=view.byId.get(target),count=affected.reduce(function(total,id){return total+Number(view.byId.get(id)?.queryMatchedOriginalCountV152||view.byId.get(id)?.unifiedOriginalCountV8||0);},0);
      preview.push(Object.assign(row(primary,target),{queryMatchedOriginalCountV152:count,unifiedOriginalCountV8:count}));
    }else{
      var parent=master(ids[0]),originals=parent?.unifiedAllOriginalsV1||[],moving=originals.find(function(ad){return ad.originalId===settings.originalId;});
      if(!moving)return null;
      var remaining=originals.filter(function(ad){return ad.originalId!==settings.originalId;});
      if(remaining.length){var projected=global.getFilteredItems({items:[Object.assign({},parent,{unifiedAllOriginalsV1:remaining})],queryLegacyV152:true,ignoreMapBounds:true,includeUnlocated:true})[0];if(projected)preview.push(row(projected,ids[0]));}
      if(target==='NEW'){
        var newId='pending-'+global.crypto.randomUUID(),newRow=global.JSUnifiedListingsV8.filterItemForView(Object.assign({},parent,{unifiedAllOriginalsV1:[moving]}),function(){return true;},'active');previewIdsV225.add(newId);
        preview.push(Object.assign(row(newRow,newId),{queryMatchedOriginalCountV152:1,unifiedOriginalCountV8:1,querySelectedOriginalIdV152:moving.originalId,querySelectedPhotoCountV157:Number(moving.photoCount)||null}));
      }else{var targetRow=view.byId.get(target),n=Number(targetRow.queryMatchedOriginalCountV152||targetRow.unifiedOriginalCountV8||0)+1;preview.push(Object.assign(row(targetRow,target),{queryMatchedOriginalCountV152:n,unifiedOriginalCountV8:n}));}
    }
    var change={account:who,mode:view.spec.mode,signature:view.signature,ids:affected,rows:preview,proofs:new Map(affected.map(function(id){return[id,view.byId.get(id)?.sourceSnapshotKey];})),label:settings.whole?'병합':target==='NEW'?'분리':'원본 이동',saved:false};
    sourceChangesV225.set(token,change);paintMutationV225();
    return {saved:function(){change.saved=true;paintStatePendingV225();},finish:function(){sourceChangesV225.delete(token);if(who===owner()){if(!change.saved)global.includeSeparatedMasterInPinnedSelectionV225?.(ids[0],ids[0],change.rows.filter(function(row){return previewIdsV225.has(String(row.propertyId));}).map(function(row){return row.propertyId;}));paintMutationV225();}}};
  }
  function overlayStateV225(row){
    var change=stateChangesV225.get(String(row.propertyId));
    if(!change||change.account!==owner())return row;
    var canonical=controller?.snapshot()?.byId.get(String(row.propertyId));
    if(change.saved&&canonical&&(canonical.sourceSnapshotKey!==change.proof||canonical.state===change.state)){stateChangesV225.delete(String(row.propertyId));return row;}
    return Object.assign({},row,{state:change.state});
  }
  function paintStatePendingV225(){
    document.querySelectorAll('#list .item[data-property-id]').forEach(function(card){
      var change=stateChangesV225.get(card.dataset.propertyId),pending=change?.account===owner()&&change.pending;
      var source=sourcePreviewV225(card.__listItemV132);if(source){pending=true;change={state:source.label+(source.saved?' 저장됨 · 연결 확인':'')};card.dataset.sourcePendingV225='';card.inert=true;}
      else if(card.hasAttribute('data-source-pending-v225')){delete card.dataset.sourcePendingV225;card.inert=false;}
      var label=card.querySelector('[data-state-saving-v225]');
      card.toggleAttribute('aria-busy',!!pending);
      if(!pending){label?.remove();return;}
      if(!label){label=document.createElement('span');label.dataset.stateSavingV225='';label.setAttribute('role','status');card.prepend(label);}
      label.textContent=change.state+(source?.saved?' 중':' 저장 중');
    });
  }
  async function setSelectedStateV225(next,onlyIds){
    if(!active()||!['보류','확인','미확인','계약완료'].includes(next))return false;
    var account=owner(),rows=onlyIds?onlyIds.map(function(id){return controller.snapshot().byId.get(String(id));}).filter(Boolean):selectedRows();
    rows=rows.map(function(row){return overlayStateV225(controller.snapshot().byId.get(String(row.propertyId))||row);});
    rows=rows.filter(function(row){return row.state!=='계약완료';});
    if(!rows.length){global.alert('처리할 매물을 선택해 주세요.');return false;}
    rows=rows.filter(function(row){return !stateChangesV225.get(String(row.propertyId))?.pending&&!Array.from(sourceChangesV225.values()).some(function(change){return change.account===account&&change.ids.includes(String(row.propertyId));})&&!global.originalMetadataMutationPendingV1?.(row);});
    if(!rows.length||rows.some(function(row){return !row.sourceSnapshotKey;}))return false;
    if(next==='계약완료'&&!global.confirm(rows.length===1?'정말 거래완료 하시겠습니까?':'선택한 '+rows.length+'개 매물을 정말 거래완료 하시겠습니까?'))return false;
    var share=next==='확인'?global.JSVisitKakaoShareV101?.capture(rows):null,end=beginVerificationBatchV210(),saved=[],failed=[],cursor=0;
    var jobs=rows.map(function(row){var id=String(row.propertyId),entry={id:id,account:account,proof:row.sourceSnapshotKey,before:row.state||'',state:next,pending:true,saved:false,previous:stateChangesV225.get(id)};stateChangesV225.set(entry.id,entry);return entry;});
    paintMutationV225();
    var status=document.getElementById('status');if(status)status.textContent=rows.length+'개 '+next+' 저장 중';
    try{await Promise.all(Array.from({length:Math.min(3,jobs.length)},async function(){while(cursor<jobs.length){
      var entry=jobs[cursor++],requestId='state-v225-'+global.crypto.randomUUID(),original=Array(13).fill(null),releaseSlot=await stateSlotV225();original[12]=entry.before;
      try{
        if(owner()!==account)throw new Error('저장 계정이 변경되었습니다.');
        var receipt;
        try{receipt=await global.postSafeMutationV654('updateProperty',{requestId:requestId,expectedAccountEmail:account,key:{propertyId:entry.id},originalValues:original,editedFields:['state'],updated:{state:next}});}
        catch(error){var check=await global.JSDataAccessV6.read('mutationStatus',{requestId:requestId},{cache:'no-store'}).catch(function(){return null;});receipt=check?.ready?(check.result?.result||check.result):null;if(!receipt)throw error;}
        if(receipt?.persisted!==true||receipt.queued||String(receipt.propertyId)!==entry.id||receipt.updated?.state!==next)throw new Error('저장 확인 실패');
        saved.push(entry.id);entry.saved=true;entry.pending=false;entry.previous=null;
        if(owner()!==account)continue;
        var item=master(entry.id);if(item)item.state=next;
        try{Promise.resolve(global.JSInitialListingsCacheV1?.commitItem(item||{propertyId:entry.id},receipt)).catch(function(error){console.warn('상태 저장 후 기기 캐시 갱신 지연',error.message);});}
        catch(error){console.warn('상태 저장 후 기기 캐시 갱신 지연',error.message);}
      }catch(error){failed.push(entry.id);if(stateChangesV225.get(entry.id)===entry){if(entry.previous?.account===account)stateChangesV225.set(entry.id,entry.previous);else stateChangesV225.delete(entry.id);}console.warn('선택 매물 상태 저장 확인 지연',error.message);}
      finally{releaseSlot();if(owner()===account){paintMutationV225();}}
    }}));}finally{end();}
    if(owner()!==account)return false;
    global.selectedPrintKeys=(global.selectedPrintKeys||[]).filter(function(key){return !rows.some(function(row){return saved.includes(String(row.propertyId))&&global.actionSelectionKeyV660(row)===key;});});
    paintMutationV225();global.updatePrintSelectedButton?.();
    if(status)status.textContent=saved.length+'개 '+next+' 저장 완료'+(failed.length?' · '+failed.length+'개 저장 확인 필요':'');
    if(failed.length)global.alert(failed.length+'개 매물은 저장 결과를 확인하지 못했습니다. 선택은 유지됩니다.');
    else if(share)try{global.JSVisitKakaoShareV101.open(share);}catch{}
    return failed.length===0;
  }
  function measureFilterPaintV220(view){
    var metric=filterPaintV220;
    if(!metric||metric.signature!==view.signature||!view.fresh||view.overridden)return;
    function current(){return filterPaintV220===metric&&controller?.snapshot()===view&&owner()===metric.account&&storageEpoch()===metric.fence;}
    requestAnimationFrame(function(){
      if(!current())return;
      var root=document.documentElement,images=Array.from(document.querySelectorAll('#list .item img[src]')).filter(function(img){return img.getBoundingClientRect().width>0;}).slice(0,6);
      root.dataset.queryFilterListMsV220=String(Math.round(performance.now()-metric.started));
      root.dataset.queryFilterPhotoCountV220=String(images.length);
      if(!images.length){root.dataset.queryFilterPaintV220='list-only';return;}
      Promise.all(images.map(function(img){return img.decode?img.decode():img.complete?Promise.resolve():Promise.reject();})).then(function(){
        requestAnimationFrame(function(){if(!current()||!images.every(function(img){return img.isConnected&&img.complete&&img.naturalWidth>0;}))return;
          root.dataset.queryFilterPhotosMsV220=String(Math.round(performance.now()-metric.started));root.dataset.queryFilterPaintV220='decoded';});
      }).catch(function(){if(current())root.dataset.queryFilterPaintV220='photo-unavailable';});
    });
  }
  function freshness(value){
    document.documentElement.dataset.queryFreshV152=value;
    var badge=document.getElementById('queryFreshnessV152'),head=document.querySelector('.map-list-panel-head-v1');
    // Routine background validation needs no user action. Only an actual
    // failed verification needs a visible distinction from current data.
    // Keep the diagnostic state above; hiding a badge is not a speed claim.
    if(value!=='unverified'){badge?.remove();return;}
    if(!head)return;
    if(!badge){badge=document.createElement('span');badge.id='queryFreshnessV152';
      badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');
      badge.style.cssText='font-size:11px;color:#64748b;white-space:nowrap';
      head.insertBefore(badge,head.lastElementChild);}
    badge.textContent='최신 확인 지연';
    badge.title='최신 정보 확인이 지연되어 마지막으로 받은 자료를 표시합니다. 자동으로 다시 확인합니다.';
  }
  function enabled(){return global.JSQueryListingsEnabledV152===true;}
  function active(){return enabled()&&!!controller?.snapshot();}
  function owner(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function epochKey(){return 'js-query-epoch-v152:'+owner();}
  function storageEpoch(){try{return localStorage.getItem(epochKey())||'';}catch{return '';}}
  function spec(){var filters={},mode=global.JSListingTradeV1?.getMode()||'lease';inputs.forEach(function(id){
      var value=id==='sortFilter'?'latest':String(document.getElementById(id)?.value||'');
      // A comma-formatted price must not reuse a pre-fix unbounded query cache.
      filters[id]=mode!=='lease'&&/^(min|max)Deposit$/.test(id)?value.replace(/,/g,''):value;
    });
    return {mode:mode,filters:filters,hideDone:global.hideDone!==false,
      doneOnly:global.doneOnly===true,gongsilOnly:global.gongsilOnly===true,newListingDays:Number(global.newListingDays||0)};}
  function master(id){return(global.allItems||[]).find(function(item){return String(item.propertyId)===String(id);});}
  async function pointRead(ids){
    // A delayed media/card callback can outlive its temporary split row.
    // Temporary UI identities are never valid master lookup or write targets.
    if(ids.some(function(id){return previewIdsV225.has(String(id));}))throw Object.assign(new Error('임시 표시의 상세 조회를 취소했습니다.'),{code:'QUERY_SUPERSEDED'});
    var prepared=ids.length===1&&detailPreparedV230.get(String(ids[0]));
    var current=controller?.snapshot();
    if(prepared&&prepared.view.signature===current?.signature&&prepared.view.revision===current.revision&&prepared.account===owner()&&prepared.fence===storageEpoch()&&prepared.proof===current.byId.get(String(ids[0]))?.sourceSnapshotKey){try{return await prepared.promise;}catch{}}
    for(var attempt=0;attempt<2;attempt++)try{return await global.JSDataAccessV6.read('listingOriginals',{ids:ids.join(',')},{cache:'no-store'});}
    catch(error){if(attempt||error.status===401||error.status===403||!(error.retryable||error.status>=500||error.name==='TypeError'||error.name==='TimeoutError'))throw error;
      await new Promise(function(resolve){setTimeout(resolve,200);});}
  }
  function locate(view){view.rows.forEach(function(row){
    row.latlng=Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)&&global.kakao?.maps?.LatLng?
      new global.kakao.maps.LatLng(row.latitude,row.longitude):null;
    history.set(row.propertyId,row);
  });while(history.size>40000)history.delete(history.keys().next().value);indexView=view;}
  function localRows(view,options){
    options=options||{};
    var rows=view?.rows||[],allowed=null;
    if(confirmed.size)rows=rows.flatMap(function(row){
      if(!confirmed.has(row.propertyId))return[row];
      var current=master(row.propertyId);return current?global.getFilteredItems({items:[current],queryLegacyV152:true,ignoreMapBounds:true,includeUnlocated:true}):[row];
    });
    rows=overlaySourcesV225(rows.map(overlayStateV225));requestAnimationFrame(paintStatePendingV225);
    var availability=options.availabilityView||(options.ignoreDone?'all':view?.spec?.doneOnly?'completed':view?.spec?.hideDone===false?'all':'active');
    if(availability==='active')rows=rows.filter(function(row){var change=stateChangesV225.get(String(row.propertyId));return !(change?.account===owner()&&change.state==='계약완료');});
    if(Array.isArray(options.items)){
      allowed=new Set();options.items.forEach(function(item){(item.wholeBuildingMembersV55||[item.propertyId]).forEach(function(id){allowed.add(String(id));});});
      sourceChangesV225.forEach(function(change){if(change.account===owner()&&change.signature===view.signature&&change.ids.some(function(id){return allowed.has(id);}))change.rows.forEach(function(row){if(!change.ids.includes(String(row.propertyId)))allowed.add(String(row.propertyId));});});
      rows=rows.filter(function(row){return allowed.has(row.propertyId);});
    }
    return global.getFilteredItems(Object.assign({},options,{items:rows,queryLegacyV152:true,preProjectedQueryV152:true,
      querySortV152:String(document.getElementById('sortFilter')?.value||'latest'),
      queryResortV152:confirmed.size>0||view?.overridden===true||String(document.getElementById('sortFilter')?.value||'latest')!=='latest',availabilityView:options.availabilityView||
        (view?.spec?.doneOnly?'completed':view?.spec?.hideDone===false?'all':'active')}));
  }
  function idsFor(items){var ids=[];items.filter(function(item){return !sourcePreviewV225(item);}).forEach(function(item){(item.wholeBuildingMembersV55||[item.propertyId]).forEach(function(id){
    id=String(id);if(id&&!previewIdsV225.has(id)&&ids.indexOf(id)<0)ids.push(id);
  });});return ids;}
  function initialIds(view){return idsFor(listTargets(localRows(view)));}
  function readOnlyCardViewV220(view){var packet=view?.packet;return packet?.cardProjectionV157===true&&
    !!(packet.numericCatalogV177||packet.numericStoredV216||packet.numericCatalogDeferredV217||packet.numericCatalogDeferredV220||packet.numericLocalV177);}
  function listTargets(items){
    var size=typeof global.getListRenderChunkSize==='function'?global.getListRenderChunkSize():global.innerWidth<=768?4:6;
    var start=Number(global.listRenderStart||0),targets=items.slice(0,size).concat(items.slice(start,start+size));
    if(typeof global.captureListReadingAnchorV29==='function'&&typeof global.findListReadingAnchorIndexV48==='function'){
      var anchor=global.captureListReadingAnchorV29(items),index=anchor?global.findListReadingAnchorIndexV48(items,anchor):-1;
      if(index>=0)targets=targets.concat(items.slice(Math.max(0,index-size),index+size));
    }
    return targets;
  }
  function signalFavorites(){global.dispatchEvent(new CustomEvent('js-v6-list-store-change',{detail:{type:'favorite',source:'query-read-v152'}}));}
  async function remoteQuery(value){
    var started=global.performance?.now?.()||Date.now();
    document.documentElement.dataset.queryNetworkStateV154='reading';
    var account=owner(),epoch=storageEpoch(),signature=JSON.stringify(value),saved=null;
    try {
      var current=controller?.snapshot();
      if(current?.signature===signature&&ownedPacketV193(current.packet))saved={account:account,signature:signature,packet:current.packet,
        cacheEpochV152:current.packet.clientCacheEpochV152,numericFenceV216:current.packet.numericFenceV216};
      else saved=initialCacheWarm?.account===account&&initialCacheWarm.signature===signature?await initialCacheWarm.promise:await cache.read(account,signature);
      if(saved?.account!==account||saved.signature!==signature||!saved.packet?.fields?.includes('thumbnailV8'))saved=null;
      if(saved){
        // Restore the small navigation packet first. The advertisement catalog
        // is a separate atomic cache entry and never gates the cached first paint.
        global.JSQueryCollectionV152.decode(saved.packet);
      }
    }catch{saved=null;}
    if(account!==owner()||epoch!==storageEpoch())throw new Error('목록 준비 중 저장 상태가 변경되었습니다.');
    if(value.mode!==spec().mode)throw Object.assign(new Error('이전 시장의 목록 준비를 취소했습니다.'),{name:'AbortError'});
    var params={spec:signature};if(saved){params.since=saved.packet.revision;params.fields=JSON.stringify(saved.packet.fields);}
    if(value.hideDone!==false&&!value.doneOnly&&!value.gongsilOnly&&!value.newListingDays&&
      !Object.entries(value.filters||{}).some(function(pair){return pair[1]&&pair[0]!=='sortFilter';}))params.navigation='228';
    // Explicit cancellation opts out of the generic data-access deduper. Keep
    // identical reads in this account/save fence shared, including a bulk
    // receipt's timer and batch-end refresh arriving in the same task.
    var navigationKeyV228=JSON.stringify([account,epoch,params]);
    var existingNavigationV228=Array.from(navigationReadsV228).find(function(job){return job.key===navigationKeyV228&&!job.controller.signal.aborted;});
    if(existingNavigationV228)return existingNavigationV228.promise;
    var navigationJobV228={mode:value.mode,account:account,fence:epoch,key:navigationKeyV228,controller:new AbortController()};navigationReadsV228.add(navigationJobV228);
    navigationJobV228.promise=global.JSDataAccessV6.read('listingQuery',params,{cache:'no-store',priority:'high',signal:navigationJobV228.controller.signal}).then(async function(packet){
      if(packet?.queryDeltaV160===true){
        try {packet=global.JSQueryCollectionV152.applyDeltaV160(saved.packet,packet);
          document.documentElement.dataset.queryTransferV160=packet.revision===saved.packet.revision?'unchanged':'delta';
          if(!Object.entries(value.filters).some(function(pair){return pair[1]&&pair[0]!=='sortFilter';})&&!packet.numericCatalogV177)
            packet=Object.assign({},packet,{numericCatalogDeferredV217:true});
        }catch{packet=await global.JSDataAccessV6.read('listingQuery',{spec:signature,...(params.navigation?{navigation:params.navigation}:{})},{cache:'no-store',priority:'high',signal:navigationJobV228.controller.signal});document.documentElement.dataset.queryTransferV160='full-after-invalid-delta';}
      }else document.documentElement.dataset.queryTransferV160='full';
      document.documentElement.dataset.queryNetworkMsV154=String(Math.round((global.performance?.now?.()||Date.now())-started));
      document.documentElement.dataset.queryNetworkStateV154='received';return packet;
    },function(error){if(!navigationJobV228.controller.signal.aborted)document.documentElement.dataset.queryNetworkStateV154='failed';throw error;}).finally(function(){navigationReadsV228.delete(navigationJobV228);});
    return navigationJobV228.promise;
  }
  // A complete default catalog contains each advertisement's effective display
  // conditions. It is read-only and belongs to one account/revision/save fence.
  var numericCatalogV177=null,projectionJobsV220=new Set();
  function installNumericV177(view){
    if(numericCatalogV177?.revision!==view.revision)numericCatalogV177=null;
    document.documentElement.dataset.queryNumericStateV177=numericCatalogV177?'ready':'absent';
    if(!view.packet.numericCatalogV177)return;
    numericCatalogV177=null;
    if(!view.fresh||view.overridden)return;
    try{var prepared=global.JSQueryNumericV177?.prepare(view.packet);
      if(prepared)document.documentElement.dataset.queryNumericStateV177='ready';
      if(prepared)numericCatalogV177={prepared:prepared,revision:view.revision,account:owner(),fence:storageEpoch()};
    }catch(error){console.warn('광고별 필터 준비 검증 실패',error.message);}
  }
  async function completeProjectionV217(view,current){
    var deferred=view.packet.numericCatalogDeferredV217===true;
    if(!deferred&&(view.packet.numericCatalogDeferredV220!==true||view.packet.numericCatalogV177||numericCatalogV177?.revision===view.revision||!global.JSQueryNumericV177?.supported(view.spec)))return;
    var account=owner(),fence=storageEpoch(),preparationController=controller;
    var job=JSON.stringify([account,fence,view.spec.mode,view.revision]);
    if(projectionJobsV220.has(job))return;
    projectionJobsV220.add(job);
    var projectionControllerV228=new AbortController();projectionReadsV228.set(job,{mode:view.spec.mode,account:account,fence:fence,controller:projectionControllerV228});
    try{
    // A filter changes the controller token, not the authority of the complete
    // market catalog. Keep that useful read only while its account, save fence,
    // market and verified revision are still the current authority.
    function eligible(){var active=controller?.snapshot();return controller===preparationController&&
      account===owner()&&fence===storageEpoch()&&spec().mode===view.spec.mode&&
      view.fresh&&!view.overridden&&active?.fresh&&!active.overridden&&active.revision===view.revision;}
    document.documentElement.dataset.queryNumericStateV177='preparing';
    // An unchanged delta has already verified this small navigation packet.
    // Prepare its separately persisted catalog after paint, never on the
    // navigation/refresh critical path. The catalog keeps its own save fence.
    if(deferred&&view.packet.numericStoredV216){
      var cached=await cachedCatalogV216({packet:view.packet,cacheEpochV152:fence},account,view.signature);
      if(!eligible())return;
      if(cached.packet.numericCatalogV177){Object.assign(view.packet,cached.packet);installNumericV177(view);
        if(numericCatalogV177){delete view.packet.numericCatalogDeferredV217;document.documentElement.dataset.queryNumericPreparationV220='cached-ready';return true;}}
    }
    // Give actual first-window images priority over the large filter download.
    var images=Array.from(document.querySelectorAll('#list img[src]')).slice(0,6);
    await Promise.race([Promise.allSettled(images.map(function(img){return img.decode?img.decode():Promise.resolve();})),
      new Promise(function(resolve){setTimeout(resolve,500);})]);
    if(!eligible()){document.documentElement.dataset.queryNumericPreparationV220='authority-before-read';return;}
    var baseSpec=Object.assign({},view.spec,{filters:Object.fromEntries(Object.keys(view.spec.filters).map(function(key){return[key,key==='sortFilter'?'latest':''];}))});
    var baseSignature=JSON.stringify(baseSpec);
    var packet=await global.JSDataAccessV6.read('listingQuery',{spec:baseSignature},{cache:'no-store',signal:projectionControllerV228.signal,priority:'low'});
    if(!eligible()){document.documentElement.dataset.queryNumericPreparationV220='authority-after-read';return;}
    var preparedView=global.JSQueryCollectionV152.decode(packet);
    // The follow-up can prepare filters only for this exact complete view.
    // A changed revision is handled by the normal next authoritative query.
    if(packet.revision!==view.revision||deferred&&(JSON.stringify(packet.fields)!==JSON.stringify(view.packet.fields)||
      JSON.stringify(packet.rows)!==JSON.stringify(view.packet.rows))){document.documentElement.dataset.queryNumericPreparationV220='basis-changed';return;}
    // Keep the registered navigation object: base views and their owner proof
    // refer to this exact packet while the optional catalog is prepared.
    if(deferred){Object.assign(view.packet,packet,{clientCacheEpochV152:fence});delete view.packet.numericCatalogDeferredV217;preparedView=view;}
    else {packet.clientCacheEpochV152=fence;Object.assign(preparedView,{signature:baseSignature,spec:baseSpec,fresh:true,overridden:false});}
    installNumericV177(preparedView);
    if(!numericCatalogV177){document.documentElement.dataset.queryNumericPreparationV220='catalog-invalid';return;}
    document.documentElement.dataset.queryNumericPreparationV220='ready';
    parcelOwnersV193.set(preparedView.packet,account);rememberBase(baseSignature,preparedView.packet);
    // The controller only stores its current selection. Persist a detached
    // default catalog without capturing the filtered UI as a default preview.
    if(!current()||!deferred){
      await cache.writeCatalogV220(account,preparedView,eligible);
      if(eligible()&&numericPacketV177(spec())&&JSON.stringify(spec())!==view.signature){
        loading=null;load(true,false);
      }
    }
    return true;
    }finally{projectionJobsV220.delete(job);projectionReadsV228.delete(job);}
  }
  function numericPacketV177(value){
    var saved=numericCatalogV177,current=controller?.snapshot();
    var reason=!saved?'absent':!current?.fresh||current.overridden?'unverified':current.revision!==saved.revision?'revision':saved.account!==owner()?'account':saved.fence!==storageEpoch()?'save-fence':'';
    if(reason){document.documentElement.dataset.queryNumericMissV220=reason;return null;}
    var signature=JSON.stringify(value);
    if(saved.signature===signature)return saved.packet;
    saved.signature=signature;saved.packet=global.JSQueryNumericV177?.filter(saved.prepared,value)||null;document.documentElement.dataset.queryNumericMissV220=saved.packet?'hit':'unsupported';return saved.packet;
  }
  function ownedPacketV193(packet){return!!packet&&parcelOwnersV193.get(packet)===owner()&&String(packet.clientCacheEpochV152||'')===storageEpoch();}
  function localParcelPacketV193(value){
    if(value.mode!=='building_sale')return null;
    var current=controller?.snapshot();if(!current||current.spec.mode!==value.mode)return null;
    var groups=String(value.filters.keyword||'').split(',').map(function(group){return group.trim();}).filter(Boolean);
    if(!groups.length||Object.keys(value.filters).some(function(name){return name!=='keyword'&&name!=='sortFilter'&&value.filters[name];}))return null;
    var exact=groups.map(function(group){return global.parseExactJibunKeyword?.(group)||global.parseBuildingParcelKeywordV193?.(group);});
    if(exact.some(function(group){return!group;}))return null;
    var base=Object.assign({},value,{filters:Object.assign({},value.filters,{keyword:''})}),key=JSON.stringify(base);
    var stored=baseViews.get(key);if(!stored)return null;
    var packet=current.signature===key?current.packet:stored;
    if(!ownedPacketV193(packet)||packet.revision!==current.revision)return null;
    var addressIndex=packet.fields.indexOf('address');if(addressIndex<0)return null;
    var rows=packet.rows.filter(function(values){return exact.some(function(group){return global.matchesExactJibunAddress({address:values[addressIndex]},group);});});
    return Object.assign({},packet,{rows:rows,total:rows.length,numericCatalogV177:undefined,parcelLocalV193:true,
      recentQueryBaseV154:!current.fresh||current.overridden===true||packet.perPropertyOverridesV152===true});
  }
  async function readQuery(value){
    var queryOwnerV193=owner(),queryFenceV193=storageEpoch();
    var numeric=numericPacketV177(value);if(numeric)return numeric;
    var parcel=localParcelPacketV193(value);if(parcel)return parcel;
    if(initialWarm){var warm=initialWarm;initialWarm=null;
      if(warm.owner===owner()&&warm.epoch===storageEpoch()&&warm.signature===JSON.stringify(value))return warm.promise;}
    var current=controller?.snapshot(),cached=baseViews.get(JSON.stringify(value));
    if(current?.fresh&&!current.overridden&&current.signature!==JSON.stringify(value)&&ownedPacketV193(cached)&&cached.revision===current.revision)return cached;
    var keyword=String(value.filters.keyword||'').trim(),groups=keyword.split(',').map(function(part){return part.trim();}).filter(Boolean);
    var exact=groups.length&&typeof global.parseExactJibunKeyword==='function'&&typeof global.matchesExactJibunAddress==='function'&&
      Object.keys(value.filters).every(function(name){return name==='keyword'||name==='sortFilter'||!value.filters[name];})?
      groups.map(function(group){return global.parseExactJibunKeyword(group)||(value.mode==='building_sale'?global.parseBuildingParcelKeywordV193?.(group):null);}):[];
    if(!exact.length||exact.some(function(group){return!group;}))return remoteQuery(value);
    // Address-only queries cannot choose a different original within a master.
    // Use the same exact-parcel matcher against the verified base index.
    var base=Object.assign({},value,{filters:Object.assign({},value.filters,{keyword:''})}),key=JSON.stringify(base),packet=baseViews.get(key),recent=false;
    if(!ownedPacketV193(packet)||packet.revision!==controller?.snapshot()?.revision){
      packet=await remoteQuery(base);
      global.JSQueryCollectionV152.decode(packet);if(queryOwnerV193===owner()&&queryFenceV193===storageEpoch())rememberBase(key,packet);
    }else recent=!current?.fresh||current.overridden===true;
    var addressIndex=packet.fields.indexOf('address');
    if(addressIndex<0)throw new Error('목록의 지번 항목이 없습니다.');
    var rows=packet.rows.filter(function(values){return exact.some(function(group){return global.matchesExactJibunAddress({address:values[addressIndex]},group);});});
    return Object.assign({},packet,{rows:rows,total:rows.length,recentQueryBaseV154:recent});
  }
  function preserveType(value){var select=document.getElementById('typeFilter');if(!select||!value)return;
    if(!Array.from(select.options).some(function(option){return option.value===value;}))select.add(new Option(value,value));
    select.value=value;
  }
  function reconcile(view,result){
    if(view.signature!==JSON.stringify(spec()))return false;
    var replacements=new Map(),removed=new Set(result.missingIds||[]);
    result.items.forEach(function(raw){
      var id=String(raw.property_id||raw.id),item=master(id);
      var projected=global.getFilteredItems({items:[item],queryLegacyV152:true,ignoreMapBounds:true,
        includeUnlocated:true,ignoreFavoriteV152:true});
      if(!projected.length){removed.add(id);return;}
      var row=Object.assign({},projected[0],{queryRowV152:true,
        queryGroupKeyV152:global.JSUnifiedListingsV8.queryGroupKeyV152(item),
        queryPendingVisitV152:global.isFieldVisitItem(item)===true,
        queryConfirmedVisitV152:global.isConfirmedVisitItem(item)===true,
        queryMatchedOriginalCountV152:(projected[0].unifiedDisplayOriginalsV2||[]).length});
      replacements.set(id,row);
    });
    var existing=new Set(view.rows.map(function(row){return row.propertyId;}));
    view.rows=view.rows.filter(function(row){return!removed.has(row.propertyId);}).map(function(row){return replacements.get(row.propertyId)||row;});
    replacements.forEach(function(row,id){if(!existing.has(id))view.rows.push(row);});
    view.byId=new Map(view.rows.map(function(row){return[row.propertyId,row];}));
    view.packet=Object.assign({},view.packet,{total:view.rows.length,perPropertyOverridesV152:true,
      rows:view.rows.map(function(row){return view.packet.fields.map(function(field){return row[field]??null;});})});
    parcelOwnersV193.set(view.packet,owner());numericCatalogV177=null;view.overridden=true;view.fresh=false;if(!view.spec.filters.keyword&&Object.keys(view.spec.filters).every(function(name){return name==='sortFilter'||!view.spec.filters[name];}))rememberBase(view.signature,view.packet);locate(view);freshness('per-property');return true;
  }
  function applyPoints(result,context){var selected=document.getElementById('typeFilter')?.value;
    var before=(global.allItems||[]).slice(),applied=global.JSListingRefreshV1.applyScoped(result,context)===true;
    if(applied){result.items.forEach(function(raw){var id=String(raw.property_id||raw.id),nav=indexView?.byId.get(id),item=master(id),receipt=raw.savedReceiptV154;
      if(item&&receipt?.persisted===true&&!receipt.queued&&String(receipt.propertyId||'')===id)
        global.JSUnifiedListingsV8?.acceptSavedFinancialEdit?.(item,receipt);
      // The point API's batch ordinal is not the CSV/query row ordinal.
      // Preserve the verified view identity used by checks/print/merge, while
      // all writes continue to use the exact immutable property ID.
      if(nav&&item)item.sheetRow=nav.sheetRow;
      if(item&&String(raw.source_snapshot_key||'')===String(item.sourceSnapshotKey||''))Object.defineProperty(item,'editBaselineV226',{
        configurable:true,writable:true,value:{account:owner(),fence:storageEpoch(),row:Object.assign({},raw)}});
    });global.remapPassiveListActionSelectionsV48?.(before,global.allItems||[]);}
    preserveType(selected);return applied;
  }
  function rememberBase(key,packet){parcelOwnersV193.set(packet,owner());baseViews.delete(key);baseViews.set(key,packet);while(baseViews.size>3)baseViews.delete(baseViews.keys().next().value);}
  var database=null;
  function db(){if(database)return database;database=new Promise(function(resolve){
    if(!global.indexedDB)return resolve(null);
    var request=indexedDB.open('js-query-scopes-v152',1),timer=setTimeout(function(){resolve(null);},1500);
    request.onupgradeneeded=function(){if(!request.result.objectStoreNames.contains('views'))request.result.createObjectStore('views');};
    request.onsuccess=function(){clearTimeout(timer);resolve(request.result);};request.onerror=function(){clearTimeout(timer);resolve(null);};
  });return database;}
  function cacheKey(account,signature){
    var value=JSON.parse(signature),filtered=value.hideDone===false||value.doneOnly||value.gongsilOnly||value.newListingDays||
      Object.entries(value.filters||{}).some(function(pair){return pair[1]&&!(pair[0]==='sortFilter'&&pair[1]==='latest');});
    return account+'|'+value.mode+(filtered?'|filtered':'');
  }
  function parcelCacheV193(value){
    return value.mode!=='building_sale'||!String(value.filters?.keyword||'').split(',').some(function(group){return /^\d+-\d+$/.test(group.replace(/\s+/g,''));});
  }
  async function cachedCatalogV216(value,account,signature){
    if(!value.packet?.numericStoredV216||value.packet.numericCatalogV177)return value;
    var database=await db();if(!database)return value;
    var stored=await new Promise(function(resolve){
      var tx=database.transaction('views','readonly'),read=tx.objectStore('views').get(cacheKey(account,signature)+'|numeric-v216');
      read.onsuccess=function(){resolve(read.result);};read.onerror=tx.onabort=function(){resolve(null);};
    });
    if(account!==owner()||value.cacheEpochV152!==storageEpoch()||stored?.account!==account||stored.signature!==signature||
      stored.cacheEpochV152!==(value.numericFenceV216??value.packet.numericFenceV216??value.cacheEpochV152)||stored.revision!==value.packet.revision||
      stored.fields&&JSON.stringify(stored.fields)!==JSON.stringify(value.packet.fields))return value;
    return Object.assign({},value,{packet:Object.assign({},value.packet,{numericCatalogV177:stored.catalog})});
  }
  var cache={
    read:async function(account,signature){
      // A prepared market already has a validated, account/fence-bound index.
      // Switching back must not clone the same large IndexedDB entry twice
      // before painting. This remains a recent read-only view: the independent
      // network revision check still decides freshness and writable points.
      var prepared=baseViews.get(signature);
      if(account===owner()&&ownedPacketV193(prepared))return {
        kind:'query-scope-v152',completeCatalog:false,account:account,signature:signature,
        cacheEpochV152:storageEpoch(),packet:prepared,points:[],savedAt:Date.now()
      };
      if(initialCacheWarm){var warm=initialCacheWarm;initialCacheWarm=null;
        if(warm.account===account&&warm.signature===signature&&warm.epoch===storageEpoch())return warm.promise;}
      var database=await db();if(!database)return null;
      var key;try{key=cacheKey(account,signature);}catch{return null;}
      return new Promise(function(resolve){var tx=database.transaction('views','readonly'),request=tx.objectStore('views').get(key),finished=false;
        var timer=setTimeout(function(){finish(null);},500);
        function finish(value){if(finished)return;finished=true;clearTimeout(timer);resolve(value);}
        request.onsuccess=function(){var value=request.result;finish(value&&value.cacheEpochV152===storageEpoch()&&(JSON.parse(signature).mode!=="building_sale"||value.saleProjectionV184===184)&&(parcelCacheV193(JSON.parse(signature))||value.parcelSearchV193===193)?value:null);};request.onerror=function(){finish(null);};tx.onabort=function(){finish(null);};});},
    write:async function(account,value,current){var database=await db();if(!database||!current()||owner()!==account)return false;
      value.preview=global.JSQueryPreviewV154?.capture(value)||null;
      // Save the complete read-only navigation index even if optional editable
      // point hydration or the current viewport has no default preview yet.
      // Its separate first-frame entry can only be replaced by the default view.
      var key=cacheKey(account,value.signature);
      return new Promise(function(resolve){var tx=database.transaction('views','readwrite');
        value.cacheEpochV152=value.packet.clientCacheEpochV152;value.saleProjectionV184=184;value.parcelSearchV193=193;
        if(!current()||owner()!==account||value.cacheEpochV152!==storageEpoch()){tx.abort();resolve(false);return;}
        var store=tx.objectStore('views'),catalog=value.packet.numericCatalogV177;
        function writeNavigation(stored){
          if(!current()||owner()!==account||value.cacheEpochV152!==storageEpoch()){tx.abort();return;}
          var retained=!!catalog||stored?.account===account&&stored.signature===value.signature&&stored.revision===value.packet.revision&&
            stored.cacheEpochV152===value.cacheEpochV152&&JSON.stringify(stored.fields)===JSON.stringify(value.packet.fields);
          if(!retained)store.delete(key+'|numeric-v216');
          store.put(Object.assign({},value,{numericFenceV216:value.cacheEpochV152,
            packet:Object.assign({},value.packet,{numericCatalogV177:undefined,numericStoredV216:retained,numericFenceV216:value.cacheEpochV152})}),key);
        }
        if(catalog){store.put({account:account,signature:value.signature,cacheEpochV152:value.cacheEpochV152,fields:value.packet.fields,
          revision:value.packet.revision,catalog:catalog},key+'|numeric-v216');writeNavigation(null);}
        else{var previous=store.get(key+'|numeric-v216');previous.onsuccess=function(){writeNavigation(previous.result);};}
        var frame=global.JSQueryPreviewV154?.compact(value);
        if(frame&&!key.endsWith('|filtered'))store.put(frame,key+'|first-frame-v216');
        tx.oncomplete=function(){resolve(true);};tx.onerror=tx.onabort=function(){resolve(false);};});},
    writeCatalogV220:async function(account,view,current){var database=await db();if(!database||!current())return false;
      return new Promise(function(resolve){var tx=database.transaction('views','readwrite'),store=tx.objectStore('views'),key=cacheKey(account,view.signature),request=store.get(key);
        request.onsuccess=function(){var value=request.result;
          if(!current()){tx.abort();return;}
          if(!value||value.cacheEpochV152!==storageEpoch()||value.packet.revision!==view.revision||
            JSON.stringify(value.packet.fields)!==JSON.stringify(view.packet.fields)||JSON.stringify(value.packet.rows)!==JSON.stringify(view.packet.rows)){
            value={kind:'query-scope-v152',completeCatalog:false,account:account,signature:view.signature,
              packet:Object.assign({},view.packet,{numericCatalogV177:undefined}),points:[],preview:null,savedAt:Date.now(),
              cacheEpochV152:storageEpoch(),saleProjectionV184:184,parcelSearchV193:193};
          }
          store.put({account:account,signature:view.signature,cacheEpochV152:storageEpoch(),fields:view.packet.fields,
            revision:view.revision,catalog:view.packet.numericCatalogV177},key+'|numeric-v216');
          value.packet.numericStoredV216=true;value.numericFenceV216=storageEpoch();store.put(value,key);
        };
        tx.oncomplete=function(){resolve(true);};tx.onerror=tx.onabort=function(){resolve(false);};});},
    clear:async function(account){var database=await db();if(!database)return;
      return new Promise(function(resolve){var tx=database.transaction('views','readwrite');
        ['lease','building_sale','land_sale'].forEach(function(mode){['','|filtered','|numeric-v216','|filtered|numeric-v216','|first-frame-v216'].forEach(function(suffix){tx.objectStore('views').delete(account+'|'+mode+suffix);});});
        var memoKeys=tx.objectStore('views').getAllKeys();memoKeys.onsuccess=function(){memoKeys.result.filter(function(key){return String(key).startsWith(account+'|memo-v227|');}).forEach(function(key){tx.objectStore('views').delete(key);});};
        tx.oncomplete=tx.onabort=tx.onerror=function(){resolve();};});}
  };
  function setup(){if(controller)return controller;
    controller=global.JSQueryCollectionV152.create({account:owner,fence:storageEpoch,master:master,capture:function(){return global.JSListingRefreshV1.captureScopedRead();},
      reconcile:reconcile,canReconcile:function(view){return view.signature===JSON.stringify(spec());},
      projectBeforeHydrate:function(view){return view.rows.every(function(row){return row.queryRowV152&&/^sha256-v1:[a-f0-9]{64}$/.test(row.sourceSnapshotKey);});},
      deferProjectedHydration:readOnlyCardViewV220,
      completeProjection:completeProjectionV217,backgroundProjectionV228:true,
      readQuery:async function(value){var last,epochAtStart=storageEpoch();
        for(var attempt=0;attempt<2;attempt++)try{var packet=await readQuery(value);return Object.assign({},packet,{clientCacheEpochV152:epochAtStart});}
        catch(error){last=error;if(error.name==='AbortError'||error.status===401||error.status===403)throw error;if(!attempt)await new Promise(function(resolve){setTimeout(resolve,200);});}
        throw last;},readPoints:pointRead,applyPoints:applyPoints,index:locate,initialIds:initialIds,cache:cache,
      commit:function(view,flags){
        if(!flags.cached&&view.fresh)sourceChangesV225.forEach(function(change,token){if(change.saved&&change.account===owner()&&change.mode===view.spec.mode&&change.ids.every(function(id){return !view.byId.has(id)||view.byId.get(id).sourceSnapshotKey!==change.proofs.get(id);}))sourceChangesV225.delete(token);});
        parcelOwnersV193.set(view.packet,owner());indexView=view;confirmed.clear();global.jsInitialFullListingsLoadingV1=false;
        if(view.packet.numericLocalV177!==true)installNumericV177(view);
        if(!view.spec.filters.keyword&&Object.keys(view.spec.filters).every(function(name){return name==='sortFilter'||!view.spec.filters[name];}))rememberBase(view.signature,view.packet);
        global.jsListingsCompleteBaseV1=false;global.jsListingsRevisionV682=view.revision;global.jsListingsDatasetScopeV123='query-v152';
        global.isLoadingSheet=false;global.pendingAutoUpdate=false;
        clearTimeout(retryTimer);if(!flags.cached)retries=0;freshness(flags.cached||view.recent?'checking':view.overridden?'per-property':'verified');
        document.documentElement.dataset.queryRevisionV152=view.revision;
        document.documentElement.dataset.queryMasterCountV152=String(view.rows.length);
        if(typeof global.setListingsLoadStatusV65==='function')global.setListingsLoadStatusV65('ready');
        var selectedType=document.getElementById('typeFilter')?.value;
        global.updateTypeOptions?.(view.rows.concat(global.allItems||[]));preserveType(selectedType);
        var before=(global.allItems||[]).map(function(item){return {propertyId:item.propertyId,key:item.key,sheetRow:item.sheetRow};});
        (global.allItems||[]).forEach(function(item){var nav=view.byId.get(String(item.propertyId));
          if(nav&&nav.sourceSnapshotKey===item.sourceSnapshotKey)item.sheetRow=nav.sheetRow;});
        global.remapPassiveListActionSelectionsV48?.(before,global.allItems||[]);
        var previousPreserve=global.preserveActionSelectionDuringRender;
        global.preserveActionSelectionDuringRender=previousPreserve||publishedSignature===view.signature;
        publishedSignature=view.signature;
        try{global.applyFilter();}finally{global.preserveActionSelectionDuringRender=previousPreserve;}
        measureFilterPaintV220(view);
        global.JSLocalMetricsV1?.markFirstData();signalFavorites();
      },error:function(error,hasData){global.isLoadingSheet=false;global.jsInitialFullListingsLoadingV1=false;
        freshness(hasData?'unverified':'error');
        global.setListingsLoadStatusV65?.(error.status===401||error.status===403?'auth':'error',error);
        if(error.status!==401&&error.status!==403&&retries<4&&navigator.onLine!==false){
          clearTimeout(retryTimer);var signature=JSON.stringify(spec()),account=owner();
          retryTimer=setTimeout(function(){if(owner()===account&&JSON.stringify(spec())===signature&&document.visibilityState!=='hidden')load(true,true);},1000*Math.pow(2,++retries));
        }
      }});return controller;
  }
  function needsQuery(){return enabled()&&Number(global.newListingDays||0)!==1&&
    (!controller?.snapshot()||controller.snapshot().signature!==JSON.stringify(spec()));}
  function hasCurrentData(){var view=controller?.snapshot();return!!view&&view.signature===JSON.stringify(spec());}
  var verificationBatchesV210=0,verificationRefreshV210=false,mergeReadsV211=0;
  function beginVerificationBatchV210(){
    var account=owner(),ended=false;verificationBatchesV210++;
    return function(){if(ended)return;ended=true;verificationBatchesV210--;
      if(!verificationBatchesV210&&verificationRefreshV210){verificationRefreshV210=false;
        if(account===owner()&&enabled())load(true,true);}
    };
  }
  function load(isAuto,force){
    if(!enabled())return Promise.resolve(false);
    if(Number(global.newListingDays||0)===1)return Promise.resolve(true);
    var core=setup(),value=spec(),signature=JSON.stringify(value);
    cancelOtherMarketProjectionV228(value.mode);
    if((force||mergeReadsV211)&&verificationBatchesV210&&hasCurrentData()){verificationRefreshV210=true;return Promise.resolve(true);}
    if(loading&&loading.signature===signature&&!force)return loading.promise;
    if(core.snapshot()?.signature!==signature&&filterPaintV220?.signature!==signature){filterPaintV220={signature:signature,started:performance.now(),account:owner(),fence:storageEpoch()};
      document.documentElement.dataset.queryFilterPaintV220='waiting';delete document.documentElement.dataset.queryFilterListMsV220;delete document.documentElement.dataset.queryFilterPhotosMsV220;}
    if(force){baseViews.clear();numericCatalogV177=null;initialWarm=null;}
    global.isLoadingSheet=true;global.jsListingsCompleteBaseV1=false;
    if(!hasCurrentData()&&!numericPacketV177(value)&&!localParcelPacketV193(value)){
      global.jsInitialFullListingsLoadingV1=true;global.setListingsLoadStatusV65?.('loading');
      if(core.snapshot()){
        global.currentItems=[];global.showList?.([]);global.drawItems?.([]);
        var title=document.getElementById('mapListTitleV1');if(title)title.textContent='선택한 조건의 목록 확인 중';
      }
    }
    var localNumeric=!force&&(numericPacketV177(value)||localParcelPacketV193(value));
    // A just-completed local catalog supersedes a same-condition remote read
    // that may still be waiting. Its late response keeps the normal token guard.
    var task=core.load(value,{force:!!force||!!localNumeric,cache:!localNumeric}).finally(function(){if(loading?.promise===task){loading=null;global.isLoadingSheet=false;
      if(core.snapshot()?.recent)setTimeout(function(){poll();},0);}});
    loading={signature:signature,promise:task};return task;
  }
  function filtered(options){var view=controller?.snapshot();return view&&view.spec.mode!==spec().mode?[]:localRows(view,options);}
  function ready(item){return idsFor([item]).every(function(id){return confirmed.has(id)||controller?.ready(id);});}
  function materialize(item){
    if(sourcePreviewV225(item))return null;
    if(!item?.queryRowV152)return item;
    if(!ready(item))return null;
    var ids=new Set(idsFor([item])),masters=(global.allItems||[]).filter(function(row){return ids.has(String(row.propertyId));});
    var projected=global.getFilteredItems({items:masters,queryLegacyV152:true,ignoreMapBounds:true,includeUnlocated:true});
    var result=projected.find(function(row){return String(row.propertyId)===String(item.propertyId);})||projected[0]||null;
    return result?overlayStateV225(result):null;
  }
  function canRenderSummary(item){
    if(sourcePreviewV225(item))return true;
    var view=controller?.snapshot();
    // Older validated query caches have the same authoritative conditions and
    // own-parent proofs, but no thumbnail scalar. They are still read-only
    // display rows; missing photos remain unknown until their exact read wins.
    return !!(hasCurrentData()&&item?.queryRowV152&&
      idsFor([item]).every(function(id){return view.byId.has(id);})&&view.byId.get(String(item.propertyId))?.sourceSnapshotKey===item.sourceSnapshotKey);
  }
  function prepareDisplayed(items,done){
    if(!items.every(function(item){return ready(item)||canRenderSummary(item);}))return prepare(items,done);
    var view=controller.snapshot(),ids=idsFor(items);
    prepareMediaV159(items);
    queueInteractiveV230(items);
    if(readOnlyCardViewV220(view))return false;
    prepare(items.filter(function(item){return !sourcePreviewV225(item);}),function(){if(view===controller?.snapshot()&&hasCurrentData())global.upgradeQueryCardsV157?.(ids);});
    return false;
  }
  function ensureMediaV159(items){
    var view=controller?.snapshot(),account=owner(),fence=storageEpoch();
    if(!view||!hasCurrentData())return Promise.resolve();
    var rows=items.map(function(item){return view.byId.get(String(item.propertyId));}).filter(function(row){return row&&!row.thumbnailV8&&row.querySelectedPhotoCountV157!==0&&!row.queryMediaResolvedV159;});
    var ids=Array.from(new Set(rows.map(function(row){return row.propertyId;}))).slice(0,48);
    if(!ids.length)return Promise.resolve();
    var jobs=mediaPendingV159.get(view);if(!jobs){jobs=new Map();mediaPendingV159.set(view,jobs);}
    var key=ids.join(',');if(jobs.has(key))return jobs.get(key);
    var expected=new Map(ids.map(function(id){return[id,view.byId.get(id).sourceSnapshotKey];}));
    var task=global.JSDataAccessV6.read('listingQueryMedia',{spec:JSON.stringify(view.spec),ids:key},{cache:'no-store'}).then(function(packet){
      if(controller?.snapshot()!==view||owner()!==account||storageEpoch()!==fence||!hasCurrentData())return;
      if(packet?.ok!==true||packet.version!==159||JSON.stringify(packet.fields)!==JSON.stringify(['propertyId','sourceSnapshotKey','thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'])||
        !Array.isArray(packet.rows)||!Array.isArray(packet.requestedIds)||JSON.stringify(packet.requestedIds)!==JSON.stringify(ids)||!Array.isArray(packet.missingIds))throw new Error('사진 조회 범위가 다릅니다.');
      var seen=new Set();packet.rows.forEach(function(values){
        if(!Array.isArray(values)||values.length!==5||!expected.has(values[0])||seen.has(values[0])||
          typeof values[1]!=='string'||!/^sha256-v1:[a-f0-9]{64}$/.test(values[1])||
          values[2]!=null&&(typeof values[2]!=='string'||values[2].length>8000)||values[3]!=null&&(typeof values[3]!=='string'||values[3].length>200)||
          values[4]!=null&&(!Number.isSafeInteger(values[4])||values[4]<0))throw new Error('사진 원장 연결이 다릅니다.');seen.add(values[0]);
      });
      packet.missingIds.forEach(function(id){if(!expected.has(id)||seen.has(id))throw new Error('사진 누락 범위가 다릅니다.');seen.add(id);});
      if(seen.size!==ids.length)throw new Error('사진 응답이 완전하지 않습니다.');
      packet.rows.forEach(function(values){var row=view.byId.get(values[0]);if(!row||row.sourceSnapshotKey!==expected.get(values[0])||values[1]!==row.sourceSnapshotKey)return;
        row.thumbnailV8=values[2]||'';row.querySelectedOriginalIdV152=values[3]||'';row.querySelectedPhotoCountV157=values[4];row.queryMediaResolvedV159=true;
      });
    }).catch(function(error){if(controller?.snapshot()===view)console.warn('대표 사진 주소 확인 지연',error.message);}).finally(function(){jobs.delete(key);});
    jobs.set(key,task);return task;
  }
  function prepareMediaV159(items){
    var view=controller?.snapshot();global.JSQueryThumbsV159?.prefetch(items,{limit:global.getListRenderChunkSize()});
    ensureMediaV159(items).then(function(){if(view!==controller?.snapshot()||!hasCurrentData())return;
      var current=items.map(function(item){return view.byId.get(String(item.propertyId))||item;});
      global.JSQueryThumbsV159?.prefetch(current,{limit:global.getListRenderChunkSize()});global.refreshQueryThumbnailsV159?.(current);
    });
  }
  function warmClustersV159(clusters){
    if(!hasCurrentData()||global.navigator?.connection?.saveData||/^(?:slow-)?2g$/.test(global.navigator?.connection?.effectiveType||''))return;
    var view=controller.snapshot(),windows=clusters.slice(0,6).map(function(cluster){return(cluster.items||[]).slice(0,global.getListRenderChunkSize());});
    function warm(){if(view!==controller?.snapshot()||!hasCurrentData())return;
      var choices=windows.flatMap(function(rows){return rows.map(function(item){return view.byId.get(String(item.propertyId))||item;}).filter(function(item){return!!global.JSUnifiedListingsV8?.thumbnailDescriptorV159(item).url;}).slice(0,2);});
        global.JSQueryThumbsV159?.prefetch(choices,{background:true,replaceBackground:true});
    }
    warm();ensureMediaV159(windows.flat()).then(function(){if(view!==controller?.snapshot()||!hasCurrentData())return;warm();global.refreshQueryThumbnailsV159?.(windows.flat().map(function(item){return view.byId.get(String(item.propertyId))||item;}));});
  }
  var phoneCardsV171=new Map();
  var memoCardsV227=new Map();
  var interactiveQueueV230=new Map(),interactiveTimerV230=0,interactiveBusyV230=0,detailQueueV230=[],detailBusyV230=false,detailPreparedV230=new Map();
  function sourceGesturePendingV230(){return global.JSUnifiedListingsV8?.hasPendingMoveV225?.()||Array.from(sourceChangesV225.values()).some(function(change){return change.account===owner()&&!change.saved;});}
  function drainDetailsV230(){
    if(detailBusyV230||sourceGesturePendingV230())return;
    while(detailQueueV230.length){
      var job=detailQueueV230.shift(),core=controller;
      if(job.view!==core?.snapshot()||job.account!==owner()||job.fence!==storageEpoch()||!hasCurrentData()||core.ready(String(job.item.propertyId)))continue;
      var id=String(job.item.propertyId),prior=detailPreparedV230.get(id);
      if(prior&&prior.view===job.view&&prior.account===job.account&&prior.fence===job.fence)continue;
      detailBusyV230=true;
      var entry={view:job.view,account:job.account,fence:job.fence,proof:job.item.sourceSnapshotKey,promise:null};
      // Preparation is read-only. Applying an editable master here would race
      // a user's save or another exact read. Foreground hydrate still validates
      // the complete ID/source inventory and captures its own current context.
      entry.promise=global.JSDataAccessV6.read('listingOriginals',{ids:id},{cache:'no-store'}).catch(function(error){if(detailPreparedV230.get(id)===entry)detailPreparedV230.delete(id);throw error;});
      detailPreparedV230.set(id,entry);while(detailPreparedV230.size>12)detailPreparedV230.delete(detailPreparedV230.keys().next().value);
      entry.promise.catch(function(){}).finally(function(){detailBusyV230=false;drainDetailsV230();});return;
    }
  }
  function queueInteractiveV230(items){
    // Prepare only the currently painted window, after its first paint. Touch
    // devices have no hover lead-in. No whole-market reads or image downloads.
    var view=controller?.snapshot(),account=owner(),fence=storageEpoch();
    if(!view||!hasCurrentData()||navigator.connection?.saveData||sourceGesturePendingV230())return;
    detailPreparedV230.forEach(function(entry,key){if(entry.view.signature!==view.signature||entry.view.revision!==view.revision||entry.account!==account||entry.fence!==fence||entry.proof!==view.byId.get(key)?.sourceSnapshotKey)detailPreparedV230.delete(key);else entry.view=view;});
    detailQueueV230=detailQueueV230.filter(function(entry){return entry.view===view&&entry.account===account&&entry.fence===fence;});
    items.slice(0,6).forEach(function(item){if(sourcePreviewV225(item))return;
      var id=String(item.propertyId),key=account+'|'+fence+'|'+id+'|'+item.sourceSnapshotKey;
      if(!interactiveQueueV230.has(key))interactiveQueueV230.set(key,{item:item,view:view,account:account,fence:fence});
    });
    while(interactiveQueueV230.size>12)interactiveQueueV230.delete(interactiveQueueV230.keys().next().value);
    if(!interactiveTimerV230)interactiveTimerV230=setTimeout(drainInteractiveV230,60);
  }
  function drainInteractiveV230(){
    interactiveTimerV230=0;
    if(sourceGesturePendingV230()){interactiveQueueV230.clear();detailQueueV230.length=0;return;}
    while(interactiveBusyV230<2&&interactiveQueueV230.size){
      var key=interactiveQueueV230.keys().next().value,job=interactiveQueueV230.get(key);interactiveQueueV230.delete(key);
      var card=Array.from(document.querySelectorAll('#list .item[data-property-id]')).find(function(node){return node.dataset.propertyId===String(job.item.propertyId);});
      var box=card?.getBoundingClientRect(),listBox=document.getElementById('list')?.getBoundingClientRect();
      if(!box||!listBox||box.bottom<listBox.top||box.top>Math.min(listBox.bottom,innerHeight)||
        job.view!==controller?.snapshot()||job.account!==owner()||job.fence!==storageEpoch()||!hasCurrentData())continue;
      interactiveBusyV230++;
      (function(work){
        var core=controller,hasContacts=work.item.displayValuePresence?.contactsV224||Number(work.item.gongsilContactCountV8)>0||/(공실박스|gongsil)/i.test(String(work.item.source||''));
        var read=hasContacts?phoneCardV171(work.item).promise:readMemoV227(work.item);
        if(readOnlyCardViewV220(work.view)&&!core.ready(String(work.item.propertyId))&&!detailQueueV230.some(function(job){return job.view===work.view&&job.item.propertyId===work.item.propertyId;})){detailQueueV230.push(work);while(detailQueueV230.length>6)detailQueueV230.shift();drainDetailsV230();}
        read.catch(function(){}).finally(function(){interactiveBusyV230--;if(interactiveQueueV230.size&&!interactiveTimerV230)interactiveTimerV230=setTimeout(drainInteractiveV230,0);});
      })(job);
    }
  }
  function warmEditorV227(item){
    if(!hasCurrentData()||controller.ready(String(item.propertyId)))return;
    var core=controller,view=core.snapshot(),account=owner(),fence=storageEpoch();
    core.hydrate([String(item.propertyId)],{snapshot:view}).then(function(){
      if(core===controller&&view===core.snapshot()&&account===owner()&&fence===storageEpoch())return core.persistPrepared();
    }).catch(function(){});
  }
  function memoKeyV227(item){return owner()+'|memo-v227|'+String(item.propertyId)+'|'+String(item.sourceSnapshotKey);}
  function memoCurrentV227(item,account,fence){var row=controller?.snapshot()?.byId.get(String(item.propertyId));return hasCurrentData()&&account===owner()&&fence===storageEpoch()&&row?.sourceSnapshotKey===item.sourceSnapshotKey;}
  function memoItemV227(ref){
    var id=String(ref||'').replace(/^(?:property:|id:)/,''),row=controller?.snapshot()?.byId.get(id);if(!row)return null;
    var entry=memoCardsV227.get(memoKeyV227(row));if(!entry?.value||!memoCurrentV227(row,entry.account,entry.fence))return null;
    // A read-only projection never becomes an editable master or source inventory.
    return Object.assign({},row,{memo:entry.value.memo,source:entry.value.source||row.source});
  }
  function memoEntryV227(item){
    var key=memoKeyV227(item),entry=memoCardsV227.get(key),account=owner(),fence=storageEpoch();
    if(entry&&entry.account===account&&entry.fence===fence)return entry;
    if(memoCardsV227.size>=64)memoCardsV227.delete(memoCardsV227.keys().next().value);
    entry={account:account,fence:fence,value:null,promise:null};memoCardsV227.set(key,entry);
    entry.stored=(async function(){var database=await db();if(!database)return;
      var saved=await new Promise(function(resolve){var tx=database.transaction('views','readonly'),read=tx.objectStore('views').get(key);read.onsuccess=function(){resolve(read.result);};read.onerror=tx.onabort=function(){resolve(null);};});
      if(account===owner()&&fence===storageEpoch()&&controller?.snapshot()?.byId.get(String(item.propertyId))?.sourceSnapshotKey===item.sourceSnapshotKey&&saved?.account===account&&saved.fence===fence&&saved.id===String(item.propertyId)&&saved.proof===item.sourceSnapshotKey&&typeof saved.memo==='string')entry.value=saved;
    })().catch(function(){});return entry;
  }
  function readMemoV227(item){
    var entry=memoEntryV227(item);if(entry.promise)return entry.promise;
    // Private storage may be blocked/slow in Edge. A disk miss must not add
    // its wait before the small authoritative read starts.
    entry.promise=(async function(){if(!memoCurrentV227(item,entry.account,entry.fence))throw Error('조회 범위가 바뀌었습니다.');if(entry.value)return entry.value;
      var phone=peekPhoneV230(item),shared=phone?.value,prepared=controller?.ready(String(item.propertyId))&&master(String(item.propertyId));
      if(!shared&&prepared?.sourceSnapshotKey===item.sourceSnapshotKey&&typeof prepared.memo==='string')shared=prepared;
      if(shared&&Object.hasOwn(shared,'memo')&&(shared.memo===null||typeof shared.memo==='string')&&memoCurrentV227(item,entry.account,entry.fence)){
        entry.value={account:entry.account,fence:entry.fence,id:String(item.propertyId),proof:item.sourceSnapshotKey,memo:shared.memo||'',source:String(shared.source||'')};storeMemoV230(item,entry);return entry.value;
      }
      var id=String(item.propertyId),result=await global.JSDataAccessV6.read('listingChanges',{ids:id},{cache:'no-store'}),rows=result?.items;
      if(!memoCurrentV227(item,entry.account,entry.fence)||result?.ok!==true||!Array.isArray(rows)||rows.length!==1||rows[0].property_id!==id||rows[0].status==='deleted'||rows[0].source_snapshot_key!==item.sourceSnapshotKey||!Object.hasOwn(rows[0],'operating_memo')||rows[0].operating_memo!==null&&typeof rows[0].operating_memo!=='string')throw Error('최신 메모의 원장 연결을 확인하지 못했습니다.');
      entry.value={account:entry.account,fence:entry.fence,id:id,proof:item.sourceSnapshotKey,memo:rows[0].operating_memo||'',source:String(rows[0].main_source||'')};
      storeMemoV230(item,entry);
      return entry.value;
    })().catch(function(error){if(memoCardsV227.get(memoKeyV227(item))===entry)memoCardsV227.delete(memoKeyV227(item));throw error;});return entry.promise;
  }
  function storeMemoV230(item,entry){db().then(function(database){if(!database||!memoCurrentV227(item,entry.account,entry.fence))return;var tx=database.transaction('views','readwrite'),store=tx.objectStore('views');store.put(entry.value,memoKeyV227(item));
    var keys=store.getAllKeys();keys.onsuccess=function(){var own=keys.result.filter(function(key){return String(key).startsWith(entry.account+'|memo-v227|');});own.slice(0,Math.max(0,own.length-64)).forEach(function(key){store.delete(key);});};}).catch(function(){});}
  function contactEpochV171(){return owner()+'|'+storageEpoch();}
  function peekPhoneV230(item){var key=contactEpochV171()+'|'+controller?.snapshot()?.revision+'|'+String(item.propertyId||'')+'|'+item.sourceSnapshotKey,entry=phoneCardsV171.get(key);return entry&&Date.now()-entry.at<30000?entry:null;}
  var interactionV230=0,interactionTargetV230='';
  document.addEventListener('click',function(event){
    var target=event.target.closest?.('#list .item button,#list .item .unified-thumb-v8');if(!target)return;
    var card=target.closest('.item[data-property-id]'),kind=target.matches('.item-memo-toggle')?'memo':target.matches('.item-contact-button-v654')?'contacts':target.matches('.item-edit-btn-v630')?'editor':target.matches('.unified-thumb-v8')?'detail':'';
    if(!card||!kind||kind==='memo'&&card.querySelector('.item-memo-panel'))return;
    var id=card.dataset.propertyId,root=document.documentElement;
    // Replaying the same guarded click is part of the original gesture. Its
    // time must include the exact-master wait, not restart after hydration.
    if(!event.isTrusted&&root.dataset.interactionStateV230==='pending'&&interactionTargetV230===kind+'|'+id)return;
    interactionTargetV230=kind+'|'+id;
    var token=++interactionV230,start=performance.now(),account=owner();
    root.dataset.interactionKindV230=kind;root.dataset.interactionStateV230='pending';delete root.dataset.interactionMsV230;
    function frame(){
      if(token!==interactionV230||account!==owner())return;
      var box=kind==='memo'?Array.from(document.querySelectorAll('#list .item[data-property-id]')).find(function(node){return node.dataset.propertyId===id;})?.querySelector('.item-memo-panel'):
        kind==='contacts'?document.querySelector('#listContactModalV654.open #listContactBodyV654'):kind==='editor'?document.querySelector('#propertyEditModalV630.open,dialog[open] [data-sale-edit="salePrice"]'):document.querySelector('#unifiedDetailDrawerV8.open');
      var shown=!!box&&box.getBoundingClientRect().width>0;
      if(shown&&kind==='contacts')shown=!!box.querySelector('a[href^="tel:"]')||!box.querySelector('.list-contact-loading-v8')&&box.textContent.includes('없');
      if(shown&&kind==='detail'){var image=Array.from(box.querySelectorAll('img')).find(function(img){return img.getBoundingClientRect().width>0;});shown=image?image.complete&&image.naturalWidth>0:box.textContent.includes('등록된 사진 없음');}
      if(shown){root.dataset.interactionMsV230=String(Math.round(performance.now()-start));root.dataset.interactionStateV230='content';return;}
      if(performance.now()-start<10000)requestAnimationFrame(frame);else root.dataset.interactionStateV230='timeout';
    }
    requestAnimationFrame(frame);
  },true);
  function phoneCardV171(item){
    var id=String(item.propertyId||''),proof=item.sourceSnapshotKey,epoch=contactEpochV171(),revision=controller?.snapshot()?.revision,key=epoch+'|'+revision+'|'+id+'|'+proof;
    var entry=phoneCardsV171.get(key);
    if(entry&&Date.now()-entry.at<30000)return entry;
    if(phoneCardsV171.size>=24)phoneCardsV171.delete(phoneCardsV171.keys().next().value);
    entry={at:Date.now(),value:null,promise:null};
    entry.promise=global.JSDataAccessV6.read('unifiedListingContacts',{propertyId:id,card:'171',proof:proof,expectedAccountEmail:owner()},{cache:'no-store'}).then(function(result){
      var row=result?.cardV171;
      if(epoch!==contactEpochV171()||revision!==controller?.snapshot()?.revision||!owner()||!result?.ok||result.propertyId!==id||row?.propertyId!==id||row.sourceSnapshotKey!==proof||
        !Array.isArray(result.contacts)||!Array.isArray(row.manualFinancialFieldsV106))throw new Error('연락처 정보를 다시 확인해 주세요.');
      entry.value=Object.assign({},row,{gongsilContactsLoadedV8:true,gongsilContactsV8:result.contacts,gongsilContactCountV8:result.contacts.length});
      global.refreshListContactPresenceV224?.(entry.value);
      return entry.value;
    }).catch(function(error){if(phoneCardsV171.get(key)===entry)phoneCardsV171.delete(key);throw error;});
    phoneCardsV171.set(key,entry);return entry;
  }
  function bindSummaryCard(card,item){
    if(sourcePreviewV225(item)){card.inert=true;return;}
    card.dataset.querySummaryV157='';
    // Restore only a bounded, exact-proof private memo; opening a note needs
    // no source-photo, linked-ad, finance or editable-master hydration.
    memoEntryV227(item);
    function warmMemoV227(){if(hasCurrentData())readMemoV227(item).catch(function(){});}
    // Markup is assigned after this binding, so delegate hover/focus intent.
    card.addEventListener('pointerover',function(event){if(event.target.closest?.('.item-memo-toggle'))warmMemoV227();else if(event.target.closest?.('.item-edit-btn-v630'))warmEditorV227(item);});
    card.addEventListener('focusin',function(event){if(event.target.closest?.('.item-memo-toggle'))warmMemoV227();else if(event.target.closest?.('.item-edit-btn-v630'))warmEditorV227(item);});
    var phone=card.querySelector('.item-contact-button-v654');
    function warmPhone(){if(hasCurrentData())phoneCardV171(item).promise.catch(function(){});}
    phone?.addEventListener('pointerenter',warmPhone);phone?.addEventListener('focus',warmPhone);phone?.addEventListener('pointerdown',warmPhone);
    card.addEventListener('click',function(event){
      if(event.target.closest?.('.item-memo-panel'))return;
      if(global.JSUnifiedListingsV8?.hasPendingMoveV225?.()){global.JSUnifiedListingsV8.handleCardClick(item,event);return;}
      if(event.target.closest?.('.item-action-select'))return;
      event.preventDefault();event.stopImmediatePropagation();
      var view=controller?.snapshot(),intent=global.jsQueryListIntentV152,gestureOwnerV230=owner(),gestureFenceV230=storageEpoch();
      var control=event.target.closest?.('button,input,a,label');
      if(control?.classList.contains('item-memo-toggle')){
        if(!hasCurrentData())return;
        var memoIntent=++actionIntent,memoKey='property:'+String(item.propertyId);
        function showMemo(){if(memoIntent!==actionIntent||view!==controller?.snapshot()||intent!==global.jsQueryListIntentV152||!card.isConnected||!memoItemV227(item.propertyId))return;
          global.toggleItemMemo(encodeURIComponent(memoKey),control);
          // Prepare only this explicitly opened master after its note paints.
          // Source hydration and its private checkpoint never gate note display.
          requestAnimationFrame(function(){if(card.isConnected&&memoIntent===actionIntent&&global.openMemoKey===memoKey)warmEditorV227(item);});}
        if(memoItemV227(item.propertyId))showMemo();else readMemoV227(item).then(showMemo).catch(function(error){console.warn('메모 조회 실패',error.message);if(memoIntent===actionIntent&&card.isConnected)document.getElementById('status').textContent='최신 메모를 확인하지 못했습니다. 메모 버튼을 눌러 다시 확인해 주세요.';});return;
      }
      if(control?.classList.contains('item-contact-button-v654')){
        if(!hasCurrentData())return;
        var epoch=contactEpochV171(),entry=phoneCardV171(item);
        global.openListContactPopupV654?.('',{item:item,value:entry.value,promise:entry.promise,
          current:function(){return epoch===contactEpochV171()&&view===controller?.snapshot()&&intent===global.jsQueryListIntentV152&&hasCurrentData();}});
        return;
      }
      var label=control?.tagName==='LABEL';if(label)control=control.querySelector('input');
      var classes=['action-select-check','item-edit-btn-v630','item-memo-toggle','item-contact-button-v654','item-nav-btn','item-roadview-btn',
        'item-building-register-btn','item-list-add-btn','unified-thumb-v8','item-source-link-btn'];
      var selectedClass=control&&classes.find(function(name){return control.classList.contains(name);});
      var wanted=control?.type==='checkbox'?(label?!control.checked:control.checked):null;
      var aria=control?.getAttribute('aria-label'),title=control?.getAttribute('title'),tag=control?.tagName;
      function run(){
        var current=controller?.snapshot();
        if(intent!==global.jsQueryListIntentV152||!hasCurrentData()||gestureOwnerV230!==owner()||gestureFenceV230!==storageEpoch()||
          current!==view&&(current?.signature!==view.signature||current?.byId.get(String(item.propertyId))?.sourceSnapshotKey!==item.sourceSnapshotKey))return;
        global.upgradeQueryCardsV157?.(idsFor([item]));
        var next=Array.from(document.querySelectorAll('#list .item[data-property-id]')).find(function(node){return node.dataset.propertyId===String(item.propertyId)&&!node.hasAttribute('data-query-summary-v157');});
        if(!next)return;
        if(!control){next.click();return;}
        var targets=Array.from(next.querySelectorAll('button,input,a')).filter(function(node){
          return node.tagName===tag&&(selectedClass?node.classList.contains(selectedClass):aria?node.getAttribute('aria-label')===aria:title&&node.getAttribute('title')===title);
        });
        if(targets.length===1&&!targets[0].disabled&&(wanted===null||targets[0].checked!==wanted))targets[0].click();
      }
      if(!guardIds(idsFor([item]),run))run();
    },true);
    card.addEventListener('keydown',function(event){if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopImmediatePropagation();card.click();}},true);
  }
  function prepare(items,done,settings){
    items=items.filter(function(item){return !sourcePreviewV225(item);});
    if(!active()||Number(global.newListingDays||0)===1||items.every(ready))return false;
    var view=controller.snapshot(),ids=idsFor(items),key=view.revision+'|'+ids.join(',');
    var account=owner(),fence=storageEpoch(),listIntent=global.jsQueryListIntentV152,proofs=ids.map(function(id){return view.byId.get(id)?.sourceSnapshotKey;});
    function sameGesture(){var current=controller?.snapshot();return settings?.action===true&&hasCurrentData()&&account===owner()&&fence===storageEpoch()&&listIntent===global.jsQueryListIntentV152&&current?.signature===view.signature&&ids.every(function(id,i){return current.byId.get(id)?.sourceSnapshotKey===proofs[i];});}
    if(!preparing.has(key)){
      var task=controller.hydrate(ids).then(function(){return true;}).catch(function(error){
        if(controller?.snapshot()===view&&ids.every(function(id){return controller.ready(id);}))return true;
        if(error.code==='QUERY_CHANGED')load(true,true);else if(error.code!=='QUERY_SUPERSEDED')console.warn('표시할 매물 준비 실패',error.message);
        return false;
      }).finally(function(){preparing.delete(key);});preparing.set(key,task);
    }
    preparing.get(key).then(async function(ok){
      // A same-query verification can replace its snapshot while an exact
      // click is waiting. Retry that intent once against the new snapshot;
      // a changed account, save fence, visible selection or proof cancels it.
      if(!ok&&sameGesture())try{await controller.hydrate(ids);ok=true;}catch{}
      if(ok&&(controller?.snapshot()===view||sameGesture())){
      // Replay an explicit exact-ID gesture before the reconciliation repaint
      // advances the list intent. Passive paints still use only updated rows.
      if(view.overridden){if(settings?.action===true)done();global.applyFilter();}else done();
    }});
    return true;
  }
  function prepareList(items,done,settings){
    return prepareDisplayed(settings?.startAtTop?items.slice(0,global.getListRenderChunkSize()):listTargets(items),done);
  }
  function prefetch(){
    if(!active()||loading||!hasCurrentData()||!global.listRenderLimit||Number(global.newListingDays||0)===1)return;
    if(readOnlyCardViewV220(controller.snapshot()))return;
    var end=Number(global.listRenderLimit),size=global.getListRenderChunkSize()*2,next=(global.visibleListItems||[]).slice(end,end+size);
    if(next.length&&!next.every(ready))controller.hydrate(idsFor(next)).catch(function(){});
  }
  function navigationItems(){return active()?filtered({ignoreMapBounds:true,includeUnlocated:true}):global.allItems||[];}
  function queueLookup(property){
    if(previewIdsV225.has(property)||previewByIdV225(property)||lookupPending.has(property)||!active())return;
    lookupPending.add(property);lookupQueue.add(property);
    if(!lookupTimer)lookupTimer=setTimeout(flushLookups,0);
  }
  async function flushLookups(){
    lookupTimer=0;var core=controller,view=core?.snapshot(),ids=Array.from(lookupQueue).slice(0,50);
    ids.forEach(function(id){lookupQueue.delete(id);});
    try{
      if(!view)return;
      var scoped=ids.filter(function(id){return view.byId.has(id);}),outside=ids.filter(function(id){return!view.byId.has(id);});
      if(scoped.length)await core.hydrate(scoped);
      if(outside.length)await core.hydrate(outside,{unscoped:true,force:true});
      if(controller!==core||core.snapshot()!==view)return;
      outside.forEach(function(id){unscopedKnown.set(id,{revision:view.revision,master:master(id)});});
      signalFavorites();
    }catch{}finally{
      ids.forEach(function(id){lookupPending.delete(id);});
      if(lookupQueue.size&&!lookupTimer)lookupTimer=setTimeout(flushLookups,0);
    }
  }
  function lookup(ref){
    ref=String(ref||'');var property=ref.indexOf('property:')===0?ref.slice(9):ref.indexOf('id:')===0?ref.slice(3):ref;
    var preview=previewByIdV225(property.replace(/\|row:\d+$/,''));if(preview)return preview;
    var full=(global.allItems||[]).find(function(item){return String(item.propertyId)===property||item.key===ref;});
    if(full){property=String(full.propertyId);var view=controller.snapshot();
      if(view.byId.has(property)&&!confirmed.has(property)&&!controller.ready(property)){queueLookup(property);return view.byId.get(property);}
      if(!view.byId.has(property)&&(unscopedKnown.get(property)?.revision!==view.revision||unscopedKnown.get(property)?.master!==full))queueLookup(property);
      return full;
    }
    var row=history.get(property)||Array.from(history.values()).find(function(item){return item.key===ref;});
    if(row){queueLookup(row.propertyId);return row;}
    if(/^(?:property:|id:)/.test(ref))queueLookup(property);
    return null;
  }
  function guardKey(encoded,run){
    if(!active())return false;
    var ref;try{ref=decodeURIComponent(encoded||'');}catch{return false;}
    var item=lookup(ref);
    if(!item&&/^(?:property:|id:)/.test(ref))return guardIds([ref.replace(/^(?:property:|id:)/,'')],run);
    if(item)return guardIds([String(item.propertyId)],run);
    return false;
  }
  function guardIds(ids,run){
    if(!active())return false;
    if(ids.some(function(id){return previewIdsV225.has(id)||!!previewByIdV225(id);}))return true;
    var intent=++actionIntent;
    var view=controller.snapshot();
    var unknown=ids.map(String).filter(function(id){return !view.byId.has(id)&&
      (unscopedKnown.get(id)?.revision!==view.revision||unscopedKnown.get(id)?.master!==master(id));});
    if(unknown.length){controller.hydrate(unknown,{unscoped:true,force:true}).then(function(){
      if(controller?.snapshot()!==view)return;
      unknown.forEach(function(id){unscopedKnown.set(id,{revision:view.revision,master:master(id)});});
      if(intent===actionIntent)run();
    }).catch(function(){});return true;}
    if(ids.every(function(id){return !view.byId.has(String(id))||confirmed.has(String(id))||controller.ready(String(id));}))return false;
    var rows=ids.map(function(id){return history.get(String(id))||master(String(id));}).filter(Boolean);
    return prepare(rows,function(){if(intent===actionIntent)run();},{action:true});
  }
  function selectedRows(){
    var keys=global.selectedPrintKeys||[];if(!keys.length)return[];
    var rows=new Map(),wanted=new Set(keys);
    (controller?.snapshot()?.rows||[]).concat(global.allItems||[],global.visibleListItems||[]).forEach(function(item){
      var key=global.actionSelectionKeyV660(item);if(wanted.has(key))rows.set(key,item);
    });
    return keys.map(function(key){return rows.get(key);}).filter(Boolean);
  }
  async function readMastersForBuildingV164(ids){
    if(!active())return(global.allItems||[]).filter(function(item){return ids.includes(String(item.propertyId));});
    if(ids.length>200)throw new Error('건물 매물 범위를 좁힌 뒤 다시 확인해 주세요.');
    var core=controller,view=core.snapshot(),who=owner(),fence=storageEpoch();
    var scoped=ids.filter(function(id){return view.byId.has(id);}),outside=ids.filter(function(id){return!view.byId.has(id);});
    if(scoped.length)await core.hydrate(scoped,{snapshot:view,force:true});
    if(outside.length)await core.hydrate(outside,{snapshot:view,force:true,unscoped:true});
    if(controller!==core||core.snapshot()!==view||owner()!==who||storageEpoch()!==fence||!hasCurrentData())throw new Error('계정 또는 조회 범위가 바뀌었습니다. 다시 확인해 주세요.');
    var result=ids.map(master);if(result.some(function(item){return!item||item.queryRowV152;}))throw new Error('건물 매물 전체를 확인하지 못했습니다.');
    return result;
  }
  function guardSelected(run,cancelled){
    if(!active()||!(global.selectedPrintKeys||[]).length)return false;
    var action=++selectedActionIntentV162;
    var rows=selectedRows(),view=controller.snapshot(),core=controller,account=owner(),fence=storageEpoch();
    if(rows.length!==global.selectedPrintKeys.length){cancelled?.();global.alert('선택한 매물이 현재 목록에서 변경되었습니다. 다시 선택해 주세요.');return true;}
    var ids=idsFor(rows),generation=global.jsActionSelectionGenerationV162||0;
    if(rows.every(ready))return false;
    function current(){return action===selectedActionIntentV162&&controller===core&&core.snapshot()===view&&account===owner()&&fence===storageEpoch()&&
      generation===(global.jsActionSelectionGenerationV162||0)&&hasCurrentData()&&
      JSON.stringify(idsFor(selectedRows()).sort())===JSON.stringify(ids.slice().sort());}
    core.hydrate(ids,{snapshot:view}).then(function(){
      if(!current()){cancelled?.();return;}
      if(!selectedRows().every(ready))throw new Error('선택한 매물의 최신 상세정보를 확인하지 못했습니다.');
      if(view.overridden){
        var preserve=global.preserveActionSelectionDuringRender;global.preserveActionSelectionDuringRender=true;
        try{global.applyFilter();}finally{global.preserveActionSelectionDuringRender=preserve;}
      }else global.upgradeQueryCardsV157?.(ids);
      global.syncPrintSelectionV162?.();
      if(current())run();else cancelled?.();
    }).catch(function(error){cancelled?.();if(current())global.alert('선택한 매물 정보를 확인하지 못해 작업하지 않았습니다. 선택은 유지됩니다. 잠시 후 다시 시도해 주세요.');console.warn('선택 매물 작업 확인 지연',error.message);});
    return true;
  }
  async function poll(){
    if(!enabled()||loading)return;
    if(!controller?.snapshot())return load(true,true);
    try{var result=await global.JSDataAccessV6.read('dataRevision',{scope:'listings'},{cache:'no-store'});
      if(result?.revision&&result.revision!==controller.snapshot().revision)await load(true,true);
      else if(result?.revision===controller.snapshot().revision){var view=controller.snapshot();
        if(!view.overridden){view.recent=false;view.fresh=true;}
        freshness(view.overridden?'per-property':'verified');}
    }catch{freshness('unverified');}
  }
  async function afterMutation(result){
    var ids=(result?.affectedPropertyIds||[]).map(String);if(!ids.length)return false;
    if(result.persisted===true&&result.separated===true&&ids.includes(String(result.sourceMasterId))&&ids.includes(String(result.targetMasterId))){var temporary=[];sourceChangesV225.forEach(function(change){if(change.account===owner()&&change.ids.includes(String(result.sourceMasterId)))change.rows.forEach(function(row){if(previewIdsV225.has(String(row.propertyId)))temporary.push(row.propertyId);});});global.includeSeparatedMasterInPinnedSelectionV225?.(result.sourceMasterId,result.targetMasterId,temporary);}
    if((result.selectedMerge===true||result.sourceMutationV225===true)&&result.persisted===true){
      var core=controller,view=core.snapshot(),account=owner(),end=beginVerificationBatchV210();
      mergeReadsV211++;
      receiptFence(ids);clearTimeout(saveTimer);saveTimer=0;loading=null;initialWarm=null;
      // Auto-validation must not cancel the exact read of this committed merge.
      // Account/market changes still retain their existing cancellation fences.
      try{
        await core.hydrate(ids,{snapshot:view,force:true,unscoped:true,reconcile:true,pointResultV211:result.pointResultV211});
        if(controller!==core||owner()!==account||core.snapshot()!==view)return false;
        sourceChangesV225.forEach(function(change,token){if(change.saved&&change.account===account&&change.ids.every(function(id){return ids.includes(id);}))sourceChangesV225.delete(token);});
        global.isLoadingSheet=false;result.uiAppliedV225=true;global.applyFilter();return true;
      }finally{mergeReadsV211--;verificationRefreshV210=true;end();}
    }
    if(ids.every(function(id){return Date.now()-(receiptMarks.get(id)||0)<5000;})){await loading?.promise;await poll();return true;}
    receiptFence(ids);clearTimeout(saveTimer);saveTimer=0;
    await load(true,true);return true;
  }
  function receiptFence(ids){
    ids.forEach(function(id){confirmed.add(id);receiptMarks.set(id,Date.now());});
    try{localStorage.setItem(epochKey(),JSON.stringify({token:Date.now()+'-'+Math.random(),ids:ids}));}catch{}
    controller?.invalidate(ids);baseViews.clear();numericCatalogV177=null;
    global.JSDataAccessV6?.invalidateRead?.('listingQuery');global.JSDataAccessV6?.invalidateRead?.('listingOriginals');
    clearTimeout(saveTimer);saveTimer=setTimeout(function(){saveTimer=0;load(true,true);},0);
  }
  function mergeReceipts(before,after){
    if(!before||before.persisted!==true||before.queued||before.propertyId!==after.propertyId)before={};
    var updated=Object.assign({},before.updated||{},after.updated||{}),merged=Object.assign({},before,after,{updated:updated,
      changedFields:Array.from(new Set((before.changedFields||[]).concat(after.changedFields||[])))});
    ['memo','state','contacts'].forEach(function(key){
      if(Object.hasOwn(after,key))updated[key]=after[key];
      else if(!Object.hasOwn(updated,key)&&Object.hasOwn(before,key))updated[key]=before[key];
      if(Object.hasOwn(updated,key))merged[key]=updated[key];
    });return merged;
  }
  function queueReceiptPatch(id,receipt,before){
    if(!receipt||receipt.fullReload||receipt.sourceLinksChanged||!master(id)){
      clearTimeout(patchTimer);receiptPatches.clear();patchBaseline=storageEpoch();return;
    }
    if(receiptPatches.size>=50&&!receiptPatches.has(id)){
      clearTimeout(patchTimer);receiptPatches.clear();patchBaseline=storageEpoch();return;
    }
    var item=Object.assign({},master(id),receipt.updated||{});
    if(typeof receipt.memo==='string')item.memo=receipt.memo;
    if(typeof receipt.state==='string')item.state=receipt.state;
    var projected=global.JSUnifiedListingsV8?.filterItemForView(item,function(){return true;},'active');
    if(projected)projected=Object.assign({},projected,{queryGroupKeyV152:global.JSUnifiedListingsV8.queryGroupKeyV152(item),
      queryPendingVisitV152:global.isFieldVisitItem(item)===true,queryConfirmedVisitV152:global.isConfirmedVisitItem(item)===true});
    if(!receiptPatches.size&&!patchRunning)patchBaseline=before;
    receipt=mergeReceipts(receiptPatches.get(id)?.receipt,JSON.parse(JSON.stringify(receipt)));
    receiptPatches.set(id,{id:id,receipt:receipt,item:item,projected:projected});
    clearTimeout(patchTimer);patchTimer=setTimeout(flushReceiptPatches,0);
  }
  async function flushReceiptPatches(){
    if(patchRunning||!receiptPatches.size)return;
    patchRunning=true;var account=owner(),epoch=storageEpoch(),batch=Array.from(receiptPatches.values()),baseline=patchBaseline;
    try{
      var database=await db();if(!database||account!==owner()||epoch!==storageEpoch())return;
      var applied=await new Promise(function(resolve){var tx=database.transaction('views','readwrite'),wrote=false;
        ['lease','building_sale','land_sale'].forEach(function(mode){
          tx.objectStore('views').delete(account+'|'+mode+'|filtered');
          var request=tx.objectStore('views').get(account+'|'+mode);
          request.onsuccess=function(){var value=request.result;
            if(account!==owner()||epoch!==storageEpoch()){tx.abort();return;}
            if(value?.account!==account||value.kind!=='query-scope-v152'||value.cacheEpochV152!==baseline)return;
            var view;try{view=global.JSQueryCollectionV152.decode(value.packet);}catch{return;}
            var changed=false,fieldMap={name:'title',room:'room',type:'listing_type',deposit:'deposit',rent:'monthly_rent',fee:'maintenance_fee',
              premium:'premium',area:'area_m2',landlordPhone:'landlord_phone',tenantPhone:'tenant_phone',memo:'operating_memo',state:'status',
              salePrice:'sale_price',saleDetails:'sale_details_json',saleCategory:'sale_category'};
            batch.forEach(function(entry){var nav=view.byId.get(entry.id);if(!nav)return;changed=true;
              var receipt=entry.receipt,updates=Object.assign({},receipt.updated||{});
              if(typeof receipt.memo==='string')updates.memo=receipt.memo;if(typeof receipt.state==='string')updates.state=receipt.state;
              (value.points||[]).forEach(function(saved){if(String(saved.row?.property_id||saved.row?.id)!==entry.id)return;
                saved.row.savedReceiptV154=mergeReceipts(saved.row.savedReceiptV154,receipt);
                Object.keys(fieldMap).forEach(function(key){if(Object.hasOwn(updates,key))saved.row[fieldMap[key]]=key==='saleDetails'?JSON.stringify(updates[key]):updates[key];});
                var contacts=receipt.contacts||updates.contacts;if(Array.isArray(contacts))saved.row.contacts_json=JSON.stringify(contacts);
                var compact=/^compact-v\d+$/.test(saved.unified.format||''),fields=saved.unified.fields||[];
                (saved.unified.groups[entry.id]||[]).forEach(function(original){
                  function get(key){return compact?original[fields.indexOf(key)]:original[key];}
                  function put(key,value){if(compact){var index=fields.indexOf(key);if(index>=0)original[index]=value;}else original[key]=value;}
                  put('manualDisplayFields',Array.from(new Set(String(get('manualDisplayFields')||'').split(',').concat(receipt.changedFields||[]))).filter(Boolean).join(','));
                  if((receipt.changedFields||[]).includes('room')){put('room',entry.item.room);put('hasManualRoomOverride',true);put('roomManuallyEditedV1',true);}
                });
              });
              if(!entry.projected)view.rows=view.rows.filter(function(row){return row.propertyId!==entry.id;});
              else view.rows=view.rows.map(function(row){return row.propertyId===entry.id?Object.assign({},row,entry.projected,{sourceSnapshotKey:nav.sourceSnapshotKey,sheetRow:nav.sheetRow}):row;});
            });
            if(!changed){value.cacheEpochV152=epoch;}else{
              value.packet=Object.assign({},value.packet,{perPropertyOverridesV152:true,total:view.rows.length,
                rows:view.rows.map(function(row){return value.packet.fields.map(function(field){return row[field]??null;});})});
              value.cacheEpochV152=epoch;value.packet.clientCacheEpochV152=epoch;
              value.preview=null; // Never replay pre-save card markup as the saved conditions.
            }
            tx.objectStore('views').put(value,account+'|'+mode);wrote=true;
          };
        });
        tx.oncomplete=function(){resolve(wrote);};tx.onerror=tx.onabort=function(){resolve(false);};
      });
      if(applied){patchBaseline=epoch;batch.forEach(function(entry){if(receiptPatches.get(entry.id)===entry)receiptPatches.delete(entry.id);});}
    }catch{}finally{
      patchRunning=false;
      // A new local receipt during this transaction needs one more exact-ID patch.
      if(receiptPatches.size&&Array.from(receiptPatches.values()).some(function(entry){return!batch.includes(entry);}))patchTimer=setTimeout(flushReceiptPatches,0);
      else batch.forEach(function(entry){if(receiptPatches.get(entry.id)===entry)receiptPatches.delete(entry.id);});
    }
  }
  function metadata(){
    var groups={},keys={},ids={},search={};
    (global.allItems||[]).forEach(function(item){var id=String(item.propertyId);groups[id]=global.JSUnifiedListingsV8.allOriginals(id);
      keys[id]=item.sourceSnapshotKey;ids[id]=id;search[id]=item.sourceListingSearchV6579||[];});
    return Promise.resolve({ok:true,queryScopedV152:true,completeCatalog:false,format:'expanded-v2',groups:groups,
      sourceSnapshotKeys:keys,sourceSnapshotPropertyIds:ids,sourceSearchIds:search});
  }
  global.JSQueryListingsV152={enabled:enabled,active:active,needsQuery:needsQuery,hasCurrentData:hasCurrentData,load:load,filtered:filtered,materialize:materialize,
    paintCachedPreview:function(current){var warm=previewWarm||initialCacheWarm;previewWarm=null;if(!enabled()||!warm)return Promise.resolve(false);
      return warm.promise.then(function(value){return warm.account===owner()&&warm.epoch===storageEpoch()&&global.JSQueryPreviewV154?.show(value,warm.signature,current)===true;}).catch(function(error){console.warn('초기 목록 캐시 읽기 실패',error.name,error.message);return false;});},
    prepare:prepare,ready:ready,prepareList:prepareList,prepareWindow:prepareDisplayed,canRenderSummary:canRenderSummary,bindSummaryCard:bindSummaryCard,
    beginPropertyEditV225:beginPropertyEditV225,beginSourceMutationV225:beginSourceMutationV225,mutationRowV225:function(id){return controller?.snapshot()?.byId.get(String(id))||master(id);},
    setSelectedStateV225:setSelectedStateV225,beginVerificationBatchV210:beginVerificationBatchV210,prefetch:prefetch,warmClustersV159:warmClustersV159,navigationItems:navigationItems,lookup:lookup,guardKey:guardKey,
    editorContactsV227:phoneCardV171,memoItemV227:memoItemV227,contactEpochV171:contactEpochV171,guardIds:guardIds,guardSelected:guardSelected,selectedRows:selectedRows,readMastersForBuildingV164:readMastersForBuildingV164,poll:poll,afterMutation:afterMutation,metadata:metadata,typeItems:function(){return(indexView?.rows||[]).concat(global.allItems||[]);}};
  global.addEventListener('js-auth-required',function(){clearTimeout(interactiveTimerV230);interactiveTimerV230=0;interactiveQueueV230.clear();detailQueueV230.length=0;detailPreparedV230.clear();projectionReadsV228.forEach(function(job){job.controller.abort();});navigationReadsV228.forEach(function(job){job.controller.abort();});previewIdsV225.clear();sourceChangesV225.clear();stateChangesV225.clear();phoneCardsV171.clear();memoCardsV227.clear();global.closeListContactPopupV654?.();});
  global.addEventListener('js-auth-required',function(){clearTimeout(retryTimer);clearTimeout(lookupTimer);clearTimeout(patchTimer);receiptPatches.clear();lookupTimer=0;lookupQueue.clear();lookupPending.clear();initialWarm=null;initialCacheWarm=null;previewWarm=null;publishedSignature='';if(controller)controller.clear().catch(function(){});controller=null;indexView=null;history.clear();confirmed.clear();baseViews.clear();numericCatalogV177=null;unscopedKnown.clear();});
  global.addEventListener('storage',function(event){if(!active()||event.key!==epochKey())return;
    clearTimeout(patchTimer);receiptPatches.clear();
    var ids=[];try{ids=JSON.parse(event.newValue||'{}').ids||[];}catch{}
    controller.invalidate(Array.isArray(ids)?ids.filter(function(id){return typeof id==='string';}):[]);baseViews.clear();numericCatalogV177=null;
    global.JSDataAccessV6?.invalidateRead?.('listingQuery');global.JSDataAccessV6?.invalidateRead?.('listingOriginals');
    load(true,true);
  });
  global.addEventListener('js-master-persisted-v154',function(event){
    var id=String(event.detail?.propertyId||'').trim(),receipt=event.detail?.receipt;
    if(enabled()&&owner()&&id&&receipt?.persisted===true&&!receipt.queued&&String(receipt.propertyId||'').trim()===id){
      var before=storageEpoch();receiptFence([id]);queueReceiptPatch(id,receipt,before);}
  });
  // Start only the small authenticated query while map.js/SDK initialization
  // continues. Its account, filters and receipt epoch must still match when
  // consumed; this performs no render and never warms the legacy full files.
  if(enabled()&&owner()&&global.JSDataAccessV6){
    db();var initialSpec=spec();
    initialCacheWarm={account:owner(),signature:JSON.stringify(initialSpec),epoch:storageEpoch(),promise:cache.read(owner(),JSON.stringify(initialSpec))};
    previewWarm=initialCacheWarm;
    initialCacheWarm.promise.catch(function(){});
    initialWarm={owner:owner(),epoch:storageEpoch(),signature:JSON.stringify(initialSpec),
      promise:remoteQuery(initialSpec)};
    initialWarm.promise.catch(function(){});
  }
})(window);
