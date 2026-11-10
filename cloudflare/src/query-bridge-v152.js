export function queryEnabledV152(env){return env.JS_QUERY_ENABLED==='1'&&typeof env.LISTING_QUERY?.fetch==='function';}
export function queryUiEnabledV152(env){return queryEnabledV152(env)&&env.JS_QUERY_UI_ENABLED==='1';}
export async function queryBridgeV152(env,query,readRevision) {
  if(!queryEnabledV152(env))return Response.json({ok:false,message:'새 목록 조회가 활성화되지 않았습니다.'},{status:501});
  const raw=String(query.spec||'{}');
  if(raw.length>64*1024)throw Object.assign(new Error('조회 조건이 너무 큽니다.'),{statusCode:413});
  let spec;try{spec=JSON.parse(raw);}catch{throw Object.assign(new Error('조회 조건을 확인해 주세요.'),{statusCode:400});}
  for(let attempt=0;attempt<2;attempt++) {
    const before=await readRevision();
    if(!before?.revision||before.revision==='0')throw Object.assign(new Error('목록 기준을 확인하지 못했습니다.'),{statusCode:503});
    const response=await env.LISTING_QUERY.fetch(new Request('https://listing-query.internal/',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({revision:before.revision,spec})}));
    if(!response.ok){if(response.status===409&&!attempt){await response.body?.cancel();continue;}return response;}
    if(response.headers.get('x-js-query-revision-v152')!==before.revision||
      response.headers.get('x-js-query-schema')!=='readonly-v152'){
      await response.body?.cancel();throw Object.assign(new Error('목록 조회 기준을 확인하지 못했습니다.'),{statusCode:502});
    }
    if((await readRevision()).revision!==before.revision){await response.body?.cancel();if(!attempt)continue;
      throw Object.assign(new Error('조회 중 목록이 갱신되었습니다.'),{statusCode:409});}
    const headers=new Headers(response.headers);headers.set('cache-control','private, no-store');headers.set('vary','Cookie, Accept-Encoding');
    // Forward the authenticated private stream; do not expand another complete
    // catalog in the main Worker's snapshot-builder memory.
    return new Response(response.body,{status:200,headers});
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
  }
}
