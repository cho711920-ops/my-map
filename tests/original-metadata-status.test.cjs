const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const test=require("node:test");
const source=fs.readFileSync("js/unified-listings-v8.js","utf8");

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(options={}){
  const reads=[],events=[];
  const item={propertyId:"M-one",key:"favorite-preserved-key",memo:"보존 메모",state:"active",source:"네이버",deposit:1000,rent:60,area:23.2};
  const document=options.document||{getElementById(){return null;},addEventListener(){}};
  const w={innerWidth:1280,allItems:[item],currentItems:[],hideDone:true,doneOnly:false,addEventListener(){},
    CustomEvent:class {constructor(type,init){this.type=type;this.detail=init.detail;}},
    dispatchEvent(event){events.push(event);},
    JSDataAccessV6:{read(action,params,options){const call={action,params,options,...deferred()};reads.push(call);return call.promise;}}};
  vm.runInNewContext(source,{window:w,document,console:{error(){},warn(){}}});
  const api=w.JSUnifiedListingsV8;api.attach([item]);events.length=0;
  return {api,w,item,reads,events};
}
function original(extra={}){return {originalId:"source-one",propertyId:"M-one",source:"네이버",active:1,
  candidateEligible:false,availabilityKind:"active",deposit:1000,rent:60,area:23.2,
  thumbnail:"https://example.invalid/current.jpg",photoCount:1,...extra};}
function status(api,id){return JSON.parse(JSON.stringify(api.getOriginalMetadataStatus(id)));}

function bannerDocument({chips=true,list=true,statusNode=true}={}){
  const created=[];
  const document={addEventListener(){},createElement(tag){const element=node(tag);created.push(element);return element;},getElementById(id){return find(root,id);}};
  function node(tag,id=""){
    return {tag,id,children:[],parentNode:null,
      get nextSibling(){if(!this.parentNode)return null;const siblings=this.parentNode.children;return siblings[siblings.indexOf(this)+1]||null;},
      setAttribute(){},appendChild(child){return this.insertBefore(child,null);},
      insertBefore(child,before){if(child===before)return child;child.remove();const index=before?this.children.indexOf(before):this.children.length;assert.notEqual(index,-1);this.children.splice(index,0,child);child.parentNode=this;return child;},
      remove(){if(!this.parentNode)return;const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;},
      querySelector(tagName){return this.children.find(child=>child.tag===tagName)||null;}};
  }
  function find(current,id){if(current.id===id)return current;for(const child of current.children){const found=find(child,id);if(found)return found;}return null;}
  const root=node("body"),sidebar=node("div","sidebar");root.appendChild(sidebar);
  if(chips)sidebar.appendChild(node("div","activeFilterChipsV844"));
  sidebar.appendChild(node("div","selectionActionBar"));
  if(list)sidebar.appendChild(node("div","list"));
  if(statusNode)root.appendChild(node("div","status"));
  return {document,root,sidebar,created};
}

test("cold metadata pending is explicit and does not make a per-card request",()=>{
  const h=harness();
  assert.deepEqual(status(h.api,"M-one"),{status:"pending",ready:false,hasKnownData:false,retryable:false,pendingCount:1});
  assert.match(h.api.cardParts(h.item).thumbnail,/사진 불러오는 중/);
  assert.equal(h.reads.length,0);
});

test("failed full metadata load changes unknown cards from perpetual pending to visible failure and retry",async()=>{
  const h=harness(),saved=JSON.stringify(h.item);
  const pending=h.api.load(true,{deferCommit:true});
  assert.equal(h.reads.length,1);
  h.reads[0].reject(new Error("Fixture upstream error"));
  const result=await pending;
  assert.equal(result.ok,false);
  assert.deepEqual(status(h.api,"M-one"),{status:"error",ready:false,hasKnownData:false,retryable:true,pendingCount:1});
  const card=h.api.cardParts(h.item);
  assert.match(card.thumbnail,/사진 불러오기 실패/);
  assert.match(card.badge,/다시 불러오기/);
  assert.match(card.sourceButton,/JSUnifiedListingsV8\.open/);
  assert.doesNotMatch(card.thumbnail,/사진 불러오는 중|사진 없음/);
  assert.equal(h.reads.length,1,"No implicit full retry or card-prefetch storm is added");
  assert.equal(JSON.stringify(h.item),saved);
});

test("a failed refresh preserves every known source, candidate, photo and canonical user value",async()=>{
  const h=harness();
  const live=original(),candidate=original({originalId:"ended-one",active:0,candidateEligible:true,availabilityKind:"legacy_candidate"});
  h.api.attach([h.item],{ok:true,groups:{"M-one":[live,candidate]},snapshotRevision:"good-revision"});
  const before={key:h.item.key,memo:h.item.memo,state:h.item.state,deposit:h.item.deposit,rent:h.item.rent};
  const pending=h.api.load(true);
  h.reads[0].reject(new Error("Fixture offline"));
  const result=await pending;
  assert.equal(result.stale,true);
  assert.deepEqual(status(h.api),{status:"error",ready:true,hasKnownData:true,retryable:true,pendingCount:0});
  assert.deepEqual(Array.from(h.api.allOriginals("M-one"),row=>row.originalId),["source-one","ended-one"]);
  assert.match(h.api.cardParts(h.item).thumbnail,/current\.jpg/);
  assert.equal(h.item.unifiedCandidateOriginalCountV2,1);
  assert.deepEqual({key:h.item.key,memo:h.item.memo,state:h.item.state,deposit:h.item.deposit,rent:h.item.rent},before);
  assert.equal(h.reads.length,1);
});

test("deferred success is not a committed ready snapshot until the matching result is attached",async()=>{
  const h=harness();
  const pending=h.api.load(true,{deferCommit:true});
  h.reads[0].resolve({ok:true,groups:{"M-one":[original()]},snapshotRevision:"fresh-revision"});
  const result=await pending;
  assert.equal(status(h.api).status,"pending");
  assert.equal(status(h.api,"M-one").ready,false);
  h.api.attach([h.item],result);
  assert.deepEqual(status(h.api,"M-one"),{status:"ready",ready:true,hasKnownData:true,retryable:false,pendingCount:0});
  assert.match(h.api.cardParts(h.item).thumbnail,/current\.jpg/);
});

test("revision mismatch marks unknown cards stale while preserving the last committed groups",()=>{
  const h=harness();
  h.api.attach([h.item],{ok:true,groups:{"M-one":[original()]},snapshotRevision:"good-revision"});
  const newItem={...h.item,propertyId:"M-new"};delete newItem.unifiedAllOriginalsV1;delete newItem.unifiedDisplayOriginalsV2;
  h.w.allItems.push(newItem);h.api.attach(h.w.allItems);
  h.api.markSnapshotStale();
  assert.deepEqual(status(h.api,"M-new"),{status:"stale",ready:false,hasKnownData:false,retryable:true,pendingCount:1});
  assert.equal(status(h.api,"M-one").ready,true);
  assert.match(h.api.cardParts(newItem).thumbnail,/사진 불러오기 지연/);
  assert.match(h.api.cardParts(h.item).thumbnail,/current\.jpg/);
  assert.equal(h.reads.length,0);
});

test("a successful retry clears error status and the full-result coverage still distinguishes genuine zero",async()=>{
  const h=harness();
  let pending=h.api.load(true,{deferCommit:true});h.reads[0].reject(new Error("Fixture failure"));await pending;
  pending=h.api.load(true,{deferCommit:true});
  assert.equal(status(h.api,"M-one").status,"pending");
  h.reads[1].resolve({ok:true,groups:{},snapshotRevision:"verified-empty-sources"});
  h.api.attach([h.item],await pending);
  assert.equal(status(h.api,"M-one").status,"ready");
  assert.equal(status(h.api,"M-one").ready,true);
  assert.match(h.api.cardParts(h.item).thumbnail,/사진 없음/);
  assert.equal(h.reads.length,2);
});

test("status events contain only readiness flags and never trigger automatic network work",()=>{
  const h=harness();
  h.api.markSnapshotStale();h.api.markSnapshotStale();
  assert.equal(h.events.length,1);
  assert.equal(h.events[0].type,"js-original-metadata-status");
  assert.deepEqual(Object.keys(h.events[0].detail).sort(),["hasKnownData","pendingCount","ready","retryable","status"]);
  assert.equal(h.events[0].detail.status,"stale");
  assert.equal(h.reads.length,0);
});

test("main, Today and completed-list views keep metadata readiness without rendering a bulk status or retry strip",()=>{
  for(const mode of ["main","today","completed"]){
    const dom=bannerDocument(),h=harness({document:dom.document});
    h.w.doneOnly=mode==="completed";h.w.newListingDays=mode==="today"?1:0;
    const before=dom.sidebar.children.slice();
    h.api.markSnapshotStale();
    assert.equal(dom.document.getElementById("unifiedOriginalLoadStatusV1"),null,mode);
    assert.deepEqual(dom.sidebar.children,before);
    assert.equal(dom.created.length,0);
    assert.equal(status(h.api,"M-one").status,"stale");
    assert.equal(h.events[0].type,"js-original-metadata-status");
    assert.equal(h.reads.length,0);
  }
});

test("an existing legacy-position bulk status is removed instead of moved or recreated",()=>{
  for(const parent of ["root","sidebar"]){
    const dom=bannerDocument(),h=harness({document:dom.document});
    const legacy=dom.document.createElement("div");legacy.id="unifiedOriginalLoadStatusV1";
    dom[parent].appendChild(legacy);
    const before=dom.created.length;
    h.api.markSnapshotStale();h.api.markSnapshotStale();
    assert.equal(legacy.parentNode,null);
    assert.equal(dom.document.getElementById("unifiedOriginalLoadStatusV1"),null);
    assert.equal(dom.created.length,before);
    assert.equal(h.events.length,1);
    assert.equal(h.reads.length,0);
  }
});

test("metadata failures and successful recovery never create a global retry strip with or without sidebar anchors",async()=>{
  for(const anchors of [{},{chips:false,statusNode:false},{chips:false,list:false},{chips:false,list:false,statusNode:false}]){
    const dom=bannerDocument(anchors),h=harness({document:dom.document}),before=JSON.stringify(h.item);
    let pending=h.api.load(true,{deferCommit:true});
    h.reads[0].reject(new Error("Fixture offline"));await pending;
    assert.equal(status(h.api,"M-one").status,"error");
    assert.equal(dom.document.getElementById("unifiedOriginalLoadStatusV1"),null);
    assert.match(h.api.cardParts(h.item).thumbnail,/사진 불러오기 실패/);
    assert.equal(JSON.stringify(h.item),before);
    pending=h.api.load(true,{deferCommit:true});
    h.reads[1].resolve({ok:true,groups:{"M-one":[original()]},snapshotRevision:"recovered"});
    h.api.attach([h.item],await pending);
    assert.equal(status(h.api,"M-one").status,"ready");
    assert.match(h.api.cardParts(h.item).thumbnail,/current\.jpg/);
    assert.equal(dom.document.getElementById("unifiedOriginalLoadStatusV1"),null);
    assert.equal(dom.created.length,0);
    assert.equal(h.reads.length,2,"Only the explicitly requested recovery reads occur");
  }
});

test("obsolete bulk metadata strip styles are removed while favorite undo controls retain their styles",()=>{
  const css=fs.readFileSync("css/workflow-safety-v1.css","utf8");
  assert.doesNotMatch(css,/#unifiedOriginalLoadStatusV1/);
  assert.match(css,/#unifiedFavoriteUndoV1\s*\{[^}]*padding:\s*8px 12px/);
  assert.match(css,/#unifiedFavoriteUndoV1 button\s*\{[^}]*min-height:\s*32px/);
});
