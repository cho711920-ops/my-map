import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,sep} from 'node:path';
import {RELEASE_ASSETS_V150,releaseUrlsV150,verifyWebReleaseV150} from '../tools/verify-web-release.mjs';
import {assetManifestV150,rebindMetadataV150} from '../tools/rebind-web-assets-v150.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'js-web-release-v150-'));
  t.after(async()=>{assert.ok(directory.startsWith(resolve(tmpdir())+sep+'js-web-release-v150-'));await rm(directory,{recursive:true,force:true});});
  const bodies=new Map(),urls=[];
  for (const path of RELEASE_ASSETS_V150) {
    const body='isolated release fixture '+path,hash=createHash('sha256').update(body).digest('hex').slice(0,16);
    await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),body);
    bodies.set('/'+path+'?build='+hash,body);urls.push('/'+path+'?build='+hash);
  }
  const html=urls.map(url=>'<script src="'+url+'"></script>').join('');
  await writeFile(join(directory,'index.html'),html);
  return {directory,html,bodies,fetchImpl:async input=>{
    const url=new URL(input);return url.pathname==='/'?new Response(html,{headers:{'content-type':'text/html'}})
      :new Response(bodies.get(url.pathname+url.search),{status:bodies.has(url.pathname+url.search)?200:404});
  }};
}

test('public release verification checks both HTML references and 22 delivered responses',async t=>{
  const state=await fixture(t),seen=[];
  const result=await verifyWebReleaseV150({...state,fetchImpl:async(url,options)=>{seen.push(url);assert.equal(options.headers['cache-control'],'no-cache');return state.fetchImpl(url);}});
  assert.equal(result.ok,true);assert.equal(result.responses,(RELEASE_ASSETS_V150.length+1)*2);
  assert.ok(seen.every(url=>!url.includes('/api/')));assert.equal(new Set(seen.map(url=>new URL(url).hostname)).size,2);
});

test('a successful deploy and HTTP 200 cannot hide old HTML, old asset bytes or incomplete references',async t=>{
  const state=await fixture(t),origins=['https://js-map.com'];
  await assert.rejects(verifyWebReleaseV150({...state,origins,fetchImpl:async()=>new Response(state.html.replace(/build=[a-f0-9]+/,'build=0000000000000000'))}),/different assets/);
  await assert.rejects(verifyWebReleaseV150({...state,origins,fetchImpl:async url=>new URL(url).pathname==='/'?state.fetchImpl(url):new Response('old source')}),/bytes differ/);
  await assert.rejects(verifyWebReleaseV150({...state,origins,fetchImpl:async()=>new Response(state.html.replace(/<script[^>]+><\/script>/,''))}),/different assets/);
  await assert.rejects(verifyWebReleaseV150({...state,origins,fetchImpl:async()=>new Response('unavailable',{status:503})}),/HTTP 503/);
  assert.throws(()=>releaseUrlsV150('<script src="/js/script.js"></script>'),/Fingerprint missing/);
});

test('asset rebind retains secrets and every binding by inheritance and refuses another database or bucket',()=>{
  const settings={compatibility_date:'2026-08-05',compatibility_flags:[],limits:{cpu_ms:60000},observability:{enabled:true},
    placement:{mode:'off'},tail_consumers:[],bindings:[{name:'DB',type:'d1',id:'e5b41e5f-8929-4c10-948e-178a17ee5f18'},
      {name:'MEDIA',type:'r2_bucket',bucket_name:'js-map-media'},{name:'ASSETS',type:'assets'},
      {name:'SESSION_SECRET',type:'secret_text',text:'NEVER_PRINT_OR_REPLACE'},{name:'EXISTING_VAR',type:'plain_text',text:'keep'}]};
  const metadata=rebindMetadataV150(settings,'fixture-upload-token','fixture CSP headers');
  assert.equal(metadata.assets.jwt,'fixture-upload-token');assert.equal(metadata.assets.config._headers,'fixture CSP headers');
  assert.deepEqual(metadata.bindings,settings.bindings.map(b=>({name:b.name,type:b.type==='assets'?'assets':'inherit'})));
  assert.doesNotMatch(JSON.stringify(metadata),/NEVER_PRINT_OR_REPLACE/);
  assert.deepEqual(metadata.limits,settings.limits);assert.deepEqual(metadata.placement,settings.placement);
  assert.throws(()=>rebindMetadataV150({...settings,bindings:settings.bindings.map(b=>b.name==='DB'?{...b,id:'another'}:b)},'token',''),/Unexpected release target/);
  assert.throws(()=>rebindMetadataV150({...settings,bindings:settings.bindings.map(b=>b.name==='MEDIA'?{...b,bucket_name:'another'}:b)},'token',''),/Unexpected release target/);
  assert.throws(()=>rebindMetadataV150(settings,'',''),/Unexpected release target/);
});

test('asset manifest follows the Wrangler hash input and excludes control files and hidden files',async t=>{
  const state=await fixture(t),inputs=[];
  for (const name of ['_headers','_redirects','.assetsignore','.private']) await writeFile(join(state.directory,name),'not a public asset');
  const manifest=await assetManifestV150(state.directory,value=>{inputs.push(value);return 'test-hash';});
  assert.equal(Object.keys(manifest).length,RELEASE_ASSETS_V150.length+1);
  assert.ok(!Object.keys(manifest).some(path=>path.startsWith('/_')||path.startsWith('/.')));
  assert.ok(inputs.includes(Buffer.from('isolated release fixture js/map.js').toString('base64')+'js'));
});
