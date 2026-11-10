/* Shared, pure validation/matching. No listings, contacts or account state live here. */
(function(root){
  'use strict';
  var SCOPE='buildingRegistryV164',KEY='default',MAX_BYTES=512*1024;
  function fail(message){throw Object.assign(new Error(message),{statusCode:400});}
  function text(value,max){if(typeof value!=='string'||value.length>max||Array.from(value).some(function(c){return c.charCodeAt(0)<32;}))fail('건물 정보 형식을 확인해 주세요.');return value.trim();}
  function id(value){return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);}
  function parcel(value){
    var valueText=String(value||'').normalize('NFKC').replace(/^대한민국\s+/,'').replace(/^대전(?:광역시|시)?\s+/,'').replace(/\s+/g,' ').trim();
    var m=valueText.match(/^(동구|중구|서구|유성구|대덕구)\s+([가-힣]+\d*(?:동|가))\s+(산\s*)?(\d+)(?:-(\d+))?(?:번지)?$/);
    return m?'대전광역시 '+m[1]+' '+m[2]+' '+(m[3]?'산':'')+Number(m[4])+(m[5]&&Number(m[5])?'-'+Number(m[5]):''):'';
  }
  function phone(value){
    var n=String(value||'').replace(/[\s()-]/g,'');
    return /^(?:01[016789]\d{7,8}|02\d{7,8}|0[3-6][1-5]\d{7,8}|070\d{8})$/.test(n)&&!/^(?:010)?0+$/.test(n)?n:'';
  }
  function displayPhone(value){var n=phone(value);if(!n)return'';var head=n.startsWith('02')?2:3;return n.slice(0,head)+'-'+n.slice(head,-4)+'-'+n.slice(-4);}
  function list(value,max,check){if(!Array.isArray(value)||value.length>max)fail('건물 적용 범위가 너무 크거나 잘못되었습니다.');var out=[],seen=new Set();value.forEach(function(v){if(!check(v)||seen.has(v))fail('건물 적용 범위에 중복 또는 잘못된 항목이 있습니다.');seen.add(v);out.push(v);});return out;}
  function validate(value){
    if(!value||value.schema!==164||!Array.isArray(value.buildings)||!Array.isArray(value.contacts)||value.buildings.length+value.contacts.length>1000)fail('건물 설정 버전을 확인해 주세요.');
    if(JSON.stringify(value).length>MAX_BYTES||new TextEncoder().encode(JSON.stringify(value)).length>MAX_BYTES)fail('건물 설정 용량 한도를 초과했습니다.');
    var ids=new Set();
    function records(values,contactMode){var members=new Set(),auto=new Set(),allParcels=new Set();return values.map(function(b){
      if(!b||!id(b.id)||ids.has(b.id))fail('건물 식별자를 확인해 주세요.');ids.add(b.id);
      var parcels=list(b.parcels,30,function(p){return !!parcel(p)&&parcel(p)===p;});if(!parcels.length)fail('확인한 지번이 필요합니다.');
      var memberIds=list(b.memberIds,2000,id),excludedIds=list(b.excludedIds,2000,id),autoParcels=list(b.autoParcels,30,function(p){return parcels.includes(p);});
      if(!memberIds.length)fail('건물에 포함할 매물을 선택해 주세요.');
      memberIds.forEach(function(key){if(members.has(key)||!contactMode&&excludedIds.includes(key))fail('같은 매물이 다른 건물에 중복 연결되었습니다.');members.add(key);});
      autoParcels.forEach(function(p){if(auto.has(p))fail('같은 지번의 신규 매물 연결 범위가 겹칩니다. 먼저 기존 건물 묶음을 확인해 주세요.');auto.add(p);});
      var base={id:b.id,label:text(b.label,100),parcels:parcels,memberIds:memberIds,excludedIds:excludedIds,autoParcels:autoParcels};
      if(contactMode){
        parcels.forEach(function(p){if(allParcels.has(p))fail('이 지번에는 이미 별도 공통번호가 있습니다. 기존 설정을 먼저 확인해 주세요.');allParcels.add(p);});
        if(!phone(b.phone)||phone(b.phone)!==b.phone)fail('임대인 전화번호를 확인해 주세요.');
        if(!Array.isArray(b.baselines)||b.baselines.length!==memberIds.length)fail('개별 임대인 번호 비교 정보를 확인해 주세요.');
        var baselineIds=new Set(),baselines=b.baselines.map(function(row){
          if(!row||!memberIds.includes(row.id)||baselineIds.has(row.id)||typeof row.manual!=='boolean'||typeof row.phone!=='string'||row.phone!==''&&phone(row.phone)!==row.phone)fail('개별 임대인 번호 비교 정보가 다릅니다.');
          baselineIds.add(row.id);return{id:row.id,phone:row.phone,manual:row.manual};
        });
        return Object.assign(base,{phone:b.phone,baselines:baselines});
      }
      var anchor=b.anchor;if(!anchor||!Number.isFinite(anchor.lat)||!Number.isFinite(anchor.lng)||anchor.lat<32||anchor.lat>40||anchor.lng<124||anchor.lng>132)fail('건물 기준 위치를 확인해 주세요.');
      return Object.assign(base,{anchor:{lat:anchor.lat,lng:anchor.lng}});
    });}
    return{schema:164,buildings:records(value.buildings,false),contacts:records(value.contacts,true)};
  }
  function index(data){
    function make(values){var result={records:new Map(),members:new Map(),parcels:new Map(),knownParcels:new Map(),baselines:new Map()};
      values.forEach(function(b){result.records.set(b.id,b);b.memberIds.forEach(function(key){result.members.set(key,b);});b.autoParcels.forEach(function(p){result.parcels.set(p,b);});b.parcels.forEach(function(p){result.knownParcels.set(p,b);});if(b.baselines)result.baselines.set(b.id,new Map(b.baselines.map(function(row){return[row.id,row];})));});return result;}
    return{buildings:make(data.buildings),contacts:make(data.contacts)};
  }
  function buildingFor(view,item){
    var b=view.members.get(item.id)||view.parcels.get(item.parcel);
    return b&&!b.excludedIds.includes(item.id)&&b.parcels.includes(item.parcel)?b:null;
  }
  function contactFor(view,item){
    var b=buildingFor(view.contacts,item);if(!b)return null;
    var baseline=view.contacts.baselines.get(b.id)?.get(item.id),own=phone(item.phone);
    // A newer explicit individual number/clear wins. Original ad contacts are
    // never promoted to a manually confirmed landlord by this fallback.
    if(item.manual&&(!baseline||baseline.manual!==true||own!==baseline.phone)&&own!==b.phone)return null;
    return{phone:b.phone,display:displayPhone(b.phone),buildingId:b.id,label:b.label};
  }
  var core=Object.freeze({scope:SCOPE,key:KEY,maxBytes:MAX_BYTES,parcel:parcel,phone:phone,displayPhone:displayPhone,id:id,validate:validate,index:index,buildingFor:buildingFor,contactFor:contactFor});
  root.JSBuildingRegistryCoreV164=core;
})(typeof window==='object'?window:globalThis);
