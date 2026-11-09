import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
const raw='(임장가자) 보증금 5000만원 / 월세 315만원 ✅ 주차 편리 / 코너 상가 ✅ 관리비 : 내부 규약 준수 ✅ 화장실 남·여 각 1 ✅ 공인중개사무소 소개 ✅ 성실·책임 중개 ✅ 한국공인중개사협회 2억 원 책임보험 가입 ✅ 채팅보다 전화상담이 빠르답니다';
async function setup(page,context,isMobile){
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 if(isMobile){await page.setViewportSize({width:930,height:530});await page.evaluate(()=>JSMapListPanelV1.open());}
 await page.locator('#fixtureControls').evaluate(el=>el.remove());
  await page.route('**/api/data?*',async route=>{
    const q=new URL(route.request().url()).searchParams;if(q.get('action')!=='listingChanges')return route.fallback();
    const rows=await page.evaluate(ids=>allItems.filter(i=>ids.split(',').includes(i.propertyId)).map(i=>({property_id:i.propertyId,operating_memo:i.memo,status:'active'})),q.get('ids'));
    await route.fulfill({json:{ok:true,items:rows}});
  });
}

test('collected list memo and editor are concise while raw and drafts survive refresh',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
 await page.evaluate(raw=>{const item=allItems[0];item.memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));},raw);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
 await card.getByRole('button',{name:'메모 열기',exact:true}).click();
 await expect(card.locator('.source-description-clean-v140')).toContainText('월세 315만원');
 await expect(card.locator('.source-description-clean-v140')).not.toContainText('공인중개사');
 await expect(card.locator('.source-description-original-v140')).not.toHaveAttribute('open','');
 await card.getByText('수집 원문 보기',{exact:true}).click();
 await expect(card.locator('.source-description-original-v140 > div')).toHaveText(raw);
 await card.getByRole('button',{name:'수정',exact:true}).click();await expect(card.locator('textarea')).not.toHaveValue(raw);
 await expect(card.locator('textarea')).toHaveValue(/월세 315만원/);
 await expect(card.locator('.memo-editor-original-v144 > div')).toHaveText(raw);
 await card.locator('textarea').fill(raw+'\n내가 직접 작성한 메모');
 await page.evaluate(()=>showList(visibleListItems));await expect(card.locator('textarea')).toHaveValue(raw+'\n내가 직접 작성한 메모');
 await card.getByRole('button',{name:'취소',exact:true}).click();expect(await page.evaluate(()=>allItems[0].memo)).toBe(raw);expect(writes).toEqual([]);
});

test('unmarked management memo quoting a broker is displayed and edited verbatim',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const memo='\n  내가 작성함: 공인중개사무소 소개 / 성실·책임 중개  \n\n';
 await page.evaluate(memo=>{allItems[0].memo=memo;showList(allItems.filter(i=>i.tradeType==='lease'));},memo);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');await card.getByRole('button',{name:'메모 열기',exact:true}).click();
 expect(await card.locator('.item-memo-content').textContent()).toBe(memo);await expect(card.locator('.source-description-original-v140')).toHaveCount(0);
});

for(const [id,mode] of [['FIXTURE-LEASE-1','lease'],['FIXTURE-BUILDING','building_sale'],['FIXTURE-LAND','land_sale']])test('source detail keeps conditions and separates broker raw: '+mode,async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.route('**/api/data?*',async route=>{
  const url=new URL(route.request().url());if(url.searchParams.get('action')!=='unifiedListingDetail')return route.fallback();
  const result=await route.fetch(),data=await result.json();data.originals=data.originals.map(o=>({...o,memo:raw}));await route.fulfill({json:data});
 });
 await page.evaluate(({id,mode})=>{JSListingTradeV1.setMode(mode);JSUnifiedListingsV8.open(id);},{id,mode});
 const drawer=page.locator('#unifiedDetailDrawerV8');
 await expect(drawer.locator('.source-description-clean-v140')).toContainText('관리비 : 내부 규약 준수');
 await expect(drawer.locator('.source-description-clean-v140')).not.toContainText('공인중개사무소');
 await expect(drawer.locator('.source-description-clean-v140')).toContainText('화장실 남·여 각 1');
 await expect(drawer.locator('.source-description-original-v140 > div')).toHaveText(raw);
});


// v141: all five missed production shapes must render consistently, including
// the financial-keyword marketing and the spaced Korean brokerage name.
const reportedV141=JSON.parse(readFileSync('tests/fixtures/source-description-v141.json','utf8'));
for(const sample of reportedV141)test('reported memo retains original and strips brokerage promises: '+sample.key,async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(raw=>{allItems[0].memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));},sample.raw);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
 await card.getByRole('button',{name:'메모 열기',exact:true}).click();
 const cleaned=card.locator('.source-description-clean-v140');
 await expect(cleaned).toBeVisible();
 await expect(cleaned).not.toContainText('공인중개사');
 await expect(cleaned).not.toContainText('이 음 부 동 산');
 await expect(cleaned).not.toContainText('최대한 조율');
 await expect(cleaned).not.toContainText('최적화');
 await expect(cleaned).not.toContainText('매물 다량 보유');
 if(sample.key==='taepyeong337')for(const term of ['210만원(부가세별도)','1~3층 이용 가능','화물 엘리베이터','야적공간'])await expect(cleaned).toContainText(term);
 if(sample.key==='songchon241')await expect(cleaned).not.toContainText('O이음O');
 if(sample.key==='songchon241')for(const term of ['25.9mX8.5m','층고 2.6m 셔터','외부화장실','E/V : 없음'])await expect(cleaned).toContainText(term);
 await card.getByText('수집 원문 보기',{exact:true}).click();
 expect(await card.locator('.source-description-original-v140 > div').textContent()).toBe(sample.raw);
 await card.getByRole('button',{name:'수정',exact:true}).click();
 await expect(card.locator('textarea')).toHaveValue(await page.evaluate(raw=>JSUnifiedListingsV8.editableMemoText({source:'네이버',memo:raw}),sample.raw));
 await expect(card.locator('.memo-editor-original-v144 > div')).toHaveText(sample.raw);
 await card.getByRole('button',{name:'취소',exact:true}).click();
});

const reportedV144=JSON.parse(readFileSync('tests/fixtures/source-description-v144.json','utf8')).raw;
test('reported Yongmun memo opens a clean editor with raw separately and saves facts only to the selected master',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(raw=>{allItems[0].memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));},reportedV144);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
 const neighbor=await page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"]').innerText();
 await card.getByRole('button',{name:'메모 열기',exact:true}).click();await card.getByRole('button',{name:'수정',exact:true}).click();
 await expect(card.locator('textarea')).not.toHaveValue(/공인중개사|공제·보험|권리와 의무/);
 for(const term of ['권리금 : 350만 원','면적 : 약 12 평','주차장 : 불가','사용자 작성 메모'])await expect(card.locator('textarea')).toHaveValue(new RegExp(term));
 await card.getByText('수집 원문 보기',{exact:true}).click();await expect(card.locator('.memo-editor-original-v144 > div')).toHaveText(reportedV144);
 await card.getByText('수집 원문 보기',{exact:true}).click();
 if(!isMobile)await page.screenshot({path:'outputs/v144-clean-editor-fixture.png'});
 let submitted;
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body.action!=='updatePropertyMemo')return route.fallback();submitted=body;
   await route.fulfill({json:{ok:true,persisted:true,propertyId:'FIXTURE-LEASE-1',memo:body.memo,contacts:[]}});
 });
 const value=await card.locator('textarea').inputValue();await card.locator('textarea').fill(value.replace('350만 원','300만 원')+'\n추가 현장 메모');
 await page.evaluate(()=>showList(visibleListItems));await expect(card.locator('textarea')).toHaveValue(/추가 현장 메모/);
 await card.getByRole('button',{name:'저장',exact:true}).click();await expect.poll(()=>submitted?.key.propertyId).toBe('FIXTURE-LEASE-1');
 expect(submitted.memo).toContain('권리금 : 300만 원');expect(submitted.memo).toContain('사용자 작성 메모');expect(submitted.memo).not.toContain('공인중개사');
 expect(await page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"]').innerText()).toBe(neighbor);
});
test('a phone-only condition save keeps the raw CAS memo while its editor is clean and fitted',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.evaluate(raw=>{allItems[0].memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));},reportedV144);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');await card.getByRole('button',{name:'임대조건 수정',exact:true}).click();
 await expect(page.locator('#peMemoV630')).not.toHaveValue(/공인중개사/);await expect(page.locator('#peMemoV630')).toHaveValue(/350만 원/);
 await page.locator('#propertyEditRawMemoV144').getByText('수집 원문 보기',{exact:true}).click();
 await expect(page.locator('#propertyEditRawMemoV144 details > div')).toHaveText(reportedV144);
 const bounds=await page.locator('#propertyEditSaveBtnV630').boundingBox();expect(bounds.y+bounds.height).toBeLessThanOrEqual(await page.evaluate(()=>visualViewport.offsetTop+visualViewport.height));
 let sent;await page.route('**/api/data',async r=>{const body=r.request().postDataJSON();if(body.action!=='updateProperty')return r.fallback();sent=body;
  await r.fulfill({json:{ok:true,persisted:true,propertyId:'FIXTURE-LEASE-1',changedFields:['landlord_phone'],updated:body.updated}});
 });
 await page.locator('#peLandlordPhoneV630').fill('010-1234-5678');await page.locator('#propertyEditSaveBtnV630').click();
 await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);expect(sent.originalValues[11]).toBe(reportedV144);expect(sent.updated.memo).toBe(reportedV144);
});

test('generated memo conflict compares projected text and rebases latest raw without a false memo edit',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.evaluate(raw=>{allItems[0].memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));},reportedV144);
 const latest=reportedV144+'\n[26.11.10] 다른 기기 작성 메모';const writes=[];
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body.action!=='updateProperty')return route.fallback();writes.push(body);
  await route.fulfill(writes.length===1?{status:409,json:{ok:false,code:'PROPERTY_EDIT_CONFLICT'}}:{json:{ok:true,persisted:true,propertyId:'FIXTURE-LEASE-1',changedFields:['landlord_phone'],updated:body.updated}});
 });
 await page.route('**/api/data?*',async route=>{if(new URL(route.request().url()).searchParams.get('action')!=='listingChanges')return route.fallback();
  await route.fulfill({json:{ok:true,items:[{property_id:'FIXTURE-LEASE-1',title:'테스트 괴정 상가',address:'대전 서구 괴정동 1-1',room:'1층',listing_type:'상가',deposit:2000,monthly_rent:90,maintenance_fee:0,premium:0,area_m2:25,landlord_phone:'',tenant_phone:'',status:'active',main_source:'네이버',operating_memo:latest,contacts_json:'[]'}]}});
 });
 await page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]').getByRole('button',{name:'임대조건 수정',exact:true}).click();
 await page.locator('#peLandlordPhoneV630').fill('010-1234-5678');await page.locator('#propertyEditSaveBtnV630').click();
 await expect(page.getByRole('checkbox',{name:'메모 내 입력 유지',exact:true})).not.toBeChecked();
 await expect(page.getByRole('checkbox',{name:'임대인 전화 내 입력 유지',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'선택한 값으로 편집 계속 (아직 저장 안 함)',exact:true}).click();
 await expect(page.locator('#peMemoV630')).toHaveValue(/다른 기기 작성 메모/);await expect(page.locator('#peMemoV630')).not.toHaveValue(/공인중개사/);
 await page.locator('#propertyEditSaveBtnV630').click();await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
 expect(writes).toHaveLength(2);expect(writes[1].originalValues[11]).toBe(latest);expect(writes[1].updated.memo).toBe(latest);
});

test('point refresh restores a newer private note before projecting and saves its exact baseline',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const latest=reportedV144+'\n[26.11.10] 서버에만 있던 최신 메모';
 await page.evaluate(({raw,latest})=>{allItems[0].memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));
   window.JSListingRefreshV1={refreshMoved:async result=>{if(result.affectedPropertyIds.length!==1||result.affectedPropertyIds[0]!=='FIXTURE-LEASE-1')throw Error('wrong scope');allItems[0].memo=latest;return true;}};
 },{raw:reportedV144,latest});
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');await card.getByRole('button',{name:'메모 열기',exact:true}).click();await card.getByRole('button',{name:'수정',exact:true}).click();
 await expect(card.locator('textarea')).toHaveValue(/서버에만 있던 최신 메모/);await expect(card.locator('textarea')).not.toHaveValue(/공인중개사/);
 let sent;await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body.action!=='updatePropertyMemo')return route.fallback();sent=body;await route.fulfill({json:{ok:true,persisted:true,propertyId:'FIXTURE-LEASE-1',memo:body.memo,contacts:[]}});});
 const value=await card.locator('textarea').inputValue();await card.locator('textarea').fill(value+'\n내 새 기록');await card.getByRole('button',{name:'저장',exact:true}).click();
 await expect.poll(()=>sent?.expectedMemoV144).toBe(latest);expect(sent.memo).toContain('서버에만 있던 최신 메모');expect(sent.memo).toContain('내 새 기록');
});
test('a late pre-edit read cannot reopen replace mode after the user chooses add',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.evaluate(raw=>{allItems[0].memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));window.__readStarted=false;
   window.JSListingRefreshV1={refreshMoved:()=>{__readStarted=true;return new Promise(resolve=>{window.__finishMemoRead=()=>resolve(true);});}};
 },reportedV144);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');await card.getByRole('button',{name:'메모 열기',exact:true}).click();await card.getByRole('button',{name:'수정',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>__readStarted)).toBe(true);await card.getByRole('button',{name:'추가하기',exact:true}).click();await card.locator('textarea').fill('작성 중인 추가 메모');
 await page.evaluate(()=>__finishMemoRead());await expect(card.locator('textarea')).toHaveValue('작성 중인 추가 메모');await expect(card.locator('textarea')).toHaveAttribute('placeholder','추가할 메모를 입력하세요.');
});
