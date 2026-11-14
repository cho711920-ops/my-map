// A derived *complete* navigation, compressed before a visitor needs it.
// No private response is put in a public HTTP/SW cache. Retain only completed
// bounded bytes, never a request's Promise/stream across Worker invocations.
import {preparedNavigationV217} from './query-navigation-v217.js';
const buckets=new WeakMap(),MAX_BYTES=8*1024*1024;
function memory(bucket){let cache=buckets.get(bucket);if(!cache){cache={entries:new Map(),bytes:0};buckets.set(bucket,cache);}return cache;}
function remember(bucket,key,revision,etag,bytes){
  if(bytes.byteLength>MAX_BYTES)return;
  const cache=memory(bucket),old=cache.entries.get(key);
  if(old)cache.bytes-=old.bytes.byteLength;
  cache.entries.delete(key);cache.entries.set(key,{revision,etag,bytes});cache.bytes+=bytes.byteLength;
  while(cache.bytes>MAX_BYTES||cache.entries.size>3){const first=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(first).bytes.byteLength;cache.entries.delete(first);}
}
function response(bytes,headers){return new Response(bytes,{headers:{...headers,'content-encoding':'gzip','x-js-data-encoding':'stored-navigation-gzip-v228'},encodeBody:'manual'});}
export async function preparedNavigationV228(options){
  const {env,key,revision,headers,context}=options,bucket=env.MEDIA,target=key+'.navigation-v228.gz';
  const source=await bucket.head(key),cached=memory(bucket).entries.get(key);
  if(source?.customMetadata?.revision===revision){
    if(cached?.revision===revision&&cached.etag===source.etag)return response(cached.bytes,headers);
    const prepared=await bucket.get(target);
    if(prepared?.customMetadata?.revision===revision&&prepared.customMetadata.sourceEtag===source.etag){
      const bytes=await new Response(prepared.body).arrayBuffer();remember(bucket,key,revision,source.etag,bytes);
      return response(bytes,headers);
    }
    await prepared?.body?.cancel();
  }
  // Keep the original, proven row/schema/proof validation. Neither rows nor
  // conditions/photos are dropped to make a small first page look complete.
  const plain=await preparedNavigationV217(options);if(!plain.ok)return plain;
  const before=await bucket.head(key);
  if(before?.customMetadata?.revision!==revision){await plain.body?.cancel();throw Object.assign(new Error('초기 목록 전송 기준이 변경되었습니다.'),{statusCode:409});}
  const bytes=await new Response(plain.body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const after=await bucket.head(key);
  if(after?.etag!==before.etag||after.customMetadata?.revision!==revision)throw Object.assign(new Error('초기 목록 압축 중 자료가 변경되었습니다.'),{statusCode:409});
  remember(bucket,key,revision,before.etag,bytes);
  const save=bucket.put(target,bytes,{httpMetadata:{contentType:'application/json; charset=utf-8',contentEncoding:'gzip'},customMetadata:{revision,sourceEtag:before.etag}});
  if(context?.waitUntil)context.waitUntil(save);else await save;
  return response(bytes,headers);
}
