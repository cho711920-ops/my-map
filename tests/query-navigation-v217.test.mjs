import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationPacketV217,preparedNavigationV217} from '../cloudflare/src/query-navigation-v217.js';
import {readQueryOriginalsV151} from '../cloudflare/src/query-stream-v151.js';
const packet=()=>({ok:true,version:152,completeQuery:true,grouping:'client-v152',revision:'r1',fields:['propertyId','sourceSnapshotKey','thumbnailV8'],total:2,
  rows:[['A','sha256-v1:'+'a'.repeat(64),'https://image.invalid/a.jpg'],['B','sha256-v1:'+'b'.repeat(64),'https://image.invalid/b.jpg']],
  numericCatalogV177:{version:177,revision:'r1',complete:true,groups:[['A',Array.from({length:50},()=>[[2,'alternate']])]]}});
test('navigation removes only the heavy catalog and retains every row, order, own proof and actual thumbnail',()=>{
  const original=packet(),nav=navigationPacketV217(original,'r1');
  assert.deepEqual(nav.rows,original.rows);assert.deepEqual(nav.fields,original.fields);assert.equal(nav.total,2);assert.equal(nav.completeQuery,true);
  assert.equal(nav.numericCatalogDeferredV217,true);assert.equal(nav.numericCatalogV177,undefined);assert.ok(original.numericCatalogV177);
  for(const bad of [{...original,total:1},{...original,completeQuery:false},{...original,revision:'old'}])assert.throws(()=>navigationPacketV217(bad,'r1'));
});
test('a derived navigation hit streams only the exact current source etag; replacing its source rebuilds it without master writes',async()=>{
  const key='api-cache/query-view-v215-lease.json',values=new Map();let etag='first',reads=0,puts=0;
  const env={MEDIA:{async head(){return {etag,customMetadata:{revision:'r1'}};},async get(name){reads++;const value=values.get(name)||{body:JSON.stringify(packet()),revision:'r1',sourceEtag:etag};
    return {etag,customMetadata:{revision:value.revision,sourceEtag:value.sourceEtag},body:new Response(value.body).body};},
    async put(name,body,options){puts++;values.set(name,{body,...options.customMetadata});}}};
  const invoke=()=>preparedNavigationV217({env,key,revision:'r1',headers:{'content-type':'application/json'},loadFull:()=>{throw Error('No full source rebuild');}});
  values.set(key+'.navigation-v217.json',{body:'old',revision:'old',sourceEtag:'old'});
  assert.equal((await(await invoke()).json()).numericCatalogV177,undefined);assert.equal(puts,1);const before=reads;
  assert.equal((await(await invoke()).json()).total,2);assert.equal(reads,before+1);assert.equal(puts,1);
  etag='changed';assert.equal((await(await invoke()).json()).total,2);assert.equal(puts,2);
});
test('a large excluded catalog is scanned across byte boundaries without a large-entry buffer or expanded per-ad objects',async()=>{
  const source=packet();source.numericCatalogV177={note:'한글 \\" } , : [ '.repeat(20000),groups:Array.from({length:1000},()=>['A',[[[2,'quoted "value"']]]])};
  const bytes=new TextEncoder().encode(JSON.stringify(source)),stream=new ReadableStream({start(controller){for(let at=0;at<bytes.length;at+=127)controller.enqueue(bytes.subarray(at,at+127));controller.close();}});
  const value=await readQueryOriginalsV151(stream,{skipRootKeys:['numericCatalogV177'],maxEntryBytes:1024,validateRoot:root=>root.ok===true&&root.total===2});
  assert.deepEqual(value.rows,source.rows);assert.equal(value.numericCatalogV177,undefined);
  for(const text of ['{"ok":true,"numericCatalogV177":{},"numericCatalogV177":{},"rows":[]}', '{"ok":true,"numericCatalogV177":{"x":[1,2}', '{"ok":true,"numericCatalogV177":{}} extra'])
    await assert.rejects(readQueryOriginalsV151(new Response(text).body,{skipRootKeys:['numericCatalogV177'],validateRoot:()=>true}));
});

test('complete navigation rows stream individually across UTF-8 chunks without retaining a growing whole-array string',async()=>{
  const rows=Array.from({length:2000},(_,i)=>['ID-'+i,'한글 · \\" [ ] , : '.repeat(15),{proof:'p'+i}]);
  const raw=JSON.stringify({ok:true,total:rows.length,rows,numericCatalogV177:{large:'x'.repeat(200000)}}),bytes=new TextEncoder().encode(raw);
  let offset=0;const stream=new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(bytes.length,offset+127);controller.enqueue(bytes.subarray(offset,end));offset=end;}});
  const parsed=await readQueryOriginalsV151(stream,{skipRootKeys:['numericCatalogV177'],rootArrayKeys:['rows'],maxEntryBytes:1024,validateRoot:root=>root.ok&&root.rows.length===root.total});
  assert.deepEqual(parsed.rows,rows);assert.equal(parsed.numericCatalogV177,undefined);
  for(const value of ['{"ok":true,"rows":[[1],]}','{"ok":true,"rows":[],"rows":[]}','{"ok":true,"rows":[[1]'])
    await assert.rejects(readQueryOriginalsV151(new Response(value).body,{rootArrayKeys:['rows'],validateRoot:()=>true}));
});
