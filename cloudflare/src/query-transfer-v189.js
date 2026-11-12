import {snapshotTransfer} from './snapshot-transfer.js';

const MODES=new Set(['manifest-v128','chunk-v128']);
const failure=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
async function storeCompressedV189(bucket,key,source,revision,originalKey){
  // R2 rejects unknown-length TransformStreams. Upload bounded byte arrays as
  // atomic multipart parts instead of buffering the entire JSON or gzip file.
  const upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:'application/json; charset=utf-8',contentEncoding:'gzip'},customMetadata:{revision,sourceEtag:source.etag}});
  const reader=source.body.pipeThrough(new CompressionStream('gzip')).getReader(),parts=[];
  let buffer=new Uint8Array(5*1024*1024),used=0,total=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>64*1024*1024)throw failure('매매 목록 전송 파일이 너무 큽니다.',413);
      for(let at=0;at<value.byteLength;){const take=Math.min(buffer.byteLength-used,value.byteLength-at);buffer.set(value.subarray(at,at+take),used);used+=take;at+=take;
        if(used===buffer.byteLength){parts.push(await upload.uploadPart(parts.length+1,buffer));buffer=new Uint8Array(5*1024*1024);used=0;}
      }
    }
    if(used)parts.push(await upload.uploadPart(parts.length+1,buffer.subarray(0,used)));
    const current=await bucket.head(originalKey);
    if(current?.etag!==source.etag||current.customMetadata?.revision!==revision)throw failure('압축 준비 중 매매 목록이 갱신되었습니다.');
    await upload.complete(parts);
  }catch(error){await upload.abort().catch(()=>{});throw error;}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function queryTransferKeyV189(mode){
  if(!['building_sale','land_sale'].includes(mode))throw failure('매매 조회 범위를 확인해 주세요.',400);
  return 'api-cache/query-view-'+(mode==='building_sale'?'v184-':'v215-')+mode+'.json';
}
// Derived compressed bytes only. The original prepared projection is retained;
// no writable master, advertisement or collection state is changed.
export async function preparedQueryTransferV189(env,spec,revision,request,build){
  const mode=request.headers.get('x-js-snapshot-mode');
  if(!MODES.has(mode)||typeof env.MEDIA?.head!=='function'||typeof env.MEDIA?.createMultipartUpload!=='function')return null;
  const key=queryTransferKeyV189(spec.mode),gzipKey=key+'.transfer-v189.gz';
  if(mode==='manifest-v128'){
    let source=await env.MEDIA.head(key);
    if(source?.customMetadata?.revision!==revision){
      const response=await build();
      if(!response.ok)return response;
      await response.body?.cancel();source=await env.MEDIA.head(key);
    }
    if(source?.customMetadata?.revision!==revision)throw failure('현재 매매 목록 자료가 아직 준비되지 않았습니다.',503);
    // Small complete views are faster in one ordinary response. Negotiation
    // must not add a manifest/range round trip to an already small payload.
    if(source.size<=4*1024*1024)return null;
    let compressed=await env.MEDIA.head(gzipKey);
    if(compressed?.customMetadata?.revision!==revision||compressed.customMetadata.sourceEtag!==source.etag){
      const original=await env.MEDIA.get(key,{onlyIf:{etagMatches:source.etag}});
      if(!original?.body||original.etag!==source.etag||original.customMetadata?.revision!==revision){await original?.body?.cancel();throw failure('매매 목록 파일이 교체되었습니다.');}
      await storeCompressedV189(env.MEDIA,gzipKey,original,revision,key);
      const after=await env.MEDIA.head(key);
      if(after?.etag!==source.etag||after.customMetadata?.revision!==revision)throw failure('압축 준비 중 매매 목록이 갱신되었습니다.');
      compressed=await env.MEDIA.head(gzipKey);
    }
    if(!compressed||compressed.customMetadata?.revision!==revision)throw failure('매매 목록 전송 자료를 확인하지 못했습니다.',503);
  }
  const head=await env.MEDIA.head(gzipKey);
  if(!head?.customMetadata?.revision||mode==='chunk-v128'&&head.httpEtag!==request.headers.get('x-js-snapshot-etag'))throw failure('매매 목록 전송 기준이 변경되었습니다.');
  const transfer=await snapshotTransfer(env,gzipKey,0,request,mode==='manifest-v128'?revision:null);
  if(!transfer?.response)throw failure('매매 목록 전송 자료를 확인하지 못했습니다.',503);
  const headers=new Headers(transfer.response.headers);
  headers.set('x-js-query-revision-v152',head.customMetadata.revision);
  headers.set('x-js-query-schema','readonly-v152');
  if(mode==='manifest-v128'&&transfer.response.ok){
    const manifest=await transfer.response.json();
    if(manifest.etag!==head.httpEtag||manifest.revision!==head.customMetadata.revision)throw failure('매매 목록 전송 파일이 갱신되었습니다.');
    return Response.json(manifest,{headers});
  }
  return new Response(transfer.response.body,{status:transfer.response.status,headers});
}
