/* Bounded, account/proof/photo-bound image nodes. No writable listing cache. */
(function(global){
  'use strict';
  var pool=new Map(),queue=[],active=0,account='',generation=0;
  function owner(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function small(){return global.innerWidth<=768;}
  function discard(entry){if(!entry.taken){entry.image.removeAttribute('src');entry.cancel?.();}}
  function clear(){generation++;var entries=Array.from(pool.values());pool.clear();queue=[];entries.forEach(discard);account=owner();}
  function descriptor(item){return global.JSUnifiedListingsV8?.thumbnailDescriptorV159?.(item);}
  function key(item,photo){return [owner(),item.propertyId,item.sourceSnapshotKey||'',photo.originalId||'',photo.url].join('|');}
  function trim(){
    var max=small()?12:24,pixels=0;pool.forEach(function(entry){pixels+=entry.pixels||0;});
    for(var entry of pool.values()){
      if(pool.size<=max&&pixels<=(small()?6000000:12000000))break;
      pool.delete(entry.key);pixels-=entry.pixels||0;discard(entry);
    }
  }
  function pump(){while(active<3&&queue.length){var entry=queue.shift();if(pool.get(entry.key)===entry&&entry.state==='queued')start(entry);}}
  function start(entry){
    if(entry.state!=='queued')return;entry.state='loading';active++;
    var settled=false;
    function finish(ok){if(settled)return;settled=true;active--;entry.state=ok?'loaded':'error';
      if(ok){entry.pixels=(entry.image.naturalWidth||0)*(entry.image.naturalHeight||0);
        var decoded=typeof entry.image.decode==='function'?entry.image.decode():Promise.resolve();
        decoded.then(function(){if(entry.generation!==generation)return;entry.state='decoded';entry.image.dataset.thumbnailDecodedV159='true';measure();trim();},function(){});
      }else if(!entry.taken)pool.delete(entry.key);
      trim();pump();
    }
    entry.cancel=function(){finish(false);};
    entry.image.addEventListener('load',function(){finish(true);},{once:true});entry.image.addEventListener('error',function(){finish(false);},{once:true});
    entry.image.src=entry.photo.url;
  }
  function prefetch(items,settings){
    settings=settings||{};if(!owner()||typeof global.Image!=='function')return;
    if(account!==owner())clear();
    if(settings.background&&(global.navigator?.connection?.saveData||/^(?:slow-)?2g$/.test(global.navigator?.connection?.effectiveType||'')))return;
    var limit=settings.limit||(small()?8:12);
    (items||[]).slice(0,limit).forEach(function(item){
      var photo=descriptor(item);if(!photo?.url||!item.sourceSnapshotKey)return;
      var id=key(item,photo);if(pool.has(id))return;
      var image=new global.Image();image.decoding='async';image.referrerPolicy='no-referrer';image.fetchPriority=settings.background?'low':'high';
      image.setAttribute('data-thumbnail-source-v8144',photo.source);
      if(photo.cover){image.setAttribute('data-cover-image-v85',photo.cover);image.setAttribute('data-cover-fallback-v85',photo.originalUrl);}
      var entry={key:id,photo,image,state:'queued',generation,pixels:0,taken:false};pool.set(id,entry);queue.push(entry);
    });trim();pump();
  }
  function take(item){
    if(account!==owner()){clear();return null;}
    var photo=descriptor(item);if(!photo?.url)return null;
    var id=key(item,photo),entry=pool.get(id);if(!entry||entry.state==='error')return null;
    pool.delete(id);entry.taken=true;entry.image.fetchPriority='high';if(entry.state==='queued')start(entry);return entry.image;
  }
  function measure(){
    var timing=global.jsClusterThumbTimingV159;if(!timing||timing.intent!==global.jsClusterPaintIntentV158)return;
    var cards=Array.from(document.querySelectorAll('#list .item[data-property-id]')),photos=0,images=[];
    for(var id of timing.ids){
      var card=cards.find(function(node){return node.dataset.propertyId===id;});if(!card)return;
      if(card.dataset.thumbnailStateV159==='empty')continue;
      var image=card.querySelector('.unified-thumb-v8 img');
      if(!image||!image.complete||!image.naturalWidth||image.dataset.thumbnailDecodedV159!=='true')return;photos++;images.push([image,image.getAttribute('src')]);
    }
    if(timing.scheduled)return;timing.scheduled=true;
    global.requestAnimationFrame(function(){global.requestAnimationFrame(function(){
      if(global.jsClusterThumbTimingV159!==timing||timing.intent!==global.jsClusterPaintIntentV158)return;
      if(images.some(function(pair){return !pair[0].isConnected||pair[0].getAttribute('src')!==pair[1];})){timing.scheduled=false;measure();return;}
      document.documentElement.dataset.clusterPhotosPendingV159='false';document.documentElement.dataset.clusterPhotoCountV159=String(photos);
      document.documentElement.dataset.clusterPhotosReadyMsV159=photos?String(Math.round(global.performance.now()-timing.startedAt)):'';
    });});
  }
  global.JSQueryThumbsV159={prefetch:prefetch,take:take,clear:clear,measure:measure};
  global.addEventListener('js-auth-required',clear);
  global.addEventListener('storage',function(event){if(event.key&&event.key.indexOf('js-query-epoch-v152:')===0)clear();});
  global.addEventListener('js-master-persisted-v154',clear);
})(window);
