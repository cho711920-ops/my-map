import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function harness(){
 const context={console,Date,URL,Promise,Number,JSAuthenticatedAccountEmail:'visit@test.invalid',addEventListener(){},document:{querySelector(){throw Error('Formatting must not load a SDK or query external data');}},
  navigator:{get geolocation(){throw Error('Visit notes must not use GPS');}},formatListingRoomForCardV653:room=>room};
 context.window=context;vm.createContext(context);vm.runInContext(readFileSync('js/visit-kakao-share-v101.js','utf8'),context);return context;
}
const sample={propertyId:'A',name:'일반상가',address:'서구 괴정동 1-37',room:'1층',type:'상가점포',area:11,deposit:2000,rent:55};
test('visit note exactly follows the requested address / building / room / type / pyeong / price / fixed suffix',()=>{
 assert.equal(harness().JSVisitKakaoShareV101.format(sample),'괴정동 1-37 일반상가 1층 상가 11평 월2000에55 출입기준');
});
test('unknown fields stay unknown and never become zero or guessed area',()=>{
 const api=harness().JSVisitKakaoShareV101;
 const result=api.format({...sample,area:0,deposit:0,rent:0,displayValuePresence:{area:false,deposit:false,rent:false}});
 assert.match(result,/면적 미확인 보증금·월세 미확인 출입기준$/);assert.doesNotMatch(result,/0평|월0에0/);
 assert.match(api.format({...sample,deposit:0,rent:0}),/월0에0 출입기준$/);
});
test('capture freezes the selected visible advertisement terms, never different hidden master terms',()=>{
 const h=harness();h.actionSelectionKeyV660=item=>'property:'+item.propertyId;
 h.visibleListItems=[{...sample,rent:55,area:11}];
 const snapshot=h.JSVisitKakaoShareV101.capture([{...sample,rent:210,area:19.9}]);
 h.visibleListItems[0].rent=999;
 assert.equal(snapshot.owner,'visit@test.invalid');assert.equal(snapshot.lines[0],'괴정동 1-37 일반상가 1층 상가 11평 월2000에55 출입기준');
});
test('sale notes never label the purchase price as monthly rent',()=>{
 assert.match(harness().JSVisitKakaoShareV101.format({...sample,tradeType:'sale',salePrice:180000}),/매매180000만원 출입기준$/);
});
