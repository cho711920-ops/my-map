export const QUERY_SALE_FIELDS_V175=Object.freeze(['landAreaM2','grossAreaM2','totalDeposit','monthlyIncome','monthlyIncomeConflict','scope','saleExtent',
  'sourceType','sourceTypeCode','category','landUse','zoning']);

// Consume the published master CSV one record at a time. Reading its entire
// text beside the parsed rows can exceed the Worker's memory before filtering.
export async function readQuerySheetV175(stream, convert) {
  const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',cursor=0,start=0,quoted=false,header=false,ordinal=0;
  const items=[];
  function record(text) {
    if(text.endsWith('\r'))text=text.slice(0,-1);
    if(!text)return;
    const item=convert(text,header?++ordinal:0);
    if(header)items.push(item);else header=true;
  }
  function scan(chunk) {
    buffer+=chunk;
    for(;cursor<buffer.length;cursor++) {
      if(buffer[cursor]==='"')quoted=!quoted;
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
