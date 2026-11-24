// Dedicated complete read-only bases for All and Completed. Never relabel an
// active-only packet as a complete completed/all inventory.
const memories=new WeakMap(),MAX_BYTES=8*1024*1024;
function memory(bucket){let value=memories.get(bucket);if(!value){value={entries:new Map(),bytes:0};memories.set(bucket,value);}return value;}
function remember(bucket,key,revision,hash,bytes){if(bytes.byteLength>MAX_BYTES)return;const cache=memory(bucket),old=cache.entries.get(key);if(old)cache.bytes-=old.bytes.byteLength;cache.entries.delete(key);cache.entries.set(key,{revision,hash,bytes});cache.bytes+=bytes.byteLength;while(cache.bytes>MAX_BYTES||cache.entries.size>8){const first=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(first).bytes.byteLength;cache.entries.delete(first);}}
const viewOf=spec=>spec.doneOnly?'completed':spec.hideDone===false?'all':'active';
export const availabilityKeyV253=(mode,view)=>`api-cache/query-availability-v253-${mode}-${view}.json`;
export function availabilityBaseV253(spec){return viewOf(spec)!=='active'&&!spec.favoriteOnly&&!spec.gongsilOnly&&!spec.newListingDays&&Object.entries(spec.filters||{}).every(([key,value])=>!value||key==='sortFilter'&&value==='latest');}
const invalid=message=>Object.assign(Error(message),{statusCode:409});
export async function availabilityQueryV253({env,state,spec,validate,patch,build,filter,keyword,industry,revision,scope,compress=false,headers}){
  const view=viewOf(spec),clean={...spec,hideDone:true,doneOnly:false,filters:{...spec.filters,keyword:'',industryFilter:''}};
  if(view==='active'||!scope(clean))return null;
  const filters=Object.fromEntries(Object.entries(spec.filters||{}).filter(([k,v])=>v&&!(k==='sortFilter'&&v==='latest')).sort(([a],[b])=>a.localeCompare(b)));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({mode:spec.mode,view,filters})))),b=>b.toString(16).padStart(2,'0')).join('');
  const sorts=new Set(['latest','address','addressAsc','addressDesc','floorLow','floorHigh','depositLow','depositHigh','rentLow','rentHigh','areaLow','areaHigh','yieldHigh','yieldLow','salePriceLow','salePriceHigh']);
  const onlySort=Object.keys(filters).every(k=>k==='sortFilter'),sort=filters.sortFilter||'latest';
  const resultKey=availabilityKeyV253(spec.mode,view)+'.result-'+(onlySort&&sorts.has(sort)?sort:parseInt(hash.slice(0,2),16)%4)+'.gz';
  const encoded=bytes=>new Response(bytes,{headers:{...headers,'content-encoding':'gzip','x-js-data-encoding':'stored-availability-gzip-v253','x-js-query-availability-v253':'1'},encodeBody:'manual'});
  if(compress){const retained=memory(env.MEDIA).entries.get(resultKey);
    if(retained?.revision===state.revision&&retained.hash===hash){if(await revision()!==state.revision)throw invalid('계약완료 표시 기준이 변경되었습니다.');return encoded(retained.bytes);}
    const cached=await env.MEDIA.get(resultKey);
    if(cached?.customMetadata?.revision===state.revision&&cached.customMetadata.queryHash===hash){if(await revision()!==state.revision){await cached.body?.cancel();throw invalid('계약완료 표시 기준이 변경되었습니다.');}const bytes=await new Response(cached.body).arrayBuffer();remember(env.MEDIA,resultKey,state.revision,hash,bytes);return encoded(bytes);}
    await cached?.body?.cancel();
  }
  const key=availabilityKeyV253(spec.mode,view),base={...spec,filters:{},hideDone:false,doneOnly:spec.doneOnly};
  const object=await env.MEDIA.get(key);let packet=object?await new Response(object.body).json():null;
  function valid(value){return value?.ok===true&&value.numericCatalogV177?.availabilityViewV253===view&&value.numericCatalogV177.marketV215===spec.mode&&validate(value);}
  if(packet&&!valid(packet))throw invalid('계약완료 표시 기준을 확인하지 못했습니다.');
  let changed=false;
  if(packet&&packet.revision!==state.revision){packet=await patch(packet);changed=true;}
  if(!packet){packet=await build(base);packet.numericCatalogV177={...packet.numericCatalogV177,availabilityViewV253:view};changed=true;}
  if(!valid(packet)||packet.revision!==state.revision||await revision()!==state.revision)throw invalid('계약완료 표시 중 목록 기준이 변경되었습니다.');
  if(changed)await env.MEDIA.put(key,JSON.stringify(packet),{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{revision:state.revision}});
  const predicates=[];
  if(String(spec.filters.keyword||'').trim()){const match=await keyword(packet);if(!match)return null;predicates.push(match);}
  if(String(spec.filters.industryFilter||'').trim()){const match=await industry(packet);if(!match)return null;predicates.push(match);}
  const accept=row=>predicates.every(match=>match(row));
  accept.repairIdsV238=[...new Set(predicates.flatMap(match=>match.repairIdsV238||[]))];
  const result=await filter(packet,{...spec,filters:clean.filters},accept);
  if(!result||await revision()!==state.revision)throw invalid('계약완료 표시 결과를 확인하지 못했습니다.');
  if(!compress)return result;
  const bytes=await new Response(new Response(JSON.stringify(result)).body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  if(await revision()!==state.revision)throw invalid('계약완료 표시 압축 중 기준이 변경되었습니다.');
  await env.MEDIA.put(resultKey,bytes,{httpMetadata:{contentType:'application/json; charset=utf-8',contentEncoding:'gzip'},customMetadata:{revision:state.revision,queryHash:hash}});
  remember(env.MEDIA,resultKey,state.revision,hash,bytes);return encoded(bytes);
}
