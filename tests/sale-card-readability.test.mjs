import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window = {addEventListener(){}, dispatchEvent(){}};
const context = {window, document:{getElementById(){return null;}, querySelector(){return null;}, documentElement:{setAttribute(){}}, addEventListener(){}}};
vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'), context);
vm.runInNewContext(fs.readFileSync('js/sale-workbench-v1.js','utf8'), context);
const ui = window.JSListingTradeV1, workbench = window.JSSaleWorkbenchV1;
const land = {tradeType:'sale', saleCategory:'land', source:'공실박스', salePrice:41000,
  saleDetails:{scope:'land',landAreaM2:167,landUse:'대',zoning:'제2종일반주거지역',providerCheckedAt:'2025-04-25 10:22:09',fieldSources:{landUse:'detail.bilinfo.jimok'}}};

test('sale source metadata is closed by default, retains the full date and caveat', () => {
  const html = workbench.detailTools(land,'M-test');
  assert.match(html, /<details class="sale-provenance sale-source-details-v1"><summary>출처·확인일 보기 · 공실박스<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /제공처 확인일: 2025-04-25 10:22:09/);
  assert.match(html, /detail\.bilinfo\.jimok/);
  assert.match(html, /확인일은 실제 계약 가능 여부를 보증하지 않습니다/);
  assert.doesNotMatch(html, /<p class="sale-provenance">/);
});

test('folded source metadata escapes provider supplied values and handles missing dates', () => {
  const item = {...land,source:'<img onerror=alert(1)>',saleDetails:{...land.saleDetails,providerCheckedAt:'<script>bad</script>',fieldSources:{zoning:'<b>bad</b>'}}};
  const html = workbench.detailTools(item,'M-test');
  assert.doesNotMatch(html, /<img|<script|<b>bad/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;bad&lt;\/b&gt;/);
  const unknown = workbench.detailTools({...land, saleDetails:{}},'M-test');
  assert.match(unknown, /제공처 확인일: 미제공/);
  assert.equal(workbench.detailTools({tradeType:'lease'},'M-lease'),'');
});

test('land badges retain collected values and unknown labels without changing building or lease cards', () => {
  assert.match(ui.saleLandInfoHtml(land), /지목 <b>대<\/b>/);
  assert.match(ui.saleLandInfoHtml(land), /용도지역 <b>제2종일반주거지역<\/b>/);
  assert.match(ui.saleLandInfoHtml({...land,saleDetails:{scope:'land'}}), /class="unavailable">지목 <b>미확인<\/b>/);
  assert.equal(ui.saleLandInfoHtml({tradeType:'sale',saleCategory:'building',saleDetails:{scope:'whole_building'}}),'');
  assert.equal(ui.saleLandInfoHtml({...land,tradeType:'lease'}),'');
});

test('note styling explicitly outranks the shared desktop/mobile price paragraph selector', () => {
  const css = fs.readFileSync('css/listing-trade-v1.css','utf8');
  assert.match(css, /\.unified-detail-summary-v8 > p\.listing-sale-yield-note-v1\s*\{[^}]*font-size: 12px !important;[^}]*font-weight: 400 !important;/);
  assert.match(css, /\.listing-land-info-v1 b\s*\{[^}]*font-size: 13px;/);
  const fixture = fs.readFileSync('tools/preview-listing-header.mjs','utf8');
  assert.match(fixture, /detail-example unified-detail-summary-v8/);
});
