import { listingTradeTypesCanMerge } from './listing-trade.js';

const clean=value=>String(value??'').trim();
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
function publicId(row){return clean(row.property_id)||row.id;}
function legacyKey(row){return [row.title,row.address,row.room,row.listing_type].map(value=>String(value??'')).join('|');}
export function remapMergedListKey(key,map){
  if(typeof key!=='string')return key;
  return map[key]||map[key.replace(/\|row:\d+$/,'')]||key;
}

// The selected-card flow is one atomic, replayable operation. The existing
// detail/manual merge endpoint remains available with its original semantics.
export async function mergeSelectedMasters(env,user,body){
  const owner=clean(user?.email).toLowerCase(),requestId=clean(body.requestId);
  const primaryId=clean(body.primaryMasterId),raw=body.duplicateMasterIds;
  if(!owner||!/^selected-merge-[A-Za-z0-9_-]{8,120}$/.test(requestId))throw fail('병합 요청을 다시 열어 주세요.',400);
  if(!primaryId||!Array.isArray(raw)||raw.length<1||raw.length>50||raw.some(id=>!clean(id)||clean(id)===primaryId)||new Set(raw.map(clean)).size!==raw.length)
    throw fail('서로 다른 매물을 2~51개 선택해 주세요.',400);
  const ids=[primaryId,...raw.map(clean)];
  const fingerprint=JSON.stringify([primaryId,ids.slice(1).sort()]);
  async function replay(){
    const row=await env.DB.prepare('SELECT owner_email,action,state,result_json FROM mutation_results WHERE request_id=?1').bind(requestId).first();
    if(!row)return null;
    const saved=parse(row.result_json);
    if(row.owner_email!==owner||row.action!=='consolidateSelectedMasters'||saved?.fingerprint!==fingerprint)
      throw fail('병합 요청이 변경됐습니다. 창을 다시 열어 주세요.');
    if(row.state!=='completed'||!saved.result?.persisted)throw fail('병합 처리 상태를 다시 확인해 주세요.');
    return {...saved.result,replayed:true,operationAdjustments:{}};
  }
  const previous=await replay();if(previous)return previous;
  const rows=(await env.DB.prepare(`SELECT * FROM listings
    WHERE id IN (SELECT value FROM json_each(?1)) OR property_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)).all())?.results||[];
  const selected=ids.map(id=>{const found=rows.filter(row=>row.id===id||row.property_id===id);if(found.length!==1||found[0].status==='deleted')throw fail('선택한 매물이 변경되었거나 이미 병합됐습니다. 최신 목록을 확인해 주세요.');return found[0];});
  if(new Set(selected.map(row=>row.id)).size!==selected.length)throw fail('같은 대표매물이 중복 선택됐습니다.');
  const [primary,...duplicates]=selected;
  if(duplicates.some(row=>!listingTradeTypesCanMerge(primary.trade_type,row.trade_type)||
    (primary.trade_type==='sale'&&clean(primary.sale_category)!==clean(row.sale_category))))
    throw fail('상가임대·건물매매·토지매매는 같은 거래유형끼리만 병합할 수 있습니다.',400);
  const duplicateIds=JSON.stringify(duplicates.map(row=>row.id)),targetId=publicId(primary),now=new Date().toISOString();
  const keyMap=Object.create(null);
  for(const row of duplicates)for(const key of [legacyKey(row),'property:'+row.id,'property:'+publicId(row)])keyMap[key]='property:'+targetId;
  const memos=[...new Set(selected.map(row=>clean(row.operating_memo)).filter(Boolean))];
  const memo=memos.join('\n\n');
  const cloud=(await env.DB.prepare(`SELECT owner_email,scope,record_key,value_json,version FROM cloud_state
    WHERE (scope IN ('favorites','visitLists') AND EXISTS(SELECT 1 FROM json_each(?1) WHERE instr(value_json,value)>0))
      OR (scope='personalListingCoverV85' AND record_key IN (SELECT value FROM json_each(?2))) LIMIT 501`)
    .bind(JSON.stringify(Object.keys(keyMap).map(key=>JSON.stringify(key).slice(0,-1))),JSON.stringify(selected.map(publicId))).all())?.results||[];
  if(cloud.length>500)throw fail('연결된 개인 기록이 많아 한 번에 병합할 수 없습니다. 선택 매물 수를 줄여 주세요.',400);
  const cloudWrites=[];
  for(const row of cloud){
    if(row.scope==='personalListingCoverV85')continue;
    const value=parse(row.value_json);if(!Array.isArray(value))continue;
    let changed=false;
    const next=value.map(list=>{
      if(!list||!Array.isArray(list.itemKeys))return list;
      const keys=[...new Set(list.itemKeys.map(key=>remapMergedListKey(key,keyMap)))];
      if(JSON.stringify(keys)===JSON.stringify(list.itemKeys))return list;
      changed=true;return {...list,itemKeys:keys};
    });
    if(changed)cloudWrites.push({before:row,value:JSON.stringify(next)});
  }
  // Keep the representative's personal cover for every account. Only when it
  // has no cover record do we inherit one; the original R2 assets stay intact.
  const coverCopies=[];
  const coverRows=cloud.filter(row=>row.scope==='personalListingCoverV85');
  for(const row of coverRows){
    if(!duplicates.some(item=>publicId(item)===row.record_key))continue;
    if(coverRows.some(item=>item.owner_email===row.owner_email&&item.record_key===targetId)||coverCopies.some(item=>item.owner===row.owner_email))continue;
    const value=parse(row.value_json);if(!value?.imageId)continue;
    coverCopies.push({owner:row.owner_email,source:row,value:JSON.stringify({...value,assetPropertyId:value.assetPropertyId||row.record_key})});
  }
  const result={ok:true,persisted:true,action:'consolidateExistingMasters',selectedMerge:true,consolidated:duplicates.length,
    primaryMasterId:primary.id,primaryPropertyId:targetId,duplicateMasterIds:duplicates.map(row=>row.id),
    duplicatePropertyIds:duplicates.map(publicId),affectedPropertyIds:selected.map(publicId),keyMap,
    operationAdjustments:{activeMaster:-duplicates.length,history:1},source:'D1'};
  const args=[requestId,owner,JSON.stringify({fingerprint,result}),
    JSON.stringify(selected.map(row=>({id:row.id,version:row.version,updated:row.updated_at}))),
    JSON.stringify([...cloudWrites.map(item=>item.before),...coverCopies.map(item=>item.source)].map(row=>({owner:row.owner_email,scope:row.scope,key:row.record_key,version:row.version}))),
    JSON.stringify(coverCopies.map(row=>row.owner)),targetId];
  const valid=`NOT EXISTS(SELECT 1 FROM json_each(?4) e LEFT JOIN listings l ON l.id=json_extract(e.value,'$.id')
      WHERE l.id IS NULL OR l.status='deleted' OR l.version<>json_extract(e.value,'$.version') OR l.updated_at<>json_extract(e.value,'$.updated'))
    AND NOT EXISTS(SELECT 1 FROM json_each(?5) e LEFT JOIN cloud_state c
      ON c.owner_email=json_extract(e.value,'$.owner') AND c.scope=json_extract(e.value,'$.scope') AND c.record_key=json_extract(e.value,'$.key')
      WHERE c.owner_email IS NULL OR c.version<>json_extract(e.value,'$.version'))
    AND NOT EXISTS(SELECT 1 FROM cloud_state c WHERE c.scope='personalListingCoverV85' AND c.record_key=?7 AND c.owner_email IN (SELECT value FROM json_each(?6)))`;
  // A NULL state violates the existing NOT NULL constraint and rolls back the
  // entire D1 batch when a listing or personal record changed after validation.
  const statements=[env.DB.prepare(`INSERT INTO mutation_results(request_id,owner_email,action,state,result_json)
    VALUES(?1,?2,'consolidateSelectedMasters',CASE WHEN ${valid} THEN 'completed' ELSE NULL END,?3)`).bind(...args),
    env.DB.prepare(`UPDATE listing_sources SET listing_id=?1,list_snapshot_json=json_set(list_snapshot_json,'$.propertyId',?1),updated_at=?2
      WHERE listing_id IN (SELECT value FROM json_each(?3))`).bind(primary.id,now,duplicateIds),
    env.DB.prepare(`UPDATE listing_media SET listing_id=?1,updated_at=?2 WHERE listing_id IN (SELECT value FROM json_each(?3))`).bind(primary.id,now,duplicateIds),
    env.DB.prepare(`UPDATE listing_contacts SET listing_id=?1,updated_at=?2 WHERE listing_id IN (SELECT value FROM json_each(?3))`).bind(primary.id,now,duplicateIds),
    env.DB.prepare('UPDATE listings SET operating_memo=?1,version=version+1,updated_at=?2 WHERE id=?3').bind(memo,now,primary.id),
    env.DB.prepare(`UPDATE listings SET status='deleted',version=version+1,updated_at=?1 WHERE id IN (SELECT value FROM json_each(?2))`).bind(now,duplicateIds),
    env.DB.prepare(`INSERT INTO listing_history(listing_id,action,actor_email,before_json,after_json)
      VALUES(?1,'consolidateSelectedMasters',?2,?3,?4)`).bind(primary.id,owner,JSON.stringify({selected}),JSON.stringify({primaryId:primary.id,duplicateIds:duplicates.map(row=>row.id),requestId}))];
  // A manually registered card may have no source row. Preserve that card as
  // an explicit internal snapshot, rather than silently dropping its terms.
  let snapshotInsertion=1;
  for(const row of selected){
    if(!/직접|수동/.test(clean(row.main_source)))continue;
    const snapshot={source:'직접등록',sourceId:'merged-master:'+row.id,buildingName:row.title,address:row.address,room:row.room,type:row.listing_type,
      tradeType:row.trade_type,saleCategory:row.sale_category,salePrice:row.sale_price,saleDetails:parse(row.sale_details_json),deposit:row.deposit,rent:row.monthly_rent,
      fee:row.maintenance_fee,premium:row.premium,area:row.area_m2,memo:row.operating_memo,link:row.source_url,contacts:parse(row.contacts_json)||[],
      latitude:row.latitude,longitude:row.longitude,manualMergeSnapshot:true};
    // Run before reparenting, so the original inventory is tested atomically.
    statements.splice(snapshotInsertion++,0,env.DB.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,list_snapshot_json,raw_json,trade_type,sale_category,sale_price)
      SELECT ?1,?2,'직접등록',?3,?4,?4,?5,?6,?7 WHERE NOT EXISTS(SELECT 1 FROM listing_sources WHERE listing_id=?8)`)
      .bind('O-'+crypto.randomUUID(),primary.id,snapshot.sourceId,JSON.stringify({...snapshot,propertyId:primary.id}),row.trade_type,row.sale_category,row.sale_price,row.id));
  }
  for(const item of cloudWrites){const row=item.before;statements.push(env.DB.prepare(`UPDATE cloud_state SET value_json=?1,version=version+1,updated_at=?2 WHERE owner_email=?3 AND scope=?4 AND record_key=?5`)
    .bind(item.value,now,row.owner_email,row.scope,row.record_key));}
  for(const item of coverCopies)statements.push(env.DB.prepare(`INSERT INTO cloud_state(owner_email,scope,record_key,value_json,version,updated_at)
    VALUES(?1,'personalListingCoverV85',?2,?3,1,?4)`).bind(item.owner,targetId,item.value,now));
  try{await env.DB.batch(statements);}catch(error){const repeated=await replay();if(repeated)return repeated;throw fail('다른 작업에서 선택 매물이나 개인 기록이 변경됐습니다. 최신 목록을 확인한 뒤 다시 병합해 주세요.');}
  return result;
}
