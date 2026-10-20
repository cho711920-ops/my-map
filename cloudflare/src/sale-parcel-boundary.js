// Exact-PNU reference geometry only. Never infer a boundary from a map pin,
// advertisement area or a nearby parcel. Credentials stay in the Worker.
import {validateParcelPnu} from './sale-parcel-facts.js';

const states = new WeakMap();
const MAX_BYTES = 512 * 1024;
const SOURCE = '국토교통부 · 브이월드 연속지적도';
const text = v => String(v ?? '').trim();
function fail(code, message) {return Object.assign(new Error(message), {publicCode:code});}
function keyOf(env) {return text(env.VWORLD_API_KEY);}
export function boundaryCapability(env) {
  return {ok:true, action:'saleParcelBoundaryConfig', available:!!keyOf(env)&&text(env.VWORLD_BOUNDARY_ENABLED)==='1'};
}
export function normalizeParcelGeometry(geometry) {
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) throw fail('invalid_geometry','필지 경계의 도형 형식을 검증하지 못했습니다.');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > 32) throw fail('invalid_geometry','필지 경계의 도형 수를 검증하지 못했습니다.');
  let vertices = 0, rings = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const normalized = polygons.map(polygon => {
    if (!Array.isArray(polygon) || !polygon.length || (rings += polygon.length) > 64) throw fail('invalid_geometry','필지 경계의 고리 형식을 검증하지 못했습니다.');
    return polygon.map(ring => {
      if (!Array.isArray(ring) || ring.length < 4 || (vertices += ring.length) > 10000) throw fail('invalid_geometry','필지 경계의 좌표 수를 검증하지 못했습니다.');
      const points = ring.map(point => {
        if (!Array.isArray(point) || point.length < 2 || !point.slice(0,2).every(v => typeof v === 'number' && Number.isFinite(v))) throw fail('invalid_geometry','필지 경계의 좌표를 검증하지 못했습니다.');
        const [lng,lat] = point;
        if (lng < 123 || lng > 133 || lat < 32 || lat > 40) throw fail('invalid_geometry','필지 경계의 좌표계를 확인하지 못했습니다.');
        bounds[0]=Math.min(bounds[0],lng);bounds[1]=Math.min(bounds[1],lat);bounds[2]=Math.max(bounds[2],lng);bounds[3]=Math.max(bounds[3],lat);
        return [lng,lat];
      });
      const last=points.at(-1);
      if (points[0][0]!==last[0] || points[0][1]!==last[1]) throw fail('invalid_geometry','닫히지 않은 필지 경계는 표시하지 않습니다.');
      // Shift the origin to avoid catastrophic cancellation for small lots.
      const [x,y]=points[0];
      const twiceArea=points.slice(1).reduce((sum,p,i)=>sum+(points[i][0]-x)*(p[1]-y)-(p[0]-x)*(points[i][1]-y),0);
      if (Math.abs(twiceArea)<1e-14) throw fail('invalid_geometry','면이 없는 경계 좌표는 표시하지 않습니다.');
      return points;
    });
  });
  if (bounds[2]-bounds[0]>1 || bounds[3]-bounds[1]>1) throw fail('invalid_geometry','필지 경계의 범위가 지나치게 넓습니다. 공식 지도를 확인해 주세요.');
  return {geometry:{type:'MultiPolygon',coordinates:normalized},bounds};
}
export function parseParcelBoundary(payload,pnu) {
  validateParcelPnu(pnu);
  const response=payload?.response;
  if (response?.status==='NOT_FOUND') throw fail('not_found','이 필지의 경계 자료가 제공되지 않았습니다. 토지이음 원문에서 확인해 주세요.');
  if (response?.status!=='OK') throw fail('source_unavailable','필지 경계 제공 서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.');
  const features=response.result?.featureCollection?.features;
  if (!Array.isArray(features) || features.length!==1 || text(features[0]?.properties?.pnu)!==pnu) throw fail('parcel_mismatch','요청한 필지와 경계 자료가 일치하지 않아 표시하지 않았습니다.');
  const count=response.record;
  if (count && (Number(count.total)!==1 || Number(count.current)!==1)) throw fail('parcel_mismatch','필지 경계가 하나로 확인되지 않아 표시하지 않았습니다.');
  const collection=response.result.featureCollection;
  const crs=collection.crs?.properties?.name;
  if (crs && !/^(?:EPSG:4326|urn:ogc:def:crs:EPSG::4326|urn:ogc:def:crs:OGC:1\.3:CRS84)$/i.test(crs)) throw fail('invalid_geometry','필지 경계의 좌표계를 검증하지 못했습니다.');
  return {...normalizeParcelGeometry(features[0].geometry),pnu};
}
async function boundedJson(response) {
  if (Number(response.headers.get('content-length'))>MAX_BYTES || !response.body) throw Error('response size');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error('response size');chunks.push(value);}}
  catch(e){reader.cancel().catch(()=>{});throw e;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function fetchBoundary(env,pnu) {
  const url=new URL('https://api.vworld.kr/req/data');
  const params={service:'data',version:'2.0',request:'GetFeature',data:'LP_PA_CBND_BUBUN',key:keyOf(env),domain:'https://js-map.com',
    format:'json',crs:'EPSG:4326',size:'2',page:'1',geometry:'true',attribute:'true',attrFilter:'pnu:=:'+pnu};
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  // Redirects must not forward the key to another origin. No raw provider error
  // is ever included in a browser response or logged by this module.
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('source status');
  return {ok:true,action:'saleParcelBoundary',...parseParcelBoundary(await boundedJson(response),pnu),source:SOURCE,fetchedAt:new Date().toISOString(),cached:false};
}
export async function getSaleParcelBoundary(env,query) {
  const pnu=validateParcelPnu(query.pnu);
  if(!keyOf(env))return {ok:false,code:'not_configured',message:'현재 필지 경계 자료를 제공할 수 없습니다. 토지이음에서 확인해 주세요.'};
  if(text(env.VWORLD_BOUNDARY_ENABLED)!=='1')return {ok:false,code:'not_enabled',message:'필지 경계 연결을 확인 중입니다. 토지이음에서 확인해 주세요.'};
  // Keep only an in-flight request. No durable or reusable geometry cache:
  // the VWorld agreement requires permission for data storage.
  let state=states.get(env);if(!state){state={pending:new Map()};states.set(env,state);}
  const key=keyOf(env);
  const pending=state.pending.get(pnu);
  if(pending && pending.key===key)return pending.promise;
  if(state.pending.size>=4)return {ok:false,code:'busy',message:'다른 필지 경계를 조회 중입니다. 잠시 후 다시 눌러 주세요.'};
  const token={key};
  token.promise=fetchBoundary(env,pnu).catch(error=>({ok:false,code:error.publicCode||'source_unavailable',message:error.publicCode?error.message:'필지 경계를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.'}))
    .finally(()=>{if(state.pending.get(pnu)===token)state.pending.delete(pnu);});
  state.pending.set(pnu,token);return token.promise;
}
