const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/map.js','utf8');
function declaration(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);return (source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,source.indexOf('\n}',start)+2);}
const proof=n=>'sha256-v1:'+String(n).padStart(64,'0');
function item(id,n=1){return {propertyId:id,property_id:id,key:id,address:'서구 테스트동 '+id,name:id,room:'1층',memo:'메모 '+id,state:'active',source:'네이버',deposit:1000,rent:50,area:20,sheetRow:3,sourceSnapshotKey:proof(n)};}
function inventory(ids,n=1){return {ok:true,format:'compact-v2',fields:['originalId','deposit','rent','lastCheckedAt'],groups:Object.fromEntries(ids.map(id=>[id,[[id+'-ad',1000,50,'2026-11-03T00:00:00Z']]])),sourceSearchIds:{},sourceSnapshotKeys:Object.fromEntries(ids.map(id=>[id,proof(n)])),sourceSnapshotPropertyIds:Object.fromEntries(ids.map(id=>[id,id]))};}
function harness(){
 const reads=[],h={console,Date,Promise,Set,innerWidth:1280,allItems:[item('A'),item('B'),item('U')],currentItems:[],
  jsListingsLoadGenerationV1:1,jsListingsRevisionV682:'keep-full-baseline',isLoadingSheet:false,pendingAutoUpdate:false,jsListingsCompleteBaseV1:true,
  preserveActionSelectionDuringRender:false,addEventListener(){},document:{getElementById(){return null;},addEventListener(){}},
  clean:v=>String(v??'').trim(),itemKey:i=>i.key,listingChangeRowToItemV683:i=>({...i}),
  JSDataAccessV6:{invalidateRead(){},async read(action,params){reads.push({action,params});return h.response;}},
  updateTypeOptions(){},ensureCompleteBaseV1(){},captureAutoUpdateViewState(){return {};},restoreAutoUpdateViewState(){},applyFilter(){},notifyListingsSnapshotV1(){}};
 h.window=h;vm.createContext(h);vm.runInContext(fs.readFileSync('js/unified-listings-v8.js','utf8'),h);
 for(const name of ['scopedReadLocalValuesV1','captureScopedReadV1','originalMetadataMutationPendingV1','applyScopedListingsV1','refreshMovedListingsV99'])vm.runInContext(declaration(name),h);
 h.JSUnifiedListingsV8.attachCompatible(h.allItems,inventory(['A','B','U']));
 return {h,reads};
}
test('merge refresh retrieves only affected IDs, removes deleted card, preserves unrelated card and full baseline',async()=>{
 const {h,reads}=harness(),unrelated=h.allItems[2];
 h.response={ok:true,requestedIds:['A','B'],missingIds:['B'],items:[item('A',2)],unified:inventory(['A'],2)};
 assert.equal(await h.refreshMovedListingsV99({affectedPropertyIds:['A','B']}),true);
 assert.deepEqual(JSON.parse(JSON.stringify(reads)),[{action:'listingOriginals',params:{ids:'A,B'}}]);
 assert.deepEqual(Array.from(h.allItems,i=>i.propertyId),['A','U']);assert.equal(h.allItems[1],unrelated);
 assert.equal(h.jsListingsRevisionV682,'keep-full-baseline');assert.equal(h.JSUnifiedListingsV8.allOriginals('A').length,1);
});
test('split refresh inserts the new master and replaces original inventory instead of redownloading the dataset',async()=>{
 const {h,reads}=harness();
 h.response={ok:true,requestedIds:['A','NEW'],missingIds:[],items:[item('A',2),item('NEW',2)],unified:inventory(['A','NEW'],2)};
 assert.equal(await h.refreshMovedListingsV99({affectedPropertyIds:['A','NEW']}),true);
 assert.ok(h.allItems.some(i=>i.propertyId==='NEW'));assert.equal(reads.length,1);
 assert.equal(h.JSUnifiedListingsV8.allOriginals('NEW')[0].originalId,'NEW-ad');
});
test('inconsistent inventory proof never removes a card or overwrites existing memo',async()=>{
 const {h}=harness(),before=h.allItems.slice();
 h.response={ok:true,requestedIds:['A','B'],missingIds:['B'],items:[item('A',2)],unified:inventory(['A'],3)};
 assert.equal(await h.refreshMovedListingsV99({affectedPropertyIds:['A','B']}),false);
 assert.deepEqual(h.allItems,before);
});
test('late pre-mutation reads and edits made during scoped fetch cannot replace the live list',async()=>{
 const {h}=harness();let resolve;
 h.JSDataAccessV6.read=()=>new Promise(yes=>{resolve=yes;});
 const pending=h.refreshMovedListingsV99({affectedPropertyIds:['A','B']});
 h.allItems[1].memo='동시 작성';resolve({ok:true,requestedIds:['A','B'],missingIds:['B'],items:[item('A',2)],unified:inventory(['A'],2)});
 assert.equal(await pending,false);assert.equal(h.allItems[1].memo,'동시 작성');
 const other=h.refreshMovedListingsV99({affectedPropertyIds:['A']});h.jsListingsLoadGenerationV1++;
 resolve({ok:true,requestedIds:['A'],missingIds:[],items:[item('A',2)],unified:inventory(['A'],2)});assert.equal(await other,false);
});
