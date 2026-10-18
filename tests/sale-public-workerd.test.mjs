import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
// Use the same workerd/Miniflare version as Wrangler, including its fetch
// redirect and decoder contracts. Node's native fetch alone missed that bug.
const require=createRequire(path.resolve(fs.realpathSync('node_modules/wrangler'),'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
test('native Workers runtime can fetch parcel references and distinguish denied trade credentials',{timeout:30000},async()=>{
  const pnu='3011011700100560001',calls=[];let denied=false;
  const bundled=await build({stdin:{contents:`import {getSaleParcelFacts} from './cloudflare/src/sale-parcel-facts.js';import {getSaleTransactions} from './cloudflare/src/sale-transactions.js';export default{fetch(request,env){const u=new URL(request.url);return (u.pathname==='/land'?getSaleParcelFacts(env,{pnu:'${pnu}'}):getSaleTransactions(env,{kind:u.searchParams.get('kind')||'land',district:'30170',month:'202609'})).then(data=>Response.json(data));}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-08-05',bindings:{DATA_GO_KR_SERVICE_KEY:'test-only-key'},
    outboundService:async request=>{
      const u=new URL(request.url);calls.push(u.hostname);
      if(u.hostname==='www.eum.go.kr')return new Response('<input id="pnu" value="'+pnu+'"><table><tr><th>소재지</th><td>대전광역시 동구 홍도동 56-1</td></tr><tr><td><input id="present_class_val" value="대"></td><td id="present_area">1243 ㎡</td></tr><td id="present_mark1"><a>제3종일반주거지역</a></td><td id="present_mark2"></td><td id="present_mark3"></td></table>',{headers:{'content-type':'text/html; charset=utf-8'}});
      if(u.hostname==='api.eum.go.kr')return new Response('<?xml version="1.0" encoding="UTF-8"?><RESPONSE><HEADER><CODE>0000</CODE></HEADER><BODY><BASE_YEAR>2026</BASE_YEAR><STDMT>01</STDMT><JIGA>986600</JIGA></BODY></RESPONSE>',{headers:{'content-type':'text/xml; charset=euc-kr'}});
      if(u.hostname==='apis.data.go.kr')return denied?new Response('<returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>',{status:403}):new Response('<response><resultCode>000</resultCode><items><item><sggCd>30170</sggCd><umdNm>괴정동</umdNm><dealYear>2026</dealYear><dealMonth>09</dealMonth><dealDay>12</dealDay><dealAmount>50000</dealAmount><dealArea>330</dealArea></item></items><totalCount>1</totalCount><pageNo>1</pageNo></response>');
      throw Error('Unexpected outbound hostname');
    }}));
  try{
    const land=await(await runtime.dispatchFetch('http://fixture.test/land')).json();assert.equal(land.ok,true);assert.equal(land.complete,true);assert.equal(land.price.wonPerM2,986600);assert.equal(land.regulations[0].items[0].label,'제3종일반주거지역');
    const trades=await(await runtime.dispatchFetch('http://fixture.test/trade')).json();assert.equal(trades.ok,true);assert.equal(trades.records.length,1);assert.equal(trades.records[0].amount,50000);
    denied=true;const rejected=await(await runtime.dispatchFetch('http://fixture.test/trade?kind=commercial')).json();assert.equal(rejected.ok,false);assert.equal(rejected.code,'approval_required');assert.doesNotMatch(JSON.stringify(rejected),/test-only-key/);
    assert.deepEqual(calls,['www.eum.go.kr','api.eum.go.kr','apis.data.go.kr','apis.data.go.kr']);
  }finally{await runtime.dispose();}
});
