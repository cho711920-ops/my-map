export const QUERY_SALE_FIELDS_V175=Object.freeze(['landAreaM2','grossAreaM2','exclusiveAreaM2','buildingAreaM2','loanAmount','investmentAmount',
  'monthlyNetIncome','statedMonthlyIncome','advertisedYield','financialDisplayVersion','descriptionUnitAssumptions','rentalReference','totalDeposit','monthlyIncome','monthlyIncomeConflict','scope','saleExtent',
  'sourceType','sourceTypeCode','category','landUse','zoning']);

// Consume the published master CSV one record at a time. Reading its entire
// text beside the parsed rows can exceed the Worker's memory before filtering.
export async function readQuerySheetV175(stream, convert, jsonLines=false) {
  const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',cursor=0,start=0,quoted=false,header=false,ordinal=0;
  const items=[];
  function record(text) {
    if(text.endsWith('\r'))text=text.slice(0,-1);
    if(!text)return;
    const item=convert(text,header?++ordinal:0);
    if(header){if(item!==null)items.push(item);}else header=true;
  }
  function scan(chunk) {
    buffer+=chunk;
    for(;cursor<buffer.length;cursor++) {
      if(!jsonLines&&buffer[cursor]==='"')quoted=!quoted;
      if(buffer[cursor]==='\n'&&!quoted){record(buffer.slice(start,cursor));start=cursor+1;}
      if(cursor-start>4*1024*1024)throw new Error('Master CSV record exceeds bound');
    }
    if(start){buffer=buffer.slice(start);cursor-=start;start=0;}
  }
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;scan(decoder.decode(value,{stream:true}));}
    scan(decoder.decode());
    if(quoted)throw new Error('Truncated master CSV');
    record(buffer);
    if(!header)throw new Error('Missing master CSV header');
    return items;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// A disposable, ETag-bound read projection. The published sheet and all
// writable records remain intact. Build atomically, never reuse partial data.
export async function preparedQuerySheetV175(bucket,key,source,helper,includeIds=null) {
  const cacheKey=key+'.query-v175-gzip.jsonl';
  const cached=await bucket.get(cacheKey);
  if(cached?.customMetadata?.sourceEtag===source.etag){
    await source.body.cancel();
    const stream=cached.httpMetadata?.contentEncoding==='gzip'?cached.body.pipeThrough(new DecompressionStream('gzip')):cached.body;
    return readQuerySheetV175(stream,(text,ordinal)=>helper.jsonRecordV175(text,ordinal,includeIds),true);
  }
  await cached?.body?.cancel();
  const input=source.httpMetadata?.contentEncoding==='gzip'?source.body.pipeThrough(new DecompressionStream('gzip')):source.body;
  const items=await readQuerySheetV175(input,helper.csvRecordV175);
  const upload=await bucket.createMultipartUpload(cacheKey,{customMetadata:{sourceEtag:source.etag},httpMetadata:{contentType:'application/x-ndjson',contentEncoding:'gzip'}});
  const encoder=new TextEncoder(),parts=[],gzip=new CompressionStream('gzip'),writer=gzip.writable.getWriter();
  const uploadTask=(async()=>{const reader=gzip.readable.getReader();let chunks=[],size=0;
    async function flush(final=false){if(!size)return;let bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}chunks=[];size=0;
      while(bytes.length>=5*1024*1024||final&&bytes.length){const count=Math.min(bytes.length,5*1024*1024);parts.push(await upload.uploadPart(parts.length+1,bytes.slice(0,count)));bytes=bytes.slice(count);}
      if(bytes.length){chunks=[bytes];size=bytes.length;}
    }
    try{for(;;){const {value,done}=await reader.read();if(done)break;chunks.push(value);size+=value.length;if(size>=5*1024*1024)await flush();}await flush(true);}
    finally{reader.releaseLock();}
  })();
  uploadTask.catch(()=>{});
  let text='{"querySheetV175":175}\n';
  try{
    for(const item of items){text+=JSON.stringify(item.queryCsvFieldsV175)+'\n';if(text.length>=32768){await writer.write(encoder.encode(text));text='';}}
    if(text)await writer.write(encoder.encode(text));
    await writer.close();await uploadTask;
    if((await bucket.head(key))?.etag!==source.etag)throw new Error('Master sheet changed during read preparation');
    await upload.complete(parts);
    return includeIds?items.filter(item=>includeIds.has(item.propertyId)):items;
  }catch(error){await writer.abort(error).catch(()=>{});await uploadTask.catch(()=>{});await upload.abort().catch(()=>{});throw error;}
}
