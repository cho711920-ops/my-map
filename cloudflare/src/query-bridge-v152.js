export function queryEnabledV152(env){return env.JS_QUERY_ENABLED==='1'&&typeof env.LISTING_QUERY?.fetch==='function';}
export function queryUiEnabledV152(env){return queryEnabledV152(env)&&env.JS_QUERY_UI_ENABLED==='1';}
export async function queryBridgeV152(env,query,readRevision,request) {
  if(!queryEnabledV152(env))return Response.json({ok:false,message:'새 목록 조회가 활성화되지 않았습니다.'},{status:501});
  const raw=String(query.spec||'{}');
  if(raw.length>64*1024)throw Object.assign(new Error('조회 조건이 너무 큽니다.'),{statusCode:413});
  let spec;try{spec=JSON.parse(raw);}catch{throw Object.assign(new Error('조회 조건을 확인해 주세요.'),{statusCode:400});}
  const media=query.action==='listingQueryMedia',ids=media?String(query.ids||'').split(','):null;
  let deltaFields;try{if(query.since&&typeof query.fields==='string'&&query.fields.length<8192)deltaFields=JSON.parse(query.fields);}catch{}
  const conditional=!media&&typeof query.since==='string'&&query.since.length>0&&query.since.length<=200;
  if(media&&(!ids.length||ids.length>48||new Set(ids).size!==ids.length||ids.some(id=>!id||id.length>100||id.trim()!==id||Array.from(id).some(ch=>ch.charCodeAt(0)<32))))throw Object.assign(new Error('사진 조회 범위를 확인해 주세요.'),{statusCode:400});
  const transferHeaders={};
  if(!media&&!conditional)for(const name of ['x-js-snapshot-mode','x-js-snapshot-etag','x-js-snapshot-offset','x-js-snapshot-length']){const value=request?.headers.get(name);if(value!=null)transferHeaders[name]=value;}
  for(let attempt=0;attempt<2;attempt++) {
    // These reads are independent. Resolve the private revision in that service
    // while checking the public authority in parallel; retain both before and
    // after equality checks before publishing any response bytes.
    const [before,response]=await Promise.all([
      conditional?Promise.resolve(null):readRevision(),
      env.LISTING_QUERY.fetch(new Request('https://listing-query.internal/',{method:'POST',
        headers:{'content-type':'application/json',...transferHeaders},body:JSON.stringify({resolveCurrentV160:true,spec,
          ...(!media&&(!conditional||query.navigation==='228')&&['217','228'].includes(query.navigation)?{navigationOnlyV217:true,...(query.navigation==='228'?{compressedNavigationV228:true}:{})}:{}),...(media?{mediaIds:ids}:{}),...(!media&&query.since?{since:String(query.since).slice(0,200),fields:deltaFields}:{})})}))
    ]);
    if(!conditional&&(!before?.revision||before.revision==='0')){await response.body?.cancel();throw Object.assign(new Error('목록 기준을 확인하지 못했습니다.'),{statusCode:503});}
    if(!response.ok){if(response.status===409&&!attempt){await response.body?.cancel();continue;}return response;}
    const served=response.headers.get('x-js-query-revision-v152');
    if(!conditional&&served!==before.revision){await response.body?.cancel();if(!attempt)continue;
      throw Object.assign(new Error('조회 중 목록이 갱신되었습니다.'),{statusCode:409});}
    if(!served||served==='0'||served.length>200||
      !(media?response.headers.get('x-js-query-schema')==='readonly-media-v159':
        response.headers.get('x-js-query-schema')==='readonly-v152'||query.since&&response.headers.get('x-js-query-schema')==='readonly-delta-v160')){
      await response.body?.cancel();throw Object.assign(new Error('목록 조회 기준을 확인하지 못했습니다.'),{statusCode:502});
    }
    if((await readRevision()).revision!==served){await response.body?.cancel();if(!attempt)continue;
      throw Object.assign(new Error('조회 중 목록이 갱신되었습니다.'),{statusCode:409});}
    const headers=new Headers(response.headers);headers.set('cache-control','private, no-store');headers.set('vary','Cookie, Accept-Encoding');
    // The private service supplies decoded JSON. Ask the public Workers runtime
    // to compress that stream on the wire, without buffering the whole catalog.
    // Snapshot ranges are already encoded and must retain their exact bytes.
    const acceptsGzip=String(request?.headers.get('accept-encoding')||'').split(',').some(part=>{
      const [name,...parameters]=part.trim().toLowerCase().split(';');
      const quality=parameters.find(value=>value.trim().startsWith('q='));
      return name==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);
    });
    if(acceptsGzip&&['readonly-v152','readonly-delta-v160'].includes(headers.get('x-js-query-schema'))&&
      /^application\/json\b/i.test(headers.get('content-type')||'')&&
      !headers.has('content-encoding')&&!headers.has('x-js-snapshot-protocol')){
      headers.set('content-encoding','gzip');headers.delete('content-length');
      headers.set('x-js-data-encoding','http-gzip-v217');
    }
    // Forward the authenticated private stream; do not expand another complete
    // catalog in the main Worker's snapshot-builder memory.
    return new Response(response.body,{status:200,headers,encodeBody:response.headers.has('content-encoding')?'manual':'automatic'});
  }
  throw Object.assign(new Error('조회 중 목록이 갱신되었습니다.'),{statusCode:409});
}
export async function warmQueryViewsV152(env,readRevision){
  if(!queryEnabledV152(env))return;
  for(const mode of ['lease','building_sale','land_sale']){
    const state=await readRevision();if(!state.revision||state.revision==='0')return;
    const response=await env.LISTING_QUERY.fetch(new Request('https://listing-query.internal/',{method:'POST',
      headers:{'content-type':'application/json','x-js-query-warm-v152':'1'},body:JSON.stringify({revision:state.revision,spec:{mode}})}));
    await response.body?.cancel();if(!response.ok)throw new Error('목록 준비 조회 HTTP '+response.status);
    const navigation=await env.LISTING_QUERY.fetch(new Request('https://listing-query.internal/',{method:'POST',
      headers:{'content-type':'application/json','x-js-query-warm-v152':'1'},body:JSON.stringify({revision:state.revision,spec:{mode},navigationOnlyV217:true,compressedNavigationV228:true})}));
    await navigation.body?.cancel();if(!navigation.ok)throw new Error('초기 목록 전송 준비 HTTP '+navigation.status);
    const pictures=await env.LISTING_QUERY.fetch(new Request('https://listing-query.internal/',{method:'POST',
      headers:{'content-type':'application/json','x-js-query-warm-v152':'1'},body:JSON.stringify({revision:state.revision,spec:{mode},mediaIds:[]})}));
    await pictures.body?.cancel();if(!pictures.ok)throw new Error('대표 사진 준비 HTTP '+pictures.status);
  }
}
