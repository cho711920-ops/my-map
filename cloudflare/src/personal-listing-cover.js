const SCOPE = "personalListingCoverV85";
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}});
const parse = value => {try {return JSON.parse(value || "null");} catch {return null;}};
async function digest(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2,"0")).join("");
}
function dimensions(bytes) {
  if(bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217) throw fail("JPEG 사진 형식을 확인해 주세요.");
  for(let at=2;at+8<bytes.length;){
    if(bytes[at++]!==255)break;
    while(bytes[at]===255)at++;
    const marker=bytes[at++];
    if(marker===218 || marker===217)break;
    const length=(bytes[at]<<8)|bytes[at+1];
    if(length<2 || at+length>bytes.length)break;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {height:(bytes[at+3]<<8)|bytes[at+4],width:(bytes[at+5]<<8)|bytes[at+6]};
    at+=length;
  }
  throw fail("사진 크기를 확인하지 못했습니다.");
}
function image(value, maxBytes, maxSize) {
  if(typeof value!=="string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw fail("JPEG 사진만 저장할 수 있습니다.");
  const encoded=value.slice(23);
  if(encoded.length>Math.ceil(maxBytes/3)*4)throw fail("사진 용량을 줄인 뒤 다시 저장해 주세요.",413);
  let raw;try{raw=atob(encoded);}catch{throw fail("사진을 읽지 못했습니다.");}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),size=dimensions(bytes);
  if(bytes.length>maxBytes || Math.min(size.width,size.height)<16 || Math.max(size.width,size.height)>maxSize)throw fail("사진 크기 또는 용량을 확인해 주세요.",413);
  return {bytes,...size};
}
function keys(owner, propertyId, imageId){const base=`personal-covers/v85/${owner}/${propertyId}/${imageId}`;return [base+"-main.jpg",base+"-thumb.jpg"];}
function metadata(row){
  const data=parse(row?.value_json);
  return data && typeof data==="object" && !Array.isArray(data) && (data.imageId==="" || uuidPattern.test(data.imageId||"")) ? data : null;
}
function entry(row, propertyId, owner){
  const data=metadata(row),version=Number(row?.version)||0;
  if(!data?.imageId)return {propertyId,version,imageId:"",requestId:data?.requestId};
  const query=new URLSearchParams({propertyId,imageId:data.imageId,owner});
  return {propertyId,version,imageId:data.imageId,requestId:data.requestId,source:data.source,savedAt:data.savedAt,
    width:data.width,height:data.height,url:"/api/personal-cover?"+query,thumbnailUrl:"/api/personal-cover?"+query+"&kind=thumb"};
}
async function read(env,owner,id){return env.DB.prepare("SELECT value_json,version,updated_at FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3").bind(owner,SCOPE,id).first();}
async function write(env,owner,id,data,expectedVersion){
  const now=new Date().toISOString();
  const result=await env.DB.prepare(`INSERT INTO cloud_state(owner_email,scope,record_key,value_json,version,updated_at)
    SELECT ?1,?2,?3,?4,?5,?6 WHERE (?7=0 AND NOT EXISTS(SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3))
      OR EXISTS(SELECT 1 FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key=?3 AND version=?7)
    ON CONFLICT(owner_email,scope,record_key) DO UPDATE SET value_json=excluded.value_json,version=excluded.version,updated_at=excluded.updated_at WHERE cloud_state.version=?7`)
    .bind(owner,SCOPE,id,JSON.stringify(data),expectedVersion+1,now,expectedVersion).run();
  return Number(result?.meta?.changes)===1 ? {value_json:JSON.stringify(data),version:expectedVersion+1,updated_at:now}:null;
}
export async function handlePersonalListingCover(request,env,user,body,context){
  const owner=String(user?.email||"").trim().toLowerCase();if(!owner)throw fail("로그인 계정을 확인해 주세요.",401);
  if(!env.DB||!env.MEDIA)throw fail("사진 저장소를 준비하지 못했습니다.",503);
  const ownerHash=await digest(owner),url=new URL(request.url);
  const propertyId=String(body?.propertyId||url.searchParams.get("propertyId")||"");
  if(propertyId&&!idPattern.test(propertyId))throw fail("매물을 확인해 주세요.");
  if(request.method==="GET"){
    if(url.searchParams.has("imageId")){
      if(url.searchParams.get("owner")!==ownerHash)throw fail("현재 계정의 사진이 아닙니다.",403);
      const row=await read(env,owner,propertyId),data=metadata(row),imageId=url.searchParams.get("imageId");
      if(!propertyId||!uuidPattern.test(imageId||"")||data?.imageId!==imageId)throw fail("대표사진이 변경되었거나 삭제되었습니다.",404);
      const object=await env.MEDIA.get(keys(ownerHash,propertyId,imageId)[url.searchParams.get("kind")==="thumb"?1:0]);
      if(!object)throw fail("대표사진을 찾지 못했습니다.",404);
      return new Response(object.body,{headers:{"content-type":"image/jpeg","cache-control":"private, max-age=86400, immutable"}});
    }
    if(propertyId)return json({ok:true,cover:entry(await read(env,owner,propertyId),propertyId,ownerHash)});
    const cursor=String(url.searchParams.get("cursor")||"");if(cursor&&!idPattern.test(cursor))throw fail("목록 위치를 확인해 주세요.");
    const result=await env.DB.prepare("SELECT record_key,value_json,version FROM cloud_state WHERE owner_email=?1 AND scope=?2 AND record_key>?3 ORDER BY record_key LIMIT 251").bind(owner,SCOPE,cursor).all();
    const rows=result?.results||[],page=rows.slice(0,250);
    return json({ok:true,covers:page.map(row=>entry(row,row.record_key,ownerHash)),nextCursor:rows.length>250?page.at(-1).record_key:""});
  }
  if(request.method!=="POST")return new Response(null,{status:405,headers:{allow:"GET, POST"}});
  if(!propertyId||!Number.isSafeInteger(body?.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER||!uuidPattern.test(body?.requestId||""))throw fail("최신 대표사진을 확인한 뒤 다시 저장해 주세요.",428);
  const target=await env.DB.prepare("SELECT id FROM listings WHERE (id=?1 OR property_id=?1) AND status<>'deleted' LIMIT 1").bind(propertyId).first();
  if(!target)throw fail("저장할 매물을 찾지 못했습니다.",404);
  const before=await read(env,owner,propertyId),previous=metadata(before),reset=body.action==="reset";
  if(!reset&&body.action!=="save")throw fail("사진 저장 동작을 확인해 주세요.");
  let main,thumb,hash="";
  if(!reset){
    main=image(body.image,750000,1280);thumb=image(body.thumbnail,80000,320);
    if(Math.abs(main.width/main.height-thumb.width/thumb.height)>.05)throw fail("원본 사진과 썸네일의 범위가 다릅니다.");
    hash=await digest(await digest(main.bytes)+await digest(thumb.bytes));
  }
  if(previous?.requestId===body.requestId){if(previous.hash!==hash)throw fail("같은 저장 요청의 사진이 다릅니다.",409);return json({ok:true,persisted:true,cover:entry(before,propertyId,ownerHash)});}
  if((Number(before?.version)||0)!==body.expectedVersion)throw fail("다른 기기에서 대표사진이 변경됐습니다. 최신 사진을 확인해 주세요.",409);
  const imageId=reset?"":crypto.randomUUID(),newKeys=imageId?keys(ownerHash,propertyId,imageId):[];
  let saved;
  try{
    if(!reset){
      const results=await Promise.allSettled([main,thumb].map((part,i)=>env.MEDIA.put(newKeys[i],part.bytes,{httpMetadata:{contentType:"image/jpeg"}})));
      if(results.some(r=>r.status==="rejected"))throw fail("사진 저장이 지연되고 있습니다. 다시 확인해 주세요.",503);
    }
    const data={imageId,requestId:body.requestId,hash,source:reset?"":['naver','kakao','upload','paste'].includes(body.source)?body.source:'upload',
      savedAt:new Date().toISOString(),width:main?.width||0,height:main?.height||0};
    saved=await write(env,owner,propertyId,data,body.expectedVersion);
    if(!saved){
      const current=await read(env,owner,propertyId),currentData=metadata(current);
      if(currentData?.requestId===body.requestId&&currentData.hash===hash){if(newKeys.length)await env.MEDIA.delete(newKeys);return json({ok:true,persisted:true,cover:entry(current,propertyId,ownerHash)});}
      throw fail("다른 기기에서 대표사진이 변경됐습니다. 최신 사진을 확인해 주세요.",409);
    }
  }catch(error){if(!saved&&newKeys.length)await env.MEDIA.delete(newKeys).catch(()=>{});throw error;}
  if(previous?.imageId){const cleanup=env.MEDIA.delete(keys(ownerHash,propertyId,previous.imageId)).catch(()=>{});if(context?.waitUntil)context.waitUntil(cleanup);else await cleanup;}
  return json({ok:true,persisted:true,cover:entry(saved,propertyId,ownerHash)});
}
