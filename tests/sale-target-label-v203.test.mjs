import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={};
vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById(){return null;},querySelector(){return null;},documentElement:{setAttribute(){}}}});
const ui=window.JSListingTradeV1;
const item=(memo='',details={},extra={})=>({propertyId:'A',key:'stable',room:'전체',tradeType:'sale',saleCategory:'commercial',source:'네이버',salePrice:115000,memo,saleDetails:{saleExtent:'unit',saleTargetFloor:'9층',...details},...extra});
test('whole ninth floor is a unit sale and unrelated second-floor promotion is ignored',()=>{
 const i=item('돈버는자리 크리닉건물 9층매매 안과 최적. 코리아메디컬타워 탑층 9층 전체 매매합니다. [둔산동 미용실 2층 전용120평 2억 월1200 자리좋음]');
 const before=JSON.stringify(i);assert.equal(ui.buildingSaleTargetLabelV203(i),'9층 전체 매매');assert.equal(JSON.stringify(i),before);
 assert.equal(ui.buildingSaleExtent(i),'unit');assert.equal(ui.buildingSaleInfoHtml(i),'');
});
test('source target is immediately available without a description request',()=>{
 assert.equal(ui.buildingSaleTargetLabelV203(item('도로노출1층 내부시설완비',{saleTargetFloor:'1층'})),'1층 · 호실 매매');
 assert.equal(ui.buildingSaleTargetLabelV203(item('',{saleTargetFloor:'1층',saleTargetRoom:'101호'})),'1층 101호 매매');
});
for(const [memo,label] of [['9층 전체 매매','9층 전체 매매'],['1층 호실 매매','1층 · 호실 매매'],['지하1층 상가 매매','지하1층 · 호실 매매'],['1층 101호 매매','1층 101호 매매'],['101호실 매매','101호 매매'],['건물 전체 매매','건물 전체 매매']])test('explicit own memo '+memo,()=>{
 assert.equal(ui.buildingSaleTargetLabelV203(item(memo,{saleExtent:'unknown',saleTargetFloor:''})),label);
});
test('building scale, rental schedules and broker promises never become a sale target',()=>{
 for(const memo of ['지하1층 지상9층 매매','지상19층 매매','총19층 매매','1층 임대중 2층 사무실 3층 주인세대','9층 매매 전문 상담','9층 매매 구합니다'])assert.equal(ui.buildingSaleTargetLabelV203(item(memo,{saleExtent:'unknown',saleTargetFloor:''})), '',memo);
 assert.equal(ui.buildingSaleTargetLabelV203(item('지상9층 건물 전체 매매',{saleExtent:'whole_building',aboveGroundFloors:9,saleTargetFloor:''})),'건물 전체 매매 · 지상 9층');
});
test('conflicting, negated and fractional descriptions ask for confirmation',()=>{
 for(const memo of ['1층 매매','9층 매매. 2층 매매','9층 매매 아님','9층 지분 매매','건물 전체 매매','호실별 매매','일부만 매매'])assert.equal(ui.buildingSaleTargetLabelV203(item(memo)),'층·호실 확인 필요',memo);
});
test('explicit manual room wins without rewriting identity, scope or finances',()=>{
 const i=item('9층 전체 매매',{}, {room:'지하1층',roomManuallyEditedV1:true});const before=JSON.stringify(i);
 assert.equal(ui.buildingSaleTargetLabelV203(i),'지하1층 · 직접 입력');assert.equal(JSON.stringify(i),before);
 assert.match(ui.buildingSaleTargetHtmlV203({...i,room:'<img src=x onerror=1>'}),/&lt;img/);
});
test('another projected advertisement cannot borrow a master memo',()=>{
 const i=item('9층 전체 매매',{saleTargetFloor:'1층'},{unifiedFilterOriginalV2:{originalId:'OTHER'}});
 assert.equal(ui.buildingSaleTargetLabelV203(i),'1층 · 호실 매매');
 assert.equal(ui.buildingSaleTargetLabelV203({...i,saleTargetMemoV203:'1층 101호 매매'}),'1층 101호 매매');
});
test('memo edits are reflected immediately and non-building markets remain unchanged',()=>{
 const i=item('9층 전체 매매');assert.equal(ui.buildingSaleTargetLabelV203(i),'9층 전체 매매');i.memo='9층 매매';assert.equal(ui.buildingSaleTargetLabelV203(i),'9층 · 호실 매매');
 for(const extra of [{tradeType:'lease'},{saleCategory:'land'},{saleDetails:{scope:'land'}}])assert.equal(ui.buildingSaleTargetHtmlV203({...i,...extra}),'');
});

test('multiple floors and room ranges are never reduced to their final number',()=>{
 for(const memo of ['1,2층 매매','1층과2층 매매','101호,102호 매매','101~103호 매매'])assert.equal(ui.buildingSaleTargetLabelV203(item(memo,{saleExtent:'unknown',saleTargetFloor:''})),'층·호실 확인 필요',memo);
});
