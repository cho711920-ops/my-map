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
  function freshness(value){
    document.documentElement.dataset.queryFreshV152=value;
    var badge=document.getElementById('queryFreshnessV152'),head=document.querySelector('.map-list-panel-head-v1');
    if(value==='verified'||value==='error'){badge?.remove();return;}
    if(!head)return;
    if(!badge){badge=document.createElement('button');badge.id='queryFreshnessV152';badge.type='button';
      badge.textContent='최근 확인 목록';badge.title='최근 확인된 목록입니다. 누르면 최신 자료를 다시 확인합니다.';
      badge.style.cssText='font-size:11px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#475569;white-space:nowrap';
      badge.addEventListener('click',function(){load(true,true);});head.insertBefore(badge,head.lastElementChild);}
  }
  function enabled(){return global.JSQueryListingsEnabledV152===true;}
  function active(){return enabled()&&!!controller?.snapshot();}
  function owner(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function epochKey(){return 'js-query-epoch-v152:'+owner();}
  function storageEpoch(){try{return localStorage.getItem(epochKey())||'';}catch{return '';}}
  function spec(){var filters={};inputs.forEach(function(id){filters[id]=id==='sortFilter'?'latest':String(document.getElementById(id)?.value||'');});
    return {mode:global.JSListingTradeV1?.getMode()||'lease',filters:filters,hideDone:global.hideDone!==false,
      doneOnly:global.doneOnly===true,gongsilOnly:global.gongsilOnly===true,newListingDays:Number(global.newListingDays||0)};}
  function master(id){return(global.allItems||[]).find(function(item){return String(item.propertyId)===String(id);});}
  async function pointRead(ids){
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
    if(Array.isArray(options.items)){
      allowed=new Set();options.items.forEach(function(item){(item.wholeBuildingMembersV55||[item.propertyId]).forEach(function(id){allowed.add(String(id));});});
      rows=rows.filter(function(row){return allowed.has(row.propertyId);});
    }
    return global.getFilteredItems(Object.assign({},options,{items:rows,queryLegacyV152:true,preProjectedQueryV152:true,
      querySortV152:String(document.getElementById('sortFilter')?.value||'latest'),
      queryResortV152:confirmed.size>0||view?.overridden===true||String(document.getElementById('sortFilter')?.value||'latest')!=='latest',availabilityView:options.availabilityView||
        (view?.spec?.doneOnly?'completed':view?.spec?.hideDone===false?'all':'active')}));
  }
  function idsFor(items){var ids=[];items.forEach(function(item){(item.wholeBuildingMembersV55||[item.propertyId]).forEach(function(id){
    id=String(id);if(id&&ids.indexOf(id)<0)ids.push(id);
  });});return ids;}
  function initialIds(view){return idsFor(listTargets(localRows(view)));}
  function listTargets(items){
    var size=global.innerWidth<700?28:36,start=Number(global.listRenderStart||0),targets=items.slice(0,size).concat(items.slice(start,start+size));
    if(typeof global.captureListReadingAnchorV29==='function'&&typeof global.findListReadingAnchorIndexV48==='function'){
      var anchor=global.captureListReadingAnchorV29(items),index=anchor?global.findListReadingAnchorIndexV48(items,anchor):-1;
      if(index>=0)targets=targets.concat(items.slice(Math.max(0,index-size),index+size));
    }
    return targets;
  }
  function signalFavorites(){global.dispatchEvent(new CustomEvent('js-v6-list-store-change',{detail:{type:'favorite',source:'query-read-v152'}}));}
  function remoteQuery(value){
    var started=global.performance?.now?.()||Date.now();
    document.documentElement.dataset.queryNetworkStateV154='reading';
    return global.JSDataAccessV6.read('listingQuery',{spec:JSON.stringify(value)},{cache:'no-store'}).then(function(packet){
      document.documentElement.dataset.queryNetworkMsV154=String(Math.round((global.performance?.now?.()||Date.now())-started));
      document.documentElement.dataset.queryNetworkStateV154='received';return packet;
    },function(error){document.documentElement.dataset.queryNetworkStateV154='failed';throw error;});
  }
  async function readQuery(value){
    if(initialWarm){var warm=initialWarm;initialWarm=null;
      if(warm.owner===owner()&&warm.epoch===storageEpoch()&&warm.signature===JSON.stringify(value))return warm.promise;}
    var current=controller?.snapshot(),cached=baseViews.get(JSON.stringify(value));
    if(current?.fresh&&!current.overridden&&current.signature!==JSON.stringify(value)&&cached?.revision===current.revision)return cached;
    var keyword=String(value.filters.keyword||'').trim(),groups=keyword.split(',').map(function(part){return part.trim();}).filter(Boolean);
    var exact=groups.length&&typeof global.parseExactJibunKeyword==='function'&&typeof global.matchesExactJibunAddress==='function'&&
      Object.keys(value.filters).every(function(name){return name==='keyword'||name==='sortFilter'||!value.filters[name];})?
      groups.map(global.parseExactJibunKeyword):[];
    if(!exact.length||exact.some(function(group){return!group;}))return remoteQuery(value);
    // Address-only queries cannot choose a different original within a master.
    // Use the same exact-parcel matcher against the verified base index.
    var base=Object.assign({},value,{filters:Object.assign({},value.filters,{keyword:''})}),key=JSON.stringify(base),packet=baseViews.get(key),recent=false;
    if(!packet||packet.revision!==controller?.snapshot()?.revision){
      packet=await remoteQuery(base);
      global.JSQueryCollectionV152.decode(packet);rememberBase(key,packet);
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
    view.rows=view.rows.filter(function(row){return!removed.has(row.propertyId);}).map(function(row){return replacements.get(row.propertyId)||row;});
    view.byId=new Map(view.rows.map(function(row){return[row.propertyId,row];}));
    view.packet=Object.assign({},view.packet,{total:view.rows.length,perPropertyOverridesV152:true,
      rows:view.rows.map(function(row){return view.packet.fields.map(function(field){return row[field]??null;});})});
    view.overridden=true;view.fresh=false;locate(view);return true;
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
    });global.remapPassiveListActionSelectionsV48?.(before,global.allItems||[]);}
    preserveType(selected);return applied;
  }
  function rememberBase(key,packet){baseViews.delete(key);baseViews.set(key,packet);while(baseViews.size>3)baseViews.delete(baseViews.keys().next().value);}
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
  var cache={
    read:async function(account,signature){
      if(initialCacheWarm){var warm=initialCacheWarm;initialCacheWarm=null;
        if(warm.account===account&&warm.signature===signature&&warm.epoch===storageEpoch())return warm.promise;}
      var database=await db();if(!database)return null;
      var key;try{key=cacheKey(account,signature);}catch{return null;}
      return new Promise(function(resolve){var tx=database.transaction('views','readonly'),request=tx.objectStore('views').get(key);
        request.onsuccess=function(){var value=request.result;resolve(value&&value.cacheEpochV152===storageEpoch()?value:null);};request.onerror=function(){resolve(null);};tx.onabort=function(){resolve(null);};});},
    write:async function(account,value,current){var database=await db();if(!database||!current()||owner()!==account)return false;
      value.preview=global.JSQueryPreviewV154?.capture(value)||null;
      // The default refresh slot must retain the actual default overview's
      // points. A search, favorite, cluster or moved viewport cannot evict it.
      var key=cacheKey(account,value.signature);
      if(JSON.parse(value.signature).mode==='lease'&&!key.endsWith('|filtered')&&!value.preview)return false;
      return new Promise(function(resolve){var tx=database.transaction('views','readwrite');
        value.cacheEpochV152=value.packet.clientCacheEpochV152;
        if(!current()||owner()!==account||value.cacheEpochV152!==storageEpoch()){tx.abort();resolve(false);return;}
        tx.objectStore('views').put(value,key);
        tx.oncomplete=function(){resolve(true);};tx.onerror=tx.onabort=function(){resolve(false);};});},
    clear:async function(account){var database=await db();if(!database)return;
      return new Promise(function(resolve){var tx=database.transaction('views','readwrite');
        ['lease','building_sale','land_sale'].forEach(function(mode){tx.objectStore('views').delete(account+'|'+mode);tx.objectStore('views').delete(account+'|'+mode+'|filtered');});
        tx.oncomplete=tx.onabort=tx.onerror=function(){resolve();};});}
  };
  function setup(){if(controller)return controller;
    controller=global.JSQueryCollectionV152.create({account:owner,fence:storageEpoch,master:master,capture:function(){return global.JSListingRefreshV1.captureScopedRead();},
      reconcile:reconcile,canReconcile:function(view){return view.signature===JSON.stringify(spec());},
      readQuery:async function(value){var last,epochAtStart=storageEpoch();
        for(var attempt=0;attempt<2;attempt++)try{var packet=await readQuery(value);return Object.assign({},packet,{clientCacheEpochV152:epochAtStart});}
        catch(error){last=error;if(error.status===401||error.status===403)throw error;if(!attempt)await new Promise(function(resolve){setTimeout(resolve,200);});}
        throw last;},readPoints:pointRead,applyPoints:applyPoints,index:locate,initialIds:initialIds,cache:cache,
      commit:function(view,flags){
        indexView=view;confirmed.clear();global.jsInitialFullListingsLoadingV1=false;
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
  function load(isAuto,force){
    if(!enabled())return Promise.resolve(false);
    if(Number(global.newListingDays||0)===1)return Promise.resolve(true);
    var core=setup(),value=spec(),signature=JSON.stringify(value);
    if(loading&&loading.signature===signature&&!force)return loading.promise;
    if(force){baseViews.clear();initialWarm=null;}
    global.isLoadingSheet=true;global.jsListingsCompleteBaseV1=false;
    if(!hasCurrentData()){
      global.jsInitialFullListingsLoadingV1=true;global.setListingsLoadStatusV65?.('loading');
      if(core.snapshot()){
        global.currentItems=[];global.showList?.([]);global.drawItems?.([]);
        var title=document.getElementById('mapListTitleV1');if(title)title.textContent='선택한 조건의 목록 확인 중';
      }
    }
    var task=core.load(value,{force:!!force}).finally(function(){if(loading?.promise===task){loading=null;global.isLoadingSheet=false;
      if(core.snapshot()?.recent)setTimeout(function(){poll();},0);}});
    loading={signature:signature,promise:task};return task;
  }
  function filtered(options){var view=controller?.snapshot();return view&&view.spec.mode!==spec().mode?[]:localRows(view,options);}
  function ready(item){return idsFor([item]).every(function(id){return confirmed.has(id)||controller?.ready(id);});}
  function materialize(item){
    if(!item?.queryRowV152)return item;
    if(!ready(item))return null;
    var ids=new Set(idsFor([item])),masters=(global.allItems||[]).filter(function(row){return ids.has(String(row.propertyId));});
    var projected=global.getFilteredItems({items:masters,queryLegacyV152:true,ignoreMapBounds:true,includeUnlocated:true});
    return projected.find(function(row){return String(row.propertyId)===String(item.propertyId);})||projected[0]||null;
  }
  function prepare(items,done){
    if(!active()||Number(global.newListingDays||0)===1||items.every(ready))return false;
    var view=controller.snapshot(),ids=idsFor(items),key=view.revision+'|'+ids.join(',');
    if(!preparing.has(key)){
      var task=controller.hydrate(ids).then(function(){return true;}).catch(function(error){
        if(controller.snapshot()===view&&ids.every(function(id){return controller.ready(id);}))return true;
        if(error.code==='QUERY_CHANGED')load(true,true);else if(error.code!=='QUERY_SUPERSEDED')console.warn('표시할 매물 준비 실패',error.message);
        return false;
      }).finally(function(){preparing.delete(key);});preparing.set(key,task);
    }
    preparing.get(key).then(function(ok){if(ok&&controller.snapshot()===view){if(view.overridden)global.applyFilter();else done();}});
    return true;
  }
  function prepareList(items,done){
    return prepare(listTargets(items),done);
  }
  function prefetch(){
    if(!active()||loading||Number(global.newListingDays||0)===1)return;
    var end=Number(global.listRenderLimit||36),next=(global.visibleListItems||[]).slice(end,end+36);
    if(next.length&&!next.every(ready))controller.hydrate(idsFor(next)).catch(function(){});
  }
  function navigationItems(){return active()?filtered({ignoreMapBounds:true,includeUnlocated:true}):global.allItems||[];}
  function queueLookup(property){
    if(lookupPending.has(property)||!active())return;
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
    var intent=++actionIntent;
    var view=controller.snapshot();
    var unknown=ids.map(String).filter(function(id){return !view.byId.has(id)&&
      (unscopedKnown.get(id)?.revision!==view.revision||unscopedKnown.get(id)?.master!==master(id));});
    if(unknown.length){controller.hydrate(unknown,{unscoped:true,force:true}).then(function(){
      if(controller.snapshot()!==view)return;
      unknown.forEach(function(id){unscopedKnown.set(id,{revision:view.revision,master:master(id)});});
      if(intent===actionIntent)run();
    }).catch(function(){});return true;}
    if(ids.every(function(id){return !view.byId.has(String(id))||confirmed.has(String(id))||controller.ready(String(id));}))return false;
    var rows=ids.map(function(id){return history.get(String(id))||master(String(id));}).filter(Boolean);
    return prepare(rows,function(){if(intent===actionIntent)run();});
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
    if(ids.every(function(id){return Date.now()-(receiptMarks.get(id)||0)<5000;})){await loading?.promise;await poll();return true;}
    receiptFence(ids);clearTimeout(saveTimer);saveTimer=0;
    await load(true,true);return true;
  }
  function receiptFence(ids){
    ids.forEach(function(id){confirmed.add(id);receiptMarks.set(id,Date.now());});
    try{localStorage.setItem(epochKey(),JSON.stringify({token:Date.now()+'-'+Math.random(),ids:ids}));}catch{}
    controller?.invalidate(ids);baseViews.clear();
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
    prepare:prepare,prepareList:prepareList,prefetch:prefetch,navigationItems:navigationItems,lookup:lookup,guardKey:guardKey,
    guardIds:guardIds,poll:poll,afterMutation:afterMutation,metadata:metadata,typeItems:function(){return(indexView?.rows||[]).concat(global.allItems||[]);}};
  global.addEventListener('js-auth-required',function(){clearTimeout(retryTimer);clearTimeout(lookupTimer);clearTimeout(patchTimer);receiptPatches.clear();lookupTimer=0;lookupQueue.clear();lookupPending.clear();initialWarm=null;initialCacheWarm=null;previewWarm=null;publishedSignature='';if(controller)controller.clear().catch(function(){});controller=null;indexView=null;history.clear();confirmed.clear();baseViews.clear();unscopedKnown.clear();});
  global.addEventListener('storage',function(event){if(!active()||event.key!==epochKey())return;
    clearTimeout(patchTimer);receiptPatches.clear();
    var ids=[];try{ids=JSON.parse(event.newValue||'{}').ids||[];}catch{}
    controller.invalidate(Array.isArray(ids)?ids.filter(function(id){return typeof id==='string';}):[]);baseViews.clear();
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
