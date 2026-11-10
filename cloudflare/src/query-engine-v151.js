import {createListingQueryRuntimeV151} from '../generated/query-runtime-v151.js';
import {readQueryOriginalsV151,queryOriginalReducerV151} from './query-stream-v151.js';

const FIELDS=['propertyId','key','name','address','room','advertisedRoomV1','type','state','source','regDate','registrationAt',
  'sheetRow','tradeType','saleCategory','salePrice','saleDetails','deposit','rent','fee','premium','area','displayValuePresence',
  'latitude','longitude','floor','sourceFloorVerifiedV1','sourceAvailabilityV129','sourceSnapshotKey','thumbnailV8',
  'unifiedOriginalCountV8','unifiedCandidateOriginalCountV2','unifiedActiveOriginalCountV2','unifiedAllOriginalCountV1',
  'unifiedAbsenceConfirmedTimeV1','sourceAllUnavailableV1','sourceTypesV8','wholeBuildingMembersV55','queryOriginalIdsV151',
  'queryGroupKeyV152','queryPendingVisitV152','queryConfirmedVisitV152','queryMatchedOriginalCountV152','querySelectedOriginalIdV152'];
function summary(item,forFinalize=false) {
  const result=Object.fromEntries(FIELDS.filter(name=>item[name]!==undefined).map(name=>[name,item[name]]));
  if(item.latlng){result.latitude=item.latlng.getLat();result.longitude=item.latlng.getLng();}
  result.queryOriginalIdsV151=item.unifiedDisplayOriginalsV2||item.unifiedOriginalsV8?
    (item.unifiedDisplayOriginalsV2||item.unifiedOriginalsV8).map(original=>({propertyId:String(original.propertyId),originalId:String(original.originalId)})):
    item.queryOriginalIdsV151||[];
  result.queryMatchedOriginalCountV152=result.queryOriginalIdsV151.length;
  result.querySelectedOriginalIdV152=result.queryOriginalIdsV151[0]?.originalId||'';
  if(forFinalize&&item.tradeType==='sale') {
    result.unifiedAllOriginalsV1=item.unifiedAllOriginalsV1;
    result.unifiedDisplayOriginalsV2=item.unifiedDisplayOriginalsV2;
    result.unifiedOriginalsV8=item.unifiedOriginalsV8;
  }
  return result;
}
export function querySnapshotInventoryV151(items,metadata) {
  const byId=new Map(),internalToPublic=new Map(),byPublic=new Map();
  for(const item of items) {
    const id=String(item.propertyId||'');
    if(!id||byId.has(id))throw new Error('Duplicate or missing master ID');
    byId.set(id,item);
  }
  for(const [internal,id] of Object.entries(metadata.sourceSnapshotPropertyIds||{})) {
    if(typeof id!=='string'||!id||byPublic.has(id))throw new Error('Ambiguous snapshot identity');
    byPublic.set(id,internal);internalToPublic.set(internal,id);
  }
  const pending=[];
  for(const [id,item] of byId) {
    const internal=byPublic.get(id),proof=item.sourceSnapshotKey;
    if(!internal||!Object.hasOwn(metadata.groups,internal)||typeof proof!=='string'||!/^sha256-v1:[a-f0-9]{64}$/.test(proof)||
      metadata.sourceSnapshotKeys[internal]!==proof)pending.push(id);
  }
  return {byId,internalToPublic,pending};
}

// Read every matching original, but materialize only a bounded group of masters
// at once. A complete 60,000-ad object graph exceeds a Worker's 128MB limit.
// The final result contains read-only display rows, never writeable masters.
export async function runSnapshotQueryV151({items,metadata,stream,repairs=new Map()},spec={},batchSize=512) {
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000)throw new Error('Invalid query batch bound');
  const inventory=querySnapshotInventoryV151(items,metadata);
  if(inventory.pending.some(id=>!repairs.has(id)))throw new Error('Query inventory has unverified pairs');
  const helper=createListingQueryRuntimeV151([],null),reduce=queryOriginalReducerV151(helper.firstThumbnail);
  const processed=new Set(),projected=[];
  let masters=[],groups=Object.create(null),keys=Object.create(null),ids=Object.create(null),search=Object.create(null);
  function flush() {
    if(!masters.length)return;
    const runtime=createListingQueryRuntimeV151(masters,{ok:true,groups,sourceSnapshotKeys:keys,sourceSnapshotPropertyIds:ids,sourceSearchIds:search});
    const rows=runtime.query({...spec,ignoreMapBounds:true,includeUnlocated:true,deferFinalize:true});
    projected.push(...rows.map(item=>({...summary(item,!spec.individualQueryV152),queryGroupKeyV152:runtime.groupKey(item.propertyId),...runtime.visitFlags(item)})));
    masters=[];groups=Object.create(null);keys=Object.create(null);ids=Object.create(null);search=Object.create(null);
  }
  function append(item,originals,proof,sourceIds) {
    const id=String(item.propertyId);
    if(processed.has(id))throw new Error('Duplicate query group');
    processed.add(id);
    masters.push(JSON.parse(JSON.stringify(item)));
    groups[id]=originals.map(original=>({...original,propertyId:id}));
    keys[id]=proof;ids[id]=id;search[id]=sourceIds||[];
    if(masters.length>=batchSize)flush();
  }
  const received=await readQueryOriginalsV151(stream,{onGroup:(rows,internal,root)=>{
    const id=inventory.internalToPublic.get(internal),item=inventory.byId.get(id);
    if(item&&!repairs.has(id))append(item,reduce(rows,internal,root),metadata.sourceSnapshotKeys[internal],metadata.sourceSearchIds?.[internal]);
    return null;
  }});
  if(Object.keys(received.sourceSnapshotPropertyIds).length!==inventory.internalToPublic.size||
    [...inventory.internalToPublic].some(([internal,id])=>received.sourceSnapshotPropertyIds[internal]!==id||
      received.sourceSnapshotKeys[internal]!==metadata.sourceSnapshotKeys[internal]))throw new Error('Snapshot changed during query');
  for(const [id,repair] of repairs) {
    if(!inventory.byId.has(id))throw new Error('Repair crossed the requested inventory');
    if(repair===null){processed.add(id);continue;}
    append(repair.item,repair.originals,repair.proof,repair.sourceIds);
  }
  flush();
  if(processed.size!==items.length)throw new Error('Incomplete query inventory');
  const finalized=helper.finalize(projected,spec);
  const proofs=new Map(projected.map(item=>[item.propertyId,item.sourceSnapshotKey]));
  return finalized.map(item=>({...summary(item),queryMemberProofsV151:Object.fromEntries((item.wholeBuildingMembersV55||[]).map(id=>[id,proofs.get(id)]))}));
}
