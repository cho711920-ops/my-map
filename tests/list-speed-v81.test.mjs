import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function harness(items=[]) {
  const window={allItems:items,addEventListener(){}};
  vm.runInNewContext(readFileSync('js/unified-listings-v8.js','utf8'),{
    window,console,document:{getElementById:()=>null,addEventListener(){}}
  });
  return window.JSUnifiedListingsV8;
}

test('provider labels and legacy aliases retain their source-filter meaning',()=>{
  const api=harness();
  for(const [source,expected] of [
    ['네이버','naver'],['naver','naver'],[' NAVER ','naver'],['네이버 부동산','naver'],
    ['당근','danggeun'],['daangn','danggeun'],[' KARROT ','danggeun'],['당근부동산','danggeun'],
    ['공실박스','gongsil'],['gongsil','gongsil'],[' 공실 ','gongsil'],
    ['직접','direct'],['직접 등록','direct'],['danggeun','unknown'],['','unknown'],[null,'unknown']
  ]) {
    for(const selected of ['naver','danggeun','gongsil','direct','unknown']) {
      assert.equal(api.matchesSource({source},selected),selected===expected,String(source)+' / '+selected);
    }
  }
});

test('wide master projections preserve own fields and each selected advertisement financial conditions',()=>{
  const master={propertyId:'WIDE',key:'legacy-key',name:'검수용 건물',address:'검수용 주소',
    room:'원래 방 키',state:'active',source:'네이버',tradeType:'sale',saleCategory:'building',
    deposit:10000,rent:500,fee:3,premium:0,area:100,salePrice:90000,
    displayValuePresence:{deposit:true,rent:true},memo:'개인 메모 보존',
    ...Object.fromEntries(Array.from({length:60},(_,i)=>['legacyField'+i,'보존'+i]))};
  const groups={WIDE:[
    {propertyId:'WIDE',originalId:'A',source:'네이버',active:1,deposit:3000,rent:130,fee:10,premium:0,area:80,salePrice:80000},
    {propertyId:'WIDE',originalId:'B',source:'당근',active:1,deposit:7000,rent:250,fee:20,premium:0,area:90,salePrice:85000},
    {propertyId:'WIDE',originalId:'C',source:'공실박스',active:1,deposit:null,rent:null,salePrice:82000}
  ]};
  const api=harness([master]);api.attach([master],{ok:true,groups});
  const originalJson=JSON.stringify(groups);
  for(const ad of groups.WIDE) {
    const projected=api.filterItemForView(master,i=>i.unifiedFilterOriginalV2.originalId===ad.originalId,'active');
    assert.ok(projected);
    assert.equal(projected.deposit,ad.deposit??0);assert.equal(projected.rent,ad.rent??0);
    assert.equal(projected.salePrice,ad.salePrice);
    assert.equal(projected.displayValuePresence.rent,ad.rent!==null);
    assert.equal(projected.key,master.key);assert.equal(projected.room,master.room);
    assert.equal(projected.memo,master.memo);
    assert.equal(Object.hasOwn(projected,'legacyField59'),true);
    assert.equal(JSON.parse(JSON.stringify(projected)).legacyField59,'보존59');
    assert.deepEqual(Array.from(projected.unifiedDisplayOriginalsV2,o=>o.originalId),[ad.originalId]);
    projected.displayValuePresence.rent=false;
    assert.equal(master.displayValuePresence.rent,true);
  }
  assert.equal(JSON.stringify(groups),originalJson,'Projection must not edit stored advertisements');
  assert.equal(master.deposit,10000);assert.equal(master.rent,500);
});

test('single and empty original groups keep independent returned arrays',()=>{
  const master={propertyId:'ONE',state:'active',key:'preserved',source:'네이버'};
  const ad={propertyId:'ONE',originalId:'ONLY',source:'네이버',active:1};
  const rows=Object.freeze([ad]);
  const api=harness([master]);api.attach([master],{ok:true,groups:{ONE:rows,EMPTY:Object.freeze([])}});
  api.allOriginals('ONE').pop();api.allOriginals('EMPTY').push(ad);
  assert.deepEqual(Array.from(api.allOriginals('ONE'),o=>o.originalId),['ONLY']);
  assert.equal(api.allOriginals('EMPTY').length,0);
  assert.equal(rows.length,1);assert.equal(master.key,'preserved');
});
