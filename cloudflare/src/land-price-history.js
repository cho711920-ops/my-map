import {parseEumLandHtml,validateParcelPnu} from './sale-parcel-facts.js';

const EUM='https://www.eum.go.kr',TTL=6*3600000,pending=new WeakMap();
const message='연도별 공시지가를 확인하지 못했습니다. 잠시 후 다시 조회하거나 토지이음 원문을 확인해 주세요.';
function unavailable(){return Object.assign(new Error(message),{code:'history_unavailable'});}
export function parseLandPriceHistory(html,now=new Date()){
  if(typeof html!=='string'||html.length>200000||html.includes('\ufffd')||/<(?:script|iframe)\b/i.test(html))throw unavailable();
  const thisMonth=new Date(now.getTime()+9*3600000).toISOString().slice(0,7),records=new Map();
  const rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if(!rows.length||rows.length>128||html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi,'').trim())throw unavailable();
  for(const row of rows){
    const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/&nbsp;|&#160;/g,' ').trim());
    const period=cells[0]?.match(/^(\d{4})\s*\/\s*(\d{1,2})$/),amount=cells[1]?.match(/^(\d{1,3}(?:,\d{3})*|\d+)\s*원$/);
    if(cells.length!==2||!period||!amount)throw unavailable();
    const baseYear=Number(period[1]),baseMonth=Number(period[2]),wonPerM2=Number(amount[1].replace(/,/g,''));
    const key=baseYear+'-'+String(baseMonth).padStart(2,'0');
    if(baseYear<1990||baseMonth<1||baseMonth>12||key>thisMonth||!Number.isSafeInteger(wonPerM2)||wonPerM2<=0||wonPerM2>1000000000)throw unavailable();
    if(records.has(key)&&records.get(key).wonPerM2!==wonPerM2)throw unavailable();
    records.set(key,{baseYear,baseMonth,wonPerM2});
  }
  return [...records.values()].sort((a,b)=>a.baseYear-b.baseYear||a.baseMonth-b.baseMonth);
}
async function read(url,headers={}){
  const response=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok||Number(response.headers.get('content-length'))>1800000)throw unavailable();
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1800000)throw unavailable();
  return {response,text:new TextDecoder(/charset\s*=\s*euc-kr/i.test(response.headers.get('content-type')||'')?'euc-kr':'utf-8').decode(bytes)};
}
function publicSession(headers){
  // A fresh anonymous EUM session binds this lookup to one verified parcel.
  // Never forward browser cookies, keep a shared jar, or return this cookie.
  const all=typeof headers.getSetCookie==='function'?headers.getSetCookie():typeof headers.getAll==='function'?headers.getAll('set-cookie'):[headers.get('set-cookie')||''];
  const cookies=[];let session=false;
  for(const value of all){const m=value.match(/^(JSESSIONID|elevisor_for_j2ee_uid)=([^;\r\n]{1,256})(?:;|$)/);if(m){cookies.push(m[1]+'='+m[2]);if(m[1]==='JSESSIONID')session=true;}}
  if(!session)throw unavailable();return cookies.join('; ');
}
async function load(env,pnu){
  const key='sale-land-price-history-v1/'+pnu+'.json';
  if(env.MEDIA){try{const object=await env.MEDIA.get(key),cached=object&&await object.json(),age=Date.now()-Date.parse(cached?.fetchedAt||'');
    if(cached?.ok&&cached.pnu===pnu&&Array.isArray(cached.records)&&cached.records.length&&age>=0&&age<TTL)return {...cached,cached:true};
  }catch(_) {}}
  const sourcePage=EUM+'/web/ar/lu/luLandDet.jsp?selGbn=umd&isNoScr=script&mode=search&pnu='+pnu;
  const base=await read(sourcePage),parcel=parseEumLandHtml(base.text,pnu),cookie=publicSession(base.response.headers);
  const history=await read(EUM+'/web/ar/lu/luLandDetYearAjax.jsp?pnu='+pnu,{cookie,referer:sourcePage,'X-Requested-With':'XMLHttpRequest'});
  const records=parseLandPriceHistory(history.text);
  const result={ok:true,action:'saleLandPriceHistory',pnu,address:parcel.address,records,source:'토지이음 공개 열람 · 연도별 개별공시지가',sourcePage,
    fetchedAt:new Date().toISOString(),cached:false,regionalAverages:{available:false,message:'동·구 평균은 검증된 집계 자료가 아직 연결되지 않았습니다.'}};
  if(env.MEDIA){try{await env.MEDIA.put(key,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});}catch(_) {}}
  return result;
}
export async function getLandPriceHistory(env,query){
  const pnu=validateParcelPnu(query.pnu);let requests=pending.get(env);if(!requests){requests=new Map();pending.set(env,requests);}
  if(requests.has(pnu))return requests.get(pnu);
  if(requests.size>=4)return {ok:false,code:'busy',message:'다른 필지의 공시지가 이력을 확인 중입니다. 잠시 후 다시 조회해 주세요.'};
  const request=load(env,pnu).catch(()=>({ok:false,code:'history_unavailable',message})).finally(()=>requests.delete(pnu));
  requests.set(pnu,request);return request;
}
