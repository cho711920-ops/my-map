import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('js/map.js','utf8');
function fn(name){const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2);}

test('map startup still requests listings when the optional Kakao address-search library is absent',async()=>{
  const start=source.indexOf('kakao.maps.load(function() {');
  const bootstrap=source.slice(start,source.indexOf('\n});',start)+5);
  let loadCalls=0;
  const context={kakao:{maps:{load:callback=>callback(),Map:function(){},LatLng:function(){},event:{addListener(){}}}},
    document:{getElementById:()=>({addEventListener(){}}),addEventListener(){},visibilityState:'visible'},
    jsDefaultMapCenterV6524:{lat:36.35,lng:127.38},jsDefaultMapLevelV6524:7,jsLegacyDefaultMapLevelV690:7,
    shouldUseWorldGridClustersV690:()=>true,startCurrentLocationTrackingV630(){},setupMapViewportRelayoutV690(){},
    setupEnterSearch(){},setupMobilePanelDrag(){},setupQuickAddShortcuts(){},
    markMapUserNavigationIntentV6525(){},loadSheet(){loadCalls++;return true;},
    rememberListingsRevisionV682(){},Promise,setInterval(){},jsAutomaticDataRefreshIntervalV681:60000};
  vm.runInNewContext(bootstrap,context);await Promise.resolve();
  assert.equal(loadCalls,1);assert.equal(context.geocoder,null);
  context.kakao.maps.services={Geocoder(){throw Error('blocked library');}};
  vm.runInNewContext(bootstrap,context);await Promise.resolve();
  assert.equal(loadCalls,2);assert.equal(context.geocoder,null);
});

function geocoding(services){
  const context={kakao:{maps:{services,LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}}},
    errorItems:[],geocodeCache:{},normalizeAddressForCache:value=>value,geocoder:null};
  vm.runInNewContext(fn('geocodeItems'),context);return context;
}
test('saved-coordinate listings and a confirmed empty list need no address-search service',()=>{
  const context=geocoding(undefined);let result;
  context.geocodeItems([],rows=>result=rows);assert.equal(result.length,0);
  context.geocodeItems([{address:'서구 괴정동 1',latitude:36.35,longitude:127.38}],rows=>result=rows);
  assert.equal(result.length,1);assert.equal(result[0].latlng.getLat(),36.35);assert.equal(context.errorItems.length,0);
});
test('missing address-search support retains located listings and reports only unlocated rows',()=>{
  const context=geocoding({});let result;
  const missing={address:'서구 괴정동 2',latitude:null,longitude:null};
  context.geocodeItems([{address:'서구 괴정동 1',latitude:36.35,longitude:127.38},missing],rows=>result=rows);
  assert.equal(result.length,1);assert.equal(context.errorItems.length,1);
  assert.equal(context.errorItems[0],missing);assert.match(missing.geocodeErrorReason,/주소검색/);
  assert.equal(missing.latitude,null);assert.equal(missing.longitude,null);
  const throwing=geocoding({Geocoder:function(){throw Error('blocked library');},Places:function(){}});
  throwing.geocodeItems([missing],rows=>result=rows);
  assert.equal(result.length,0);assert.equal(throwing.errorItems.length,1);
});

test('a failed cold load has one shared automatic retry budget and revision polling cannot create a loop',()=>{
  let reads=0;
  const context={isLoadingSheet:false,jsListingsCompleteBaseV1:false,jsListingsRevisionPendingV682:false,
    jsListingsLoadStateV65:{phase:'error',autoRetries:1},document:{visibilityState:'visible'},navigator:{onLine:true},
    loadSheet(auto,force){reads++;assert.equal(auto,false);assert.equal(force,false);return true;},
    fetchDataRevisionV682(){throw Error('unexpected poll');}};
  vm.runInNewContext(fn('retryListingsLoadV65')+'\n'+fn('refreshListingsWhenChangedV682'),context);
  for(let i=0;i<20;i++){context.retryListingsLoadV65(false);context.refreshListingsWhenChangedV682();}
  assert.equal(reads,0);context.jsListingsLoadStateV65.phase='auth';context.retryListingsLoadV65(true);assert.equal(reads,0);
  context.jsListingsLoadStateV65.phase='error';context.retryListingsLoadV65(true);assert.equal(reads,1);
});
