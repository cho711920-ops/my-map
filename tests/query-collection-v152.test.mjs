import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile('js/query-collection-v152.js','utf8'),window={};
vm.runInNewContext(source,{window,console,Date,Map,Set});
const api=window.JSQueryCollectionV152,proof='sha256-v1:'+'a'.repeat(64),nextProof='sha256-v1:'+'b'.repeat(64);
const plain=value=>JSON.parse(JSON.stringify(value));
function packet(ids=['A','B'],revision='r',hash=proof){return {ok:true,version:152,grouping:'client-v152',completeQuery:true,
  revision,total:ids.length,fields:['propertyId','sourceSnapshotKey','name','address','queryGroupKeyV152'],rows:ids.map(id=>[id,hash,'이름 '+id,'같은 주소',''])};}
function point(ids,hash=proof){return {ok:true,requestedIds:ids,missingIds:[],items:ids.map(id=>({property_id:id,source_snapshot_key:hash,operating_memo:'메모 '+id,monthly_rent:80})),
  unified:{ok:true,format:'expanded-v2',groups:Object.fromEntries(ids.map(id=>[id,[{propertyId:id,originalId:'ad-'+id,images:['one-'+id,'two-'+id]}]])),
    sourceSnapshotKeys:Object.fromEntries(ids.map(id=>[id,hash])),sourceSnapshotPropertyIds:Object.fromEntries(ids.map(id=>[id,id]))}};}
function harness(settings={}){
  let owner='a@example.invalid',cacheValue=null;
  const masters=new Map(),reads=[],commits=[],errors=[],writes=[];
  const options={account:()=>owner,master:id=>masters.get(id),readQuery:async()=>packet(),
    readPoints:async ids=>{reads.push(Array.from(ids));return point(Array.from(ids));},capture:()=>new Map(masters),
    applyPoints:(part,context)=>{if(part.items.some(row=>masters.get(row.property_id)!==context.get(row.property_id)))return false;
      part.items.forEach(row=>masters.set(row.property_id,{propertyId:row.property_id,sourceSnapshotKey:row.source_snapshot_key,memo:row.operating_memo}));return true;},
    index(){},initialIds:view=>view.rows.slice(0,36).map(row=>row.propertyId),commit:(view,flags)=>commits.push([view.revision,flags.cached]),
    error:(error,hasData)=>errors.push([error.code,hasData]),
    cache:{read:async()=>cacheValue,write:async(account,value,current)=>{if(current()){cacheValue=plain(value);writes.push(cacheValue);}},clear:async()=>{cacheValue=null;}},...settings};
  return {core:api.create(options),options,masters,reads,commits,errors,writes,setAccount:value=>{owner=value;},
    setCache:value=>{cacheValue=value;},cache:()=>cacheValue};
}
test('initial query loads only visible full masters and never marks its partial cache complete',async()=>{
  const ids=Array.from({length:200},(_,i)=>'ID-'+i),h=harness({readQuery:async()=>packet(ids)});
  assert.equal(await h.core.load({mode:'lease'}),true);
  assert.equal(h.masters.size,36);assert.deepEqual(h.reads,[ids.slice(0,36)]);
  assert.equal(h.core.snapshot().rows.length,200);assert.equal(h.core.ready('ID-199'),false);
  assert.equal(h.cache().completeCatalog,false);assert.equal(h.cache().kind,'query-scope-v152');
  assert.equal(h.cache().points.length,36);
});

test('overlapping card preparation and an early action share verified in-flight masters without racing cohort publication',async()=>{
  const ids=Array.from({length:80},(_,i)=>'ID-'+i),h=harness({readQuery:async()=>packet(ids)});await h.core.load({mode:'lease'});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  h.options.readPoints=async requested=>{h.reads.push([...requested]);if(requested.includes('ID-40'))await gate;return point(requested);};
  const cards=h.core.hydrate(['ID-40','ID-41']),action=h.core.hydrate(['ID-41','ID-42']);
  assert.deepEqual(h.reads.slice(1),[['ID-40','ID-41']]);release();await Promise.all([cards,action]);
  assert.deepEqual(h.reads.slice(1),[['ID-40','ID-41'],['ID-42']]);
  for(const id of ['ID-40','ID-41','ID-42'])assert.equal(h.core.ready(id),true);
});
test('a later list window loads exact IDs in bounded batches while retaining existing masters and photo lists',async()=>{
  const ids=Array.from({length:160},(_,i)=>'ID-'+i),h=harness({readQuery:async()=>packet(ids)});
  await h.core.load({mode:'lease'});const first=h.masters.get('ID-0');
  await h.core.hydrate(ids.slice(36,141));assert.deepEqual(h.reads.map(ids=>ids.length),[36,50,50,5]);
  assert.equal(h.masters.get('ID-0'),first);assert.equal(h.core.ready('ID-140'),true);
  assert.deepEqual(h.cache().points[0].unified.groups['ID-0'][0].images,['one-ID-0','two-ID-0']);
});
test('an incomplete or wrong-proof point batch cannot publish any member of its cohort',async()=>{
  const ids=Array.from({length:90},(_,i)=>'ID-'+i),h=harness({readQuery:async()=>packet(ids)});
  await h.core.load({mode:'lease'});h.options.readPoints=async ids=>point(Array.from(ids),nextProof);
  await assert.rejects(h.core.hydrate(ids.slice(36)),/변경/);
  assert.equal(h.masters.size,36);assert.equal(h.core.ready('ID-36'),false);
});
test('editing while a point read waits preserves the current memo and rejects the late read',async()=>{
  const h=harness();await h.core.load({mode:'lease'});
  let release;h.options.readPoints=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.core.hydrate(['A'],{force:true});h.masters.set('A',{...h.masters.get('A'),memo:'쓰는 중'});release(point(['A']));
  await assert.rejects(pending,/편집/);assert.equal(h.masters.get('A').memo,'쓰는 중');
});
test('an old market response cannot replace a newer query',async()=>{
  let release;const h=harness({readQuery:spec=>spec.mode==='lease'?new Promise(resolve=>{release=resolve;}):Promise.resolve(packet(['SALE'],'sale'))});
  const older=h.core.load({mode:'lease'});assert.equal(await h.core.load({mode:'building_sale'}),true);
  release(packet());assert.equal(await older,false);assert.equal(h.core.snapshot().revision,'sale');
  assert.deepEqual(h.commits,[['sale',false]]);
});
test('account change and logout fence both pending reads and cache writes',async()=>{
  let release;const h=harness({readQuery:()=>new Promise(resolve=>{release=resolve;})});
  const task=h.core.load({mode:'lease'});h.setAccount('other@example.invalid');release(packet());
  assert.equal(await task,false);assert.equal(h.masters.size,0);assert.equal(h.writes.length,0);
  const g=harness();await g.core.load({mode:'lease'});await g.core.clear();assert.equal(g.cache(),null);
  await assert.rejects(g.core.load({mode:'lease'}),/로그인/);
});
test('only the exact account and query may reuse a scoped cache, then the fresh response wins',async()=>{
  const first=harness();await first.core.load({mode:'lease'});
  let release;const second=harness({readQuery:()=>new Promise(resolve=>{release=resolve;})});second.setCache(first.cache());
  const task=second.core.load({mode:'lease'});
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(second.commits,[['r',true]]);
  release(packet(['A','B'],'new'));assert.equal(await task,true);assert.equal(second.core.snapshot().revision,'new');
  const wrong=harness();wrong.setCache({...first.cache(),account:'other@example.invalid'});await wrong.core.load({mode:'lease'});
  assert.deepEqual(wrong.commits,[['r',false]]);
});
test('a changed viewport repairs only uncached points before the full query finishes',async()=>{
  const first=harness({readQuery:async()=>packet(['A','B','C']),initialIds:()=>['A']});await first.core.load({mode:'lease'});
  let release;const second=harness({readQuery:()=>new Promise(resolve=>{release=resolve;}),initialIds:()=>['C']});
  second.setCache(first.cache());const task=second.core.load({mode:'lease'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(second.reads,[['C']]);assert.deepEqual(second.commits,[['r',true]]);assert.equal(second.core.ready('C'),true);
  release(packet(['A','B','C']));assert.equal(await task,true);
});

test('an older cache cannot replace a newer full master already read in another view',async()=>{
  const first=harness();await first.core.load({mode:'lease'});
  let release;const second=harness({readQuery:()=>new Promise(resolve=>{release=resolve;}),readPoints:async ids=>point(Array.from(ids),nextProof)});
  second.masters.set('A',{propertyId:'A',sourceSnapshotKey:nextProof,memo:'더 최근에 확인한 메모'});
  second.setCache(first.cache());const task=second.core.load({mode:'lease'});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(second.masters.get('A').memo,'더 최근에 확인한 메모');
  release(packet(['A','B'],'new',nextProof));assert.equal(await task,true);
});

test('wrong-ID, duplicate and raw writable wire rows are rejected before registry access',()=>{
  const duplicate=packet(['A','A']);assert.throws(()=>api.decode(duplicate),/원장/);
  const forged=packet();forged.fields.push('memo');forged.rows.forEach(row=>row.push('private'));assert.throws(()=>api.decode(forged),/응답/);
  const bad=packet();bad.rows[0][1]=nextProof.toUpperCase();assert.throws(()=>api.decode(bad),/원장/);
  const missing=point(['B']);assert.throws(()=>api.combine([missing],new Map([['A',proof]])),/다른/);
  const child=point(['A']);child.unified.groups.A[0].propertyId='B';assert.throws(()=>api.combine([child],new Map([['A',proof]])),/다른/);
  const outside=point(['A']);outside.unified.groups.B=[];assert.throws(()=>api.combine([outside],new Map([['A',proof]])),/범위/);
});

test('instant card packets require a bounded scalar photo projection and cannot invent a missing-photo count',()=>{
  const old=packet(['A']);assert.equal(api.decode(old).rows[0].querySelectedPhotoCountV157,null);
  assert.throws(()=>api.decode({...old,cardProjectionV157:true}),/사진/);
  const current={...old,cardProjectionV157:true,fields:[...old.fields,'thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'],
    rows:[[...old.rows[0],'https://example.invalid/ad.jpg','ad-A',null]]};
  const row=api.decode(current).rows[0];assert.equal(row.queryRowV152,true);assert.equal(row.querySelectedPhotoCountV157,null);
  for(const [index,value] of [[5,{}],[5,'x'.repeat(8001)],[6,{}],[7,-1],[7,'3'],[7,1.5]]){
    const bad=structuredClone(current);bad.rows[0][index]=value;assert.throws(()=>api.decode(bad),/사진/);
  }
});

test('a receipt fence in another tab rejects a late response even before its storage event runs',async()=>{
  let fence='before',release;const h=harness({fence:()=>fence,readQuery:()=>new Promise(resolve=>{release=resolve;})});
  const pending=h.core.load({mode:'lease'});fence='saved-in-other-tab';release(packet());
  assert.equal(await pending,false);assert.equal(h.masters.size,0);assert.equal(h.writes.length,0);
});

test('live coherent per-property reads can reconcile only their IDs without declaring a new catalog revision',async()=>{
  const h=harness({readPoints:async ids=>point(Array.from(ids),nextProof),canReconcile:()=>true,
    reconcile(view,result){const proofs=new Map(result.items.map(row=>[row.property_id,row.source_snapshot_key]));
      view.rows.forEach(row=>{if(proofs.has(row.propertyId))row.sourceSnapshotKey=proofs.get(row.propertyId);});
      view.packet={...view.packet,rows:view.rows.map(row=>view.packet.fields.map(field=>row[field]))};view.overridden=true;return true;}});
  assert.equal(await h.core.load({mode:'lease'}),true);assert.equal(h.core.snapshot().revision,'r');
  assert.equal(h.core.snapshot().overridden,true);assert.equal(h.core.ready('A'),true);assert.equal(h.masters.get('A').sourceSnapshotKey,nextProof);
  const bad=harness({reconcile(){throw new Error('A forged pair must not reach reconciliation');},readPoints:async ids=>{
    const result=point(Array.from(ids),nextProof);result.unified.sourceSnapshotPropertyIds.A='B';return result;}});
  assert.equal(await bad.core.load({mode:'lease'}),false);assert.equal(bad.masters.size,0);
});


test('a locally cleared default retains the numeric catalog on disk without a transient local-view marker',async()=>{
 const value={...packet(),numericLocalV177:true,numericCatalogV177:{version:177,revision:'r',groups:[]}};
 const h=harness({readQuery:async()=>value,projectBeforeHydrate:()=>true});await h.core.load({mode:'building_sale'});
 assert.deepEqual(h.cache().packet.numericCatalogV177,value.numericCatalogV177);assert.equal(h.cache().packet.numericLocalV177,undefined);
});
