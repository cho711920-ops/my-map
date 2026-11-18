const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('js/script.js','utf8').split('/* JS부동산 공통 UI/리스트/필터 핵심 스크립트 */')[0];
const context=vm.createContext({window:{}});vm.runInContext(source,context);
const money=context.window.JSDesignReviewV261;
test('v261 comma amounts keep explicit zero, missing and decimal units distinct',()=>{
  for(const [input,expected] of [['270,000',270000],['155,800',155800],['55,000',55000],['0',0],['0.25',0.25],['.5',0.5],['1,234.50',1234.5],['',null],['  ',null]])assert.equal(money.moneyNumber(input),expected,input);
  for(const input of ['1,00','12,34,567','-1','NaN','Infinity','1억','<script>'])assert.ok(Number.isNaN(money.moneyNumber(input)),input);
  assert.equal(money.formatMoney('1234567.50'),'1,234,567.50');assert.equal(money.formatMoney(''),'');assert.equal(money.formatMoney('0'),'0');
  assert.equal(270000-155800-55000,59200);
  const original={deposit:1,rent:0.005,room:'1층',area:35.1234,fee:0.0005,premium:0},before=JSON.stringify(original),html=money.originalConditions(original);
  assert.ok(html.includes('0.005만원'));assert.ok(html.includes('0.0005만원'));assert.ok(html.includes('35.1234평'));assert.ok(!html.includes('0.01만원'));assert.equal(JSON.stringify(original),before);
});
