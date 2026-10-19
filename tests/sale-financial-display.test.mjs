import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {saleDescriptionFields,supplementSaleDescription} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay} from '../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary,handleD1GetAction} from '../cloudflare/src/d1-api.js';
import {DatabaseSync} from 'node:sqlite';
const description='▶ 매매가 : 6억7천 만원\n▶ 융 자 : 2억 (개인사정에 따라 승계여부확인!!)\n▶ 보증금 : 8천5백5십 만원\n▶ 월수익 : 월 211 만원 ▶실투자금 : 3억8천4백5십 만원';
const original={originalId:'financial-original',propertyId:'financial-property',source:'당근',tradeType:'sale',saleCategory:'building',salePrice:67000,
  saleDetails:{scope:'whole_building',descriptionVersion:1,totalDeposit:8550,descriptionText:description,
    descriptionFinancials:{salePrice:67000,totalDeposit:8550},descriptionEvidence:{'매매가':'매매가 : 6억7천 만원','보증금':'보증금 : 8천5백5십 만원'}}};
function ui(){const window={};vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}}});return window.JSListingTradeV1;}
test('1410307 wording preserves the deposit, spaced loan, unknown-basis monthly profit and investment with exact quotes',()=>{
  const f=saleDescriptionFields(description);assert.equal(f.salePrice,67000);assert.equal(f.totalDeposit,8550);assert.equal(f.loanAmount,20000);assert.equal(f.statedMonthlyIncome,211);assert.equal(f.investmentAmount,38450);assert.equal(f.monthlyIncome,null);assert.equal(f.monthlyNetIncome,null);
  for(const quote of Object.values(f.descriptionEvidence))assert.ok(description.includes(quote));
  const before=structuredClone(original),r=withSaleFinancialDisplay(original);assert.deepEqual(original,before);
  for(const key of ['originalId','propertyId','source','tradeType','saleCategory','salePrice'])assert.equal(r[key],original[key]);
  assert.equal(r.saleDetails.statedMonthlyIncome,211);assert.equal(r.saleDetails.investmentAmount,38450);assert.equal(r.saleDetails.loanAmount,20000);assert.equal(r.saleDetails.totalDeposit,8550);
  assert.equal(ui().saleYield(r),null);
  const summary=compactSaleSummary(r),html=ui().saleCardFactsHtml({...r,saleDetails:summary});assert.equal(summary.statedMonthlyIncome,211);assert.match(html,/광고 월수익 · 기준 미확인/);assert.match(html,/211만원/);assert.match(html,/20,000만원/);assert.match(html,/38,450만원/);assert.doesNotMatch(html,/월 임대수입/);
});
test('paired amounts never read the deposit as rent, including zero, Korean units and no spacing',()=>{
  for(const [text,deposit,rent] of [['기보증금 / 월세 : 4000만원 / 290만원',4000,290],['보증금/월세:5,000만원/426만원',5000,426],['보증금 / 월세 : 1억 / 700만원',10000,700],['보증금/월세:0만원/100만원',0,100]]){
    const r=saleDescriptionFields(text);assert.equal(r.totalDeposit,deposit,text);assert.equal(r.monthlyIncome,rent,text);
  }
  assert.equal(saleDescriptionFields('기보증금 / 월세 : 4000 / 290만원').monthlyIncome,null);
});
test('the narrow rent synonym and punctuation variants retain explicit units',()=>{
  for(const text of ['보증금:3천만원/월세:280만원','📌 보증금 3천만원 / 월차임 280만원으로 임대중','▶기월세:280만원(부가세 별도)','월임대료 280만 원'])assert.equal(saleDescriptionFields(text).monthlyIncome,280,text);
  for(const text of ['월세280','보증금 1억5천원','보증금 1억 5000']){const r=saleDescriptionFields(text);assert.equal(r.totalDeposit,null,text);assert.equal(r.monthlyIncome,null,text);}
});
test('future rent and increases do not become current rent; known rent stays separate from net profit',()=>{
  for(const text of ['예상 임대조건 : 보증금 1,000만원 / 월세 70만원','만실시 보증금 10억8천, 월세 6,100만원,','만실 기준 월세 690만','월세 20만원 정도는 인상 여지가 충분히 있습니다'])assert.equal(saleDescriptionFields(text).monthlyIncome,null,text);
  const r=saleDescriptionFields('총 월세 : 300만원\n월수익(이자제외): 월 211 만원');assert.equal(r.monthlyIncome,300);assert.equal(r.monthlyNetIncome,211);assert.equal(r.statedMonthlyIncome,null);
  const mixed=saleDescriptionFields('보증금/월세:3,000만원/250만원\n해당 매물의 경우 월세 20만원 정도는 인상 여지가 충분합니다');assert.equal(mixed.monthlyIncome,250);
});
test('read-only correction of marked v1 values keeps provider values, overrides, leases, land and other sources separate',()=>{
  const old={...original,source:'네이버',saleDetails:{descriptionVersion:1,descriptionText:'기보증금 / 월세 : 4000만원 / 290만원',monthlyIncome:4000,descriptionFinancials:{monthlyIncome:4000},descriptionEvidence:{'월 임대수입':'월세 : 4000만원'}}};
  const corrected=withSaleFinancialDisplay(old,{naverPriceInfo:{dealPrice:670000000,warrantyPrice:null,rentPrice:null}});assert.equal(corrected.saleDetails.monthlyIncome,290);assert.equal(corrected.saleDetails.totalDeposit,4000);
  assert.equal(withSaleFinancialDisplay(old,{naverPriceInfo:{rentPrice:3500000}}).saleDetails.monthlyIncome,350);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{...old.saleDetails,monthlyIncome:500}},{naverPriceInfo:{}}).saleDetails.monthlyIncome,500);
  for(const patch of [{tradeType:'lease'},{saleCategory:'land'},{source:'공실박스'},{masterFallback:true}]){const item={...original,...patch};assert.equal(withSaleFinancialDisplay(item),item);}
  const fallback=withSaleFinancialDisplay({...original,saleDetails:{}},{daangn:{description:description+'\n문의 010-1234-5678'}});assert.equal(fallback.saleDetails.statedMonthlyIncome,211);assert.doesNotMatch(JSON.stringify(fallback),/010-1234-5678/);
  const duplicate={...original,saleDetails:{descriptionText:'보증금1억원\n보증금2억원'}};assert.equal(withSaleFinancialDisplay(duplicate).saleDetails.totalDeposit,undefined);
});
test('a single-floor rental amount is not a whole-building total, and price conflicts remain held',()=>{
  const described=saleDescriptionFields('1층 상가 보증금 5000만원 / 월세 200만원');
  const held=supplementSaleDescription({scope:'whole_building'},described,67000,'');assert.equal(held.totalDeposit,undefined);assert.equal(held.monthlyIncome,undefined);
  const unit=supplementSaleDescription({scope:'unit'},described,67000,'');assert.equal(unit.totalDeposit,5000);assert.equal(unit.monthlyIncome,200);
  const pair=supplementSaleDescription({scope:'whole_building'},saleDescriptionFields('1층 상가 보증금/월세:5000만원/200만원'),67000,'');assert.equal(pair.totalDeposit,undefined);assert.equal(pair.monthlyIncome,undefined);
  const conflict=withSaleFinancialDisplay({...original,salePrice:70000});assert.equal(conflict.saleDetails.statedMonthlyIncome,undefined);assert.match(conflict.saleDetails.descriptionWarnings.join(' '),/매매가/);
});

test('numbered items, newlines and building composition do not suppress valid current totals',()=>{
  for(const text of ['총 보증금 : 4.8억원 3) 총 월세 : 3,915만원(부가세별도)', '총 보증금 : 4.8억원\n3) 총 월세 : 3,915만원(부가세별도)']) {
    const r=saleDescriptionFields(text);assert.equal(r.totalDeposit,48000);assert.equal(r.monthlyIncome,3915);
  }
  assert.equal(saleDescriptionFields('융자 3.5억 1층 점포2개').loanAmount,35000);
  for(const text of ['총 월세:1020만원(만실시)','보증금 / 총월세: 1.6억원 / 871만원(만실 시)'])assert.equal(saleDescriptionFields(text).monthlyIncome,null);
  for(const text of ['건물현황 : 상가제외 10호실 - 보증금 4억 6천만원/ 월세 644만원','4층 투룸(2) 매매가 14억5천만원 보증금 1억6,800만원 / 월차임 395만원']) {
    const r=supplementSaleDescription({scope:'whole_building'},saleDescriptionFields(text),null,'');assert.ok(r.totalDeposit>0);assert.ok(r.monthlyIncome>0);
  }
});

test('SQLite list/detail financial parity is source-local and read-only with structured provider precedence',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const migrations=new URL('../cloudflare/migrations/',import.meta.url);
  for(const f of fs.readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL(f,migrations),'utf8'));
  const cases=[
    {item:original,raw:{},expected:{totalDeposit:8550,loanAmount:20000,statedMonthlyIncome:211,investmentAmount:38450}},
    {item:{...original,saleDetails:{scope:'whole_building'}},raw:{content:description+'\n문의 010-1234-5678'},expected:{totalDeposit:8550,loanAmount:20000,statedMonthlyIncome:211,investmentAmount:38450}},
    {item:{...original,source:'네이버',saleDetails:{scope:'whole_building',descriptionVersion:1,descriptionText:'보증금/월세:4000만원/290만원',monthlyIncome:4000,descriptionFinancials:{monthlyIncome:4000},descriptionEvidence:{'월 임대수입':'월세:4000만원'}}},raw:{saleRaw:{detailInfo:{priceInfo:{rentPrice:3500000}}}},expected:{totalDeposit:4000,monthlyIncome:350}},
    {item:{...original,source:'네이버',saleDetails:{scope:'whole_building',descriptionVersion:2,descriptionText:'매매가 6억7천만원 / 보증금 8억8천',totalDeposit:null}},raw:{saleRaw:{priceInfo:{previousDeposit:85000000,previousMonthlyRent:2280000}}},expected:{totalDeposit:8500,monthlyIncome:228}},
    {item:{...original,tradeType:'lease',saleDetails:{}},raw:{content:description},expected:{}},
    {item:{...original,saleCategory:'land',saleDetails:{scope:'land'}},raw:{content:description},expected:{}}
  ];
  for(const [i,c] of cases.entries()) {c.item={...c.item,originalId:'S-financial-'+i,propertyId:'M-financial-'+i};
    db.prepare("INSERT INTO listings(id,property_id,status,trade_type) VALUES(?,?,'active',?)").run(c.item.propertyId,c.item.propertyId,c.item.tradeType);
    db.prepare('INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,trade_type,list_snapshot_json,raw_json) VALUES(?,?,?,?,1,?,?,?)').run(c.item.originalId,c.item.propertyId,c.item.source,String(i),c.item.tradeType,JSON.stringify(c.item),JSON.stringify({...c.raw,privateRaw:'DO_NOT_EXPOSE_FINANCIAL_RAW'}));
  }
  const state=()=>JSON.stringify(db.prepare('SELECT * FROM listing_sources ORDER BY id').all()),before=state(),queries=[];
  const prepare=(sql,values=[])=>{queries.push(sql);const indexes=[],query=sql.replace(/\?(\d+)/g,(_,n)=>{indexes.push(Number(n)-1);return '?';}),args=()=>indexes.length?indexes.map(i=>values[i]):values;
    return {bind(...bindings){return prepare(sql,bindings);},async all(){return {results:db.prepare(query).all(...args())};},async first(){return db.prepare(query).get(...args())||null;}};};
  const env={DB:{prepare}},list=await handleD1GetAction(env,{}, {action:'unifiedListings'});
  assert.doesNotMatch(JSON.stringify(list),/010-1234-5678|DO_NOT_EXPOSE_FINANCIAL_RAW|descriptionText/);
  for(const c of cases){const result=await handleD1GetAction(env,{}, {action:'unifiedListingDetail',propertyId:c.item.propertyId}),item=result.originals[0];
    const summary=list.groups[c.item.propertyId][0][list.fields.indexOf('saleSummary')]||'';assert.deepEqual(summary,compactSaleSummary(item));
    for(const key of ['totalDeposit','monthlyIncome','loanAmount','statedMonthlyIncome','investmentAmount'])assert.equal(item.saleDetails[key],c.expected[key],key);
    assert.equal(item.originalId,c.item.originalId);assert.equal(item.source,c.item.source);assert.equal(item.salePrice,c.item.salePrice);
    if(c.raw.content)assert.doesNotMatch(item.saleDetails.descriptionText||'',/010-1234-5678/);
  }
  assert.equal(state(),before);assert.ok(queries.every(sql=>/^\s*SELECT\b/.test(sql)));
});
