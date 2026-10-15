const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const key = number => "sha256-v1:" + String(number).padStart(64, "0");
function master(id, proof = key(1)) {
  return {propertyId:id,sourceSnapshotKey:proof,key:"favorite-"+id,memo:"보존 메모",room:"호실 미입력",
    state:"active",source:"네이버",deposit:1000,rent:60,area:23.2};
}
function original(id, extra={}) {
  return {propertyId:id,originalId:"source-"+id,source:"네이버",providerSourceId:"123-"+id,active:1,
    availabilityKind:"active",candidateEligible:false,deposit:1000,rent:60,area:23.2,
    thumbnail:"https://example.invalid/"+id+".jpg",photoCount:1,...extra};
}
function result(entries, extra={}) {
  const groups={},sourceSnapshotKeys={},sourceSnapshotPropertyIds={},sourceSearchIds={};
  for (const [internalId, publicId, proof, rows] of entries) {
    sourceSnapshotKeys[internalId]=proof;sourceSnapshotPropertyIds[internalId]=publicId;
    groups[internalId]=rows;sourceSearchIds[internalId]=["naver:123-"+internalId];
  }
  return {ok:true,groups,sourceSnapshotKeys,sourceSnapshotPropertyIds,sourceSearchIds,snapshotRevision:"unrelated-global-new",...extra};
}
function harness(items) {
  const events=[],nodes=new Map(),reads=[];
  const parent={insertBefore(node){nodes.set(node.id,node);node.parentNode=parent;}};
  nodes.set("status",{parentNode:parent,nextSibling:null});
  const document={addEventListener(){},getElementById(id){return nodes.get(id)||null;},createElement(tag){
    return {tag,children:[],setAttribute(){},appendChild(child){this.children.push(child);},
      querySelector(name){return this.children.find(child=>child.tag===name)||null;},remove(){nodes.delete(this.id);}};
  }};
  const w={innerWidth:1280,allItems:items,currentItems:[],hideDone:true,doneOnly:false,addEventListener(){},
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},dispatchEvent(event){events.push(event);},
    JSDataAccessV6:{read(action,params,options){reads.push({action,params,options});return Promise.resolve({ok:true,groups:{}});}}};
  vm.runInNewContext(source.replace("global.JSUnifiedListingsV8 = {","global.__test={state:state,synchronizeDetailOriginals:synchronizeDetailOriginals}; global.JSUnifiedListingsV8 = {"),
    {window:w,document,console:{warn(){},error(){}}});
  w.JSUnifiedListingsV8.attach(items);
  events.length=0;
  return {w,api:w.JSUnifiedListingsV8,state:w.__test.state,events,nodes,reads};
}
function plain(value){return JSON.parse(JSON.stringify(value));}
function saved(item){const {propertyId,key,memo,room,state,deposit,rent}=item;return {propertyId,key,memo,room,state,deposit,rent};}

test("matching per-property proofs connect photos despite unrelated global revision changes",()=>{
  const item=master("public-A"),before=saved(item),h=harness([item]);
  const response=result([["internal-A","public-A",key(1),[original("internal-A")]]]);
  const attached=h.api.attachCompatible([item],response);
  assert.deepEqual(plain(attached),{proofSupported:true,matchedCount:1,matchedIds:["public-A"],pendingIds:[],unknownIds:[],complete:true});
  assert.equal(h.api.allOriginals("public-A")[0].propertyId,"public-A");
  assert.equal(response.groups["internal-A"][0].propertyId,"internal-A","Do not rewrite the response's parent identity");
  assert.match(h.api.cardParts(item).thumbnail,/internal-A\.jpg/);
  assert.deepEqual(Array.from(item.sourceListingSearchV6579),["naver:123-internal-A"]);
  assert.deepEqual(saved(item),before);
  assert.equal(h.state.snapshotRevision,"");
  assert.equal(h.api.getOriginalMetadataStatus().status,"ready");
  assert.equal(h.reads.length,0);
});

test("partial proof matches preserve known candidates/photos and leave only unknown changed properties pending",()=>{
  const a=master("A"),b=master("B"),c=master("C"),h=harness([a,b,c]);
  const candidate=original("A",{active:0,candidateEligible:true,availabilityKind:"legacy_candidate"});
  h.api.attach([a,b],{ok:true,groups:{A:[candidate]},sourceSearchIds:{A:["naver:old-A"]},snapshotRevision:"old"});
  const attached=h.api.attachCompatible([a,b,c],result([
    ["A","A",key(2),[original("A")]], ["B","B",key(1),[original("B")]], ["C","C",key(2),[original("C")]]
  ]));
  assert.deepEqual(plain(attached),{proofSupported:true,matchedCount:1,matchedIds:["B"],pendingIds:["A","C"],unknownIds:["C"],complete:false});
  assert.equal(h.api.allOriginals("A")[0],candidate);
  assert.equal(a.unifiedCandidateOriginalCountV2,1);
  assert.deepEqual(Array.from(a.sourceListingSearchV6579),["naver:old-A"]);
  assert.match(h.api.cardParts(b).thumbnail,/B\.jpg/);
  assert.match(h.api.cardParts(c).thumbnail,/사진 불러오는 중/);
  assert.equal(h.nodes.has("unifiedOriginalLoadStatusV1"),false);
  assert.equal(h.api.getOriginalMetadataStatus().pendingCount,2);
  assert.equal(h.reads.length,0);
});

test("a source-less property needs an exact proof, explicit identity mapping and an explicit empty group",()=>{
  const item=master("A"),h=harness([item]);
  const missing=result([["A","A",key(1),[]]]);delete missing.groups.A;
  assert.equal(h.api.attachCompatible([item],missing).complete,false);
  assert.equal(h.api.getOriginalMetadataStatus("A").ready,false);
  const attached=h.api.attachCompatible([item],result([["A","A",key(1),[]]]));
  assert.equal(attached.complete,true);
  assert.equal(h.api.getOriginalMetadataStatus("A").ready,true);
  assert.equal(item.unifiedOriginalMetadataPendingV1,false);
  assert.match(h.api.cardParts(item).thumbnail,/사진 없음/);
});

test("legacy responses without proof maps cannot impersonate a compatible full snapshot",()=>{
  const item=master("A"),h=harness([item]);
  const attached=h.api.attachCompatible([item],{ok:true,groups:{A:[original("A")]},snapshotRevision:"same-global"});
  assert.deepEqual(plain(attached),{proofSupported:false,matchedCount:0,matchedIds:[],pendingIds:["A"],unknownIds:["A"],complete:false});
  assert.equal(h.api.allOriginals("A").length,0);
  assert.equal(h.state.snapshotRevision,"");
});

test("noncanonical, empty and unequal proof keys are never accepted",()=>{
  for(const proof of ["", "0".repeat(64),"sha256-v2:"+"0".repeat(64),"sha256-v1:"+"A".repeat(64)," "+key(1),key(2)]) {
    const item=master("A",proof),h=harness([item]);
    assert.equal(h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]])).matchedCount,0,proof);
    assert.equal(h.api.allOriginals("A").length,0);
  }
});

test("ambiguous public parent mappings reject every competing original group",()=>{
  const item=master("A"),h=harness([item]);
  const attached=h.api.attachCompatible([item],result([
    ["internal-1","A",key(1),[original("internal-1")]], ["internal-2","A",key(1),[original("internal-2")]]
  ]));
  assert.equal(attached.matchedCount,0);
  assert.deepEqual(Array.from(attached.pendingIds),["A"]);
  assert.equal(h.api.allOriginals("A").length,0);
});

test("a foreign original parent cannot be laundered through an otherwise matching proof",()=>{
  const item=master("A"),h=harness([item]);
  const attached=h.api.attachCompatible([item],result([["internal-A","A",key(1),[original("some-other-building")]]]));
  assert.equal(attached.matchedCount,0);
  assert.equal(h.api.allOriginals("A").length,0);
});

test("duplicate CSV public IDs are not arbitrarily attached to one of the duplicate masters",()=>{
  const items=[master("A"),master("A")],h=harness(items);
  const attached=h.api.attachCompatible(items,result([["A","A",key(1),[original("A")]]]));
  assert.equal(attached.matchedCount,0);
  assert.equal(attached.complete,false);
  assert.deepEqual(Array.from(attached.pendingIds),["A"]);
});

test("scoped success resolves only its own pending IDs and cannot falsely mark other changed groups ready",()=>{
  const items=[master("A"),master("B"),master("C")],h=harness(items);
  h.api.attachCompatible(items,result([["A","A",key(1),[original("A")]]]));
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()),["B","C"]);
  let attached=h.api.attachCompatible([items[1]],result([["B","B",key(1),[original("B")]]]),{scoped:true});
  assert.equal(attached.complete,false);
  assert.deepEqual(Array.from(attached.matchedIds),["B"]);
  assert.deepEqual(Array.from(attached.pendingIds),["C"]);
  assert.equal(h.api.getOriginalMetadataStatus().status,"pending");
  assert.equal(h.api.getOriginalMetadataStatus().pendingCount,1);
  attached=h.api.attachCompatible([items[2]],result([["C","C",key(1),[original("C")]]]),{scoped:true});
  assert.equal(attached.complete,true);
  assert.equal(h.api.getOriginalMetadataStatus().status,"ready");
  assert.equal(h.api.getOriginalMetadataStatus().pendingCount,0);
  assert.equal(h.nodes.has("unifiedOriginalLoadStatusV1"),false);
  assert.equal(h.state.snapshotRevision,"");
  assert.deepEqual(h.events.map(event=>event.detail.pendingCount),[2,1,0]);
  assert.equal(h.reads.length,0);
});

test("a failed scoped subset preserves previous group data, source index and the other pending IDs",()=>{
  const items=[master("A"),master("B")],h=harness(items);
  h.api.attach(items,{ok:true,groups:{A:[original("A")]},sourceSearchIds:{A:["naver:old"]}});
  h.api.attachCompatible(items,result([]));
  const attached=h.api.attachCompatible([items[0]],{ok:false,groups:{}},{scoped:true});
  assert.deepEqual(Array.from(attached.pendingIds),["A","B"]);
  assert.equal(h.api.allOriginals("A").length,1);
  assert.deepEqual(Array.from(items[0].sourceListingSearchV6579),["naver:old"]);
  assert.equal(h.api.getOriginalMetadataStatus("A").hasKnownData,true);
});

test("unchanged proofs retain fresh detail caches; a changed matching proof invalidates only that property",()=>{
  const items=[master("A"),master("B")],h=harness(items);
  const full=result([["A","A",key(1),[original("A")]], ["B","B",key(1),[original("B")]]]);
  h.api.attachCompatible(items,full);
  h.state.detailCache.A=[original("A")];h.state.detailCache.B=[original("B")];
  const savedA=h.state.detailCache.A,savedB=h.state.detailCache.B;
  h.api.attachCompatible(items,full);
  assert.equal(h.state.detailCache.A,savedA);assert.equal(h.state.detailCache.B,savedB);
  items[0].sourceSnapshotKey=key(2);
  h.api.attachCompatible(items,result([["A","A",key(2),[original("A",{rent:70})]], ["B","B",key(1),[original("B")]]]));
  assert.equal(h.state.detailCache.A,undefined);assert.equal(h.state.detailCache.B,savedB);
  assert.equal(h.api.allOriginals("A")[0].rent,70);
  assert.equal(items[0].rent,60,"Only the projected advertisement conditions change");
});

test("compact response expansion preserves proof maps and explicitly remaps the decoded original parent",()=>{
  const item=master("public-A"),h=harness([item]);
  const attached=h.api.attachCompatible([item],{ok:true,format:"compact-v2",fields:["originalId","source","active","thumbnail"],
    groups:{"internal-A":[["original-1","네이버",1,"https://example.invalid/compact.jpg"]]},
    sourceSnapshotKeys:{"internal-A":key(1)},sourceSnapshotPropertyIds:{"internal-A":"public-A"}});
  assert.equal(attached.complete,true);
  assert.equal(h.api.allOriginals("public-A")[0].propertyId,"public-A");
  assert.match(h.api.cardParts(item).thumbnail,/compact\.jpg/);
});

test("pending compatible IDs remain available to recovery without rendering or triggering a global retry control",()=>{
  const item=master("A"),h=harness([item]);h.api.attachCompatible([item],result([]));
  let recoveries=0;
  h.w.JSListingRefreshV1={recoverOriginals(){recoveries+=1;return Promise.resolve();}};
  h.api.markSnapshotStale();
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()),["A"]);
  assert.equal(h.api.getOriginalMetadataStatus("A").retryable,true);
  assert.equal(h.nodes.has("unifiedOriginalLoadStatusV1"),false);
  assert.equal(recoveries,0);assert.equal(h.reads.length,0);
  h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]]),{scoped:true});
  assert.equal(h.api.getOriginalMetadataStatus("A").ready,true);
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()),[]);
  assert.match(h.api.cardParts(item).thumbnail,/A\.jpg/);
});

test("a fresh detail invalidates its old proof and an equal-proof old full response cannot relabel the newer group",()=>{
  const item=master("A"),h=harness([item]);
  const old=original("A",{lastCheckedAt:"2026-10-15T01:00:00Z",rent:60});
  const full=result([["A","A",key(1),[old]]]);
  h.api.attachCompatible([item],full);
  assert.equal(h.api.canCacheCompatible([item]),true);
  const fresh=original("A",{lastCheckedAt:"2026-10-15T02:00:00Z",rent:75});
  h.w.__test.synchronizeDetailOriginals("A",[fresh]);
  assert.equal(h.state.sourceSnapshotProofKeys.A,undefined);
  assert.equal(h.api.canCacheCompatible([item]),false);
  const attached=h.api.attachCompatible([item],full);
  assert.equal(attached.complete,false);
  assert.deepEqual(Array.from(attached.pendingIds),["A"]);
  assert.equal(h.api.allOriginals("A")[0],fresh);
  assert.equal(h.api.allOriginals("A")[0].rent,75);
  assert.equal(h.state.sourceSnapshotProofKeys.A,undefined);
  assert.equal(h.api.canCacheCompatible([item]),false);
});

test("a changed-proof old full response and an old fresh-scoped response cannot regress current source timestamps",()=>{
  const item=master("A"),h=harness([item]);
  const fresh=original("A",{lastCheckedAt:"2026-10-15T02:00:00Z"});
  h.api.attachCompatible([item],result([["A","A",key(1),[fresh]]]));
  item.sourceSnapshotKey=key(2);
  const old=result([["A","A",key(2),[original("A",{lastCheckedAt:"2026-10-15T01:00:00Z",active:0})]]]);
  assert.equal(h.api.attachCompatible([item],old).matchedCount,0);
  assert.equal(h.api.attachCompatible([item],old,{scoped:true,scopedFresh:true}).matchedCount,0);
  assert.equal(h.api.allOriginals("A")[0].active,1);
  assert.equal(h.api.allOriginals("A")[0].lastCheckedAt,"2026-10-15T02:00:00Z");
});

test("only fresh scoped inventory may remove a known sibling and certify the remaining matching group",()=>{
  const item=master("A"),h=harness([item]),time="2026-10-15T02:00:00Z";
  const a=original("A",{lastCheckedAt:time}),b=original("A",{originalId:"sibling-B",providerSourceId:"B",lastCheckedAt:time});
  h.api.attachCompatible([item],result([["A","A",key(1),[a,b]]]));
  item.sourceSnapshotKey=key(2);
  const reduced=result([["A","A",key(2),[a]]]);
  assert.equal(h.api.attachCompatible([item],reduced).matchedCount,0);
  assert.equal(h.api.allOriginals("A").length,2);
  assert.equal(h.api.canCacheCompatible([item]),false);
  assert.equal(h.api.attachCompatible([item],reduced,{scoped:true}).matchedCount,0);
  const verified=h.api.attachCompatible([item],reduced,{scoped:true,scopedFresh:true});
  assert.equal(verified.complete,true);
  assert.equal(h.api.allOriginals("A").length,1);
  assert.equal(h.api.canCacheCompatible([item]),true);
});

test("fresh scoped zero-source inventory can clear a former source group but ordinary full empty cannot",()=>{
  const item=master("A"),h=harness([item]);
  h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]]));
  item.sourceSnapshotKey=key(2);
  const empty=result([["A","A",key(2),[]]]);
  assert.equal(h.api.attachCompatible([item],empty).complete,false);
  assert.equal(h.api.allOriginals("A").length,1);
  assert.equal(h.api.attachCompatible([item],empty,{scoped:true,scopedFresh:true}).complete,true);
  assert.equal(h.api.allOriginals("A").length,0);
  assert.equal(h.api.canCacheCompatible([item]),true);
});

test("even a fresh scoped response cannot reverse availability without a newer checked timestamp",()=>{
  const item=master("A"),h=harness([item]),time="2026-10-15T02:00:00Z";
  h.api.attachCompatible([item],result([["A","A",key(1),[original("A",{lastCheckedAt:time})]]]));
  item.sourceSnapshotKey=key(2);
  const changed=result([["A","A",key(2),[original("A",{active:0,lastCheckedAt:time,candidateEligible:true,availabilityKind:"census_missing"})]]]);
  assert.equal(h.api.attachCompatible([item],changed,{scoped:true,scopedFresh:true}).matchedCount,0);
  assert.equal(h.api.allOriginals("A")[0].active,1);
  changed.groups.A[0].lastCheckedAt="2026-10-15T03:00:00Z";
  assert.equal(h.api.attachCompatible([item],changed,{scoped:true,scopedFresh:true}).complete,true);
  assert.equal(h.api.allOriginals("A")[0].active,0);
});

test("legacy scoped merges invalidate compatible proof without certifying their groups for pair cache",()=>{
  const item=master("A"),h=harness([item]);
  h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]]));
  assert.equal(h.api.canCacheCompatible([item]),true);
  h.api.mergeScoped({ok:true,groups:{A:[original("A",{rent:77})]}});
  assert.equal(h.state.sourceSnapshotProofKeys.A,undefined);
  assert.equal(h.api.canCacheCompatible([item]),false);
  assert.equal(h.api.allOriginals("A")[0].rent,77);
});

test("cache compatibility checks each current CSV item and disallow legacy, duplicate and pending inputs",()=>{
  const item=master("A"),h=harness([item]);
  assert.equal(h.api.canCacheCompatible([item]),false);
  h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]]));
  assert.equal(h.api.canCacheCompatible([item]),true);
  assert.equal(h.api.canCacheCompatible([item,item]),false);
  assert.equal(h.api.canCacheCompatible([{...item,sourceSnapshotKey:key(2)}]),false);
  assert.equal(h.api.canCacheCompatible([{...item,sourceSnapshotKey:""}]),false);
  h.api.markSnapshotStale();
  assert.equal(h.api.canCacheCompatible([item]),false);
});

test("compatibility preflight never mutates groups, keys, items, pending requests or global readiness",()=>{
  const item=master("A"),h=harness([item]),before=JSON.stringify(item);
  const groups=h.state.groups,coverage=h.state.metadataCoverage,pending=h.state.pendingProofIds;
  let invalidations=0;h.w.JSDataAccessV6.invalidateRead=()=>{invalidations+=1;};
  const checked=h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]]),
    {scoped:true,scopedFresh:true,validateOnly:true,preserveGlobalStatus:true,supersedePending:true});
  assert.equal(checked.matchedCount,1);assert.equal(checked.complete,true);
  assert.equal(h.state.groups,groups);assert.equal(h.state.metadataCoverage,coverage);assert.equal(h.state.pendingProofIds,pending);
  assert.equal(h.state.sourceSnapshotProofKeys.A,undefined);assert.equal(h.state.loaded,false);
  assert.equal(h.api.getOriginalMetadataStatus().status,"pending");assert.equal(JSON.stringify(item),before);
  assert.equal(h.events.length,0);assert.equal(invalidations,0);
});

test("a verified Today subset preserves global load phase and other original groups",()=>{
  const items=[master("A"),master("B")],h=harness(items);
  const accepted=h.api.attachCompatible([items[0]],result([["A","A",key(1),[original("A")]]]),
    {scoped:true,scopedFresh:true,preserveGlobalStatus:true});
  assert.equal(accepted.matchedCount,1);
  assert.equal(h.state.loaded,false);assert.equal(h.api.getOriginalMetadataStatus().status,"pending");
  assert.equal(h.api.getOriginalMetadataStatus("A").ready,true);assert.equal(h.api.getOriginalMetadataStatus("B").ready,false);
  assert.match(h.api.cardParts(items[0]).thumbnail,/A\.jpg/);
  assert.equal(h.api.canCacheCompatible(items),false);
  h.api.attachCompatible(items,result([["A","A",key(1),[original("A")]], ["B","B",key(1),[original("B")]]]));
  h.api.markSnapshotStale();
  assert.equal(h.nodes.has("unifiedOriginalLoadStatusV1"),false);
  h.api.attachCompatible([items[0]],result([["A","A",key(1),[original("A")]]]),{scoped:true,preserveGlobalStatus:true});
  assert.equal(h.api.getOriginalMetadataStatus().status,"stale");
  assert.equal(h.nodes.has("unifiedOriginalLoadStatusV1"),false);
  assert.equal(h.api.allOriginals("B").length,1);
});

test("a committed compatible subset supersedes an old pending full response without letting its failure change phase",async()=>{
  const item=master("A"),h=harness([item]);let reject;
  h.w.JSDataAccessV6.read=()=>new Promise((_yes,no)=>{reject=no;});
  const pending=h.api.load(true,{deferCommit:true});
  const generation=h.state.loadGeneration;
  h.api.attachCompatible([item],result([["A","A",key(1),[original("A")]]]),
    {scoped:true,scopedFresh:true,preserveGlobalStatus:true,supersedePending:true});
  assert.equal(h.state.loadGeneration,generation+1);
  reject(new Error("old request offline"));
  assert.equal((await pending).superseded,true);
  assert.equal(h.api.getOriginalMetadataStatus().status,"pending");
  assert.match(h.api.cardParts(item).thumbnail,/A\.jpg/);
  assert.equal(h.nodes.has("unifiedOriginalLoadStatusV1"),false);
});
