import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(path.resolve(fs.realpathSync('node_modules/wrangler'),'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
test('Workers runtime boundary fetch validates exact WGS84 geometry and never forwards provider errors',{timeout:30000},async()=>{
  const pnu='3020010700100040004';let requests=0;
  const bundle=await build({stdin:{contents:`import {getSaleParcelBoundary} from './cloudflare/src/sale-parcel-boundary.js';export default{fetch(request,env){return getSaleParcelBoundary(env,{pnu:new URL(request.url).searchParams.get('pnu')}).then(Response.json);}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-05',bindings:{VWORLD_API_KEY:'workerd-test-only-key'},outboundService:async request=>{
    requests++;const u=new URL(request.url);assert.equal(u.origin+u.pathname,'https://api.vworld.kr/req/data');assert.equal(u.searchParams.get('key'),'workerd-test-only-key');assert.equal(u.searchParams.get('crs'),'EPSG:4326');
    if(requests>1)return Response.json({response:{status:'ERROR',error:{text:'private workerd-test-only-key'}}});
    return Response.json({response:{status:'OK',record:{total:'1',current:'1'},result:{featureCollection:{crs:{properties:{name:'urn:ogc:def:crs:EPSG::4326'}},features:[{properties:{pnu},geometry:{type:'Polygon',coordinates:[[[127.34,36.36],[127.341,36.36],[127.341,36.361],[127.34,36.36]]]}}]}}}});
  }}));
  try{
    const good=await(await runtime.dispatchFetch('http://fixture.test/?pnu='+pnu)).json();assert.equal(good.ok,true);assert.equal(good.geometry.type,'MultiPolygon');
    const bad=await(await runtime.dispatchFetch('http://fixture.test/?pnu=3020010700100050005')).json();assert.equal(bad.ok,false);assert.doesNotMatch(JSON.stringify(bad),/private|workerd-test-only-key/);assert.equal(requests,2);
  }finally{await runtime.dispose();}
});
