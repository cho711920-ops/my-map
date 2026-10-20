import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {boundaryCapability,getSaleParcelBoundary,normalizeParcelGeometry,parseParcelBoundary} from '../cloudflare/src/sale-parcel-boundary.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
const pnu='3020010700100040004';
const ring=[[127.34,36.36],[127.341,36.36],[127.341,36.361],[127.34,36.361],[127.34,36.36]];
function payload(p=pnu,geometry={type:'Polygon',coordinates:[ring]}){return {response:{status:'OK',record:{total:'1',current:'1'},result:{featureCollection:{type:'FeatureCollection',features:[{type:'Feature',properties:{pnu:p,ownerName:'must-not-return',jibun:'4-4'},geometry}]}}}};}

test('only a dedicated boundary key enables capability; a data.go.kr key is not reused',async()=>{
  assert.equal(boundaryCapability({DATA_GO_KR_SERVICE_KEY:'different-service'}).available,false);
  assert.equal(boundaryCapability({VWORLD_API_KEY:'dedicated-test-key'}).available,false);
  assert.equal(boundaryCapability({VWORLD_API_KEY:'dedicated-test-key',VWORLD_BOUNDARY_ENABLED:'1'}).available,true);
  const old=fetch;global.fetch=()=>{throw Error('must not query');};
  try{const r=await getSaleParcelBoundary({},{pnu});assert.equal(r.code,'not_configured');assert.equal((await getSaleParcelBoundary({VWORLD_API_KEY:'test'},{pnu})).code,'not_enabled');assert.throws(()=>parseParcelBoundary(payload(),'3020010700100000000'));}finally{global.fetch=old;}
});
test('exact PNU only; a partial match, duplicate feature and truncated result are never drawn',()=>{
  const data=parseParcelBoundary(payload(),pnu);assert.equal(data.pnu,pnu);assert.equal(data.geometry.type,'MultiPolygon');assert.deepEqual(data.geometry.coordinates,[[ring]]);
  assert.equal(data.ownerName,undefined);assert.throws(()=>parseParcelBoundary(payload('3020010700100050005'),pnu));
  const duplicate=payload();duplicate.response.result.featureCollection.features.push(duplicate.response.result.featureCollection.features[0]);assert.throws(()=>parseParcelBoundary(duplicate,pnu));
  const truncated=payload();truncated.response.record.total='2';assert.throws(()=>parseParcelBoundary(truncated,pnu));
  assert.throws(()=>parseParcelBoundary({response:{status:'NOT_FOUND'}},pnu),{publicCode:'not_found'});
});
test('holes and multiple components stay intact; wrong CRS, reversed axes and invalid rings fail closed',()=>{
  const hole=ring.map(([x,y])=>[127.3402+(x-127.34)/4,36.3602+(y-36.36)/4]);
  const g={type:'MultiPolygon',coordinates:[[ring,hole],[ring.map(([x,y])=>[x+.002,y])]]};
  assert.deepEqual(normalizeParcelGeometry(g).geometry,g);
  for(const geometry of [{type:'Point',coordinates:ring[0]},{type:'Polygon',coordinates:[ring.slice(0,-1)]},{type:'Polygon',coordinates:[ring.map(([x,y])=>[y,x])]},{type:'Polygon',coordinates:[ring.map(()=>ring[0])]}, {type:'Polygon',coordinates:[[...ring.slice(0,-1),[127.342,36.36]]]}])assert.throws(()=>normalizeParcelGeometry(geometry));
  const projected=payload();projected.response.result.featureCollection.crs={properties:{name:'EPSG:3857'}};assert.throws(()=>parseParcelBoundary(projected,pnu));
  assert.throws(()=>normalizeParcelGeometry({type:'Polygon',coordinates:[Array.from({length:10001},(_,i)=>ring[i%ring.length])]}));
});
test('small lots retain their true coordinates and nonzero geometry',()=>{
  const tiny=ring.map(([x,y])=>[127.34+(x-127.34)/1000,36.36+(y-36.36)/1000]);
  assert.deepEqual(normalizeParcelGeometry({type:'Polygon',coordinates:[tiny]}).geometry.coordinates,[[tiny]]);
});
test('provider requests are exact, bounded and deduplicated only in flight without storing boundaries',async()=>{
  const old=fetch,urls=[];let release;
  global.fetch=async(url,init)=>{urls.push(new URL(url));assert.equal(init.redirect,'manual');assert.ok(init.signal);await new Promise(r=>release=r);return Response.json(payload());};
  const env={VWORLD_API_KEY:'private-test-only-key',VWORLD_BOUNDARY_ENABLED:'1',DB:{prepare(){throw Error('no DB');}},MEDIA:{get(){throw Error('no storage');},put(){throw Error('no storage');}}};
  try{
    const a=getSaleParcelBoundary(env,{pnu}),b=getSaleParcelBoundary(env,{pnu});assert.equal(urls.length,1);release();const [first,second]=await Promise.all([a,b]);assert.deepEqual(first,second);assert.equal(first.ok,true);
    const u=urls[0];assert.equal(u.origin+u.pathname,'https://api.vworld.kr/req/data');assert.equal(u.searchParams.get('attrFilter'),'pnu:=:'+pnu);assert.equal(u.searchParams.get('data'),'LP_PA_CBND_BUBUN');assert.equal(u.searchParams.get('crs'),'EPSG:4326');assert.equal(u.searchParams.get('size'),'2');
    assert.doesNotMatch(JSON.stringify(first),/private-test-only-key|ownerName|must-not-return/);
    global.fetch=async url=>{urls.push(new URL(url));return Response.json(payload());};
    assert.equal((await getSaleParcelBoundary(env,{pnu})).cached,false);assert.equal(urls.length,2);
  }finally{global.fetch=old;}
});
test('source failures and oversized bodies reveal no key and never become cached successes',async()=>{
  const old=fetch;
  try{for(const response of [new Response('key-secret',{status:302,headers:{location:'https://other.test'}}),new Response('key-secret',{status:403}),new Response('x'.repeat(512*1024+1)),Response.json({response:{status:'ERROR',error:{text:'key-secret'}}}),new Response('not JSON')]){
    let n=0;global.fetch=async()=>{n++;return response.clone();};const env={VWORLD_API_KEY:'key-secret',VWORLD_BOUNDARY_ENABLED:'1'};
    for(let i=0;i<2;i++){const result=await getSaleParcelBoundary(env,{pnu});assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/key-secret|other\.test/);}assert.equal(n,2);
  }}finally{global.fetch=old;}
});
test('simultaneous distinct lookups are limited to four and later lookups use the current credential',async()=>{
  const old=fetch,releases=[];let calls=0;
  global.fetch=async url=>{calls++;await new Promise(r=>releases.push(r));return Response.json(payload(new URL(url).searchParams.get('attrFilter').slice(6)));};
  const env={VWORLD_API_KEY:'key-a',VWORLD_BOUNDARY_ENABLED:'1'};
  try{
    const requests=Array.from({length:4},(_,i)=>getSaleParcelBoundary(env,{pnu:pnu.slice(0,-1)+(i+1)}));assert.equal((await getSaleParcelBoundary(env,{pnu:pnu.slice(0,-1)+'9'})).code,'busy');
    releases.splice(0).forEach(r=>r());await Promise.all(requests);env.VWORLD_API_KEY='key-b';const next=getSaleParcelBoundary(env,{pnu});releases.splice(0).forEach(r=>r());await next;assert.equal(calls,5);
  }finally{global.fetch=old;}
});
test('authenticated Worker actions reject another account and keep geometry/config private',async()=>{
  const env={SESSION_SECRET:'test-boundary-long-secret-32-characters',ALLOWED_EMAILS:'owner@example.com'};
  for(const action of ['saleParcelBoundaryConfig','saleParcelBoundary']){
    const url='https://js-map.com/api/data?action='+action+'&pnu='+pnu;
    assert.equal((await worker.fetch(new Request(url),env)).status,401);
    const token=await createSessionToken({sub:'owner',email:'owner@example.com'},env),headers={cookie:SESSION_COOKIE+'='+encodeURIComponent(token)};
    assert.equal((await worker.fetch(new Request(url+'&expectedAccountEmail=other@example.com',{headers}),env)).status,409);
    const response=await worker.fetch(new Request(url+'&expectedAccountEmail=owner@example.com',{headers}),env);assert.equal(response.headers.get('cache-control'),'private, no-store');const data=await response.json();assert.equal(action==='saleParcelBoundaryConfig'?data.available:data.code,action==='saleParcelBoundaryConfig'?false:'not_configured');
  }
});
test('label anchor avoids a concave cutout and an interior hole',()=>{
  const sandbox={window:{addEventListener(){}}};vm.runInNewContext(fs.readFileSync(new URL('../js/sale-parcel-boundary-v23.js',import.meta.url),'utf8'),sandbox);
  const choose=sandbox.window.JSSaleParcelBoundaryV23.labelPoint;
  const concave=[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4],[0,0]],a=choose([concave]);assert.ok(a[0]<1||a[1]<1);
  const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]],b=choose([outer,hole]);assert.ok(b[0]<1||b[0]>3||b[1]<1||b[1]>3);
});
