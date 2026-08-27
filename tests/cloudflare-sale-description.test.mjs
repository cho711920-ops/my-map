import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { koreanMoneyManwon, saleDescriptionFields } from '../cloudflare/src/sale-description.js';
import { daangnSaleFields, naverSaleFields } from '../cloudflare/src/sale-fields.js';
import { normalizedRecord, manifestEntryMatch } from '../cloudflare/src/collector-api.js';
import { compactSaleSummary } from '../cloudflare/src/d1-api.js';

const content = `✅대지면적 : 183.1m²(55.4평)
✅연면적 : 299.88m²(90.8평)
✅건물층수 : 총3개층
✅세대구성 : 원룸18개 (총18세대)
✅매매 : 8억5천만원
✅융자 : 3억원
✅보증금 : 1억7천8백8십만원
✅월수익(이자제외) : 202만원
✅실투자금 : 3억7천1백2십만원
✅연 수익률 : 6.53%
8억5천만원, 원룸18실을 갖춘 괴정동 수익형 다가구`;
const article = { originalId: '4084712', tradeType: 'sale', salesTypeV3: { type: 'TWO_ROOM' },
  isEntireBuilding: false, area: '183.1', floor: 3, topFloor: 3,
  trades: [{ type: 'BUY', price: 85000 }], publicJibunAddress: '서구 괴정동 4-4', content };
const window = {};
vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'), { window,
  document: { getElementById: () => null, querySelector: () => null, documentElement: { setAttribute() {} } } });
const ui = window.JSListingTradeV1;

test('Korean money parser handles multi-unit source wording without confusing won and manwon', () => {
  for (const [text, value] of [['8억5천만원',85000], ['3억원',30000], ['1억7천8백8십만원',17880],
    ['3억7천1백2십만원',37120], ['202만원',202], ['0만원',0], ['3,000,000원',300]])
    assert.equal(koreanMoneyManwon(text), value, text);
  for (const text of ['202', '-202만원', '협의', '백천만원', '1억원 또는 2억원', 'NaN'])
    assert.equal(koreanMoneyManwon(text), null, text);
});

test('4084712 description normalizes sale whole-building classification and exact source areas', () => {
  const r = normalizedRecord('당근', article);
  assert.equal(r.saleCategory, 'multifamily'); assert.equal(r.category, '다가구');
  assert.equal(r.room,'전체'); assert.equal(r.area,90.7); assert.equal(r.salePrice,85000);
  const d = r.saleDetails;
  assert.equal(d.landAreaM2,183.1); assert.equal(d.grossAreaM2,299.88); assert.equal(d.exclusiveAreaM2,null);
  assert.equal(d.loanAmount,30000); assert.equal(d.totalDeposit,17880); assert.equal(d.monthlyNetIncome,202);
  assert.ok(d.monthlyIncome == null); assert.equal(d.investmentAmount,37120); assert.equal(d.advertisedYield,6.53);
  assert.equal(d.householdCount,18); assert.ok(d.descriptionEvidence['보증금']);
});

test('Naver basic won prices and full sale description are both collected; conflicts remain visible', () => {
  const item = { tradeType:'sale', salePrice:85000, category:'다가구', description:'목록 요약',
    saleRaw:{ detailInfo:{ articleDetailInfo:{ description:content },
      priceInfo:{dealPrice:850000000,warrantyPrice:150000000,rentPrice:3000000} } } };
  const d = naverSaleFields(item);
  assert.equal(d.totalDeposit,15000); assert.equal(d.monthlyIncome,300);
  assert.equal(d.descriptionFinancials.totalDeposit,17880); assert.equal(d.loanAmount,30000);
  assert.match(d.descriptionWarnings.join(' '),/보증금.*불일치/);
  assert.match(d.descriptionText,/원룸18실/);
  const html=ui.saleDetailsHtml({...item,saleDetails:d});
  assert.match(html,/설명 기재 보증금/); assert.match(html,/17880/); assert.match(html,/상세설명 전체 보기/);
  const normalized=normalizedRecord('네이버',{...item,description:'매매: 8억5천만원\n문의 010-1234-5678'});
  assert.doesNotMatch(JSON.stringify(normalized.saleDetails),/010-1234-5678/);
});

test('explicit financial units without a colon work, unclear text stays in the full description', () => {
  const d=saleDescriptionFields('융자 7천만\n보증금 3,500만원\n월세 400만원\n실투자금 협의');
  assert.equal(d.loanAmount,7000); assert.equal(d.totalDeposit,3500); assert.equal(d.monthlyIncome,400);
  assert.equal(d.investmentAmount,null);
  assert.equal(koreanMoneyManwon('1억5천원'),null);
});

test('after-interest and unspecified monthly profit never become gross monthly rent', () => {
  const r = normalizedRecord('당근', article);
  assert.equal(ui.saleYield(r),null);
  assert.match(ui.saleYieldBadge(r),/광고 연 6.53%/);
  assert.match(ui.saleDetailsHtml(r),/이자 차감 표기/);
  assert.equal(compactSaleSummary(r).advertisedYield,6.53);
  assert.ok(!('monthlyNetIncome' in compactSaleSummary(r)));
  const d = saleDescriptionFields('월수익: 202만원\n보증금: 1000만원');
  assert.equal(d.statedMonthlyIncome,202); assert.equal(d.monthlyIncome,null);
  const gross = daangnSaleFields({ ...article, content: content + '\n월 임대수입: 300만원' });
  assert.equal(gross.monthlyIncome,300);
  assert.ok(ui.saleYield({ ...r, saleDetails:gross }) > 0);
  assert.doesNotMatch(ui.saleYieldBadge({ ...r, saleDetails:gross }),/광고 연/);
});

test('ambiguous prices and conflicting description fields are not guessed', () => {
  const d = saleDescriptionFields(content + '\n보증금: 2억원');
  assert.equal(d.totalDeposit,null); assert.match(d.descriptionWarnings.join(' '),/보증금.*충돌/);
  const conflict = daangnSaleFields({ ...article, trades:[{ type:'BUY',price:90000 }] });
  assert.equal(conflict.advertisedYield,undefined); assert.equal(conflict.totalDeposit,undefined);
  assert.match(conflict.descriptionWarnings.join(' '),/매매가.*불일치/);
  assert.equal(saleDescriptionFields('월 임대수입: 협의\n보증금: 17880\n매매: 8억~9억원').totalDeposit,null);
});

test('lease records and apartment/unit types do not get silently reclassified', () => {
  const lease = normalizedRecord('당근', { ...article, tradeType:'lease', trades:[{ type:'MONTH',deposit:1000,rent:50 }] });
  assert.notEqual(lease.room,'전체'); assert.equal(lease.saleDetails,undefined);
  assert.equal(daangnSaleFields(article,'apartment').scope,'unit');
  assert.equal(daangnSaleFields({ ...article, content:'다가구 전문\n대지면적: 183.1㎡' }).scope,'unit');
  const changed = daangnSaleFields({ ...article, landArea:200 });
  assert.equal(changed.landAreaM2,200); assert.match(changed.descriptionWarnings.join(' '),/대지면적.*불일치/);
});

test('old sale snapshots are refreshed once; current descriptions and lease paths keep skipping unchanged records', () => {
  const entry={tradeType:'sale',listSnapshot:'same'};
  // FNV-1a hash for the collector list fingerprint, generated by the production helper.
  let hash=2166136261; for(const char of 'same') { hash^=char.charCodeAt(0); hash=Math.imul(hash,16777619); }
  const row={trade_type:'sale',snapshot_hash:'fnv1a-'+(hash>>>0).toString(16).padStart(8,'0'),list_snapshot_json:'{}'};
  assert.equal(manifestEntryMatch(entry,row,'당근'),'');
  assert.equal(manifestEntryMatch(entry,row,'네이버'),'');
  assert.equal(manifestEntryMatch(entry,row,'공실박스'),'');
  assert.equal(manifestEntryMatch(entry,{...row,sale_metadata_version:2},'공실박스'),'hash');
  row.list_snapshot_json=JSON.stringify({saleDetails:{descriptionVersion:1}});
  assert.equal(manifestEntryMatch(entry,row,'당근'),'hash');
  row.list_snapshot_json='same';
  row.sale_description_version=1;
  assert.equal(manifestEntryMatch(entry,row,'당근'),'hash', 'unresolved review snapshots also remember the completed refresh');
  const api=fs.readFileSync('cloudflare/src/collector-api.js','utf8');
  assert.match(api,/json_extract\(payload_json, '\$\.saleDetails\.descriptionVersion'\)/);
  assert.match(api,/saleDescriptionVersion: Number\(record.saleDetails\?\.descriptionVersion/);
});

test('Naver full description collector includes detail text beyond the short list summary', () => {
  const text=fs.readFileSync('js/naver-collector.js','utf8');
  const context={};
  vm.runInNewContext(text.match(/^  function finSaleDescription\([^]*?^  }/m)[0],context);
  assert.equal(context.finSaleDescription({detailInfo:{articleDetailInfo:{description:content}}},'목록 요약'),'목록 요약\n'+content);
  assert.equal(context.finSaleDescription({description:'중복'},'중복'),'중복');
  assert.match(text,/description: tradeType === "A1" \? finSaleDescription/);
});
