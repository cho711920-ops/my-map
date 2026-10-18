// User-requested parcel only. Public EUM reference pages; no ads/ownership data.
const EUM = 'https://www.eum.go.kr';
const pending = new WeakMap();
const text = v => String(v ?? '').trim();
const sourcePage = pnu => EUM + '/web/ar/lu/luLandDet.jsp?selGbn=umd&isNoScr=script&mode=search&pnu=' + pnu;
export function validateParcelPnu(value) {
  const pnu = text(value);
  if (!/^[1-9]\d{9}[12]\d{8}$/.test(pnu) || Number(pnu.slice(11,15)) === 0)
    throw Object.assign(new Error('확인할 필지번호가 올바르지 않습니다.'), {statusCode: 400});
  return pnu;
}
function failure(message = '토지이음 자료를 확인하지 못했습니다. 공식 원문에서 확인하거나 잠시 후 다시 조회해 주세요.') {
  return Object.assign(new Error(message), {publicCode: 'source_unavailable'});
}
function decodeEntities(s) {
  return s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>0&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):'';})
    .replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&');
}
function plain(s) {return decodeEntities(String(s).replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function attrs(tag) {
  const out={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))out[match[1].toLowerCase()]=decodeEntities(match[2]??match[3]??match[4]);return out;
}
function cell(html,id) {return html.match(new RegExp('<td\\b[^>]*\\bid=["\']'+id+'["\'][^>]*>([\\s\\S]*?)</td>','i'))?.[1];}
// EUM contains hidden explanatory popups inside each cell. Only direct-child
// anchors are designation labels; popup law text must never become a new zone.
export function parseDesignationCell(fragment) {
  if(fragment==null)return {available:false,items:[],complete:false};
  const tokens=fragment.replace(/<!--[\s\S]*?-->/g,'').match(/<[^>]*>|[^<]+/g)||[],stack=[],items=[];
  const voids=new Set(['input','img','br','hr','meta','link','wbr','area','source']);
  let current=null,complete=true;
  for(const token of tokens){
    if(token[0]!=='<'){if(current)current.label+=decodeEntities(token);continue;}
    const tag=token.match(/^<\s*(\/?)\s*([a-z][\w:-]*)/i);if(!tag)continue;
    const name=tag[2].toLowerCase();
    if(tag[1]){
      if(name==='a'&&stack.length===1&&current){
        current.label=current.label.replace(/\s+/g,' ').trim();
        if(current.label){if(current.label.length>600||items.length>=128)complete=false;else items.push(current);}
        current=null;
      }
      const index=stack.lastIndexOf(name);if(index<0){complete=false;continue;}stack.length=index;
    }else{
      if(name==='a'&&!stack.length){const a=attrs(token);current={label:'',code:text(a.onclick?.match(/live_layer_([A-Z0-9]+)_/)?.[1])};}
      if(!voids.has(name)&&!token.endsWith('/>'))stack.push(name);
    }
  }
  if(stack.length||current||(!items.length&&plain(fragment)))complete=false;
  return {available:true,items,complete};
}
export function parseEumLandHtml(html,pnu){
  validateParcelPnu(pnu);
  if(typeof html!=='string'||html.length>1500000||html.includes('\ufffd'))throw failure('토지이음의 문자·자료 형식을 검증하지 못했습니다. 공식 원문을 확인해 주세요.');
  const inputs=[...html.matchAll(/<input\b[^>]*>/gi)].map(m=>attrs(m[0]));
  const pnus=inputs.filter(a=>a.id==='pnu').map(a=>a.value);
  if(pnus.length!==1||pnus[0]!==pnu)throw failure('요청한 필지와 토지이음 응답이 일치하지 않습니다. 지번을 다시 확인해 주세요.');
  const address=plain(html.match(/<th\b[^>]*>\s*소재지\s*<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1]||'');
  const landUse=text(inputs.find(a=>a.id==='present_class_val')?.value);
  const areaText=plain(cell(html,'present_area')||'');
  const area=Number(areaText.replace(/[\s,㎡]/g,''));
  if(!address||address.length>200||!landUse||landUse.length>40||!areaText.includes('㎡')||!Number.isFinite(area)||area<=0)throw failure('토지이음의 필지 기본정보를 검증하지 못했습니다. 공식 원문을 확인해 주세요.');
  const regulations=[['planning','국토계획법에 따른 지역·지구','present_mark1'],['other','다른 법령에 따른 지역·지구','present_mark2'],['additional','그 밖의 확인사항','present_mark3']].map(([key,label,id])=>({key,label,...parseDesignationCell(cell(html,id))}));
  return {pnu,address,landUse,areaM2:area,regulations,regulationsComplete:regulations.every(r=>r.complete)};
}
export function parseEumLandPrice(xml,now=new Date()){
  const code=text(xml.match(/<CODE>\s*([^<]+)\s*<\/CODE>/)?.[1]);
  if(code!=='0000')return {available:false,message:'공시지가 연계 자료가 제공되지 않았습니다.'};
  const year=Number(xml.match(/<BASE_YEAR>\s*(\d{4})\s*<\/BASE_YEAR>/)?.[1]);
  const month=Number(xml.match(/<STDMT>\s*(\d{1,2})\s*<\/STDMT>/)?.[1]);
  const amount=Number(xml.match(/<JIGA>\s*(\d+(?:\.\d+)?)\s*<\/JIGA>/)?.[1]);
  const thisMonth=new Date(now.getTime()+9*3600000).toISOString().slice(0,7);
  if(!Number.isFinite(amount)||amount<=0||year<1990||month<1||month>12||![year,month].every(Number.isInteger)||`${year}-${String(month).padStart(2,'0')}`>thisMonth)throw failure('공시지가 금액·기준시점을 검증하지 못했습니다. 공식 원문을 확인해 주세요.');
  return {available:true,wonPerM2:amount,baseYear:year,baseMonth:month};
}
function priceUrl(pnu){
  const url=new URL('https://api.eum.go.kr/web/api/korep/UrlConnector.jsp');
  url.searchParams.set('url',[['adm_sect_cd',pnu.slice(0,5)],['land_loc_cd',pnu.slice(5,10)],['ledg_gbn',pnu[10]],['bobn',pnu.slice(11,15)],['bubn',pnu.slice(15)]].map(([k,v])=>k+'='+v).join('|'));return url;
}
async function fetchText(url){
  let response;try{response=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'manual'});}catch(_){throw failure();}
  if(!response.ok)throw failure();
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1800000)throw failure();
  const prefix=new TextDecoder().decode(bytes.slice(0,160));
  // The price response declares UTF-8 in its XML even though its HTTP header
  // says EUC-KR. The explicit XML declaration takes precedence.
  const utfXml=/<\?xml[^>]+encoding=["']utf-8["']/i.test(prefix);
  return new TextDecoder(!utfXml&&/charset\s*=\s*euc-kr/i.test(response.headers.get('content-type')||'')?'euc-kr':'utf-8').decode(bytes);
}
async function load(env,pnu){
  const key='sale-parcel-reference-v1/'+pnu+'.json';
  if(env.MEDIA){try{const object=await env.MEDIA.get(key),cached=object&&await object.json(),age=Date.now()-Date.parse(cached?.fetchedAt||'');if(cached?.ok&&cached.pnu===pnu&&cached.complete&&age>=0&&age<6*3600000)return {...cached,cached:true};}catch(_) {}}
  const html=await fetchText(sourcePage(pnu));
  const data=parseEumLandHtml(html,pnu);let price;
  try{price=parseEumLandPrice(await fetchText(priceUrl(pnu)));}catch(_){price={available:false,message:'공시지가를 불러오지 못했습니다. 필지 기본정보와 구분해 원문에서 확인해 주세요.'};}
  const result={ok:true,action:'saleParcelFacts',...data,price,complete:data.regulationsComplete&&price.available,cached:false,
    fetchedAt:new Date().toISOString(),source:'토지이음 공개 열람 · 공시지가 연계',sourcePage:sourcePage(pnu)};
  if(result.complete&&env.MEDIA){try{await env.MEDIA.put(key,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});}catch(_) {}}
  return result;
}
export async function getSaleParcelFacts(env,query){
  const pnu=validateParcelPnu(query.pnu);let requests=pending.get(env);if(!requests){requests=new Map();pending.set(env,requests);}
  if(requests.has(pnu))return requests.get(pnu);
  if(requests.size>=8)return {ok:false,code:'busy',message:'다른 필지 자료를 조회 중입니다. 잠시 후 다시 눌러 주세요.'};
  const request=load(env,pnu).catch(e=>({ok:false,code:'source_unavailable',message:e.publicCode?e.message:'토지이음 자료를 불러오지 못했습니다. 공식 원문을 확인해 주세요.'})).finally(()=>requests.delete(pnu));
  requests.set(pnu,request);return request;
}
