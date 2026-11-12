import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile('js/script.js','utf8');
const errors=new WeakMap();
test.afterEach(async({page})=>{expect(errors.get(page)||[]).toEqual([]);});
const runtime=source.slice(source.indexOf('var roadviewInstance = null;'),source.indexOf('function normalizeAngle('));
const ast=ts.createSourceFile('script.js',source,ts.ScriptTarget.Latest,true);
const extras=['startKakaoRoadviewV653','updateRoadviewCameraPosition','updateRoadviewDirection','updateRoadviewTargetPin'].map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join('\n');
async function setup(page,context){
 const caught=[];errors.set(page,caught);page.on('pageerror',error=>caught.push(error.message));
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.route('**/__fixture/roadview-facing-v197',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>#naverRoadviewMapV654{width:400px;height:400px}</style><section id="roadviewModal" class="roadview-modal open"><div id="naverRoadviewContainer"></div><div id="naverRoadviewMapV654"></div><p id="naverRoadviewModalStatus"></p><div id="roadviewContainer"></div><p id="roadviewModalStatus"></p></section>'}));
 await page.goto('/__fixture/roadview-facing-v197');
 await page.evaluate(()=>{
  const listeners=new WeakMap();window.__fire=(object,name,arg)=>(listeners.get(object)?.[name]||[]).slice().forEach(fn=>fn(arg));
  const event={addListener(object,name,fn){let handlers=listeners.get(object);if(!handlers)listeners.set(object,handlers={});(handlers[name]||(handlers[name]=[])).push(fn);},once(object,name,fn){this.addListener(object,name,fn);},trigger:(...args)=>__fire(...args)};
  window.__camera={lat:36.35,lng:127.38};window.__panos=[];window.__maps=[];window.__kakaos=[];
  class LatLng{constructor(lat,lng){this.latitude=lat;this.longitude=lng;}lat(){return this.latitude;}lng(){return this.longitude;}getLat(){return this.latitude;}getLng(){return this.longitude;}}
  class Map{constructor(element,options){this.options={...options};this.zoomWrites=[];__maps.push(this);}panTo(p){this.center=p;}setZoom(z){this.options.zoom=z;this.zoomWrites.push(z);}getZoom(){return this.options.zoom;}setCenter(p){this.center=p;}setMapTypeId(){} }
  class Marker{constructor(options){this.options=options;}setPosition(p){this.options.position=p;}setIcon(icon){this.options.icon=icon;}setMap(){} }
  class Panorama{constructor(element,options){this.requested=options.position;this.pov={...options.pov};this.povWrites=[];this.id='nav-1';__panos.push(this);}getLocation(){return {coord:new LatLng(__camera.lat,__camera.lng)};}getPosition(){return this.requested;}getPanoId(){return this.id;}getPov(){return {...this.pov};}setPov(p){this.pov={...this.pov,...p};this.povWrites.push({...p});__fire(this,'pov_changed');}setPosition(p){this.requested=p;}setSize(){} }
  window.naver={maps:{LatLng,Map,Marker,Panorama,Point:class{},Size:class{},StreetLayer:class{setMap(){}},Event:event,MapTypeId:{NORMAL:'normal'},Position:{TOP_LEFT:'top-left'},ZoomControlStyle:{SMALL:'small'}}};
  class Roadview{constructor(){this.pov={pan:0,tilt:8,zoom:2};this.povWrites=[];this.id='kakao-1';__kakaos.push(this);}setPanoId(id){this.id=id;}getPanoId(){return this.id;}getPosition(){return new LatLng(__camera.lat,__camera.lng);}getViewpoint(){return {...this.pov};}setViewpoint(p){this.pov={...p};this.povWrites.push({...p});__fire(this,'viewpoint_changed');}relayout(){} }
  window.kakao={maps:{LatLng,Roadview,RoadviewClient:class{getNearestPanoId(position,radius,fn){fn('kakao-1');}},event}};
  window.currentRoadviewMode='naver';window.currentRoadviewPosition=null;window.roadviewCameraPosition=null;window.roadviewTargetPosition=null;window.currentRoadviewPan=0;window.escapeHtml=value=>String(value||'');
 });
 await page.addScriptTag({content:runtime+'\n'+extras});
 await page.evaluate(()=>{naverRoadviewSdkReadyV1=true;currentRoadviewCoords={lat:36.35,lng:127.3801};roadviewOpenSequenceV653=1;});
}
async function startNaver(page){
 await page.evaluate(()=>startNaverRoadviewV653(roadviewOpenSequenceV653));
 await expect.poll(()=>page.evaluate(()=>Boolean(naverRoadviewInstanceV653))).toBe(true);
 await page.evaluate(()=>__fire(naverRoadviewInstanceV653,'pano_status','OK'));
}

test('actual camera rather than the requested building point determines NAVER facing without changing field of view',async({page,context})=>{
 await setup(page,context);await startNaver(page);
 for(const [lat,lng,pan]of [[36.35,127.3801,90],[36.3501,127.38,0],[36.35,127.3799,-90],[36.3499,127.38,180]]){
  const pov=await page.evaluate(([lat,lng])=>{currentRoadviewCoords={lat,lng};naverRoadviewInstanceV653.id+='x';__fire(naverRoadviewInstanceV653,'pano_changed');return naverRoadviewInstanceV653.getPov();},[lat,lng]);
  expect(Math.abs(((pov.pan-pan+540)%360)-180)).toBeLessThan(.01);expect(pov.fov).toBe(95);expect(pov.tilt).toBe(-7);
 }
 expect(await page.evaluate(()=>naverRoadviewMapV654.options.scaleControl)).toBe(true);
});

test('manual rotation survives duplicate ready events and only a new camera receives another building bearing',async({page,context})=>{
 await setup(page,context);await startNaver(page);
 const result=await page.evaluate(()=>{
  const pano=naverRoadviewInstanceV653;pano.setPov({pan:42,tilt:12,fov:70});const before=pano.povWrites.length;
  __fire(pano,'init');__fire(pano,'pano_changed');__fire(pano,'pano_status','OK');const kept=pano.getPov();
  const duplicateWrites=pano.povWrites.length-before;__camera={lat:36.3501,lng:127.3801};pano.id='nav-next';__fire(pano,'pano_changed');
  return {kept,duplicateWrites,next:pano.getPov(),writes:pano.povWrites.length-before};
 });
 expect(result.kept).toEqual({pan:42,tilt:12,fov:70});expect(result.duplicateWrites).toBe(0);expect(result.next.pan).toBeCloseTo(180,2);expect(result.next.tilt).toBe(12);expect(result.next.fov).toBe(70);expect(result.writes).toBe(1);
});

test('linked map opens at 20m SDK zoom on each new session but keeps deliberate zoom during navigation and resize',async({page,context})=>{
 await setup(page,context);await startNaver(page);
 expect(await page.evaluate(()=>naverRoadviewMapV654.getZoom())).toBe(19);
 const result=await page.evaluate(()=>{
  const map=naverRoadviewMapV654;map.setZoom(20);__fire(naverRoadviewInstanceV653,'pano_changed');syncNaverRoadviewLayoutV654();const kept=map.getZoom();
  roadviewOpenSequenceV653++;naverRoadviewLoadingV653=false;startNaverRoadviewV653(roadviewOpenSequenceV653);return {kept};
 });
 expect(result.kept).toBe(20);await expect.poll(()=>page.evaluate(()=>naverRoadviewMapV654.getZoom())).toBe(19);
 await page.evaluate(()=>{__fire(naverRoadviewInstanceV653,'pano_status','OK');syncNaverRoadviewLayoutV654();});
 expect(await page.evaluate(()=>naverRoadviewMapV654.zoomWrites)).toEqual([20,19]);expect(await page.evaluate(()=>__maps.length)).toBe(1);
});

test('unknown or coincident camera positions never fabricate a bearing and closed sessions ignore late ready events',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{__camera={...currentRoadviewCoords};});await startNaver(page);
 expect(await page.evaluate(()=>naverRoadviewInstanceV653.povWrites.length)).toBe(0);
 await page.evaluate(()=>{__camera={lat:null,lng:127.38};__fire(naverRoadviewInstanceV653,'pano_changed');});
 expect(await page.evaluate(()=>naverRoadviewInstanceV653.povWrites.length)).toBe(0);
 await page.evaluate(()=>{__camera={lat:36.35,lng:127.38};__fire(naverRoadviewInstanceV653,'pano_changed');});
 expect(await page.evaluate(()=>naverRoadviewInstanceV653.povWrites.length)).toBe(1);
 await page.evaluate(()=>{document.getElementById('roadviewModal').classList.remove('open');roadviewOpenSequenceV653++;__camera={lat:36.3499,lng:127.38};__fire(naverRoadviewInstanceV653,'pano_changed');});
 expect(await page.evaluate(()=>naverRoadviewInstanceV653.povWrites.length)).toBe(1);
});

test('Kakao receives the same building bearing once per camera while manual rotation and newer sessions stay intact',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{currentRoadviewMode='kakao';currentRoadviewPosition=new kakao.maps.LatLng(currentRoadviewCoords.lat,currentRoadviewCoords.lng);roadviewTargetPosition=currentRoadviewPosition;startKakaoRoadviewV653(roadviewOpenSequenceV653);__fire(roadviewInstance,'init');});
 const initial=await page.evaluate(()=>roadviewInstance.getViewpoint());expect(initial.pan).toBeCloseTo(90,2);expect(initial.tilt).toBe(8);expect(initial.zoom).toBe(2);
 const result=await page.evaluate(()=>{
  const instance=roadviewInstance;instance.setViewpoint({pan:42,tilt:10,zoom:1});const before=instance.povWrites.length;
  __fire(instance,'init');__fire(instance,'position_changed');const kept=instance.getViewpoint(),duplicateWrites=instance.povWrites.length-before;
  __camera={lat:36.3501,lng:127.3801};instance.id='kakao-next';__fire(instance,'position_changed');const next=instance.getViewpoint();
  roadviewOpenSequenceV653++;instance.setViewpoint({pan:11,tilt:10,zoom:1});__fire(instance,'init');__fire(instance,'position_changed');
  roadviewInstance=null;__fire(instance,'viewpoint_changed');__fire(instance,'position_changed');__fire(instance,'init');
  return {kept,duplicateWrites,next,late:instance.getViewpoint()};
 });
 expect(result.kept).toEqual({pan:42,tilt:10,zoom:1});expect(result.duplicateWrites).toBe(0);expect(result.next.pan).toBeCloseTo(180,2);expect(result.next.tilt).toBe(10);expect(result.next.zoom).toBe(1);expect(result.late.pan).toBe(11);
});
