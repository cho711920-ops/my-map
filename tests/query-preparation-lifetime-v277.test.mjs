import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {numericCatalogPacketV177} from '../cloudflare/src/query-worker-v151.js';
import {queryCardMediaV159} from '../cloudflare/src/query-card-media-v159.js';

test('v277 canceled availability read retains its own preparation through the verified result write', async()=>{
 const revision='lifetime-v277',proof='sha256-v1:'+'a'.repeat(64);
 const base=numericCatalogPacketV177([{propertyId:'EXACT',key:'EXACT',state:'계약완료',tradeType:'lease',sourceSnapshotKey:proof,queryMatchedOriginalCountV152:1,sheetRow:2}],new Map(),revision,'lease');
 base.numericCatalogV177.availabilityViewV253='completed';
 let entered,release;const atWrite=new Promise(r=>entered=r),writeGate=new Promise(r=>release=r),lifetimes=[],writes=[];
 const env={DB:{},MEDIA:{async get(key){
  if(key.endsWith('/listings.json'))return {body:new Response(JSON.stringify({revision})).body};
  if(key.endsWith('lease-completed.json'))return {body:new Response(JSON.stringify(base)).body};
  return null;
 },async put(key,bytes,options){entered();await writeGate;writes.push({key,bytes,revision:options.customMetadata.revision});}}};
 const abort=new AbortController(),response=worker.fetch(new Request('https://internal.invalid/',{method:'POST',signal:abort.signal,body:JSON.stringify({resolveCurrentV160:true,compressedAvailabilityV253:true,spec:{mode:'lease',hideDone:false,doneOnly:true}})}),env,{waitUntil(promise){lifetimes.push(promise);}});
 await atWrite;abort.abort();
 try{assert.ok(lifetimes.length>0,'preparation must belong to the Worker lifetime before the visitor disconnects');}
 finally{release();await Promise.all(lifetimes);await response;}
 assert.equal(writes.length,1);assert.equal(writes[0].revision,revision);
 const packet=await new Response(new Response(writes[0].bytes).body.pipeThrough(new DecompressionStream('gzip'))).json();
 assert.equal(packet.revision,revision);assert.equal(packet.rows[0][packet.fields.indexOf('propertyId')],'EXACT');
});

test('v277 a stalled media invocation cannot own a later request with the same revision and query', async()=>{
 const revision='media-lifetime-v277',proof='sha256-v1:'+'b'.repeat(64),fields=['propertyId','sourceSnapshotKey','thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'];
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const args={state:{revision},spec:{mode:'lease'},ids:['EXACT'],common:true};
 const packet=photo=>({ok:true,version:152,completeQuery:true,revision,fields,rows:[['EXACT',proof,photo,'OWN-AD',1]],total:1});
 const bucket=()=>({async get(){return null;},async put(){}});
 const first=queryCardMediaV159({...args,env:{MEDIA:bucket()},loadPacket:async()=>{entered();await gate;return packet('first.jpg');}});
 await started;let timer;
 try{
  const second=await Promise.race([queryCardMediaV159({...args,env:{MEDIA:bucket()},loadPacket:async()=>packet('second.jpg')}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('blocked by canceled request')),500);})]);
  assert.equal(second.rows[0][2],'second.jpg');
 }finally{clearTimeout(timer);release();await first;}
});
