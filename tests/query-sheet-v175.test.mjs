import test from 'node:test';import assert from 'node:assert/strict';
import{buildQueryRuntimeV151}from'../tools/build-query-runtime-v151.mjs';await buildQueryRuntimeV151();
const{createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const{readQuerySheetV175}=await import('../cloudflare/src/query-sheet-v175.js');
const{runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const proof='sha256-v1:'+'a'.repeat(64),cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
function csv(memo='직접 쓴 메모, 줄바꿈\n임장 확인'){
 const detail={landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:5000,monthlyIncome:200,descriptionText:'원문 전체 보존용 설명',manualSaleFieldsV1:['monthlyIncome']};
 const row=['건물','서구 괴정동 1-1','1층','상가',1000,70,0,0,20,'','',memo,'active','2026-11-11','네이버','M-1','','','2000',0,'','','','2026-11-11','',36.35,127.38,0,'sale','building',50000,JSON.stringify(detail),proof,'active'];
 return [Array.from({length:34},(_,i)=>'header'+i),row].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
function fragments(text,width=3){const bytes=new TextEncoder().encode(text);let at=0;return new ReadableStream({pull(c){if(at===bytes.length)return c.close();c.enqueue(bytes.slice(at,at+=Math.min(width,bytes.length-at)));}});}
test('streamed master CSV preserves quoted Korean text, every fact and exact row identity across byte boundaries',async()=>{
 for(const width of [1,2,3,127]){
  const helper=make([],null),text=csv('메모 "인용",\r\n직접 수정');
  const rows=await readQuerySheetV175(fragments(text,width),helper.csvRecordV175);
  const expected=helper.csv(text)[0];delete expected.saleDetails.descriptionText;
  assert.deepEqual(helper.unpackMasterV175(rows[0]),expected);
  assert.equal(expected.memo,'메모 "인용",\n직접 수정');
  assert.equal(rows[0].sheetRow,2);assert.equal(rows[0].sourceSnapshotKey,proof);
 }
});
test('truncated, wrong-width, malformed UTF-8 and empty streamed sheets fail closed',async()=>{
 for(const text of ['',csv().replace(',"header33"',''),csv().slice(0,-5)])await assert.rejects(readQuerySheetV175(fragments(text),make([],null).csvRecordV175));
 const invalid=new ReadableStream({start(c){c.enqueue(Uint8Array.from([0xff]));c.close();}});
 await assert.rejects(readQuerySheetV175(invalid,make([],null).csvRecordV175));
});
test('packed query input preserves keyword, manual financial fields and filtered original identity',async()=>{
 for(const filters of [{maxDeposit:'40,000'},{saleLandMin:'101'},{saleYieldMin:'5'},{keyword:'직접 쓴'},{industryFilter:'임장'}]){
  const helper=make([],null),text=csv(),items=helper.csv(text),packed=await readQuerySheetV175(fragments(text,1024),helper.csvRecordV175);
  const originals=[{propertyId:'M-1',originalId:'O-1',tradeType:'sale',saleCategory:'building',source:'네이버',active:1,salePrice:50000,deposit:1000,rent:70,area:20,saleSummary:{landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:5000,monthlyIncome:100},manualDisplayFields:'sale_details_json'}];
  const meta={ok:true,groups:{'M-1':originals},sourceSnapshotKeys:{'M-1':proof},sourceSnapshotPropertyIds:{'M-1':'M-1'}},spec={mode:'building_sale',filters,individualQueryV152:true};
  const expected=make(items,meta).query(spec),actual=await runSnapshotQueryV151({items:packed,metadata:meta,stream:new Blob([JSON.stringify(meta)]).stream()},spec,1);
  assert.deepEqual(actual.map(x=>[x.propertyId,x.salePrice,x.saleDetails.monthlyIncome]),expected.map(x=>[x.propertyId,x.salePrice,x.saleDetails.monthlyIncome]));
  assert.equal(packed[0].queryCsvFieldsV175,null);assert.equal(originals[0].saleSummary.monthlyIncome,100);
 }
});

test('prepared read sheets are atomic, ETag-bound and reuse compact rows without reparsing the wide source',async()=>{
 const {preparedQuerySheetV175}=await import('../cloudflare/src/query-sheet-v175.js');
 const objects=new Map();let uploads=0,aborts=0,changed=false;
 const bucket={async get(key){const entry=objects.get(key);return entry?{body:new Blob([entry.bytes]).stream(),customMetadata:entry.metadata,httpMetadata:entry.httpMetadata,etag:'compact'}:null;},async head(){return{etag:changed?'changed':'original'};},async createMultipartUpload(key,options){uploads++;const parts=[];return{async uploadPart(n,bytes){parts.push(bytes);return{partNumber:n,etag:String(n)};},async complete(){objects.set(key,{bytes:new Blob(parts),metadata:options.customMetadata,httpMetadata:options.httpMetadata});},async abort(){aborts++;}};}};
 const source=()=>({body:fragments(csv('숫자 100, 따옴표 "메모"\n계속'),211),etag:'original'}),helper=make([],null);
 const first=await preparedQuerySheetV175(bucket,'sheet',source(),helper);
 const second=await preparedQuerySheetV175(bucket,'sheet',source(),make([],null));
 assert.deepEqual(helper.unpackMasterV175(second[0]),helper.unpackMasterV175(first[0]));assert.equal(uploads,1);
 changed=true;
 await assert.rejects(preparedQuerySheetV175(bucket,'other',source(),make([],null)),/changed/);
 assert.equal(objects.has('other.query-v175-gzip.jsonl'),false);assert.equal(aborts,1);
});

test('conservative early bounds preserve every matching alternate ad and manual mixed-field override',async()=>{
 const base=make([],null).csv(csv())[0],items=[],groups={};
 for(let n=0;n<24;n++){
  const id='gate-'+n,detail={landAreaM2:(n+1)*30,grossAreaM2:(25-n)*40,totalDeposit:n*1000,monthlyIncome:n*30,manualSaleFieldsV1:['monthlyIncome','landAreaM2']};
  items.push({...structuredClone(base),propertyId:id,address:'서구 괴정동 '+(n+1)+'-1',salePrice:20000+n*3000,saleDetails:detail});
  groups[id]=[0,1,2].map(a=>({propertyId:id,originalId:id+'-'+a,source:a?'네이버':'당근',active:1,tradeType:'sale',saleCategory:a===1?'office':a===2?'multifamily':'building',salePrice:40000+a*10000+n*500,saleSummary:{landAreaM2:(24-n+a)*40,grossAreaM2:(n+a+1)*50,totalDeposit:5000+a*1000,monthlyIncome:100+a*100},manualDisplayFields:n%3===0?'sale_details_json,sale_price':''}));
 }
 const meta={ok:true,groups,sourceSnapshotKeys:Object.fromEntries(items.map(i=>[i.propertyId,proof])),sourceSnapshotPropertyIds:Object.fromEntries(items.map(i=>[i.propertyId,i.propertyId]))};
 for(const filters of [{maxDeposit:'50000'},{minDeposit:'55000'},{saleLandMin:'100'},{saleLandMax:'100'},{saleGrossMin:'150'},{saleYieldMin:'5'},{saleYieldMax:'4'},{saleCategoryFilter:'office'},{saleCategoryFilter:'multifamily'},{saleCategoryFilter:'factory_warehouse'},{saleLandMin:'80',saleYieldMin:'6'},{keyword:'괴정동 3-1',maxDeposit:'50000'}]){
  const spec={mode:'building_sale',filters,individualQueryV152:true},expected=make(structuredClone(items),structuredClone(meta)).query(spec);
  const actual=await runSnapshotQueryV151({items:structuredClone(items),metadata:meta,stream:new Blob([JSON.stringify(meta)]).stream()},spec,7);
  const facts=rows=>rows.map(r=>[r.propertyId,r.salePrice,r.saleDetails.monthlyIncome,r.saleDetails.landAreaM2]);
  assert.deepEqual(facts(actual),facts(expected),JSON.stringify(filters));
 }
});

test('current active base proofs authorize only exact complete same-revision membership, never completed or stale scopes',async()=>{
 const{currentBaseProofsV175,queryWireV151}=await import('../cloudflare/src/query-worker-v151.js');
 const proof='sha256-v1:'+'b'.repeat(64),packet=queryWireV151([{propertyId:'CURRENT',sourceSnapshotKey:proof}],'r');let rev='r';
 const env={MEDIA:{async get(){return{customMetadata:{revision:rev},body:new Blob([JSON.stringify(packet)]).stream()};}}};
 assert.deepEqual([...await currentBaseProofsV175(env,{revision:'r'},{mode:'building_sale',hideDone:true})],[['CURRENT',proof]]);
 for(const scope of [{doneOnly:true},{hideDone:false},{newListingDays:1}])assert.equal(await currentBaseProofsV175(env,{revision:'r'},{mode:'building_sale',...scope}),null);
 rev='old';assert.equal(await currentBaseProofsV175(env,{revision:'r'},{mode:'building_sale'}),null);
});
