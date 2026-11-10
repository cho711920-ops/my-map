const FIELDS=['propertyId','sourceSnapshotKey','thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'];
const pending=new Map();
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=100&&id.trim()===id&&!Array.from(id).some(ch=>ch===','||ch.charCodeAt(0)<32);
const proof=value=>typeof value==='string'&&/^sha256-v1:[a-f0-9]{64}$/.test(value);
export function cardMediaIdsV159(ids,warm=false){
  if(!Array.isArray(ids)||ids.length>48||!warm&&!ids.length||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)
    throw Object.assign(new Error('사진 조회 범위를 확인해 주세요.'),{statusCode:400});
  return ids;
}
function validate(index,revision){
  if(!index||index.ok!==true||index.version!==159||index.revision!==revision||JSON.stringify(index.fields)!==JSON.stringify(FIELDS)||
      !Array.isArray(index.rows)||index.rows.length>100000)throw new Error('대표 사진 연결을 확인하지 못했습니다.');
  const seen=new Set();
  for(const row of index.rows){
    if(!Array.isArray(row)||row.length!==5||!validId(row[0])||seen.has(row[0])||!proof(row[1])||
      row[2]!=null&&(typeof row[2]!=='string'||row[2].length>8000)||row[3]!=null&&(typeof row[3]!=='string'||row[3].length>200)||
      row[4]!=null&&(!Number.isSafeInteger(row[4])||row[4]<0))throw new Error('대표 사진 원장 연결이 다릅니다.');
    seen.add(row[0]);
  }
  return index;
}
export async function queryCardMediaV159({env,state,spec,ids,common,loadPacket,warm=false}){
  cardMediaIdsV159(ids,warm);
  const digest=common?'common':Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(spec)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const key='api-cache/query-card-media-v159-'+spec.mode+(common?'':'-'+(parseInt(digest.slice(0,2),16)%4))+'.json';
  const signature=key+'|'+state.revision+'|'+digest;
  if(!pending.has(signature)){
    const task=(async()=>{
      const cached=await env.MEDIA.get(key);
      if(cached?.customMetadata?.revision===state.revision&&cached.customMetadata.queryHash===digest){
        return validate(await new Response(cached.body).json(),state.revision);
      }
      await cached?.body?.cancel();
      const packet=await loadPacket();
      if(packet?.ok!==true||packet.version!==152||packet.completeQuery!==true||packet.revision!==state.revision||
        !Array.isArray(packet.fields)||!Array.isArray(packet.rows)||packet.total!==packet.rows.length)throw new Error('대표 사진 기준이 변경되었습니다.');
      const indexes=FIELDS.map(field=>packet.fields.indexOf(field));
      if(indexes.some(index=>index<0))throw new Error('대표 사진 항목이 아직 준비되지 않았습니다.');
      const index=validate({ok:true,version:159,revision:state.revision,fields:FIELDS,rows:packet.rows.map(row=>indexes.map(index=>row[index]??null))},state.revision);
      const bytes=JSON.stringify(index);if(bytes.length>8*1024*1024)throw new Error('대표 사진 조회 범위를 다시 준비해야 합니다.');
      await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{revision:state.revision,queryHash:digest}});
      return index;
    })().finally(()=>{if(pending.get(signature)===task)pending.delete(signature);});pending.set(signature,task);
  }
  const index=await pending.get(signature),wanted=new Set(ids),rows=index.rows.filter(row=>wanted.has(row[0])),found=new Set(rows.map(row=>row[0]));
  return {...index,rows,requestedIds:ids,missingIds:ids.filter(id=>!found.has(id))};
}
