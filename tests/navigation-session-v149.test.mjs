import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {navigationSessionJsonV149,sessionNavigationV149} from '../cloudflare/src/navigation-session-v149.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
const require=createRequire(path.resolve(fs.realpathSync('node_modules/wrangler'),'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const secret='isolated-v149-session-fixture-secret-at-least-32-characters';

test('bootstrap data is escaped, minimal, and limited to cookie-bearing main HTML navigations',()=>{
  const raw=navigationSessionJsonV149({email:'X</script><script>bad&@test.invalid',password:'SECRET',token:'SECRET'},10);
  assert.doesNotMatch(raw,/<|>|&|SECRET/);
  const data=JSON.parse(raw);assert.equal(data.email,'x</script><script>bad&@test.invalid');
  assert.deepEqual(Object.keys(data),['version','email','checkedAt']);
  const request=(path,method='GET')=>new Request('https://fixture.invalid'+path,{method,headers:{cookie:SESSION_COOKIE+'=fixture'}});
  assert.equal(sessionNavigationV149(request('/')),true);
  assert.equal(sessionNavigationV149(request('/index.html')),true);
  for(const p of ['/api/session','/js/auth-gate-v1.js','/another-page'])assert.equal(sessionNavigationV149(request(p)),false);
  assert.equal(sessionNavigationV149(request('/','POST')),false);
  assert.equal(sessionNavigationV149(new Request('https://fixture.invalid/')),false);
});

test('native Workers runtime verifies the actual session before private HTML bootstrap; APIs remain protected',{timeout:30000},async()=>{
  const compiled=await build({stdin:{resolveDir:process.cwd(),contents:`
    import worker from './cloudflare/src/worker.js';
    export default {fetch(request,bindings,context){
      const url=new URL(request.url);
      const env={...bindings,ASSETS:{fetch:async()=>new Response('<!doctype html><html><head><title>Fixture</title></head><body>PUBLIC SHELL</body></html>',
        {headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self'"}})}};
      if(url.searchParams.has('denied'))env.ALLOWED_EMAILS='other@example.invalid';
      if(url.searchParams.has('slow'))env.DB={prepare(){return{bind(){return{first:async()=>{await new Promise(resolve=>setTimeout(resolve,1000));return{email:bindings.ALLOWED_EMAILS,active:1,role:'owner'};}};}};}};
      return worker.fetch(request,env,context);
    }};`},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-08-05',
    bindings:{SESSION_SECRET:secret,ALLOWED_EMAILS:'owner@example.invalid'}}));
  const token=await createSessionToken({email:'owner@example.invalid',sub:'fixture'}, {SESSION_SECRET:secret});
  const expired=await createSessionToken({email:'owner@example.invalid',sub:'fixture'}, {SESSION_SECRET:secret},Date.now()-100*86400000);
  try {
    const valid=await runtime.dispatchFetch('http://fixture.invalid/',{headers:{cookie:SESSION_COOKIE+'='+token}});
    const html=await valid.text();
    assert.match(html,/id="jsNavigationSessionV149"/);
    const data=JSON.parse(html.match(/id="jsNavigationSessionV149">([^<]+)<\/script>/)[1]);
    assert.equal(data.email,'owner@example.invalid');assert.equal(data.version,149);
    assert.match(valid.headers.get('cache-control'),/no-store/);assert.match(valid.headers.get('vary'),/Cookie/);
    assert.equal(valid.headers.get('x-js-session-bootstrap'),'verified-navigation-v149');
    assert.match(valid.headers.get('content-security-policy'),/script-src 'self'/);
    for(const [suffix,cookie] of [['',''],['','bad'],['',expired],['?denied=1',token]]) {
      const response=await runtime.dispatchFetch('http://fixture.invalid/'+suffix,{headers:cookie?{cookie:SESSION_COOKIE+'='+cookie}:{}});
      assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/jsNavigationSessionV149|owner@example.invalid/);
    }
    const denied=await runtime.dispatchFetch('http://fixture.invalid/api/session');assert.equal(denied.status,401);
    const unauthorized=await runtime.dispatchFetch('http://fixture.invalid/api/sheet');assert.equal(unauthorized.status,401);
    const slow=await runtime.dispatchFetch('http://fixture.invalid/?slow=1',{headers:{cookie:SESSION_COOKIE+'='+token}});
    assert.equal(slow.status,200);assert.doesNotMatch(await slow.text(),/jsNavigationSessionV149|owner@example.invalid/);
  }finally{await runtime.dispose();}
});
