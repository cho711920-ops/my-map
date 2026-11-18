import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import {availabilitySwitchV259,availabilityDigestV259} from '../cloudflare/src/query-availability-switch-v259.js';
const window={crypto};vm.runInNewContext(await readFile('js/query-collection-v152.js','utf8'),{window,TextEncoder,console,Map,Set,Date});
const api=window.JSQueryCollectionV152,plain=v=>JSON.parse(JSON.stringify(v));
const fields=['propertyId','sourceSnapshotKey','state','rent','thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157','sheetRow'];
const proof='sha256-v1:'+'a'.repeat(64);
const row=(id,done=false)=>[id,proof,done?'계약완료':'계약가능',done?40:80,'https://image.invalid/'+id+(done?'-done':'-active')+'.jpg',id+(done?'-old':'-new'),2,1];
const packet=rows=>({ok:true,version:152,completeQuery:true,grouping:'client-v152',cardProjectionV157:true,revision:'R',fields,rows,total:rows.length});
function harness(mode,current='all'){
 const shared=Array.from({length:1500},(_,n)=>row('MASTER-'+n)),active=packet([...shared,row('ACTIVE')]),completed=packet([row('MASTER-0',true),row('DONE',true)]),all=packet([...shared,row('ACTIVE'),row('DONE',true)]);
 const packets={active,all,completed},reads=[];let live='R';
 const entries=new Map(Object.entries(packets).map(([view,p])=>[view==='active'?`api-cache/query-view-${mode==='building_sale'?'v184':'v215'}-${mode}.json.navigation-v228.gz`:`api-cache/query-availability-v253-${mode}-${view}.json.result-latest.gz`,gzipSync(JSON.stringify(p))]));
 const env={MEDIA:{async get(key){reads.push(key);return entries.has(key)?{body:new Response(entries.get(key)).body,customMetadata:{revision:'R'}}:null;}}};
 return {packets,reads,entries,setRevision:r=>live=r,args:{env,state:{revision:'R'},spec:{mode,hideDone:current==='active',doneOnly:current==='completed',filters:{}},basis:'R',digest:null,fields,revision:async()=>live}};
}
for(const mode of ['lease','building_sale','land_sale'])for(const view of ['active','all','completed'])test('v259 exact prepared switch packets preserve every row, condition, representative and photo '+mode+' '+view,async()=>{
 const h=harness(mode,view),base=h.packets[view],before=structuredClone(base);h.args.digest=await availabilityDigestV259(base);
 const bundle=await availabilitySwitchV259(h.args),prepared=await api.availabilityPacketsV259(base,bundle);
 assert.equal(prepared.length,2);for(const p of prepared)assert.deepEqual(plain(p.packet),h.packets[p.view]);
 assert.equal(h.reads.length,3);assert.ok(h.reads.every(k=>k.endsWith('.gz')));
 if(view==='all')assert.ok(JSON.stringify(bundle).length<JSON.stringify(h.packets.active).length/3,'same rows travel as IDs, not another complete list');
 assert.deepEqual(base,before,'decoding alternates cannot modify the base');
});
test('v259 missing prepared view never triggers a source build; changed revision or mismatched base is not published',async()=>{
 const h=harness('lease'),base=h.packets.all;h.args.digest=await availabilityDigestV259(base);
 h.entries.delete('api-cache/query-availability-v253-lease-completed.json.result-latest.gz');
 assert.equal((await availabilitySwitchV259(h.args)).variants.length,1);
 h.setRevision('NEXT');assert.deepEqual((await availabilitySwitchV259(h.args)).variants,[]);
 h.setRevision('R');h.args.digest='b'.repeat(64);assert.deepEqual((await availabilitySwitchV259(h.args)).variants,[]);
 h.args.basis='OLD';assert.deepEqual((await availabilitySwitchV259(h.args)).variants,[]);
 h.args.spec.filters={keyword:'다른 조건'};assert.deepEqual((await availabilitySwitchV259(h.args)).variants,[]);
});
test('v259 decoder rejects wrong parent IDs, row hashes, fields, revision, duplicate changes and readonly overrides',async()=>{
 const h=harness('lease'),base=h.packets.all;h.args.digest=await availabilityDigestV259(base);const bundle=await availabilitySwitchV259(h.args);
 const faults=[b=>b.revision='OTHER',b=>b.baseDigest='f'.repeat(64),b=>b.variants[0].fields.reverse(),
  b=>b.variants[0].order.push('FOREIGN'),b=>b.variants[0].digest='f'.repeat(64),b=>b.variants[1].changes.push(b.variants[1].changes[0]),
  b=>b.variants[1].changes[0][1].push([0,'OTHER-ID']),b=>b.variants[1].changes[0][1].push([1,'wrong-proof'])];
 for(const fault of faults){const bad=structuredClone(bundle);fault(bad);await assert.rejects(api.availabilityPacketsV259(base,bad));}
 await assert.rejects(api.availabilityPacketsV259({...base,perPropertyOverridesV152:true},bundle));
 await assert.rejects(api.availabilityPacketsV259({...base,recentQueryBaseV154:true},bundle));
});
