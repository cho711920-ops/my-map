import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const building={propertyId:'BUILDING',key:'building',tradeType:'sale',saleCategory:'building',name:'검수 건물',address:'대전 서구 괴정동 1',salePrice:180000,room:'전체',deposit:999,rent:999,fee:999,premium:999,source:'당근',memo:'<원본> 보존 메모',saleDetails:{landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:30000,monthlyIncome:642,loanAmount:90000,investmentAmount:60000,buildingUse:'단독주택',approvalDate:'2016-07-01'}};
const land={...building,propertyId:'LAND',key:'land',name:'검수 토지',saleCategory:'land',salePrice:30000,room:'임대용 5층',saleDetails:{landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'8m 도로',parcelShape:'장방형',cadastralAreaM2:999}};
function print(items,visible){let html='',alerts=0,opened=0;
  const window={addEventListener(){},dispatchEvent(){},allItems:items,visibleListItems:visible||[],actionSelectionKeyV660:i=>i.propertyId,open(){opened++;return {document:{open(){},write:v=>html=v,close(){}}};}};
  const context={window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}},addEventListener(){}},CustomEvent:class{},getSelectedPrintItems:()=>items,isDone:()=>false,alert:()=>alerts++};
  for(const file of ['listing-trade-ui-v1.js','print-v2.js'])vm.runInNewContext(fs.readFileSync('js/'+file,'utf8'),context);
  window.printSelectedList();return {html,alerts,opened};
}
test('building report uses sale price, canonical areas and finance without legacy rental columns or data writes',()=>{
  const items=[structuredClone(building)],before=JSON.stringify(items),{html}=print(items);
  for(const text of ['건물매매 검토목록','18억원','대지면적','330.58㎡','연면적','임대보증금 합계','3억원','월 임대수입','642만원','7,704만원','5.14%','광고 융자금','9억원','광고 실투자금','6억원','대지 기준 매매단가','1,800만원/평','연면적 기준 매매단가','900만원/평','사용승인일','&lt;원본&gt; 보존 메모'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/출처 당근/);
  assert.doesNotMatch(html,/보999|월999|관999|권999|<th>등록일|col-date/);assert.equal(JSON.stringify(items),before);
});
test('land report uses advertised area, unit price and parcel facts without building/rental fields',()=>{
  const {html}=print([land]);for(const text of ['토지매매 검토목록','3억원','토지면적','300만원/평','제2종일반주거지역','8m 도로','장방형'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/연면적|임대보증금|月|월 임대수입|단순 연 수익률|5층|999㎡|층·호실/);
});
test('unknown financial values never become zero income or yield, and stated profit stays separate',()=>{
  const {html}=print([{...building,saleDetails:{statedMonthlyIncome:211,loanAmount:null}}]);
  assert.match(html,/광고 월수익 · 기준 미확인/);assert.match(html,/211만원/);
  assert.doesNotMatch(html,/<dt>월 임대수입|<dt>보증금 차감|0원|0%|광고 융자금/);
  const zero=print([{...building,saleDetails:{monthlyIncome:0,totalDeposit:0}}]).html;
  assert.match(zero,/<dt>월 임대수입<\/dt><dd>0만원/);assert.match(zero,/<dt>보증금 차감 단순 연 수익률<\/dt><dd>0%/);
});
test('visible selected source conditions and manual overrides match the print without mixing another original',()=>{
  const chosen={...building,salePrice:190000,saleDetails:{monthlyIncome:370,totalDeposit:20000},source:'네이버'};
  const {html}=print([building],[chosen]);assert.match(html,/19억원/);assert.match(html,/370만원/);assert.doesNotMatch(html,/18억원|642만원|330.58㎡/);
  const conflict={...building,saleDetails:undefined,unifiedOriginalsV8:[{...building},{...building,saleDetails:{monthlyIncome:99999}}]};
  assert.doesNotMatch(print([conflict]).html,/642만원|99,999만원|<dt>월 임대수입/);
});
test('mixed selection preserves all identities and order while lease-only printing retains its original table',()=>{
  const lease={...building,propertyId:'LEASE',tradeType:'lease',name:'임대 검수',rent:90,deposit:2000,fee:5,premium:100};
  const mixed=print([building,lease,land]).html;assert.match(mixed,/선택매물 검토목록/);assert.ok(mixed.indexOf('검수 건물')<mixed.indexOf('임대 검수'));assert.ok(mixed.indexOf('임대 검수')<mixed.indexOf('검수 토지'));
  const original=print([lease]).html;assert.match(original,/JS부동산 임장리스트/);assert.match(original,/보2000 \/ 월90 \/ 관5 \/ 권100/);assert.match(original,/<th>등록일/);assert.doesNotMatch(original,/sale-print-card/);
  assert.deepEqual(print([]),{html:'',alerts:1,opened:0});
});
