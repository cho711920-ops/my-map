/* Query rows are read-only projections. Only verified exact-ID point reads
 * enter the application's writable master registry. No complete-catalog cache. */
(function(global){
  'use strict';
  function fail(message,code){var error=new Error(message);error.code=code||'QUERY_RESPONSE';return error;}
  function id(value){
    if(typeof value!=='string'||!value||value.length>100||value.trim()!==value)return false;
    for(var index=0;index<value.length;index++)if(value[index]===','||value.charCodeAt(index)<32)return false;
    return true;
  }
  function proof(value){return typeof value==='string'&&/^sha256-v1:[a-f0-9]{64}$/.test(value);}
  function decode(packet){
    if(!packet||packet.ok!==true||packet.version!==152||packet.grouping!=='client-v152'||packet.completeQuery!==true||
      typeof packet.revision!=='string'||!packet.revision||packet.revision==='0'||!Array.isArray(packet.fields)||
      new Set(packet.fields).size!==packet.fields.length||!Array.isArray(packet.rows)||packet.total!==packet.rows.length||packet.total>100000||
      !packet.fields.includes('propertyId')||!packet.fields.includes('sourceSnapshotKey')||
      packet.fields.some(function(name){return typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9]*$/.test(name)||
        /^(?:memo|landlordPhone|tenantPhone|contactListRaw|__proto__|constructor|prototype|latlng|queryRowV152)$/.test(name);}))throw fail('목록 응답을 확인하지 못했습니다.');
    if(packet.cardProjectionV157===true&&!['thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'].every(function(name){return packet.fields.includes(name);}))throw fail('목록 사진 연결을 확인하지 못했습니다.');
    var seen=new Set();
    var rows=packet.rows.map(function(values){
      if(!Array.isArray(values)||values.length!==packet.fields.length)throw fail('목록 응답이 완전하지 않습니다.');
      // A shared literal shape avoids one large dictionary object per pin on
      // mobile. Validated column names cannot overwrite prototype properties.
      var row={propertyId:'',key:'',name:'',address:'',room:'',type:'',state:'',source:'',latitude:null,longitude:null,
        tradeType:'',saleCategory:'',sourceAllUnavailableV1:false,unifiedOriginalCountV8:0,unifiedCandidateOriginalCountV2:0,
        unifiedActiveOriginalCountV2:0,sourceTypesV8:null,sourceSnapshotKey:'',deposit:0,rent:0,fee:0,premium:0,area:0,
        displayValuePresence:null,floor:null,advertisedRoomV1:'',sourceFloorVerifiedV1:false,salePrice:0,saleDetails:null,
        sheetRow:0,registrationAt:'',unifiedAbsenceConfirmedTimeV1:0,queryGroupKeyV152:'',queryPendingVisitV152:false,
        queryConfirmedVisitV152:false,queryMatchedOriginalCountV152:0,thumbnailV8:'',querySelectedOriginalIdV152:'',querySelectedPhotoCountV157:null,queryRowV152:true,latlng:null};
      packet.fields.forEach(function(field,index){row[field]=values[index];});
      if(!id(row.propertyId)||seen.has(row.propertyId)||!proof(row.sourceSnapshotKey))throw fail('목록 원장 연결을 확인하지 못했습니다.');
      if(row.queryGroupKeyV152!=null&&(typeof row.queryGroupKeyV152!=='string'||row.queryGroupKeyV152.length>200))throw fail('건물 묶음을 확인하지 못했습니다.');
      if(row.thumbnailV8!=null&&(typeof row.thumbnailV8!=='string'||row.thumbnailV8.length>8000)||
        row.querySelectedOriginalIdV152!=null&&(typeof row.querySelectedOriginalIdV152!=='string'||row.querySelectedOriginalIdV152.length>200)||
        row.querySelectedPhotoCountV157!=null&&(!Number.isInteger(row.querySelectedPhotoCountV157)||row.querySelectedPhotoCountV157<0))throw fail('목록 사진 항목을 확인하지 못했습니다.');
      row.regDate=row.registrationAt||'';
      seen.add(row.propertyId);row.queryRowV152=true;return row;
    });
    return {packet:packet,revision:packet.revision,rows:rows,byId:new Map(rows.map(function(row){return[row.propertyId,row];}))};
  }
  function combine(parts,expected,settings){
    settings=settings||{};
    var result={ok:true,items:[],missingIds:[],snapshotConsistency:'per-property-v1',unified:{ok:true,
      snapshotConsistency:'per-property-v1',groups:Object.create(null),sourceSearchIds:Object.create(null),
      sourceSnapshotKeys:Object.create(null),sourceSnapshotPropertyIds:Object.create(null)}};
    var seen=new Set(),schema='';
    parts.forEach(function(part){
      if(!part||part.ok!==true||!Array.isArray(part.items)||!Array.isArray(part.requestedIds)||!Array.isArray(part.missingIds)||
        (!settings.allowMissing&&part.missingIds.length)||!part.unified||part.unified.ok===false)throw fail('선택 매물의 상세 연결을 확인하지 못했습니다.','QUERY_CHANGED');
      var currentSchema=JSON.stringify([part.unified.format||'',part.unified.fields||null]);
      var compact=/^compact-v\d+$/.test(part.unified.format||'');
      if(compact&&(!Array.isArray(part.unified.fields)||new Set(part.unified.fields).size!==part.unified.fields.length||part.unified.fields.includes('propertyId')))
        throw fail('원본 항목 연결을 확인하지 못했습니다.');
      if(['groups','sourceSearchIds','sourceSnapshotKeys','sourceSnapshotPropertyIds'].some(function(name){
        return Object.keys(part.unified[name]||{}).some(function(property){return!part.requestedIds.includes(property);});
      }))throw fail('상세 응답이 선택 범위를 벗어났습니다.');
      if(schema&&schema!==currentSchema)throw fail('상세 항목 형식이 변경되었습니다.');schema=currentSchema;
      result.unified.format=part.unified.format;result.unified.fields=part.unified.fields;
      if(part.requestedIds.length!==part.items.length+part.missingIds.length||new Set(part.requestedIds).size!==part.requestedIds.length||
        part.requestedIds.some(function(value){return!expected.has(value);}))throw fail('다른 매물 응답이 수신되었습니다.');
      part.items.forEach(function(item){
        var property=String(item.property_id||item.id||'');
        if(!expected.has(property)||!part.requestedIds.includes(property)||seen.has(property)||!proof(item.source_snapshot_key)||
          (expected.get(property)&&expected.get(property)!==item.source_snapshot_key)||
          part.unified.sourceSnapshotKeys?.[property]!==item.source_snapshot_key||
          part.unified.sourceSnapshotPropertyIds?.[property]!==property||!Array.isArray(part.unified.groups?.[property]))
          throw fail('매물 자료가 변경되었습니다. 최신 목록을 다시 확인합니다.','QUERY_CHANGED');
        if(part.unified.groups[property].some(function(original){return compact?!Array.isArray(original):
          !original||Array.isArray(original)||original.propertyId!==property;}))throw fail('다른 원장의 광고가 수신되었습니다.');
        seen.add(property);
      });
      part.missingIds.forEach(function(property){if(!expected.has(property)||!part.requestedIds.includes(property)||seen.has(property))throw fail('제외 범위를 확인하지 못했습니다.');seen.add(property);});
      result.items.push.apply(result.items,part.items);
      result.missingIds.push.apply(result.missingIds,part.missingIds);
      ['groups','sourceSearchIds','sourceSnapshotKeys','sourceSnapshotPropertyIds'].forEach(function(name){Object.assign(result.unified[name],part.unified[name]||{});});
    });
    if(seen.size!==expected.size)throw fail('매물 상세 응답이 누락되었습니다.');
    return result;
  }
  function create(options){
    var snapshot=null,epoch=0,pending=null,known=new Map(),points=new Map(),pointPending=new Map(),dead=false,fence='';
    function account(){return String(options.account()||'').trim().toLowerCase();}
    function current(token,owner){return!dead&&epoch===token&&account()===owner&&(!options.fence||fence===options.fence());}
    function ready(property,view){
      var row=(view||snapshot)?.byId.get(property),master=options.master(property);
      return !!(row&&master&&!master.queryRowV152&&known.get(property)===row.sourceSnapshotKey&&master.sourceSnapshotKey===row.sourceSnapshotKey);
    }
    async function hydrate(properties,settings){
      settings=settings||{};
      var view=settings.snapshot||snapshot,token=epoch,owner=account();
      if(!view||!owner||dead)throw fail('로그인 상태와 목록을 확인해 주세요.','QUERY_ACCOUNT');
      var unique=Array.from(new Set(properties.map(String))),expected=new Map();
      unique.forEach(function(property){
        if(!id(property)||(!settings.unscoped&&!view.byId.has(property)))throw fail('선택 범위 밖의 매물입니다.');
        if(!settings.force&&ready(property,view))return;
        expected.set(property,settings.unscoped?null:view.byId.get(property).sourceSnapshotKey);
      });
      if(!expected.size)return true;
      var signature=owner+'|'+token+'|'+view.revision+'|'+JSON.stringify(Array.from(expected));
      if(pointPending.has(signature))return pointPending.get(signature).promise;
      if(!settings.force&&!settings.unscoped){
        var overlapping=Array.from(pointPending.values()).filter(function(work){return work.view===view&&work.token===token&&work.owner===owner&&
          Array.from(expected).some(function(entry){return work.expected.get(entry[0])===entry[1];});});
        if(overlapping.length){
          var completed=await Promise.allSettled(overlapping.map(function(work){return work.promise;}));
          if(!current(token,owner))throw fail('이전 상세 조회가 취소되었습니다.','QUERY_SUPERSEDED');
          if(unique.every(function(property){return ready(property,view);}))return true;
          var rejected=completed.find(function(value){return value.status==='rejected'&&value.reason?.code!=='QUERY_SUPERSEDED';});
          if(rejected)throw rejected.reason;
          return hydrate(properties,settings);
        }
      }
      var task=(async function(){
        var context=options.capture(),parts=[],ids=Array.from(expected.keys());
        for(var start=0;start<ids.length;start+=50){
          var response=await options.readPoints(ids.slice(start,start+50));
          if(!current(token,owner))throw fail('이전 상세 조회가 취소되었습니다.','QUERY_SUPERSEDED');parts.push(response);
        }
        var combined,changed=false;
        try{combined=combine(parts,expected);}catch(error){
          if(error.code!=='QUERY_CHANGED'||!options.reconcile)throw error;
          // A live, uncached primary point read may legitimately be newer than
          // the published query index while a collection is still running.
          // Its own parent/source proof must still agree exactly. Reproject
          // only those IDs; never certify a new global revision from them.
          combined=combine(parts,new Map(Array.from(expected.keys(),function(property){return[property,null];})),{allowMissing:true});
          if(options.canReconcile&&options.canReconcile(view)!==true)throw fail('다른 조회가 선택되었습니다.','QUERY_SUPERSEDED');
          changed=true;
        }
        if(!current(token,owner)||options.applyPoints(combined,context)!==true)throw fail('편집 중인 자료가 있어 이전 조회를 반영하지 않았습니다.','QUERY_SUPERSEDED');
        if(changed&&options.reconcile(view,combined)!==true)throw fail('변경 원장 투영을 완료하지 못했습니다.','QUERY_CHANGED');
        combined.missingIds.forEach(function(property){known.delete(property);points.delete(property);});
        combined.items.forEach(function(row){var property=String(row.property_id||row.id);
          var master=options.master(property);
          if(!master||master.queryRowV152||master.sourceSnapshotKey!==row.source_snapshot_key)throw fail('원장 검증을 완료하지 못했습니다.');
          known.set(property,row.source_snapshot_key);
          points.set(property,{row:row,unified:{ok:true,format:combined.unified.format,fields:combined.unified.fields,
            groups:{[property]:combined.unified.groups[property]},sourceSearchIds:{[property]:combined.unified.sourceSearchIds[property]||[]},
            sourceSnapshotKeys:{[property]:row.source_snapshot_key},sourceSnapshotPropertyIds:{[property]:property}}});
        });
        return true;
      })().finally(function(){pointPending.delete(signature);});
      pointPending.set(signature,{promise:task,view:view,token:token,owner:owner,expected:expected});return task;
    }
    async function store(view,token,owner){
      if(!options.cache||!current(token,owner))return;
      var ids=options.initialIds(view).slice(0,144),saved=[];
      ids.forEach(function(property){if(ready(property,view)&&points.has(property))saved.push(points.get(property));});
      var value={kind:'query-scope-v152',completeCatalog:false,account:owner,signature:view.signature,
        packet:view.packet,points:saved,savedAt:Date.now()};
      await options.cache.write(owner,value,function(){return current(token,owner);});
    }
    async function restore(spec,signature,token,owner){
      if(!options.cache)return null;
      var value=await options.cache.read(owner,signature);
      if(!current(token,owner)||!value||value.kind!=='query-scope-v152'||value.completeCatalog!==false||value.account!==owner||
        value.signature!==signature||!Array.isArray(value.points)||value.points.length>144)return null;
      var view=decode(value.packet);view.signature=signature;view.spec=spec;view.fresh=false;view.overridden=value.packet.perPropertyOverridesV152===true;
      options.index(view);
      var savedPoints=value.points.filter(function(saved){var property=String(saved.row?.property_id||saved.row?.id||''),master=options.master(property);
        return!master||master.sourceSnapshotKey===saved.row.source_snapshot_key;});
      if(savedPoints.length){
        var expected=new Map(),parts=savedPoints.map(function(saved){var property=String(saved.row?.property_id||saved.row?.id||'');
          if(!view.byId.has(property))throw fail('다른 범위의 캐시입니다.');expected.set(property,view.byId.get(property).sourceSnapshotKey);
          return {ok:true,items:[saved.row],requestedIds:[property],missingIds:[],unified:saved.unified};});
        var context=options.capture(),combined=combine(parts,expected);
        if(!current(token,owner)||options.applyPoints(combined,context)!==true)return null;
        savedPoints.forEach(function(saved){var property=String(saved.row.property_id||saved.row.id);known.set(property,saved.row.source_snapshot_key);points.set(property,saved);});
      }
      // A rotated/resized screen or a newly completed first card can expose
      // another window. Repair only its missing points instead of discarding
      // the complete read-only index and waiting for the full query transfer.
      for(var fill=0;fill<3&&!options.initialIds(view).every(function(property){return ready(property,view);});fill++)
        await hydrate(options.initialIds(view),{snapshot:view});
      if(!current(token,owner)||!options.initialIds(view).every(function(property){return ready(property,view);}))return null;
      snapshot=view;options.commit(view,{cached:true});return view;
    }
    async function load(spec,settings){
      settings=settings||{};
      var signature=JSON.stringify(spec),owner=account();
      if(!owner||dead)throw fail('로그인 상태를 확인해 주세요.','QUERY_ACCOUNT');
      if(pending&&pending.signature===signature&&!settings.force)return pending.promise;
      var token=++epoch,networkCommitted=false;fence=options.fence?options.fence():'';
      var restored=settings.cache===false?Promise.resolve(null):restore(spec,signature,token,owner).catch(function(){return null;});
      var task=(async function(){
        var packet=await options.readQuery(spec);
        if(!current(token,owner))return false;
        var view=decode(packet);view.signature=signature;view.spec=spec;view.recent=packet.recentQueryBaseV154===true;
        view.overridden=packet.perPropertyOverridesV152===true;view.fresh=!view.recent&&!view.overridden;
        await restored;
        if(!current(token,owner))return false;
        options.index(view);
        for(var fill=0;fill<8;fill++){
          var visible=options.initialIds(view);
          if(visible.every(function(property){return ready(property,view);}))break;
          await hydrate(visible,{snapshot:view});
        }
        if(!options.initialIds(view).every(function(property){return ready(property,view);}))throw fail('목록 변경이 계속되어 표시 범위를 다시 확인해야 합니다.','QUERY_CHANGED');
        if(!current(token,owner))return false;
        snapshot=view;networkCommitted=true;options.commit(view,{cached:false});
        await store(view,token,owner);return true;
      })().catch(async function(error){
        await restored;
        if(current(token,owner)&&!networkCommitted)options.error(error,!!snapshot&&snapshot.signature===signature);
        return false;
      }).finally(function(){if(pending?.token===token)pending=null;});
      pending={promise:task,signature:signature,token:token};return task;
    }
    return {load:load,hydrate:hydrate,ready:ready,snapshot:function(){return snapshot;},
      invalidate:function(properties){epoch++;fence=options.fence?options.fence():'';pending=null;(properties||[]).forEach(function(property){known.delete(String(property));points.delete(String(property));});},
      clear:async function(){var owner=account();epoch++;dead=true;pending=null;snapshot=null;known.clear();points.clear();
        if(options.cache)await options.cache.clear(owner);},
      cachedPoints:function(){return points.size;}};
  }
  global.JSQueryCollectionV152={create:create,decode:decode,combine:combine};
})(typeof window==='object'?window:globalThis);
