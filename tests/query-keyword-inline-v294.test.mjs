import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {inlineKeywordRepairsV294,keywordBasisDigestV294} from '../cloudflare/src/query-keyword-inline-v294.js';
const proof=n=>'sha256-v1:'+String(n).padStart(64,'0');
function fixture(mode){
 const packet={ok:true,version:152,completeQuery:true,revision:'INLINE-294',fields:['propertyId','sourceSnapshotKey','queryMatchedOriginalCountV152','querySelectedOriginalIdV152','thumbnailV8'],rows:[['P',proof(1),1,'P-ad','old.jpg'],['Q',proof(2),1,'Q-ad','other.jpg']],total:2};
 let etag='one',reads=0;
 const MEDIA={async head(key){assert.ok(key.endsWith(`-${mode}.json.navigation-v228.gz`));return {etag,customMetadata:{revision:packet.revision}};},async get(key,options){reads++;assert.equal(options.onlyIf.etagMatches,etag);return {body:new Response(gzipSync(JSON.stringify(packet))).body};}};
 return {packet,env:{MEDIA},reads:()=>reads,change(){etag='two';packet.rows[0][1]=proof(3);}};
}
for(const mode of ['lease','building_sale','land_sale'])test('v294 exact navigation digest repairs only changed memo masters inside the first response '+mode,async()=>{
 const f=fixture(mode),digest=await keywordBasisDigestV294(f.packet),calls=[],current={propertyId:'P',sourceSnapshotKey:proof(3),rent:90,thumbnailV8:'https://photos.invalid/current-inline.jpg'};
 const input={env:f.env,revision:f.packet.revision,mode,digest,rows:[['P',proof(3),1],['Q',proof(2),1],['OTHER-MARKET',proof(9),1]],readCurrent:async ids=>{calls.push(ids);return [current];}};
 const actual=await inlineKeywordRepairsV294(input);assert.deepEqual(actual,{digest,ids:['P'],rows:[current]});assert.deepEqual(calls,[['P']]);assert.equal(f.reads(),1);
 await inlineKeywordRepairsV294(input);assert.equal(f.reads(),1,'completed proof map is reused without retaining a read promise');
 assert.equal(await inlineKeywordRepairsV294({...input,digest:'f'.repeat(64)}),null);assert.equal(calls.length,2);
 assert.equal(await inlineKeywordRepairsV294({...input,revision:'another'}),null);
 await assert.rejects(inlineKeywordRepairsV294({...input,readCurrent:async()=>[{...current,propertyId:'Q'}]}),/범위/);
 const absent=await inlineKeywordRepairsV294({...input,readCurrent:async()=>[]});assert.deepEqual(absent.rows,[]);assert.deepEqual(absent.ids,['P']);
 f.change();assert.equal(await inlineKeywordRepairsV294(input),null,'an old digest cannot borrow a changed navigation generation');
});
test('v294 optional missing or malformed navigation never triggers a full reconstruction or unproved repair',async()=>{
 const base={revision:'R',mode:'lease',digest:'a'.repeat(64),rows:[['P',proof(2),1]],readCurrent:async()=>{throw Error('Unproved read');}};
 assert.equal(await inlineKeywordRepairsV294({...base,env:{MEDIA:{}}}),null);
 assert.equal(await inlineKeywordRepairsV294({...base,env:{MEDIA:{head:async()=>({etag:'broken',customMetadata:{revision:'R'}}),get:async()=>({body:new Response('not gzip').body})}}}),null);
});
test('v294 client and server bind every master proof, ad count and selected original while tolerating photo enrichment',async()=>{
 const context=vm.createContext({crypto,TextEncoder,Uint8Array});vm.runInContext(await readFile('js/query-collection-v152.js','utf8'),context);
 const f=fixture('lease'),original=await keywordBasisDigestV294(f.packet),client=context.JSQueryCollectionV152.keywordBasisDigestV294;
 assert.equal(await client(f.packet),original);const enriched=structuredClone(f.packet);enriched.rows.reverse();enriched.rows[0][4]='new.jpg';assert.equal(await client(enriched),original);
 for(const [column,value] of [[0,'OTHER'],[1,proof(9)],[2,2],[3,'another-ad']]){const changed=structuredClone(f.packet);changed.rows[0][column]=value;assert.notEqual(await client(changed),original);assert.equal(await client(changed),await keywordBasisDigestV294(changed));}
});
