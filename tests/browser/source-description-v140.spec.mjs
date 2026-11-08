import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
const raw='(임장가자) 보증금 5000만원 / 월세 315만원 ✅ 주차 편리 / 코너 상가 ✅ 관리비 : 내부 규약 준수 ✅ 화장실 남·여 각 1 ✅ 공인중개사무소 소개 ✅ 성실·책임 중개 ✅ 한국공인중개사협회 2억 원 책임보험 가입 ✅ 채팅보다 전화상담이 빠르답니다';
async function setup(page,context,isMobile){
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 if(isMobile){await page.setViewportSize({width:930,height:530});await page.evaluate(()=>JSMapListPanelV1.open());}
 await page.locator('#fixtureControls').evaluate(el=>el.remove());
}

test('collected list memo is concise, raw expandable and editor unchanged across refresh',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
 await page.evaluate(raw=>{const item=allItems[0];item.memo=raw;showList(allItems.filter(i=>i.tradeType==='lease'));},raw);
 const card=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
 await card.getByRole('button',{name:'메모 열기',exact:true}).click();
 await expect(card.locator('.source-description-clean-v140')).toContainText('월세 315만원');
 await expect(card.locator('.source-description-clean-v140')).not.toContainText('공인중개사');
 await expect(card.locator('.source-description-original-v140')).not.toHaveAttribute('open','');
 await card.getByText('수집 원문 보기',{exact:true}).click();
 await expect(card.locator('.source-description-original-v140 > div')).toHaveText(raw);
 await card.getByRole('button',{name:'수정',exact:true}).click();await expect(card.locator('textarea')).toHaveValue(raw);
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
 await expect(card.locator('textarea')).toHaveValue(sample.raw);
 await card.getByRole('button',{name:'취소',exact:true}).click();
});
