import {handleD1GetAction} from './d1-api.js';
import {listingReadEnv} from './listing-read-retry.js';
import {createListingQueryRuntimeV151} from '../generated/query-runtime-v151.js';
import {readQueryOriginalsV151,queryOriginalReducerV151} from './query-stream-v151.js';
import {runSnapshotQueryV151,querySnapshotInventoryV151} from './query-engine-v151.js';

const REVISION='api-cache/revision/listings.json';
const KEYS={lease:['api-cache/d1-sheet-lease-v133-critical.csv','api-cache/unified-listings-lease-v123.json'],
  all:['api-cache/d1-sheet-v133-critical.csv','api-cache/unified-listings-v28-photo-paths-v119.json']};
const INPUTS=new Set(['keyword','typeFilter','sourceFilter','floorQuickFilter','brokerageFeeFilter','sortFilter','industryFilter',
  'minDeposit','maxDeposit','minRent','maxRent','minPremium','maxPremium','minArea','maxArea','minFloor','maxFloor',
  'saleLandMin','saleLandMax','saleGrossMin','saleGrossMax','saleYieldMin','saleYieldMax','saleUnitPriceMin','saleUnitPriceMax',
  'saleCategoryFilter','saleLandUseFilter','saleZoningFilter']);
const WIRE_FIELDS=['propertyId','key','name','address','room','type','state','source','latitude','longitude','tradeType','saleCategory',
  'sourceAllUnavailableV1','unifiedOriginalCountV8','unifiedCandidateOriginalCountV2','unifiedActiveOriginalCountV2',
  'sourceTypesV8','wholeBuildingMembersV55','sourceSnapshotKey','queryMemberProofsV151'];
let inFlight=null;

function failure(message,status=409){return Object.assign(new Error(message),{statusCode:status});}
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
export function queryWireV151(rows,token){return {ok:true,version:151,revision:token,completeQuery:true,total:rows.length,
  fields:WIRE_FIELDS,rows:rows.map(row=>WIRE_FIELDS.map(field=>row[field]??null))};}
export function defaultQueryV151(spec){return !spec.favoriteOnly&&!spec.doneOnly&&!spec.gongsilOnly&&!spec.newListingDays&&spec.hideDone&&
  Object.entries(spec.filters).every(([name,value])=>!value||name==='sortFilter'&&value==='latest');}

async function loadAndQuery(env,state,spec) {
  const helper=createListingQueryRuntimeV151([],null),scope=spec.mode==='lease'?'lease':'all',keys=KEYS[scope];
  const csvObject=await env.MEDIA.get(keys[0]);if(!csvObject)throw failure('목록 자료가 아직 준비되지 않았습니다.',503);
  const csvRevision=csvObject.customMetadata?.revision||'';
  const csvChanges=queryChangesV151(state,csvRevision);
  const items=helper.csv(await new Response(body(csvObject)).text());
  const originalObject=await env.MEDIA.get(keys[1]);if(!originalObject)throw failure('원본 자료가 아직 준비되지 않았습니다.',503);
  const originalEtag=originalObject.etag,originalRevision=originalObject.customMetadata?.revision||'';
  const currentEpoch=String(state.collectorRevisionV142||'');
  const originalChanges=currentEpoch&&String(originalObject.customMetadata?.collectorRevisionV142||'')===currentEpoch?
    []:queryChangesV151(state,originalRevision);
  const metadata=await readQueryOriginalsV151(body(originalObject),{onGroup:()=>null});
  const inventory=querySnapshotInventoryV151(items,metadata),pending=[...new Set([...csvChanges,...originalChanges,...inventory.pending])];
  if(pending.length>1024)throw failure('최신 목록 연결을 다시 준비해야 합니다.');
  const byId=new Map(items.map(item=>[item.propertyId,item])),repairs=new Map(),readEnv=listingReadEnv(env);
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
  if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
  const source=await env.MEDIA.get(keys[1]);
  if(!source||source.etag!==originalEtag){await source?.body?.cancel();throw failure('조회 원본 파일이 교체되었습니다.');}
  const result=await runSnapshotQueryV151({items:[...byId.values()],metadata,stream:body(source),repairs},spec);
  if((await revision(env)).revision!==state.revision)throw failure('조회 중 목록이 갱신되었습니다.');
  return queryWireV151(result,state.revision);
}

export async function privateListingQueryV151(request,env,context) {
  if(request.method!=='POST')return Response.json({ok:false,message:'Method not allowed'},{status:405});
  if(!env.MEDIA||!env.DB)throw failure('조회 연결이 준비되지 않았습니다.',503);
  const text=await request.text();if(text.length>256*1024)throw failure('조회 조건이 너무 큽니다.',413);
  const input=JSON.parse(text),spec=querySpecV151(input.spec),state=await revision(env);
  if(input.revision!==state.revision)throw failure('목록 기준이 변경되었습니다.');
  const cachedKey='api-cache/query-view-v151-'+spec.mode+'.json',common=defaultQueryV151(spec);
  if(common) {
    const cached=await env.MEDIA.get(cachedKey);
    if(cached?.customMetadata?.revision===state.revision)return new Response(cached.body,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    await cached?.body?.cancel();
  }
  if(inFlight)throw failure('다른 조회를 준비하고 있습니다.',503);
  const task=loadAndQuery(env,state,spec);inFlight=task;
  try {
    const payload=await task,serialized=JSON.stringify(payload);
    if(common) {
      const save=env.MEDIA.put(cachedKey,serialized,{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{revision:state.revision}});
      if(context?.waitUntil)context.waitUntil(save);else await save;
    }
    return new Response(serialized,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  } finally {if(inFlight===task)inFlight=null;}
}
export default {async fetch(request,env,context){try{return await privateListingQueryV151(request,env,context);}catch(error){return Response.json({ok:false,message:error.message},{status:error.statusCode||500});}}};
