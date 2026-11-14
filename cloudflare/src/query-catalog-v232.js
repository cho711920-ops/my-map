// The caller already has the complete navigation. Transfer advertisement
// deltas once, with an exact per-master basis, instead of downloading every
// navigation field again. Private derived bytes are bound to source ETag.
import {readQueryOriginalsV151} from './query-stream-v151.js';
const names=['propertyId','sourceSnapshotKey','queryMatchedOriginalCountV152','querySelectedOriginalIdV152'];
const fail=message=>Object.assign(new Error(message),{statusCode:409});
export async function catalogPacketV232(stream,revision){
  const packet=await readQueryOriginalsV151(stream,{rootArrayKeys:['rows'],maxEntryBytes:64*1024*1024,
    validateRoot:root=>root.ok===true&&root.version===152&&Array.isArray(root.rows),
    onArrayEntry(row,name,root){
      if(name!=='rows')return row;
      if(!Array.isArray(row)||!Array.isArray(root.fields)||row.length!==root.fields.length)throw fail('필터 기준 행이 올바르지 않습니다.');
      const at=names.map(name=>root.fields.indexOf(name));if(at.some(index=>index<0))throw fail('필터 기준 항목이 없습니다.');
      return at.map(index=>row[index]);
    }});
  if(packet.ok!==true||packet.version!==152||packet.grouping!=='client-v152'||packet.completeQuery!==true||
    packet.revision!==revision||packet.perPropertyOverridesV152||!Array.isArray(packet.rows)||packet.total!==packet.rows.length||packet.total>100000||
    packet.numericCatalogV177?.complete!==true||packet.numericCatalogV177.revision!==revision)throw fail('필터 전체 자료의 기준이 다릅니다.');
  const seen=new Set();for(const row of packet.rows){if(typeof row[0]!=='string'||seen.has(row[0])||!/^sha256-v1:[a-f0-9]{64}$/.test(row[1]))throw fail('필터 원장 연결이 다릅니다.');seen.add(row[0]);}
  return {ok:true,version:232,revision,fields:packet.fields,total:packet.total,basis:packet.rows,numericCatalogV177:packet.numericCatalogV177};
}
// Copy only the root catalog value into a compressor. The large per-ad
// object is never expanded into a second JS object graph in this Worker.
async function copyCatalogV232(stream,write){
  const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let depth=0,quoted=false,escaped=false,key='',name='',capture=false,found=false,ended=false,header='',bytes=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>128*1024*1024)throw fail('필터 전송 범위 초과');
    const text=decoder.decode(value,{stream:true});let start=capture?0:-1;
    for(let i=0;i<text.length;i++){const ch=text[i];
      if(quoted){if(depth===1){key+=ch;if(key.length>256)throw fail('필터 항목명 범위 초과');}if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"'){quoted=false;if(depth===1)name=JSON.parse(key);}continue;}
      if(ch==='"'){quoted=true;if(depth===1)key='"';continue;}
      if(ch===':'&&depth===1&&name==='numericCatalogV177'){
        if(found||capture)throw fail('중복 필터 자료');capture=true;found=true;start=i+1;continue;
      }
      if(ch==='{'||ch==='[')depth++;
      if(ch==='}'||ch===']'){
        depth--;if(capture&&depth===1){const part=text.slice(start,i+1);header+=(header.length<4096?part.slice(0,4096-header.length):'');await write(part);capture=false;ended=true;start=-1;}
      }
    }
    if(capture){const part=text.slice(start);header+=(header.length<4096?part.slice(0,4096-header.length):'');await write(part);}
  }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!found||!ended||quoted||depth!==0)throw fail('필터 원문이 완전하지 않습니다.');
  // The producer writes scalar identity before groups; validate that small
  // prefix separately while the browser validates every delta on consumption.
  const at=header.indexOf('"groups":');if(at<0)throw fail('필터 원문 기준이 없습니다.');
  const descriptor=JSON.parse(header.slice(0,at)+'"groups":[]}');
  if(descriptor.version!==177||descriptor.format!=='row-deltas-v177'||descriptor.complete!==true)throw fail('필터 전체 원문이 아닙니다.');
  return descriptor;
}
export async function compressedCatalogV232(stream,revision){
  // ReadableStream.tee buffers the entire source for its slower consumer.
  // Both validators must accept each chunk before reading another one.
  const left=new TransformStream(),right=new TransformStream(),read=stream.getReader(),a=left.writable.getWriter(),b=right.writable.getWriter();
  const pump=(async()=>{try{for(;;){const {value,done}=await read.read();if(done)break;await Promise.all([a.write(value),b.write(value)]);}await Promise.all([a.close(),b.close()]);}
    catch(error){await Promise.allSettled([a.abort(error),b.abort(error)]);throw error;}finally{await read.cancel().catch(()=>{});read.releaseLock();}})();pump.catch(()=>{});
  const baseStream=left.readable,catalogStream=right.readable,gzip=new CompressionStream('gzip'),writer=gzip.writable.getWriter(),encoder=new TextEncoder();
  const compressed=(async()=>{const reader=gzip.readable.getReader(),parts=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;if((size+=value.byteLength)>16*1024*1024)throw fail('압축 필터 전송 범위 초과');parts.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
  })();compressed.catch(()=>{});
  const base=readQueryOriginalsV151(baseStream,{skipRootKeys:['numericCatalogV177'],rootArrayKeys:['rows'],validateRoot:root=>root.ok===true&&root.version===152&&Array.isArray(root.rows),
    onArrayEntry(row,name,root){if(name!=='rows')return row;if(!Array.isArray(root.fields)||!Array.isArray(row)||row.length!==root.fields.length)throw fail('필터 기준 행 오류');const at=names.map(name=>root.fields.indexOf(name));if(at.some(index=>index<0))throw fail('필터 기준 항목 누락');return at.map(index=>row[index]);}});base.catch(()=>{});
  try{
    await writer.write(encoder.encode('{"numericCatalogV177":'));
    const descriptor=await copyCatalogV232(catalogStream,text=>writer.write(encoder.encode(text))),packet=await base;
    if(packet.revision!==revision||descriptor.revision!==revision||packet.grouping!=='client-v152'||packet.completeQuery!==true||packet.perPropertyOverridesV152||packet.total!==packet.rows.length||packet.total>100000)throw fail('필터 전송 기준 변경');
    const seen=new Set();for(const row of packet.rows){if(typeof row[0]!=='string'||seen.has(row[0])||!/^sha256-v1:[a-f0-9]{64}$/.test(row[1]))throw fail('필터 원장 기준 오류');seen.add(row[0]);}
    const tail=JSON.stringify({ok:true,version:232,revision,fields:packet.fields,total:packet.total,basis:packet.rows});
    await writer.write(encoder.encode(','+tail.slice(1)));await writer.close();return await compressed;
  }catch(error){await writer.abort(error).catch(()=>{});await baseStream.cancel().catch(()=>{});throw error;}
}
export async function preparedCatalogV232({env,key,revision,headers,loadFull,context}){
  const target=key+'.catalog-v232.gz',source=await env.MEDIA.head(key);
  if(source?.customMetadata?.revision===revision){
    const saved=await env.MEDIA.get(target);
    if(saved?.customMetadata?.revision===revision&&saved.customMetadata.sourceEtag===source.etag)
      return new Response(saved.body,{headers:{...headers,'content-encoding':'gzip','x-js-data-encoding':'catalog-gzip-v232'},encodeBody:'manual'});
    await saved?.body?.cancel();
  }
  let original=source?.customMetadata?.revision===revision?await env.MEDIA.get(key,{onlyIf:{etagMatches:source.etag}}):null;
  if(!original?.body){const response=await loadFull();if(!response.ok)return response;original={body:response.body};}
  const before=await env.MEDIA.head(key);if(before?.customMetadata?.revision!==revision||original.etag&&original.etag!==before.etag){await original.body.cancel();throw fail('필터 준비 중 기준이 바뀌었습니다.');}
  const stream=original.httpMetadata?.contentEncoding==='gzip'?original.body.pipeThrough(new DecompressionStream('gzip')):original.body;
  const bytes=await compressedCatalogV232(stream,revision);
  const after=await env.MEDIA.head(key);if(after?.etag!==before.etag||after.customMetadata?.revision!==revision)throw fail('필터 준비 중 원본이 바뀌었습니다.');
  const put=env.MEDIA.put(target,bytes,{httpMetadata:{contentType:'application/json; charset=utf-8',contentEncoding:'gzip'},customMetadata:{revision,sourceEtag:before.etag}});
  if(context?.waitUntil)context.waitUntil(put);else await put;
  return new Response(bytes,{headers:{...headers,'content-encoding':'gzip','x-js-data-encoding':'catalog-gzip-v232'},encodeBody:'manual'});
}
