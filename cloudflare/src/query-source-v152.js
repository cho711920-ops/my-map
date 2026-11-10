import {readQueryOriginalsV151,queryOriginalReducerV151} from './query-stream-v151.js';

const PART=5*1024*1024;
function content(object){return object.httpMetadata?.contentEncoding==='gzip'?object.body.pipeThrough(new DecompressionStream('gzip')):object.body;}

// Derive a bounded photo-free index from the published snapshot, without
// another D1/source scan. Both ETags bind its identity manifest to its rows.
export async function querySourceV152(bucket,scope,sourceKey,source,firstThumbnail){
  if(source.customMetadata?.queryMetadataV152==='1'){
    const manifestKey=sourceKey+'.manifest',saved=await bucket.get(manifestKey);
    if(saved?.customMetadata?.sourceEtag===source.etag)return {metadata:await new Response(saved.body).json(),stream:content(source)};
    await saved?.body?.cancel();
    const metadata=await readQueryOriginalsV151(content(source),{onGroup:()=>null});
    const current=await bucket.get(sourceKey);
    if(current?.etag!==source.etag){await current?.body?.cancel();throw new Error('검색 자료가 갱신되었습니다.');}
    await bucket.put(manifestKey,JSON.stringify(metadata),{customMetadata:{sourceEtag:source.etag},httpMetadata:{contentType:'application/json; charset=utf-8'}});
    return {metadata,stream:content(current)};
  }
  const key='api-cache/query-original-index-v152-'+scope+'.json',metaKey=key+'.meta';
  const saved=await bucket.get(metaKey);
  if(saved?.customMetadata?.sourceEtag===source.etag){
    const metadata=await new Response(saved.body).json(),index=await bucket.get(key);
    if(index?.etag===saved.customMetadata.indexEtag&&index.customMetadata?.sourceEtag===source.etag){
      await source.body.cancel();return {metadata,stream:index.body};
    }
    await index?.body?.cancel();
  }else await saved?.body?.cancel();
  const upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{sourceEtag:source.etag}});
  const encoder=new TextEncoder(),reduce=queryOriginalReducerV151(firstThumbnail),parts=[];
  let chunks=[],size=0,first=true,header=false,fields=null;
  function emit(value){const bytes=encoder.encode(value);chunks.push(bytes);size+=bytes.length;}
  async function flush(final=false){
    if(size<PART&&!final)return;
    let bytes=new Uint8Array(size),offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    chunks=[];size=0;
    while(bytes.length>=PART||final&&bytes.length){
      const count=bytes.length>=PART?PART:bytes.length;
      parts.push(await upload.uploadPart(parts.length+1,bytes.slice(0,count)));bytes=bytes.slice(count);
    }
    if(bytes.length){chunks=[bytes];size=bytes.length;}
  }
  try{
    const metadata=await readQueryOriginalsV151(content(source),{onGroup(rows,id,root){
      if(!header){
        if(/^compact-v\d+$/.test(root.format||''))fields=[...new Set(root.fields.filter(name=>!['propertyId','photoPathsV119','images'].includes(name)).concat('thumbnail'))];
        emit('{"ok":true,"format":'+JSON.stringify(fields?'compact-v3':'expanded-v2')+(fields?',"fields":'+JSON.stringify(fields):'')+',"groups":{');header=true;
      }
      const reduced=reduce(rows,id,root),encoded=fields?reduced.map(row=>fields.map(field=>row[field]??null)):reduced;
      emit((first?'':',')+JSON.stringify(id)+':'+JSON.stringify(encoded));first=false;return null;
    },onProgress:()=>flush()});
    if(!header)emit('{"ok":true,"format":"expanded-v2","groups":{');
    emit('}');
    for(const name of ['sourceSearchIds','sourceSnapshotKeys','sourceSnapshotPropertyIds'])emit(','+JSON.stringify(name)+':'+JSON.stringify(metadata[name]||{}));
    emit('}');await flush(true);
    const current=await bucket.head(sourceKey);
    if(current?.etag!==source.etag)throw new Error('검색 자료 준비 중 원본 파일이 갱신되었습니다.');
    const completed=await upload.complete(parts);
    await bucket.put(metaKey,JSON.stringify(metadata),{httpMetadata:{contentType:'application/json; charset=utf-8'},
      customMetadata:{sourceEtag:source.etag,indexEtag:completed.etag}});
    const index=await bucket.get(key);
    if(index?.etag!==completed.etag){await index?.body?.cancel();throw new Error('검색 자료가 동시에 교체되었습니다.');}
    return {metadata,stream:index.body};
  }catch(error){await upload.abort().catch(()=>{});throw error;}
}
