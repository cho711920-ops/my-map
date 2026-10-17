import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync('js/map.js','utf8');
const ast=ts.createSourceFile('map.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['drawMapClustersOnlyV639','redrawSelectedMarkers','clearMap']);
const runtime=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
function cluster(key,count=2,lat=36.35,mode=''){
  return {key,regionMode:mode,latlng:{getLat:()=>lat,getLng:()=>127.38},items:Array.from({length:count},(_,i)=>({key:key+'-'+i,done:false}))};
}
function fixture(){
  const events=[],stats={created:0,content:0,position:0},snapshot={selected:null};
  const c={window:null,overlays:[],map:{id:'map'},jsPinnedClusterSelectionV6515:null,isRendering:false,next:[],count:null,
    selected:null,document:{getElementById:()=>({innerHTML:'rows'})},
    captureClusterSelectionSnapshotV638:()=>({...snapshot}),restoreClusterSelectionSnapshotV638(s){c.selected=s.selected;},
    getStableClusterSourceItemsV690:rows=>rows,shouldUseWorldGridClustersV690:()=>true,groupByAddress:rows=>rows,
    createClustersForCurrentZoomV655:()=>c.next,isDone:item=>item.done,isClusterSelected:key=>c.selected===key,
    getFieldVisitClusterClassV684:()=>'',isAdministrativeClusterSelectedV1:cl=>c.selected===cl.key,
    buildClusterOverlayContentV655:(cl,classes)=>cl.key+':'+cl.items.length+':'+classes,
    updateMapListingCountV825:rows=>{c.count=rows.length;},
    kakao:{maps:{CustomOverlay:class{
      constructor(options){stats.created++;this.id=stats.created;this.content=options.content;this.position=options.position;}
      setMap(value){events.push([value?'attach':'detach',this.id]);this.map=value;}
      setContent(value){stats.content++;this.content=value;}
      setPosition(value){stats.position++;this.position=value;}
      setZIndex(value){this.z=value;}
    }}}};
  c.window=c;vm.createContext(c);vm.runInContext(runtime,c);
  function draw(rows){c.next=rows;c.drawMapClustersOnlyV639(rows.flatMap(cl=>cl.items));}
  return {c,events,stats,snapshot,draw};
}
test('idle and pan redraws keep native overlay and content identity for unchanged keys',()=>{
  const f=fixture();f.draw([cluster('world-grid:1280:a'),cluster('world-grid:1280:b')]);
  const before=[...f.c.overlays];f.events.length=0;
  f.draw([cluster('world-grid:1280:a'),cluster('world-grid:1280:b')]);
  assert.equal(f.c.overlays[0],before[0]);assert.equal(f.c.overlays[1],before[1]);
  assert.equal(f.stats.created,2);assert.equal(f.stats.content,0);assert.equal(f.stats.position,0);
  assert.deepEqual(f.events,[]);assert.equal(f.c.count,4);assert.equal(f.c.isRendering,false);
});
test('same-key membership, count, status and display position stay current without detaching',()=>{
  const f=fixture();f.draw([cluster('a')]);const overlay=f.c.overlays[0];f.events.length=0;
  const replacement=cluster('a',3,36.36);replacement.items.forEach(item=>item.done=true);
  f.draw([replacement]);
  assert.equal(f.c.overlays[0],overlay);assert.equal(overlay.__cluster,replacement);
  assert.equal(overlay.position,replacement.latlng);assert.match(overlay.content,/a:3: done$/);
  assert.equal(f.stats.content,1);assert.equal(f.stats.position,1);assert.deepEqual(f.events,[]);
  replacement.items=[{key:'new-ad',done:true},{key:'other-ad',done:true},{key:'third-ad',done:true}];
  f.draw([replacement]);assert.equal(overlay.__cluster.items[0].key,'new-ad');assert.equal(f.stats.content,1);
});
test('zoom split/merge attaches all new groups before removing old ones with exact fresh membership',()=>{
  const f=fixture();f.draw([cluster('world-grid:1280:a',4)]);f.events.length=0;
  const first=cluster('world-grid:640:b'),second=cluster('world-grid:640:c');f.draw([first,second]);
  assert.deepEqual(f.events,[['attach',2],['attach',3],['detach',1]]);
  assert.equal(f.c.overlays[0].__cluster,first);assert.equal(f.c.overlays[1].__cluster,second);
  f.events.length=0;f.draw([cluster('world-grid:1280:a',4)]);
  assert.deepEqual(f.events,[['attach',4],['detach',2],['detach',3]]);assert.equal(f.c.count,4);
});
test('region names and exact-address clusters never reuse spatial cells with different keys',()=>{
  const f=fixture();f.draw([cluster('admin:district:서구',5,36.35,'district')]);f.events.length=0;
  f.draw([cluster('admin:neighborhood:서구:탄방동',3,36.35,'neighborhood'),cluster('exact:탄방동1',2)]);
  assert.deepEqual(f.events,[['attach',2],['attach',3],['detach',1]]);assert.equal(f.c.count,5);
});
test('selection-only redraws update only changed content and keep native click targets when unchanged',()=>{
  const f=fixture();f.draw([cluster('a'),cluster('b')]);f.c.selected='a';f.c.redrawSelectedMarkers();
  assert.equal(f.stats.content,1);assert.match(f.c.overlays[0].content,/ selected$/);
  f.c.redrawSelectedMarkers();assert.equal(f.stats.content,1);
  f.snapshot.selected='a';f.draw([cluster('a'),cluster('b')]);assert.equal(f.stats.content,1);
  assert.equal(f.c.selected,'a');assert.equal(f.c.overlays[0].z,1000);
});
test('leaving the viewport and clearing removes obsolete overlays without an unbounded offscreen pool',()=>{
  const f=fixture();f.draw([cluster('a'),cluster('b')]);const retained=f.c.overlays[1];f.events.length=0;
  f.draw([cluster('b')]);assert.equal(f.c.overlays[0],retained);assert.deepEqual(f.events,[['detach',1]]);
  f.c.clearMap();assert.equal(f.c.overlays.length,0);assert.equal(retained.map,null);assert.equal(f.c.count,0);
});
test('a replacement SDK map does not reuse native overlays attached to the previous map',()=>{
  const f=fixture();f.draw([cluster('a')]);const old=f.c.overlays[0];f.events.length=0;
  f.c.map={id:'replacement'};f.draw([cluster('a')]);
  assert.notEqual(f.c.overlays[0],old);assert.equal(old.map,null);
  assert.deepEqual(f.events,[['attach',2],['detach',1]]);
});
