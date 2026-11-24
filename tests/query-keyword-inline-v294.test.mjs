import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {inlineKeywordRepairsV294,keywordBasisDigestV294} from '../cloudflare/src/query-keyword-inline-v294.js';
const proof=n=>'sha256-v1:'+String(n).padStart(64,'0');
function fixture(){
 const packet={fields:['propertyId','sourceSnapshotKey','queryMatchedOriginalCountV152','querySelectedOriginalIdV152','thumbnailV8'],rows:[['P',proof(1),1,'P-ad','old.jpg'],['Q',proof(2),1,'Q-ad','other.jpg']]};
 return {packet};
}
for(const mode of ['lease','building_sale','land_sale'])test('v295 first-response current originals use their exact memo proof despite an older client '+mode,async()=>{
 const f=fixture(),digest=await keywordBasisDigestV294(f.packet),calls=[],current={propertyId:'P',sourceSnapshotKey:proof(3),rent:90,thumbnailV8:'https://photos.invalid/current-inline.jpg'};
 const input={env:{MEDIA:{head(){throw Error('No navigation read');},get(){throw Error('No navigation read');}}},mode,digest,rows:[['P',proof(3),1],['Q',proof(2),1]],readCurrent:async ids=>{calls.push(ids);return [current];}};
 const actual=await inlineKeywordRepairsV294(input);assert.deepEqual(actual,{digest,ids:['P','Q'],rows:[current]});assert.deepEqual(calls,[['P','Q']]);
 await assert.rejects(inlineKeywordRepairsV294({...input,readCurrent:async()=>[{...current,propertyId:'FOREIGN'}]}),/범위/);
 await assert.rejects(inlineKeywordRepairsV294({...input,readCurrent:async()=>[{...current,sourceSnapshotKey:proof(4)}]}),/최신/);
 await assert.rejects(inlineKeywordRepairsV294({...input,readCurrent:async()=>[current,current]}),/범위/);
 const absent=await inlineKeywordRepairsV294({...input,readCurrent:async()=>[]});assert.deepEqual(absent.rows,[]);assert.deepEqual(absent.ids,['P','Q']);
});
test('v295 bounded current-original batches reject invalid, duplicate and oversized identities',async()=>{
 const calls=[],base={digest:'a'.repeat(64),rows:Array.from({length:53},(_,i)=>['P'+i,proof(i),1]),readCurrent:async ids=>{calls.push(ids);return [];}};
 assert.equal((await inlineKeywordRepairsV294(base)).ids.length,53);assert.deepEqual(calls.map(ids=>ids.length),[50,3]);
 for(const patch of [{digest:'bad'},{rows:[['P',proof(1),1],['P',proof(2),1]]},{rows:[['P','bad',1]]},{rows:Array.from({length:1025},(_,i)=>['P'+i,proof(i),1])}])assert.equal(await inlineKeywordRepairsV294({...base,...patch,readCurrent:async()=>{throw Error('Unexpected read');}}),null);
});
test('v294 client and server bind every master proof, ad count and selected original while tolerating photo enrichment',async()=>{
 const context=vm.createContext({crypto,TextEncoder,Uint8Array});vm.runInContext(await readFile('js/query-collection-v152.js','utf8'),context);
 const f=fixture(),original=await keywordBasisDigestV294(f.packet),client=context.JSQueryCollectionV152.keywordBasisDigestV294;
 assert.equal(await client(f.packet),original);const enriched=structuredClone(f.packet);enriched.rows.reverse();enriched.rows[0][4]='new.jpg';assert.equal(await client(enriched),original);
 for(const [column,value] of [[0,'OTHER'],[1,proof(9)],[2,2],[3,'another-ad']]){const changed=structuredClone(f.packet);changed.rows[0][column]=value;assert.notEqual(await client(changed),original);assert.equal(await client(changed),await keywordBasisDigestV294(changed));}
});
