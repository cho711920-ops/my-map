import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync('js/query-thumbnails-v159.js','utf8');
function fixture(width=1200){
  const images=[],started=[],events={},frames=[];
  class Image extends EventTarget{
    constructor(){super();this.attrs={};this.dataset={};this.naturalWidth=0;this.naturalHeight=0;images.push(this);}
    setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]||null;}removeAttribute(k){delete this.attrs[k];}
    set src(value){this.attrs.src=value;started.push(value);}get src(){return this.attrs.src||'';}
    decode(){return Promise.resolve();}load(w=320,h=240){this.naturalWidth=w;this.naturalHeight=h;this.complete=true;this.dispatchEvent(new Event('load'));}
  }
  const window={innerWidth:width,Image,JSAuthenticatedAccountEmail:'owner',navigator:{connection:{}},
    JSUnifiedListingsV8:{thumbnailDescriptorV159:item=>({url:item.url,source:item.url,originalId:item.originalId||'ad-'+item.propertyId})},
    addEventListener:(name,fn)=>events[name]=fn,requestAnimationFrame:fn=>frames.push(fn),performance:{now:()=>80}};
  const root={dataset:{}},cards=[];vm.runInNewContext(code,{window,document:{documentElement:root,querySelectorAll:()=>cards},Map,Set,Promise});
  const row=(id,extra={})=>({propertyId:id,sourceSnapshotKey:'proof-'+id,url:'https://photos.invalid/'+id+'.jpg',...extra});
  return {api:window.JSQueryThumbsV159,window,images,started,events,row,root,cards,frames};
}
test('a prepared image is adopted only by the same account, property, source proof, original and URL',()=>{
  const f=fixture(),item=f.row('A');f.api.prefetch([item]);
  for(const changed of [{propertyId:'B'},{sourceSnapshotKey:'different'},{originalId:'other-ad'},{url:'other-photo'}])assert.equal(f.api.take({...item,...changed}),null);
  const node=f.api.take(item);assert.equal(node,f.images[0]);assert.equal(f.started.length,1);assert.equal(f.api.take(item),null);
  f.api.prefetch([f.row('B')]);f.window.JSAuthenticatedAccountEmail='other';assert.equal(f.api.take(f.row('B')),null);
});
test('background requests have three slots and cancelled clear releases slots without relying on browser abort events',()=>{
  const f=fixture();f.api.prefetch(Array.from({length:12},(_,i)=>f.row(String(i))),{background:true});assert.equal(f.started.length,3);
  f.api.clear();assert.ok(f.images.every(image=>!image.src));
  f.api.prefetch([f.row('fresh1'),f.row('fresh2'),f.row('fresh3')]);assert.equal(f.started.length,6);
});
test('foreground adoption starts its queued exact photo without waiting for background downloads',()=>{
  const f=fixture(),items=Array.from({length:8},(_,i)=>f.row(String(i)));f.api.prefetch(items,{background:true});
  assert.equal(f.started.length,3);const wanted=f.api.take(items[7]);assert.equal(wanted.src,items[7].url);assert.equal(f.started.length,4);
});
test('mobile cache bounds, save-data and receipt/logout invalidation prevent unbounded or cross-generation warming',()=>{
  const f=fixture(400);f.window.navigator.connection.saveData=true;f.api.prefetch([f.row('skip')],{background:true});assert.equal(f.started.length,0);
  f.window.navigator.connection.saveData=false;f.api.prefetch(Array.from({length:20},(_,i)=>f.row(String(i))),{limit:20,background:true});
  assert.equal(f.api.take(f.row('0')),null);assert.ok(f.api.take(f.row('19')));
  f.events['js-master-persisted-v154']();assert.equal(f.api.take(f.row('18')),null);
  f.api.prefetch([f.row('new')]);f.events['js-auth-required']();assert.equal(f.api.take(f.row('new')),null);
});
test('photo paint metric remains pending until the actual selected image decodes, and changed DOM cannot pass',()=>{
  const f=fixture(),item=f.row('A');f.api.prefetch([item]);const image=f.api.take(item);image.isConnected=true;
  f.cards.push({dataset:{propertyId:'A',thumbnailStateV159:'image'},querySelector:()=>image});
  f.window.jsClusterPaintIntentV158=1;f.window.jsClusterThumbTimingV159={startedAt:0,intent:1,ids:['A']};
  f.api.measure();assert.equal(f.frames.length,0);
  image.complete=true;image.naturalWidth=320;image.dataset.thumbnailDecodedV159='true';f.api.measure();
  f.frames.shift()();image.isConnected=false;f.frames.shift()();assert.notEqual(f.root.dataset.clusterPhotosPendingV159,'false');
});
