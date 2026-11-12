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
import {preparedQueryTransferV189} from './query-transfer-v189.js';
import {preparedNavigationV217} from './query-navigation-v217.js';

const REVISION='api-cache/revision/listings.json';
const KEYS={lease:['api-cache/d1-sheet-lease-v133-critical.csv','api-cache/query-metadata-v152-lease.json'],
  all:['api-cache/query-sheet-sales-v184.csv','api-cache/query-metadata-sales-v184.json']};
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
let numericInputsV176=null;
function retainNumericInputsV176(value){
  // Completed plain data only; never an invocation's Promise or I/O stream.
  // Keep one revision and a bounded subset, not the complete writable catalog.
  let chars=0;const max=24*1024*1024;
  if(value.singleRows.length>25000)return;
  for(const row of value.singleRows){chars+=JSON.stringify(WIRE_FIELDS.map(field=>row[field]??null)).length;if(chars>max)return;}
  for(const item of value.items){chars+=JSON.stringify(item).length;if(chars>max)return;}
  for(const repair of value.repairs.values()){chars+=JSON.stringify(repair).length;if(chars>max)return;}
  for(const rows of Object.values(value.sourcePacket.groups)){chars+=JSON.stringify(rows).length;if(chars>max)return;}
  chars+=JSON.stringify({...value.sourcePacket,groups:{}}).length+JSON.stringify(value.metadata).length;
  if(chars<=max)numericInputsV176=value;
}
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
function validBuildingCatalogV210(packet, rows) {
  const catalog=packet.numericCatalogV177;
  if(catalog?.version!==177||catalog.format!=='row-deltas-v177'||catalog.complete!==true||catalog.revision!==packet.revision||
    JSON.stringify(packet.fields)!==JSON.stringify(WIRE_FIELDS)||!Array.isArray(catalog.groups)||catalog.groups.length>rows.length)return false;
  const byId=new Map(rows.map(row=>[row.propertyId,row])),seen=new Set(),originalIndex=WIRE_FIELDS.indexOf('querySelectedOriginalIdV152'),countIndex=WIRE_FIELDS.indexOf('queryMatchedOriginalCountV152');
  let count=0;
  for(const pair of catalog.groups){
    if(!Array.isArray(pair)||pair.length!==2||seen.has(pair[0])||!byId.has(pair[0])||!Array.isArray(pair[1])||pair[1].length<2||pair[1].length!==byId.get(pair[0]).queryMatchedOriginalCountV152)return false;
    seen.add(pair[0]);const originals=new Set();
    for(const delta of pair[1]){
      if(!Array.isArray(delta)||delta.length>WIRE_FIELDS.length||++count>100000)return false;
      const fields=new Map();
      for(const entry of delta){if(!Array.isArray(entry)||entry.length!==2||!Number.isSafeInteger(entry[0])||entry[0]<0||entry[0]>=WIRE_FIELDS.length||fields.has(entry[0])||['propertyId','sourceSnapshotKey'].includes(WIRE_FIELDS[entry[0]]))return false;fields.set(entry[0],entry[1]);}
      const id=fields.has(originalIndex)?fields.get(originalIndex):byId.get(pair[0]).querySelectedOriginalIdV152;
      if(typeof id!=='string'||!id||originals.has(id)||(fields.has(countIndex)?fields.get(countIndex):byId.get(pair[0]).queryMatchedOriginalCountV152)!==1)return false;
      originals.add(id);
    }
  }
  return rows.every(row=>Number.isSafeInteger(row.queryMatchedOriginalCountV152)&&row.queryMatchedOriginalCountV152>=0&&(row.queryMatchedOriginalCountV152<=1||seen.has(row.propertyId)));
}

export async function patchPreparedQueryV152(env,state,spec,packet,readPoint=null) {
  if(!defaultQueryV151(spec)||packet.numericCatalogV177?.marketV215&&packet.numericCatalogV177.marketV215!==spec.mode)return null;
  let ids;try{ids=queryChangesV151(state,packet.revision);}catch{return null;}
  if(!ids.length||ids.length>50)return null;
  const previous=queryPacketRowsV152(packet),byId=new Map(previous.map(row=>[row.propertyId,row]));
  if(ids.some(id=>!byId.has(id)))return null;
  if((spec.mode==='building_sale'||packet.numericCatalogV177)&&!validBuildingCatalogV210(packet,previous))return null;
  const helper=createListingQueryRuntimeV151([],null);
  const response=await (readPoint?readPoint(ids):handleD1GetAction(listingReadEnv(env),{},{action:'listingOriginals',ids:ids.join(',')}));
  if(!response?.ok||!Array.isArray(response.items)||!Array.isArray(response.requestedIds)||!Array.isArray(response.missingIds)||
    response.requestedIds.length!==ids.length||new Set(response.requestedIds).size!==ids.length||response.requestedIds.some(id=>!ids.includes(id)))throw failure('변경 조회 범위를 확인하지 못했습니다.');
  const expanded=helper.expand(response.unified),seen=new Set(),masters=[];
  for(const row of response.items) {
    const id=String(row.property_id||row.id);
    if(!ids.includes(id)||seen.has(id))throw failure('다른 원장 변경이 수신되었습니다.');seen.add(id);
    const item=helper.rawMaster(row,Number(byId.get(id).sheetRow||2)-2);
    if(expanded.sourceSnapshotKeys[id]!==item.sourceSnapshotKey||expanded.sourceSnapshotPropertyIds[id]!==id||
      !Array.isArray(expanded.groups[id]))throw failure('변경 원본의 연결을 확인하지 못했습니다.');
    masters.push(item);
  }
  for(const id of response.missingIds){if(!ids.includes(id)||seen.has(id))throw failure('제외 범위를 확인하지 못했습니다.');seen.add(id);}
  if(seen.size!==ids.length)throw failure('변경 조회 결과가 누락되었습니다.');
  if(validBuildingCatalogV210(packet,previous)){
    const numericGroups=new Map();
    const changed=await runSnapshotQueryV151({items:masters,metadata:expanded,sourcePacketV176:expanded,
      captureNumericV177:row=>{const rows=numericGroups.get(row.propertyId)||[];rows.push(row);numericGroups.set(row.propertyId,rows);}},
      {...spec,individualQueryV152:true});
    const replaced=new Set(ids),merged=helper.finalize(previous.filter(row=>!replaced.has(row.propertyId)).concat(changed),{...spec,individualQueryV152:true});
    const result=queryWireV151(merged,state.revision),changedPacket=numericCatalogPacketV177(changed,numericGroups,state.revision,spec.mode);
    result.numericCatalogV177={...changedPacket.numericCatalogV177,groups:packet.numericCatalogV177.groups.filter(pair=>!replaced.has(pair[0])).concat(changedPacket.numericCatalogV177.groups)};
    if(!validBuildingCatalogV210(result,queryPacketRowsV152(result)))throw failure('변경 후 광고별 필터 자료를 확인하지 못했습니다.');
    return result;
  }
  const runtime=createListingQueryRuntimeV151(masters,expanded);
  const changed=runtime.query({...spec,ignoreMapBounds:true,includeUnlocated:true,deferFinalize:true}).map(item=>({...item,
    queryGroupKeyV152:runtime.groupKey(item.propertyId),...runtime.visitFlags(item),
    queryMatchedOriginalCountV152:(item.unifiedDisplayOriginalsV2||[]).length,
    querySelectedOriginalIdV152:item.unifiedDisplayOriginalsV2?.[0]?.originalId||''}));
  const replaced=new Set(ids),merged=previous.filter(row=>!replaced.has(row.propertyId)).concat(changed);
  return queryWireV151(helper.finalize(merged,{...spec,individualQueryV152:true}),state.revision);
}

export async function currentBaseRowsV176(env,state,spec){
  if(spec.hideDone===false||spec.doneOnly||spec.newListingDays===1)return null;
  const object=await env.MEDIA.get('api-cache/query-view-'+(spec.mode==='building_sale'?'v184-':'v215-')+spec.mode+'.json');
  if(object?.customMetadata?.revision!==state.revision){await object?.body?.cancel();return null;}
  try{const packet=await new Response(body(object)).json();
    if(packet.revision!==state.revision)return null;
    return queryPacketRowsV152(packet);
  }catch{return null;}
}
export async function currentBaseProofsV175(env,state,spec){
  const rows=await currentBaseRowsV176(env,state,spec);
  return rows?new Map(rows.map(row=>[row.propertyId,row.sourceSnapshotKey])):null;
}
export function numericSinglePlanV176(rows,spec){
  // Only pass rows from currentBaseRowsV176: complete, exact-revision and
  // identity-validated. With one eligible ad, extra conditions only remove it.
  const allowed=new Set(['minDeposit','maxDeposit','saleLandMin','saleLandMax','saleGrossMin','saleGrossMax','saleYieldMin','saleYieldMax','saleCategoryFilter']);
  const output=new Map();
  if(!rows||spec.mode!=='building_sale'||spec.hideDone===false||spec.doneOnly||spec.gongsilOnly||spec.newListingDays||spec.favoriteOnly||
    Object.entries(spec.filters||{}).some(([key,value])=>value&&!allowed.has(key)&&!(key==='sortFilter'&&value==='latest')))return output;
  const helper=createListingQueryRuntimeV151([],null);
  for(const row of rows){
    if(row.queryMatchedOriginalCountV152!==1||!row.querySelectedOriginalIdV152)continue;
    output.set(row.propertyId,helper.preparedMatchesV176(row,spec)?row:null);
  }
  return output;
}
export function numericCatalogPacketV177(rows,numericGroups,token,mode='building_sale'){
  const packet=queryWireV151(rows,token),groups=[],baseRows=new Map(packet.rows.map(values=>[values[0],values]));
  for(const row of rows){if(row.queryMatchedOriginalCountV152<=1)continue;
    const candidates=numericGroups.get(row.propertyId);
    if(candidates?.length!==row.queryMatchedOriginalCountV152)throw failure('광고별 필터 자료가 완전하지 않습니다.');
    const base=baseRows.get(row.propertyId);
    const candidateRows=queryWireV151(candidates.map(candidate=>({...candidate,queryGroupKeyV152:row.queryGroupKeyV152,queryPendingVisitV152:row.queryPendingVisitV152,queryConfirmedVisitV152:row.queryConfirmedVisitV152})),token).rows;
    groups.push([row.propertyId,candidateRows.map(values=>values.flatMap((value,index)=>JSON.stringify(value)===JSON.stringify(base[index])?[]:[[index,value]]))]);
  }
  packet.numericCatalogV177={version:177,format:'row-deltas-v177',complete:true,revision:token,marketV215:mode,groups};return packet;
}

async function queryAttemptV153(env,state,spec,forceMetadata=false) {
  const startedV175=Date.now(),traceV175=crypto.randomUUID();
  const markV175=(stage,count)=>console.info('query-v175',JSON.stringify({trace:traceV175,stage,ms:Date.now()-startedV175,mode:spec.mode,count}));
  markV175('start');
  const helper=createListingQueryRuntimeV151([],null),scope=spec.mode==='lease'?'lease':'all',keys=KEYS[scope];
  let cached=numericInputsV176;
  const cachedPlan=numericSinglePlanV176(cached?.revision===state.revision?cached.singleRows:null,spec);
  if(cachedPlan.size&&!defaultQueryV151(spec)){
    markV175('numeric-input-cache',cached.items.length);
    const rows=await runSnapshotQueryV151({items:cached.items.map(item=>({...item})),metadata:cached.metadata,
      repairs:cached.repairs,sourcePacketV176:cached.sourcePacket},{...spec,individualQueryV152:true});
    const result=helper.finalize([...rows,...[...cachedPlan.values()].filter(Boolean)],{...spec,individualQueryV152:true});
    if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
    markV175('result-ready',result.length);return queryWireV151(result,state.revision);
  }
  numericInputsV176=null;cached=null;
  let baseRows=await currentBaseRowsV176(env,state,spec);
  const currentProofs=baseRows?new Map(baseRows.map(row=>[row.propertyId,row.sourceSnapshotKey])):null;
  const captureCatalog=defaultQueryV151(spec);
  const numericGroups=new Map();
  const captureNumericV177=captureCatalog?row=>{const rows=numericGroups.get(row.propertyId)||[];rows.push(row);numericGroups.set(row.propertyId,rows);}:null;
  const finishPacket=rows=>captureCatalog?numericCatalogPacketV177(rows,numericGroups,state.revision,spec.mode):queryWireV151(rows,state.revision);
  const singlePlan=numericSinglePlanV176(baseRows,spec);
  const singleRows=singlePlan.size?baseRows.filter(row=>singlePlan.has(row.propertyId)):null;
  const remainingIds=singlePlan.size?new Set(baseRows.filter(row=>!singlePlan.has(row.propertyId)).map(row=>row.propertyId)):null;
  baseRows=null;
  if(remainingIds?.size===0){
    if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
    return finishPacket(helper.finalize([...singlePlan.values()].filter(Boolean),{...spec,individualQueryV152:true}));
  }
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
  const prepared=await querySourceV152(env.MEDIA,scope,keys[1],originalObject,helper.firstThumbnail,remainingIds),metadata=prepared.metadata;
  markV175('index-ready');
  try{
  let csvObject=await env.MEDIA.get(keys[0]);
  let refreshCsv=!csvObject;try{if(csvObject)queryChangesV151(state,csvObject.customMetadata?.revision||'');}catch{refreshCsv=true;}
  if(refreshCsv){await csvObject?.body?.cancel();await buildSheetSnapshot(env,keys[0],state.revision,scope==='lease',true,scope==='all');csvObject=await env.MEDIA.get(keys[0]);}
  if(!csvObject)throw failure('목록 자료가 아직 준비되지 않았습니다.',503);
  const csvRevision=csvObject.customMetadata?.revision||'';
  const csvChanges=queryChangesV151(state,csvRevision);
  const items=await preparedQuerySheetV175(env.MEDIA,keys[0],csvObject,helper,remainingIds);
  markV175('masters-ready',items.length);
  const candidates=currentProofs?items.filter(item=>currentProofs.has(item.propertyId)):items;
  if(currentProofs)for(const item of items)if(!currentProofs.has(item.propertyId))item.queryCsvFieldsV175=null;
  const inventory=querySnapshotInventoryV151(candidates,metadata),unverified=new Set(inventory.pending);
  const pending=[...new Set([...csvChanges,...originalChanges,...inventory.pending])].filter(id=>
    !singlePlan.has(id)&&(!currentProofs||currentProofs.has(id)&&(!inventory.byId.has(id)||unverified.has(id)||currentProofs.get(id)!==inventory.byId.get(id).sourceSnapshotKey)));
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
  markV175('prepared-single-count',singlePlan.size);
  if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
  const source=await env.MEDIA.head(keys[1]);
  if(!source||source.etag!==originalEtag){await prepared.stream.cancel();throw failure('조회 원본 파일이 교체되었습니다.');}
  const templates=singlePlan.size?[...byId.values()].map(item=>({...item})):null;let sourcePacket=null;
  let result=await runSnapshotQueryV151({items:[...byId.values()],metadata,stream:prepared.stream,repairs,
    captureNumericV177,captureSourceV176:templates?packet=>{sourcePacket=packet;}:null},{...spec,individualQueryV152:true});
  if(singlePlan.size)result=helper.finalize([...result,...[...singlePlan.values()].filter(Boolean)],{...spec,individualQueryV152:true});
  if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
  if(sourcePacket)retainNumericInputsV176({revision:state.revision,singleRows,items:templates,metadata,repairs,sourcePacket});
  markV175('result-ready',result.length);
  return finishPacket(result);
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
  if(!heads[0]||!heads[1]||heads[2]?.customMetadata?.sourceEtag!==heads[0].etag||heads[3]?.customMetadata?.sourceEtag!==heads[1].etag)return false;
  if(spec.mode==='building_sale')return (await env.MEDIA.head('api-cache/query-numeric-v176-building_sale.json.meta'))?.customMetadata?.sourceEtag===heads[1].etag;
  return true;
}
export async function privateListingQueryV151(request,env,context) {
  if(request.method!=='POST')return Response.json({ok:false,message:'Method not allowed'},{status:405});
  if(!env.MEDIA||!env.DB)throw failure('조회 연결이 준비되지 않았습니다.',503);
  const text=await request.text();if(text.length>256*1024)throw failure('조회 조건이 너무 큽니다.',413);
  const input=JSON.parse(text),spec=querySpecV151(input.spec),state=await revision(env);
  if(numericInputsV176&&numericInputsV176.revision!==state.revision)numericInputsV176=null;
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
  const cachedKey='api-cache/query-view-'+(spec.mode==='building_sale'?'v184-':'v215-')+spec.mode+'.json',common=defaultQueryV151(spec);
  if(input.navigationOnlyV217===true){
    if(!common||Object.hasOwn(input,'since')||warm)throw failure('초기 목록 조회 범위가 다릅니다.',400);
    const response=await preparedNavigationV217({env,key:cachedKey,revision:state.revision,headers:queryHeadersV152(state.revision),context,
      loadFull:()=>privateListingQueryV151(new Request('https://listing-query.internal/',{method:'POST',headers:{'x-js-query-cache-wait-v189':'1'},
        body:JSON.stringify({revision:state.revision,spec})}),env,context)});
    if((await revision(env)).revision!==state.revision){await response.body?.cancel();throw failure('초기 목록 조회 중 자료가 갱신되었습니다.');}
    return response;
  }
  const transferMode=request.headers.get('x-js-snapshot-mode');
  if(['manifest-v128','chunk-v128'].includes(transferMode)&&['building_sale','land_sale'].includes(spec.mode)&&defaultQueryV151(spec)&&!Object.hasOwn(input,'since')){
    const transferred=await preparedQueryTransferV189(env,spec,state.revision,request,()=>privateListingQueryV151(new Request('https://listing-query.internal/',{method:'POST',headers:{'x-js-query-cache-wait-v189':'1'},body:JSON.stringify(input)}),env,context));
    if(transferred)return transferred;
  }
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
    const bareParcel=spec.mode==='building_sale'&&String(spec.filters.keyword||'').split(',').some(group=>/^\d+-\d+$/.test(group.replace(/\s+/g,'')));
    customCache={key:'api-cache/query-custom-'+(bareParcel?'v193-':'v184-')+spec.mode+'-'+(digest[0]%4)+'.json',hash};
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
      if(context?.waitUntil&&!warm&&request.headers.get('x-js-query-cache-wait-v189')!=='1')context.waitUntil(save);else await save;
    }
    return new Response(warm?null:serialized,{status:warm?204:200,headers:queryHeadersV152(state.revision)});
  }
}
export default {async fetch(request,env,context){try{return await privateListingQueryV151(request,env,context);}catch(error){return Response.json({ok:false,message:error.message},{status:error.statusCode||500});}}};
