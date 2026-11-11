// Private, immutable file objects; small per-file metadata lives outside ads.
export const ATTACHMENT_SCOPE_V181 = 'listingAttachmentsV181';
export const MAX_ATTACHMENT_BYTES_V181 = 20 * 1024 * 1024;
const SCOPE = ATTACHMENT_SCOPE_V181;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (message,statusCode=400) => Object.assign(new Error(message),{statusCode});
const json = data => new Response(JSON.stringify(data),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const parse = row => {try{return JSON.parse(row?.value_json || 'null');}catch{return null;}};
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');}
export function attachmentFileTypeV181(filename,bytes){
  const ext=filename.split('.').pop().toLowerCase(),has=(offset,values)=>values.every((v,i)=>bytes[offset+i]===v);
  if(ext==='pdf'&&has(0,[37,80,68,70,45]))return 'application/pdf';
  if(['jpg','jpeg'].includes(ext)&&has(0,[255,216,255])&&has(bytes.length-2,[255,217]))return 'image/jpeg';
  if(ext==='png'&&has(0,[137,80,78,71,13,10,26,10]))return 'image/png';
  if(ext==='webp'&&has(0,[82,73,70,70])&&has(8,[87,69,66,80]))return 'image/webp';
  if(ext==='xls'&&has(0,[208,207,17,224,161,177,26,225]))return 'application/vnd.ms-excel';
  if(ext==='xlsx'&&has(0,[80,75,3,4])){
    // Verify the ZIP directory without expanding attacker-controlled entries.
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),names=new Set();
    let end=-1;
    for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(view.getUint32(at,true)===0x06054b50){end=at;break;}
    if(end>=0){
      const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true);let at=view.getUint32(end+16,true);
      if(count<=2000&&at+length<=end)for(let n=0;n<count;n++){
        if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)break;
        const size=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true);
        if(at+46+size+extra+comment>bytes.length)break;
        const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+size));
        if(name.includes('..')||name.includes('\\')||/vbaProject\.bin$/i.test(name))throw fail('매크로가 없는 XLSX 파일로 첨부해 주세요.');
        names.add(name);at+=46+size+extra+comment;
      }
      if(names.has('[Content_Types].xml')&&names.has('xl/workbook.xml'))return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
  }
  throw fail('사진(JPG·PNG·WebP), PDF, 엑셀(XLS·XLSX) 파일을 첨부해 주세요.');
}
async function bytesWithinLimit(request){
  const size=Number(request.headers.get('content-length'));
  if(Number.isFinite(size)&&size>MAX_ATTACHMENT_BYTES_V181)throw fail('파일은 한 개당 20MB까지 첨부할 수 있습니다.',413);
  const reader=request.body?.getReader();if(!reader)throw fail('첨부할 파일을 선택해 주세요.');
  const parts=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_ATTACHMENT_BYTES_V181){await reader.cancel();throw fail('파일은 한 개당 20MB까지 첨부할 수 있습니다.',413);}parts.push(value);}}finally{reader.releaseLock();}
  if(!length)throw fail('내용이 없는 파일은 첨부할 수 없습니다.');
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
async function target(env,id){
  if(!idPattern.test(id))throw fail('첨부할 매물을 확인해 주세요.');
  const rows=(await env.DB.prepare("SELECT id,property_id FROM listings WHERE (id=?1 OR property_id=?1) AND status<>'deleted' LIMIT 2").bind(id).all())?.results||[];
  if(rows.length!==1)throw fail('매물 연결이 변경됐습니다. 해당 매물에서 다시 열어 주세요.',404);
  return {id:rows[0].id,propertyId:rows[0].property_id||rows[0].id};
}
async function rowFor(env,owner,id){return env.DB.prepare('SELECT value_json,version FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3').bind(owner,SCOPE,id).first();}
function entry(row,propertyId,ownerHash){
  const data=parse(row);if(!data||!uuidPattern.test(data.id||''))throw fail('첨부자료 정보를 확인하지 못했습니다.',503);
  const query=new URLSearchParams({propertyId,file:data.id,owner:ownerHash});
  return {id:data.id,propertyId,filename:data.filename,mediaType:data.mediaType,byteSize:data.byteSize,uploadedAt:data.uploadedAt,deletedAt:data.deletedAt||'',version:row.version,
    url:'/api/listing-attachments?'+query,downloadUrl:'/api/listing-attachments?'+query+'&download=1'};
}
export async function handleListingAttachmentsV181(request,env,user,body){
  const owner=String(user?.email||'').trim().toLowerCase();if(!owner)throw fail('로그인이 필요합니다.',401);
  if(!env.DB||!env.MEDIA)throw fail('첨부자료 보관함에 연결하지 못했습니다.',503);
  const url=new URL(request.url),ownerHash=await digest(owner),id=String(body?.propertyId||url.searchParams.get('propertyId')||'');
  if(request.method==='GET'&&url.searchParams.has('ids')){
    const ids=String(url.searchParams.get('ids')).split(',');
    if(!ids.length||ids.length>24||new Set(ids).size!==ids.length||ids.some(v=>!idPattern.test(v)))throw fail('첨부 개수의 조회 범위를 확인해 주세요.');
    const rows=(await env.DB.prepare(`SELECT l.id,l.property_id,COUNT(c.record_key) AS count FROM listings l LEFT JOIN cloud_state c
      ON c.owner_email=?1 AND c.scope=?2 AND json_extract(c.value_json,'$.listingId')=l.id AND COALESCE(json_extract(c.value_json,'$.deletedAt'),'')=''
      WHERE l.status<>'deleted' AND (l.id IN (SELECT value FROM json_each(?3)) OR l.property_id IN (SELECT value FROM json_each(?3))) GROUP BY l.id,l.property_id`)
      .bind(owner,SCOPE,JSON.stringify(ids)).all())?.results||[];
    const counts={};for(const id of ids){const found=rows.filter(r=>r.id===id||r.property_id===id);if(found.length===1)counts[id]=Number(found[0].count);}
    return json({ok:true,counts});
  }
  const listing=await target(env,id);
  if(request.method==='GET'){
    if(url.searchParams.has('file')){
      const fileId=url.searchParams.get('file');if(!uuidPattern.test(fileId||'')||url.searchParams.get('owner')!==ownerHash)throw fail('현재 계정의 첨부자료가 아닙니다.',403);
      const row=await rowFor(env,owner,fileId),data=parse(row);
      if(!data||data.listingId!==listing.id||data.deletedAt)throw fail('첨부자료가 삭제되었거나 연결이 변경됐습니다.',404);
      if(!new RegExp('^listing-attachments/v181/'+ownerHash+'/'+fileId+'/[a-f0-9-]{36}$').test(data.objectKey||'')||
        !/^(?:image\/(?:jpeg|png|webp)|application\/(?:pdf|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet))$/.test(data.mediaType||''))throw fail('첨부자료의 저장 연결을 확인하지 못했습니다.',404);
      const object=await env.MEDIA.get(data.objectKey);if(!object)throw fail('첨부파일을 찾지 못했습니다.',404);
      const inline=!url.searchParams.has('download')&&/^(?:image\/(?:jpeg|png|webp)|application\/pdf)$/.test(data.mediaType);
      return new Response(object.body,{headers:{'content-type':data.mediaType,'content-length':String(data.byteSize),'cache-control':'private, no-store',
        'content-disposition':(inline?'inline':'attachment')+`; filename="attachment.${data.filename.split('.').pop()}"; filename*=UTF-8''`+encodeURIComponent(data.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),
        'x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'; frame-ancestors 'none'"}});
    }
    const rows=(await env.DB.prepare("SELECT value_json,version FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND json_extract(value_json,'$.listingId')=?3 ORDER BY json_extract(value_json,'$.uploadedAt') DESC LIMIT 1001").bind(owner,SCOPE,listing.id).all())?.results||[];
    return json({ok:true,propertyId:listing.propertyId,items:rows.map(row=>entry(row,listing.propertyId,ownerHash)),maxFileBytes:MAX_ATTACHMENT_BYTES_V181});
  }
  if(request.method==='POST'&&request.headers.get('content-type')?.split(';')[0]==='application/octet-stream'){
    const fileId=request.headers.get('x-attachment-request');if(!uuidPattern.test(fileId||''))throw fail('첨부 요청을 다시 확인해 주세요.');
    let filename;try{filename=decodeURIComponent(request.headers.get('x-attachment-filename')||'');}catch{throw fail('파일 이름을 확인해 주세요.');}
    filename=Array.from(filename).map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||/[\\/:*?"<>|]/.test(c)?'_':c).join('').trim();
    if(!filename||filename.length>180)throw fail('파일 이름은 180자 이내로 지정해 주세요.');
    const bytes=await bytesWithinLimit(request),mediaType=attachmentFileTypeV181(filename,bytes),hash=await digest(bytes);
    const same=data=>data&&data.listingId===listing.id&&data.hash===hash&&data.filename===filename&&data.byteSize===bytes.length&&!data.deletedAt;
    const before=await rowFor(env,owner,fileId);
    if(before){if(!same(parse(before)))throw fail('같은 첨부 요청의 파일이나 매물이 다릅니다.',409);return json({ok:true,persisted:true,item:entry(before,listing.propertyId,ownerHash)});}
    const objectKey=`listing-attachments/v181/${ownerHash}/${fileId}/${crypto.randomUUID()}`;
    const now=new Date().toISOString(),data={id:fileId,listingId:listing.id,propertyId:listing.propertyId,filename,mediaType,byteSize:bytes.length,hash,objectKey,uploadedAt:now,deletedAt:''};
    await env.MEDIA.put(objectKey,bytes,{httpMetadata:{contentType:mediaType}});
    let written;
    try{
      const result=await env.DB.prepare(`INSERT INTO cloud_state(owner_email,scope,record_key,value_json,version,updated_at)
        SELECT ?1,?2,?3,?4,1,?5 WHERE EXISTS(SELECT 1 FROM listings WHERE id=?6 AND status<>'deleted')
        AND (SELECT COUNT(*) FROM cloud_state WHERE owner_email=?1 AND scope=?2)<1000
        AND (SELECT COALESCE(SUM(json_extract(value_json,'$.byteSize')),0) FROM cloud_state WHERE owner_email=?1 AND scope=?2)+?7<=1073741824
        AND (SELECT COUNT(*) FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND json_extract(value_json,'$.listingId')=?6)<100
        AND (SELECT COALESCE(SUM(json_extract(value_json,'$.byteSize')),0) FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND json_extract(value_json,'$.listingId')=?6)+?7<=262144000
        ON CONFLICT(owner_email,scope,record_key) DO NOTHING`).bind(owner,SCOPE,fileId,JSON.stringify(data),now,listing.id,bytes.length).run();
      written=Number(result?.meta?.changes)===1;
    }catch(error){
      // A lost DB response may follow a committed insert. Never delete its file.
      const row=await rowFor(env,owner,fileId).catch(()=>null);
      if(row){if(parse(row)?.objectKey!==objectKey)await env.MEDIA.delete(objectKey).catch(()=>{});if(same(parse(row)))return json({ok:true,persisted:true,item:entry(row,listing.propertyId,ownerHash)});}
      throw error;
    }
    if(written)return json({ok:true,persisted:true,item:entry({value_json:JSON.stringify(data),version:1},listing.propertyId,ownerHash)});
    await env.MEDIA.delete(objectKey).catch(()=>{});
    const current=await rowFor(env,owner,fileId);if(current){if(!same(parse(current)))throw fail('같은 첨부 요청의 파일이나 매물이 다릅니다.',409);return json({ok:true,persisted:true,item:entry(current,listing.propertyId,ownerHash)});}
    throw fail('매물 연결 또는 보관 용량을 확인해 주세요. 매물당 100개·250MB, 계정당 1GB(휴지통 포함)까지 보관합니다.',409);
  }
  if(request.method==='POST'){
    if(!['trash','restore'].includes(body?.action)||!uuidPattern.test(body?.id||'')||!uuidPattern.test(body?.requestId||'')||!Number.isSafeInteger(body?.expectedVersion)||body.expectedVersion<1)throw fail('첨부자료의 최신 상태를 확인해 주세요.');
    const row=await rowFor(env,owner,body.id),data=parse(row);
    if(!data||data.listingId!==listing.id)throw fail('해당 매물의 첨부자료가 아닙니다.',404);
    if(data.actionRequestId===body.requestId&&data.action===body.action)return json({ok:true,persisted:true,item:entry(row,listing.propertyId,ownerHash)});
    const now=new Date().toISOString(),next={...data,deletedAt:body.action==='trash'?now:'',action:body.action,actionRequestId:body.requestId};
    const result=await env.DB.prepare(`UPDATE cloud_state SET value_json=?1,version=version+1,updated_at=?2 WHERE owner_email=?3 AND scope=?4 AND record_key=?5 AND version=?6
      AND EXISTS(SELECT 1 FROM listings WHERE id=?7 AND status<>'deleted')`).bind(JSON.stringify(next),now,owner,SCOPE,body.id,body.expectedVersion,listing.id).run();
    if(Number(result?.meta?.changes)!==1)throw fail('다른 작업에서 첨부자료가 변경됐습니다. 다시 확인해 주세요.',409);
    return json({ok:true,persisted:true,item:entry({value_json:JSON.stringify(next),version:row.version+1},listing.propertyId,ownerHash)});
  }
  return new Response(null,{status:405,headers:{allow:'GET, POST'}});
}
