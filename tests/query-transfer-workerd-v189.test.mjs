import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {build} from 'esbuild';

const require=createRequire(path.resolve(fs.realpathSync('node_modules/wrangler'),'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');

test('native Workers R2 accepts the compressed multipart representation and returns exact conditional bytes',{timeout:30000},async()=>{
  const compiled=await build({stdin:{contents:`import {preparedQueryTransferV189} from './cloudflare/src/query-transfer-v189.js';
    export default {async fetch(request,env){try{return await preparedQueryTransferV189(env,{mode:new URL(request.url).searchParams.get('mode')},'fixture-only-revision',request,()=>{throw Error('Current fixture needs no build');});}
    catch(error){return Response.json({ok:false,message:error.message},{status:error.statusCode||500});}}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-08-05',r2Buckets:['MEDIA']}));
  try{
    const bucket=await runtime.getR2Bucket('MEDIA');
    for(const mode of ['building_sale','land_sale']){
      const key='api-cache/query-view-'+(mode==='building_sale'?'v184-':'v157-')+mode+'.json';
      const original=JSON.stringify({ok:true,revision:'fixture-only-revision',mode,padding:'Exact fixture data only '.repeat(300000)});
      await bucket.put(key,original,{customMetadata:{revision:'fixture-only-revision'}});
      const url='http://fixture.test/?mode='+mode;
      const response=await runtime.dispatchFetch(url,{headers:{'x-js-snapshot-mode':'manifest-v128'}});
      const manifest=await response.json();assert.equal(response.status,200,JSON.stringify(manifest));assert.equal(manifest.encoding,'gzip');
      const compressed=await bucket.head(key+'.transfer-v189.gz');assert.equal(compressed.customMetadata.sourceEtag,(await bucket.head(key)).etag);
      const parts=[];
      for(let offset=0;offset<manifest.size;offset+=manifest.chunkBytes){
        const length=Math.min(manifest.chunkBytes,manifest.size-offset);
        const chunk=await runtime.dispatchFetch(url,{headers:{'x-js-snapshot-mode':'chunk-v128','x-js-snapshot-etag':manifest.etag,'x-js-snapshot-offset':String(offset),'x-js-snapshot-length':String(length)}});
        assert.equal(chunk.status,200);assert.equal(chunk.headers.get('x-js-snapshot-etag'),manifest.etag);
        const bytes=Buffer.from(await chunk.arrayBuffer());assert.equal(bytes.length,length);parts.push(bytes);
      }
      assert.equal(gunzipSync(Buffer.concat(parts)).toString(),original);
      const again=await runtime.dispatchFetch(url,{headers:{'x-js-snapshot-mode':'manifest-v128'}});assert.equal((await again.json()).etag,manifest.etag);
      assert.equal((await bucket.head(key+'.transfer-v189.gz')).uploaded.getTime(),compressed.uploaded.getTime());
      assert.equal(await (await bucket.get(key)).text(),original);
    }
  }finally{await runtime.dispose();}
});
