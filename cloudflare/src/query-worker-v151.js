import {handleD1GetAction} from './d1-api.js';
import {listingReadEnv} from './listing-read-retry.js';
import {createListingQueryRuntimeV151} from '../generated/query-runtime-v151.js';
import {queryOriginalReducerV151} from './query-stream-v151.js';
import {runSnapshotQueryV151,querySnapshotInventoryV151} from './query-engine-v151.js';
import {querySourceV152} from './query-source-v152.js';
import {buildSheetSnapshot,buildUnifiedSnapshot} from './bounded-snapshot-build.js';
import {queryCardMediaV159} from './query-card-media-v159.js';
import {queryDeltaV160} from './query-delta-v160.js';
import {preparedQuerySheetV175,QUERY_SALE_FIELDS_V175} from './query-sheet-v175.js';

const REVISION='api-cache/revision/listings.json';
const KEYS={lease:['api-cache/d1-sheet-lease-v133-critical.csv','api-cache/query-metadata-v152-lease.json'],
  all:['api-cache/query-sheet-sales-v153.csv','api-cache/query-metadata-sales-v153.json']};
const INPUTS=new Set(['keyword','typeFilter','sourceFilter','floorQuickFilter','brokerageFeeFilter','sortFilter','industryFilter',
  'minDeposit','maxDeposit','minRent','maxRent','minPremium','maxPremium','minArea','maxArea','minFloor','maxFloor',
  'saleLandMin','saleLandMax','saleGrossMin','saleGrossMax','saleYieldMin','saleYieldMax','saleUnitPriceMin','saleUnitPriceMax',
  'saleCategoryFilter','saleLandUseFilter','saleZoningFilter']);
const WIRE_FIELDS=['propertyId','key','name','address','room','type','state','source','latitude','longitude','tradeType','saleCategory',
  'sourceAllUnavailableV1','unifiedOriginalCountV8','unifiedCandidateOriginalCountV2','unifiedActiveOriginalCountV2',
  'sourceTypesV8','sourceSnapshotKey','deposit','rent','fee','premium','area','displayValuePresence','floor','advertisedRoomV1',
  'sourceFloorVerifiedV1','salePrice','saleDetails','sheetRow','registrationAt','unifiedAbsenceConfirmedTimeV1',
  'queryGroupKeyV152','queryPendingVisitV152','queryConfirmedVisitV152','queryMatchedOriginalCountV152',
  'thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'];
const SALE_NAV_FIELDS=QUERY_SALE_FIELDS_V175;
const recentQueries=new Map();let recentBytes=0;
function rememberQuery(signature,text){
  if(text.length>2*1024*1024)return;
  if(recentQueries.has(signature))recentBytes-=recentQueries.get(signature).length;
  recentQueries.delete(signature);recentQueries.set(signature,text);recentBytes+=text.length;
  while(recentBytes>4*1024*1024||recentQueries.size>8){const key=recentQueries.keys().next().value;recentBytes-=recentQueries.get(key).length;recentQueries.delete(key);}
}

function failure(message,status=409){return Object.assign(new Error(message),{statusCode:status});}
function queryHeadersV152(token){return {'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-js-query-revision-v152':token,'x-js-query-schema':'readonly-v152'};}
function body(object){return object.httpMetadata?.contentEncoding==='gzip'?object.body.pipeThrough(new DecompressionStream('gzip')):object.body;}
async function revision(env){const object=await env.MEDIA.get(REVISION);if(!object)throw failure('목록 변경 기록을 확인하지 못했습니다.');return JSON.parse(await new Response(body(object)).text());}
export function queryChangesV151(state,since) {
  if(!state?.revision||!since)throw failure('목록 기준 시각이 없습니다.');
  if(state.revision===since)return [];
  const index=(state.history||[]).findIndex(entry=>entry.revision===since);
  if(index<0)throw failure('목록 변경 범위가 준비되지 않았습니다.');
  const changes=state.history.slice(index+1),ids=[...new Set(changes.flatMap(entry=>entry.changeIds||[]))];
  if(changes.some(entry=>entry.fullReload)||ids.length>1024)throw failure('전체 목록을 다시 준비해야 합니다.');
  return ids;
}
export function querySpecV151(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!['lease','building_sale','land_sale'].includes(raw.mode||'lease'))throw failure('조회 범위를 확인해 주세요.',400);
  const filters=Object.create(null);
  for(const [key,value] of Object.entries(raw.filters||{})) {
    if(!INPUTS.has(key)||typeof value!=='string'||value.length>300)throw failure('올바르지 않은 조회 조건입니다.',400);
    filters[key]=value;
  }
  const strings=value=>{
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>20000||value.some(entry=>typeof entry!=='string'||entry.length>500))throw failure('찜 조회 범위를 확인해 주세요.',400);
    return [...new Set(value)];
  };
  const days=Number(raw.newListingDays||0);
  if(!Number.isSafeInteger(days)||days<0||days>365||days===1)throw failure('오늘 매물은 전용 조회를 사용해야 합니다.',400);
  return {mode:raw.mode||'lease',filters,favoriteOnly:raw.favoriteOnly===true,favoriteKeys:strings(raw.favoriteKeys),
    favoriteFilterKeys:strings(raw.favoriteFilterKeys),favoriteFolderId:String(raw.favoriteFolderId||'').slice(0,200),
    hideDone:raw.hideDone!==false,doneOnly:raw.doneOnly===true,gongsilOnly:raw.gongsilOnly===true,newListingDays:days};
}
export function queryWireV151(rows,token){return {ok:true,version:152,grouping:'client-v152',revision:token,completeQuery:true,cardProjectionV157:true,total:rows.length,
  fields:WIRE_FIELDS,rows:rows.map(row=>WIRE_FIELDS.map(field=>{
    if(field==='saleDetails')return row.saleDetails?Object.fromEntries(SALE_NAV_FIELDS.filter(key=>Object.hasOwn(row.saleDetails,key)).map(key=>[key,row.saleDetails[key]])):null;
    if(field==='sourceTypesV8')return [...new Set(row.sourceTypesV8||[])];
    if(field==='registrationAt')return row.registrationAt||row.regDate||null;
    if(field==='querySelectedOriginalIdV152')return row[field]??row.unifiedDisplayOriginalsV2?.[0]?.originalId??null;
    if(field==='querySelectedPhotoCountV157'){const value=Number(row[field]??row.unifiedDisplayOriginalsV2?.[0]?.photoCount);return Number.isSafeInteger(value)&&value>=0?value:null;}
    return row[field]??null;
  }))};}
export function defaultQueryV151(spec){return !spec.favoriteOnly&&!spec.doneOnly&&!spec.gongsilOnly&&!spec.newListingDays&&spec.hideDone&&
  Object.entries(spec.filters).every(([name,value])=>!value||name==='sortFilter'&&value==='latest');}

export function queryPacketRowsV152(packet) {
  if(packet?.version!==152||packet.grouping!=='client-v152'||packet.completeQuery!==true||!Array.isArray(packet.fields)||
    !Array.isArray(packet.rows)||packet.total!==packet.rows.length||new Set(packet.fields).size!==packet.fields.length)throw failure('준비된 목록 형식을 확인하지 못했습니다.');
  const seen=new Set();
  return packet.rows.map(values=>{
    if(!Array.isArray(values)||values.length!==packet.fields.length)throw failure('준비된 목록이 완전하지 않습니다.');
    const row=Object.fromEntries(packet.fields.map((field,index)=>[field,values[index]]));
    if(typeof row.propertyId!=='string'||!row.propertyId||seen.has(row.propertyId)||!/^sha256-v1:[a-f0-9]{64}$/.test(row.sourceSnapshotKey))throw failure('준비된 원장 검증값이 다릅니다.');
    seen.add(row.propertyId);return row;
  });
}

// A confirmed memo/condition save must not rescan the entire catalog. This
// path is deliberately limited to IDs already present in a complete view.
// New/reappeared masters or missing history take the full verified build.
export async function patchPreparedQueryV152(env,state,spec,packet,readPoint=null) {
  if(!defaultQueryV151(spec))return null;
  let ids;try{ids=queryChangesV151(state,packet.revision);}catch{return null;}
  if(!ids.length||ids.length>50)return null;
  const previous=queryPacketRowsV152(packet),byId=new Map(previous.map(row=>[row.propertyId,row]));
  if(ids.some(id=>!byId.has(id)))return null;
  const helper=createListingQueryRuntimeV151([],null);
  const response=await (readPoint?readPoint(ids):handleD1GetAction(listingReadEnv(env),{},{action:'listingOriginals',ids:ids.join(',')}));
  if(!response?.ok||!Array.isArray(response.items)||!Array.isArray(response.requestedIds)||!Array.isArray(response.missingIds)||
    response.requestedIds.length!==ids.length||new Set(response.requestedIds).size!==ids.length||response.requestedIds.some(id=>!ids.includes(id)))throw failure('변경 조회 범위를 확인하지 못했습니다.');
  const expanded=helper.expand(response.unified),seen=new Set(),masters=[];
  for(const row of response.items) {
    const id=String(row.property_id||row.id);
    if(!ids.includes(id)||seen.has(id))throw failure('다른 원장 변경이 수신되었습니다.');seen.add(id);
    const item=helper.rawMaster(row,Number(byId.get(id).sheetRow||1)-1);
    if(expanded.sourceSnapshotKeys[id]!==item.sourceSnapshotKey||expanded.sourceSnapshotPropertyIds[id]!==id||
      !Array.isArray(expanded.groups[id]))throw failure('변경 원본의 연결을 확인하지 못했습니다.');
    masters.push(item);
  }
  for(const id of response.missingIds){if(!ids.includes(id)||seen.has(id))throw failure('제외 범위를 확인하지 못했습니다.');seen.add(id);}
  if(seen.size!==ids.length)throw failure('변경 조회 결과가 누락되었습니다.');
  const runtime=createListingQueryRuntimeV151(masters,expanded);
  const changed=runtime.query({...spec,ignoreMapBounds:true,includeUnlocated:true,deferFinalize:true}).map(item=>({...item,
    queryGroupKeyV152:runtime.groupKey(item.propertyId),...runtime.visitFlags(item),
    queryMatchedOriginalCountV152:(item.unifiedDisplayOriginalsV2||[]).length,
    querySelectedOriginalIdV152:item.unifiedDisplayOriginalsV2?.[0]?.originalId||''}));
  const replaced=new Set(ids),merged=previous.filter(row=>!replaced.has(row.propertyId)).concat(changed);
  return queryWireV151(helper.finalize(merged,{...spec,individualQueryV152:true}),state.revision);
}

export async function currentBaseProofsV175(env,state,spec){
  if(spec.hideDone===false||spec.doneOnly||spec.newListingDays===1)return null;
  const object=await env.MEDIA.get('api-cache/query-view-v157-'+spec.mode+'.json');
  if(object?.customMetadata?.revision!==state.revision){await object?.body?.cancel();return null;}
  try{const packet=await new Response(body(object)).json();
    if(packet.revision!==state.revision)return null;
    return new Map(queryPacketRowsV152(packet).map(row=>[row.propertyId,row.sourceSnapshotKey]));
  }catch{return null;}
}
async function queryAttemptV153(env,state,spec,forceMetadata=false) {
  const startedV175=Date.now(),traceV175=crypto.randomUUID();
  const markV175=(stage,count)=>console.info('query-v175',JSON.stringify({trace:traceV175,stage,ms:Date.now()-startedV175,mode:spec.mode,count}));
  markV175('start');
  const helper=createListingQueryRuntimeV151([],null),scope=spec.mode==='lease'?'lease':'all',keys=KEYS[scope];
  const sourceHead=await env.MEDIA.head(keys[1]),epoch=String(state.collectorRevisionV142||'');
  let sourceUsable=!!sourceHead&&!!epoch&&String(sourceHead.customMetadata?.collectorRevisionV142||'')===epoch;
  if(sourceHead&&!sourceUsable)try{queryChangesV151(state,sourceHead.customMetadata?.revision||'');sourceUsable=true;}catch{}
  if(forceMetadata||!sourceUsable)
    await buildUnifiedSnapshot(env,keys[1],state.revision,{}, {action:'unifiedListings',leaseOnly:scope==='lease',
      gzipSnapshot:true,deferPhotoLists:true,queryMetadataV152:true,saleOnlyV152:scope==='all',collectorRevisionV142:epoch});
  markV175('source-ready');
  const originalObject=await env.MEDIA.get(keys[1]);if(!originalObject)throw failure('검색 자료가 아직 준비되지 않았습니다.',503);
  const originalEtag=originalObject.etag,originalRevision=originalObject.customMetadata?.revision||'';
  const currentEpoch=String(state.collectorRevisionV142||'');
  const originalChanges=currentEpoch&&String(originalObject.customMetadata?.collectorRevisionV142||'')===currentEpoch?
    []:queryChangesV151(state,originalRevision);
  const prepared=await querySourceV152(env.MEDIA,scope,keys[1],originalObject,helper.firstThumbnail),metadata=prepared.metadata;
  markV175('index-ready');
  try{
  let csvObject=await env.MEDIA.get(keys[0]);
  let refreshCsv=!csvObject;try{if(csvObject)queryChangesV151(state,csvObject.customMetadata?.revision||'');}catch{refreshCsv=true;}
  if(refreshCsv){await csvObject?.body?.cancel();await buildSheetSnapshot(env,keys[0],state.revision,scope==='lease',true,scope==='all');csvObject=await env.MEDIA.get(keys[0]);}
  if(!csvObject)throw failure('목록 자료가 아직 준비되지 않았습니다.',503);
  const csvRevision=csvObject.customMetadata?.revision||'';
  const csvChanges=queryChangesV151(state,csvRevision);
  const items=await preparedQuerySheetV175(env.MEDIA,keys[0],csvObject,helper);
  markV175('masters-ready',items.length);
  const currentProofs=await currentBaseProofsV175(env,state,spec);
  const candidates=currentProofs?items.filter(item=>currentProofs.has(item.propertyId)):items;
  if(currentProofs)for(const item of items)if(!currentProofs.has(item.propertyId))item.queryCsvFieldsV175=null;
  const inventory=querySnapshotInventoryV151(candidates,metadata),unverified=new Set(inventory.pending);
  const pending=[...new Set([...csvChanges,...originalChanges,...inventory.pending])].filter(id=>
    !currentProofs||currentProofs.has(id)&&(!inventory.byId.has(id)||unverified.has(id)||currentProofs.get(id)!==inventory.byId.get(id).sourceSnapshotKey));
  markV175('repair-count',pending.length);
  if(pending.length>1024){await prepared.stream.cancel();if(!forceMetadata)return null;throw failure('최신 목록 연결을 다시 준비해야 합니다.');}
  const byId=new Map(candidates.map(item=>[item.propertyId,item])),repairs=new Map(),readEnv=listingReadEnv(env);
  for(let start=0;start<pending.length;start+=50) {
    const ids=pending.slice(start,start+50),response=await handleD1GetAction(readEnv,{}, {action:'listingOriginals',ids:ids.join(',')});
    if(!response?.ok||!Array.isArray(response.items)||!Array.isArray(response.missingIds))throw failure('변경 매물 연결을 확인하지 못했습니다.');
    const expanded=helper.expand(response.unified),reduce=queryOriginalReducerV151(helper.firstThumbnail),seen=new Set();
    for(const row of response.items) {
      const previous=byId.get(String(row.property_id||row.id));
      const item=helper.rawMaster(row,previous?previous.sheetRow-1:byId.size+1),id=item.propertyId;
      if(!ids.includes(id)||seen.has(id))throw failure('다른 원장의 변경 응답이 수신되었습니다.');seen.add(id);
      const originals=reduce(expanded.groups[id],id,expanded),proof=expanded.sourceSnapshotKeys[id];
      if(proof!==item.sourceSnapshotKey||!/^sha256-v1:[a-f0-9]{64}$/.test(proof))throw failure('변경 원본 검증값이 다릅니다.');
      byId.set(id,item);repairs.set(id,{item,originals,proof,sourceIds:expanded.sourceSearchIds?.[id]||[]});
    }
    for(const id of response.missingIds) {if(!ids.includes(id)||seen.has(id))throw failure('삭제 범위를 확인하지 못했습니다.');seen.add(id);byId.delete(id);repairs.delete(id);}
    if(seen.size!==ids.length)throw failure('변경 응답이 완전하지 않습니다.');
  }
  markV175('repairs-ready',pending.length);
  if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
  const source=await env.MEDIA.head(keys[1]);
  if(!source||source.etag!==originalEtag){await prepared.stream.cancel();throw failure('조회 원본 파일이 교체되었습니다.');}
  const result=await runSnapshotQueryV151({items:[...byId.values()],metadata,stream:prepared.stream,repairs},{...spec,individualQueryV152:true});
  if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
  markV175('result-ready',result.length);
  return queryWireV151(result,state.revision);
  }finally{await prepared.stream.cancel().catch(()=>{});}
}

async function loadAndQuery(env,state,spec){
  const first=await queryAttemptV153(env,state,spec);
  // End the first allocation frame before preparing a replacement metadata
  // generation. Retaining its full CSV beside a second build exceeds 128MB.
  return first||queryAttemptV153(env,state,spec,true);
}

async function compactInputsReadyV175(env,spec){
  if(spec.mode==='lease')return true;
  const keys=KEYS.all;
  const heads=await Promise.all([env.MEDIA.head(keys[0]),env.MEDIA.head(keys[1]),env.MEDIA.head(keys[0]+'.query-v175-gzip.jsonl'),env.MEDIA.head('api-cache/query-original-index-v175-all.json.meta')]);
  return !!heads[0]&&!!heads[1]&&heads[2]?.customMetadata?.sourceEtag===heads[0].etag&&heads[3]?.customMetadata?.sourceEtag===heads[1].etag;
}
export async function privateListingQueryV151(request,env,context) {
  if(request.method!=='POST')return Response.json({ok:false,message:'Method not allowed'},{status:405});
  if(!env.MEDIA||!env.DB)throw failure('조회 연결이 준비되지 않았습니다.',503);
  const text=await request.text();if(text.length>256*1024)throw failure('조회 조건이 너무 큽니다.',413);
  const input=JSON.parse(text),spec=querySpecV151(input.spec),state=await revision(env);
  const warm=request.headers.get('x-js-query-warm-v152')==='1';
  if(!(input.resolveCurrentV160===true&&input.revision===undefined)&&input.revision!==state.revision)throw failure('목록 기준이 변경되었습니다.');
  if(Object.hasOwn(input,'since')&&JSON.stringify(input.fields)===JSON.stringify(WIRE_FIELDS)){
    const loadPacket=async()=>{
      const response=await privateListingQueryV151(new Request('https://listing-query.internal/',{method:'POST',body:JSON.stringify({revision:state.revision,spec})}),env,context);
      return response.ok?response.json():null;
    };
    const delta=await queryDeltaV160({state,since:input.since,changes:queryChangesV151,loadPacket});
    if(delta){
      if(!delta.unchanged&&(await revision(env)).revision!==state.revision)throw failure('목록 변경 중 다시 확인합니다.');
      return Response.json(delta,{headers:{...queryHeadersV152(state.revision),'x-js-query-schema':'readonly-delta-v160'}});
    }
  }
  if(Object.hasOwn(input,'mediaIds')){
    const media=await queryCardMediaV159({env,state,spec,ids:input.mediaIds,warm,common:defaultQueryV151(spec),loadPacket:async()=>{
      const result=await privateListingQueryV151(new Request('https://listing-query.internal/',{method:'POST',body:JSON.stringify({revision:state.revision,spec})}),env,context);
      if(!result.ok){await result.body?.cancel();throw failure('대표 사진 자료가 아직 준비되지 않았습니다.');}
      return result.json();
    }});
    if((await revision(env)).revision!==state.revision)throw failure('대표 사진 조회 중 목록이 갱신되었습니다.');
    return new Response(warm?null:JSON.stringify(media),{status:warm?204:200,headers:{...queryHeadersV152(state.revision),'x-js-query-schema':'readonly-media-v159'}});
  }
  const cachedKey='api-cache/query-view-v157-'+spec.mode+'.json',common=defaultQueryV151(spec);
  if(common) {
    const prepareCompact=warm&&!(await compactInputsReadyV175(env,spec));
    const head=warm&&typeof env.MEDIA.head==='function'?await env.MEDIA.head(cachedKey):null;
    if(head?.customMetadata?.revision===state.revision&&!prepareCompact)return new Response(null,{status:204,headers:queryHeadersV152(state.revision)});
    const cached=await env.MEDIA.get(cachedKey);
    if(cached?.customMetadata?.revision===state.revision&&!prepareCompact){if(warm)await cached.body.cancel();return new Response(warm?null:cached.body,{status:warm?204:200,headers:queryHeadersV152(state.revision)});}
    if(cached) {
      const packet=await new Response(body(cached)).json();
      const patched=await patchPreparedQueryV152(env,state,spec,packet);
      if(patched) {
        if((await revision(env)).revision!==state.revision)throw failure('갱신 중 목록 기준이 변경되었습니다.');
        const serialized=JSON.stringify(patched);
        await env.MEDIA.put(cachedKey,serialized,{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{revision:state.revision}});
        return new Response(warm?null:serialized,{status:warm?204:200,headers:queryHeadersV152(state.revision)});
      }
    }
  }
  const signature=state.revision+'|'+JSON.stringify(spec);
  if(!common&&recentQueries.has(signature))return new Response(recentQueries.get(signature),{headers:queryHeadersV152(state.revision)});
  let customCache=null;
  if(!common){
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(spec))));
    const hash=Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
    customCache={key:'api-cache/query-custom-v175-'+spec.mode+'-'+(digest[0]%4)+'.json',hash};
    const cached=await env.MEDIA.get(customCache.key);
    if(cached?.customMetadata?.revision===state.revision&&cached.customMetadata?.queryHash===hash)
      return new Response(cached.body,{headers:queryHeadersV152(state.revision)});
    await cached?.body?.cancel();
  }
  // Only completed immutable packets may cross invocation boundaries. A
  // canceled request can leave its I/O promise pending in a reused isolate;
  // awaiting that promise here blocked every later, unrelated filter.
  const task=loadAndQuery(env,state,spec);
  if(context?.waitUntil)context.waitUntil(task.catch(()=>{}));
  {
    const payload=await task,serialized=JSON.stringify(payload);
    if(!common)rememberQuery(signature,serialized);
    if(customCache){const save=env.MEDIA.put(customCache.key,serialized,{httpMetadata:{contentType:'application/json; charset=utf-8'},
      customMetadata:{revision:state.revision,queryHash:customCache.hash}});if(context?.waitUntil)context.waitUntil(save);else await save;}
    if(common) {
      const save=env.MEDIA.put(cachedKey,serialized,{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{revision:state.revision}});
      if(context?.waitUntil&&!warm)context.waitUntil(save);else await save;
    }
    return new Response(warm?null:serialized,{status:warm?204:200,headers:queryHeadersV152(state.revision)});
  }
}
export default {async fetch(request,env,context){try{return await privateListingQueryV151(request,env,context);}catch(error){return Response.json({ok:false,message:error.message},{status:error.statusCode||500});}}};
