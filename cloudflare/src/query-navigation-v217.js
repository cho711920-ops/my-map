// A complete navigation projection, separate from the much larger per-ad filter
// catalog. Never a page/subset disguised as a complete query or a writable row.
import {readQueryOriginalsV151} from './query-stream-v151.js';
const failure=message=>Object.assign(new Error(message),{statusCode:409});
export async function readNavigationV217(stream){
  return readQueryOriginalsV151(stream,{skipRootKeys:['numericCatalogV177'],rootArrayKeys:['rows'],validateRoot:root=>root.ok===true&&Array.isArray(root.rows)});
}
export function navigationPacketV217(packet,revision){
  if(packet?.ok!==true||packet.version!==152||packet.revision!==revision||packet.completeQuery!==true||
    packet.grouping!=='client-v152'||!Array.isArray(packet.fields)||!Array.isArray(packet.rows)||packet.total!==packet.rows.length)
    throw failure('초기 목록의 완전한 조회 기준을 확인하지 못했습니다.');
  return {...packet,numericCatalogV177:undefined,numericCatalogDeferredV217:true};
}
export async function preparedNavigationV217({env,key,revision,headers,loadFull,context}){
  const target=key+'.navigation-v217.json';
  let source=typeof env.MEDIA.head==='function'?await env.MEDIA.head(key):null;
  if(source?.customMetadata?.revision===revision){
    const prepared=await env.MEDIA.get(target);
    if(prepared?.customMetadata?.revision===revision&&prepared.customMetadata.sourceEtag===source.etag)
      return new Response(prepared.body,{headers});
    await prepared?.body?.cancel();
  }
  let packet;
  if(source?.customMetadata?.revision===revision){
    const original=await env.MEDIA.get(key,{onlyIf:{etagMatches:source.etag}});
    if(!original?.body||original.etag!==source.etag||original.customMetadata?.revision!==revision){await original?.body?.cancel();throw failure('초기 목록 준비 중 자료가 변경되었습니다.');}
    packet=await readNavigationV217(original.body);
  }else{
    const response=await loadFull();if(!response.ok)return response;
    packet=await readNavigationV217(response.body);source=typeof env.MEDIA.head==='function'?await env.MEDIA.head(key):null;
  }
  const serialized=JSON.stringify(navigationPacketV217(packet,revision));
  if(source?.customMetadata?.revision===revision){
    const save=env.MEDIA.put(target,serialized,{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{revision,sourceEtag:source.etag}});
    if(context?.waitUntil)context.waitUntil(save);else await save;
  }
  return new Response(serialized,{headers});
}
