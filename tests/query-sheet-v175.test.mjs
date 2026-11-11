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
