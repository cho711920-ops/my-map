import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {numericSinglePlanV176,currentBaseRowsV176,privateListingQueryV151,queryWireV151,queryPacketRowsV152}=await import('../cloudflare/src/query-worker-v151.js');
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const proof='sha256-v1:'+'a'.repeat(64);
function fixture(){
  const items=[],groups={},keys={},ids={};
  for(let n=0;n<8;n++){
    const id='S-'+n,detail={landAreaM2:200+n*40,grossAreaM2:400+n*60,totalDeposit:5000,monthlyIncome:200+n*20};
    items.push({propertyId:id,key:id,name:'건물'+n,address:'서구 괴정동 '+(n+1)+'-1',room:'1층',floor:1,
      tradeType:'sale',saleCategory:'building',salePrice:30000+n*15000,saleDetails:detail,source:'네이버',state:'active',
      memo:n===3?'(확인매물) 수동 메모':'(임장가자)',sheetRow:n+2,registrationAt:'2026-11-10',sourceSnapshotKey:proof});
    groups[id]=Array.from({length:n%3===0?2:1},(_,a)=>({propertyId:id,originalId:id+'-ad-'+a,active:1,
      source:a?'당근':'네이버',tradeType:'sale',saleCategory:n===2?'office':'building',salePrice:30000+n*15000+a*20000,
      saleSummary:detail,manualDisplayFields:n===4?'sale_price':'',photoCount:3,thumbnail:'https://photos.invalid/'+id+'-'+a+'.jpg'}));
    keys[id]=proof;ids[id]=id;
  }
  return {items,metadata:{ok:true,groups,sourceSnapshotKeys:keys,sourceSnapshotPropertyIds:ids}};
}
async function run(data,spec){
  return runSnapshotQueryV151({items:structuredClone(data.items),metadata:data.metadata,
    stream:new Blob([JSON.stringify(data.metadata)]).stream()}, {...spec,individualQueryV152:true},2);
}
test('single verified original reuse equals complete original evaluation for broad two-sided and all sale filters',async()=>{
  const data=fixture(),base=queryPacketRowsV152(queryWireV151(await run(data,{mode:'building_sale',filters:{}}),'r'));
  for(const filters of [{minDeposit:'50000',maxDeposit:'120000'},{minDeposit:'50,000',maxDeposit:'120,000'},
    {maxDeposit:'80000'},{minDeposit:'100000'}, {saleLandMin:'80',saleLandMax:'130'},
    {saleGrossMin:'160'},{saleGrossMax:'160'},{saleYieldMin:'4'},{saleYieldMax:'5'},
    {saleCategoryFilter:'office'},{saleCategoryFilter:'building'},{minDeposit:'50000',saleYieldMin:'3'}]){
    const spec={mode:'building_sale',filters,hideDone:true},reuse=numericSinglePlanV176(base,spec);
    assert.ok(reuse.size>0);assert.ok(reuse.size<data.items.length,'Multiple ads retain complete original selection');
    const remaining=await run({...data,items:data.items.filter(row=>!reuse.has(row.propertyId))},spec);
    const combined=make([],null).finalize([...remaining,...[...reuse.values()].filter(Boolean)],{...spec,individualQueryV152:true});
    const expected=queryWireV151(await run(data,spec),'r'),actual=queryWireV151(combined,'r');
    assert.deepEqual(actual,expected,JSON.stringify(filters));
  }
});
test('reuse rejects stale or incomplete base views, nonnumeric scopes and ambiguous originals',async()=>{
  const data=fixture(),base=queryPacketRowsV152(queryWireV151(await run(data,{mode:'building_sale',filters:{}}),'r'));
  const spec={mode:'building_sale',filters:{minDeposit:'50000',maxDeposit:'120000'},hideDone:true};
  for(const change of [{mode:'lease'},{doneOnly:true},{hideDone:false},{gongsilOnly:true},{newListingDays:7},{favoriteOnly:true},
    {filters:{keyword:'수동'}},{filters:{industryFilter:'사무실'}},{filters:{sourceFilter:'naver'}},{filters:{typeFilter:'일반상가'}}])
    assert.equal(numericSinglePlanV176(base,{...spec,...change}).size,0);
  const packet=queryWireV151(base,'old');
  for(const [revision,value]of [['old',packet],['r',{...packet,revision:'r',completeQuery:false}],['r',{...packet,revision:'r',total:999}]]){
    const env={MEDIA:{async get(){return{customMetadata:{revision},body:new Blob([JSON.stringify(value)]).stream()};}}};
    const rows=await currentBaseRowsV176(env,{revision:'r'},spec);
    assert.equal(rows,null);assert.equal(numericSinglePlanV176(rows,spec).size,0);
  }
  const ambiguous=base.map(row=>({...row,queryMatchedOriginalCountV152:2}));
  assert.equal(numericSinglePlanV176(ambiguous,spec).size,0);
});
test('current single-original catalog applies broad bounds with no CSV/source download and refuses a concurrent revision change',async()=>{
  const data=fixture();data.items=[data.items[1]];
  const packet=queryWireV151(await run(data,{mode:'building_sale',filters:{}}),'v176-single');
  const readKeys=[];let changed=false,revisionReads=0;
  const env={DB:{prepare(){throw Error('No SQL');}},MEDIA:{async get(key){readKeys.push(key);
    if(key.endsWith('listings.json'))return{body:new Blob([JSON.stringify({revision:changed&&++revisionReads>1?'new':'v176-single'})]).stream()};
    if(key==='api-cache/query-view-v184-building_sale.json')return{customMetadata:{revision:'v176-single'},body:new Blob([JSON.stringify(packet)]).stream()};
    return null;
  },async put(){}}};
  const request=min=>new Request('https://fixture.invalid/',{method:'POST',body:JSON.stringify({revision:'v176-single',spec:{mode:'building_sale',filters:{minDeposit:min,maxDeposit:'120000'}}})});
  const response=await privateListingQueryV151(request('40000'),env,{});const actual=await response.json();
  assert.equal(actual.total,1);assert.equal(actual.rows[0][actual.fields.indexOf('propertyId')],'S-1');
  assert.ok(readKeys.every(key=>!key.includes('.csv')&&!key.includes('metadata')&&!key.includes('original')));
  changed=true;revisionReads=0;
  await assert.rejects(privateListingQueryV151(request('41000'),env,{}),/갱신/);
});

test('completed numeric inputs reuse exact multiple-ad facts across new ranges with no catalog reread and clear on revision change',async()=>{
  const data=fixture(),helper=make([],null),cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  const csv=[Array.from({length:34},(_,i)=>'h'+i),...data.items.map(i=>[
    i.name,i.address,i.room,'일반상가',1000,70,0,0,20,'','',i.memo,i.state,'2026-11-10','네이버',i.propertyId,'','','2000',0,'','','','2026-11-10','',36.35,127.38,0,'sale',i.saleCategory,i.salePrice,JSON.stringify(i.saleDetails),proof,'active'
  ])].map(row=>row.map(cell).join(',')).join('\n')+'\n';
  data.items=helper.csv(csv);
  const base=queryWireV151(await run(data,{mode:'building_sale',filters:{}}),'v176-multiple'),objects=new Map(),reads=[];
  let version='v176-multiple',sequence=0,sqlReads=0;
  const bucket={async get(key){reads.push(key);if(key.endsWith('listings.json'))return{body:new Blob([JSON.stringify({revision:version,collectorRevisionV142:version})]).stream()};
    const saved=objects.get(key);return saved?{...saved,body:new Blob([saved.text]).stream()}:null;
  },async head(key){return objects.get(key)||null;},async put(key,text,options={}){const result={text,etag:'e-'+(++sequence),...options};objects.set(key,result);return result;},
  async createMultipartUpload(key,options){const chunks=[];return{async uploadPart(n,bytes){chunks[n-1]=bytes;return{partNumber:n,etag:String(n)};},async complete(){return bucket.put(key,await new Blob(chunks).text(),options);},async abort(){}};}};
  const metadata={customMetadata:{revision:version,collectorRevisionV142:version}};
  await bucket.put('api-cache/query-view-v184-building_sale.json',JSON.stringify(base),metadata);
  await bucket.put('api-cache/query-sheet-sales-v184.csv',csv,metadata);
  await bucket.put('api-cache/query-metadata-sales-v184.json',JSON.stringify(data.metadata),metadata);
  const env={MEDIA:bucket,DB:{prepare(){sqlReads++;throw Error('No SQL fixture');}}};
  const request=filters=>new Request('https://fixture.invalid/',{method:'POST',body:JSON.stringify({revision:version,spec:{mode:'building_sale',filters}})});
  const first={minDeposit:'50000',maxDeposit:'120000'};
  assert.equal((await privateListingQueryV151(request(first),env,{})).status,200);reads.length=0;
  for(const filters of [{minDeposit:'50001',maxDeposit:'119999'},{saleYieldMin:'5'},{saleCategoryFilter:'office'}]){
    const actual=await (await privateListingQueryV151(request(filters),env,{})).json();
    assert.deepEqual(actual,queryWireV151(await run(data,{mode:'building_sale',filters}),version));
  }
  assert.equal(sqlReads,0);
  assert.ok(reads.every(key=>!key.includes('.csv')&&!key.includes('metadata-sales')&&!key.includes('query-numeric')&&!key.includes('original-index')),'New ranges reuse completed input facts, not the preceding result');
  version='v176-multiple-new';
  await assert.rejects(privateListingQueryV151(request(first),env,{}),/No SQL/);
  assert.ok(sqlReads>0,'A new revision cannot use the old completed inputs');
});
