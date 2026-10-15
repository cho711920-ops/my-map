const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/unified-listings-v8.js", "utf8");
function master(extra={}) {
  return {propertyId:"M-target",key:"saved-favorite-key",memo:"사용자 메모",name:"중소형사무실",
    address:"서구 둔산동 1095",room:"2층",state:"active",source:"네이버",
    deposit:1000,rent:60,premium:0,area:23.2,...extra};
}
function original(extra={}) {
  return {propertyId:"M-target",originalId:"source-1",providerSourceId:"1234567890",
    source:"네이버",tradeType:"lease",active:1,candidateEligible:false,availabilityKind:"active",
    deposit:1000,rent:60,premium:0,area:23.2,floor:2,room:"2층",thumbnail:"",photoCount:0,...extra};
}
function harness(replies, initial, extra={}) {
  const item=master(extra), calls=[], renders=[], listSnapshots=[];
  const body={scrollTop:35,querySelector(){return null;},contains(){return false;}};
  const w={innerWidth:1200,allItems:[item],hideDone:true,doneOnly:false,addEventListener(){},maxRent:80,
    JSDataAccessV6:{read(action,params,options){
      calls.push({action,params,options,knownIds:Array.from(w.__test.state.groups["M-target"] || [],row=>row.originalId)});
      assert.equal(action,"unifiedListingDetail","A clicked card must not start an automatic full-list download");
      const reply=replies.shift();
      if(reply instanceof Error)return Promise.reject(reply);
      assert.ok(reply,"Unexpected unbounded detail retry");
      return Promise.resolve(reply).then(originals=>({ok:true,originals}));
    }},
    __render(propertyId,originals,selected){renders.push({propertyId,ids:Array.from(originals,row=>row.originalId),selected,
      message:w.__test.detailStatusMessage(propertyId),status:w.__test.state.detailStatus[propertyId]});}
  };
  const document={activeElement:null,addEventListener(){},getElementById(id){return id==="unifiedDetailBodyV8"?body:null;}};
  vm.runInNewContext(source.replace("global.JSUnifiedListingsV8 = {", `
    global.__test={state:state,loadDetail:loadDetail,detailIsFresh:detailIsFresh,
      detailStatusMessage:detailStatusMessage,detailOriginals:detailOriginals,detailPhotoPlaceholder:detailPhotoPlaceholder};
    renderDetail=global.__render;
    global.JSUnifiedListingsV8 = {`),{window:w,document,console});
  const api=w.JSUnifiedListingsV8;
  w.applyFilter=()=>{
    const view=w.doneOnly?"completed":w.hideDone?"active":"all";
    w.currentItems=w.allItems.map(row=>api.filterItemForView(row,
      probe=>probe.deposit<=2000&&probe.rent<=w.maxRent&&probe.area>=20,view)).filter(Boolean);
    listSnapshots.push(w.currentItems.map(row=>row.propertyId));
  };
  api.attach([item],initial===undefined?undefined:{ok:true,groups:initial});
  w.applyFilter();
  return {w,api,item,calls,renders,listSnapshots,...w.__test};
}
function preserved(item) {const {propertyId,key,memo,deposit,rent,room,state}=item;return {propertyId,key,memo,deposit,rent,room,state};}

test("unloaded original metadata stays a fast CSV card but cannot claim one source or no photo",()=>{
  const h=harness([]);
  assert.equal(h.w.currentItems.length,1,"Keep the CSV-first responsive list rather than hiding all listings");
  assert.equal(h.item.unifiedOriginalMetadataPendingV1,true);
  assert.equal(h.item.unifiedOriginalCountV8,0);
  const parts=h.api.cardParts(h.w.currentItems[0]);
  assert.match(parts.thumbnail,/원본 확인 중/);
  assert.doesNotMatch(parts.thumbnail,/사진 없음/);
  assert.match(parts.badge,/원본 확인 중/);
  assert.equal(h.calls.length,0,"Pending labels must not trigger per-card network requests");
});

test("a confirmed source-less manual record is distinct from metadata still loading",()=>{
  const h=harness([],{}, {source:"직접등록"});
  assert.equal(h.item.unifiedOriginalMetadataPendingV1,false);
  assert.equal(h.item.unifiedOriginalCountV8,1);
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/사진 없음/);
});

test("the reported ghost card disappears from active view after seven candidate-only originals are read",async()=>{
  const rows=Array.from({length:7},(_,index)=>original({originalId:"legacy-"+index,providerSourceId:"90000000"+index,
    active:0,candidateEligible:true,availabilityKind:"legacy_candidate",
    thumbnail:index<6?"https://example.invalid/archived-"+index+".jpg":"",photoCount:index<6?7:0}));
  const h=harness([rows]), before=preserved(h.item);
  await h.api.open("M-target");
  assert.equal(h.calls.length,1);
  assert.equal(h.w.currentItems.length,0,"Candidate-only source evidence must remove the normal CSV ghost");
  assert.equal(h.item.unifiedAllOriginalsV1.length,7);
  assert.equal(h.item.sourceAllUnavailableV1,true);
  assert.deepEqual(h.renders.at(-1).ids,[]);
  assert.equal(h.renders.at(-1).status,"unavailable");
  assert.match(h.renders.at(-1).message,/거래완료만 보기/);
  assert.doesNotMatch(h.api.cardParts(h.item).thumbnail,/archived-/,
    "Do not borrow photos from hidden inactive source advertisements");
  assert.deepEqual(preserved(h.item),before);
  h.w.doneOnly=true;h.w.hideDone=false;h.w.applyFilter();
  assert.equal(h.w.currentItems.length,1,"The preserved candidates remain available in the correct view");
});

test("reading an active original updates a pending card and its missing thumbnail without canonical edits",async()=>{
  const fresh=original({thumbnail:"https://example.invalid/current.jpg",photoCount:1,images:["https://example.invalid/current.jpg"]});
  const h=harness([[fresh]]), before=preserved(h.item);
  await h.api.open("M-target");
  assert.equal(h.w.currentItems.length,1);
  assert.equal(h.item.unifiedOriginalMetadataPendingV1,false);
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/current\.jpg/);
  assert.equal(h.renders.at(-1).selected,"source-1");
  assert.equal(h.state.snapshotRevision,"","A single fresh property cannot impersonate a complete paired snapshot");
  assert.deepEqual(preserved(h.item),before);
});

test("detail replaces a compact missing photo with the same current advertisement's available photo",async()=>{
  const h=harness([[original({thumbnail:"https://example.invalid/current.jpg",photoCount:1})]],{"M-target":[original()]});
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/사진 없음/);
  await h.api.open("M-target");
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/current\.jpg/);
  assert.equal(h.calls.length,1);
});

test("changed internal row IDs reconnect only by exact source, market and provider advertisement identity",async()=>{
  const old=original({originalId:"old-row",thumbnail:"https://example.invalid/old.jpg",photoCount:1});
  const fresh=original({originalId:"new-row",thumbnail:"https://example.invalid/fresh.jpg",photoCount:1});
  const h=harness([[fresh]],{"M-target":[old]});
  await h.api.open("M-target","old-row");
  assert.equal(h.renders.at(-1).selected,"new-row");
  assert.deepEqual(h.renders.at(-1).ids,["new-row"]);
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/fresh\.jpg/);
  assert.equal(h.calls.length,1);
});

test("an unrelated advertisement at the same address is never substituted for an explicitly selected source",async()=>{
  const old=original({originalId:"old-row"});
  const other=original({originalId:"other-row",source:"당근",thumbnail:"https://example.invalid/unrelated.jpg",photoCount:1});
  const h=harness([[other],[other]],{"M-target":[old]});
  await h.api.open("M-target","old-row");
  assert.equal(h.calls.length,2,"At most the initial read and one forced retry are permitted");
  assert.deepEqual(h.renders.at(-1).ids,["old-row"],"Keep the selected last-confirmed source with an uncertainty notice, never substitute the other advertisement");
  assert.equal(h.renders.at(-1).status,"mismatch");
  assert.equal(h.calls[1].options.headers["X-JS-Force-Refresh"],"1");
});

test("fresh source conditions that no longer match the user's rent bound do not remain in the list or detail",async()=>{
  const h=harness([[original({rent:150})]],{"M-target":[original()]});
  const before=preserved(h.item);
  await h.api.open("M-target");
  assert.equal(h.w.currentItems.length,0);
  assert.deepEqual(h.renders.at(-1).ids,[]);
  assert.equal(h.renders.at(-1).status,"filtered");
  assert.equal(h.w.maxRent,80);
  assert.deepEqual(preserved(h.item),before);
  assert.equal(h.calls.length,1);
});

test("empty responses preserve the last source and photo, report uncertainty and never become a fresh empty cache",async()=>{
  const old=original({thumbnail:"https://example.invalid/saved.jpg",photoCount:1});
  const h=harness([[],[]],{"M-target":[old]});
  await h.api.open("M-target");
  assert.equal(h.calls.length,2);
  assert.equal(h.detailIsFresh("M-target"),false);
  assert.equal(h.state.detailCache["M-target"],undefined);
  assert.equal(h.w.currentItems.length,1);
  assert.deepEqual(h.renders.at(-1).ids,["source-1"]);
  assert.equal(h.renders.at(-1).status,"mismatch");
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/saved\.jpg/);
  assert.equal(h.calls[1].options.cache,"reload");
});

test("one forced retry can recover a transient empty response, without full-list fetches",async()=>{
  const h=harness([[],[original({thumbnail:"https://example.invalid/recovered.jpg",photoCount:1})]]);
  await h.api.open("M-target");
  assert.equal(h.calls.length,2);
  assert.deepEqual(h.renders.at(-1).ids,["source-1"]);
  assert.equal(h.renders.at(-1).status,"");
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/recovered\.jpg/);
});

test("a cached unrelated source cannot overwrite the newer full-snapshot group before the forced read",async()=>{
  const current=original({originalId:"new-current",lastCheckedAt:"2026-10-15T03:00:00Z"});
  const old=original({originalId:"old-other",providerSourceId:"9999999999",lastCheckedAt:"2026-10-14T03:00:00Z"});
  const h=harness([[current]],{"M-target":[current]});
  h.state.detailCache["M-target"]=[old];h.state.detailCachedAt["M-target"]=Date.now();
  await h.api.open("M-target");
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].options.headers["X-JS-Force-Refresh"],"1");
  assert.ok(h.renders.every(row=>!row.ids.includes("old-other")));
  assert.deepEqual(Array.from(h.api.allOriginals("M-target"),row=>row.originalId),["new-current"]);
  assert.deepEqual(h.renders.at(-1).ids,["new-current"]);
});

test("an old cached inactive version cannot hide the same currently active advertisement",async()=>{
  const current=original({lastCheckedAt:"2026-10-15T03:00:00Z",thumbnail:"https://example.invalid/current.jpg",photoCount:1});
  const old=original({lastCheckedAt:"2026-10-14T03:00:00Z",active:0,candidateEligible:true,availabilityKind:"legacy_candidate"});
  const h=harness([[current]],{"M-target":[current]});
  h.state.detailCache["M-target"]=[old];h.state.detailCachedAt["M-target"]=Date.now();
  await h.api.open("M-target");
  assert.equal(h.calls.length,1);
  assert.ok(h.listSnapshots.every(rows=>rows.length===1));
  assert.equal(h.api.allOriginals("M-target")[0].active,1);
  assert.deepEqual(h.renders.at(-1).ids,["source-1"]);
  assert.match(h.api.cardParts(h.w.currentItems[0]).thumbnail,/current\.jpg/);
});

test("an older R2 response is retried once and never regresses a newer active snapshot, even if retry is also old",async()=>{
  const current=original({lastCheckedAt:"2026-10-15T03:00:00Z"});
  const old=original({lastCheckedAt:"2026-10-14T03:00:00Z",active:0,candidateEligible:true,availabilityKind:"legacy_candidate"});
  const h=harness([[old],[old]],{"M-target":[current]});
  await h.api.open("M-target");
  assert.equal(h.calls.length,2);
  assert.ok(h.listSnapshots.every(rows=>rows.length===1));
  assert.equal(h.api.allOriginals("M-target")[0].active,1);
  assert.equal(h.renders.at(-1).status,"mismatch");
  assert.equal(h.state.detailCache["M-target"],undefined);
});

test("a newer timestamp is required before an HTTP detail can change the current active/inactive state",async()=>{
  const current=original({lastCheckedAt:"2026-10-14T03:00:00Z"});
  const ended=original({lastCheckedAt:"2026-10-15T03:00:00Z",active:0,candidateEligible:true,availabilityKind:"census_missing"});
  const h=harness([[ended]],{"M-target":[current]});
  await h.api.open("M-target");
  assert.equal(h.calls.length,1);
  assert.equal(h.w.currentItems.length,0);
  assert.equal(h.api.allOriginals("M-target")[0].active,0);
  assert.equal(h.renders.at(-1).status,"unavailable");
});

test("an older active detail cannot resurrect a currently confirmed inactive advertisement",async()=>{
  const current=original({lastCheckedAt:"2026-10-15T03:00:00Z",active:0,candidateEligible:true,availabilityKind:"census_missing"});
  const old=original({lastCheckedAt:"2026-10-14T03:00:00Z"});
  const h=harness([[old],[old]],{"M-target":[current]});
  h.w.doneOnly=true;h.w.hideDone=false;h.w.applyFilter();
  await h.api.open("M-target");
  assert.equal(h.calls.length,2);
  assert.equal(h.api.allOriginals("M-target")[0].active,0);
  assert.equal(h.w.currentItems.length,1);
  assert.equal(h.renders.at(-1).status,"mismatch");
});

test("a generic photo load failure is not mislabeled as an advertisement with zero photos",()=>{
  const h=harness([]);
  let markup="";
  const parent={classList:{remove(){},add(){}},querySelector(){return null;},insertAdjacentHTML(_position,html){markup=html;}};
  h.api.imageError({parentElement:parent,remove(){}},true);
  assert.match(markup,/사진 조회 실패/);
  assert.doesNotMatch(markup,/사진 없음/);
  assert.equal(h.calls.length,0);
});

test("a card with declared photos but no compact URL says checking rather than claiming zero photos",()=>{
  const h=harness([],{"M-target":[original({photoCount:7})]});
  const html=h.api.cardParts(h.w.currentItems[0]).thumbnail;
  assert.match(html,/사진 확인 중/);
  assert.doesNotMatch(html,/사진 없음/);
  assert.equal(h.calls.length,0,"The honest placeholder adds no per-card background requests");
});

test("detail photo placeholders distinguish initial lookup, unavailable URLs and genuine zero photos",()=>{
  const h=harness([]);
  h.state.detailStatus["M-target"]="pending";
  assert.equal(h.detailPhotoPlaceholder("M-target",7),"사진 확인 중");
  h.state.detailStatus["M-target"]="";
  assert.equal(h.detailPhotoPlaceholder("M-target",7),"사진 조회 불가");
  assert.equal(h.detailPhotoPlaceholder("M-target",0),"등록된 사진 없음");
});

test("a cached partial sibling set cannot remove a current active source before one forced current read",async()=>{
  const first=original({originalId:"current-A",providerSourceId:"1111111111",lastCheckedAt:"2026-10-15T03:00:00Z"});
  const selected=original({originalId:"selected-B",providerSourceId:"2222222222",lastCheckedAt:"2026-10-15T02:00:00Z"});
  const h=harness([[selected],[selected]],{"M-target":[first,selected]});
  await h.api.open("M-target","selected-B");
  assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls[1].knownIds,["current-A","selected-B"],
    "The unforced partial response must not delete sibling A before cache-bypassing verification");
  assert.equal(h.calls[1].options.headers["X-JS-Force-Refresh"],"1");
  assert.deepEqual(Array.from(h.api.allOriginals("M-target"),row=>row.originalId),["selected-B"],
    "Only the forced current response may replace the complete known source set");
  assert.equal(h.renders.at(-1).selected,"selected-B");
});

test("failed forced verification of a partial sibling set keeps every current source and reports uncertainty",async()=>{
  const first=original({originalId:"current-A",providerSourceId:"1111111111",lastCheckedAt:"2026-10-15T03:00:00Z"});
  const selected=original({originalId:"selected-B",providerSourceId:"2222222222",lastCheckedAt:"2026-10-15T02:00:00Z"});
  const h=harness([[selected],new Error("Fixture offline")],{"M-target":[first,selected]});
  await h.api.open("M-target","selected-B");
  assert.equal(h.calls.length,2);
  assert.deepEqual(Array.from(h.api.allOriginals("M-target"),row=>row.originalId),["current-A","selected-B"]);
  assert.equal(h.renders.at(-1).selected,"selected-B");
  assert.equal(h.renders.at(-1).status,"error");
});

test("an old complete snapshot does not falsely certify a newly arrived CSV property's missing metadata",()=>{
  const h=harness([],{});
  assert.equal(h.state.loaded,true);
  assert.equal(h.item.unifiedOriginalMetadataPendingV1,false);
  const newcomer=master({propertyId:"M-new",key:"new-saved-key"});
  h.w.allItems.push(newcomer);
  h.api.attach(h.w.allItems);
  h.w.applyFilter();
  assert.equal(newcomer.unifiedOriginalMetadataPendingV1,true);
  const card=h.api.cardParts(h.w.currentItems.find(item=>item.propertyId==="M-new"));
  assert.match(card.thumbnail,/원본 확인 중/);
  assert.doesNotMatch(card.thumbnail,/사진 없음/);
  assert.equal(h.item.unifiedOriginalMetadataPendingV1,false,"The genuinely verified source-less older record stays ready");
});

test("a newly arrived source-less manual property becomes ready only after its matching complete result is attached",()=>{
  const h=harness([],{});
  const newcomer=master({propertyId:"M-manual",source:"직접등록"});
  h.w.allItems.push(newcomer);
  h.api.attach(h.w.allItems);
  assert.equal(newcomer.unifiedOriginalMetadataPendingV1,true);
  h.api.attach(h.w.allItems,{ok:true,groups:{}});
  h.w.applyFilter();
  assert.equal(newcomer.unifiedOriginalMetadataPendingV1,false);
  assert.equal(newcomer.unifiedOriginalCountV8,1);
  assert.match(h.api.cardParts(h.w.currentItems.find(item=>item.propertyId==="M-manual")).thumbnail,/사진 없음/);
});

test("forced verification cannot mistake an in-flight normal prefetch for a cache-bypassing response",async()=>{
  const first=original({originalId:"current-A",providerSourceId:"1111111111",lastCheckedAt:"2026-10-15T03:00:00Z"});
  const selected=original({originalId:"selected-B",providerSourceId:"2222222222",lastCheckedAt:"2026-10-15T02:00:00Z"});
  let release;
  const normal=new Promise(resolve=>{release=resolve;});
  const h=harness([normal,[selected]],{"M-target":[first,selected]});
  const prefetch=h.loadDetail("M-target");
  const forced=h.loadDetail("M-target",true);
  const duplicateForced=h.loadDetail("M-target",true);
  assert.equal(h.calls.length,1);
  release([selected]);
  await Promise.all([prefetch,forced,duplicateForced]);
  assert.equal(h.calls.length,2,"Several forced waiters share one real forced read after the normal request settles");
  assert.equal(h.calls[1].options.headers["X-JS-Force-Refresh"],"1");
});
