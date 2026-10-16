import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync('js/map.js','utf8');
const ast=ts.createSourceFile('map.js',source,ts.ScriptTarget.Latest,true);
function runtime(names){return ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');}
test('retired field controls, assets and camera hooks are absent while the ordinary map and visit workflows remain',()=>{
 for(const file of ['js/map-field-mode-v1.js','js/map-field-camera-v1.js','js/map-field-orientation-v1.js','js/map-field-lease-cards-v1.js','css/map-field-mode-v1.css'])assert.equal(existsSync(file),false);
 for(const file of ['index.html','js/map.js','js/script.js','js/map-list-panel-v1.js','js/map-quick-tools-v657.js','css/handheld-orientation-v1.css'])
  assert.doesNotMatch(readFileSync(file,'utf8'),/JSField|mapFieldMode|jsFieldMap|fieldLease|map-field-mode|js-field-map|field-mode-v1/);
 const html=readFileSync('index.html','utf8');
 assert.match(html,/<div id="map"><\/div>/);assert.match(source,/new kakao\.maps\.Map\(viewport,/);
 for(const id of ['mapRoadviewSelectBtn','mapDistanceBtn','mapRadiusBtn','mapPolygonBtn','mapListOpenV1'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(existsSync('js/ai-visit-session-v6.js'));assert.ok(existsSync('js/unified-favorites-v7.js'));
});
test('ordinary GPS keeps one watcher and updates its marker without moving or zooming the map',()=>{
 let watchers=0,clears=0,remembered=0,markers=0,updates=0;let success,error;
 const context={window:null,console:{warn(){}},navigator:{geolocation:{watchPosition(ok,fail){watchers++;success=ok;error=fail;return 41;},clearWatch(){clears++;}}},
  jsCurrentLocationWatchIdV630:null,jsCurrentLocationOverlayV630:null,jsLastCurrentLocationPositionV1:null,
  map:{setCenter(){assert.fail('GPS must not pan the map');},setLevel(){assert.fail('GPS must not zoom the map');}},
  JSKakaoNavigation:{rememberPosition(){remembered++;}},document:{createElement(){return {setAttribute(){}};}},
  kakao:{maps:{LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},CustomOverlay:class{
    constructor(){markers++;}setMap(){}setPosition(){updates++;}
  }}}};
 context.window=context;vm.createContext(context);vm.runInContext(runtime(['startCurrentLocationTrackingV630','updateCurrentLocationOverlayV630']),context);
 context.startCurrentLocationTrackingV630();context.startCurrentLocationTrackingV630();assert.equal(watchers,1);
 success({coords:{latitude:36.35,longitude:127.38}});success({coords:{latitude:36.36,longitude:127.39}});
 assert.equal(markers,1);assert.equal(updates,1);assert.equal(remembered,2);assert.equal(context.jsLastCurrentLocationPositionV1.coords.latitude,36.36);
 error({code:1});assert.equal(clears,1);assert.equal(context.jsCurrentLocationWatchIdV630,null);
});
test('shared display projection delegates directly to the SDK after removing field rotation',()=>{
 const projection={marker:'native'},context={map:{getProjection:()=>projection}};vm.createContext(context);
 vm.runInContext(runtime(['getMapDisplayProjectionV1']),context);assert.equal(context.getMapDisplayProjectionV1(),projection);
});
